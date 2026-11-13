/**
 * 游戏大厅（两套外观）。
 *
 * 核心约束：两套外观、一套信息架构。亮色玻璃卡片和暗色 TUI 列表显示的字段、
 * 能点的东西、拦人的规则必须完全一致——如果哪一边偷偷少拦了一款没做完的
 * 游戏，暗色模式的用户就会点进空白页。所以每条规则都在两套外观下各测一遍。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GameLobby } from "@/bro/lobby/GameLobby";
import { GAME_CATALOG, isEnterable } from "@/bro/lobby/catalog";
import type { GameEntry } from "@/bro/lobby/catalog";
import type { LedgerEntry } from "@/bro/points/types";

/** 造一份余额恰为 amount 的账本。 */
function ledgerOf(amount: number): LedgerEntry[] {
  return [{ id: "seed", kind: "earn_usage", amount, at: 0, memo: "t" }];
}

/**
 * 掺一款「还没做完」的游戏进目录。
 *
 * 六款现在全部 playable，真目录里已经没有 `unbuilt` 了 —— 但那条支路没死，
 * 加第七款游戏的当天它就是建设中。所以「没做完的点不动」这类断言改成对着
 * 一份注入的目录跑：既不用把断言删掉，也不用等哪款游戏退回未完成状态。
 *
 * 装成日麻（复用它的 id）而不是编一个新 id：`GameId` 是闭合联合类型，
 * 编新 id 过不了类型检查，而放宽那个类型只为测试服务是本末倒置。
 */
const UNBUILT: GameEntry = {
  ...GAME_CATALOG.find((g) => g.id === "slots")!,
  status: "planned",
};

/** 真目录，但日麻标成建设中。用于所有涉及 `unbuilt` 的断言。 */
const WITH_UNBUILT: readonly GameEntry[] = GAME_CATALOG.map((g) =>
  g.id === "slots" ? UNBUILT : g,
);

/** 足够进任何一款游戏。 */
const RICH = ledgerOf(10_000);

function setDark(on: boolean) {
  document.documentElement.classList.toggle("dark", on);
}

afterEach(() => {
  cleanup();
  setDark(false);
});

const MODES = [
  { name: "玻璃", dark: false },
  { name: "TUI", dark: true },
] as const;

