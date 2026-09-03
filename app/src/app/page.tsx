"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { JoinPanel } from "../components/JoinPanel";
import { LiveBatch } from "../components/LiveBatch";
import { NotConfigured } from "../components/NotConfigured";
import { ShieldPanel } from "../components/ShieldPanel";
import { phaseOf, tokenMeta, type Batch } from "../lib/convoy";
import { clearingRate, formatUnits } from "../lib/format";
import { listOrders } from "../lib/orders";
import { useBoard } from "../lib/useBoard";
import { useWallet } from "../lib/wallet";
import styles from "./page.module.css";

export default function BoardPage() {
  const { batches, legs, configured, error, now, refresh } = useBoard();
  const { status } = useWallet();
  const [mine, setMine] = useState<string[]>([]);

  useEffect(() => {
    setMine(listOrders().map((order) => order.commitment));
  }, [batches]);

  // The batch a person can act on: the one taking orders, else the newest.
  const active = useMemo(() => {
    if (!batches || batches.length === 0) return null;
    const open = batches.filter((b) => phaseOf(b, now) === "filling");
    if (open.length > 0) return open[open.length - 1];
    const sealed = batches.find((b) => phaseOf(b, now) === "sealed");
    return sealed ?? batches[0];
  }, [batches, now]);

  const history = useMemo(
    () => (batches ?? []).filter((b) => b.id !== active?.id),
    [batches, active],
  );

  return (
    <>
      <section className={styles.intro}>
        <div className="shell">
          <h1 className={styles.thesis}>
            The pool hides who you are.
            <br />
            <span className={styles.thesisDim}>
              It does not hide how much, or when.
            </span>
          </h1>
          <p className={styles.sub}>
            A private swap still leaves a public leg carrying its size and its
            timing, and a distinctive amount shortly after a distinctive deposit
            is correlatable. Convoy removes both handles: orders are cut to
            identical lots, and every order in a batch leaves as one transaction
            at one rate.{" "}
            <Link href="/ledger" style={{ color: "var(--signal)" }}>
              Exactly what stays visible
            </Link>
            .
          </p>
        </div>
      </section>

      <div className="shell">
        {!configured ? (
          <div style={{ paddingTop: 26 }}>
            <NotConfigured />
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              <div className={styles.column}>
                {batches === null ? (
                  <span className={`skeleton ${styles.skeletonPanel}`} />
                ) : active ? (
                  <LiveBatch
                    batch={active}
                    legs={legs[active.id] ?? []}
                    now={now}
                    mine={mine}
                  />
                ) : (
                  <div className={styles.emptyState}>
                    No batches scheduled yet.
                  </div>
                )}
              </div>

              <div className={styles.column}>
                {/* Enrolment comes before anything else can work, so the shield
                    panel takes the slot rather than sitting below a join form
                    that cannot be used yet. */}
                {status === "not-registered" ? (
                  <ShieldPanel onShielded={refresh} />
                ) : batches === null ? (
                  <span className={`skeleton ${styles.skeletonSide}`} />
                ) : active ? (
                  <>
                    <JoinPanel
                      batch={active}
                      legs={legs[active.id] ?? []}
                      now={now}
                      onJoined={refresh}
                    />
                    {status === "ready" && <ShieldPanel />}
                  </>
                ) : null}
              </div>
            </div>

            <section className={styles.history}>
              <div className={styles.historyHead}>
                <span className="label">Previous batches</span>
                {error && (
                  <span className="chip chip-warn">
                    <span className="chip-dot" />
                    Showing last good read
                  </span>
                )}
              </div>

              {batches === null ? (
                <span className="skeleton" style={{ height: 140, width: "100%" }} />
              ) : history.length === 0 ? (
                <div className={styles.emptyState}>Nothing has crossed yet.</div>
              ) : (
                <div className="scroll-x">
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>State</th>
                        <th>Legs</th>
                        <th>Lots</th>
                        <th>Committed</th>
                        <th>Cleared</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((batch) => (
                        <HistoryRow key={batch.id} batch={batch} now={now} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function HistoryRow({ batch, now }: { batch: Batch; now: number }) {
  const tokenIn = tokenMeta(batch.tokenIn);
  const tokenOut = tokenMeta(batch.tokenOut);
  const phase = phaseOf(batch, now);
  const rate =
    batch.state === "settled"
      ? clearingRate(batch.grossIn, tokenIn.decimals, batch.netOut, tokenOut.decimals, 6)
      : null;

  return (
    <tr>
      <td className={styles.strong}>{String(batch.id).padStart(3, "0")}</td>
      <td>
        <span
          className={`chip ${
            phase === "settled"
              ? "chip-good"
              : phase === "voided"
                ? "chip-bad"
                : phase === "sealed"
                  ? "chip-warn"
                  : ""
          }`}
        >
          {phase}
        </span>
      </td>
      <td>{batch.orderCount}</td>
      <td>{batch.totalLots}</td>
      <td className={styles.strong}>
        {formatUnits(batch.grossIn, tokenIn.decimals, tokenIn.display)}{" "}
        <span className="faint">{tokenIn.symbol}</span>
      </td>
      <td className={batch.state === "settled" ? styles.strong : undefined}>
        {batch.state === "settled" ? (
          <>
            {formatUnits(batch.netOut, tokenOut.decimals, tokenOut.display)}{" "}
            <span className="faint">{tokenOut.symbol}</span>
          </>
        ) : (
          <span className="faint">not crossed</span>
        )}
      </td>
      <td>{rate ?? <span className="faint">·</span>}</td>
    </tr>
  );
}
