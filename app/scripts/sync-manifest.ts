/**
 * Rebuilds `strk20.json` transactions from chain events.
 *
 * A hash only counts if it exists, succeeded, touched the STRK20 pool, and ran
 * through the venue. Joins and redemptions qualify. Scheduling, settlement and
 * voiding do not: they are direct calls that never reach the pool.
 *
 * Two things this script refuses to do, both learned the hard way:
 *
 *  - It never scans from block 0. This RPC answers such a range with an empty
 *    result rather than an error, which reads as "no activity" and is a lie.
 *  - It never shrinks the list. If a scan finds fewer hashes than the file
 *    already holds, that is a failed scan, not a corrected one, and the file is
 *    left alone unless --force is passed.
 *
 * Usage: npm run manifest:sync
 */
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POOL_ADDRESS, VENUE_ADDRESS } from "../src/lib/config";
import { resolveProvider, getProvider } from "./shared";

/** Comfortably before the venue was deployed. */
const FROM_BLOCK = Number(process.env.SCAN_FROM_BLOCK ?? 14_250_000);

const MANIFEST = resolve(process.cwd(), "../strk20.json");

async function main() {
  const provider = await resolveProvider();
  const head = (await provider.getBlockLatestAccepted()).block_number;
  console.log(`scanning ${FROM_BLOCK} to ${head} for events from the venue\n`);

  const hashes: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 40; page += 1) {
    const chunk = await provider.getEvents({
      address: VENUE_ADDRESS,
      from_block: { block_number: FROM_BLOCK },
      to_block: { block_number: head },
      chunk_size: 1000,
      continuation_token: cursor,
    });
    for (const event of chunk.events) {
      if (!hashes.includes(event.transaction_hash)) hashes.push(event.transaction_hash);
    }
    cursor = chunk.continuation_token;
    if (!cursor) break;
  }

  if (hashes.length === 0) {
    console.error("No venue events found at all. Refusing to touch the manifest.");
    process.exit(1);
  }

  const qualifying: string[] = [];
  for (const hash of hashes) {
    const receipt = (await provider.getTransactionReceipt(hash)) as {
      execution_status?: string;
      events?: { from_address: string }[];
    };
    const succeeded = receipt.execution_status === "SUCCEEDED";
    const touchedPool = (receipt.events ?? []).some(
      (event) => BigInt(event.from_address) === BigInt(POOL_ADDRESS),
    );
    const qualifies = succeeded && touchedPool;
    console.log(
      `  ${hash}  ${succeeded ? "ok" : "FAILED"}  pool=${touchedPool ? "yes" : "no "}  ${
        qualifies ? "QUALIFIES" : "does not count"
      }`,
    );
    if (qualifies) qualifying.push(hash);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const existing: string[] = Array.isArray(manifest.transactions)
    ? manifest.transactions
    : [];

  const force = process.argv.includes("--force");
  if (qualifying.length < existing.length && !force) {
    console.error(
      `\nScan found ${qualifying.length} qualifying, file holds ${existing.length}.`,
    );
    console.error("That is a failed scan, not a correction. Manifest left untouched.");
    process.exit(1);
  }

  // Union, so a hash recorded by another route is never dropped.
  const merged = [...existing];
  for (const hash of qualifying) {
    if (!merged.some((h) => BigInt(h) === BigInt(hash))) merged.push(hash);
  }

  manifest.transactions = merged;
  if (!manifest.contracts?.some((c: string) => BigInt(c) === BigInt(VENUE_ADDRESS))) {
    manifest.contracts = [...(manifest.contracts ?? []), VENUE_ADDRESS];
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nqualifying transactions: ${merged.length}`);
  merged.forEach((h) => console.log(`  ${h}`));
  console.log(
    merged.length >= 3
      ? "\nThe three-transaction requirement is met."
      : `\n${3 - merged.length} more needed. Joins and claims both count.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
