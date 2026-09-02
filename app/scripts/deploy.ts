/**
 * Declares and deploys ConvoyVenue.
 *
 * Reproducible: the class hash is printed before anything is sent, and a class
 * that is already declared is reused rather than redeclared.
 *
 * Usage: npm run deploy:venue
 */
// Must be first: populates process.env before config.ts is evaluated.
import "./env";
import { hash } from "starknet";
import { EKUBO_ROUTER, POOL_ADDRESS } from "../src/lib/config";
import { artifacts, getAccount, getProvider, requireEnv, submit } from "./shared";

async function main() {
  const provider = getProvider();
  const account = getAccount(provider);
  const { sierra, casm } = artifacts();

  const owner = process.env.VENUE_OWNER ?? requireEnv("DEPLOYER_ADDRESS");
  const classHash = hash.computeContractClassHash(sierra);

  console.log("Convoy venue deployment");
  console.log(`  chain       ${await provider.getChainId()}`);
  console.log(`  deployer    ${account.address}`);
  console.log(`  owner       ${owner}`);
  console.log(`  pool        ${POOL_ADDRESS}`);
  console.log(`  router      ${EKUBO_ROUTER}`);
  console.log(`  class hash  ${classHash}`);

  let declared = false;
  try {
    await provider.getClassByHash(classHash);
    console.log("\nClass already declared, skipping declare");
    declared = true;
  } catch {
    // Not declared yet.
  }

  if (!declared) {
    console.log("\nDeclaring");
    const result = await account.declareIfNot({
      contract: sierra,
      casm,
    });
    if (result.transaction_hash) {
      await provider.waitForTransaction(result.transaction_hash);
      console.log(`  tx ${result.transaction_hash}`);
    }
  }

  console.log("\nDeploying");
  const deployment = await account.deployContract({
    classHash,
    constructorCalldata: [POOL_ADDRESS, EKUBO_ROUTER, owner],
  });
  await provider.waitForTransaction(deployment.transaction_hash);

  console.log(`\nVenue deployed`);
  console.log(`  address ${deployment.contract_address}`);
  console.log(`  tx      ${deployment.transaction_hash}`);
  console.log(`  https://voyager.online/contract/${deployment.contract_address}`);
  console.log(
    `\nSet NEXT_PUBLIC_VENUE_ADDRESS=${deployment.contract_address} and restart the app.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
