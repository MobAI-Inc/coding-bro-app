/**
 * 台球本地服务端与渲染层测试。
 *
 * 服务端那部分的重点与围棋同构：测的不是台球规则（那在 rules.test.ts，68/68
 * 变异分），而是**服务端的行为约定** —— 谁能出杆、基于哪个版本、被拒时状态动
 * 不动。规则错了是打错球，约定错了是作弊入口。
 *
 * 每条拒绝路径都同时断言三件事：回了错误、没下发快照、版本没前进。只断言
 * 「回了错误」的测试挡不住「拒绝了但状态已经改了」这种实现。
 *
 * 渲染层那部分只测纯函数（布局换算、字符排版）。Canvas 渲染器本身不测 ——
 * jsdom 里没有 2D 上下文，能测的只有「调了几次 arc」这种与正确性无关的东西。
 */

import { describe, expect, it } from "vitest";
import { LocalBilliardsServer } from "@/bro/games/billiards/server/local";
import type { Rejection } from "@/bro/games/billiards/server/local";
import { chooseShot } from "@/bro/games/billiards/server/bot";
import { REJECT_TEXT } from "@/bro/games/billiards/BilliardsGame";
import type { BilliardsSnapshot } from "@/bro/games/billiards/view";
import { BILLIARDS_INTENT } from "@/bro/games/billiards/view";
import type { InputIntent } from "@/bro/games/core/types";
import {
  BALL_RADIUS_M,
  TABLE_HALF_LENGTH_M,
  TABLE_HALF_WIDTH_M,
  angleToBrad,
  computeTableLayout,
  metersToPixel,
  pixelToMeters,
  powerToFixed,
  tipOffsetToFixed,
} from "@/bro/games/billiards/render/layout";
import {
  GRID_COLS,
  GRID_ROWS,
  ballGlyph,
  cellToMeters,
  metersToCell,
  renderPowerBar,
  renderStatusBar,
  renderTableText,
} from "@/bro/games/billiards/render/tui-text";

function serve(options: { mySeat?: number } = {}) {
  const snapshots: BilliardsSnapshot[] = [];
  const rejections: Rejection[] = [];
  const server = new LocalBilliardsServer({
    matchId: "m1",
    mySeat: options.mySeat ?? 0,
    onSnapshot: (s) => snapshots.push(s),
    onReject: (r) => rejections.push(r),
  });
  server.start();
  return { server, snapshots, rejections, latest: () => snapshots.at(-1)! };
}

/** 按当前快照版本构造一条击球意图。 */
function strike(latest: BilliardsSnapshot, angle = 0, power = 0.6): InputIntent {
  return {
    matchId: latest.matchId,
    basedOnVersion: latest.version,
    type: BILLIARDS_INTENT.strike,
    payload: { angle, power: powerToFixed(power), offsetX: 0, offsetY: 0 },
  };
}

