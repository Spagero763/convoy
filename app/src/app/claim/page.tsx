"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NotConfigured } from "../../components/NotConfigured";
import { TxStatus } from "../../components/TxStatus";
import { buildRedeemActions } from "../../lib/actions";
import {
  orderCommitment,
  readOrder,
  readQuote,
  tokenMeta,
  voidableAt,
  type Batch,
} from "../../lib/convoy";
import { explain, type Explained } from "../../lib/errors";
import { formatCountdown, formatUnits, truncateHex } from "../../lib/format";
import { listOrders, markRedeemed, type OrderRecord } from "../../lib/orders";
import { decodeKey, foldSignature, orderKeyTypedData } from "../../lib/secret";
import { useTransaction } from "../../lib/tx";
import { useBoard } from "../../lib/useBoard";
import { useWallet } from "../../lib/wallet";
import styles from "./claim.module.css";

export default function ClaimPage() {
  const { batches, configured, now, refresh } = useBoard();
  const [records, setRecords] = useState<OrderRecord[] | null>(null);

  useEffect(() => {
    setRecords(listOrders());
  }, []);

  const byId = useMemo(() => {
    const map = new Map<number, Batch>();
    for (const batch of batches ?? []) map.set(batch.id, batch);
    return map;
  }, [batches]);

  return (
    <div className="shell">
      <header className={styles.head}>
        <h1 className={styles.title}>Claim</h1>
        <p className={styles.sub}>
          Redemption is a separate private transaction, deliberately. Output
          lands in a fresh note that carries no link to the wallet that funded
          the order.
        </p>
      </header>

      {!configured ? (
        <NotConfigured />
      ) : records === null ? (
        <span className="skeleton" style={{ height: 180, width: "100%" }} />
      ) : records.length === 0 ? (
        <div className={styles.empty}>
          <p style={{ margin: 0 }}>No orders recorded in this browser.</p>
          <p className={styles.emptyNote}>
            Orders made elsewhere can still be redeemed. Paste the order key
            below, or go back to the{" "}
            <Link href="/" style={{ color: "var(--signal)" }}>
              board
            </Link>{" "}
            and join a batch.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {records.map((record) => (
            <OrderCard
              key={record.commitment}
              record={record}
              batch={byId.get(record.batchId)}
              now={now}
              onRedeemed={() => {
                setRecords(listOrders());
                refresh();
              }}
            />
          ))}
        </div>
      )}

      <RecoverPanel batches={batches} now={now} />
    </div>
  );
}

