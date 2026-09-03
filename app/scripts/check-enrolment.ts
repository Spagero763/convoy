/**
 * Says whether an address has registered a viewing key with the STRK20 pool.
 *
 * `get_public_key` is a view, so this costs nothing and needs no wallet. A zero
 * answer means the account has never enrolled and nothing can be sent to it
 * privately yet.
 *
 * Usage: npx tsx scripts/check-enrolment.ts 0x<address> [0x<address> ...]
 */
import "./env";
import { num } from "starknet";
import { POOL_ADDRESS, STRK } from "../src/lib/config";
import { getProvider } from "./shared";

async function main() {
  const addresses = process.argv.slice(2).filter((a) => a.startsWith("0x"));
  if (addresses.length === 0) {
    console.log("Pass one or more addresses.");
    process.exit(1);
  }

  const provider = getProvider();

  for (const address of addresses) {
    console.log(`\n${address}`);
    try {
      const key = await provider.callContract({
        contractAddress: POOL_ADDRESS,
        entrypoint: "get_public_key",
        calldata: [address],
      });
      const enrolled = BigInt(key[0]) !== 0n;
      console.log(`  enrolled with pool  ${enrolled ? "YES" : "NO"}`);
      if (enrolled) console.log(`  viewing key         ${num.toHex(BigInt(key[0]))}`);
    } catch (error) {
      console.log(`  enrolment check failed: ${(error as Error).message.slice(0, 120)}`);
    }

    try {
      const bal = await provider.callContract({
        contractAddress: STRK.address,
        entrypoint: "balance_of",
        calldata: [address],
      });
      console.log(`  public STRK         ${(Number(BigInt(bal[0])) / 1e18).toFixed(4)}`);
    } catch {
      console.log("  public STRK         unavailable");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
