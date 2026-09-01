"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CHAIN_NAME, STRK } from "../lib/config";
import { formatUnits } from "../lib/format";
import { shieldedBalanceOf, useWallet } from "../lib/wallet";
import { WalletControl } from "./WalletControl";
import styles from "./AppHeader.module.css";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/claim", label: "Claim" },
  { href: "/ledger", label: "What leaks" },
];

/**
 * Balance, network and wallet are pinned here and never move into a menu.
 * Settings can be buried; status cannot.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { status, balances, balancesLoading } = useWallet();

  const shielded = shieldedBalanceOf(balances, STRK.address);
  const connected = status === "ready";

  return (
    <header className={styles.header}>
      <div className={`shell ${styles.inner}`}>
        <div className={styles.brandGroup}>
          <Link href="/" className={styles.brand}>
            <ConvoyMark />
            Convoy
          </Link>

          <nav className={styles.nav}>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${
                  pathname === item.href ? styles.navLinkActive : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={styles.status}>
          <div className={styles.readout}>
            <span className={styles.readoutLabel}>Shielded</span>
            <span className={styles.readoutValue}>
              {!connected ? (
                <span className="faint">not connected</span>
              ) : balancesLoading && shielded === null ? (
                <span className="skeleton" style={{ width: 62, height: 11 }}>
                  0000.0000
                </span>
              ) : (
                `${formatUnits(shielded ?? 0n, STRK.decimals, STRK.display)} ${
                  STRK.symbol
                }`
              )}
            </span>
          </div>

          <NetworkChip ok={connected || status === "disconnected"} status={status} />
          <WalletControl />
        </div>
      </div>
    </header>
  );
}

function NetworkChip({ ok, status }: { ok: boolean; status: string }) {
  if (status === "wrong-network") {
    return (
      <span className="chip chip-bad" title="Switch your wallet to Starknet Mainnet">
        <span className="chip-dot" />
        Wrong network
      </span>
    );
  }
  return (
    <span className={`chip ${ok ? "chip-good" : ""}`} title={CHAIN_NAME}>
      <span className="chip-dot" />
      Mainnet
    </span>
  );
}

/**
 * Three lots moving as one. Static; the mark is not the place for motion.
 */
function ConvoyMark() {
  return (
    <svg
      className={styles.mark}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0.5" y="3.5" width="4" height="9" rx="1" stroke="currentColor" opacity="0.45" />
      <rect x="5.75" y="1.5" width="4" height="13" rx="1" stroke="currentColor" opacity="0.75" />
      <rect x="11" y="3.5" width="4" height="9" rx="1" stroke="currentColor" opacity="0.45" />
    </svg>
  );
}
