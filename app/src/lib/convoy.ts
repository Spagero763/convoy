import { hash, num } from "starknet";
import { POOL_ADDRESS, VENUE_ADDRESS, VOID_GRACE_SECONDS, tokenByAddress } from "./config";
import { provider } from "./rpc";

export type BatchState = "none" | "open" | "settled" | "voided";

/** Derived from the stored state plus the clock, the way the contract does it. */
export type BatchPhase = "scheduled" | "filling" | "sealed" | "settled" | "voided";

export type Batch = {
  id: number;
  route: {
    token0: string;
    token1: string;
    fee: bigint;
    tickSpacing: bigint;
    extension: string;
  };
  tokenIn: string;
  tokenOut: string;
  lotSize: bigint;
  maxLots: number;
  minOrders: number;
  opensAt: number;
  sealsAt: number;
  minOutPerLot: bigint;
  state: BatchState;
  totalLots: number;
  orderCount: number;
  grossIn: bigint;
  netOut: bigint;
};

export type Order = {
  batchId: number;
  lots: number;
  redeemed: boolean;
};

const STATES: BatchState[] = ["none", "open", "settled", "voided"];

function felt(value: string): bigint {
  return BigInt(value);
}

/**
 * The contract returns a flat felt array. Field order here must track the
 * `Batch` struct in `types.cairo`; a mismatch shows up as nonsense numbers
 * rather than an error, so the shape is asserted on length.
 */
export function decodeBatch(id: number, raw: string[]): Batch {
  if (raw.length < 18) {
    throw new Error(`Unexpected batch encoding: ${raw.length} felts`);
  }
  let i = 0;
  const token0 = num.toHex(felt(raw[i++]));
  const token1 = num.toHex(felt(raw[i++]));
  const fee = felt(raw[i++]);
  const tickSpacing = felt(raw[i++]);
  const extension = num.toHex(felt(raw[i++]));
  const tokenIn = num.toHex(felt(raw[i++]));
  const tokenOut = num.toHex(felt(raw[i++]));
  const lotSize = felt(raw[i++]);
  const maxLots = Number(felt(raw[i++]));
  const minOrders = Number(felt(raw[i++]));
  const opensAt = Number(felt(raw[i++]));
  const sealsAt = Number(felt(raw[i++]));
  const minOutPerLot = felt(raw[i++]);
  const state = STATES[Number(felt(raw[i++]))] ?? "none";
  const totalLots = Number(felt(raw[i++]));
  const orderCount = Number(felt(raw[i++]));
  const grossIn = felt(raw[i++]);
  const netOut = felt(raw[i++]);

  return {
    id,
    route: { token0, token1, fee, tickSpacing, extension },
    tokenIn,
    tokenOut,
    lotSize,
    maxLots,
    minOrders,
    opensAt,
    sealsAt,
    minOutPerLot,
    state,
    totalLots,
    orderCount,
    grossIn,
    netOut,
  };
}

export function phaseOf(batch: Batch, nowSeconds: number): BatchPhase {
  if (batch.state === "settled") return "settled";
  if (batch.state === "voided") return "voided";
  if (nowSeconds < batch.opensAt) return "scheduled";
  if (nowSeconds < batch.sealsAt) return "filling";
  return "sealed";
}

/** True once anyone is allowed to void the batch and unlock refunds. */
export function voidableAt(batch: Batch): number {
  return batch.orderCount < batch.minOrders
    ? batch.sealsAt
    : batch.sealsAt + VOID_GRACE_SECONDS;
}

export async function readNextBatchId(): Promise<number> {
  const raw = await provider.call(VENUE_ADDRESS, "next_batch_id");
  return Number(BigInt(raw[0]));
}

export async function readBatch(id: number): Promise<Batch> {
  const raw = await provider.call(VENUE_ADDRESS, "get_batch", [num.toHex(id)]);
  return decodeBatch(id, raw);
}

