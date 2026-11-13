/**
 * 游戏区路由 —— 扣费这一路。
 *
 * 这个文件只测一件事：**什么情况下积分会被扣走**。它跟 GamesRoute.test.ts
 * 分开，因为那边是纯函数与表结构，这边要挂真组件、真账本，跑得慢得多。
 *
 * 之所以非测不可：扣费是这个应用里唯一一处「点一下就少东西」的操作，而它
 * 的守卫（`canEnter`）在正常状态下永远为真——正常状态下测不出守卫在不在。
 * 变异测试确认过：把 `onEnter` 里那句 `canEnter` 删掉，其余所有测试仍然全绿。
 * 这里补的就是那个缺口。
 *
 * 全程跑在 TUI（暗色）模式下：玻璃模式的对局页要 canvas，而 jsdom 没有
 * `getContext`，会刷一屏 "Not implemented" 噪声。扣费逻辑与外观无关，挑
 * 不需要 canvas 的那一套跑即可——这不是绕开问题，各游戏的渲染层在它们
 * 自己的测试文件里另有覆盖。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { GamesRoute } from "@/bro/lobby/GamesRoute";
import { GAME_CATALOG, isEnterable } from "@/bro/lobby/catalog";
import {
  MOCK_LEDGER,
  peekPointLedger,
  resetPointLedger,
} from "@/bro/points/mock";
import { balanceOf } from "@/bro/points/types";
import { SLOT_CONFIG, SPIN_DURATION_MS } from "@/bro/games/slots/SlotsGame";

beforeEach(() => {
  resetPointLedger();
  document.documentElement.classList.add("dark");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem("coding-bro:solo-progress:slots");
  resetPointLedger();
  document.documentElement.classList.remove("dark");
});

const START = balanceOf(MOCK_LEDGER);
/** 第一款无需选场次就能进的游戏，用来隔离验证通用扣费路径。 */
const PLAYABLE = GAME_CATALOG.find(
  (game) => isEnterable(game) && !game.rooms?.length,
)!;

/**
 * TUI 大厅里这一款游戏的行。
 *
 * TUI 那套没有 `<button>`，行本身就是可点的 `<li>`，禁用状态走 `aria-disabled`。
 *
 * 说清一件下面几条测试**测不到**的事：`aria-disabled` 确实挡不住 click 事件，
 * 但 `GameLobby` 的 onClick 里自己判了 `state === "ready"`，所以点锁住的行时
 * `onEnter` 根本不会被调用。也就是说下面「点进不去的行不扣费」验证的是**大厅
 * 这一层**的拦截，不是路由那层的 `canEnter`。
 *
 * 路由那层的判断在 UI 上够不到（键盘那条路同样在大厅里就被拦了），所以它
 * 只能在 `GamesRoute.test.ts` 里被直接调用来测。它仍然留着，因为它防的是
 * 以后新增入口时忘了判断——但要诚实：变异测试里删掉调用处那一句，全套测试
 * 依然全绿，这一句目前没有端到端的保护。
 */
function row(name: string): HTMLElement {
  return screen.getByText(name).closest("li")!;
}

function isLocked(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") === "true";
}

/** 大厅顶上的余额。只在大厅出现——进了对局页就看不到了。 */
function balance(): number {
  const head = document.querySelector(".bro-lobby-tui__head");
  if (!head) throw new Error("不在大厅（TUI 顶栏不存在），读不到余额");
  const el = head.querySelector(".bro-tabular")!;
  return Number(el.textContent);
}

