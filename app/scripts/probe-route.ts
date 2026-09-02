/**
 * Finds an initialised, liquid Ekubo pool for a token pair by asking Core
 * directly. The public API paths move around; Core does not.
 *
 * Usage: npm run probe:route
 */
// Must be first: populates process.env before config.ts is evaluated.
import "./env";
import { RpcProvider, hash, num } from "starknet";
import { EKUBO_CORE, RPC_URLS, STRK, USDC } from "../src/lib/config";

const FEE_TIERS: { label: string; fee: bigint; tickSpacing: bigint }[] = [
  { label: "0.01%", fee: (1n << 128n) / 10_000n, tickSpacing: 200n },
  { label: "0.05%", fee: (5n << 128n) / 10_000n, tickSpacing: 1_000n },
  { label: "0.30%", fee: (30n << 128n) / 10_000n, tickSpacing: 5_982n },
  { label: "1.00%", fee: (100n << 128n) / 10_000n, tickSpacing: 19_802n },
  { label: "5.00%", fee: (500n << 128n) / 10_000n, tickSpacing: 39_601n },
];

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC_URLS[0] });

  const [token0, token1] =
    BigInt(STRK.address) < BigInt(USDC.address)
      ? [STRK, USDC]
      : [USDC, STRK];

  console.log(`token0 ${token0.symbol} ${token0.address}`);
  console.log(`token1 ${token1.symbol} ${token1.address}`);
  console.log();

  for (const tier of FEE_TIERS) {
    const poolKey = [
      token0.address,
      token1.address,
      num.toHex(tier.fee),
      num.toHex(tier.tickSpacing),
      "0x0",
    ];

    try {
      const price = await provider.callContract({
        contractAddress: EKUBO_CORE,
        entrypoint: "get_pool_price",
        calldata: poolKey,
      });
      const sqrtRatio = BigInt(price[0]) + (BigInt(price[1]) << 128n);

      const liquidity = await provider.callContract({
        contractAddress: EKUBO_CORE,
        entrypoint: "get_pool_liquidity",
        calldata: poolKey,
      });

      const initialised = sqrtRatio !== 0n;
      console.log(
        `${tier.label.padEnd(6)} tickSpacing=${tier.tickSpacing
          .toString()
          .padEnd(6)} initialised=${initialised ? "yes" : "no "} liquidity=${BigInt(
          liquidity[0],
        )}`,
      );
      if (initialised) {
        console.log(`         fee=${num.toHex(tier.fee)}`);
      }
    } catch (error) {
      console.log(
        `${tier.label.padEnd(6)} tickSpacing=${tier.tickSpacing
          .toString()
          .padEnd(6)} unavailable (${(error as Error).message.slice(0, 70)})`,
      );
    }
  }

  console.log();
  console.log("selector privacy_invoke =", hash.getSelectorFromName("privacy_invoke"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
