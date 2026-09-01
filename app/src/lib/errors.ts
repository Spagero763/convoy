/**
 * Turns Starknet failures into something a person can act on.
 *
 * Three layers produce errors here and they look nothing alike: our own Cairo
 * asserts, the privacy pool and its wallet API, and the paymaster that actually
 * submits the transaction. The paymaster is the worst of the three because it
 * reports `TRANSACTION_EXECUTION_ERROR` with no revert reason at all, so the
 * best we can do is name the likely cause rather than pretend to know.
 */

export type Explained = {
  /** One line, no jargon. */
  title: string;
  /** What to do next. Omitted when there is genuinely nothing to do. */
  action?: string;
  /** The raw string, kept for the details disclosure. */
  raw: string;
  kind: "rejected" | "contract" | "wallet" | "network" | "unknown";
};

const CONTRACT_CODES: Record<string, { title: string; action?: string }> = {
  CONVOY_NOT_POOL: {
    title: "This call has to come from the privacy pool.",
    action: "Join through the app so the pool routes the call for you.",
  },
  CONVOY_NOT_OWNER: { title: "Only the venue operator can schedule batches." },
  CONVOY_REENTRANT: { title: "The venue is already mid-operation." },
  CONVOY_JOINS_PAUSED: {
    title: "New orders are paused.",
    action: "Existing orders can still be claimed or refunded.",
  },
  CONVOY_NO_BATCH: { title: "That batch does not exist." },
  CONVOY_BATCH_NOT_OPEN: {
    title: "This batch is no longer accepting orders.",
    action: "Join the next one from the board.",
  },
  CONVOY_BATCH_NOT_SETTLED: {
    title: "This batch has not settled yet.",
    action: "Claims open the moment the aggregate swap lands.",
  },
  CONVOY_BATCH_NOT_VOIDED: {
    title: "This batch settled normally, so there is nothing to refund.",
    action: "Claim your share instead.",
  },
  CONVOY_NOT_YET_OPEN: { title: "This batch has not opened yet." },
  CONVOY_ALREADY_SEALED: {
    title: "This batch sealed before your order arrived.",
    action: "Nothing was taken. Join the next batch.",
  },
  CONVOY_NOT_SEALED: { title: "This batch is still open, so it cannot settle yet." },
  CONVOY_GRACE_PENDING: {
    title: "Too early to void this batch.",
    action: "Voiding is only allowed once the settlement window has fully elapsed.",
  },
  CONVOY_ZERO_LOTS: { title: "An order needs at least one lot." },
  CONVOY_TOO_MANY_LOTS: {
    title: "That is more lots than this batch allows.",
    action: "Large orders are capped on purpose, so no single leg stands out.",
  },
  CONVOY_CMT_EXISTS: {
    title: "That order key has already been used.",
    action: "Reload and try again so a fresh key is derived.",
  },
  CONVOY_NO_ORDER: {
    title: "No order matches this key in this batch.",
    action: "Check you are on the right batch, and that you signed with the wallet that joined.",
  },
  CONVOY_REDEEMED: { title: "This order has already been redeemed." },
  CONVOY_UNDERFUNDED: {
    title: "The pool delivered less than the order needs.",
    action: "Check your shielded balance covers the full lot size.",
  },
  CONVOY_NO_ORDERS: { title: "This batch drew no orders." },
  CONVOY_TOO_FEW_ORDERS: {
    title: "Too few orders to settle safely.",
    action: "The batch will be voided and every order refunded in full.",
  },
  CONVOY_IN_NOT_CLEARED: {
    title: "The swap could not fill the whole batch.",
    action: "Settlement was rolled back. Nothing moved.",
  },
  CONVOY_ZERO_OUTPUT: { title: "The swap returned nothing. Settlement was rolled back." },
  CONVOY_OVERFLOW: { title: "That amount is out of range." },
  CONVOY_BAD_ROUTE: { title: "The batch route is not a valid pool." },
  CONVOY_BAD_TOKEN: { title: "That token is not part of the batch route." },
  CONVOY_BAD_WINDOW: { title: "The batch window is invalid." },
  CONVOY_BAD_LOT_SIZE: { title: "The lot size must be greater than zero." },
  CONVOY_BAD_MAX_LOTS: { title: "The lot ceiling is out of range." },
  CONVOY_BAD_MIN_ORDERS: { title: "A batch needs a minimum order count of at least one." },
  CLEAR_AT_LEAST_MINIMUM: {
    title: "The price moved past the batch's slippage floor.",
    action: "Settlement was rolled back and every order is untouched.",
  },
  ERC20_INSUFFICIENT: { title: "Not enough balance to complete this transfer." },
};

const USER_REJECTION = [
  "user abort",
  "user rejected",
  "user denied",
  "rejected by user",
  "userdeniedrequest",
  "cancelled",
  "canceled",
];

function textOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function explain(error: unknown): Explained {
  const raw = textOf(error);
  const lower = raw.toLowerCase();

  if (USER_REJECTION.some((needle) => lower.includes(needle))) {
    return {
      title: "You dismissed the request in your wallet.",
      action: "Nothing was signed and nothing moved.",
      raw,
      kind: "rejected",
    };
  }

  for (const [code, entry] of Object.entries(CONTRACT_CODES)) {
    if (raw.includes(code)) {
      return { ...entry, raw, kind: "contract" };
    }
  }

  if (lower.includes("invalid_request_payload")) {
    return {
      title: "Your wallet refused the shape of this request.",
      action:
        "This usually means the wallet's privacy support is older than the app expects. Update the wallet extension.",
      raw,
      kind: "wallet",
    };
  }

  if (lower.includes("not implemented") || lower.includes("method not supported")) {
    return {
      title: "This wallet does not support Starknet private transactions yet.",
      action: "Ready has privacy live on mainnet and works with this app.",
      raw,
      kind: "wallet",
    };
  }

  if (lower.includes("paymaster")) {
    return {
      title: "The transaction failed during submission.",
      action:
        "The paymaster does not report a reason. The usual causes are a shielded balance below the lot size, or the batch sealing while the wallet was open.",
      raw,
      kind: "network",
    };
  }

  if (lower.includes("insufficient") && lower.includes("balance")) {
    return {
      title: "Your shielded balance does not cover this order.",
      action: "Shield more into the pool, or drop a lot.",
      raw,
      kind: "contract",
    };
  }

  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused")
  ) {
    return {
      title: "Could not reach Starknet.",
      action: "The app is retrying against a different endpoint.",
      raw,
      kind: "network",
    };
  }

  return {
    title: "That did not go through.",
    action: "Nothing was signed unless your wallet said otherwise.",
    raw,
    kind: "unknown",
  };
}
