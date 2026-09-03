"use client";

import { useCallback, useEffect, useState } from "react";
import { buildShieldActions } from "../lib/actions";
import { POOL_ADDRESS, STRK } from "../lib/config";
import { formatUnits, parseUnits } from "../lib/format";
import { provider } from "../lib/rpc";
import { useTransaction } from "../lib/tx";
import { useWallet } from "../lib/wallet";
import { TxStatus } from "./TxStatus";
import styles from "./ShieldPanel.module.css";

/**
 * Moving public STRK into the pool.
 *
 * This is the one operation that is deliberately not private, and the panel
 * says so rather than letting the word "shield" imply more than it does. It is
 * also the step that enrols an account: the wallet registers a viewing key on
 * first use, so a first shield doubles as onboarding.
 */
export function ShieldPanel({ onShielded }: { onShielded?: () => void }) {
  const { status, address, submitPrivate, refreshBalances, connect, walletName } =
    useWallet();
  const { state, run, reset } = useTransaction();

  const [amount, setAmount] = useState("10");
  const [publicBalance, setPublicBalance] = useState<bigint | null>(null);
  const [poolFee, setPoolFee] = useState<bigint | null>(null);

  const notEnrolled = status === "not-registered";
  const connected = status === "ready" || notEnrolled;

  const loadBalances = useCallback(async () => {
    if (!address) return;
    try {
      const [balance, fee] = await Promise.all([
        provider.call(STRK.address, "balance_of", [address]),
        provider.call(POOL_ADDRESS, "get_fee_amount", []),
      ]);
      setPublicBalance(BigInt(balance[0]));
      setPoolFee(BigInt(fee[0]));
    } catch {
      // Leave the figures blank rather than showing a number we do not trust.
    }
  }, [address]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances, state.phase]);

  let parsed: bigint | null = null;
  try {
    parsed = amount.trim() ? parseUnits(amount, STRK.decimals) : null;
  } catch {
    parsed = null;
  }

  const total = parsed !== null && poolFee !== null ? parsed + poolFee : null;
  const short =
    total !== null && publicBalance !== null ? publicBalance < total : false;

  const busy =
    state.phase !== "idle" && state.phase !== "failed" && state.phase !== "confirmed";

  async function shield() {
    if (parsed === null) return;
    await run({
      submit: () => submitPrivate(buildShieldActions(STRK.address, parsed)),
      onConfirmed: async () => {
        await loadBalances();
        // The first shield enrols the account, so the connection has to be
        // re-evaluated before the rest of the app will believe it.
        if (notEnrolled && walletName) await connect(walletName);
        else await refreshBalances();
        onShielded?.();
      },
    });
  }

  if (!connected) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className="label">
          {notEnrolled ? "Start here: shield into the pool" : "Shield more"}
        </span>
      </header>

      <div className={styles.body}>
        {notEnrolled && (
          <div className="notice notice-info" style={{ marginBottom: 16 }}>
            <p className="notice-title">This account has not used the pool yet.</p>
            <p className="notice-body">
              Your wallet registers a viewing key on its first privacy
              operation, so shielding enrols you and funds you in one step.
              There is nothing to do beforehand.
            </p>
          </div>
        )}

        <label className={styles.field}>
          <span className="label">Amount</span>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              disabled={busy}
              spellCheck={false}
            />
            <span className={styles.suffix}>{STRK.symbol}</span>
          </div>
        </label>

        <div className={styles.costs}>
          <div className={styles.costRow}>
            <span className={styles.costKey}>Into your shielded balance</span>
            <span className={styles.costValue}>
              {parsed === null
                ? "enter an amount"
                : `${formatUnits(parsed, STRK.decimals, 4)} ${STRK.symbol}`}
            </span>
          </div>
          <div className={styles.costRow}>
            <span className={styles.costKey}>Pool fee, charged per operation</span>
            <span className={styles.costValue}>
              {poolFee === null ? (
                <span className="skeleton" style={{ width: 64, height: 11 }}>
                  0.0000
                </span>
              ) : (
                `${formatUnits(poolFee, STRK.decimals, 4)} ${STRK.symbol}`
              )}
            </span>
          </div>
          <div className={styles.costRow}>
            <span className={styles.costKey}>Total leaving this wallet</span>
            <span className={styles.costValue}>
              {total === null
                ? "·"
                : `${formatUnits(total, STRK.decimals, 4)} ${STRK.symbol}`}
            </span>
          </div>
          <div className={styles.costRow}>
            <span className={styles.costKey}>Public balance</span>
            <span className={styles.costValue}>
              {publicBalance === null ? (
                <span className="skeleton" style={{ width: 74, height: 11 }}>
                  0000.0000
                </span>
              ) : (
                `${formatUnits(publicBalance, STRK.decimals, 4)} ${STRK.symbol}`
              )}
            </span>
          </div>
        </div>

        {short && (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>
            <p className="notice-title">Not enough public STRK.</p>
            <p className="notice-body">
              The pool fee is charged on top of the amount shielded, and gas is
              charged on top of that.
            </p>
          </div>
        )}

        <div className="notice notice-warn" style={{ marginTop: 14 }}>
          <p className="notice-title">Shielding is public.</p>
          <p className="notice-body">
            Your address, the token and the amount are all visible on chain, and
            the pool screens the depositor. Privacy begins with what you do
            afterwards. Shield a round number, ahead of time, rather than the
            exact amount you are about to commit.
          </p>
        </div>

        <button
          className="btn btn-primary btn-block btn-lg"
          style={{ marginTop: 16 }}
          onClick={() => void shield()}
          disabled={busy || parsed === null || parsed === 0n || short}
        >
          {busy
            ? "Working"
            : parsed === null
              ? "Enter an amount"
              : `Shield ${formatUnits(parsed, STRK.decimals, 4)} ${STRK.symbol}`}
        </button>

        <TxStatus state={state} onDismiss={reset} />
      </div>
    </section>
  );
}
