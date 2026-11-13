import { describe, expect, it } from "vitest";
import { formatWalletUsd } from "@/bro/api/wallet";
describe("cash formatting", () => {
  it("preserves sub-cent balances and large integer amounts", () => {
    expect(formatWalletUsd("0")).toBe("$0.00");
    expect(formatWalletUsd("1")).toBe("$0.000001");
    expect(formatWalletUsd("123456789")).toBe("$123.456789");
    expect(formatWalletUsd("10000000")).toBe("$10.00");
  });
});
