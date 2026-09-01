"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Batch } from "./convoy";

type RawBatch = Record<string, unknown>;

function hydrate(raw: RawBatch): Batch {
  const route = raw.route as Record<string, string>;
  return {
    id: Number(raw.id),
    route: {
      token0: route.token0,
      token1: route.token1,
      fee: BigInt(route.fee),
      tickSpacing: BigInt(route.tickSpacing),
      extension: route.extension,
    },
    tokenIn: String(raw.tokenIn),
    tokenOut: String(raw.tokenOut),
    lotSize: BigInt(String(raw.lotSize)),
    maxLots: Number(raw.maxLots),
    minOrders: Number(raw.minOrders),
    opensAt: Number(raw.opensAt),
    sealsAt: Number(raw.sealsAt),
    minOutPerLot: BigInt(String(raw.minOutPerLot)),
    state: raw.state as Batch["state"],
    totalLots: Number(raw.totalLots),
    orderCount: Number(raw.orderCount),
    grossIn: BigInt(String(raw.grossIn)),
    netOut: BigInt(String(raw.netOut)),
  };
}

export type Leg = { commitment: string; lots: number };

export type BoardState = {
  batches: Batch[] | null;
  legs: Record<number, Leg[]>;
  configured: boolean;
  error: string | null;
  /** Seconds since epoch, taken from the server so countdowns do not drift. */
  now: number;
  refresh: () => void;
};

const POLL_MS = 12_000;

export function useBoard(): BoardState {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [legs, setLegs] = useState<Record<number, Leg[]>>({});
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const skew = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/board", { cache: "no-store" });
      const data = await response.json();
      setConfigured(Boolean(data.configured));
      if (Array.isArray(data.batches)) {
        setBatches(data.batches.map(hydrate));
      }
      if (data.legs && typeof data.legs === "object") {
        setLegs(
          Object.fromEntries(
            Object.entries(data.legs as Record<string, Leg[]>).map(
              ([id, list]) => [
                Number(id),
                list.map((leg) => ({
                  commitment: leg.commitment,
                  lots: Number(leg.lots),
                })),
              ],
            ),
          ),
        );
      }
      if (typeof data.now === "number") {
        skew.current = data.now - Math.floor(Date.now() / 1000);
      }
      setError(data.error ? String(data.error) : null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    // Countdowns tick locally against the server's clock offset, so they stay
    // smooth between polls without drifting away from the chain.
    const clock = setInterval(
      () => setNow(Math.floor(Date.now() / 1000) + skew.current),
      1_000,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { batches, legs, configured, error, now, refresh: load };
}
