import { num } from "starknet";
import { VENUE_ADDRESS } from "./config";

/**
 * STRK20 action arrays for the three private operations.
 *
 * Two shapes exist and only one of each works. Value moving *into* a helper is
 * `withdraw` then `invoke`; value coming *out* as a note is `transfer` with the
 * literal amount `OPEN` then `invoke`. An `invoke` on its own is rejected by the
 * wallet API with `INVALID_REQUEST_PAYLOAD` before anything is signed, which is
 * why every private action here costs two wallet approvals. That is a property
 * of the wallet API, not something the app can collapse.
 *
 * `${openNoteIds[0]}` is a placeholder the wallet substitutes once it has
 * allocated the note. It must be passed through verbatim.
 */

export type Strk20Action =
  | { type: "deposit"; token: string; amount: string }
  | { type: "withdraw"; token: string; amount: string; recipient: string }
  | { type: "transfer"; token: string; amount: string; recipient: string }
  | { type: "invoke"; contract: string; calldata: string[] };

const OP_JOIN = "0x0";
const OP_CLAIM = "0x1";
const OP_REFUND = "0x2";

const OPEN_NOTE = "${openNoteIds[0]}";

export function lotValue(lotSize: bigint, lots: number): bigint {
  return lotSize * BigInt(lots);
}

/**
 * Moves public funds into the pool. This is the one action that is not private:
 * the depositing address and the amount are both visible, and the pool screens
 * the depositor. Shielding is the cost of entry, not the privacy.
 */
export function buildShieldActions(token: string, amount: bigint): Strk20Action[] {
  return [{ type: "deposit", token, amount: num.toHex(amount) }];
}

export function buildJoinActions(params: {
  batchId: number;
  lots: number;
  tokenIn: string;
  lotSize: bigint;
  commitment: string;
}): Strk20Action[] {
  const amount = lotValue(params.lotSize, params.lots);
  return [
    {
      type: "withdraw",
      token: params.tokenIn,
      amount: num.toHex(amount),
      recipient: VENUE_ADDRESS,
    },
    {
      type: "invoke",
      contract: VENUE_ADDRESS,
      calldata: [
        OP_JOIN,
        num.toHex(params.batchId),
        num.toHex(params.lots),
        params.commitment,
        "0x0",
        "0x0",
      ],
    },
  ];
}

export function buildRedeemActions(params: {
  batchId: number;
  secret: string;
  token: string;
  recipient: string;
  refunding: boolean;
}): Strk20Action[] {
  return [
    {
      type: "transfer",
      token: params.token,
      amount: "OPEN",
      recipient: params.recipient,
    },
    {
      type: "invoke",
      contract: VENUE_ADDRESS,
      calldata: [
        params.refunding ? OP_REFUND : OP_CLAIM,
        num.toHex(params.batchId),
        "0x0",
        "0x0",
        params.secret,
        OPEN_NOTE,
      ],
    },
  ];
}

/** How many wallet approvals a given action array will raise. */
export function approvalCount(actions: Strk20Action[]): number {
  return actions.length;
}
