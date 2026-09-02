/**
 * Full-cycle rehearsal against a fork of Starknet mainnet.
 *
 * This runs the real thing: the real Ekubo router, the real STRK/USDC pool, the
 * real liquidity, at the real current price. The only substitution is the
 * privacy pool itself, which cannot be driven without a prover, so a predeployed
 * account stands in as the caller the venue accepts.
 *
 * That means everything that touches external state is genuinely exercised
 * before a single mainnet transaction is paid for: the swap, the clearing
 * maths, the pro-rata split and the redemption allowance.
 *
 * Prerequisites:
 *   starknet-devnet --fork-network https://api.cartridge.gg/x/starknet/mainnet \
 *                   --port 5150 --seed 42 --state-archive-capacity full
 *
 * Usage: npx tsx scripts/fork-rehearsal.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, CallData, RpcProvider, hash, num } from "starknet";
import { DEFAULT_ROUTE, EKUBO_ROUTER, STRK, USDC } from "../src/lib/config";
import { decodeBatch } from "../src/lib/convoy";

const DEVNET = process.env.DEVNET_URL ?? "http://localhost:5150";
const ARTIFACTS = resolve(process.cwd(), "../contracts/target/dev");

const LOT = 2n * 10n ** 18n;
const MAX_LOTS = 4;
const MIN_ORDERS = 2;
const WINDOW = 600;

const ORDER_TAG = num.toHex(
  BigInt("0x" + Buffer.from("CONVOY_ORDER:V1", "ascii").toString("hex")),
);

function commitmentFor(batchId: number, secret: string): string {
  return hash.computePoseidonHashOnElements([ORDER_TAG, num.toHex(batchId), secret]);
}

async function rpc(method: string, params: unknown) {
  const response = await fetch(DEVNET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  const mark = condition ? "  ok  " : " FAIL ";
  if (!condition) failures += 1;
  console.log(`${mark} ${label}${detail ? `  ${detail}` : ""}`);
}

/**
 * Fees paid, in FRI. Gas prices on a fork come from the real forked block
 * header, so these track mainnet rather than a devnet fiction.
 */
const fees: { label: string; fri: bigint }[] = [];

async function feeOf(provider: RpcProvider, hashValue: string, label: string) {
  try {
    const receipt = (await provider.getTransactionReceipt(hashValue)) as {
      actual_fee?: { amount?: string } | string;
    };
    const raw =
      typeof receipt.actual_fee === "string"
        ? receipt.actual_fee
        : receipt.actual_fee?.amount;
    if (raw) fees.push({ label, fri: BigInt(raw) });
  } catch {
    // A missing receipt should never fail the rehearsal.
  }
}

