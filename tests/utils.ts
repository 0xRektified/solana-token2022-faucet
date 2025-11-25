export function logSvmResult(txName: String , result: any): void {
  if (!result.err){
    console.log('No error')
    return;
  }
  console.log("Result constructor:", result.constructor.name);
  if (typeof result.err === 'function') {
    // Failed transaction
    const err = result.err();
    console.log("Error:", err);
    const meta = result.meta();
    const logs = meta.logs();
    console.log("Logs:", logs);
  } else {
    // Successful transaction
    console.log("Transaction succeeded!");
    const meta = result.meta();
    const logs = meta.logs();
    console.log("Logs:", logs);
  }
}