describe.each(MODES)("$name 模式", ({ dark }) => {
  function mount(
    ledger: readonly LedgerEntry[],
    onEnter = vi.fn(),
    catalog?: readonly GameEntry[],
  ) {
    setDark(dark);
    render(<GameLobby ledger={ledger} onEnter={onEnter} catalog={catalog} />);
    return onEnter;
  }

  it("六款游戏全部列出 — 没做完的也要列，只是不能进", () => {
    mount(RICH);
    for (const g of GAME_CATALOG) {
      expect(screen.getByText(g.name), `${g.id} 没出现`).toBeTruthy();
    }
  });

  it("显示余额", () => {
    mount(ledgerOf(1234));
    expect(screen.getAllByText("1234").length).toBeGreaterThan(0);
  });

  it("说清楚积分靠成绩结算，不承诺无门槛赠送", () => {
    mount(RICH);
    expect(screen.getByText(/积分入场、按结果结算/)).toBeTruthy();
    expect(screen.getByText(/打得好/)).toBeTruthy();
    expect(screen.queryByText(/免费领取|免费赚积分/)).toBeNull();
  });

  it("每款都显示入场费 — 花多少积分必须在点之前就看得见", () => {
    mount(RICH);
    for (const g of GAME_CATALOG) {
      // 玻璃卡片写「80 积分」，TUI 只写「80」，用前缀匹配同时覆盖两者
      const shown = screen.getAllByText(new RegExp(`^${g.price}(\\s|$)`));
      expect(shown.length, `${g.id} 的价格没显示`).toBeGreaterThan(0);
    }
  });

  it("余额充足时能进 playable 的游戏", () => {
    const onEnter = mount(RICH);
    fireEvent.click(screen.getByText("百家乐"));
    expect(onEnter).toHaveBeenCalledWith("baccarat");
  });

  it("目录里六款全部能进 —— 大厅上不该有点不动的卡片", () => {
    // 这条盯的是发布状态：哪款游戏悄悄退回未完成，或者新加的第七款忘了接
    // 页面，都会在这里变红。下面几条测「点不动长什么样」的用注入目录。
    mount(RICH);
    expect(screen.queryByText("建设中")).toBeNull();
  });

  it("没做完的游戏点不动，且标出「建设中」", () => {
    const onEnter = mount(RICH, vi.fn(), WITH_UNBUILT);
    const unbuilt = WITH_UNBUILT.filter((g) => !isEnterable(g));
    expect(unbuilt.length).toBeGreaterThan(0);
    for (const g of unbuilt) {
      fireEvent.click(screen.getByText(g.name));
    }
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getAllByText("建设中")).toHaveLength(unbuilt.length);
  });

  it("积分不足时点不动，且标出「积分不足」", () => {
    // 余额刚好差 1，只影响判断结果，不影响哪些游戏做完了
    const game = GAME_CATALOG.find((g) => g.id === "baccarat")!;
    const onEnter = mount(ledgerOf(game.price - 1));

    fireEvent.click(screen.getByText("百家乐"));
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getAllByText("积分不足").length).toBeGreaterThan(0);
  });

  it("余额恰好等于入场费时能进 — 边界上卡住会让人永远差一点", () => {
    const game = GAME_CATALOG.find((g) => g.id === "baccarat")!;
    const onEnter = mount(ledgerOf(game.price));
    fireEvent.click(screen.getByText("百家乐"));
    expect(onEnter).toHaveBeenCalledWith("baccarat");
  });

  it("不能进的原因是「没做完」还是「钱不够」要分得清", () => {
    // 两种都灰，但原因不同，处理办法也不同：一个等更新，一个去攒积分。
    // 混成同一句话，用户会以为攒够积分就能玩日麻。
    //
    // 余额取「最便宜的能玩的那款再少 1」，这样必定同时存在两类：至少一款
    // 做完了但进不起，其余是没做完。数字从目录算而不是写死——写死的话，
    // 哪天某款游戏做完了或改了价，这条测试会以一个和它无关的理由变红。
    const playable = WITH_UNBUILT.filter(isEnterable);
    const balance = Math.min(...playable.map((g) => g.price)) - 1;
    const unbuilt = WITH_UNBUILT.length - playable.length;
    expect(unbuilt, "全做完了就没有「建设中」可测").toBeGreaterThan(0);

    setDark(dark);
    render(
      <GameLobby
        ledger={ledgerOf(balance)}
        onEnter={vi.fn()}
        catalog={WITH_UNBUILT}
      />,
    );

    expect(screen.getAllByText("建设中")).toHaveLength(unbuilt);
    expect(screen.getAllByText("积分不足").length).toBeGreaterThan(0);
  });
});

