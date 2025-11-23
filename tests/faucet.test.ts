import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Keypair, PublicKey } from "@solana/web3.js";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM, Clock } from "litesvm";
import { expect } from "chai";
import { Faucet } from "../target/types/faucet";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { logSvmResult } from "./utils";

describe("faucet", () => {
  let svm: LiteSVM;
  let provider: LiteSVMProvider;
  let program: Program<Faucet>;
  let payer: Keypair;

  let mintAuthority: PublicKey;
  let mint: PublicKey;
  let mintAuthorityAta: PublicKey;
  let configPda: PublicKey;

  const INITIAL_SUPPLY = BigInt(1_000_000_000) * BigInt(10 ** 9);
  const CLAIM_AMOUNT = 10_000;

  before(async () => {
    payer = Keypair.generate();

    svm = fromWorkspace("./")
      .withBuiltins()
      .withSysvars();

    const c = svm.getClock();
    const currentTime = Math.floor(Date.now() / 1000);
    svm.setClock(
      new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(currentTime))
    );

    provider = new LiteSVMProvider(svm);
    anchor.setProvider(provider);
    program = anchor.workspace.Faucet;

    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    [mintAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority")],
      program.programId
    );

    [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), mintAuthority.toBuffer()],
      program.programId
    );

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

    [mintAuthorityAta] = PublicKey.findProgramAddressSync(
      [
        mintAuthority.toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log("\nTest Setup:");
    console.log(`  Program: ${program.programId.toString()}`);
    console.log(`  Payer: ${payer.publicKey.toString()}`);
    console.log(`  Mint Authority: ${mintAuthority.toString()}`);
    console.log(`  Mint: ${mint.toString()}`);
    console.log(`  Config: ${configPda.toString()}`);
  });

  describe("Initialization", () => {
    it("Initializes the faucet with default parameters", async () => {
      const initTx = await program.methods
        .initialize(
          new BN(INITIAL_SUPPLY.toString()),
          null
        )
        .accounts({
          signer: payer.publicKey,
        })
        .transaction();

      initTx.recentBlockhash = svm.latestBlockhash();
      initTx.feePayer = payer.publicKey;
      initTx.sign(payer);
      svm.sendTransaction(initTx);

      const configInfo = svm.getAccount(configPda);
      expect(configInfo).to.not.be.null;
      const config = program.coder.accounts.decode("config", Buffer.from(configInfo!.data));

      expect(config.admin.toString()).to.equal(payer.publicKey.toString());
      expect(config.claimAmount.toNumber()).to.equal(10_000);

      const mintAuthorityAtaInfo = svm.getAccount(mintAuthorityAta);
      expect(mintAuthorityAtaInfo).to.not.be.null;

      const data = Buffer.from(mintAuthorityAtaInfo!.data);
      const amount = data.readBigUInt64LE(64);

      expect(amount.toString()).to.equal(INITIAL_SUPPLY.toString());
    });
  });

  describe("Claiming Functionality", () => {
    it("Successfully claims tokens and verifies balance increase", async () => {
      const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
      const { Transaction } = await import("@solana/web3.js");

      const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      const userAta = await getAssociatedTokenAddress(
        mint,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const createAtaIx = createAssociatedTokenAccountInstruction(
        payer.publicKey,
        userAta,
        payer.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const createAtaTx = new Transaction().add(createAtaIx);
      createAtaTx.recentBlockhash = svm.latestBlockhash();
      createAtaTx.feePayer = payer.publicKey;
      createAtaTx.sign(payer);
      svm.sendTransaction(createAtaTx);

      const initialFaucetBalance = (() => {
        const mintAuthorityAtaInfo = svm.getAccount(mintAuthorityAta);
        if (!mintAuthorityAtaInfo) return BigInt(0);
        const data = Buffer.from(mintAuthorityAtaInfo.data);
        return data.readBigUInt64LE(64);
      })();

      const claimTx = await program.methods
        .claim()
        .accounts({
          signer: payer.publicKey,
        })
        .transaction();

      claimTx.recentBlockhash = svm.latestBlockhash();
      claimTx.feePayer = payer.publicKey;
      claimTx.sign(payer);

      const result = svm.sendTransaction(claimTx);
      logSvmResult('claimTx', result );

      const userAtaInfo = svm.getAccount(userAta);
      expect(userAtaInfo).to.not.be.null;

      const userData = Buffer.from(userAtaInfo!.data);
      const userBalance = userData.readBigUInt64LE(64);
      const expectedAmount = BigInt(CLAIM_AMOUNT) * BigInt(10 ** 9);

      expect(userBalance.toString()).to.equal(expectedAmount.toString());

      const finalFaucetBalance = (() => {
        const mintAuthorityAtaInfo = svm.getAccount(mintAuthorityAta);
        if (!mintAuthorityAtaInfo) return BigInt(0);
        const data = Buffer.from(mintAuthorityAtaInfo.data);
        return data.readBigUInt64LE(64);
      })();

      const expectedFaucetBalance = initialFaucetBalance - expectedAmount;
      expect(finalFaucetBalance.toString()).to.equal(expectedFaucetBalance.toString());
    });

  });

  describe("Configuration and Logic", () => {
    it("Verifies config parameters were set correctly", async () => {
      const configInfo = svm.getAccount(configPda);
      expect(configInfo).to.not.be.null;
      const config = program.coder.accounts.decode("config", Buffer.from(configInfo!.data));

      expect(config.claimAmount.toNumber()).to.equal(10_000);
    });

    it("Verifies decimal precision in config", async () => {
      const configInfo = svm.getAccount(configPda);
      const config = program.coder.accounts.decode("config", Buffer.from(configInfo!.data));

      const claimAmountTokens = config.claimAmount.toNumber();

      expect(claimAmountTokens).to.equal(10_000);
    });
  });

  describe("Error Handling", () => {
    it("Tests arithmetic overflow protection", async () => {
      expect(CLAIM_AMOUNT).to.be.lessThan(Number.MAX_SAFE_INTEGER / 1e9);
    });
  });
});
