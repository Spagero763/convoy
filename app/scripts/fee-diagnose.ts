/**
 * Explains a declare fee estimate, rather than just reporting it.
 *
 * The fork rehearsal measured a declare at 0.79 STRK. A live estimate came back
 * at 60 STRK. One of those is wrong for mainnet and the difference decides
 * whether the deployment is affordable, so this prints the resource amounts and
 * the prices they are multiplied by, at the forked block and at the head.
 */
import { RpcProvider, num } from "starknet";
import { artifacts, getAccount, getProvider } from "./shared";

const FORK_BLOCK = 14219540;

function fmt(value: bigint, decimals = 18, places = 6): string {
  const base = 10n ** BigInt(decimals);
  const frac = ((value % base) * 10n ** BigInt(places)) / base;
  return `${value / base}.${frac.toString().padStart(places, "0")}`;
}

async function gasPrices(provider: RpcProvider, blockId: number | "latest") {
  const block = (await provider.getBlockWithTxHashes(blockId as never)) as {
    block_number?: number;
    l1_gas_price?: { price_in_fri?: string };
    l1_data_gas_price?: { price_in_fri?: string };
    l2_gas_price?: { price_in_fri?: string };
  };
  return {
    number: block.block_number,
    l1: BigInt(block.l1_gas_price?.price_in_fri ?? 0),
    l1Data: BigInt(block.l1_data_gas_price?.price_in_fri ?? 0),
    l2: BigInt(block.l2_gas_price?.price_in_fri ?? 0),
  };
}

async function main() {
  const provider = getProvider();

  const head = await gasPrices(provider, "latest");
  console.log(`Gas prices in FRI per unit\n`);
  console.log(`  head (block ${head.number})`);
  console.log(`    l1_gas       ${head.l1}`);
  console.log(`    l1_data_gas  ${head.l1Data}`);
  console.log(`    l2_gas       ${head.l2}`);

  try {
    const forked = await gasPrices(provider, FORK_BLOCK);
    console.log(`\n  rehearsal fork (block ${forked.number})`);
    console.log(`    l1_gas       ${forked.l1}`);
    console.log(`    l1_data_gas  ${forked.l1Data}`);
    console.log(`    l2_gas       ${forked.l2}`);

    const ratio = (a: bigint, b: bigint) =>
      b === 0n ? "n/a" : `${(Number(a) / Number(b)).toFixed(1)}x`;
    console.log(`\n  head vs fork`);
    console.log(`    l1_gas       ${ratio(head.l1, forked.l1)}`);
    console.log(`    l1_data_gas  ${ratio(head.l1Data, forked.l1Data)}`);
    console.log(`    l2_gas       ${ratio(head.l2, forked.l2)}`);
  } catch (error) {
    console.log(`\n  fork block unavailable: ${(error as Error).message.slice(0, 90)}`);
  }

  const { sierra, casm } = artifacts();
  const account = getAccount(provider);

  console.log(`\n\nDeclare estimate\n`);
  const estimate = (await account.estimateDeclareFee({
    contract: sierra,
    casm,
  })) as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(estimate)) {
    if (typeof value === "object" && value !== null) {
      console.log(`  ${key}`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        console.log(`    ${k.padEnd(24)} ${String(v)}`);
      }
    } else {
      console.log(`  ${key.padEnd(26)} ${String(value)}`);
    }
  }

  const overall = BigInt((estimate.overall_fee as string | bigint) ?? 0n);
  console.log(`\n  overall_fee  ${fmt(overall)} STRK`);

  // starknet.js applies its own multiplier on top of the raw estimate before
  // it is used as a bound. The raw number is what actually gets charged.
  const resourceBounds = estimate.resourceBounds as
    | Record<string, { max_amount?: string; max_price_per_unit?: string }>
    | undefined;
  if (resourceBounds) {
    let bounded = 0n;
    for (const [name, bound] of Object.entries(resourceBounds)) {
      const amount = BigInt(bound.max_amount ?? 0);
      const price = BigInt(bound.max_price_per_unit ?? 0);
      bounded += amount * price;
      console.log(
        `  bound ${name.padEnd(14)} ${amount} units at ${price} = ${fmt(amount * price)} STRK`,
      );
    }
    console.log(`  bounded total  ${fmt(bounded)} STRK  (the ceiling, not the charge)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
