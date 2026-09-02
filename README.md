# Convoy

Fixed-lot batch execution on the STRK20 privacy pool.

The pool hides who you are. It does not hide how much, or when. Convoy removes
both handles by never letting anyone execute alone.

---

## The problem

STRK20 gives Starknet real sender privacy. A note-to-note transfer emits an
encrypted note and a nullifier: no amount, no parties. That part works.

Private DeFi is different. Routing through an anonymizer into a public venue
leaves a public leg, and that leg carries the size and the timing. StarkWare's
own integration notes are blunt about it:

> Private DeFi routes through shared anonymizer contracts into public venues, so
> a swap's amounts and timing are visible. The anonymity comes from the shared
> address and the mixing set, not from hiding the amount. A distinctive amount
> executed shortly after a distinctive deposit is correlatable. Claim identity
> privacy; never claim amount privacy for swaps.

So the failure mode is not a broken pool. It is a set of one. Shield 1,337.42
STRK, swap 1,337.42 STRK forty seconds later, and the pool's guarantee has been
undone by arithmetic that anyone can do.

## The mechanism

Three properties, stacked. None is novel alone; together they close the leak.

**1. Fixed lots.** Every order is an integer number of one `lot_size`, capped at
a small ceiling. Lot counts are public, so the design makes them uninformative
instead of pretending they are hidden. A batch has at most `max_lots`
distinguishable order sizes rather than a continuum of fingerprints.

**2. Aggregate settlement.** When a batch seals, every order in it leaves as a
single swap at a single clearing rate. The public leg reveals the sum, and the
sum is not any component. Redemption is pro rata from what that one swap
actually returned, so there is no per-order price to correlate.

**3. Deferred bearer claim.** Output is redeemed later, into a fresh note, by
whoever holds the order key. Orders are bearer instruments: the key can be
handed to anyone, so pairing a join with a redemption does not establish that
one person did both.

## How a batch works

```
  scheduled ──▶ filling ──▶ sealed ──┬──▶ settled ──▶ redeemable
                                     │
                                     └──▶ voided ───▶ refundable
```

| Phase | What happens |
|---|---|
| `filling` | Orders park lot-denominated value against a commitment. No note is credited. |
| `sealed` | The window has closed. No further orders. |
| `settled` | One aggregate swap executed at one rate. Orders claim pro rata. |
| `voided` | The batch drew fewer than `min_orders`, or settlement never happened within the grace window. Every order refunds one for one. |

A batch that cannot hide anyone refuses to execute. That is a privacy guarantee
expressed as a spending rule.

## What is and is not hidden

Overclaiming is the most damaging thing a privacy product can do, because
somebody acts on the claim.

| Public | Hidden |
|---|---|
| The address that shielded into the pool, and how much | Which address placed an order |
| How many lots each order is | Whether two orders belong to the same person |
| The aggregate swap: size, rate, timing | Any individual order's execution price |
| That a redemption happened, and for how much | Who redeemed, and to which wallet |
| That a redemption pairs with a specific join | That the joiner and the redeemer are the same person |

Shielding is a public deposit and the pool screens the depositor. Nothing built
on STRK20 changes that, and Convoy does not claim to.

Honest limits, in full, are in [`/ledger`](app/src/app/ledger/page.tsx) in the
running app and in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Architecture

```
  wallet ──▶ Privacy Wallet API ──▶ STRK20 pool ──▶ ConvoyVenue ──▶ Ekubo
             (Ready, starknet.js v10.4)            (anonymizer)     (router)
```

Convoy is an **anonymizer**: the pool calls it through `privacy_invoke` from
inside a proved private transaction.

Two action shapes, and only one of each works:

```ts
// Park value. Returns an empty span, so nothing is credited back.
[
  { type: "withdraw", token, amount, recipient: VENUE },
  { type: "invoke", contract: VENUE, calldata: [OP_JOIN, batchId, lots, commitment, 0, 0] },
]

// Credit a note. The wallet substitutes ${openNoteIds[0]}.
[
  { type: "transfer", token, amount: "OPEN", recipient: you },
  { type: "invoke", contract: VENUE, calldata: [OP_CLAIM, batchId, 0, 0, secret, "${openNoteIds[0]}"] },
]
```

An `invoke` on its own is rejected by the wallet API with
`INVALID_REQUEST_PAYLOAD` before anything is signed. Two STRK20 actions is the
floor for a private operation, which is why every private action raises two
wallet approvals. That is a property of the wallet API, not something an app can
collapse, and the UI says so before you start rather than letting it read as a
double charge.

### Why the Wallet API and not the SDK

There is no hosted mainnet proving service. Self-hosting the prover wants
roughly 48 vCPU and 96 GB, and the published image fails with `SIGILL` on CPUs
without AVX-512. The SDK route is therefore not reachable for an application
that expects ordinary users. Convoy uses the Privacy Wallet API, where the
user's wallet reaches a prover on its own.

The design never needs `ComputeAndInvoke`, which is absent from the wallet API
and blocks any anonymizer that wants pure in-pool compute.

## Security

The venue is small, non-upgradeable, and has no administrative path to
deposited value.

