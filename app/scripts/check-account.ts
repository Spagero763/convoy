/**
 * Validates a deployer account before anything is spent.
 *
 * Answers the four questions that otherwise waste a funded attempt:
 *   1. Does the account exist on chain? A funded but never-used Starknet
 *      account is not deployed, and cannot send anything.
 *   2. Does this private key actually control it? Wallets export keys in
 *      several shapes and the wrong one fails at signing time.
 *   3. Is there enough STRK?
 *   4. What does the declare actually cost? This is an estimate from the live
 *      network, not a guess.
 *
 * Usage: npx tsx scripts/check-account.ts
 */
import { Account, RpcProvider, ec, num } from "starknet";
import { STRK } from "../src/lib/config";
import { artifacts, getAccount, getProvider, requireEnv } from "./shared";

function fmt(value: bigint, decimals = 18, places = 5): string {
  const base = 10n ** BigInt(decimals);
  const frac = ((value % base) * 10n ** BigInt(places)) / base;
  return `${value / base}.${frac.toString().padStart(places, "0")}`;
}

async function main() {
  const provider = getProvider();
  const address = requireEnv("DEPLOYER_ADDRESS");
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");

  console.log(`chain    ${await provider.getChainId()}`);
  console.log(`address  ${address}\n`);

  // 1. Deployed?
  let deployed = false;
  try {
    const classHash = await provider.getClassHashAt(address);
    deployed = true;
    console.log(`deployed yes, class ${classHash}`);
  } catch {
    console.log("deployed NO");
    console.log(
      "\n  This account has never sent a transaction, so it does not exist on chain yet.",
    );
    console.log(
      "  Send any amount out of it from your wallet once. The wallet deploys it as part",
    );
    console.log("  of that transfer. Then run this again.");
    process.exit(1);
  }

  // 2. Balance.
  const balanceRaw = await provider.callContract({
    contractAddress: STRK.address,
    entrypoint: "balance_of",
    calldata: [address],
  });
  const balance = BigInt(balanceRaw[0]);
  console.log(`balance  ${fmt(balance)} STRK`);

  // 3. Does the key control the account? Account contracts expose their owner
  // public key under one of a few names depending on the wallet.
  const derived = num.toHex(ec.starkCurve.getStarkKey(privateKey));
  let matched: string | null = null;
  for (const entrypoint of ["get_owner", "getPublicKey", "get_public_key", "getSigner"]) {
    try {
      const result = await provider.callContract({
        contractAddress: address,
        entrypoint,
        calldata: [],
      });
      if (result?.[0] && BigInt(result[0]) === BigInt(derived)) {
        matched = entrypoint;
        break;
      }
      if (result?.[0]) {
        console.log(
          `\n  ${entrypoint} returned ${num.toHex(BigInt(result[0]))}`,
        );
        console.log(`  key derives  ${derived}`);
      }
    } catch {
      // Entrypoint not present on this account class. Try the next.
    }
  }
  console.log(
    `key      ${matched ? `controls this account (via ${matched})` : "could not be confirmed by a read"}`,
  );

  // 4. The real cost of the expensive operation, from the live network.
  const { sierra, casm } = artifacts();
  const account = getAccount(provider);
  try {
    const estimate = await account.estimateDeclareFee({ contract: sierra, casm });
    const fee = BigInt(estimate.overall_fee ?? 0n);
    console.log(`\ndeclare  ~${fmt(fee)} STRK  (the most expensive step)`);

    // Signing succeeded, which proves the key far better than any read can.
    console.log("key      confirmed by signing the estimate");

    const headroom = balance > fee ? balance - fee : 0n;
    console.log(`left     ~${fmt(headroom)} STRK after declaring`);
    if (headroom < fee) {
      console.log(
        "\n  Thin. That leaves less than the declare cost again, so a retry would not fit.",
      );
    }
  } catch (error) {
    const text = String(error);
    if (text.includes("class already declared") || text.includes("is already declared")) {
      console.log("\ndeclare  already declared, this step is free");
    } else {
      console.log(`\ndeclare  could not estimate: ${text.slice(0, 200)}`);
      console.log(
        "\n  If this mentions a signature or validation failure, the exported key does not",
      );
      console.log(
        "  match this account class. Tell me and I will switch to a standalone account.",
      );
      process.exit(1);
    }
  }

  console.log("\nReady to deploy.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
