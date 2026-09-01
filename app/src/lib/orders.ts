"use client";

/**
 * A local index of orders this browser created.
 *
 * Only the public parts are kept: batch id, lot count, commitment, and the slot
 * used to derive the key. The secret itself is never written anywhere. It is
 * re-derived from a wallet signature when it is needed, so losing this index
 * costs convenience, not funds.
 */

const KEY = "convoy.orders.v1";

export type OrderRecord = {
  batchId: number;
  slot: number;
  commitment: string;
  lots: number;
  createdAt: number;
  txHash?: string;
  redeemedAt?: number;
};

function read(): OrderRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrderRecord[]) : [];
  } catch {
    return [];
  }
}

function write(records: OrderRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // A full or blocked store must not break the flow. The chain is the record
    // of truth; this index is a convenience.
  }
}

export function listOrders(): OrderRecord[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function ordersForBatch(batchId: number): OrderRecord[] {
  return read().filter((record) => record.batchId === batchId);
}

export function saveOrder(record: OrderRecord): void {
  const existing = read().filter(
    (r) => BigInt(r.commitment) !== BigInt(record.commitment),
  );
  write([...existing, record]);
}

export function markRedeemed(commitment: string): void {
  const target = BigInt(commitment);
  write(
    read().map((record) =>
      BigInt(record.commitment) === target
        ? { ...record, redeemedAt: Date.now() }
        : record,
    ),
  );
}

/** Next free slot for a batch, so one wallet can hold several orders in it. */
export function nextSlot(batchId: number): number {
  const used = ordersForBatch(batchId).map((r) => r.slot);
  let slot = 0;
  while (used.includes(slot)) slot += 1;
  return slot;
}
