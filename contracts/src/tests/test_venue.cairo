use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use convoy::external::PoolKey;
use convoy::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockRouterAdminDispatcher,
    IMockRouterAdminDispatcherTrait,
};
use convoy::types::{BatchState, Operation, order_commitment};
use convoy::venue::{IConvoyVenueDispatcher, IConvoyVenueDispatcherTrait};

const POOL: felt252 = 'POOL';
const OWNER: felt252 = 'OWNER';
const STRANGER: felt252 = 'STRANGER';

const LOT: u128 = 1_000_000_000_000_000_000;
const OPENS_AT: u64 = 1_000;
const SEALS_AT: u64 = 2_000;
const GRACE: u64 = 86_400;

#[derive(Copy, Drop)]
struct Env {
    venue: IConvoyVenueDispatcher,
    router_admin: IMockRouterAdminDispatcher,
    token_in: IMockERC20Dispatcher,
    token_out: IMockERC20Dispatcher,
    venue_addr: ContractAddress,
    router_addr: ContractAddress,
    route: PoolKey,
}

fn pool() -> ContractAddress {
    POOL.try_into().unwrap()
}

fn owner() -> ContractAddress {
    OWNER.try_into().unwrap()
}

fn deploy_erc20() -> ContractAddress {
    let class = declare("MockERC20").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![]).unwrap();
    addr
}

fn setup() -> Env {
    let a = deploy_erc20();
    let b = deploy_erc20();
    // token0 must be the numerically smaller address.
    let (token0, token1) = if a < b {
        (a, b)
    } else {
        (b, a)
    };

    let router_class = declare("MockRouter").unwrap().contract_class();
    let (router_addr, _) = router_class.deploy(@array![]).unwrap();

    let venue_class = declare("ConvoyVenue").unwrap().contract_class();
    let (venue_addr, _) = venue_class
        .deploy(@array![pool().into(), router_addr.into(), owner().into()])
        .unwrap();

    let route = PoolKey {
        token0,
        token1,
        fee: 170141183460469235273462165868118016, // 0.05%
        tick_spacing: 1000,
        extension: 0.try_into().unwrap(),
    };

    let router_admin = IMockRouterAdminDispatcher { contract_address: router_addr };
    router_admin.set_out_token(token1);

    start_cheat_block_timestamp_global(OPENS_AT);

    Env {
        venue: IConvoyVenueDispatcher { contract_address: venue_addr },
        router_admin,
        token_in: IMockERC20Dispatcher { contract_address: token0 },
        token_out: IMockERC20Dispatcher { contract_address: token1 },
        venue_addr,
        router_addr,
        route,
    }
}

fn create_batch(env: Env, min_orders: u16, min_out_per_lot: u128) -> u64 {
    start_cheat_caller_address(env.venue.contract_address, owner());
    let id = env
        .venue
        .create_batch(
            env.route,
            env.token_in.contract_address,
            LOT,
            4,
            min_orders,
            OPENS_AT,
            SEALS_AT,
            min_out_per_lot,
        );
    stop_cheat_caller_address(env.venue.contract_address);
    id
}

/// Mirrors what the privacy pool does: move the lot value to the venue, then
/// call `privacy_invoke` as the pool.
fn join(env: Env, batch_id: u64, lots: u8, secret: felt252) -> felt252 {
    let amount: u256 = (LOT * lots.into()).into();
    env.token_in.mint(env.venue_addr, amount);

    let commitment = order_commitment(batch_id, secret);
    start_cheat_caller_address(env.venue_addr, pool());
    env.venue.privacy_invoke(Operation::Join, batch_id, lots, commitment, 0, 0);
    stop_cheat_caller_address(env.venue_addr);
    commitment
}

fn redeem(env: Env, op: Operation, batch_id: u64, secret: felt252) {
    start_cheat_caller_address(env.venue_addr, pool());
    env.venue.privacy_invoke(op, batch_id, 0, 0, secret, 'NOTE');
    stop_cheat_caller_address(env.venue_addr);
}

fn settle(env: Env, batch_id: u64) {
    start_cheat_block_timestamp_global(SEALS_AT);
    start_cheat_caller_address(env.venue_addr, STRANGER.try_into().unwrap());
    env.venue.settle(batch_id, 0, 0);
    stop_cheat_caller_address(env.venue_addr);
}

