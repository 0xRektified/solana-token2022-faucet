import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Faucet } from "../target/types/faucet";
import * as fs from "fs";
import * as path from "path";

interface NetworkConfig {
  cluster: string;
  rpcUrl: string;
  commitment: anchor.web3.Commitment;
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    cluster: "localnet",
    rpcUrl: "http://127.0.0.1:8899",
    commitment: "confirmed",
  },
  devnet: {
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    commitment: "confirmed",
  },
  testnet: {
    cluster: "testnet",
    rpcUrl: "https://api.testnet.solana.com",
    commitment: "confirmed",
  },
};

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.find((arg) => arg.startsWith("--network="));
  const network = networkArg
    ? networkArg.split("=")[1]
    : process.env.ANCHOR_PROVIDER_CLUSTER || "localnet";

  const amountArg = args.find((arg) => arg.startsWith("--amount="));
  const initialSupply = amountArg
    ? BigInt(amountArg.split("=")[1])
    : BigInt(1_000_000_000) * BigInt(10 ** 9);

  const claimAmountArg = args.find((arg) => arg.startsWith("--claim-amount="));
  const claimAmount = claimAmountArg
    ? parseInt(claimAmountArg.split("=")[1])
    : null;

  const config = NETWORKS[network];
  if (!config) {
    throw new Error(
      `Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(", ")}`
    );
  }

  console.log(`\nInitializing Faucet on ${network}...\n`);
  console.log(`Initial Supply: ${initialSupply.toString()} (${Number(initialSupply) / 1e9} tokens)`);
  console.log(`Claim Amount: ${claimAmount ?? 10_000} tokens\n`);

  const connection = new anchor.web3.Connection(config.rpcUrl, config.commitment);

  const walletPath = path.join(
    process.env.HOME || "",
    ".config",
    "solana",
    "id.json"
  );
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: config.commitment,
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Faucet as Program<Faucet>;

  console.log(`Program ID: ${program.programId.toString()}`);
  console.log(`Deployer: ${wallet.publicKey.toString()}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL\n`);

  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );

  const [mint] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), mintAuthority.toBuffer()],
    program.programId
  );

  console.log(`PDAs:`);
  console.log(`Mint Authority: ${mintAuthority.toString()}`);
  console.log(`Mint: ${mint.toString()}\n`);

  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (mintInfo) {
      console.log(`Faucet already initialized!`);
      console.log(`Mint: ${mint.toString()}`);
      console.log(`Skipping initialization.\n`);

      const deploymentInfo = {
        network,
        programId: program.programId.toString(),
        mint: mint.toString(),
        mintAuthority: mintAuthority.toString(),
        deployer: wallet.publicKey.toString(),
        timestamp: new Date().toISOString(),
      };

      const deploymentPath = path.join(
        __dirname,
        "..",
        `faucet-deployment-${network}.json`
      );
      fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
      console.log(`Deployment info saved to ${path.basename(deploymentPath)}\n`);

      return;
    }
  } catch {
  }

  console.log("Initializing faucet...");

  try {
    const tx = await program.methods
      .initialize(
        new anchor.BN(initialSupply.toString()),
        claimAmount !== null ? new anchor.BN(claimAmount) : null
      )
      .accounts({
        signer: wallet.publicKey,
      })
      .rpc();

    console.log(`Transaction: ${tx}`);
    console.log(`Faucet initialized successfully\n`);

    const deploymentInfo = {
      network,
      programId: program.programId.toString(),
      mint: mint.toString(),
      mintAuthority: mintAuthority.toString(),
      deployer: wallet.publicKey.toString(),
      timestamp: new Date().toISOString(),
      initTx: tx,
    };

    const deploymentPath = path.join(
      __dirname,
      "..",
      `faucet-deployment-${network}.json`
    );
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`Deployment info saved to ${path.basename(deploymentPath)}\n`);

    console.log("Next steps:");
    console.log(`1. Share the mint address with users: ${mint.toString()}`);
    console.log(`2. Users can claim tokens using: ts-node scripts/faucet-claim.ts --network=${network}`);
    console.log(`3. Check mint info: spl-token display ${mint.toString()} --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb\n`);
  } catch (error) {
    console.error("Initialization failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
