//! Local declarations of the external surfaces Convoy talks to.
//!
//! Every struct here is Serde-compatible, field for field, with the upstream
//! definition it mirrors. Declaring them locally keeps the build free of git
//! dependencies whose revisions we do not control; the trade-off is that these
//! layouts are load-bearing and must not be reordered.
//!
//! Sources:
//!   - `OpenNoteDeposit`  -> `privacy::objects::OpenNoteDeposit`
//!     (starkware-libs/starknet-privacy, packages/privacy/src/objects.cairo)
//!   - `i129`, `Delta`, `PoolKey`, `RouteNode`, `TokenAmount`, `IRouter`, `IClear`
//!     -> EkuboProtocol/starknet-contracts @ 8b4de8b5

use starknet::ContractAddress;

/// Instruction returned to the privacy pool telling it to credit `amount` of
/// `token` into the open note `note_id`. The pool pulls the tokens with the
/// allowance the anonymizer granted it during the same call.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Signed 129-bit integer: 1 sign bit, 128 magnitude bits.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
pub struct i129 {
    pub mag: u128,
    pub sign: bool,
}

/// Balance change from the perspective of Ekubo core.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
pub struct Delta {
    pub amount0: i129,
    pub amount1: i129,
}

/// Uniquely identifies an Ekubo pool. `token0` is the numerically smaller
/// address. `fee` is a 0.128 fixed-point fraction, so 1% is `2**128 / 100`.
///
/// Carries `starknet::Store` in addition to the upstream derives so a batch can
/// pin its route at creation. The extra derive does not affect Serde layout.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct PoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

#[derive(Serde, Copy, Drop)]
pub struct RouteNode {
    pub pool_key: PoolKey,
    pub sqrt_ratio_limit: u256,
    pub skip_ahead: u128,
}

#[derive(Serde, Copy, Drop)]
pub struct TokenAmount {
    pub token: ContractAddress,
    pub amount: i129,
}

#[starknet::interface]
pub trait IRouter<T> {
    /// Swaps tokens already held by the router against a single pool, keeping
    /// the output on the router until it is cleared.
    fn swap(ref self: T, node: RouteNode, token_amount: TokenAmount) -> Delta;
}

/// Ekubo's clearing surface. The upstream signature types `token` as an
/// `IERC20Dispatcher`, which serialises to a bare contract address.
#[starknet::interface]
pub trait IClear<T> {
    /// Sends the router's whole balance of `token` to the caller.
    fn clear(self: @T, token: ContractAddress) -> u256;
    /// As `clear`, but reverts unless the balance is at least `minimum`.
    fn clear_minimum(self: @T, token: ContractAddress, minimum: u256) -> u256;
}

#[starknet::interface]
pub trait IERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}