// --- scheduling -------------------------------------------------------------

#[test]
fn create_batch_records_route_and_derives_output_token() {
    let env = setup();
    let id = create_batch(env, 3, 0);

    let batch = env.venue.get_batch(id);
    assert(id == 1, 'first id is 1');
    assert(batch.state == BatchState::Open, 'open');
    assert(batch.token_in == env.token_in.contract_address, 'token_in');
    assert(batch.token_out == env.token_out.contract_address, 'token_out derived');
    assert(batch.lot_size == LOT, 'lot size');
    assert(env.venue.next_batch_id() == 2, 'id advanced');
}

#[test]
#[should_panic(expected: 'CONVOY_NOT_OWNER')]
fn create_batch_rejects_non_owner() {
    let env = setup();
    start_cheat_caller_address(env.venue_addr, STRANGER.try_into().unwrap());
    env
        .venue
        .create_batch(
            env.route, env.token_in.contract_address, LOT, 4, 3, OPENS_AT, SEALS_AT, 0,
        );
}

#[test]
#[should_panic(expected: 'CONVOY_BAD_TOKEN')]
fn create_batch_rejects_token_outside_route() {
    let env = setup();
    start_cheat_caller_address(env.venue_addr, owner());
    env
        .venue
        .create_batch(env.route, env.venue_addr, LOT, 4, 3, OPENS_AT, SEALS_AT, 0);
}

#[test]
#[should_panic(expected: 'CONVOY_BAD_MAX_LOTS')]
fn create_batch_rejects_lot_ceiling_breach() {
    let env = setup();
    start_cheat_caller_address(env.venue_addr, owner());
    env
        .venue
        .create_batch(
            env.route, env.token_in.contract_address, LOT, 9, 3, OPENS_AT, SEALS_AT, 0,
        );
}

#[test]
#[should_panic(expected: 'CONVOY_BAD_WINDOW')]
fn create_batch_rejects_inverted_window() {
    let env = setup();
    start_cheat_caller_address(env.venue_addr, owner());
    env
        .venue
        .create_batch(
            env.route, env.token_in.contract_address, LOT, 4, 3, SEALS_AT, OPENS_AT, 0,
        );
}

// --- joining ----------------------------------------------------------------

#[test]
#[should_panic(expected: 'CONVOY_NOT_POOL')]
fn join_rejects_direct_caller() {
    let env = setup();
    let id = create_batch(env, 3, 0);
    start_cheat_caller_address(env.venue_addr, STRANGER.try_into().unwrap());
    env.venue.privacy_invoke(Operation::Join, id, 1, 'CMT', 0, 0);
}

#[test]
fn join_credits_accounting_and_tallies() {
    let env = setup();
    let id = create_batch(env, 1, 0);

    join(env, id, 2, 'alpha');
    join(env, id, 1, 'beta');

    let batch = env.venue.get_batch(id);
    assert(batch.order_count == 2, 'two orders');
    assert(batch.total_lots == 3, 'three lots');
    assert(batch.gross_in == LOT * 3, 'gross');
    assert(env.venue.get_accounted(env.token_in.contract_address) == LOT * 3, 'accounted');

    let order = env.venue.get_order(order_commitment(id, 'alpha'));
    assert(order.lots == 2, 'lots stored');
    assert(!order.redeemed, 'not redeemed');
}

#[test]
#[should_panic(expected: 'CONVOY_CMT_EXISTS')]
fn join_rejects_reused_commitment() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'same');
    join(env, id, 1, 'same');
}

#[test]
#[should_panic(expected: 'CONVOY_UNDERFUNDED')]
fn join_rejects_when_pool_underdelivers() {
    let env = setup();
    let id = create_batch(env, 1, 0);

    // One lot delivered, two claimed.
    env.token_in.mint(env.venue_addr, LOT.into());
    start_cheat_caller_address(env.venue_addr, pool());
    env.venue.privacy_invoke(Operation::Join, id, 2, 'x', 0, 0);
}

#[test]
fn join_ignores_donated_surplus() {
    let env = setup();
    let id = create_batch(env, 1, 0);

    // A stray transfer must not be creditable, and must not brick joins.
    env.token_in.mint(env.venue_addr, (LOT * 5).into());
    join(env, id, 1, 'only');

    assert(env.venue.get_accounted(env.token_in.contract_address) == LOT, 'only own lot');
}