describe("入场扣费", () => {
  it("牌桌先选场次，确认之前不扣分，确认后按场次价格扣分", () => {
    const table = GAME_CATALOG.find((game) => game.id === "baccarat")!;
    const room = table.rooms![0];
    render(<GamesRoute />);

    fireEvent.click(row(table.name));
    expect(balanceOf(peekPointLedger())).toBe(START);

    fireEvent.click(
      screen.getByRole("button", {
        name: `进入${room.name}，${room.price} 积分`,
      }),
    );
    expect(balanceOf(peekPointLedger())).toBe(START - room.price);
    expect(peekPointLedger().at(-1)?.memo).toBe(
      `${table.name} · ${room.name}入场`,
    );
  });

  it("进得去的游戏：扣掉入场费并进入对局页", () => {
    render(<GamesRoute />);
    fireEvent.click(row(PLAYABLE.name));

    // 进了对局页：顶栏的「返回大厅」只在对局页出现
    expect(screen.getByText(/返回大厅/)).toBeTruthy();

    // 回到大厅才能读余额，且必须确实少了这么多
    fireEvent.click(screen.getByText(/返回大厅/));
    expect(balance()).toBe(START - PLAYABLE.price);
  });

  it("锁住的行点了不扣费 —— 但这条现在没有对象可测", () => {
    // 六款全部 playable 之后，真目录里已经没有锁住的行了，而 `GamesRoute`
    // 不接受注入的目录（它就是要用真目录，这是它的职责）。所以这条改成
    // 守着那个前提：一旦目录里又出现进不去的游戏，它会红，提醒把下面这段
    // 断言恢复回来。
    //
    // 「锁住的行点不动」这件事本身没有失去覆盖 —— `GameLobby.test.tsx` 用
    // 注入的目录测了它，那里断言 `onEnter` 不被调用，而不调用 `onEnter`
    // 就等于扣费入口根本没被触及
    const blocked = GAME_CATALOG.find((g) => !isEnterable(g));
    if (!blocked) {
      expect(GAME_CATALOG.every(isEnterable)).toBe(true);
      return;
    }

    render(<GamesRoute />);
    const el = row(blocked.name);
    expect(isLocked(el)).toBe(true);
    fireEvent.click(el);

    expect(screen.queryByText(/返回大厅/)).toBeNull();
    expect(balance()).toBe(START);
  });

  it("返回大厅不退款——中途退出目前不退入场费", () => {
    // 不是在支持这个策略，是在把现状钉住。GamesRoute 里那条 TODO(退款)
    // 说的就是它：等对局有了「是否已开始」的判定再接。哪天悄悄退款了，
    // 这条会红，退款逻辑就必须走到台面上被审一遍
    render(<GamesRoute />);
    fireEvent.click(row(PLAYABLE.name));
    fireEvent.click(screen.getByText(/返回大厅/));

    expect(balance()).toBe(START - PLAYABLE.price);
  });

  it("每进一次扣一次，不是只扣第一次", () => {
    // 只扣首次是笔真会发生的错（比如把扣费写进了某个只跑一次的 effect），
    // 而它在界面上完全看不出来——第二局照常开始，只是没花钱
    render(<GamesRoute />);
    for (let i = 1; i <= 3; i++) {
      fireEvent.click(row(PLAYABLE.name));
      fireEvent.click(screen.getByText(/返回大厅/));
      expect(balance()).toBe(START - PLAYABLE.price * i);
    }
  });

  it("每笔入场流水的 id 不重复", () => {
    // 流水 id 重复不会当场报错，账本照样能加总。它现形是在很久以后：
    // 按 id 去重的对账、或以 id 为 key 的列表，会把两次入场算成一次。
    // 现在这个自增号是客户端发的，接上服务端后 id 由服务端给——在那之前
    // 这条盯住本地这一份不会重号
    render(<GamesRoute />);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(row(PLAYABLE.name));
      fireEvent.click(screen.getByText(/返回大厅/));
    }
    const entries = peekPointLedger().filter((e) => e.kind === "spend_entry");
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("单机首次通关奖励进入同一份积分账本", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<GamesRoute />);

    fireEvent.click(row("老虎机"));
    fireEvent.click(screen.getByRole("button", { name: /SPIN/ }));
    await act(async () => vi.advanceTimersByTime(SPIN_DURATION_MS));

    const jackpotNet = SLOT_CONFIG.jackpotPayout - SLOT_CONFIG.spinCost;
    expect(screen.getByRole("status").textContent).toContain(
      `派彩 ${SLOT_CONFIG.jackpotPayout} 积分 · 净赢 ${jackpotNet}`,
    );
    expect(
      peekPointLedger()
        .filter((entry) => entry.kind === "award_result")
        .at(-1),
    ).toMatchObject({
      amount: jackpotNet,
      memo: "老虎机 · 对局奖励",
    });
  });

  it("余额不够时行被锁上，点了也扣不掉", () => {
    render(<GamesRoute />);
    // 一直玩到余额不够再来一局
    let left = START;
    while (left >= PLAYABLE.price) {
      fireEvent.click(row(PLAYABLE.name));
      fireEvent.click(screen.getByText(/返回大厅/));
      left -= PLAYABLE.price;
    }

    const el = row(PLAYABLE.name);
    expect(isLocked(el)).toBe(true);
    fireEvent.click(el);

    expect(screen.queryByText(/返回大厅/)).toBeNull();
    expect(balance()).toBe(left);
    // 余额没有变成负数——扣到负分是最难解释的那种错
    expect(left).toBeGreaterThanOrEqual(0);
  });
});
