import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Account, RpcProvider, type Call } from "starknet";
import { RPC_URLS } from "../src/lib/config";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

/**
 * Which build to declare. Release strips debug identifiers, which is the only
 * lever that meaningfully changes what a declare costs, since the fee is priced
 * on the Sierra the sequencer has to compile.
 */
const PROFILE = process.env.SCARB_PROFILE ?? "release";
const ARTIFACT_DIR = resolve(process.cwd(), `../contracts/target/${PROFILE}`);

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

let cachedProvider: RpcProvider | null = null;

/**
 * Picks an endpoint that is actually answering.
 *
 * The app rotates providers on failure; these scripts used to pin one, so a
 * single endpoint having a bad minute aborted a deployment step with a bare
 * "fetch failed". Resolution happens once per process and is then reused.
 */
export async function resolveProvider(): Promise<RpcProvider> {
  if (cachedProvider) return cachedProvider;

  const candidates = [process.env.RPC_URL, ...RPC_URLS].filter(Boolean) as string[];
  const tried: string[] = [];

  for (const nodeUrl of candidates) {
    if (tried.includes(nodeUrl)) continue;
    tried.push(nodeUrl);
    try {
      const provider = new RpcProvider({ nodeUrl });
      await provider.getChainId();
      if (nodeUrl !== candidates[0]) console.log(`  rpc: using ${nodeUrl}`);
      cachedProvider = provider;
      return provider;
    } catch {
      console.log(`  rpc: ${nodeUrl} not answering, trying the next`);
    }
  }
  throw new Error(`No RPC endpoint answered. Tried: ${tried.join(", ")}`);
}

export function getProvider(): RpcProvider {
  return cachedProvider ?? new RpcProvider({ nodeUrl: process.env.RPC_URL ?? RPC_URLS[1] });
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

  const receipt = await getProvider().waitForTransaction(transaction_hash);
  const status = (receipt as { execution_status?: string }).execution_status;
  if (status === "REVERTED") {
    throw new Error(
      `${label} reverted: ${
        (receipt as { revert_reason?: string }).revert_reason ?? "no reason given"
      }`,
    );
  }

  console.log(`  https://voyager.online/tx/${transaction_hash}`);
  return transaction_hash;
}

/**
 * Appends a hash to the `transactions` array in strk20.json.
 *
 * Only calls that actually reach the privacy pool belong here. Scheduling and
 * settling talk to the venue directly, never through the pool, so recording
 * them would fill the manifest with hashes that look like activity and count
 * for nothing.
 */
export function recordTransaction(hash: string, touchesPool = false): void {
  if (!touchesPool) {
    console.log(`  not recorded in strk20.json: this call does not reach the pool`);
    return;
  }
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
