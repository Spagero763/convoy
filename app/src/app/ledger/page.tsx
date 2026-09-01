"use client";

import Link from "next/link";
import { POOL_ADDRESS, VENUE_ADDRESS, VOYAGER_CONTRACT } from "../../lib/config";
import { truncateHex } from "../../lib/format";
import styles from "./ledger.module.css";

type Line = {
  fact: string;
  visible: boolean;
  detail: string;
};

const LINES: Line[] = [
  {
    fact: "The address that shielded into the pool, and how much",
    visible: true,
    detail:
      "Shielding is an ordinary public deposit and the pool screens the depositor. Nothing Convoy does changes this, and no product built on STRK20 can.",
  },
  {
    fact: "Which address placed an order",
    visible: false,
    detail:
      "The join arrives as a call from the pool, submitted by a rotating shared relayer. Your address appears nowhere in the calldata or the signature.",
  },
  {
    fact: "How many lots each order is",
    visible: true,
    detail:
      "Lot counts travel in the invoke calldata and are echoed in the OrderJoined event. This is why sizes are quantised and capped: the number is public, so the design makes it uninformative rather than pretending it is hidden.",
  },
  {
    fact: "Whether two orders belong to the same person",
    visible: false,
    detail:
      "Nothing on chain associates one commitment with another. A wallet holding several orders in a batch produces legs that are indistinguishable from several different people.",
  },
  {
    fact: "The aggregate swap: total size, rate and timing",
    visible: true,
    detail:
      "One transaction for the whole batch. It is public, and that is the point: it reveals the sum, not any component. The larger the batch, the less any single order can be inferred from it.",
  },
  {
    fact: "Each order's individual execution price",
    visible: false,
    detail:
      "There is no per-order price. Every lot in a batch clears at the same rate, computed pro rata from what the single swap actually returned.",
  },
  {
    fact: "That a redemption happened, and for how much",
    visible: true,
    detail:
      "The redemption is a call from the pool to this contract, and the amount it credits is visible.",
  },
  {
    fact: "Who redeemed, and to which wallet",
    visible: false,
    detail:
      "Output is credited to an open note inside the pool. The note is not a public address and the redeeming wallet is not in the transaction.",
  },
  {
    fact: "That a redemption came from a specific join",
    visible: true,
    detail:
      "Redeeming reveals the key whose hash is the commitment recorded at join, so an observer can pair the two events. This does not identify a person: orders are bearer instruments, the key can be handed to anyone, and neither event carries an address.",
  },
];

export default function LedgerPage() {
  const visible = LINES.filter((l) => l.visible).length;

  return (
    <div className="shell">
      <header className={styles.head}>
        <h1 className={styles.title}>What leaks</h1>
        <p className={styles.sub}>
          Overclaiming is the most damaging thing a privacy product can do,
          because someone acts on the claim. This page is the complete list, and
          it includes the parts that are not flattering. {visible} of{" "}
          {LINES.length} facts below are public.
        </p>
      </header>

      <div className={styles.table}>
        {LINES.map((line) => (
          <div key={line.fact} className={styles.row}>
            <div className={styles.rowHead}>
              <span
                className={`chip ${line.visible ? "chip-warn" : "chip-good"}`}
              >
                <span className="chip-dot" />
                {line.visible ? "Public" : "Hidden"}
              </span>
              <h2 className={styles.fact}>{line.fact}</h2>
            </div>
            <p className={styles.detail}>{line.detail}</p>
          </div>
        ))}
      </div>

      <section className={styles.notes}>
        <h2 className={styles.notesTitle}>The honest limits</h2>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>A batch of one hides nothing</h3>
          <p className={styles.noteBody}>
            Cover comes from company. A batch that draws a single order gives
            that order no more privacy than executing alone, which is why a batch
            below its minimum order count voids and refunds instead of crossing.
            The board states the current set size rather than implying safety.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>
            A distinctive shield still stands out
          </h3>
          <p className={styles.noteBody}>
            If you shield an unusual amount and immediately commit all of it, the
            deposit and the batch are still circumstantially linked by timing.
            Shield a round amount, ahead of time, and in a size that is not
            unusual. Lot quantisation fixes the order leg; it cannot fix a
            deposit you made ten seconds earlier.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Timing correlation across batches</h3>
          <p className={styles.noteBody}>
            Joining every batch at the same size at the same time of day is a
            pattern, and patterns survive quantisation. Convoy makes any single
            order unremarkable; it does not make a habit unremarkable.
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Not audited</h3>
          <p className={styles.noteBody}>
            The venue contract is covered by a unit and fuzz suite and is
            deliberately non-upgradeable, with no administrative path to
            deposited value. It has not had a third-party audit. Treat the
            amounts you commit accordingly.
          </p>
        </div>
      </section>

      <section className={styles.contracts}>
        <span className="label">Verify any of this yourself</span>
        <div className={styles.links}>
          {VENUE_ADDRESS && (
            <a
              className={styles.link}
              href={`${VOYAGER_CONTRACT}${VENUE_ADDRESS}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Venue contract {truncateHex(VENUE_ADDRESS, 8, 6)} ↗
            </a>
          )}
          <a
            className={styles.link}
            href={`${VOYAGER_CONTRACT}${POOL_ADDRESS}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            STRK20 pool {truncateHex(POOL_ADDRESS, 8, 6)} ↗
          </a>
          <Link className={styles.link} href="/risk">
            Risks and trust model
          </Link>
        </div>
      </section>
    </div>
  );
}
