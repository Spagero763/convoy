export const CHAIN_ID = "0x534e5f4d41494e";
export const CHAIN_NAME = "Starknet Mainnet";

/**
 * Read endpoints, tried in order. The client rotates on failure rather than
 * pinning one provider, so a single endpoint going down degrades latency
 * instead of taking the board offline.
 *
 * Checked against the live network rather than taken from documentation:
 * Blast is decommissioned and returns an error to every request, and Nethermind's
 * free endpoint answers nothing. Lava works but load-balances across backends
 * reporting different JSON-RPC spec versions (0.8.1 and 0.10.2 on alternating
 * calls), which is survivable for reads but not something to put first.
 */
export const RPC_URLS = [
  process.env.NEXT_PUBLIC_RPC_URL,
  "https://api.cartridge.gg/x/starknet/mainnet",
  "https://rpc.starknet.lava.build",
  "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_9/demo",
].filter(Boolean) as string[];

/** Canonical STRK20 privacy pool. */
export const POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/** Ekubo Router v3.0.13. */
export const EKUBO_ROUTER =
  "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";

export const EKUBO_CORE =
  "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b";

export const VENUE_ADDRESS = process.env.NEXT_PUBLIC_VENUE_ADDRESS ?? "";

export type TokenInfo = {
  address: string;
  symbol: string;
  decimals: number;
  /** Digits shown in the UI. Never more than the token actually carries. */
  display: number;
};

export const STRK: TokenInfo = {
  address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  symbol: "STRK",
  decimals: 18,
  display: 4,
};

/**
 * The contract self-reports `USDC` / `USD Coin`. This is the bridged token, and
 * some wallets label it `USDC.e` to distinguish it from native USDC. The symbol
 * here follows the contract rather than any wallet's annotation.
 */
export const USDC: TokenInfo = {
  address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  symbol: "USDC",
  decimals: 6,
  display: 2,
};

export const TOKENS: TokenInfo[] = [STRK, USDC];

export function tokenByAddress(address: string): TokenInfo | undefined {
  const target = BigInt(address);
  return TOKENS.find((t) => BigInt(t.address) === target);
}

export type Route = {
  token0: string;
  token1: string;
  fee: string;
  tickSpacing: string;
  extension: string;
};

/**
 * STRK/USDC at 0.05%, the deepest venue for this pair. Discovered by reading
 * `Swapped` events off Ekubo Core rather than trusting a fee-tier guess, and
 * confirmed against `get_pool_liquidity`. Batches pin their route at creation,
 * so this constant only seeds the scheduler.
 */
export const DEFAULT_ROUTE: Route = {
  token0: STRK.address,
  token1: USDC.address,
  fee: "0x20c49ba5e353f80000000000000000",
  tickSpacing: "0x3e8",
  extension: "0x0",
};

export const VOYAGER_TX = "https://voyager.online/tx/";
export const VOYAGER_CONTRACT = "https://voyager.online/contract/";

/** Matches `VOID_GRACE_SECONDS` in the contract. */
export const VOID_GRACE_SECONDS = 86_400;
