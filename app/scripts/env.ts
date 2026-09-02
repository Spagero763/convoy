/**
 * Loads .env.local before anything else can read process.env.
 *
 * `src/lib/config.ts` resolves NEXT_PUBLIC_VENUE_ADDRESS into a module-level
 * const, which is evaluated the moment it is imported. Any script that imports
 * config before dotenv has run sees an empty string. Importing this module
 * first, on its own line, is what orders that correctly.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });
