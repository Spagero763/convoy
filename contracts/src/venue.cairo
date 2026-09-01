//! Convoy: a fixed-lot batch execution venue for the STRK20 privacy pool.
//!
//! # Why this exists
//!
//! The pool hides *who*. It does not hide *how much* or *when*: deposits carry a
//! public address and amount, and a private swap's public leg carries the amount
//! and the timing. StarkWare's own integration notes say so plainly: "a
//! distinctive amount executed shortly after a distinctive deposit is
//! correlatable". A user executing alone re-links themselves through the amount
//! even though the pool never revealed their identity.
//!
//! Convoy removes both handles by never letting anyone execute alone:
//!
//! 1. **Fixed lots.** Orders are integer multiples of one `lot_size`, so every
//!    inbound leg is drawn from a set of at most `max_lots` distinguishable
//!    sizes rather than being a unique fingerprint.
//! 2. **Aggregate settlement.** Every order in a batch leaves as a single swap
//!    at a single clearing rate, so timing and size stop resolving to a person.
//! 3. **Deferred bearer claim.** Output is redeemed later, into a fresh note,
//!    by whoever holds the order secret.
//!
//! # Trust model
//!
//! The owner schedules batches and can pause new joins. The owner **cannot**
//! move deposited value, redirect settlement, weaken a slippage floor, or block
//! a redemption: `route` and `min_out_per_lot` are pinned when the batch is
//! created, and pausing gates `Join` only. If settlement never happens, anyone
//! may void the batch `VOID_GRACE_SECONDS` after it seals, which unlocks
//! one-for-one refunds.
//!
//! `settle` is permissionless and takes routing hints from an untrusted caller.
//! That is safe because the caller cannot influence the outcome: the pool is
//! pinned in storage, a partial fill trips `INPUT_NOT_CLEARED`, and the output
//! must clear the stored `min_out_per_lot` floor. A hostile caller can waste
//! their own gas on a reverting transaction and nothing else.
//!
//! # What is and is not hidden
//!
//! Public: that a batch received N orders and each leg's lot count; the
//! aggregate swap's size, rate and timing; that a redemption occurred.
//! Hidden: which address joined, whether two orders share an owner, and which
//! join a redemption corresponds to. Orders are bearer instruments, so even the
//! commitment-to-secret link does not establish that one person did both.
//! Shielding into the pool remains public, as it always is on STRK20.

use starknet::ContractAddress;
use crate::external::{OpenNoteDeposit, PoolKey};
use crate::types::{Batch, Operation, Order};

