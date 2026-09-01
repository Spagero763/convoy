import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Account, RpcProvider, type Call } from "starknet";
import { RPC_URLS } from "../src/lib/config";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const ARTIFACT_DIR = resolve(process.cwd(), "../contracts/target/dev");

export function artifacts() {
  return {
    sierra: JSON.parse(
      readFileSync(
        resolve(ARTIFACT_DIR, "convoy_ConvoyVenue.contract_class.json"),
        "utf8",
      ),
    ),
    casm: JSON.parse(
      readFileSync(
        resolve(ARTIFACT_DIR, "convoy_ConvoyVenue.compiled_contract_class.json"),
        "utf8",
      ),
    ),
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: process.env.RPC_URL ?? RPC_URLS[1] });
}

export function getAccount(provider: RpcProvider): Account {
  return new Account({
    provider,
    address: requireEnv("DEPLOYER_ADDRESS"),
    signer: requireEnv("DEPLOYER_PRIVATE_KEY"),
  });
}

export async function submit(
  account: Account,
  calls: Call | Call[],
  label: string,
): Promise<string> {
  console.log(`\n${label}`);
  const { transaction_hash } = await account.execute(calls);
  console.log(`  tx     ${transaction_hash}`);
  console.log(`  waiting for acceptance`);
  await account.waitForTransaction(transaction_hash);
  console.log(`  https://voyager.online/tx/${transaction_hash}`);
  return transaction_hash;
}

/**
 * Appends a hash to the `transactions` array in strk20.json so the record of
 * mainnet activity is built as it happens rather than reconstructed later.
 */
export function recordTransaction(hash: string): void {
  const path = resolve(process.cwd(), "../strk20.json");
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(manifest.transactions)) manifest.transactions = [];
    if (!manifest.transactions.includes(hash)) {
      manifest.transactions.push(hash);
      require("node:fs").writeFileSync(
        path,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      console.log(`  recorded in strk20.json`);
    }
  } catch (error) {
    console.warn(`  could not update strk20.json: ${(error as Error).message}`);
  }
}
