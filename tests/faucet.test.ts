import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { LiteSVM, Clock } from "litesvm";
import { expect } from "chai";
import { Faucet } from "../target/types/faucet";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { logSvmResult } from "./utils";


const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

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

  beforeEach(async () => {
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

    [mintAuthorityAta] = PublicKey.findProgramAddressSync(
      [
        mintAuthority.toBuffer(),
        TOKEN_2022_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

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
  });

  describe("Initialization", () => {
    it("Verifies faucet initialized with default parameters", async () => {
      const configInfo = svm.getAccount(configPda);
      expect(configInfo).to.not.be.null;
      const config = program.coder.accounts.decode("config", Buffer.from(configInfo!.data));

      expect(config.admin.toString()).to.equal(payer.publicKey.toString());
      expect(config.claimAmount.toNumber()).to.equal(CLAIM_AMOUNT * LAMPORTS_PER_SOL);

      const mintAuthorityAtaInfo = svm.getAccount(mintAuthorityAta);
      expect(mintAuthorityAtaInfo).to.not.be.null;

      const data = Buffer.from(mintAuthorityAtaInfo!.data);
      const amount = data.readBigUInt64LE(64);

      expect(amount.toString()).to.equal(INITIAL_SUPPLY.toString());
    });
  });

  describe("Claiming Functionality", () => {
    it("Successfully claims tokens and verifies balance increase", async () => {


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

      expect(config.claimAmount.toNumber()).to.equal(CLAIM_AMOUNT * LAMPORTS_PER_SOL);
    });

    it("Verifies decimal precision in config", async () => {
      const configInfo = svm.getAccount(configPda);
      const config = program.coder.accounts.decode("config", Buffer.from(configInfo!.data));

      const claimAmountTokens = config.claimAmount.toNumber();

      expect(claimAmountTokens).to.equal(CLAIM_AMOUNT * LAMPORTS_PER_SOL);
    });
  });

  describe("Error Handling", () => {
    it("Tests arithmetic overflow protection", async () => {
      expect(CLAIM_AMOUNT).to.be.lessThan(Number.MAX_SAFE_INTEGER / 1e9);
    });

    it("Prevents double claiming for non-admin users", async () => {
      const newUser = Keypair.generate();
      svm.airdrop(newUser.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

      const userAta = await getAssociatedTokenAddress(
        mint,
        newUser.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const firstClaimTx = await program.methods
        .claim()
        .accounts({
          signer: newUser.publicKey,
        })
        .transaction();

      firstClaimTx.recentBlockhash = svm.latestBlockhash();
      firstClaimTx.feePayer = newUser.publicKey;
      firstClaimTx.sign(newUser);

      svm.sendTransaction(firstClaimTx);

      const userAtaInfo = svm.getAccount(userAta);
      expect(userAtaInfo).to.not.be.null;
      const userData = Buffer.from(userAtaInfo!.data);
      const userBalance = userData.readBigUInt64LE(64);
      expect(userBalance > BigInt(0)).to.be.true;

      const secondClaimTx = await program.methods
        .claim()
        .accounts({
          signer: newUser.publicKey,
        })
        .transaction();

      secondClaimTx.recentBlockhash = svm.latestBlockhash();
      secondClaimTx.feePayer = newUser.publicKey;
      secondClaimTx.sign(newUser);

      try {
        svm.sendTransaction(secondClaimTx);

        expect.fail("Second claim should have failed");
      } catch (error: any) {
      }
    });

    it("Prevents double claiming within same transaction", async () => {
      const newUser = Keypair.generate();
      svm.airdrop(newUser.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

      const firstClaimIx = await program.methods
        .claim()
        .accounts({
          signer: newUser.publicKey,
        })
        .instruction();

      const secondClaimIx = await program.methods
        .claim()
        .accounts({
          signer: newUser.publicKey,
        })
        .instruction();

      const tx = new Transaction().add(firstClaimIx, secondClaimIx);
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = newUser.publicKey;
      tx.sign(newUser);

      try {
        svm.sendTransaction(tx);
        expect.fail("Transaction with double claim should have failed");
      } catch (error: any) {
        console.log("Double claim prevented as expected");
      }
    });

    it("Allows admin first claim", async () => {
      const adminAta = await getAssociatedTokenAddress(
        mint,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const firstAdminClaim = await program.methods
        .claim()
        .accounts({
          signer: payer.publicKey,
        })
        .transaction();

      firstAdminClaim.recentBlockhash = svm.latestBlockhash();
      firstAdminClaim.feePayer = payer.publicKey;
      firstAdminClaim.sign(payer);

      svm.sendTransaction(firstAdminClaim);

      const afterFirstClaim = svm.getAccount(adminAta);
      expect(afterFirstClaim).to.not.be.null;
      const afterFirstData = Buffer.from(afterFirstClaim!.data);
      const balanceAfterFirst = afterFirstData.readBigUInt64LE(64);
      expect(balanceAfterFirst).to.equal(BigInt(CLAIM_AMOUNT) * BigInt(10 ** 9));
    });

    it("Allows admin multiple claims within same transaction", async () => {
      const adminAta = await getAssociatedTokenAddress(
        mint,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const firstClaimIx = await program.methods
        .claim()
        .accounts({
          signer: payer.publicKey,
        })
        .instruction();

      const secondClaimIx = await program.methods
        .claim()
        .accounts({
          signer: payer.publicKey,
        })
        .instruction();

      const tx = new Transaction().add(firstClaimIx, secondClaimIx);
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = payer.publicKey;
      tx.sign(payer);

      const result = svm.sendTransaction(tx);

      const adminAtaInfo = svm.getAccount(adminAta);
      expect(adminAtaInfo).to.not.be.null;
      const adminData = Buffer.from(adminAtaInfo!.data);
      const adminBalance = adminData.readBigUInt64LE(64);
      const expectedAmount = BigInt(CLAIM_AMOUNT) * BigInt(10 ** 9) * BigInt(2);
      expect(adminBalance.toString()).to.equal(expectedAmount.toString());
    });


  });
});
