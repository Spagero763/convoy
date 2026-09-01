"use client";

import { useEffect, useMemo, useRef } from "react";
import { phaseOf, tokenMeta, type Batch } from "../lib/convoy";
import { clearingRate, formatCountdown, formatUnits } from "../lib/format";
import { revealRows, setProgress } from "../lib/motion";
import type { Leg } from "../lib/useBoard";
import styles from "./LiveBatch.module.css";

type Props = {
  batch: Batch;
  legs: Leg[];
  now: number;
  /** Commitments this browser has recorded. Never read from chain. */
  mine: string[];
};

export function LiveBatch({ batch, legs, now, mine }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const legsRef = useRef<HTMLDivElement>(null);
  const seenLegs = useRef(0);

  const phase = phaseOf(batch, now);
  const tokenIn = tokenMeta(batch.tokenIn);
  const tokenOut = tokenMeta(batch.tokenOut);

  const secondsLeft = Math.max(0, batch.sealsAt - now);
  const windowLength = Math.max(1, batch.sealsAt - batch.opensAt);
  const elapsed = Math.min(1, Math.max(0, (now - batch.opensAt) / windowLength));

  // The schedule bar reports progress through the window. It is not a funding
  // goal, so it never implies a target the batch has to reach.
  useEffect(() => {
    setProgress(
      fillRef.current,
      phase === "filling" ? elapsed : phase === "scheduled" ? 0 : 1,
    );
  }, [elapsed, phase]);

  // Only newly arrived legs animate. Re-rendering the list must not replay the
  // whole set, or every poll would look like a burst of activity.
  useEffect(() => {
    const container = legsRef.current;
    if (!container) return;
    const nodes = Array.from(container.children) as HTMLElement[];
    if (nodes.length > seenLegs.current) {
      revealRows(nodes.slice(seenLegs.current));
    }
    seenLegs.current = nodes.length;
  }, [legs.length]);

  const mineSet = useMemo(() => new Set(mine.map((c) => BigInt(c).toString())), [mine]);

  const distribution = useMemo(() => {
    const counts = new Map<number, number>();
    for (const leg of legs) counts.set(leg.lots, (counts.get(leg.lots) ?? 0) + 1);
    return counts;
  }, [legs]);

  const rate =
    batch.state === "settled"
      ? clearingRate(
          batch.grossIn,
          tokenIn.decimals,
          batch.netOut,
          tokenOut.decimals,
          6,
        )
      : null;

  return (
    <section className={styles.panel} aria-label={`Batch ${batch.id}`}>
      <header className={styles.head}>
        <div className={styles.id}>
          <span className={styles.idNumber}>
            BATCH {String(batch.id).padStart(3, "0")}
          </span>
          <PhaseChip phase={phase} />
        </div>

        <div className={styles.headRight}>
          {phase === "filling" && (
            <div className={styles.countdown}>
              <span className="label">seals in</span>
              <span className={styles.countdownValue}>
                {formatCountdown(secondsLeft)}
              </span>
            </div>
          )}
          {phase === "sealed" && (
            <span className="label">waiting to cross</span>
          )}
        </div>
      </header>

      <div className={styles.track}>
        <div
          ref={fillRef}
          className={`${styles.fill} ${
            phase === "sealed" ? styles.fillSealed : ""
          } ${phase === "settled" ? styles.fillDone : ""}`}
        />
      </div>

      <div className={styles.setSection}>
        <div className={styles.setHead}>
          <span className="label">The set, as the chain sees it</span>
          <span className="label">
            {legs.length} {legs.length === 1 ? "leg" : "legs"} · {batch.totalLots}{" "}
            lots
          </span>
        </div>

        {legs.length === 0 ? (
          <div className={styles.empty}>
            {batch.orderCount > 0
              ? // Counts come from contract storage and are always right. Leg
                // detail comes from events, which an endpoint can fail to
                // serve. Saying "no orders" here would be a lie.
                `${batch.orderCount} ${
                  batch.orderCount === 1 ? "order" : "orders"
                } committed. Per-leg detail is not available from this endpoint right now.`
              : "No orders yet. The first leg into a batch waits for company."}
          </div>
        ) : (
          <div className={styles.legs} ref={legsRef}>
            {legs.map((leg, index) => (
              <div
                key={leg.commitment}
                className={`${styles.leg} ${
                  mineSet.has(BigInt(leg.commitment).toString())
                    ? styles.legMine
                    : ""
                }`}
                title={`${leg.lots} ${leg.lots === 1 ? "lot" : "lots"}`}
              >
                <span className={styles.legIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                {Array.from({ length: leg.lots }, (_, k) => (
                  <span key={k} className={styles.cell} />
                ))}
              </div>
            ))}
          </div>
        )}

        <Verdict
          legs={legs}
          distribution={distribution}
          minOrders={batch.minOrders}
          orderCount={batch.orderCount}
          mineSet={mineSet}
        />
      </div>

      <div className={styles.facts}>
        <Fact
          label="Route"
          value={`${tokenIn.symbol} to ${tokenOut.symbol}`}
          note="Ekubo, 0.05% pool, pinned at creation"
        />
        <Fact
          label="Lot"
          value={`${formatUnits(batch.lotSize, tokenIn.decimals, tokenIn.display)} ${
            tokenIn.symbol
          }`}
          note={`Orders are 1 to ${batch.maxLots} lots`}
        />
        <Fact
          label="Committed"
          value={`${formatUnits(batch.grossIn, tokenIn.decimals, tokenIn.display)} ${
            tokenIn.symbol
          }`}
          note={`${batch.orderCount} of ${batch.minOrders} minimum orders`}
        />
        {batch.state === "settled" ? (
          <Fact
            label="Cleared"
            value={`${formatUnits(
              batch.netOut,
              tokenOut.decimals,
              tokenOut.display,
            )} ${tokenOut.symbol}`}
            note={rate ? `${rate} ${tokenOut.symbol} per ${tokenIn.symbol}` : undefined}
          />
        ) : (
          <Fact
            label="Floor"
            value={`${formatUnits(
              batch.minOutPerLot,
              tokenOut.decimals,
              tokenOut.display,
            )} ${tokenOut.symbol}`}
            note="Minimum output per lot. Settlement reverts below it."
          />
        )}
      </div>
    </section>
  );
}

function PhaseChip({ phase }: { phase: string }) {
  const map: Record<string, { className: string; label: string; pulse?: boolean }> = {
    scheduled: { className: "chip", label: "Scheduled" },
    filling: { className: "chip chip-live", label: "Filling", pulse: true },
    sealed: { className: "chip chip-warn", label: "Sealed" },
    settled: { className: "chip chip-good", label: "Settled" },
    voided: { className: "chip chip-bad", label: "Voided" },
  };
  const entry = map[phase] ?? map.scheduled;
  return (
    <span className={entry.className}>
      <span className={`chip-dot ${entry.pulse ? "pulse" : ""}`} />
      {entry.label}
    </span>
  );
}

/**
 * States plainly how much cover the batch currently gives, including when the
 * answer is "not enough". Overstating this would be the one dishonest thing
 * this product could do.
 */
function Verdict({
  legs,
  distribution,
  minOrders,
  orderCount,
  mineSet,
}: {
  legs: Leg[];
  distribution: Map<number, number>;
  minOrders: number;
  orderCount: number;
  mineSet: Set<string>;
}) {
  const myLeg = legs.find((leg) => mineSet.has(BigInt(leg.commitment).toString()));

  if (legs.length === 0) {
    // Without leg detail there is no honest claim to make about cover, so the
    // only correct thing is to say the assessment is unavailable.
    if (orderCount > 0) {
      return (
        <div className={styles.verdict}>
          {orderCount} {orderCount === 1 ? "order is" : "orders are"} committed,
          but the size distribution could not be read. Cover cannot be assessed
          without it.
        </div>
      );
    }
    return (
      <div className={`${styles.verdict} ${styles.verdictWeak}`}>
        An empty batch hides nothing. Cover starts at the second leg.
      </div>
    );
  }

  if (myLeg) {
    const twins = distribution.get(myLeg.lots) ?? 1;
    const weak = twins < 2;
    return (
      <div
        className={`${styles.verdict} ${weak ? styles.verdictWeak : ""}`}
        role="status"
      >
        {weak ? (
          <>
            Your leg is the only <strong>{myLeg.lots}-lot</strong> order here. Size
            alone would single it out. Cover improves if another order of this size
            joins before the seal.
          </>
        ) : (
          <>
            Your leg is <strong>1 of {twins}</strong> identical {myLeg.lots}-lot
            orders. Nothing on chain separates them, and all {legs.length} legs
            leave in one transaction at one rate.
          </>
        )}
      </div>
    );
  }

  const sizes = [...distribution.entries()].sort((a, b) => b[1] - a[1]);
  const [topSize, topCount] = sizes[0];

  return (
    <div
      className={`${styles.verdict} ${
        legs.length < minOrders ? styles.verdictWeak : ""
      }`}
    >
      {legs.length < minOrders ? (
        <>
          {legs.length} of {minOrders} minimum orders. Below the minimum this batch
          voids and refunds instead of crossing.
        </>
      ) : (
        <>
          The most common size is <strong>{topSize} lots</strong>, held by{" "}
          {topCount} of {legs.length} legs. Joining at that size buys the most
          cover.
        </>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className={styles.fact}>
      <span className={styles.factKey}>{label}</span>
      <span className={styles.factValue}>{value}</span>
      {note && <span className={styles.factNote}>{note}</span>}
    </div>
  );
}
