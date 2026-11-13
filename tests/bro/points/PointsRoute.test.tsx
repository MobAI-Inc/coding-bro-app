import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PointsRoute } from "@/bro/points/PointsRoute";
import { peekPointLedger, resetPointLedger } from "@/bro/points/mock";
import { balanceOf } from "@/bro/points/types";

beforeEach(resetPointLedger);
afterEach(cleanup);

it("确认兑换后按 SKU 扣积分、写流水并生成 Reset 权益提示", () => {
  const before = balanceOf(peekPointLedger());
  render(<PointsRoute />);
  fireEvent.click(screen.getByLabelText("兑换 5 小时 Reset，需要 2400 积分"));
  fireEvent.click(screen.getByRole("button", { name: "确认兑换" }));
  expect(balanceOf(peekPointLedger())).toBe(before - 2_400);
  expect(peekPointLedger().at(-1)?.kind).toBe("redeem_reset");
  expect(screen.getByText("已获得 5 小时 Reset")).toBeTruthy();
});