describe("玻璃模式 — 无障碍", () => {
  it("禁用卡片的无障碍名称说明了原因，不只是游戏名", () => {
    // 读屏念禁用按钮时只会念出无障碍名称。名称里不带原因，听到的就是
    // 「日本麻将，按钮，不可用」——不可用，但不知道为什么。
    render(
      <GameLobby ledger={RICH} onEnter={vi.fn()} catalog={WITH_UNBUILT} />,
    );
    const game = GAME_CATALOG.find((g) => g.id === "baccarat")!;
    expect(screen.getByLabelText("老虎机，建设中")).toBeTruthy();
    expect(
      screen.getByLabelText(`进入百家乐，${game.price} 积分`),
    ).toBeTruthy();
  });

  it("不能进的卡片是真的 disabled，不是只画灰", () => {
    render(
      <GameLobby ledger={RICH} onEnter={vi.fn()} catalog={WITH_UNBUILT} />,
    );
    const slots = screen.getByLabelText("老虎机，建设中");
    expect((slots as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TUI 模式 — 键盘操作", () => {
  function mountTui(
    ledger: readonly LedgerEntry[] = RICH,
    catalog?: readonly GameEntry[],
  ) {
    setDark(true);
    const onEnter = vi.fn();
    render(<GameLobby ledger={ledger} onEnter={onEnter} catalog={catalog} />);
    return { list: screen.getByRole("list", { name: "游戏列表" }), onEnter };
  }

  /** 当前光标所在行的游戏名。 */
  function selected(list: HTMLElement): string {
    const row = list.querySelector("[data-selected]");
    if (!row) throw new Error("没有选中行");
    // 取名称那一格，不按文本正则找：说明文字里也可能含游戏名
    // （象棋的说明就是「中国象棋 · 标准规则」），按文本找会命中两处
    const name = row.querySelector(".bro-lobby-tui__name");
    if (!name) throw new Error("选中行里没有名称格");
    return name.textContent!;
  }

  it("初始选中第一行", () => {
    const { list } = mountTui();
    expect(selected(list)).toBe("百家乐");
  });

  it("j / ArrowDown 下移，k / ArrowUp 上移", () => {
    const { list } = mountTui();
    fireEvent.keyDown(list, { key: "j" });
    expect(selected(list)).toBe("老虎机");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(selected(list)).toBe("德州扑克");
    fireEvent.keyDown(list, { key: "k" });
    expect(selected(list)).toBe("老虎机");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(selected(list)).toBe("百家乐");
  });

  it("光标在两端不越界 — 越界会让选中项消失，整个列表看着像坏了", () => {
    const { list } = mountTui();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(list, { key: "k" });
    expect(selected(list)).toBe("百家乐");
    for (let i = 0; i < GAME_CATALOG.length + 3; i++) {
      fireEvent.keyDown(list, { key: "j" });
    }
    expect(selected(list)).toBe(GAME_CATALOG[GAME_CATALOG.length - 1].name);
  });

  it("Enter 进入当前行", () => {
    const { list, onEnter } = mountTui();
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledWith("baccarat");
  });

  /**
   * 光标从第一行走到第一款**进不去**的游戏上，返回走了几步。
   *
   * 不写死是哪一款：随着各游戏陆续做完，谁进不去会变（象棋一度是这一款，
   * 现在已经能进了）。写死的话，做完一款就要回来改一次测试，而每次改都是
   * 一次「顺手把断言也放宽」的机会。这里问的是「进不去的行按 Enter 没反应」，
   * 与具体是哪一款无关。
   */
  function toBlockedRow(list: HTMLElement): void {
    const i = WITH_UNBUILT.findIndex((g) => !isEnterable(g));
    if (i < 0) throw new Error("目录里没有进不去的游戏，这条测试已失去对象");
    for (let n = 0; n < i; n++) fireEvent.keyDown(list, { key: "j" });
  }

  it("Enter 落在不能进的行上不触发 — 键盘不能绕开鼠标那边的拦截", () => {
    const { list, onEnter } = mountTui(RICH, WITH_UNBUILT);
    toBlockedRow(list);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("列表可聚焦 — 不可聚焦的话上面那些按键根本收不到", () => {
    const { list } = mountTui();
    expect(list.getAttribute("tabindex")).toBe("0");
  });

  it("选中不只靠颜色，还有 › 光标字符", () => {
    const { list } = mountTui();
    const row = list.querySelector("[data-selected]")!;
    expect(row.textContent).toContain("›");
  });

  it("状态栏列出的快捷键与当前真正能用的一致", () => {
    // TUI 的状态栏就是它的帮助文档。写着 Enter 却按不动，比不写更糟。
    const { list } = mountTui(RICH, WITH_UNBUILT);
    expect(screen.getByText(/Enter 进入/)).toBeTruthy();

    toBlockedRow(list); // 移到进不去的那一行
    expect(screen.queryByText(/Enter 进入/)).toBeNull();
  });
});