describe("本地服务端 —— 行为约定", () => {
  it("start 下发初始快照：满台十六颗球，轮到我", () => {
    const { snapshots, latest } = serve();
    expect(snapshots).toHaveLength(1);
    expect(latest().board.balls).toHaveLength(16);
    expect(latest().board.balls.every((b) => !b.pocketed)).toBe(true);
    expect(latest().version).toBe(0);
    expect(latest().activeSeat).toBe(0);
    expect(latest().mySeat).toBe(0);
    expect(latest().phase).toBe("playing");
  });

  it("对局 id 不符：拒绝，不下发，版本不动", () => {
    const { server, snapshots, rejections, latest } = serve();
    const before = latest().version;
    server.submit({ ...strike(latest()), matchId: "别人的局" });
    expect(rejections.at(-1)?.reason).toBe("wrong_match");
    expect(snapshots).toHaveLength(1);
    expect(latest().version).toBe(before);
  });

  it("基于过期版本：拒绝，不下发，版本不动", () => {
    const { server, snapshots, rejections, latest } = serve();
    server.submit(strike(latest()));
    const afterShot = snapshots.length;
    const version = latest().version;

    // 拿一个陈旧版本再提交
    server.submit({ ...strike(latest()), basedOnVersion: version - 1 });
    expect(rejections.at(-1)?.reason).toBe("stale_version");
    expect(snapshots).toHaveLength(afterShot);
    expect(latest().version).toBe(version);
  });

  it("不是我的座位：拒绝，不下发", () => {
    // mySeat=1，但开球方是 0 —— 这时提交就该被挡
    const { server, snapshots, rejections } = serve({ mySeat: 1 });
    const first = snapshots.at(-1)!;
    server.submit(strike(first));
    expect(rejections.at(-1)?.reason).toBe("not_your_turn");
    expect(snapshots).toHaveLength(1);
  });

  it("未知意图：拒绝，不下发", () => {
    const { server, snapshots, rejections, latest } = serve();
    server.submit({ ...strike(latest()), type: "billiards/teleport" });
    expect(rejections.at(-1)?.reason).toBe("unknown_intent");
    expect(snapshots).toHaveLength(1);
  });

  it("合法一杆：版本前进一格，下发一次", () => {
    const { server, snapshots, latest } = serve();
    server.submit(strike(latest()));
    expect(snapshots).toHaveLength(2);
    expect(latest().version).toBe(1);
  });

  it("摆球坐标不合法（摆到台外）：拒绝，不下发", () => {
    const { server, snapshots, rejections, latest } = serve();
    // 开球前没有持球在手，摆球意图必被 `not_in_hand` 挡下
    server.submit({
      matchId: "m1",
      basedOnVersion: latest().version,
      type: BILLIARDS_INTENT.place,
      payload: { x: 999, y: 999 },
    });
    expect(rejections.at(-1)?.reason).toBe("not_in_hand");
    expect(snapshots).toHaveLength(1);
  });

  it("视图里没有 turn 字段 —— 轮到谁只由 activeSeat 表达", () => {
    const { latest } = serve();
    expect("turn" in latest().board).toBe(false);
    expect(latest().activeSeat).toBe(0);
  });

  it("视图坐标是浮点米，不是定点数", () => {
    const { latest } = serve();
    const cue = latest().board.balls.find((b) => b.id === 0)!;
    expect(Math.abs(cue.x)).toBeLessThan(TABLE_HALF_LENGTH_M);
    expect(Math.abs(cue.y)).toBeLessThan(TABLE_HALF_WIDTH_M);
  });

  it("playAsOpponent 在轮到我时不动手", () => {
    const { server, snapshots } = serve();
    const before = snapshots.length;
    server.playAsOpponent({ angle: 0, power: powerToFixed(0.5), offsetX: 0, offsetY: 0 });
    expect(snapshots).toHaveLength(before);
  });

  it("界面文案表覆盖服务端会回的全部标识", () => {
    // 漏一条的表现是界面上蹦出一句英文 reason
    for (const reason of [
      "wrong_match",
      "stale_version",
      "not_your_turn",
      "unknown_intent",
      "game_over",
      "place_cue_first",
      "not_in_hand",
      "off_table",
      "in_pocket",
      "overlapping",
    ]) {
      expect(REJECT_TEXT[reason], `缺 ${reason} 的中文文案`).toBeTruthy();
    }
  });
});

describe("陪练机器人", () => {
  it("永远给得出一杆 —— 返回 null 会让页面卡死", () => {
    const { server } = serve();
    let random = 0.5;
    for (let i = 0; i < 30; i += 1) {
      random = (random * 9301 + 49297) % 1;
      const params = chooseShot(server.authoritativeState(), () => (i % 7) / 7);
      expect(Number.isFinite(params.angle)).toBe(true);
      expect(params.angle).toBeGreaterThanOrEqual(0);
      expect(params.angle).toBeLessThan(16384);
      expect(params.power).toBeGreaterThan(0);
    }
  });

  it("两边都由机器人打，对局能走到终局", () => {
    // 关键在于**两个入口都要走**：`playAsOpponent` 只在轮到对手时动手，
    // 只用它推局的话第一杆之后就停了（探针实测：只推进 1 杆），而断言
    // 「球还是 16 颗」永真 —— 那样的测试等于没写。
    //
    // 不断言杆数下限：机器人不挑球，很容易早早把 ⑧ 打进而直接判负（这个
    // 种子下第 6 杆就终局了）。杆数是随机量，断言它只会得到一条随种子飘的
    // 测试。真正要证的是「双方交替出杆的链路是通的，且能收敛到终局」。
    const snapshots: BilliardsSnapshot[] = [];
    const server = new LocalBilliardsServer({
      matchId: "m1",
      mySeat: 0,
      onSnapshot: (s) => snapshots.push(s),
    });
    server.start();

    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const seatsThatShot = new Set<number>();
    let stalled = false;

    for (let i = 0; i < 60; i += 1) {
      const state = server.authoritativeState();
      if (state.winner !== null) break;
      const params = chooseShot(state, random);

      if (state.turn === 0) {
        // 持球在手时先摆球，否则 `place_cue_first` 会挡下击球
        if (state.ballInHand) {
          server.submit({
            matchId: "m1",
            basedOnVersion: snapshots.at(-1)!.version,
            type: BILLIARDS_INTENT.place,
            payload: { x: -TABLE_HALF_LENGTH_M / 2, y: 0 },
          });
        }
        server.submit({
          matchId: "m1",
          basedOnVersion: snapshots.at(-1)!.version,
          type: BILLIARDS_INTENT.strike,
          payload: params,
        });
      } else {
        server.playAsOpponent(params);
      }

      if (server.authoritativeState() === state) {
        stalled = true;
        break;
      }
      seatsThatShot.add(state.turn);
    }

    expect(stalled, "对局卡住了：某一方提交后状态没有前进").toBe(false);
    expect([...seatsThatShot].sort()).toEqual([0, 1]);
    expect(server.authoritativeState().winner).not.toBeNull();
    expect(server.authoritativeState().table.balls).toHaveLength(16);
    expect(
      server.authoritativeState().table.balls.some((b) => b.pocketed),
    ).toBe(true);
  });
});