function OrderCard({
  record,
  batch,
  now,
  onRedeemed,
}: {
  record: OrderRecord;
  batch: Batch | undefined;
  now: number;
  onRedeemed: () => void;
}) {
  const { status, address, signTypedData, submitPrivate, refreshBalances } = useWallet();
  const { state, run, reset } = useTransaction();
  const [payout, setPayout] = useState<bigint | null>(null);
  const [onChain, setOnChain] = useState<{ redeemed: boolean } | null>(null);

  const refunding = batch?.state === "voided";
  const settled = batch?.state === "settled";
  const tokenOut = batch ? tokenMeta(refunding ? batch.tokenIn : batch.tokenOut) : null;

  useEffect(() => {
    if (!batch || (!settled && !refunding)) return;
    let cancelled = false;
    void (async () => {
      try {
        const [quote, order] = await Promise.all([
          readQuote(batch.id, record.lots),
          readOrder(record.commitment),
        ]);
        if (!cancelled) {
          setPayout(quote);
          setOnChain({ redeemed: order.redeemed });
        }
      } catch {
        // Leave the card in its loading state rather than showing a wrong figure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batch, settled, refunding, record.commitment, record.lots, state.phase]);

  const alreadyRedeemed = onChain?.redeemed ?? Boolean(record.redeemedAt);
  const busy =
    state.phase !== "idle" && state.phase !== "failed" && state.phase !== "confirmed";

  async function redeem() {
    if (!batch || !address) return;
    await run({
      submit: async () => {
        const signature = await signTypedData(
          orderKeyTypedData(batch.id, record.slot),
        );
        const secret = foldSignature(signature);

        // The derived key must reproduce the stored commitment. If the wallet
        // signs non-deterministically this catches it before a transaction is
        // sent, instead of failing on chain with CONVOY_NO_ORDER.
        if (BigInt(orderCommitment(batch.id, secret)) !== BigInt(record.commitment)) {
          throw new Error(
            "The signature did not reproduce this order key. Use the exported key below.",
          );
        }

        return submitPrivate(
          buildRedeemActions({
            batchId: batch.id,
            secret,
            token: refunding ? batch.tokenIn : batch.tokenOut,
            recipient: address,
            refunding: Boolean(refunding),
          }),
        );
      },
      onConfirmed: async () => {
        markRedeemed(record.commitment);
        await refreshBalances();
        onRedeemed();
      },
    });
  }

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div>
          <span className={styles.cardId}>
            BATCH {String(record.batchId).padStart(3, "0")}
          </span>
          <span className={styles.cardLots}>
            {record.lots} {record.lots === 1 ? "lot" : "lots"}
          </span>
        </div>
        <StateChip
          batch={batch}
          alreadyRedeemed={alreadyRedeemed}
          now={now}
        />
      </header>

      <div className={styles.cardBody}>
        <div className="field">
          <span className="field-key">Order key</span>
          <span className="field-value">{truncateHex(record.commitment, 8, 6)}</span>
        </div>
        <div className="field">
          <span className="field-key">
            {refunding ? "Refundable" : "Redeemable"}
          </span>
          <span className="field-value">
            {!batch ? (
              <span className="faint">reading</span>
            ) : !settled && !refunding ? (
              <span className="faint">not settled yet</span>
            ) : payout === null ? (
              <span className="skeleton" style={{ width: 76, height: 11 }}>
                0.000000
              </span>
            ) : (
              `${formatUnits(payout, tokenOut!.decimals, tokenOut!.display)} ${
                tokenOut!.symbol
              }`
            )}
          </span>
        </div>
        {batch && batch.state === "open" && now >= batch.sealsAt && (
          <div className="field">
            <span className="field-key">Voidable in</span>
            <span className="field-value">
              {formatCountdown(voidableAt(batch) - now)}
            </span>
          </div>
        )}
      </div>

      <div className={styles.cardFoot}>
        <button
          className="btn btn-primary btn-block"
          onClick={() => void redeem()}
          disabled={
            status !== "ready" ||
            busy ||
            alreadyRedeemed ||
            (!settled && !refunding)
          }
        >
          {alreadyRedeemed
            ? "Already redeemed"
            : status !== "ready"
              ? "Connect a wallet"
              : !settled && !refunding
                ? "Waiting for settlement"
                : busy
                  ? "Working"
                  : refunding
                    ? "Refund into a note"
                    : "Claim into a note"}
        </button>
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        <TxStatus state={state} onDismiss={reset} />
      </div>
    </article>
  );
}

function StateChip({
  batch,
  alreadyRedeemed,
  now,
}: {
  batch: Batch | undefined;
  alreadyRedeemed: boolean;
  now: number;
}) {
  if (alreadyRedeemed) {
    return <span className="chip">Redeemed</span>;
  }
  if (!batch) {
    return <span className="chip">Unknown</span>;
  }
  if (batch.state === "settled") {
    return <span className="chip chip-good">Claimable</span>;
  }
  if (batch.state === "voided") {
    return <span className="chip chip-warn">Refundable</span>;
  }
  return (
    <span className="chip chip-live">
      {now < batch.sealsAt ? "Filling" : "Sealed"}
    </span>
  );
}

/**
 * Redemption from a pasted key, for anyone claiming from a different browser
 * or a wallet that signs non-deterministically.
 */
function RecoverPanel({ batches, now }: { batches: Batch[] | null; now: number }) {
  const { status, address, submitPrivate, refreshBalances } = useWallet();
  const { state, run, reset } = useTransaction();
  const [key, setKey] = useState("");
  const [batchId, setBatchId] = useState("");
  const [problem, setProblem] = useState<Explained | null>(null);

  const busy =
    state.phase !== "idle" && state.phase !== "failed" && state.phase !== "confirmed";

  async function redeem() {
    if (!address) return;
    setProblem(null);
    try {
      const secret = decodeKey(key);
      const id = Number(batchId);
      const batch = batches?.find((b) => b.id === id);
      if (!batch) throw new Error("No batch with that number");
      const refunding = batch.state === "voided";
      if (!refunding && batch.state !== "settled") {
        throw new Error("CONVOY_BATCH_NOT_SETTLED");
      }

      const commitment = orderCommitment(id, secret);
      const order = await readOrder(commitment);
      if (order.lots === 0) throw new Error("CONVOY_NO_ORDER");
      if (order.redeemed) throw new Error("CONVOY_REDEEMED");

      await run({
        submit: () =>
          submitPrivate(
            buildRedeemActions({
              batchId: id,
              secret,
              token: refunding ? batch.tokenIn : batch.tokenOut,
              recipient: address,
              refunding,
            }),
          ),
        onConfirmed: async () => {
          await refreshBalances();
        },
      });
    } catch (error) {
      setProblem(explain(error));
    }
  }

  return (
    <section className={styles.recover}>
      <span className="label">Redeem with an order key</span>
      <p className={styles.recoverNote}>
        Orders are bearer instruments. Whoever holds the key can redeem, from any
        wallet, into any note. That is deliberate: it means a redemption does not
        prove who joined.
      </p>

      <div className={styles.recoverRow}>
        <input
          className={styles.input}
          placeholder="Batch number"
          inputMode="numeric"
          value={batchId}
          onChange={(event) => setBatchId(event.target.value.replace(/\D/g, ""))}
          disabled={busy}
        />
        <input
          className={`${styles.input} ${styles.inputWide}`}
          placeholder="convoy1:..."
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={busy}
          spellCheck={false}
        />
        <button
          className="btn btn-primary"
          onClick={() => void redeem()}
          disabled={status !== "ready" || busy || !key || !batchId}
        >
          Redeem
        </button>
      </div>

      {problem && (
        <div className="notice notice-bad" style={{ marginTop: 12 }}>
          <p className="notice-title">{problem.title}</p>
          {problem.action && <p className="notice-body">{problem.action}</p>}
        </div>
      )}

      <TxStatus state={state} onDismiss={reset} />
    </section>
  );
}