#[test]
#[should_panic(expected: 'CONVOY_TOO_MANY_LOTS')]
fn join_rejects_lots_above_batch_ceiling() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 5, 'big');
}

#[test]
#[should_panic(expected: 'CONVOY_ALREADY_SEALED')]
fn join_rejects_after_seal() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    start_cheat_block_timestamp_global(SEALS_AT);
    join(env, id, 1, 'late');
}

#[test]
#[should_panic(expected: 'CONVOY_JOINS_PAUSED')]
fn join_rejects_while_paused() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    start_cheat_caller_address(env.venue_addr, owner());
    env.venue.set_joins_paused(true);
    stop_cheat_caller_address(env.venue_addr);
    join(env, id, 1, 'nope');
}

// --- settlement -------------------------------------------------------------

#[test]
#[should_panic(expected: 'CONVOY_NOT_SEALED')]
fn settle_rejects_before_seal() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    env.venue.settle(id, 0, 0);
}

#[test]
#[should_panic(expected: 'CONVOY_TOO_FEW_ORDERS')]
fn settle_rejects_thin_crossing() {
    let env = setup();
    let id = create_batch(env, 3, 0);
    join(env, id, 1, 'a');
    join(env, id, 1, 'b');
    settle(env, id);
}

#[test]
fn settle_executes_one_aggregate_leg() {
    let env = setup();
    let id = create_batch(env, 2, 0);
    join(env, id, 2, 'a');
    join(env, id, 1, 'b');

    // 2 output per 1 input.
    env.router_admin.set_rate(2, 1);
    env.token_out.mint(env.router_addr, (LOT * 100).into());

    settle(env, id);

    let batch = env.venue.get_batch(id);
    assert(batch.state == BatchState::Settled, 'settled');
    assert(batch.net_out == LOT * 6, 'net out');
    assert(env.venue.get_accounted(env.token_in.contract_address) == 0, 'input spent');
    assert(env.venue.get_accounted(env.token_out.contract_address) == LOT * 6, 'output held');
}

#[test]
#[should_panic(expected: 'CONVOY_IN_NOT_CLEARED')]
fn settle_rejects_partial_fill() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 2, 'a');

    env.router_admin.set_rate(1, 1);
    env.router_admin.set_leftover(LOT);
    env.token_out.mint(env.router_addr, (LOT * 100).into());

    settle(env, id);
}

#[test]
#[should_panic(expected: 'CLEAR_AT_LEAST_MINIMUM')]
fn settle_rejects_output_below_stored_floor() {
    let env = setup();
    // Demands 2 output per lot, router only pays 1.
    let id = create_batch(env, 1, LOT * 2);
    join(env, id, 1, 'a');

    env.router_admin.set_rate(1, 1);
    env.token_out.mint(env.router_addr, (LOT * 100).into());

    settle(env, id);
}

// --- redemption -------------------------------------------------------------

#[test]
fn claim_pays_pro_rata_share() {
    let env = setup();
    let id = create_batch(env, 2, 0);
    join(env, id, 3, 'a');
    join(env, id, 1, 'b');

    env.router_admin.set_rate(2, 1);
    env.token_out.mint(env.router_addr, (LOT * 100).into());
    settle(env, id);

    // net_out is 8 LOT across 4 lots.
    assert(env.venue.quote_redemption(id, 3) == LOT * 6, 'three lots');
    assert(env.venue.quote_redemption(id, 1) == LOT * 2, 'one lot');

    redeem(env, Operation::Claim, id, 'a');

    let order = env.venue.get_order(order_commitment(id, 'a'));
    assert(order.redeemed, 'marked redeemed');
    assert(env.venue.get_accounted(env.token_out.contract_address) == LOT * 2, 'remainder');
    assert(
        env.token_out.allowance(env.venue_addr, pool()) == (LOT * 6).into(), 'exact allowance',
    );
}

#[test]
#[should_panic(expected: 'CONVOY_REDEEMED')]
fn claim_rejects_second_redemption() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    env.router_admin.set_rate(1, 1);
    env.token_out.mint(env.router_addr, (LOT * 10).into());
    settle(env, id);

    redeem(env, Operation::Claim, id, 'a');
    redeem(env, Operation::Claim, id, 'a');
}

