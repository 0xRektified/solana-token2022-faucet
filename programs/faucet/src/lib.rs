use anchor_lang::{prelude::*, solana_program::native_token::LAMPORTS_PER_SOL};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{MintTo, TransferChecked, Token2022, mint_to, transfer_checked},
    token_interface::{Mint, TokenAccount},
};

declare_id!("6eekuucyfcMmtCzJYFaKxXAEJHD5B3ZGEGF3kGm26mq5");
const DEFAULT_CLAIM_AMOUNT: u64 = 10_000;

#[program]
pub mod faucet {
    use super::*;

    pub fn initialize(ctx: Context<InitializeContext>, initial_supply: u64, claim_amount: Option<u64>) -> Result<()> {
        ctx.accounts.config.admin = ctx.accounts.signer.key();

        let claim_amount_ui = claim_amount.unwrap_or(DEFAULT_CLAIM_AMOUNT);
        let claim_amount_raw = LAMPORTS_PER_SOL
            .checked_mul(claim_amount_ui)
            .ok_or(error!(FaucetError::ArithmeticOverflow))?;
        ctx.accounts.config.claim_amount = claim_amount_raw;

        let mint_to_ix = MintTo{
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.mint_authority_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"mint_authority",
            &[ctx.bumps.mint_authority],
        ]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_to_ix,
            signer_seeds
        );
        mint_to(cpi_ctx, initial_supply)?;
        Ok(())
    }

    pub fn claim(ctx: Context<ClaimContext>) -> Result<()> {
        if ctx.accounts.signer.key() != ctx.accounts.config.admin
            && ctx.accounts.claim_record.claimed_at != 0
        {
            return err!(FaucetError::AlreadyClaimed);
        }

        let clock = Clock::get()?;
        ctx.accounts.claim_record.user = ctx.accounts.signer.key();
        ctx.accounts.claim_record.claimed_at = clock.unix_timestamp;

        let amount = ctx.accounts.config.claim_amount;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"mint_authority",
            &[ctx.bumps.mint_authority],
        ]];

        let transfer_ix = TransferChecked{
            from: ctx.accounts.mint_authority_ata.to_account_info(),
            to: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_ix,
            signer_seeds
        );
        transfer_checked(
            cpi_ctx,
            amount,
            9
        )?;
        Ok(())
    }
}


#[derive(Accounts)]
pub struct ClaimContext <'info>{

    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: This is the PDA that will be the mint authority
    #[account(
        seeds = [b"mint_authority"],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"mint", mint_authority.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = mint_authority,
        associated_token::token_program = token_program,
    )]
    pub mint_authority_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = signer,
        associated_token::token_program = token_program,
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim_record", signer.key().as_ref()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub claim_amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub user: Pubkey,
    pub claimed_at: i64,
}

#[error_code]
pub enum FaucetError {
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("User already claimed")]
    AlreadyClaimed,
}

#[derive(Accounts)]
pub struct InitializeContext <'info>{

    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: This is the pda that will mint new token
    #[account(
        seeds = [b"mint_authority"],
        bump
    )]
    pub mint_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = signer,
        mint::decimals = 9,
        mint::authority = mint_authority,
        mint::freeze_authority = signer, //deployer can freeze
        mint::token_program = token_program,
        seeds = [b"mint", mint_authority.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = mint_authority,
        associated_token::token_program = token_program,
    )]
    pub mint_authority_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}