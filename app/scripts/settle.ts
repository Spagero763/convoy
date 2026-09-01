/**
 * Crosses a sealed batch, or voids one that cannot cross.
 *
 * Settlement is permissionless. This script is a convenience, not a privileged
 * path: anyone can call `settle` once a batch seals, and the contract enforces
 * the route and the floor regardless of who calls it.
 *
 * Usage:
 *   npm run batch:settle -- --batch 1
 *   npm run batch:settle -- --batch 1 --void
 */
import { CallData, num } from "starknet";
import { VENUE_ADDRESS } from "../src/lib/config";
import { decodeBatch, phaseOf } from "../src/lib/convoy";
import { getAccount, getProvider, recordTransaction, submit } from "./shared";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing --${name}`);
  }
  return process.argv[index + 1];
}

async function main() {
  if (!VENUE_ADDRESS) throw new Error("Set NEXT_PUBLIC_VENUE_ADDRESS first");

  const provider = getProvider();
  const account = getAccount(provider);
  const batchId = Number(arg("batch"));
  const voiding = process.argv.includes("--void");

  const raw = await provider.callContract({
    contractAddress: VENUE_ADDRESS,
    entrypoint: "get_batch",
    calldata: [num.toHex(batchId)],
  });
  const batch = decodeBatch(batchId, raw as string[]);

  const block = await provider.getBlockLatestAccepted();
  const full = await provider.getBlockWithTxHashes(block.block_number);
  const chainNow = Number((full as { timestamp: number }).timestamp);

  console.log(`Batch ${batchId}`);
  console.log(`  state       ${batch.state} (${phaseOf(batch, chainNow)})`);
  console.log(`  orders      ${batch.orderCount} (minimum ${batch.minOrders})`);
  console.log(`  lots        ${batch.totalLots}`);
  console.log(`  committed   ${batch.grossIn}`);
  console.log(`  seals at    ${new Date(batch.sealsAt * 1000).toISOString()}`);
  console.log(`  chain time  ${new Date(chainNow * 1000).toISOString()}`);

  if (chainNow < batch.sealsAt) {
    throw new Error(
      `Not sealed yet. ${batch.sealsAt - chainNow}s remaining on chain time.`,
    );
  }

  if (voiding || batch.orderCount < batch.minOrders) {
    if (!voiding) {
      console.log(
        `\nToo few orders to cross. Voiding so every order refunds in full.`,
      );
    }
    const hash = await submit(
      account,
      {
        contractAddress: VENUE_ADDRESS,
        entrypoint: "void_batch",
        calldata: CallData.compile([num.toHex(batchId)]),
      },
      "void_batch",
    );
    recordTransaction(hash);
    return;
  }

  // Routing hints only. A limit that stops the swap short reverts on
  // INPUT_NOT_CLEARED, and the output floor is read from storage, so passing
  // zero here is safe rather than permissive.
  const hash = await submit(
    account,
    {
      contractAddress: VENUE_ADDRESS,
      entrypoint: "settle",
      calldata: CallData.compile([num.toHex(batchId), "0x0", "0x0", "0x0"]),
    },
    "settle",
  );
  recordTransaction(hash);

  const after = await provider.callContract({
    contractAddress: VENUE_ADDRESS,
    entrypoint: "get_batch",
    calldata: [num.toHex(batchId)],
  });
  const settled = decodeBatch(batchId, after as string[]);
  console.log(`\n  cleared   ${settled.netOut}`);
  console.log(`  state     ${settled.state}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
