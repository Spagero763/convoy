"use client";

import { useMemo, useRef, useState } from "react";
import { buildJoinActions, lotValue } from "../lib/actions";
import { orderCommitment, phaseOf, tokenMeta, type Batch } from "../lib/convoy";
import { STRK } from "../lib/config";
import { explain, type Explained } from "../lib/errors";
import { formatUnits } from "../lib/format";
import { nextSlot, saveOrder } from "../lib/orders";
import { encodeKey, foldSignature, orderKeyTypedData } from "../lib/secret";
import { useTransaction } from "../lib/tx";
import type { Leg } from "../lib/useBoard";
import { shieldedBalanceOf, useWallet } from "../lib/wallet";
import { TxStatus } from "./TxStatus";
import styles from "./JoinPanel.module.css";

type Props = {
  batch: Batch;
  legs: Leg[];
  now: number;
  onJoined: () => void;
};

type Preflight = {
  fee: bigint | null;
  ok: boolean;
  error: Explained | null;
};

export function JoinPanel({ batch, legs, now, onJoined }: Props) {
  const {
    status,
    address,
    balances,
    signTypedData,
    submitPrivate,
    prepare,
    refreshBalances,
  } = useWallet();
  const { state, run, reset } = useTransaction();

  const [lots, setLots] = useState(1);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const savedKeyRef = useRef<string | null>(null);

  const tokenIn = tokenMeta(batch.tokenIn);
  const phase = phaseOf(batch, now);
  const shielded = shieldedBalanceOf(balances, batch.tokenIn);
  const cost = lotValue(batch.lotSize, lots);

  // Sizes already present in the batch. Matching one is what buys cover, so the
  // selector says which sizes have company.
  const crowd = useMemo(() => {
    const counts = new Map<number, number>();
    for (const leg of legs) counts.set(leg.lots, (counts.get(leg.lots) ?? 0) + 1);
    return counts;
  }, [legs]);

  const busy =
    checking ||
    (state.phase !== "idle" && state.phase !== "failed" && state.phase !== "confirmed");
  const shortfall = shielded !== null && shielded < cost;
  const canJoin = status === "ready" && phase === "filling" && !busy && !shortfall;

  /** Derives the order key for a slot. Raises exactly one signature prompt. */
  async function deriveOrder(slot: number) {
    const signature = await signTypedData(orderKeyTypedData(batch.id, slot));
    const secret = foldSignature(signature);
    const commitment = orderCommitment(batch.id, secret);
    const actions = buildJoinActions({
      batchId: batch.id,
      lots,
      tokenIn: batch.tokenIn,
      lotSize: batch.lotSize,
      commitment,
    });
    return { secret, commitment, actions };
  }

  /**
   * Optional, and explicitly opt-in.
   *
   * `strk20PrepareInvoke` raises its own wallet prompt, so running it
   * automatically would put three dialogs in front of a two-step action. It is
   * offered as a deliberate check instead, for anyone who wants the fee and a
   * validated action shape before committing.
   */
  async function runPreflight() {
    if (!address) return;
    setChecking(true);
    setPreflight(null);
    try {
      const { actions } = await deriveOrder(nextSlot(batch.id));
      const prepared = (await prepare(actions)) as { max_fee?: string } | null;
      setPreflight({
        fee: prepared?.max_fee ? BigInt(prepared.max_fee) : null,
        ok: true,
        error: null,
      });
    } catch (error) {
      setPreflight({ fee: null, ok: false, error: explain(error) });
    } finally {
      setChecking(false);
    }
  }

  async function join() {
    if (!address) return;
    const slot = nextSlot(batch.id);

    await run({
      submit: async () => {
        const { secret, commitment, actions } = await deriveOrder(slot);
        const hash = await submitPrivate(actions);
        saveOrder({
          batchId: batch.id,
          slot,
          commitment,
          lots,
          createdAt: Date.now(),
          txHash: hash,
        });
        savedKeyRef.current = encodeKey(secret);
        return hash;
      },
      onConfirmed: async () => {
        setSavedKey(savedKeyRef.current);
        await refreshBalances();
        onJoined();
      },
    });
  }

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className="label">Join this batch</span>
      </header>

      <div className={styles.body}>
        <div className={styles.section}>
          <span className="label">Size</span>
          <div className={styles.lots}>
            {Array.from({ length: batch.maxLots }, (_, k) => k + 1).map((n) => {
              const company = crowd.get(n) ?? 0;
              return (
                <button
                  key={n}
                  className={`${styles.lot} ${lots === n ? styles.lotActive : ""}`}
                  onClick={() => {
                    setLots(n);
                    setPreflight(null);
                  }}
                  disabled={busy}
                  aria-pressed={lots === n}
                  aria-label={`${n} ${n === 1 ? "lot" : "lots"}${
                    company > 0 ? `, ${company} existing legs at this size` : ""
                  }`}
                >
                  {company > 0 && <span className={styles.lotCrowd}>{company}</span>}
                  {n}
                </button>
              );
            })}
          </div>
          <p className={styles.hint}>
            Lot counts are public. The small figure is how many existing legs
            already carry that size, and matching one of them is what makes yours
            unremarkable.
          </p>
        </div>

        <div className={styles.section}>
          <div className={styles.costs}>
            <div className={styles.costRow}>
              <span className={styles.costKey}>Committed from shielded balance</span>
              <span className={styles.costValue}>
                {formatUnits(cost, tokenIn.decimals, tokenIn.display)}{" "}
                {tokenIn.symbol}
              </span>
            </div>
            <div className={styles.costRow}>
              <span className={styles.costKey}>Network fee</span>
              <span
                className={`${styles.costValue} ${
                  preflight?.fee == null ? styles.costValueMuted : ""
                }`}
              >
                {checking ? (
                  <span className="skeleton" style={{ width: 76, height: 11 }}>
                    0.00000
                  </span>
                ) : preflight?.fee != null ? (
                  `~${formatUnits(preflight.fee, STRK.decimals, 5)} ${STRK.symbol}`
                ) : (
                  "your wallet shows this before you approve"
                )}
              </span>
            </div>
            <div className={styles.costRow}>
              <span className={styles.costKey}>Your shielded balance</span>
              <span className={styles.costValue}>
                {shielded === null ? (
                  <span className="skeleton" style={{ width: 70, height: 11 }}>
                    0000.0000
                  </span>
                ) : (
                  `${formatUnits(shielded, tokenIn.decimals, tokenIn.display)} ${
                    tokenIn.symbol
                  }`
                )}
              </span>
            </div>
          </div>
        </div>

        {shortfall && (
          <div className={`notice notice-warn ${styles.section}`}>
            <p className="notice-title">
              Your shielded balance does not cover {lots}{" "}
              {lots === 1 ? "lot" : "lots"}.
            </p>
            <p className="notice-body">
              Shield more {tokenIn.symbol} into the pool, or pick a smaller size.
            </p>
          </div>
        )}

        {preflight && !preflight.ok && preflight.error && (
          <div className={`notice notice-bad ${styles.section}`}>
            <p className="notice-title">{preflight.error.title}</p>
            {preflight.error.action && (
              <p className="notice-body">{preflight.error.action}</p>
            )}
          </div>
        )}

        {preflight?.ok && (
          <div className={`notice notice-good ${styles.section}`}>
            <p className="notice-title">Preflight passed.</p>
            <p className="notice-body">
              The pool accepted the action shape. Nothing was submitted.
            </p>
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.actions}>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => void join()}
              disabled={!canJoin}
            >
              {phase !== "filling"
                ? "Batch is closed"
                : status !== "ready"
                  ? "Connect a wallet to join"
                  : busy
                    ? "Working"
                    : `Commit ${formatUnits(
                        cost,
                        tokenIn.decimals,
                        tokenIn.display,
                      )} ${tokenIn.symbol}`}
            </button>

            <button
              className="btn btn-ghost btn-block"
              onClick={() => void runPreflight()}
              disabled={status !== "ready" || busy || phase !== "filling"}
            >
              {checking ? "Checking" : "Preflight without committing"}
            </button>

            <p className={styles.footnote}>
              Committing raises <strong>two approval requests</strong>, not one. A
              private action needs two STRK20 steps and the wallet asks per step.
              They are halves of one atomic transaction, and approving both
              charges you once. Preflight adds a third, which is why it is a
              separate button rather than something this page does on its own.
            </p>
          </div>
        </div>

        <TxStatus state={state} onDismiss={reset} />

        {savedKey && state.phase === "confirmed" && (
          <div className={styles.keyBox}>
            <span className="label">Order key</span>
            <p className={styles.footnote} style={{ marginTop: 6 }}>
              Recoverable at any time by signing with this wallet, so there is
              nothing you must keep. Copy it only if you plan to redeem from a
              different browser.
            </p>
            <code className={styles.keyValue}>{savedKey}</code>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 10 }}
              onClick={() => void navigator.clipboard.writeText(savedKey)}
            >
              Copy key
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
