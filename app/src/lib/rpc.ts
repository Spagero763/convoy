import { RpcProvider } from "starknet";
import { RPC_URLS } from "./config";

/**
 * Round-robins across endpoints on failure.
 *
 * Reads here are cheap and idempotent, so retrying a different provider is
 * always safe. The cursor advances only on failure, which keeps one healthy
 * endpoint warm instead of spraying every request across all of them.
 */
class FallbackProvider {
  private cursor = 0;
  private readonly providers: RpcProvider[];

  constructor(urls: string[]) {
    this.providers = urls.map((nodeUrl) => new RpcProvider({ nodeUrl }));
  }

  get current(): RpcProvider {
    return this.providers[this.cursor];
  }

  get endpoint(): string {
    return RPC_URLS[this.cursor];
  }

  async run<T>(operation: (provider: RpcProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.providers.length; attempt += 1) {
      const index = (this.cursor + attempt) % this.providers.length;
      try {
        const result = await operation(this.providers[index]);
        this.cursor = index;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async call(
    contractAddress: string,
    entrypoint: string,
    calldata: string[] = [],
  ): Promise<string[]> {
    return this.run((provider) =>
      provider.callContract({ contractAddress, entrypoint, calldata }),
    );
  }

  async blockNumber(): Promise<number> {
    return this.run(async (provider) => {
      const block = await provider.getBlockLatestAccepted();
      return block.block_number;
    });
  }
}

export const provider = new FallbackProvider(RPC_URLS);
