# Threat model

What Convoy defends against, what it does not, and who can do what.

## Assets

| Asset | Where it lives |
|---|---|
| Parked order value | The venue contract, between join and settlement |
| Realised swap output | The venue contract, between settlement and redemption |
| Order keys | Derived from a wallet signature in the browser, never transmitted or stored |
| Unlinkability of participant to order | The STRK20 pool, plus lot quantisation and aggregation |

## Trust boundaries

```
  user's wallet ─┬─ signs a SNIP-12 message to derive an order key (never leaves the browser)
                 └─ signs two STRK20 actions per private operation

  STRK20 pool ───── the only caller the venue accepts on privacy_invoke

  Ekubo router ──── pinned per batch at creation, not chosen at settlement

  venue owner ───── can schedule batches and pause joins. Nothing else.

  settle caller ─── anyone. Cannot influence the outcome.
```

## Adversaries

### A chain observer trying to deanonymise a participant

**Has:** every transaction, every event, perfect timing, unlimited retention.

**Sees:** the shield (address, token, amount), each order's lot count, the
aggregate swap, and each redemption's amount.

**Cannot see:** which address placed which order, whether two orders share an
owner, or which wallet a redemption credited.

**Residual risk, stated plainly:**

- *Deposit correlation.* Shielding an unusual amount and immediately committing
  all of it links the deposit to the batch circumstantially. Lot quantisation
  fixes the order leg; it cannot fix a deposit made ten seconds earlier.
  Mitigation is behavioural: shield round amounts, ahead of time.
- *Set of one.* A batch below `min_orders` cannot cross, so it voids. But a batch
  that meets the minimum with the viewer's order as the only leg of its size is
  still weak, and the board says so rather than implying safety.
- *Habit.* Joining every batch at the same size at the same hour is a pattern,
  and patterns survive quantisation.
- *Join-to-redemption pairing.* Redeeming reveals the key whose hash is the
  commitment, so the two events can be paired. Neither carries an address, and
  orders are bearer instruments, so this does not establish a person, only that
  a redemption discharged a particular order.

### An attacker trying to steal parked value

| Attempt | Outcome |
|---|---|
| Call `privacy_invoke` directly | `CONVOY_NOT_POOL` |
| Claim more lots than were funded | Join credits the measured ERC-20 delta, not the declared amount. `CONVOY_UNDERFUNDED` |
| Forge an order key | Commitments are `poseidon(tag, batch_id, secret)`. Redemption recomputes from the secret |
| Redeem twice | `CONVOY_REDEEMED`, set before any external call |
| Redeem another batch's order | The batch id is bound into the commitment preimage |
| Drain via rounding | Pro rata rounds down. The sum of redemptions is provably at most `net_out` (fuzzed) |
| Reenter through an ERC-20 callback | Reentrancy guard, plus state written before every external call |
| Redirect settlement to a pool they control | The route is pinned at creation. `settle` accepts only `sqrt_ratio_limit` and `skip_ahead` |
| Settle at a terrible price | `min_out_per_lot` is stored at creation and cannot be weakened. Ekubo's `clear_minimum` reverts below it |
| Force a partial fill to strand orders | Input remaining on the router trips `INPUT_NOT_CLEARED` and the settlement reverts atomically |
| Inflate a batch by donating tokens | Surplus above the expected lot value is tolerated but never credited to a commitment |
| Grief joins by donating tokens | The check is `delta >= expected`, not equality, so a donation cannot make joins revert |

### A malicious or compromised owner

The owner key can:

- schedule batches with parameters of its choosing
- pause new joins

The owner key **cannot**:

- move, withdraw or redirect any deposited value
- change a batch's route or slippage floor after creation
- prevent settlement, which is permissionless
- prevent redemption or refund, which are gated only by batch state
- upgrade the contract, which has no proxy and no upgrade entrypoint

The realistic owner attack is scheduling a batch with a hostile route or a
useless floor. That is visible before anyone joins: the route and floor are in
`get_batch` and on the board, and a batch nobody joins settles nothing. Use a
multisig for `VENUE_OWNER` on any deployment that matters.

### A hostile `settle` caller

Settlement is permissionless by design, so liveness does not depend on the
operator. The caller supplies `sqrt_ratio_limit` and `skip_ahead`, which are
routing hints. Neither can change the outcome:

- The pool key comes from storage.
- A limit that stops the swap short leaves input on the router and reverts.
- Output below the stored floor reverts inside Ekubo.

A hostile caller can waste their own gas on a reverting transaction. That is the
whole attack surface.

## Liveness

| Failure | Recovery |
|---|---|
| Operator disappears after scheduling | `settle` is permissionless. Anyone crosses the batch |
| Settlement route stops working | After `VOID_GRACE_SECONDS` (24h) past seal, anyone voids. Every order refunds one for one |
| Batch draws too few orders | Voidable immediately at seal. Refunds unlock |
| A single order never redeems | Its value stays in the contract, redeemable forever. It does not block anyone else |

There is no state in which deposited value is unreachable by its owner while the
chain is live.

## Cryptographic assumptions

- **Poseidon preimage resistance** for order commitments. Domain-separated with
  `CONVOY_ORDER:V1` and bound to the batch id.
- **Signature determinism** for key derivation. The order key is
  `poseidon(r, s)` over a SNIP-12 typed message, the same construction the pool
  uses for viewing keys. A wallet that randomises `k` would derive a different
  key on each signature. The app checks the derived key reproduces the stored
  commitment before submitting, and offers an exported key as the fallback, so
  the failure is a clear message rather than a lost order.

## Known weaknesses

1. **Not audited.** 28 tests including two fuzzed invariants is coverage, not
   review.
2. **Anonymity depends on participation.** An unused venue provides no privacy.
   This is inherent to every mixing construction and cannot be engineered away.
3. **Lot counts are public.** Mitigated by quantisation and a low ceiling, not
   eliminated. A batch where one order is eight lots and the rest are one has a
   distinctive leg, and the board says so.
4. **Batching costs immediacy.** Your order executes when the batch crosses, at
   whatever the aggregate achieves above the floor. This is the trade being made.
5. **Front-running the aggregate swap.** The settlement leg is an ordinary public
   swap and can be sandwiched like any other. `min_out_per_lot` bounds the loss;
   it does not prevent the attempt. A batch large enough to be worth attacking is
   also large enough that the floor should be set deliberately rather than at
   zero.
