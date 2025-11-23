import type { TransactionResult } from "litesvm";

export function logSvmResult(name: string, result: TransactionResult) {
  console.log(`\n${name} result:`);
  console.log(`  Success: ${result.succeeded}`);
  if (!result.succeeded && result.error) {
    console.log(`  Error: ${result.error}`);
  }
}
