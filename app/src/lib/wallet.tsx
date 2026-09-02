"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Store } from "@starknet-io/get-starknet-discovery";
import type { WalletAccountV6 } from "starknet";
import { CHAIN_ID, RPC_URLS, STRK, TOKENS } from "./config";
import { explain, type Explained } from "./errors";
import type { Strk20Action } from "./actions";

/**
 * Wallet connection, network and privacy-capability state.
 *
 * Three things can be wrong independently and the UI has to say which: no
 * wallet is installed, the wallet is on the wrong chain, or the wallet has no
 * STRK20 support. The last one is the surprising one. There is no published
 * list of wallets that implement the privacy methods, so the app probes with
 * `strk20Balances`, which is read-only and safe to call against anything.
 */

export type WalletStatus =
  | "loading"
  | "no-wallets"
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "no-privacy"
  | "ready";

export type WalletChoice = {
  id: string;
  name: string;
  icon: string;
};

export type ShieldedBalance = {
  token: string;
  balance: bigint;
};

type WalletContextValue = {
  status: WalletStatus;
  address: string | null;
  walletName: string | null;
  available: WalletChoice[];
  balances: ShieldedBalance[] | null;
  balancesLoading: boolean;
  error: Explained | null;
  connect: (id: string) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  /** Re-scan for injected wallets, for extensions that register late. */
  rescan: () => void;
  signTypedData: (typedData: unknown) => Promise<string[]>;
  submitPrivate: (actions: Strk20Action[]) => Promise<string>;
  prepare: (actions: Strk20Action[]) => Promise<unknown>;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const LAST_WALLET_KEY = "convoy.wallet";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [available, setAvailable] = useState<WalletChoice[]>([]);
  const [balances, setBalances] = useState<ShieldedBalance[] | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [error, setError] = useState<Explained | null>(null);

  const storeRef = useRef<Store | null>(null);
  const accountRef = useRef<WalletAccountV6 | null>(null);

  // The wallet SDKs are heavy and only matter once someone interacts, so they
  // load after paint rather than blocking the board.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      const { createStore } = await import("@starknet-io/get-starknet-discovery");
      if (cancelled) return;

      const store = createStore();
      storeRef.current = store;

      const publish = () => {
        const wallets = store.getWallets();
        setAvailable(
          wallets.map((w) => ({ id: w.name, name: w.name, icon: w.icon })),
        );
        // Extensions inject asynchronously, and some register well after first
        // paint. Any pre-connection status has to stay open to revision or the
        // UI latches on "no wallet found" and never recovers. Statuses that
        // describe an actual connection are left alone.
        setStatus((current) =>
          current === "loading" ||
          current === "no-wallets" ||
          current === "disconnected"
            ? wallets.length === 0
              ? "no-wallets"
              : "disconnected"
            : current,
        );
      };

      publish();
      unsubscribe = store.subscribe(publish);

      // Belt and braces for wallets that register without notifying the store.
      for (const delay of [300, 1_000, 2_500]) {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            store._refreshInjectedWallets?.();
            publish();
          }, delay),
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const probePrivacy = useCallback(
    async (account: WalletAccountV6): Promise<boolean> => {
      try {
        await account.strk20Balances([STRK.address as `0x${string}`]);
        return true;
      } catch (err) {
        const text = String(err).toLowerCase();
        // A wallet that answers "not implemented" has told us to show a
        // different path. Any other failure is a real error, not a capability
        // signal, so we do not brand the wallet unsupported for it.
        if (text.includes("not implemented") || text.includes("not supported")) {
          return false;
        }
        throw err;
      }
    },
    [],
  );

  const refreshBalances = useCallback(async () => {
    const account = accountRef.current;
    if (!account) return;
    setBalancesLoading(true);
    try {
      const entries = await account.strk20Balances(
        TOKENS.map((t) => t.address as `0x${string}`),
      );
      setBalances(
        entries.map((entry) => ({
          token: entry.token,
          balance: BigInt(entry.balance),
        })),
      );
    } catch (err) {
      setError(explain(err));
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (id: string) => {
      setError(null);
      setStatus("connecting");
      try {
        const store = storeRef.current;
        const target = store?.getWallets().find((w) => w.name === id);
        if (!target) {
          setStatus("disconnected");
          return;
        }

        const { WalletAccountV6, walletV6 } = await import("starknet");

        // Ask the wallet what chain it is on before building an account against
        // it, so a wrong-network wallet produces a clear answer rather than a
        // pile of failing reads.
        const chainId = await walletV6.requestChainId(target);
        if (chainId !== CHAIN_ID) {
          setWalletName(target.name);
          setStatus("wrong-network");
          return;
        }

        const account = await WalletAccountV6.connect(
          { nodeUrl: RPC_URLS[0] },
          target,
        );

        const hasPrivacy = await probePrivacy(account);
        accountRef.current = account;
        setAddress(account.address);
        setWalletName(target.name);
        window.localStorage.setItem(LAST_WALLET_KEY, target.name);

        if (!hasPrivacy) {
          setStatus("no-privacy");
          return;
        }

        setStatus("ready");
        void refreshBalances();
      } catch (err) {
        setError(explain(err));
        setStatus("disconnected");
      }
    },
    [probePrivacy, refreshBalances],
  );

  const switchNetwork = useCallback(async () => {
    const store = storeRef.current;
    const target = store?.getWallets().find((w) => w.name === walletName);
    if (!target) return;
    try {
      const { walletV6 } = await import("starknet");
      await walletV6.switchStarknetChain(target, CHAIN_ID as never);
      if (walletName) await connect(walletName);
    } catch (err) {
      setError(explain(err));
    }
  }, [connect, walletName]);

  const rescan = useCallback(() => {
    const store = storeRef.current;
    if (!store) return;
    store._refreshInjectedWallets?.();
    const wallets = store.getWallets();
    setAvailable(wallets.map((w) => ({ id: w.name, name: w.name, icon: w.icon })));
    setStatus((current) =>
      current === "loading" || current === "no-wallets" || current === "disconnected"
        ? wallets.length === 0
          ? "no-wallets"
          : "disconnected"
        : current,
    );
  }, []);

  const disconnect = useCallback(() => {
    accountRef.current = null;
    setAddress(null);
    setWalletName(null);
    setBalances(null);
    setStatus(available.length === 0 ? "no-wallets" : "disconnected");
    window.localStorage.removeItem(LAST_WALLET_KEY);
  }, [available.length]);

  const signTypedData = useCallback(async (typedData: unknown) => {
    const account = accountRef.current;
    if (!account) throw new Error("No wallet connected");
    const signature = await account.signMessage(typedData as never);
    return (Array.isArray(signature) ? signature : [signature]).map(String);
  }, []);

  const submitPrivate = useCallback(async (actions: Strk20Action[]) => {
    const account = accountRef.current;
    if (!account) throw new Error("No wallet connected");
    const { transaction_hash } = await account.strk20InvokeTransaction(
      actions as never,
    );
    return transaction_hash;
  }, []);

  const prepare = useCallback(async (actions: Strk20Action[]) => {
    const account = accountRef.current;
    if (!account) throw new Error("No wallet connected");
    return account.strk20PrepareInvoke(actions as never, true);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      address,
      walletName,
      available,
      balances,
      balancesLoading,
      error,
      connect,
      disconnect,
      switchNetwork,
      refreshBalances,
      rescan,
      signTypedData,
      submitPrivate,
      prepare,
      clearError: () => setError(null),
    }),
    [
      status,
      address,
      walletName,
      available,
      balances,
      balancesLoading,
      error,
      connect,
      disconnect,
      switchNetwork,
      refreshBalances,
      rescan,
      signTypedData,
      submitPrivate,
      prepare,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}

export function shieldedBalanceOf(
  balances: ShieldedBalance[] | null,
  token: string,
): bigint | null {
  if (!balances) return null;
  const target = BigInt(token);
  return balances.find((b) => BigInt(b.token) === target)?.balance ?? 0n;
}
