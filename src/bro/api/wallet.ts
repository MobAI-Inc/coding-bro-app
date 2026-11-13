export interface WalletState {
  currency: "USD";
  balanceMicroUsd: string;
  reservedMicroUsd: string;
  availableMicroUsd: string;
  entries: {
    id: string;
    kind: "credit" | "debit";
    amountMicroUsd: string;
    at: string;
    memo: string;
    modelId?: string | null;
  }[];
}

export const EMPTY_WALLET: WalletState = {
  currency: "USD",
  balanceMicroUsd: "0",
  reservedMicroUsd: "0",
  availableMicroUsd: "0",
  entries: [],
};

export function formatWalletUsd(microUsd: string): string {
  const value = BigInt(microUsd);
  const whole = value / 1000000n;
  const fraction = (value % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}
