/**
 * Adds a currently-filling batch to a forked devnet that already ran the
 * rehearsal, so the board can be exercised against live-looking state: one
 * settled batch in the history and one open batch taking orders.
 *
 * Usage: npx tsx scripts/seed-fork.ts <venueAddress>
 */
import { Account, CallData, RpcProvider, hash, num } from "starknet";
import { DEFAULT_ROUTE, STRK } from "../src/lib/config";

const DEVNET = process.env.DEVNET_URL ?? "http://localhost:5150";
const LOT = 2n * 10n ** 18n;

const ORDER_TAG = num.toHex(
  BigInt("0x" + Buffer.from("CONVOY_ORDER:V1", "ascii").toString("hex")),
);

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

async function main() {
  const venue = process.argv[2];
  if (!venue) throw new Error("Pass the venue address");

  const provider = new RpcProvider({ nodeUrl: DEVNET });
  const accounts = (await rpc("devnet_getPredeployedAccounts", {})) as {
    address: string;
    private_key: string;
  }[];

  const owner = new Account({
    provider,
    address: accounts[0].address,
    signer: accounts[0].private_key,
  });
  const pool = new Account({
    provider,
    address: accounts[1].address,
    signer: accounts[1].private_key,
  });

  const block = await provider.getBlockLatestAccepted();
  const full = (await provider.getBlockWithTxHashes(block.block_number)) as {
    timestamp: number;
  };
  const now = Number(full.timestamp);

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
      "0x4",
      "0x2",
      num.toHex(now),
      num.toHex(now + 3600),
      num.toHex(40000),
    ]),
  });
  await provider.waitForTransaction(create.transaction_hash);

  const next = await provider.callContract({
    contractAddress: venue,
    entrypoint: "next_batch_id",
  });
  const batchId = Number(BigInt(next[0])) - 1;
  console.log(`open batch ${batchId}`);

  // A distribution worth looking at: two orders share a size, one does not.
  for (const order of [
    { secret: "0xa1", lots: 2 },
    { secret: "0xa2", lots: 2 },
    { secret: "0xa3", lots: 1 },
    { secret: "0xa4", lots: 3 },
  ]) {
    const commitment = hash.computePoseidonHashOnElements([
      ORDER_TAG,
      num.toHex(batchId),
      order.secret,
    ]);
    const tx = await pool.execute([
      {
        contractAddress: STRK.address,
        entrypoint: "transfer",
        calldata: CallData.compile([
          venue,
          num.toHex(LOT * BigInt(order.lots)),
          "0x0",
        ]),
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
    console.log(`  joined ${order.lots} lots`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
