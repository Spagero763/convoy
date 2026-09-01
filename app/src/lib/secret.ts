import { hash, num, type TypedData, type WeierstrassSignatureType } from "starknet";
import { CHAIN_ID, VENUE_ADDRESS } from "./config";

/**
 * Order keys are derived from a SNIP-12 typed signature, never generated at
 * random and stored.
 *
 * The reason is recoverability. A random secret in local storage is lost with
 * the browser profile, and a lost secret means an unredeemable order. Deriving
 * it from a signature means the wallet is the backup: sign the same structured
 * message again and the same key comes back.
 *
 * This is the same construction the pool itself uses for viewing keys, which
 * folds a signature through Poseidon. It inherits the same assumption, that the
 * wallet signs deterministically. Wallets that randomise `k` would produce a
 * different key on each signature, so the app also lets a key be exported and
 * pasted back, and verifies any derived key against the chain before it is
 * relied on.
 *
 * Nothing derived here is ever transmitted. The signature is produced and
 * folded in the browser.
 */

export function orderKeyTypedData(batchId: number, slot: number): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      OrderKey: [
        { name: "venue", type: "ContractAddress" },
        { name: "batch", type: "felt" },
        { name: "slot", type: "felt" },
        { name: "purpose", type: "shortstring" },
      ],
    },
    primaryType: "OrderKey",
    domain: {
      name: "Convoy",
      version: "1",
      chainId: CHAIN_ID,
      revision: "1",
    },
    message: {
      venue: VENUE_ADDRESS,
      batch: num.toHex(batchId),
      slot: num.toHex(slot),
      purpose: "order key",
    },
  };
}

type SignatureLike = string[] | WeierstrassSignatureType;

/**
 * Folds a signature into a single field element.
 *
 * Wallet signatures arrive in several shapes: a bare `[r, s]`, or a longer
 * array whose first element is a length prefix. The last two elements are `r`
 * and `s` in every shape observed, so the tail is what gets folded.
 */
export function foldSignature(signature: SignatureLike): string {
  const parts = Array.isArray(signature)
    ? signature.map((v) => num.toHex(BigInt(v)))
    : [num.toHex(signature.r), num.toHex(signature.s)];

  if (parts.length < 2) {
    throw new Error("Signature too short to derive an order key");
  }
  const [r, s] = parts.slice(-2);
  return hash.computePoseidonHashOnElements([r, s]);
}

/** Human-transcribable form of a key, for the export/import escape hatch. */
export function encodeKey(secret: string): string {
  return `convoy1:${BigInt(secret).toString(36)}`;
}

export function decodeKey(encoded: string): string {
  const trimmed = encoded.trim();
  const body = trimmed.startsWith("convoy1:") ? trimmed.slice(8) : trimmed;
  if (/^0x[0-9a-fA-F]+$/.test(body)) return num.toHex(BigInt(body));
  if (!/^[0-9a-z]+$/.test(body)) {
    throw new Error("That does not look like an order key");
  }
  let value = 0n;
  for (const char of body) {
    value = value * 36n + BigInt(parseInt(char, 36));
  }
  return num.toHex(value);
}