#[test]
#[should_panic(expected: 'CONVOY_NO_ORDER')]
fn claim_rejects_unknown_secret() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    env.router_admin.set_rate(1, 1);
    env.token_out.mint(env.router_addr, (LOT * 10).into());
    settle(env, id);

    redeem(env, Operation::Claim, id, 'wrong');
}

#[test]
#[should_panic(expected: 'CONVOY_BATCH_NOT_SETTLED')]
fn claim_rejects_before_settlement() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    redeem(env, Operation::Claim, id, 'a');
}

// --- voiding and refunds ----------------------------------------------------

#[test]
fn thin_batch_voids_and_refunds_one_for_one() {
    let env = setup();
    let id = create_batch(env, 5, 0);
    join(env, id, 2, 'a');

    start_cheat_block_timestamp_global(SEALS_AT);
    env.venue.void_batch(id);

    assert(env.venue.get_batch(id).state == BatchState::Voided, 'voided');
    assert(env.venue.quote_redemption(id, 2) == LOT * 2, 'refund is face value');

    redeem(env, Operation::Refund, id, 'a');
    assert(env.venue.get_accounted(env.token_in.contract_address) == 0, 'drained');
    assert(env.token_in.allowance(env.venue_addr, pool()) == (LOT * 2).into(), 'allowance');
}

#[test]
#[should_panic(expected: 'CONVOY_GRACE_PENDING')]
fn healthy_batch_cannot_be_voided_before_grace() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    start_cheat_block_timestamp_global(SEALS_AT);
    env.venue.void_batch(id);
}

#[test]
fn stuck_batch_becomes_voidable_after_grace() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');

    start_cheat_block_timestamp_global(SEALS_AT + GRACE);
    env.venue.void_batch(id);

    assert(env.venue.get_batch(id).state == BatchState::Voided, 'voided after grace');
    redeem(env, Operation::Refund, id, 'a');
}

#[test]
#[should_panic(expected: 'CONVOY_BATCH_NOT_VOIDED')]
fn refund_rejects_settled_batch() {
    let env = setup();
    let id = create_batch(env, 1, 0);
    join(env, id, 1, 'a');
    env.router_admin.set_rate(1, 1);
    env.token_out.mint(env.router_addr, (LOT * 10).into());
    settle(env, id);

    redeem(env, Operation::Refund, id, 'a');
}

// --- properties -------------------------------------------------------------

/// The sum of what every order can redeem must never exceed what the aggregate
/// swap actually returned. Rounding must always fall in the venue's favour.
#[test]
#[fuzzer(runs: 128)]
fn redemptions_never_exceed_realised_output(lots_a: u8, lots_b: u8, rate_num: u8) {
    let lots_a = (lots_a % 4) + 1;
    let lots_b = (lots_b % 4) + 1;
    let rate_num: u128 = (rate_num % 32).into() + 1;

    let env = setup();
    let id = create_batch(env, 2, 0);
    join(env, id, lots_a, 'a');
    join(env, id, lots_b, 'b');

    // A deliberately awkward denominator to force truncation.
    env.router_admin.set_rate(rate_num, 7);
    env.token_out.mint(env.router_addr, (LOT * 10_000).into());
    settle(env, id);

    let batch = env.venue.get_batch(id);
    let share_a = env.venue.quote_redemption(id, lots_a);
    let share_b = env.venue.quote_redemption(id, lots_b);

    assert(share_a + share_b <= batch.net_out, 'no over-redemption');
}

/// Two orders of equal size in the same batch must always redeem identically.
/// If they did not, size alone would leak ordering.
#[test]
#[fuzzer(runs: 64)]
fn equal_orders_redeem_equally(lots: u8, rate_num: u8) {
    let lots = (lots % 4) + 1;
    let rate_num: u128 = (rate_num % 32).into() + 1;

    let env = setup();
    let id = create_batch(env, 2, 0);
    join(env, id, lots, 'a');
    join(env, id, lots, 'b');

    env.router_admin.set_rate(rate_num, 3);
    env.token_out.mint(env.router_addr, (LOT * 10_000).into());
    settle(env, id);

    redeem(env, Operation::Claim, id, 'a');
    redeem(env, Operation::Claim, id, 'b');

    let batch = env.venue.get_batch(id);
    let each = env.venue.quote_redemption(id, lots);
    assert(each * 2 <= batch.net_out, 'symmetric and covered');
}