export async function readOrder(commitment: string): Promise<Order> {
  const raw = await provider.call(VENUE_ADDRESS, "get_order", [commitment]);
  return {
    batchId: Number(BigInt(raw[0])),
    lots: Number(BigInt(raw[1])),
    redeemed: BigInt(raw[2]) !== 0n,
  };
}

export async function readQuote(batchId: number, lots: number): Promise<bigint> {
  const raw = await provider.call(VENUE_ADDRESS, "quote_redemption", [
    num.toHex(batchId),
    num.toHex(lots),
  ]);
  return BigInt(raw[0]);
}

/**
 * Block the venue was deployed in. Events cannot predate it, so scans start
 * here rather than at genesis.
 */
const VENUE_FROM_BLOCK = Number(process.env.NEXT_PUBLIC_VENUE_FROM_BLOCK ?? 14286000);

/** Fallback window when the deployment block is not configured. */
const LEG_SCAN_SPAN = 50_000;

export type JoinedLeg = {
  commitment: string;
  lots: number;
};

/**
 * The legs of a batch exactly as an on-chain observer sees them.
 *
 * Lot counts are public: they travel in the invoke calldata and are echoed in
 * the event. Showing them is the point. A participant should be able to look at
 * the same list an adversary would and see that their leg is not distinctive.
 */
export async function readBatchLegs(batchId: number): Promise<JoinedLeg[]> {
  const selector = hash.getSelectorFromName("OrderJoined");
  const legs: JoinedLeg[] = [];
  let continuationToken: string | undefined;

  // Scanning from genesis returns nothing rather than erroring: providers cap
  // the range and answer an unbounded query with an empty page. A bounded
  // window anchored near deployment is what actually returns events.
  const head = await provider.blockNumber();
  const fromBlock = Math.max(0, Math.min(VENUE_FROM_BLOCK, head - LEG_SCAN_SPAN));

  for (let page = 0; page < 10; page += 1) {
    const chunk = await provider.run((p) =>
      p.getEvents({
        address: VENUE_ADDRESS,
        keys: [[selector], [num.toHex(batchId)]],
        from_block: { block_number: fromBlock },
        to_block: "latest",
        chunk_size: 500,
        continuation_token: continuationToken,
      }),
    );

    for (const event of chunk.events) {
      legs.push({
        commitment: num.toHex(BigInt(event.keys[2])),
        lots: Number(BigInt(event.data[0])),
      });
    }

    continuationToken = chunk.continuation_token;
    if (!continuationToken) break;
  }

  return legs;
}

export async function readAllBatches(): Promise<Batch[]> {
  const next = await readNextBatchId();
  const ids = Array.from({ length: Math.max(0, next - 1) }, (_, k) => k + 1);
  const batches = await Promise.all(ids.map((id) => readBatch(id)));
  return batches.reverse();
}

/**
 * Shielded balance for `address`, straight off the pool. Returns null when the
 * pool has no answer for this token, which is not the same as a zero balance.
 */
export async function readShieldedBalance(
  address: string,
  token: string,
): Promise<bigint | null> {
  try {
    const raw = await provider.call(POOL_ADDRESS, "get_balance", [address, token]);
    return BigInt(raw[0]);
  } catch {
    return null;
  }
}

export const ORDER_TAG = num.toHex(
  BigInt(
    "0x" +
      Buffer.from("CONVOY_ORDER:V1", "ascii").toString("hex"),
  ),
);

/** Mirrors `order_commitment` in `types.cairo`. */
export function orderCommitment(batchId: number, secret: string): string {
  return hash.computePoseidonHashOnElements([
    ORDER_TAG,
    num.toHex(batchId),
    secret,
  ]);
}

export function tokenMeta(address: string) {
  return (
    tokenByAddress(address) ?? {
      address,
      symbol: "TOKEN",
      decimals: 18,
      display: 4,
    }
  );
}