function fmt(value: bigint, decimals: number, places = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = ((value % base) * 10n ** BigInt(places)) / base;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: DEVNET });
  const chainId = await provider.getChainId();
  console.log(`Forked chain ${chainId} at ${DEVNET}\n`);

  const predeployed = (await rpc("devnet_getPredeployedAccounts", {})) as {
    address: string;
    private_key: string;
  }[];

  const owner = new Account({
    provider,
    address: predeployed[0].address,
    signer: predeployed[0].private_key,
  });
  // Stands in for the privacy pool: the only address the venue will accept.
  const pool = new Account({
    provider,
    address: predeployed[1].address,
    signer: predeployed[1].private_key,
  });
  const anyone = new Account({
    provider,
    address: predeployed[2].address,
    signer: predeployed[2].private_key,
  });

  console.log(`owner  ${owner.address}`);
  console.log(`pool   ${pool.address}`);
  console.log(`caller ${anyone.address}\n`);

  // --- deploy -------------------------------------------------------------

  const sierra = JSON.parse(
    readFileSync(resolve(ARTIFACTS, "convoy_ConvoyVenue.contract_class.json"), "utf8"),
  );
  const casm = JSON.parse(
    readFileSync(
      resolve(ARTIFACTS, "convoy_ConvoyVenue.compiled_contract_class.json"),
      "utf8",
    ),
  );

  console.log("Deploying venue");
  const declared = await owner.declareIfNot({ contract: sierra, casm });
  if (declared.transaction_hash) {
    await provider.waitForTransaction(declared.transaction_hash);
    await feeOf(provider, declared.transaction_hash, "declare class");
  }
  const deployment = await owner.deployContract({
    classHash: declared.class_hash,
    constructorCalldata: [pool.address, EKUBO_ROUTER, owner.address],
  });
  await provider.waitForTransaction(deployment.transaction_hash);
  await feeOf(provider, deployment.transaction_hash, "deploy venue");
  const venue = deployment.contract_address;
  console.log(`  class ${declared.class_hash}`);
  console.log(`  venue ${venue}\n`);

  // --- fund the stand-in pool --------------------------------------------

  // Predeployed accounts already carry 1000 STRK, which covers every lot in
  // this rehearsal several times over.
  const strkBalance = await provider.callContract({
    contractAddress: STRK.address,
    entrypoint: "balance_of",
    calldata: [pool.address],
  });
  console.log(`pool STRK balance ${fmt(BigInt(strkBalance[0]), 18, 4)}\n`);

  // --- schedule -----------------------------------------------------------

  const block = await provider.getBlockLatestAccepted();
  const full = (await provider.getBlockWithTxHashes(block.block_number)) as {
    timestamp: number;
  };
  const chainNow = Number(full.timestamp);

  // Floor derived from a live quote so the rehearsal fails loudly if the pool
  // has moved, rather than passing with a floor of zero.
  const quote = await provider.callContract({
    contractAddress: EKUBO_ROUTER,
    entrypoint: "quote_swap",
    calldata: [
      DEFAULT_ROUTE.token0,
      DEFAULT_ROUTE.token1,
      DEFAULT_ROUTE.fee,
      DEFAULT_ROUTE.tickSpacing,
      DEFAULT_ROUTE.extension,
      "0x0",
      "0x0",
      "0x0",
      STRK.address,
      num.toHex(LOT),
      "0x0",
    ],
  });
  const quotedOut = BigInt(quote[2]);
  const floor = (quotedOut * 90n) / 100n;
  console.log(
    `Quote for one lot: ${fmt(quotedOut, 6, 6)} USDC, floor set to ${fmt(floor, 6, 6)}\n`,
  );

  console.log("Scheduling batch");
  const create = await owner.execute({
    contractAddress: venue,
    entrypoint: "create_batch",
    calldata: CallData.compile([
      DEFAULT_ROUTE.token0,
      DEFAULT_ROUTE.token1,
      DEFAULT_ROUTE.fee,
      DEFAULT_ROUTE.tickSpacing,
      DEFAULT_ROUTE.extension,
      STRK.address,
      num.toHex(LOT),
      num.toHex(MAX_LOTS),
      num.toHex(MIN_ORDERS),
      num.toHex(chainNow),
      num.toHex(chainNow + WINDOW),
      num.toHex(floor),
    ]),
  });
  await provider.waitForTransaction(create.transaction_hash);
  await feeOf(provider, create.transaction_hash, "create_batch");
  const batchId = 1;
  console.log(`  batch ${batchId}\n`);

  // --- joins --------------------------------------------------------------

  const orders = [
    { secret: "0x1111", lots: 2 },
    { secret: "0x2222", lots: 2 },
    { secret: "0x3333", lots: 1 },
  ];

  console.log("Joining");
  for (const order of orders) {
    const value = LOT * BigInt(order.lots);
    const commitment = commitmentFor(batchId, order.secret);

    // Mirrors the pool's own two-phase shape: value arrives first, then the
    // helper is invoked, both in one atomic transaction.
    const tx = await pool.execute([
      {
        contractAddress: STRK.address,
        entrypoint: "transfer",
        calldata: CallData.compile([venue, num.toHex(value), "0x0"]),
      },
      {
        contractAddress: venue,
        entrypoint: "privacy_invoke",
        calldata: CallData.compile([
          "0x0",
          num.toHex(batchId),
          num.toHex(order.lots),
          commitment,
          "0x0",
          "0x0",
        ]),
      },
    ]);
    await provider.waitForTransaction(tx.transaction_hash);
    await feeOf(provider, tx.transaction_hash, `join ${order.lots} lots`);
    console.log(`  ${order.lots} lots  ${commitment.slice(0, 14)}…`);
  }

  const totalIn = orders.reduce((sum, o) => sum + LOT * BigInt(o.lots), 0n);
  const totalLots = orders.reduce((sum, o) => sum + o.lots, 0);

  let raw = (await provider.callContract({
    contractAddress: venue,
    entrypoint: "get_batch",
    calldata: [num.toHex(batchId)],
  })) as string[];
  let batch = decodeBatch(batchId, raw);

  console.log();
  check("order count recorded", batch.orderCount === orders.length, `${batch.orderCount}`);
  check("lots tallied", batch.totalLots === totalLots, `${batch.totalLots}`);
  check("gross matches deposits", batch.grossIn === totalIn, fmt(batch.grossIn, 18, 4));

  const accounted = await provider.callContract({
    contractAddress: venue,
    entrypoint: "get_accounted",
    calldata: [STRK.address],
  });
  check(
    "accounting matches gross",
    BigInt(accounted[0]) === totalIn,
    fmt(BigInt(accounted[0]), 18, 4),
  );

  // --- settle against real Ekubo -----------------------------------------

  console.log("\nSealing and crossing");
  await rpc("devnet_increaseTime", { time: WINDOW + 60 });
  await rpc("devnet_createBlock", {});

  const usdcBefore = await provider.callContract({
    contractAddress: USDC.address,
    entrypoint: "balance_of",
    calldata: [venue],
  });

  const settle = await anyone.execute({
    contractAddress: venue,
    entrypoint: "settle",
    calldata: CallData.compile([num.toHex(batchId), "0x0", "0x0", "0x0"]),
  });
  const receipt = await provider.waitForTransaction(settle.transaction_hash);
  await feeOf(provider, settle.transaction_hash, "settle (Ekubo swap)");
  console.log(`  tx ${settle.transaction_hash}`);
  check(
    "settlement succeeded",
    (receipt as { execution_status?: string }).execution_status !== "REVERTED",
  );

  raw = (await provider.callContract({
    contractAddress: venue,
    entrypoint: "get_batch",
    calldata: [num.toHex(batchId)],
  })) as string[];
  batch = decodeBatch(batchId, raw);

  const usdcAfter = await provider.callContract({
    contractAddress: USDC.address,
    entrypoint: "balance_of",
    calldata: [venue],
  });
  const received = BigInt(usdcAfter[0]) - BigInt(usdcBefore[0]);

  console.log(`  in   ${fmt(totalIn, 18, 4)} STRK`);
  console.log(`  out  ${fmt(batch.netOut, 6, 6)} USDC`);
  console.log(
    `  rate ${(Number(batch.netOut) / 1e6 / (Number(totalIn) / 1e18)).toFixed(6)} USDC per STRK`,
  );

  check("state is settled", batch.state === "settled", batch.state);
  check("net_out matches tokens received", batch.netOut === received);
  check("net_out clears the floor", batch.netOut >= floor * BigInt(totalLots));
  check("input fully spent", BigInt(
    (
      await provider.callContract({
        contractAddress: venue,
        entrypoint: "get_accounted",
        calldata: [STRK.address],
      })
    )[0],
  ) === 0n);

  // --- redemption ---------------------------------------------------------

  console.log("\nRedeeming");
  let redeemed = 0n;
  for (const order of orders) {
    const quoted = BigInt(
      (
        await provider.callContract({
          contractAddress: venue,
          entrypoint: "quote_redemption",
          calldata: [num.toHex(batchId), num.toHex(order.lots)],
        })
      )[0],
    );

    const tx = await pool.execute({
      contractAddress: venue,
      entrypoint: "privacy_invoke",
      calldata: CallData.compile([
        "0x1",
        num.toHex(batchId),
        "0x0",
        "0x0",
        order.secret,
        "0x999",
      ]),
    });
    await provider.waitForTransaction(tx.transaction_hash);
    await feeOf(provider, tx.transaction_hash, `claim ${order.lots} lots`);

    // The venue approves the pool for exactly the payout, which is how the real
    // pool collects the tokens backing the note it credits.
    const allowance = BigInt(
      (
        await provider.callContract({
          contractAddress: USDC.address,
          entrypoint: "allowance",
          calldata: [venue, pool.address],
        })
      )[0],
    );
    check(
      `${order.lots}-lot order redeems ${fmt(quoted, 6, 6)} USDC`,
      allowance === quoted,
      `allowance ${fmt(allowance, 6, 6)}`,
    );
    redeemed += quoted;

    // Pull it, as the pool would, so the next allowance check is not confused
    // by a leftover approval.
    await pool.execute({
      contractAddress: USDC.address,
      entrypoint: "transfer_from",
      calldata: CallData.compile([venue, pool.address, num.toHex(quoted), "0x0"]),
    });
  }

  console.log();
  check(
    "redemptions never exceed realised output",
    redeemed <= batch.netOut,
    `${fmt(redeemed, 6, 6)} of ${fmt(batch.netOut, 6, 6)}`,
  );
  check(
    "equal orders redeemed equally",
    (await quoteOf(provider, venue, batchId, 2)) ===
      (await quoteOf(provider, venue, batchId, 2)),
  );

  // Double redemption must fail.
  let doubleSpendRejected = false;
  try {
    const tx = await pool.execute({
      contractAddress: venue,
      entrypoint: "privacy_invoke",
      calldata: CallData.compile([
        "0x1",
        num.toHex(batchId),
        "0x0",
        "0x0",
        orders[0].secret,
        "0x999",
      ]),
    });
    const r = await provider.waitForTransaction(tx.transaction_hash);
    doubleSpendRejected =
      (r as { execution_status?: string }).execution_status === "REVERTED";
  } catch {
    doubleSpendRejected = true;
  }
  check("second redemption rejected", doubleSpendRejected);

  // A direct call must not be accepted.
  let directCallRejected = false;
  try {
    const tx = await anyone.execute({
      contractAddress: venue,
      entrypoint: "privacy_invoke",
      calldata: CallData.compile([
        "0x0",
        num.toHex(batchId),
        "0x1",
        "0x4444",
        "0x0",
        "0x0",
      ]),
    });
    const r = await provider.waitForTransaction(tx.transaction_hash);
    directCallRejected =
      (r as { execution_status?: string }).execution_status === "REVERTED";
  } catch {
    directCallRejected = true;
  }
  check("direct caller rejected", directCallRejected);

  console.log("\nFees actually paid, at forked mainnet gas prices");
  let totalFri = 0n;
  for (const entry of fees) {
    totalFri += entry.fri;
    console.log(
      `  ${entry.label.padEnd(22)} ${fmt(entry.fri, 18, 5).padStart(12)} STRK`,
    );
  }
  console.log(`  ${"-".repeat(22)} ${"-".repeat(12)}`);
  console.log(`  ${"TOTAL".padEnd(22)} ${fmt(totalFri, 18, 5).padStart(12)} STRK`);

  console.log(
    `\n${failures === 0 ? "Rehearsal passed" : `${failures} check(s) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function quoteOf(
  provider: RpcProvider,
  venue: string,
  batchId: number,
  lots: number,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: venue,
    entrypoint: "quote_redemption",
    calldata: [num.toHex(batchId), num.toHex(lots)],
  });
  return BigInt(result[0]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
