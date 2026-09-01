import Link from "next/link";
import { POOL_ADDRESS, VENUE_ADDRESS, VOYAGER_CONTRACT } from "../lib/config";
import { truncateHex } from "../lib/format";
import styles from "./AppFooter.module.css";

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.inner}`}>
        <div className={styles.group}>
          <span className="label">Contracts</span>
          <div className={styles.links}>
            {VENUE_ADDRESS && (
              <a
                className={styles.link}
                href={`${VOYAGER_CONTRACT}${VENUE_ADDRESS}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Venue {truncateHex(VENUE_ADDRESS, 6, 4)} ↗
              </a>
            )}
            <a
              className={styles.link}
              href={`${VOYAGER_CONTRACT}${POOL_ADDRESS}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              STRK20 pool {truncateHex(POOL_ADDRESS, 6, 4)} ↗
            </a>
          </div>
        </div>

        <div className={styles.group}>
          <span className="label">Read first</span>
          <div className={styles.links}>
            <Link className={styles.link} href="/ledger">
              What this does and does not hide
            </Link>
            <Link className={styles.link} href="/risk">
              Risks
            </Link>
          </div>
        </div>

        <p className={styles.disclaimer}>
          Convoy moves real value on Starknet mainnet. Transactions are
          irreversible and there is no operator who can reverse, refund or
          recover them for you. Unaudited software.
        </p>
      </div>
    </footer>
  );
}