#[starknet::interface]
pub trait IConvoyVenue<T> {
    /// Called by the privacy pool through the `privacy_invoke` selector, from
    /// inside a proved private transaction.
    ///
    /// Dispatches on `operation`:
    ///
    /// **Join**. The pool has already withdrawn `lots * lot_size` of the
    /// batch's `token_in` to this contract. Records `commitment` against the
    /// batch and returns an empty span, so the value parks here rather than
    /// being credited back to a note. `secret` and `note_id` are ignored.
    ///
    /// **Claim**. For a settled batch. Recomputes the commitment from
    /// `batch_id` and `secret`, marks the order redeemed, and returns a deposit
    /// instruction for its pro-rata share of the batch's realised output.
    /// `lots` and `commitment` are ignored.
    ///
    /// **Refund**. For a voided batch. As `Claim`, but returns the order's
    /// original `token_in` one for one.
    fn privacy_invoke(
        ref self: T,
        operation: Operation,
        batch_id: u64,
        lots: u8,
        commitment: felt252,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Executes the aggregate swap for a sealed batch. Permissionless.
    ///
    /// `sqrt_ratio_limit` and `skip_ahead` are routing hints only. A limit that
    /// stops the swap short leaves input on the router and reverts; an output
    /// below the batch's stored floor reverts in Ekubo's `clear_minimum`.
    fn settle(ref self: T, batch_id: u64, sqrt_ratio_limit: u256, skip_ahead: u128);

    /// Moves a sealed batch to `Voided`, unlocking refunds. Permissionless, and
    /// allowed when the batch drew fewer than `min_orders` orders, or once
    /// `VOID_GRACE_SECONDS` have passed since it sealed without settlement.
    fn void_batch(ref self: T, batch_id: u64);

    /// Schedules a batch and returns its id. Owner only.
    fn create_batch(
        ref self: T,
        route: PoolKey,
        token_in: ContractAddress,
        lot_size: u128,
        max_lots: u8,
        min_orders: u16,
        opens_at: u64,
        seals_at: u64,
        min_out_per_lot: u128,
    ) -> u64;

    fn set_joins_paused(ref self: T, paused: bool);
    fn transfer_ownership(ref self: T, new_owner: ContractAddress);

    fn get_batch(self: @T, batch_id: u64) -> Batch;
    fn get_order(self: @T, commitment: felt252) -> Order;
    /// Output a `lots`-sized order in `batch_id` would redeem for right now.
    fn quote_redemption(self: @T, batch_id: u64, lots: u8) -> u128;
    /// Value this contract considers spoken for, per token. Anything the ERC-20
    /// holds beyond this was donated and is not redeemable.
    fn get_accounted(self: @T, token: ContractAddress) -> u128;
    fn privacy_pool(self: @T) -> ContractAddress;
    fn router(self: @T) -> ContractAddress;
    fn owner(self: @T) -> ContractAddress;
    fn next_batch_id(self: @T) -> u64;
    fn joins_paused(self: @T) -> bool;
}

#[starknet::contract]
pub mod ConvoyVenue {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use crate::external::{
        IClearDispatcher, IClearDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
        IRouterDispatcher, IRouterDispatcherTrait, OpenNoteDeposit, PoolKey, RouteNode, TokenAmount,
        i129,
    };
    use crate::types::{
        Batch, BatchState, MAX_LOTS_CEILING, Operation, Order, VOID_GRACE_SECONDS, errors,
        order_commitment,
    };
    use super::IConvoyVenue;

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        router: ContractAddress,
        owner: ContractAddress,
        joins_paused: bool,
        entered: bool,
        next_batch_id: u64,
        batches: Map<u64, Batch>,
        orders: Map<felt252, Order>,
        accounted: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BatchCreated: BatchCreated,
        OrderJoined: OrderJoined,
        BatchSettled: BatchSettled,
        BatchVoided: BatchVoided,
        OrderRedeemed: OrderRedeemed,
        JoinsPausedSet: JoinsPausedSet,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BatchCreated {
        #[key]
        pub batch_id: u64,
        pub token_in: ContractAddress,
        pub token_out: ContractAddress,
        pub lot_size: u128,
        pub max_lots: u8,
        pub min_orders: u16,
        pub opens_at: u64,
        pub seals_at: u64,
        pub min_out_per_lot: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderJoined {
        #[key]
        pub batch_id: u64,
        #[key]
        pub commitment: felt252,
        pub lots: u8,
        pub order_count: u32,
        pub total_lots: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BatchSettled {
        #[key]
        pub batch_id: u64,
        pub gross_in: u128,
        pub net_out: u128,
        pub total_lots: u64,
        pub order_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BatchVoided {
        #[key]
        pub batch_id: u64,
        pub order_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrderRedeemed {
        #[key]
        pub batch_id: u64,
        #[key]
        pub commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub refunded: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct JoinsPausedSet {
        pub paused: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_pool: ContractAddress,
        router: ContractAddress,
        owner: ContractAddress,
    ) {
        assert(privacy_pool.is_non_zero(), errors::BAD_TOKEN);
        assert(router.is_non_zero(), errors::BAD_ROUTE);
        assert(owner.is_non_zero(), errors::NOT_OWNER);
        self.privacy_pool.write(privacy_pool);
        self.router.write(router);
        self.owner.write(owner);
        self.next_batch_id.write(1);
    }

    #[abi(embed_v0)]
    pub impl ConvoyVenueImpl of IConvoyVenue<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: Operation,
            batch_id: u64,
            lots: u8,
            commitment: felt252,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.privacy_pool.read();
            assert(get_caller_address() == pool, errors::NOT_POOL);
            self.lock();

            let result = match operation {
                Operation::Join => {
                    self.do_join(batch_id, lots, commitment);
                    [].span()
                },
                Operation::Claim => self.do_redeem(batch_id, secret, note_id, pool, false),
                Operation::Refund => self.do_redeem(batch_id, secret, note_id, pool, true),
            };

            self.unlock();
            result
        }

        fn settle(ref self: ContractState, batch_id: u64, sqrt_ratio_limit: u256, skip_ahead: u128) {
            self.lock();

            let mut batch = self.batches.read(batch_id);
            assert(batch.state == BatchState::Open, errors::BATCH_NOT_OPEN);
            assert(get_block_timestamp() >= batch.seals_at, errors::NOT_SEALED);
            assert(batch.order_count.is_non_zero(), errors::NO_ORDERS);
            let min_orders: u32 = batch.min_orders.into();
            assert(batch.order_count >= min_orders, errors::TOO_FEW_ORDERS);

            let net_out = self
                .execute_aggregate_swap(@batch, sqrt_ratio_limit, skip_ahead);

            // The whole parked position leaves as one leg; what comes back is
            // held against the batch until orders redeem it.
            self.debit(batch.token_in, batch.gross_in);
            self.credit(batch.token_out, net_out);

            batch.net_out = net_out;
            batch.state = BatchState::Settled;
            self.batches.write(batch_id, batch);

            self
                .emit(
                    BatchSettled {
                        batch_id,
                        gross_in: batch.gross_in,
                        net_out,
                        total_lots: batch.total_lots,
                        order_count: batch.order_count,
                    },
                );

            self.unlock();
        }

        fn void_batch(ref self: ContractState, batch_id: u64) {
            let mut batch = self.batches.read(batch_id);
            assert(batch.state == BatchState::Open, errors::BATCH_NOT_OPEN);

            let now = get_block_timestamp();
            assert(now >= batch.seals_at, errors::NOT_SEALED);

            // Either the crossing was too thin to hide anyone, or settlement has
            // had its window and did not happen.
            let min_orders: u32 = batch.min_orders.into();
            let too_thin = batch.order_count < min_orders;
            if !too_thin {
                assert(now >= batch.seals_at + VOID_GRACE_SECONDS, errors::GRACE_NOT_ELAPSED);
            }

            batch.state = BatchState::Voided;
            self.batches.write(batch_id, batch);
            self.emit(BatchVoided { batch_id, order_count: batch.order_count });
        }

        fn create_batch(
            ref self: ContractState,
            route: PoolKey,
            token_in: ContractAddress,
            lot_size: u128,
            max_lots: u8,
            min_orders: u16,
            opens_at: u64,
            seals_at: u64,
            min_out_per_lot: u128,
        ) -> u64 {
            self.assert_owner();

            assert(route.token0.is_non_zero(), errors::BAD_ROUTE);
            assert(route.token0 < route.token1, errors::BAD_ROUTE);
            assert(route.tick_spacing.is_non_zero(), errors::BAD_ROUTE);

            let token_out = if token_in == route.token0 {
                route.token1
            } else {
                assert(token_in == route.token1, errors::BAD_TOKEN);
                route.token0
            };

            assert(lot_size.is_non_zero(), errors::BAD_LOT_SIZE);
            assert(max_lots.is_non_zero() && max_lots <= MAX_LOTS_CEILING, errors::BAD_MAX_LOTS);
            assert(min_orders.is_non_zero(), errors::BAD_MIN_ORDERS);
            assert(seals_at > opens_at, errors::BAD_WINDOW);
            assert(seals_at > get_block_timestamp(), errors::BAD_WINDOW);

            let batch_id = self.next_batch_id.read();
            assert(self.batches.read(batch_id).state == BatchState::None, errors::BATCH_EXISTS);

            self
                .batches
                .write(
                    batch_id,
                    Batch {
                        route,
                        token_in,
                        token_out,
                        lot_size,
                        max_lots,
                        min_orders,
                        opens_at,
                        seals_at,
                        min_out_per_lot,
                        state: BatchState::Open,
                        total_lots: 0,
                        order_count: 0,
                        gross_in: 0,
                        net_out: 0,
                    },
                );
            self.next_batch_id.write(batch_id + 1);

            self
                .emit(
                    BatchCreated {
                        batch_id,
                        token_in,
                        token_out,
                        lot_size,
                        max_lots,
                        min_orders,
                        opens_at,
                        seals_at,
                        min_out_per_lot,
                    },
                );
            batch_id
        }

        fn set_joins_paused(ref self: ContractState, paused: bool) {
            self.assert_owner();
            self.joins_paused.write(paused);
            self.emit(JoinsPausedSet { paused });
        }

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self.assert_owner();
            assert(new_owner.is_non_zero(), errors::NOT_OWNER);
            let previous_owner = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnershipTransferred { previous_owner, new_owner });
        }

        fn get_batch(self: @ContractState, batch_id: u64) -> Batch {
            self.batches.read(batch_id)
        }

        fn get_order(self: @ContractState, commitment: felt252) -> Order {
            self.orders.read(commitment)
        }

        fn quote_redemption(self: @ContractState, batch_id: u64, lots: u8) -> u128 {
            let batch = self.batches.read(batch_id);
            match batch.state {
                BatchState::Settled => pro_rata(batch.net_out, lots, batch.total_lots),
                BatchState::Voided => lot_value(batch.lot_size, lots),
                _ => 0,
            }
        }

        fn get_accounted(self: @ContractState, token: ContractAddress) -> u128 {
            self.accounted.read(token)
        }

        fn privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn router(self: @ContractState) -> ContractAddress {
            self.router.read()
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn next_batch_id(self: @ContractState) -> u64 {
            self.next_batch_id.read()
        }

        fn joins_paused(self: @ContractState) -> bool {
            self.joins_paused.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn do_join(ref self: ContractState, batch_id: u64, lots: u8, commitment: felt252) {
            assert(!self.joins_paused.read(), errors::JOINS_PAUSED);
            assert(commitment.is_non_zero(), errors::ZERO_COMMITMENT);

            let mut batch = self.batches.read(batch_id);
            assert(batch.state == BatchState::Open, errors::BATCH_NOT_OPEN);

            let now = get_block_timestamp();
            assert(now >= batch.opens_at, errors::NOT_YET_OPEN);
            assert(now < batch.seals_at, errors::ALREADY_SEALED);

            assert(lots.is_non_zero(), errors::ZERO_LOTS);
            assert(lots <= batch.max_lots, errors::TOO_MANY_LOTS);

            // Every stored order has at least one lot, so a zero here means the
            // commitment is unused.
            assert(self.orders.read(commitment).lots.is_zero(), errors::COMMITMENT_EXISTS);

            let expected = lot_value(batch.lot_size, lots);

            // Trust the measured delta, never the caller's arithmetic. Surplus is
            // tolerated but not credited, so a stray direct transfer cannot brick
            // joins by breaking an equality check.
            let held: u256 = IERC20Dispatcher { contract_address: batch.token_in }
                .balance_of(get_contract_address());
            let held: u128 = held.try_into().expect(errors::OVERFLOW);
            let delta = held - self.accounted.read(batch.token_in);
            assert(delta >= expected, errors::UNDERFUNDED);

            self.credit(batch.token_in, expected);
            self.orders.write(commitment, Order { batch_id, lots, redeemed: false });

            batch.total_lots += lots.into();
            batch.order_count += 1;
            batch.gross_in += expected;
            self.batches.write(batch_id, batch);

            self
                .emit(
                    OrderJoined {
                        batch_id,
                        commitment,
                        lots,
                        order_count: batch.order_count,
                        total_lots: batch.total_lots,
                    },
                );
        }

        fn do_redeem(
            ref self: ContractState,
            batch_id: u64,
            secret: felt252,
            note_id: felt252,
            pool: ContractAddress,
            refunding: bool,
        ) -> Span<OpenNoteDeposit> {
            let commitment = order_commitment(batch_id, secret);
            let mut order = self.orders.read(commitment);
            assert(order.lots.is_non_zero(), errors::NO_ORDER);
            assert(!order.redeemed, errors::ALREADY_REDEEMED);

            let batch = self.batches.read(batch_id);
            let (token, amount) = if refunding {
                assert(batch.state == BatchState::Voided, errors::BATCH_NOT_VOIDED);
                (batch.token_in, lot_value(batch.lot_size, order.lots))
            } else {
                assert(batch.state == BatchState::Settled, errors::BATCH_NOT_SETTLED);
                (batch.token_out, pro_rata(batch.net_out, order.lots, batch.total_lots))
            };
            assert(amount.is_non_zero(), errors::ZERO_OUTPUT);

            order.redeemed = true;
            self.orders.write(commitment, order);
            self.debit(token, amount);

            // The pool pulls this allowance while applying the returned deposit.
            IERC20Dispatcher { contract_address: token }.approve(pool, amount.into());

            self
                .emit(
                    OrderRedeemed {
                        batch_id, commitment, token, amount, refunded: refunding,
                    },
                );

            [OpenNoteDeposit { note_id, token, amount }].span()
        }

        fn execute_aggregate_swap(
            ref self: ContractState, batch: @Batch, sqrt_ratio_limit: u256, skip_ahead: u128,
        ) -> u128 {
            let router_addr = self.router.read();
            let token_in = *batch.token_in;
            let token_out = *batch.token_out;
            let gross_in = *batch.gross_in;

            let minimum_received: u256 = pro_rata_floor(*batch.min_out_per_lot, *batch.total_lots);

            let in_erc20 = IERC20Dispatcher { contract_address: token_in };
            let out_erc20 = IERC20Dispatcher { contract_address: token_out };
            in_erc20.transfer(router_addr, gross_in.into());

            IRouterDispatcher { contract_address: router_addr }
                .swap(
                    RouteNode { pool_key: *batch.route, sqrt_ratio_limit, skip_ahead },
                    TokenAmount { token: token_in, amount: i129 { mag: gross_in, sign: false } },
                );

            let clear = IClearDispatcher { contract_address: router_addr };

            // Anything left on the router means the swap stopped short. A
            // partial fill would settle some orders and strand others at an
            // undefined rate, so it is rejected outright.
            let unswapped = clear.clear(token_in);
            assert(unswapped.is_zero(), errors::INPUT_NOT_CLEARED);

            let before = out_erc20.balance_of(get_contract_address());
            clear.clear_minimum(token_out, minimum_received);
            let after = out_erc20.balance_of(get_contract_address());

            let net_out: u128 = (after - before).try_into().expect(errors::OVERFLOW);
            assert(net_out.is_non_zero(), errors::ZERO_OUTPUT);
            net_out
        }

        fn credit(ref self: ContractState, token: ContractAddress, amount: u128) {
            self.accounted.write(token, self.accounted.read(token) + amount);
        }

        fn debit(ref self: ContractState, token: ContractAddress, amount: u128) {
            self.accounted.write(token, self.accounted.read(token) - amount);
        }

        fn assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
        }

        fn lock(ref self: ContractState) {
            assert(!self.entered.read(), errors::REENTRANT);
            self.entered.write(true);
        }

        fn unlock(ref self: ContractState) {
            self.entered.write(false);
        }
    }

    /// `lot_size * lots`, widened so the multiplication cannot wrap.
    fn lot_value(lot_size: u128, lots: u8) -> u128 {
        let lots: u128 = lots.into();
        let product: u256 = lot_size.into() * lots.into();
        product.try_into().expect(errors::OVERFLOW)
    }

    /// `total * lots / total_lots`, rounded down.
    ///
    /// Rounding down for every order means the sum of redemptions can only fall
    /// short of `total`, never exceed it. The remainder stays in the contract as
    /// dust rather than leaving the last order to redeem unpayable.
    fn pro_rata(total: u128, lots: u8, total_lots: u64) -> u128 {
        if total_lots.is_zero() {
            return 0;
        }
        let lots: u128 = lots.into();
        let numerator: u256 = total.into() * lots.into();
        let share: u256 = numerator / total_lots.into();
        share.try_into().expect(errors::OVERFLOW)
    }

    /// `per_lot * total_lots` as a `u256`, for the slippage floor.
    fn pro_rata_floor(per_lot: u128, total_lots: u64) -> u256 {
        let total_lots: u256 = total_lots.into();
        per_lot.into() * total_lots
    }
}