| Property | How |
|---|---|
| Only the pool can move value through it | `privacy_invoke` asserts `caller == pool` |
| The frontend is never trusted for fund logic | Joins credit the **measured** ERC-20 delta against an internal `accounted` ledger, ignoring the caller's declared amount |
| A stray transfer cannot brick or inflate a batch | Surplus is tolerated but never credited |
| Settlement cannot be steered | `route` and `min_out_per_lot` are pinned at batch creation; `settle` takes only routing hints |
| A partial fill cannot strand orders | Input left on the router trips `INPUT_NOT_CLEARED` and the whole settlement reverts |
| Redemptions cannot exceed what was realised | Pro rata always rounds down; the remainder stays as dust |
| Approvals are exact | Never unlimited, granted per redemption for the exact amount |
| Value cannot be stranded | Anyone may void a batch after the grace window, unlocking refunds |
| Reentrancy | Guard on every value path, checks-effects-interactions throughout |

**The owner can schedule batches and pause new joins. That is the entire list.**
It cannot move value, redirect settlement, weaken a floor, or block a
redemption. Pausing gates joins only, so claims and refunds keep working.

There is no proxy and no upgrade entrypoint. A bug cannot be patched under your
feet, and it also cannot be patched at all. The safety valve is the permissionless
void path rather than an admin key.

**Not audited.** Unit and fuzz coverage is not a substitute for review.

Full analysis: [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Repository

```
contracts/            Cairo. Scarb + Starknet Foundry.
  src/venue.cairo     ConvoyVenue, the anonymizer
  src/types.cairo     Storage shapes and the commitment scheme
  src/external.cairo  Local declarations of pool and Ekubo surfaces
  src/tests/          28 tests including two fuzzed invariants
app/                  Next.js client and deployment scripts
  src/lib/            Wallet, actions, formatting, error translation, motion
  src/app/            Board, claim, disclosure, risk
  scripts/            Reproducible deploy, schedule and settle
docs/                 Threat model and operations
```

## Running it

### Contracts

```bash
cd contracts
scarb build
snforge test
```

Requires Scarb 2.20 and Starknet Foundry 0.63. On Windows, use WSL: Starknet
Foundry ships no native Windows binary.

### App

```bash
cd app
npm install
cp .env.example .env.local     # fill in NEXT_PUBLIC_VENUE_ADDRESS
npm run dev
```

### Rehearsing against forked mainnet

Before spending anything, run the whole cycle against a fork of mainnet with the
real Ekubo router, the real STRK/USDC pool and the real current price. The only
substitution is the privacy pool itself, which cannot be driven without a prover.

```bash
starknet-devnet --fork-network https://api.cartridge.gg/x/starknet/mainnet \
                --fork-block 14219540 --fork-upstream-caching true \
                --port 5150 --seed 42 --state-archive-capacity full

cd app && npm run rehearse
```

It deploys, schedules, fills three orders, crosses against real liquidity, and
redeems each order, asserting throughout. A recorded run:

```
in   10.0000 STRK   (3 orders: 2 + 2 + 1 lots)
out  0.267983 USDC  via one aggregate swap
rate 0.026798 USDC per STRK

ok  2-lot order redeems 0.107193 USDC   allowance exact
ok  1-lot order redeems 0.053596 USDC   allowance exact
ok  redemptions never exceed realised output  0.267982 of 0.267983
ok  second redemption rejected
ok  direct caller rejected
```

The one-unit gap is the rounding invariant: redemptions round down, so the
remainder stays as dust rather than leaving the last order unpayable.

The rehearsal also reports what each step costs, at the forked block's real gas
prices:

```
  declare class               0.79367 STRK
  deploy venue                0.00321 STRK
  create_batch                0.00838 STRK
  join                        0.00502 STRK
  settle (Ekubo swap)         0.01248 STRK
  claim                       0.00334 STRK
  ---------------------- ------------
  TOTAL (3 joins, 3 claims)   0.84486 STRK
```

Declaring the class is 94% of it. Everything after deployment is close to free.

Two caveats worth stating: gas prices move, and joins and claims cost more on
mainnet than they do here, because there they are private transactions routed
through the pool's prover and paymaster rather than direct calls. Budget a few
STRK for those rather than the figure above.

### Deploying

```bash
cd app
npm run probe:route                    # confirm the Ekubo pool is live
npm run deploy:venue                   # declare and deploy
npm run batch:create -- --lot 2 --window 20 --min-orders 2 --floor 0.02
npm run batch:settle -- --batch 1      # after it seals; permissionless
```

`probe:route` reads `Swapped` events off Ekubo Core to find pools that are
actually being traded, rather than trusting a fee-tier guess. The STRK/USDC pool
it finds is `fee 0x20c49ba5e353f80000000000000000, tick_spacing 1000`.

## Interoperating

The venue is a plain anonymizer. Anything that can build a STRK20 action array
can use it, with no SDK and no permission:

- `get_batch(batch_id)` returns the full batch state.
- `quote_redemption(batch_id, lots)` returns what an order redeems for now.
- `get_accounted(token)` returns what the venue considers spoken for. Anything
  the ERC-20 holds beyond it was donated.
- `settle` and `void_batch` are permissionless. You do not need us to run this.

`app/src/lib/actions.ts` is the whole integration surface and is about eighty
lines. It is MIT, and it is meant to be copied.

## License

MIT. See [LICENSE](LICENSE).
