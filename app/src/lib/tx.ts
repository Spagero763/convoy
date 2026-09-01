"use client";

import { useCallback, useRef, useState } from "react";
import { explain, type Explained } from "./errors";
import { provider } from "./rpc";

/**
 * One state machine for every write the app makes, so the UI never has to guess
 * whether something is in flight.
 *
 * `awaiting-signature` is called out separately because every private action on
 * STRK20 raises two wallet prompts, and users read that as a double charge
 * unless the app says what is happening before it happens.
 */
export type TxPhase =
  | "idle"
  | "estimating"
  | "awaiting-signature"
  | "pending"
  | "confirming"
  | "confirmed"
  | "failed";

export type TxState = {
  phase: TxPhase;
  hash: string | null;
  error: Explained | null;
  /** Fee in FRI, from the wallet's dry run. Null when it could not be read. */
  feeEstimate: bigint | null;
};

const INITIAL: TxState = {
  phase: "idle",
  hash: null,
  error: null,
  feeEstimate: null,
};

type ReceiptLike = {
  execution_status?: string;
  finality_status?: string;
  revert_reason?: string;
};

async function pollReceipt(
  hash: string,
  onAccepted: () => void,
  timeoutMs = 180_000,
): Promise<ReceiptLike> {
  const started = Date.now();
  let sawAccepted = false;

  while (Date.now() - started < timeoutMs) {
    try {
      const receipt = (await provider.run((p) =>
        p.getTransactionReceipt(hash),
      )) as ReceiptLike;

      if (receipt.execution_status === "REVERTED") {
        throw new Error(receipt.revert_reason ?? "Transaction reverted");
      }
      if (
        receipt.finality_status === "ACCEPTED_ON_L2" ||
        receipt.finality_status === "ACCEPTED_ON_L1"
      ) {
        return receipt;
      }
      if (!sawAccepted) {
        sawAccepted = true;
        onAccepted();
      }
    } catch (error) {
      const text = String(error);
      // A hash the node has not indexed yet is not a failure.
      if (!text.includes("not found") && !text.includes("TXN_HASH_NOT_FOUND")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Timed out waiting for confirmation");
}

export function useTransaction() {
  const [state, setState] = useState<TxState>(INITIAL);
  const active = useRef(false);

  const reset = useCallback(() => {
    active.current = false;
    setState(INITIAL);
  }, []);

  /**
   * `estimate` runs the wallet's simulate-only dry run so the fee can be shown
   * before anything is signed. It is allowed to fail: not every wallet
   * implements it, and a missing estimate must not block the action.
   */
  const run = useCallback(
    async (options: {
      estimate?: () => Promise<bigint | null>;
      submit: () => Promise<string>;
      onConfirmed?: (hash: string) => void | Promise<void>;
    }) => {
      if (active.current) return;
      active.current = true;
      setState({ ...INITIAL, phase: "estimating" });

      try {
        let feeEstimate: bigint | null = null;
        if (options.estimate) {
          try {
            feeEstimate = await options.estimate();
          } catch {
            feeEstimate = null;
          }
        }

        setState((s) => ({ ...s, phase: "awaiting-signature", feeEstimate }));
        const hash = await options.submit();

        setState((s) => ({ ...s, phase: "pending", hash }));
        await pollReceipt(hash, () =>
          setState((s) => (s.phase === "pending" ? { ...s, phase: "confirming" } : s)),
        );

        setState((s) => ({ ...s, phase: "confirmed" }));
        await options.onConfirmed?.(hash);
      } catch (error) {
        setState((s) => ({ ...s, phase: "failed", error: explain(error) }));
      } finally {
        active.current = false;
      }
    },
    [],
  );

  return { state, run, reset };
}

export function phaseLabel(phase: TxPhase): string {
  switch (phase) {
    case "estimating":
      return "Checking";
    case "awaiting-signature":
      return "Waiting for your wallet";
    case "pending":
      return "Submitted";
    case "confirming":
      return "Confirming";
    case "confirmed":
      return "Confirmed";
    case "failed":
      return "Failed";
    default:
      return "";
  }
}
