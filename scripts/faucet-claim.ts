import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Faucet } from "../target/types/faucet";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
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

  const config = NETWORKS[network];
  if (!config) {
    throw new Error(
      `Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(", ")}`
    );
  }

  console.log(`\nClaiming tokens from Faucet on ${network}...\n`);

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
  console.log(`User: ${wallet.publicKey.toString()}`);

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

  console.log(`Mint: ${mint.toString()}\n`);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const configAccount = await program.account.config.fetch(configPda);
  const claimAmount = configAccount.claimAmount.toNumber();

  console.log(`Claim amount: ${claimAmount} tokens\n`);

  console.log("Claiming tokens...");

  try {
    const tx = await program.methods
      .claim()
      .accounts({
        signer: wallet.publicKey,
      })
      .rpc();

    console.log(`Transaction: ${tx}`);
    console.log(`Claim successful!\n`);

    const userAta = anchor.utils.token.associatedAddress({
      mint: mint,
      owner: wallet.publicKey,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const tokenAccount = await getAccount(
        connection,
        userAta,
        config.commitment,
        TOKEN_2022_PROGRAM_ID
      );

      console.log(`Token Balance:`);
      console.log(`Amount: ${tokenAccount.amount.toString()} (raw)`);
      console.log(`Amount: ${Number(tokenAccount.amount) / 1e9} tokens`);
      console.log(`ATA: ${userAta.toString()}\n`);
    } catch (error) {
      console.log(`Token account: ${userAta.toString()}`);
      console.log(`(Balance check failed, but claim succeeded)\n`);
    }
  } catch (error: any) {
    console.error("Claim failed:", error.message || error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
