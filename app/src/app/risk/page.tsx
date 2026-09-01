import Link from "next/link";
import { VOID_GRACE_SECONDS } from "../../lib/config";
import styles from "../ledger/ledger.module.css";

export const metadata = {
  title: "Risks",
};

export default function RiskPage() {
  const graceHours = Math.round(VOID_GRACE_SECONDS / 3600);

  return (
    <div className="shell">
      <header className={styles.head}>
        <h1 className={styles.title}>Risks and trust model</h1>
        <p className={styles.sub}>
          What can go wrong, who can do what, and what happens to your value in
          each case.
        </p>
      </header>

      <section className={styles.notes}>
        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Transactions are irreversible</h3>
          <p className={styles.noteBody}>
            This is mainnet. Nobody operating Convoy can reverse, refund or
            recover a transaction on your behalf, and there is no support channel
            that can. Commit amounts you are willing to lose.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>The contract is not audited</h3>
          <p className={styles.noteBody}>
            It has unit and fuzz coverage, and it is deliberately small. It has
            not been reviewed by a third party. That is a real risk and not one
            testing removes.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>What the operator can do</h3>
          <p className={styles.noteBody}>
            Schedule batches, and pause new joins. That is the whole list. The
            operator cannot move deposited value, cannot redirect settlement,
            cannot weaken a batch&apos;s slippage floor, and cannot block a
            redemption. The route and the floor are written when a batch is
            created and are immutable afterwards. Pausing gates joins only, so
            claims and refunds keep working while paused.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>There is no upgrade path</h3>
          <p className={styles.noteBody}>
            The venue is not behind a proxy and has no upgrade entrypoint. A bug
            cannot be patched under your feet, and it also cannot be patched at
            all. The safety valve is the void path rather than an admin key.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>If settlement never happens</h3>
          <p className={styles.noteBody}>
            Settlement is permissionless, so it does not depend on the operator
            being available. If it still has not happened {graceHours} hours after
            a batch seals, anyone can void the batch, and every order refunds its
            original deposit one for one. Value cannot be stranded by inaction.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>If the batch is too thin</h3>
          <p className={styles.noteBody}>
            A batch that draws fewer than its minimum order count cannot settle.
            It voids and refunds instead. This is a privacy guarantee expressed as
            a spending rule: the venue would rather return your funds than execute
            them in a crowd too small to hide them.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Price moves between join and cross</h3>
          <p className={styles.noteBody}>
            Batching means your order executes later than you placed it, at
            whatever the aggregate swap achieves. Every batch carries a minimum
            output per lot, fixed at creation, and settlement reverts rather than
            clearing below it. You are trading immediacy for cover, deliberately.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Losing your order key</h3>
          <p className={styles.noteBody}>
            Keys derive from a signature by the wallet that joined, so the wallet
            is the backup and there is normally nothing to store. If you lose
            access to that wallet and did not export the key, the order cannot be
            redeemed by anyone, including us.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>What this is not</h3>
          <p className={styles.noteBody}>
            Not investment advice, not a custodial service, and not a way to
            evade screening. Deposits into the STRK20 pool are screened by a
            compliance provider and that signature is verified on chain. Convoy
            sits above the pool and inherits that, and running your own prover
            would not bypass it.
          </p>
        </div>
      </section>

      <section className={styles.contracts}>
        <div className={styles.links}>
          <Link className={styles.link} href="/ledger">
            What leaks
          </Link>
          <Link className={styles.link} href="/">
            Back to the board
          </Link>
        </div>
      </section>
    </div>
  );
}
