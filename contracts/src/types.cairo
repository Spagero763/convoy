//! Storage shapes, calldata enums and the commitment scheme.

use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;
use crate::external::PoolKey;

/// Domain separator for order commitments. Bumping the suffix invalidates every
/// commitment computed under the previous scheme, so it changes only alongside a
/// redeploy.
pub const ORDER_TAG: felt252 = 'CONVOY_ORDER:V1';

/// Upper bound on `lots` for any batch. A batch may choose a lower ceiling, but
/// never a higher one: the whole point of lot quantisation is that the set of
/// distinguishable order sizes stays small.
pub const MAX_LOTS_CEILING: u8 = 8;

/// How long after `seals_at` a batch may sit unsettled before anyone may void it
/// and unlock refunds. Bounds the time deposited value can be stuck if the
/// settlement route stops working.
pub const VOID_GRACE_SECONDS: u64 = 86400;

/// Where a batch is in its lifecycle. Sealing is not a stored state: a batch is
/// sealed exactly when `block_timestamp >= seals_at`.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum BatchState {
    /// No batch with this id.
    #[default]
    None,
    /// Accepting joins until `seals_at`.
    Open,
    /// Aggregate swap executed. Orders claim their pro-rata share of `net_out`.
    Settled,
    /// Terminal failure state. Orders refund their `token_in` one-for-one.
    Voided,
}

/// The operation an inbound `privacy_invoke` is asking for.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum Operation {
    /// Park lot-denominated `token_in` against a commitment. Credits no note.
    Join,
    /// Redeem a settled order for its share of `token_out`. Credits one note.
    Claim,
    /// Redeem a voided order for its original `token_in`. Credits one note.
    Refund,
}

/// A scheduled crossing. `route` is pinned at creation so settlement cannot be
/// steered into a different pool by whoever happens to call `settle`.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Batch {
    pub route: PoolKey,
    pub token_in: ContractAddress,
    pub token_out: ContractAddress,
    /// Indivisible unit of `token_in`, in the token's smallest denomination.
    /// Every order is an integer number of these.
    pub lot_size: u128,
    pub max_lots: u8,
    /// Below this many orders at seal time the batch is voidable rather than
    /// settleable: too few participants for the crossing to hide anyone.
    pub min_orders: u16,
    pub opens_at: u64,
    pub seals_at: u64,
    /// Slippage floor, per lot, fixed at creation. `settle` cannot weaken it.
    pub min_out_per_lot: u128,
    pub state: BatchState,
    pub total_lots: u64,
    pub order_count: u32,
    pub gross_in: u128,
    /// `token_out` actually received by the aggregate swap. Zero until settled.
    pub net_out: u128,
}

/// One parked order, keyed by its commitment.
///
/// Deliberately bearer-form: whoever can produce the preimage may claim. Nothing
/// records who joined, and nothing requires the claimer to be the joiner.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Order {
    pub batch_id: u64,
    pub lots: u8,
    pub redeemed: bool,
}

/// `poseidon(ORDER_TAG, batch_id, secret)`.
///
/// The batch id is bound into the preimage so the same secret used against two
/// batches yields two unrelated commitments.
pub fn order_commitment(batch_id: u64, secret: felt252) -> felt252 {
    poseidon_hash_span([ORDER_TAG, batch_id.into(), secret].span())
}

pub mod errors {
    pub const NOT_POOL: felt252 = 'CONVOY_NOT_POOL';
    pub const NOT_OWNER: felt252 = 'CONVOY_NOT_OWNER';
    pub const REENTRANT: felt252 = 'CONVOY_REENTRANT';
    pub const JOINS_PAUSED: felt252 = 'CONVOY_JOINS_PAUSED';

    pub const BATCH_EXISTS: felt252 = 'CONVOY_BATCH_EXISTS';
    pub const NO_BATCH: felt252 = 'CONVOY_NO_BATCH';
    pub const BATCH_NOT_OPEN: felt252 = 'CONVOY_BATCH_NOT_OPEN';
    pub const BATCH_NOT_SETTLED: felt252 = 'CONVOY_BATCH_NOT_SETTLED';
    pub const BATCH_NOT_VOIDED: felt252 = 'CONVOY_BATCH_NOT_VOIDED';
    pub const NOT_YET_OPEN: felt252 = 'CONVOY_NOT_YET_OPEN';
    pub const ALREADY_SEALED: felt252 = 'CONVOY_ALREADY_SEALED';
    pub const NOT_SEALED: felt252 = 'CONVOY_NOT_SEALED';
    pub const GRACE_NOT_ELAPSED: felt252 = 'CONVOY_GRACE_PENDING';

    pub const BAD_WINDOW: felt252 = 'CONVOY_BAD_WINDOW';
    pub const BAD_LOT_SIZE: felt252 = 'CONVOY_BAD_LOT_SIZE';
    pub const BAD_MAX_LOTS: felt252 = 'CONVOY_BAD_MAX_LOTS';
    pub const BAD_MIN_ORDERS: felt252 = 'CONVOY_BAD_MIN_ORDERS';
    pub const BAD_ROUTE: felt252 = 'CONVOY_BAD_ROUTE';
    pub const BAD_TOKEN: felt252 = 'CONVOY_BAD_TOKEN';

    pub const ZERO_LOTS: felt252 = 'CONVOY_ZERO_LOTS';
    pub const TOO_MANY_LOTS: felt252 = 'CONVOY_TOO_MANY_LOTS';
    pub const ZERO_COMMITMENT: felt252 = 'CONVOY_ZERO_COMMITMENT';
    pub const COMMITMENT_EXISTS: felt252 = 'CONVOY_CMT_EXISTS';
    pub const NO_ORDER: felt252 = 'CONVOY_NO_ORDER';
    pub const ALREADY_REDEEMED: felt252 = 'CONVOY_REDEEMED';
    pub const UNDERFUNDED: felt252 = 'CONVOY_UNDERFUNDED';

    pub const NO_ORDERS: felt252 = 'CONVOY_NO_ORDERS';
    pub const TOO_FEW_ORDERS: felt252 = 'CONVOY_TOO_FEW_ORDERS';
    pub const INPUT_NOT_CLEARED: felt252 = 'CONVOY_IN_NOT_CLEARED';
    pub const ZERO_OUTPUT: felt252 = 'CONVOY_ZERO_OUTPUT';
    pub const OVERFLOW: felt252 = 'CONVOY_OVERFLOW';
}
