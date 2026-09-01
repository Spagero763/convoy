/**
 * Schedules a batch on the deployed venue.
 *
 * Usage:
 *   npm run batch:create -- --lot 2 --window 20 --min-orders 2 --floor 0.03
 *
 *   --lot          lot size in whole STRK
 *   --window       minutes the batch accepts orders
 *   --max-lots     ceiling on lots per order (default 4)
 *   --min-orders   below this the batch voids instead of crossing (default 2)
 *   --floor        minimum USDC output per lot, the slippage guard
 *   --opens-in     minutes until it opens (default 0)
 */
import { CallData, num } from "starknet";
import { DEFAULT_ROUTE, STRK, USDC, VENUE_ADDRESS } from "../src/lib/config";
import { getAccount, getProvider, recordTransaction, submit } from "./shared";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing --${name}`);
  }
  return process.argv[index + 1];
}

function toUnits(value: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0")
  );
}

async function main() {
  if (!VENUE_ADDRESS) throw new Error("Set NEXT_PUBLIC_VENUE_ADDRESS first");

  const provider = getProvider();
  const account = getAccount(provider);

  const lotSize = toUnits(arg("lot", "2"), STRK.decimals);
  const maxLots = Number(arg("max-lots", "4"));
  const minOrders = Number(arg("min-orders", "2"));
  const minOutPerLot = toUnits(arg("floor", "0"), USDC.decimals);
  const windowMinutes = Number(arg("window", "20"));
  const opensInMinutes = Number(arg("opens-in", "0"));

  // Chain time, not wall-clock. A local clock a few minutes fast would push
  // opens_at past seals_at and revert on BAD_WINDOW.
  const block = await provider.getBlockLatestAccepted();
  const full = await provider.getBlockWithTxHashes(block.block_number);
  const chainNow = Number((full as { timestamp: number }).timestamp);

  const opensAt = chainNow + opensInMinutes * 60;
  const sealsAt = opensAt + windowMinutes * 60;

  console.log("Scheduling batch");
  console.log(`  venue       ${VENUE_ADDRESS}`);
  console.log(`  route       ${STRK.symbol} to ${USDC.symbol}, 0.05% Ekubo pool`);
  console.log(`  lot         ${arg("lot", "2")} ${STRK.symbol}`);
  console.log(`  max lots    ${maxLots}`);
  console.log(`  min orders  ${minOrders}`);
  console.log(`  floor       ${arg("floor", "0")} ${USDC.symbol} per lot`);
  console.log(
    `  window      ${windowMinutes} min (opens ${new Date(opensAt * 1000).toISOString()})`,
  );

  const calldata = CallData.compile([
    DEFAULT_ROUTE.token0,
    DEFAULT_ROUTE.token1,
    DEFAULT_ROUTE.fee,
    DEFAULT_ROUTE.tickSpacing,
    DEFAULT_ROUTE.extension,
    STRK.address,
    num.toHex(lotSize),
    num.toHex(maxLots),
    num.toHex(minOrders),
    num.toHex(opensAt),
    num.toHex(sealsAt),
    num.toHex(minOutPerLot),
  ]);

  const hash = await submit(
    account,
    { contractAddress: VENUE_ADDRESS, entrypoint: "create_batch", calldata },
    "create_batch",
  );
  recordTransaction(hash);

  const next = await provider.callContract({
    contractAddress: VENUE_ADDRESS,
    entrypoint: "next_batch_id",
  });
  console.log(`\nBatch ${Number(BigInt(next[0])) - 1} is open.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
