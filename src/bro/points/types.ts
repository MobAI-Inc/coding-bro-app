/**
 * 积分账本。
 *
 * 积分由用量和游戏产生，唯一消费出口是 Reset。余额永远由流水计算。
 *
 * 账本是流水而不是余额字段。余额永远从流水算出来，这样每一笔积分都能回答
 * 「哪来的、去哪了」——没有这个，对账时只能靠猜。
 */

/** 一笔流水的种类。正负号由 SIGN 决定，不由调用方决定。 */
export type LedgerKind =
  /** 开通或续费赠送，等于当前 Plan 一次月 Reset 价格 */
  | "cycle_gift"
  /** 消耗 token 获得 */
  | "earn_usage"
  /** 支付游戏入场费 */
  | "spend_entry"
  /** 对局未成立（匹配超时、对手掉线），退回入场费 */
  | "refund_entry"
  /** 对局结算奖励 */
  | "award_result"
  /** 兑换 Reset 次数 */
  | "redeem_reset";

/**
 * 每种流水对余额的方向。调用方只提供正数金额，方向由这张表定，
 * 免得某处传了负数、某处传了正数，最后余额对不上还查不出是谁写的。
 */
const SIGN: Record<LedgerKind, 1 | -1> = {
  cycle_gift: 1,
  earn_usage: 1,
  refund_entry: 1,
  award_result: 1,
  spend_entry: -1,
  redeem_reset: -1,
};

export interface LedgerEntry {
  readonly id: string;
  readonly kind: LedgerKind;
  /** 恒为正数。方向看 kind，不看这里。 */
  readonly amount: number;
  /** Unix 毫秒。 */
  readonly at: number;
  /** 给用户看的一句话，例如「ultra 用量结算」「围棋入场」。 */
  readonly memo: string;
}

/** 一笔流水对余额的贡献（带符号）。 */
export function signedAmount(entry: LedgerEntry): number {
  return SIGN[entry.kind] * entry.amount;
}

/** 从流水算余额。余额没有独立字段，只有这一个来源。 */
export function balanceOf(ledger: readonly LedgerEntry[]): number {
  return ledger.reduce((sum, entry) => sum + signedAmount(entry), 0);
}

/** 余额够不够付这笔入场费。 */
export function canAfford(
  ledger: readonly LedgerEntry[],
  price: number,
): boolean {
  return balanceOf(ledger) >= price;
}

/**
 * 入场扣费。余额不足时返回 null 而不是抛异常——余额不足是正常业务分支，
 * 界面要显示「积分不够」，不该走异常路径。
 */
export function chargeEntry(
  ledger: readonly LedgerEntry[],
  charge: { id: string; price: number; at: number; memo: string },
): LedgerEntry[] | null {
  if (charge.price < 0) return null;
  if (!canAfford(ledger, charge.price)) return null;
  return [
    ...ledger,
    {
      id: charge.id,
      kind: "spend_entry",
      amount: charge.price,
      at: charge.at,
      memo: charge.memo,
    },
  ];
}

/**
 * 对局奖励结算。
 *
 * `id` 是服务端最终要提供的幂等键。当前本地版也按同一规则处理：同一关卡
 * 或同一对局的完成事件即使因重渲染、重试被提交多次，也只追加一笔流水。
 */
export function awardResult(
  ledger: readonly LedgerEntry[],
  award: { id: string; points: number; at: number; memo: string },
): readonly LedgerEntry[] {
  if (!Number.isInteger(award.points) || award.points <= 0) return ledger;
  if (ledger.some((entry) => entry.id === award.id)) return ledger;
  return [
    ...ledger,
    {
      id: award.id,
      kind: "award_result",
      amount: award.points,
      at: award.at,
      memo: award.memo,
    },
  ];
}
