# Token-2022 Faucet Program

> **WARNING: FOR TESTING PURPOSES ONLY**
>
> This program is designed exclusively for testing and development environments (devnet/testnet).
> DO NOT use this program in production. Anyone can claim unlimited tokens with no restrictions,
> cooldowns, or access controls. The admin field exists but is not enforced.

A Solana program for quickly spinning up test Token-2022 (Token Extensions) mints with a simple claim mechanism. Perfect for testing and development on devnet.

## Features

- Token-2022 Support: Full support for Solana Token Extensions program
- Single Global Mint: One deterministic mint per deployment
- Auto-Initialize ATAs: Automatically creates user token accounts on first claim
- Simple Deployment: Quick setup for testing purposes

## Architecture

### PDAs

1. Mint Authority: `[b"mint_authority"]`
   - PDA that has minting authority over the token
   - Used to sign mint and transfer operations

2. Mint: `[b"mint", mint_authority.key()]`
   - The Token-2022 mint account
   - Deterministic address based on mint_authority PDA

3. Config: `[b"config"]`
   - Stores admin and claim amount configuration

### Instructions

#### initialize

Initializes the faucet by creating the mint and minting initial supply to the mint authority's ATA.

Accounts:
- signer: Deployer (pays for accounts, gets freeze authority)
- mint_authority: PDA with minting authority
- mint: The Token-2022 mint (created)
- mint_authority_ata: Faucet's token account (created)
- config: Config account (created)
- token_program: Token-2022 program
- associated_token_program: Associated Token Program
- system_program: System program

Parameters:
- initial_supply: u64
- claim_amount: Option<u64>

Initial Mint: 1,000,000,000 tokens (1 billion with 9 decimals)

#### claim

Transfers tokens from the faucet to a user.

Accounts:
- signer: User claiming tokens
- mint_authority: PDA with transfer authority
- mint: The Token-2022 mint
- mint_authority_ata: Faucet's token account (source)
- user_ata: User's token account (destination)
- config: Config account
- token_program: Token-2022 program
- associated_token_program: Associated Token Program
- system_program: System program

Parameters: None

Claim Amount: 10,000 tokens per claim (configurable)

### Errors

- ArithmeticOverflow: Attempted arithmetic operation that would overflow

## Quick Start

### Prerequisites

```bash
# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Verify installations
anchor --version
solana --version

# Install Node.js dependencies
yarn install
```

### Build

```bash
anchor build --program-name faucet
```

### Deploy to Devnet

```bash
# Set Solana cluster to devnet
solana config set --url devnet

# Request SOL airdrop for deployment
solana airdrop 2

# Deploy and initialize the faucet (one command)
yarn faucet:deploy:devnet
```

The `yarn faucet:deploy:devnet` script will:
1. Build the program
2. Deploy to devnet
3. Initialize the faucet with default settings

### Deploy to Localnet

```bash
# Start local validator in a separate terminal
solana-test-validator

# In another terminal, deploy and initialize
yarn faucet:deploy:localnet
```

## Usage

### Claim Tokens

After deployment, users can claim tokens:

```bash
# Claim on devnet
yarn faucet:claim:devnet

# Claim on localnet
yarn faucet:claim:localnet
```

### Manual Initialization (Advanced)

If you want to customize initial supply or claim amount:

```bash
# Initialize with defaults (1B tokens, 10k per claim)
yarn ts-node scripts/faucet-initialize.ts --network=devnet

# Custom initial supply (5B tokens)
yarn ts-node scripts/faucet-initialize.ts --network=devnet --amount=5000000000000000000

# Custom claim amount (5k tokens per claim)
yarn ts-node scripts/faucet-initialize.ts --network=devnet --claim-amount=5000

# Both custom
yarn ts-node scripts/faucet-initialize.ts --network=devnet --amount=10000000000000000000 --claim-amount=20000
```

Parameters:
- `--network`: Network to deploy on (localnet, devnet)
- `--amount`: Initial supply in raw units (default: 1,000,000,000 * 10^9)
- `--claim-amount`: Tokens per claim in UI amount (default: 10,000)

### Check Mint Info

```bash
spl-token display <MINT_ADDRESS> --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

## Example Integration

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const FAUCET_PROGRAM_ID = new PublicKey("6eekuucyfcMmtCzJYFaKxXAEJHD5B3ZGEGF3kGm26mq5");

const [mintAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint_authority")],
  FAUCET_PROGRAM_ID
);

const [mint] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint"), mintAuthority.toBuffer()],
  FAUCET_PROGRAM_ID
);

const program = anchor.workspace.Faucet;
const tx = await program.methods
  .claim()
  .accounts({
    signer: wallet.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

## Development

### Run Tests

The project uses LiteSVM for fast, in-memory testing without requiring a local validator.

```bash
# Run full test suite
yarn test

# Or use anchor test (includes build)
anchor test
```

Tests include:
- Initialization with default and custom parameters
- Token claiming functionality
- Balance verification
- Config validation
- Error handling

### Available Scripts

```bash
yarn test                      # Run test suite with Mocha
yarn faucet:build              # Build the faucet program
yarn faucet:deploy:localnet    # Build, deploy, and initialize on localnet
yarn faucet:deploy:devnet      # Build, deploy, and initialize on devnet
yarn faucet:claim:localnet     # Claim tokens on localnet
yarn faucet:claim:devnet       # Claim tokens on devnet
yarn lint                      # Check code formatting
yarn lint:fix                  # Fix code formatting
```

### Local Development Workflow

```bash
# Terminal 1: Start local validator
solana-test-validator

# Terminal 2: Build and deploy
yarn faucet:deploy:localnet

# Test claiming
yarn faucet:claim:localnet

# Run tests
yarn test
```

## Security Considerations

This is a testing tool, not production-ready:

- Deployer has freeze authority and can freeze accounts
- No admin controls for pausing or updating
- Fixed claim amount (configurable at deployment)
- No rate limiting or cooldown periods
- Anyone can claim unlimited times
- Suitable only for devnet/testnet testing

## Program Details

- Program ID: `6eekuucyfcMmtCzJYFaKxXAEJHD5B3ZGEGF3kGm26mq5`
- Anchor Version: 0.31.1
- Token Program: Token-2022 (Token Extensions)
- Decimals: 9
- Initial Supply: 1,000,000,000 tokens (configurable)
- Claim Amount: 10,000 tokens (configurable)

## Troubleshooting

### `ts-node: command not found`

Use `yarn ts-node` instead of `ts-node` directly, as it's installed locally:

```bash
yarn ts-node scripts/faucet-initialize.ts --network=devnet
```

Or use the predefined scripts:

```bash
yarn faucet:deploy:devnet
```

### Tests failing with module errors

Make sure all dependencies are installed:

```bash
yarn install
```

## License

MIT
