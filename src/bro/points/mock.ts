/**
 * 本地假账本。
 *
 * 服务端还没接，但界面不该因此空着。这里给一份形状与真数据完全一致的流水，
 * 接上服务端时整个文件删掉，`usePointLedger` 换成一次请求即可——界面代码
 * 一行不用改，因为它拿到的一直是 `LedgerEntry[]`。
 *
 * 时间戳写成相对「基准时刻」的偏移而不是调用 Date.now()：假数据每次刷新
 * 都在跳，看着像有真实活动，实际只是噪声，反而掩盖真问题。
 */

import { useCallback, useSyncExternalStore } from "react";
import type { LedgerEntry } from "./types";

/** 2026-08-20 12:00 UTC。固定基准，不随运行时间漂移。 */
const BASE = 1_755_691_200_000;
const HOUR = 3_600_000;

const MOCK_LEDGER: readonly LedgerEntry[] = [
  {
    id: "cycle-gift-pro",
    kind: "cycle_gift",
    amount: 19_600,
    at: BASE - 30 * HOUR,
    memo: "Pro 开通赠送 · 等于 1 次月 Reset",
  },
  {
    id: "m1",
    kind: "earn_usage",
    amount: 5200,
    at: BASE - 26 * HOUR,
    memo: "用量结算 · pro",
  },
  {
    id: "m2",
    kind: "spend_entry",
    amount: 200,
    at: BASE - 20 * HOUR,
    memo: "德州扑克入场",
  },
  {
    id: "m3",
    kind: "award_result",
    amount: 320,
    at: BASE - 19 * HOUR,
    memo: "德州扑克 · 胜",
  },
  {
    id: "m4",
    kind: "earn_usage",
    amount: 860,
    at: BASE - 5 * HOUR,
    memo: "用量结算 · pro",
  },
];

/**
 * 账本存在模块级，不在组件里。
 *
 * 大厅和积分页看的是同一份余额。各自 useState 的话，在大厅花掉 80 积分，
 * 切到积分页还是原来的数——一个只在切页面时才现形的假象，比直接报错难查
 * 得多。接服务端后这里换成查询缓存，`usePointLedger` 的签名不变。
 */
let current: readonly LedgerEntry[] = MOCK_LEDGER;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: readonly LedgerEntry[]) {
  current = next;
  for (const listener of [...listeners]) listener();
}

/**
 * 读账本。目前返回假数据，且支持本地追加，这样入场扣费在界面上是能看见的
 * ——扣了费余额不动的话，根本测不出扣费流程接没接对。
 */
export function usePointLedger() {
  const ledger = useSyncExternalStore(subscribe, () => current);
  const setLedger = useCallback(publish, []);
  return { ledger, setLedger };
}

/**
 * 把账本恢复到初始状态。
 *
 * 只给测试用：模块级状态会在用例之间串味，上一条用例兑掉的积分会让下一条
 * 用例莫名其妙地余额不足。生产代码调用它没有意义——真账本在服务端。
 */
export function resetPointLedger() {
  publish(MOCK_LEDGER);
}

/**
 * 当前账本快照。
 *
 * 同样只给测试用，是 `resetPointLedger` 的读侧对应物。界面上只看得见余额
 * 这个加总数，而有些错发生在加总看不见的地方——两笔流水用了同一个 id，
 * 余额完全正确，去重对账时才少一笔。要测这类事就得读到流水本身。
 *
 * 生产代码一律走 `usePointLedger`：那条路会订阅变更，这个函数不会，拿到
 * 的是调用当刻的静止快照。
 */
export function peekPointLedger(): readonly LedgerEntry[] {
  return current;
}

/**
 * 假的账户方案。接服务端后只需替换数据源。
 */
const MOCK_ACCOUNT = {
  plan: "pro",
} as const;

export { MOCK_LEDGER, MOCK_ACCOUNT };
