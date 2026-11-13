/**
 * 目录与路由的对齐。
 *
 * 这两处分开写就一定会分叉，而分叉的两个方向后果不同：
 *
 *   - 目录说 playable、路由没页面 → 扣了积分再退回大厅。用户看不出发生了
 *     什么，只看到分少了。这是**赔钱**的方向。
 *   - 路由有页面、目录没标 playable → 页面白做，谁也进不去。这是浪费的
 *     方向，不赔钱但同样是 bug。
 *
 * 两边都测，因为「集合相等」比「单向包含」少一次将来还要回来补的机会。
 *
 * 只比键，不渲染组件——渲染要 canvas、要 DOM，那是各游戏自己的测试文件在做
 * 的事；这里问的是「表填全了没有」，属于路由自己的责任。
 */

import { describe, expect, it } from "vitest";
import { GAME_VIEWS, canEnter } from "@/bro/lobby/GamesRoute";
import { GAME_CATALOG, isEnterable } from "@/bro/lobby/catalog";
import type { GameEntry, GameId } from "@/bro/lobby/catalog";

const playable = GAME_CATALOG.filter(isEnterable).map((g) => g.id);
const wired = Object.keys(GAME_VIEWS) as GameId[];

describe("目录 status 与路由分发表", () => {
  it("每个 playable 的游戏都有对局页——否则扣完积分退回大厅", () => {
    const missing = playable.filter((id) => !GAME_VIEWS[id]);
    expect(missing, `这些游戏标了 playable 却没有页面: ${missing}`).toEqual([]);
  });

  it("每个有页面的游戏都标了 playable——否则页面白做，进不去", () => {
    const unreachable = wired.filter(
      (id) => !GAME_CATALOG.some((g) => g.id === id && isEnterable(g)),
    );
    expect(unreachable, `这些游戏有页面却进不去: ${unreachable}`).toEqual([]);
  });

  it("分发表的值都是函数，不是组件引用", () => {
    // 写成 `go: GoGame` 也能过类型（组件本身就是函数），但调用处 `view()`
    // 会把组件当普通函数直接执行——hooks 在 React 渲染之外调用会抛
    for (const id of wired) {
      expect(typeof GAME_VIEWS[id]).toBe("function");
      expect(GAME_VIEWS[id]!.length).toBe(0);
    }
  });
});

/* ============================================================
   扣费前的那一句判断

   `canEnter` 的第二半（分发表里有没有页面）在正常状态下永远成立——上面
   那两条测试就是保证它成立的。所以要验证这半个条件真的在起作用，只能
   手工传一张残缺的表进去：这正是 `views` 作为参数存在的理由。
   ============================================================ */

describe("canEnter", () => {
  const playableId = playable[0];

  it("目录说能玩、但分发表里没有页面 → 不让进", () => {
    // 这半个条件挡的是「改了 status 忘了接页面」那一次提交。放行的话，
    // 用户点进去 = 扣掉积分再退回大厅，只看到分少了，不知道为什么
    expect(canEnter(playableId, {})).toBe(false);
  });

  it("有页面、目录也说能玩 → 放行", () => {
    expect(canEnter(playableId, { [playableId]: () => null })).toBe(true);
  });

  it("有页面、但目录没标 playable → 不让进", () => {
    // 反向：页面先写好、还没决定上线。此时不能因为「代码里有」就放人进去。
    //
    // 六款现在全部 playable，真目录里取不到这种条目了，所以造一个传进去 ——
    // 这一半守卫防的是「改 status 之前先接了页面」那一次提交，加第七款游戏
    // 的当天它就回到生产路径上，不能因为暂时取不到样本就删掉
    const shelved: GameEntry = { ...GAME_CATALOG[0], status: "engine_ready" };
    expect(
      canEnter(shelved.id, { [shelved.id]: () => null }, () => shelved),
    ).toBe(false);
  });

  it("不认识的 id → 不让进，且不抛", () => {
    const ghost = "nope" as GameId;
    expect(canEnter(ghost, { [ghost]: () => null })).toBe(false);
  });

  it("缺省用真表——生产路径上问的就是这张表", () => {
    for (const id of playable) expect(canEnter(id)).toBe(true);
  });
});
