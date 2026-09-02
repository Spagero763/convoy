"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, STRK } from "../../lib/config";
import styles from "../ledger/ledger.module.css";

/**
 * Reports what this browser actually sees, so "it will not connect" becomes a
 * specific answer instead of a guess.
 *
 * Every probe here is read-only. `strk20Balances` is documented as safe to call
 * against an arbitrary wallet, and a wallet that answers "not implemented" has
 * told us it has no privacy support.
 */

type Row = {
  name: string;
  chainId: string | null;
  onMainnet: boolean | null;
  walletApi: string | null;
  privacy: "yes" | "no" | "error";
  detail: string;
};

export default function DiagnosticsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [injected, setInjected] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);

  const scan = useCallback(async () => {
    setRunning(true);
    try {
      // Legacy injection, which is what most extensions still do.
      const keys = Object.keys(window).filter((k) => k.startsWith("starknet"));
      setInjected(keys);

      const { createStore } = await import("@starknet-io/get-starknet-discovery");
      const store = createStore();
      store._refreshInjectedWallets?.();
      await new Promise((r) => setTimeout(r, 1200));
      store._refreshInjectedWallets?.();

      const wallets = store.getWallets();
      setDiscovered(wallets.map((w) => w.name));

      const { walletV6 } = await import("starknet");
      const results: Row[] = [];

      for (const wallet of wallets) {
        let chainId: string | null = null;
        let onMainnet: boolean | null = null;
        let walletApi: string | null = null;
        let privacy: Row["privacy"] = "error";
        let detail = "";

        try {
          chainId = await walletV6.requestChainId(wallet);
          onMainnet = BigInt(chainId) === BigInt(CHAIN_ID);
        } catch (error) {
          detail = `chainId failed: ${String(error).slice(0, 120)}`;
        }

        try {
          const version = await walletV6.supportedWalletApi(wallet);
          walletApi = Array.isArray(version) ? version.join(", ") : String(version);
        } catch {
          walletApi = null;
        }

        try {
          await walletV6.strk20Balances(wallet, [STRK.address as `0x${string}`]);
          privacy = "yes";
        } catch (error) {
          const text = String(error);
          privacy =
            text.toLowerCase().includes("not implemented") ||
            text.toLowerCase().includes("not supported") ||
            text.includes("-32601")
              ? "no"
              : "error";
          detail = detail || text.slice(0, 200);
        }

        results.push({ name: wallet.name, chainId, onMainnet, walletApi, privacy, detail });
      }

      setRows(results);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <div className="shell">
      <header className={styles.head}>
        <h1 className={styles.title}>Diagnostics</h1>
        <p className={styles.sub}>
          Read-only. Nothing here signs, spends or changes anything. It reports
          what your browser exposes so a connection problem has a specific cause.
        </p>
      </header>

      <section className={styles.notes}>
        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Injected globals</h3>
          <p className={styles.noteBody}>
            {injected.length === 0
              ? "None. No Starknet extension has injected into this page. Check the extension is enabled for this site, and that you are not in a private window."
              : injected.join(", ")}
          </p>
        </div>

        <div className={styles.note}>
          <h3 className={styles.noteTitle}>Discovered by get-starknet</h3>
          <p className={styles.noteBody}>
            {discovered === null
              ? "scanning"
              : discovered.length === 0
                ? "Nothing. The extension injected but did not register with the wallet standard."
                : discovered.join(", ")}
          </p>
        </div>

        {rows?.map((row) => (
          <div key={row.name} className={styles.note}>
            <h3 className={styles.noteTitle}>{row.name}</h3>
            <div style={{ padding: "4px 0" }}>
              <div className="field">
                <span className="field-key">Chain id</span>
                <span className="field-value">{row.chainId ?? "unavailable"}</span>
              </div>
              <div className="field">
                <span className="field-key">On mainnet</span>
                <span className="field-value">
                  {row.onMainnet === null ? "unknown" : row.onMainnet ? "yes" : "NO"}
                </span>
              </div>
              <div className="field">
                <span className="field-key">Wallet API</span>
                <span className="field-value">{row.walletApi ?? "not reported"}</span>
              </div>
              <div className="field">
                <span className="field-key">STRK20 privacy</span>
                <span className="field-value">
                  {row.privacy === "yes"
                    ? "supported"
                    : row.privacy === "no"
                      ? "NOT supported"
                      : "probe errored"}
                </span>
              </div>
            </div>
            {row.detail && (
              <p className={styles.noteBody} style={{ marginTop: 8 }}>
                <code style={{ fontSize: 11, wordBreak: "break-word" }}>{row.detail}</code>
              </p>
            )}
          </div>
        ))}
      </section>

      <section className={styles.contracts}>
        <button className="btn" onClick={() => void scan()} disabled={running}>
          {running ? "Scanning" : "Scan again"}
        </button>
      </section>
    </div>
  );
}
