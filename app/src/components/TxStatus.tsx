"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { VOYAGER_TX } from "../lib/config";
import { truncateHex } from "../lib/format";
import { DURATION, EASE, prefersReducedMotion, setProgress } from "../lib/motion";
import { phaseLabel, type TxState } from "../lib/tx";
import styles from "./TxStatus.module.css";

/**
 * The transaction rail.
 *
 * Four steps, because that is genuinely what happens: the wallet is asked, the
 * transaction is submitted, the sequencer picks it up, and it lands. Each step
 * fills as it is reached, so progress is legible without any element moving.
 */

const STEPS = ["awaiting-signature", "pending", "confirming", "confirmed"] as const;

const COPY: Record<string, string> = {
  "awaiting-signature":
    "Approve both requests in your wallet. They are two halves of one transaction.",
  pending: "Submitted. Waiting for the sequencer to pick it up.",
  confirming: "Accepted. Waiting for the block to close.",
  confirmed: "Done. The chain has it.",
};

export function TxStatus({
  state,
  onDismiss,
}: {
  state: TxState;
  onDismiss: () => void;
}) {
  const ringRef = useRef<HTMLSpanElement>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  const failed = state.phase === "failed";
  const done = state.phase === "confirmed";
  const activeIndex = STEPS.indexOf(state.phase as (typeof STEPS)[number]);

  // Steps behind the current one are full, the current one is filling, the rest
  // are empty. Driving scaleX keeps this off the layout path entirely.
  useEffect(() => {
    STEPS.forEach((_, index) => {
      const node = stepRefs.current[index];
      if (!node) return;
      if (failed) {
        setProgress(node, index <= Math.max(activeIndex, 0) ? 1 : 0);
      } else {
        setProgress(node, index <= activeIndex ? 1 : 0);
      }
    });
  }, [activeIndex, failed]);

  // A single slow ring on the live indicator. Stops the moment it resolves.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    if (done || failed || state.phase === "idle" || prefersReducedMotion()) {
      gsap.killTweensOf(ring);
      gsap.set(ring, { opacity: 0, scale: 1 });
      return;
    }
    const tween = gsap.fromTo(
      ring,
      { opacity: 0.55, scale: 1 },
      {
        opacity: 0,
        scale: 2.1,
        duration: 1.6,
        ease: EASE.out,
        repeat: -1,
      },
    );
    return () => {
      tween.kill();
    };
  }, [done, failed, state.phase]);

  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.phase === "idle" || prefersReducedMotion()) return;
    const node = wrapRef.current;
    if (!node) return;
    gsap.fromTo(
      node,
      { opacity: 0, y: -4 },
      { opacity: 1, y: 0, duration: DURATION.fast, ease: EASE.out },
    );
  }, [state.phase === "idle"]);

  if (state.phase === "idle") return null;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${failed ? styles.wrapFailed : ""} ${
        done ? styles.wrapDone : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <div className={styles.head}>
        <span className={styles.title}>
          <span
            className={`${styles.indicator} ${done ? styles.indicatorDone : ""} ${
              failed ? styles.indicatorFailed : ""
            }`}
          >
            <span ref={ringRef} className={styles.indicatorRing} />
            <span className={styles.indicatorCore} />
          </span>
          {failed && state.error ? state.error.title : phaseLabel(state.phase)}
        </span>

        {(done || failed) && (
          <button className={styles.dismiss} onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      <div className={styles.steps} aria-hidden="true">
        {STEPS.map((step, index) => (
          <div key={step} className={styles.step}>
            <div
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              className={`${styles.stepFill} ${done ? styles.stepFillDone : ""} ${
                failed ? styles.stepFillFailed : ""
              }`}
            />
          </div>
        ))}
      </div>

      <div className={styles.body}>
        {failed && state.error ? (
          <>
            {state.error.action && <p style={{ margin: 0 }}>{state.error.action}</p>}
            <details className={styles.details}>
              <summary>Technical detail</summary>
              <code className={styles.raw}>{state.error.raw}</code>
            </details>
          </>
        ) : (
          <p style={{ margin: 0 }}>{COPY[state.phase] ?? ""}</p>
        )}

        {state.hash && (
          <a
            className={styles.link}
            href={`${VOYAGER_TX}${state.hash}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {truncateHex(state.hash, 10, 8)} ↗
          </a>
        )}
      </div>
    </div>
  );
}
