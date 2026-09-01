/**
 * One formatter for every number the product shows.
 *
 * Amounts are truncated, never rounded up: a balance must never read higher
 * than what the chain would actually pay out.
 */

export function formatUnits(
  raw: bigint,
  decimals: number,
  display: number,
): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  const scale = 10n ** BigInt(Math.max(0, decimals - display));
  const truncated = display >= decimals ? fraction : fraction / scale;
  const padded = truncated.toString().padStart(Math.min(display, decimals), "0");

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return display === 0 ? `${sign}${grouped}` : `${sign}${grouped}.${padded}`;
}

export function parseUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Not a number");
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

/** Short form for addresses and hashes: 0x1234...abcd */
export function truncateHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead + 2)}…${value.slice(-tail)}`;
}

/** Left-pads a felt to the canonical 66-character form. */
export function normalizeHex(value: string | bigint): string {
  const hex = typeof value === "bigint" ? value.toString(16) : BigInt(value).toString(16);
  return `0x${hex.padStart(64, "0")}`;
}

export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "00:00";
  const total = Math.floor(secondsRemaining);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = Math.floor((now - timestamp * 1000) / 1000);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/**
 * Rate between two token amounts, as a plain decimal string.
 * Returns null when there is nothing meaningful to divide.
 */
export function clearingRate(
  amountIn: bigint,
  decimalsIn: number,
  amountOut: bigint,
  decimalsOut: number,
  display = 6,
): string | null {
  if (amountIn === 0n) return null;
  const precision = 10n ** BigInt(display);
  const numerator = amountOut * 10n ** BigInt(decimalsIn) * precision;
  const denominator = amountIn * 10n ** BigInt(decimalsOut);
  const scaled = numerator / denominator;
  return formatUnits(scaled, display, display);
}
