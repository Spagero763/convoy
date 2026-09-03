"use client";

import { useEffect, useRef, useState } from "react";
import { truncateHex } from "../lib/format";
import { useWallet } from "../lib/wallet";
import styles from "./WalletControl.module.css";

/**
 * Every wallet state a person can land in gets its own answer here: nothing
 * installed, installed but not connected, connected to the wrong chain, or
 * connected to a wallet with no privacy support.
 */
export function WalletControl() {
  const {
    status,
    address,
    walletName,
    available,
    connect,
    rescan,
    disconnect,
    switchNetwork,
    error,
    clearError,
  } = useWallet();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") {
    return (
      <span className="skeleton" style={{ width: 108, height: 30, borderRadius: 3 }} />
    );
  }

  if (status === "wrong-network") {
    return (
      <button className={`${styles.trigger} ${styles.triggerAlert}`} onClick={switchNetwork}>
        Switch to Mainnet
      </button>
    );
  }

  if (status === "connecting") {
    return (
      <button className={styles.trigger} disabled>
        Connecting
      </button>
    );
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={`${styles.trigger} ${
          status === "no-privacy" || status === "not-registered"
            ? styles.triggerAlert
            : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {status === "ready" && address
          ? truncateHex(address, 4, 4)
          : status === "no-privacy"
            ? "No privacy support"
            : status === "not-registered"
              ? "Not enrolled"
              : "Connect"}
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {/* A connection that failed must say so. Silently returning to
              "Connect" is indistinguishable from the button not working. */}
          {error && (
            <div className={styles.problem}>
              <strong style={{ color: "var(--ink)" }}>{error.title}</strong>
              {error.action && <p style={{ margin: "5px 0 0" }}>{error.action}</p>}
              <details style={{ marginTop: 7 }}>
                <summary className={styles.problemSummary}>Technical detail</summary>
                <code className={styles.problemRaw}>{error.raw}</code>
              </details>
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 8 }}
                onClick={clearError}
              >
                Dismiss
              </button>
            </div>
          )}
          {status === "ready" && address ? (
            <>
              <div className={styles.menuHead}>
                <div className="label" style={{ marginBottom: 4 }}>
                  {walletName}
                </div>
                <div className={styles.address}>{truncateHex(address, 10, 8)}</div>
              </div>
              <button
                className={styles.option}
                onClick={() => {
                  void navigator.clipboard.writeText(address);
                  setOpen(false);
                }}
              >
                Copy address
              </button>
              <button
                className={styles.option}
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                Disconnect
              </button>
            </>
          ) : status === "not-registered" ? (
            <div className={styles.empty}>
              <strong style={{ color: "var(--ink)" }}>
                Not enrolled with the privacy pool.
              </strong>
              <p style={{ margin: "6px 0 0" }}>
                Every pool user registers a viewing key once, on chain. Without
                it nothing can be sent to this account privately, so Convoy
                cannot read a shielded balance or place an order.
              </p>
              <p style={{ margin: "8px 0 0" }}>
                Only a wallet can register a key, and it does so the first time
                you shield. Open {walletName}, pick a token, and use its own
                shield action once. Then come back.
              </p>
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 10 }}
                onClick={() => {
                  if (walletName) void connect(walletName);
                  setOpen(false);
                }}
              >
                I have registered, check again
              </button>
            </div>
          ) : status === "no-privacy" ? (
            <div className={styles.empty}>
              <strong style={{ color: "var(--ink)" }}>
                {walletName} has no STRK20 support.
              </strong>
              <p style={{ margin: "6px 0 0" }}>
                Convoy needs a wallet that can build private transactions.{" "}
                <a
                  className={styles.link}
                  href="https://www.ready.co/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Ready
                </a>{" "}
                has privacy live on mainnet.
              </p>
              <button
                className={styles.option}
                style={{ marginTop: 8, paddingInline: 0 }}
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                Try another wallet
              </button>
            </div>
          ) : available.length === 0 ? (
            <div className={styles.empty}>
              <strong style={{ color: "var(--ink)" }}>No Starknet wallet found.</strong>
              <p style={{ margin: "6px 0 0" }}>
                If the extension is installed, it may still be registering. Scan
                again before reloading.
              </p>
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 10 }}
                onClick={rescan}
              >
                Scan again
              </button>
              <p style={{ margin: "10px 0 0" }}>
                Otherwise install{" "}
                <a
                  className={styles.link}
                  href="https://www.ready.co/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Ready
                </a>
                , which has privacy live on mainnet, and reload.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.menuHead}>
                <div className="label">Connect a wallet</div>
              </div>
              {available.map((wallet) => (
                <button
                  key={wallet.id}
                  className={styles.option}
                  onClick={() => {
                    setOpen(false);
                    void connect(wallet.id);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.optionIcon} src={wallet.icon} alt="" />
                  {wallet.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