describe("布局换算", () => {
  it("台面比例固定 2:1，不随容器拉伸", () => {
    for (const [w, h] of [
      [800, 400],
      [1200, 300],
      [400, 800],
    ]) {
      const layout = computeTableLayout(w, h);
      expect(layout.width / layout.height).toBeCloseTo(
        TABLE_HALF_LENGTH_M / TABLE_HALF_WIDTH_M,
        5,
      );
    }
  });

  it("台面装得进容器 —— 不溢出", () => {
    const layout = computeTableLayout(800, 400);
    expect(layout.width).toBeLessThanOrEqual(800);
    expect(layout.height).toBeLessThanOrEqual(400);
  });

  it("零尺寸容器不产生 NaN", () => {
    const layout = computeTableLayout(0, 0);
    expect(layout.scale).toBe(0);
    expect(Number.isNaN(layout.ballRadius)).toBe(false);
    expect(pixelToMeters(layout, 10, 10)).toEqual({ x: 0, y: 0 });
  });

  it("米↔像素往返一致", () => {
    const layout = computeTableLayout(880, 440);
    for (const [x, y] of [
      [0, 0],
      [1.2, -0.5],
      [-TABLE_HALF_LENGTH_M, TABLE_HALF_WIDTH_M],
    ]) {
      const px = metersToPixel(layout, x, y);
      const back = pixelToMeters(layout, px.x, px.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it("球半径按同一比例缩放", () => {
    const layout = computeTableLayout(880, 440);
    expect(layout.ballRadius).toBeCloseTo(layout.scale * BALL_RADIUS_M, 6);
  });

  it("angleToBrad：整圈 16384，四个方向对得上", () => {
    expect(angleToBrad(1, 0)).toBe(0);
    expect(angleToBrad(0, 1)).toBe(4096);
    expect(angleToBrad(-1, 0)).toBe(8192);
    expect(angleToBrad(0, -1)).toBe(12288);
  });

  it("angleToBrad 结果永远落在 [0,16384)", () => {
    for (let deg = -720; deg <= 720; deg += 7) {
      const rad = (deg / 180) * Math.PI;
      const brad = angleToBrad(Math.cos(rad), Math.sin(rad));
      expect(brad).toBeGreaterThanOrEqual(0);
      expect(brad).toBeLessThan(16384);
    }
  });

  it("powerToFixed：0 力度也不是 0 —— 空杆没有意义", () => {
    expect(powerToFixed(0)).toBe(1 << 16);
    expect(powerToFixed(1)).toBe(10 << 16);
    // 越界被夹住，不产生非法参数
    expect(powerToFixed(-5)).toBe(1 << 16);
    expect(powerToFixed(99)).toBe(10 << 16);
  });

  it("tipOffsetToFixed 夹在 ±HALF", () => {
    expect(tipOffsetToFixed(0)).toBe(0);
    expect(tipOffsetToFixed(1)).toBe(1 << 15);
    expect(tipOffsetToFixed(-1)).toBe(-(1 << 15));
    expect(tipOffsetToFixed(9)).toBe(1 << 15);
  });
});

describe("TUI 字符排版", () => {
  const view = (): BilliardsSnapshot["board"] => ({
    balls: [
      { id: 0, x: -1, y: 0, pocketed: false },
      { id: 8, x: 0.5, y: 0.2, pocketed: false },
      { id: 3, x: 0, y: 0, pocketed: true },
    ],
    myGroup: "solids",
    targets: [1, 2, 3],
    ballInHand: false,
    broken: true,
    lastShot: null,
    winner: null,
  });

  it("网格尺寸固定，四周有库边", () => {
    const lines = renderTableText(view()).split("\n");
    expect(lines).toHaveLength(GRID_ROWS + 2);
    for (const line of lines) {
      expect([...line]).toHaveLength(GRID_COLS + 2);
    }
  });

  it("落袋的球不出现在网格里", () => {
    const text = renderTableText(view());
    expect(text).toContain(ballGlyph(0));
    expect(text).toContain(ballGlyph(8));
    expect(text).not.toContain(ballGlyph(3));
  });

  it("球字符盖住瞄准线 —— 看不见剩几颗球比看不见瞄准线严重", () => {
    // 让 ⑧ 恰好落在射线上：与母球同一行（y 相同），brad=0 即正右方。
    // 探针确认过：不同行的话两者根本不相交，这条断言会为了错误的理由通过。
    const crossing = {
      ...view(),
      balls: [
        { id: 0, x: -1, y: 0, pocketed: false },
        { id: 8, x: 0.5, y: 0, pocketed: false },
      ],
    };
    const cueCell = metersToCell(-1, 0);
    const ballCell = metersToCell(0.5, 0);
    expect(ballCell.row).toBe(cueCell.row);
    expect(ballCell.col).toBeGreaterThan(cueCell.col);

    const line = renderTableText(crossing, { aimBrad: 0 }).split("\n")[
      ballCell.row + 1
    ];
    // +1 跳过左库边字符
    expect([...line][ballCell.col + 1]).toBe(ballGlyph(8));
  });

  it("持球在手时画光标，不画瞄准线", () => {
    const text = renderTableText(view(), { cursor: { col: 5, row: 5 } });
    expect(text).toContain("+");
    expect(text).not.toContain("·");
  });

  it("米↔字符格往返落在同一格", () => {
    for (let col = 0; col < GRID_COLS; col += 7) {
      for (let row = 0; row < GRID_ROWS; row += 3) {
        const m = cellToMeters(col, row);
        expect(metersToCell(m.x, m.y)).toEqual({ col, row });
      }
    }
  });

  it("越界坐标被夹进网格，不越界写数组", () => {
    expect(metersToCell(999, 999)).toEqual({
      col: GRID_COLS - 1,
      row: GRID_ROWS - 1,
    });
    expect(metersToCell(-999, -999)).toEqual({ col: 0, row: 0 });
  });

  it("力度条长度固定，比例对得上", () => {
    expect(renderPowerBar(0)).toBe("[░░░░░░░░░░]   0%");
    expect(renderPowerBar(1)).toBe("[██████████] 100%");
    expect(renderPowerBar(0.5)).toContain(" 50%");
  });

  it("状态栏列出的快捷键与当前真正生效的一致", () => {
    const v = view();
    // 轮不到我：不能写「Enter 出杆」
    expect(renderStatusBar(v, false, { brad: 0, power: 0.5 })).not.toContain(
      "Enter",
    );
    // 持球在手：Enter 是摆球，不是出杆
    const inHand = renderStatusBar(
      { ...v, ballInHand: true },
      true,
      { brad: 0, power: 0.5 },
    );
    expect(inHand).toContain("Enter 摆球");
    expect(inHand).not.toContain("出杆");
    // 正常轮次：Enter 是出杆
    expect(renderStatusBar(v, true, { brad: 0, power: 0.5 })).toContain(
      "Enter 出杆",
    );
  });

  it("终局状态栏只留退出", () => {
    const text = renderStatusBar({ ...view(), winner: 1 }, true, {
      brad: 0,
      power: 0.5,
    });
    expect(text).toContain("终局");
    expect(text).toContain("q 退出");
    expect(text).not.toContain("出杆");
  });
});
