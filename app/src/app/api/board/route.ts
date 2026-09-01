import { NextResponse } from "next/server";
import { VENUE_ADDRESS } from "../../../lib/config";
import { readAllBatches, readBatchLegs } from "../../../lib/convoy";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type CacheEntry = {
  at: number;
  payload: unknown;
};

/**
 * Reads are cached in the server process for a few seconds. The board polls,
 * and without this every open tab would multiply straight through to the RPC
 * providers. A short window keeps the board honest while collapsing bursts.
 */
let cache: CacheEntry | null = null;
const TTL_MS = 6_000;

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

export async function GET() {
  if (!VENUE_ADDRESS) {
    return NextResponse.json(
      { configured: false, batches: [], now: Math.floor(Date.now() / 1000) },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "cache-control": "no-store", "x-convoy-cache": "hit" },
    });
  }

  try {
    const batches = await readAllBatches();

    // Legs are only fetched for batches that still matter to a participant:
    // the ones taking orders and the most recent settled one.
    const detailed = batches
      .filter((b) => b.state === "open" || b.id === batches[0]?.id)
      .slice(0, 3)
      .map((b) => b.id);

    const legs = Object.fromEntries(
      await Promise.all(
        detailed.map(
          async (id) => [id, await readBatchLegs(id).catch(() => [])] as const,
        ),
      ),
    );

    const payload = {
      configured: true,
      batches: serialize(batches),
      legs: serialize(legs),
      now: Math.floor(Date.now() / 1000),
    };
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store", "x-convoy-cache": "miss" },
    });
  } catch (error) {
    // Serve the last good read rather than blanking the board when an RPC
    // provider is having a bad minute.
    if (cache) {
      return NextResponse.json(cache.payload, {
        headers: { "cache-control": "no-store", "x-convoy-cache": "stale" },
      });
    }
    return NextResponse.json(
      { configured: true, batches: [], error: String(error) },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
