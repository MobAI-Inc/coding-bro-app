

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const themesDir = path.resolve(__dirname, "../../src/themes");
const srcDir = path.resolve(__dirname, "../../src");

const tokens = readFileSync(path.join(themesDir, "tokens.css"), "utf-8");
const glass = readFileSync(path.join(themesDir, "glass/glass.css"), "utf-8");
const tui = readFileSync(path.join(themesDir, "tui/tui.css"), "utf-8");

/**
 * 递归收集 src 下的全部 .css。
 *
 * 用真实目录遍历而不是写死清单：写死清单只能守住写清单那天存在的文件，
 * 而这类问题恰恰是新加的文件带来的——围棋的 go.css 引用了一个不存在的
 * --bro-shadow-2，就是这么漏过去的。
 */
function allCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...allCssFiles(full));
    else if (item.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** 去掉注释。断言 CSS 行为的测试不应被解释性注释干扰。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const glassRules = stripComments(glass);

/** 提取指定选择器块内的某个 CSS 自定义属性值。 */
function tokenValue(css: string, selector: string, name: string): string {
  const blockStart = css.indexOf(selector);
  if (blockStart === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", blockStart);
  const close = css.indexOf("}", open);
  const block = css.slice(open, close);
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`token not found: ${name} in ${selector}`);
  return match[1].trim();
}

/**
 * 提取某条规则的声明块。
 *
 * 必须限定在块内：若切到文件末尾，断言会被后续无关规则里的同名声明
 * 意外满足，删掉护栏也照样通过。
 */
function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) {
    throw new Error(`malformed rule for selector: ${selector}`);
  }
  return css.slice(open, close);
}

describe("设计令牌 — 亮色 Porcelain", () => {
  it("基底为陶瓷白暖调，不是纯白", () => {
    const bg = tokenValue(tokens, ":root.light", "--bro-bg-base");
    expect(bg).toBe("#f4f1eb");
    expect(bg).not.toBe("#ffffff");
  });

  it("强调色为暖金，与奶油白同色系", () => {
    expect(tokenValue(tokens, ":root.light", "--bro-accent")).toBe("#9b7630");
  });

  it("玻璃有 saturate 提升 — 这是高级玻璃与廉价玻璃的分水岭", () => {
    expect(tokenValue(tokens, ":root.light", "--bro-glass-saturate")).toBe(
      "180%",
    );
  });
});

describe("设计令牌 — 暗色 Coding Terminal", () => {
  it("基底为终端近黑，绝不是纯黑", () => {
    const bg = tokenValue(tokens, ":root.dark", "--bro-bg-base");
    expect(bg).toBe("#050806");
    expect(bg).not.toBe("#000000");
    expect(bg).not.toBe("#000");
  });

  it("语义色经提亮去饱和，不是亮色的直接反转", () => {
    const lightDanger = tokenValue(tokens, ":root.light", "--bro-danger");
    const darkDanger = tokenValue(tokens, ":root.dark", "--bro-danger");
    expect(darkDanger).not.toBe(lightDanger);
    expect(darkDanger).toBe("#d46a5e");
  });

  it("暗色强调色为终端绿", () => {
    expect(tokenValue(tokens, ":root.dark", "--bro-accent")).toBe("#6cf09a");
  });
});

describe("设计令牌 — 主题选择器兼容", () => {
  it("同时支持 .light/.dark 与 [data-theme]", () => {
    // .light/.dark 是 cc-switch ThemeProvider 的既有约定，改它会增加合并冲突
    expect(tokens).toContain(':root[data-theme="light"]');
    expect(tokens).toContain(':root[data-theme="dark"]');
    expect(tokens).toContain(":root.light");
    expect(tokens).toContain(":root.dark");
  });
});

describe("动效令牌", () => {
  it("退出时长为进入的 60~70%，退出快才显得跟手", () => {
    const enter = parseInt(
      tokenValue(tokens, ":root {", "--bro-duration-overlay-in"),
      10,
    );
    const exit = parseInt(
      tokenValue(tokens, ":root {", "--bro-duration-overlay-out"),
      10,
    );
    const ratio = exit / enter;
    expect(ratio).toBeGreaterThanOrEqual(0.6);
    expect(ratio).toBeLessThanOrEqual(0.7);
  });

  it("微交互在 150~300ms 区间内", () => {
    const micro = parseInt(
      tokenValue(tokens, ":root {", "--bro-duration-micro"),
      10,
    );
    expect(micro).toBeGreaterThanOrEqual(150);
    expect(micro).toBeLessThanOrEqual(300);
  });
});

describe("玻璃性能护栏（§2.4 硬性约束）", () => {
  it("滚动容器内禁用 backdrop-filter — 每帧重算必掉帧", () => {
    const block = ruleBlock(glassRules, ".bro-scroll-container .bro-glass-l3");
    expect(block).toMatch(/(?<!-webkit-)backdrop-filter:\s*none/);
    expect(block).toMatch(/-webkit-backdrop-filter:\s*none/);
  });

  it("游戏对局界面全程禁用玻璃 — 帧率优先", () => {
    const block = ruleBlock(glassRules, ".bro-game-viewport .bro-glass-l3");
    expect(block).toMatch(/(?<!-webkit-)backdrop-filter:\s*none/);
    expect(block).toMatch(/-webkit-backdrop-filter:\s*none/);
    // 游戏区域连投影一并去掉，不只是去模糊
    expect(block).toMatch(/box-shadow:\s*none/);
  });

  it("响应 prefers-reduced-transparency", () => {
    expect(glass).toContain("prefers-reduced-transparency: reduce");
  });

  it("响应 prefers-reduced-motion", () => {
    expect(glass).toContain("prefers-reduced-motion: reduce");
  });

  it("不使用 iridescent / 色相旋转等 branding 展示页手法", () => {
    expect(glassRules).not.toMatch(/hue-rotate/);
    expect(glassRules).not.toMatch(/iridescen/i);
  });

  it("动画只用 transform 与 opacity，不动 width/height/top/left", () => {
    const transitions = glassRules.match(/transition:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      expect(t).not.toMatch(/\b(width|height|top|left)\b/);
    }
  });
});

describe("与 cc-switch 上游命名隔离", () => {
  // 上游 src/index.css 用 shadcn 的 HSL 三元组（--accent: 240 5% 18%），
  // 经 hsl(var(--accent)) 消费。本层用十六进制。同名会让后加载的一方
  // 静默破坏另一方——上游还会继续加 token，所以必须整层带前缀，
  // 而不是逐个躲避已知冲突。
  const upstreamCss = readFileSync(
    path.resolve(__dirname, "../../src/index.css"),
    "utf-8",
  );

  /** 提取顶层类选择器名（不含伪类、组合子）。 */
  function classNames(css: string): Set<string> {
    return new Set(
      (stripComments(css).match(/(?:^|[\s,>])(\.[a-zA-Z][\w-]*)/gm) ?? []).map(
        (m) => m.trim().replace(/^[,>]\s*/, ""),
      ),
    );
  }

  /** 提取自定义属性定义名。 */
  function customProps(css: string): Set<string> {
    return new Set(
      (stripComments(css).match(/^\s*(--[\w-]+)\s*:/gm) ?? []).map((m) =>
        m.trim().replace(/:$/, ""),
      ),
    );
  }

  it("令牌名与上游零重叠", () => {
    const mine = customProps(tokens);
    expect(mine.size).toBeGreaterThan(0);
    const collisions = [...mine].filter((n) => customProps(upstreamCss).has(n));
    expect(collisions).toEqual([]);
  });

  it("所有令牌带 --bro- 前缀", () => {
    for (const name of customProps(tokens)) {
      expect(name).toMatch(/^--bro-/);
    }
  });

  it("玻璃类名与上游零重叠 — 上游已占用 .glass / .glass-card", () => {
    const upstream = classNames(upstreamCss);
    expect(upstream).toContain(".glass");
    const collisions = [...classNames(glass)].filter((c) => upstream.has(c));
    expect(collisions).toEqual([]);
  });

  it("TUI 类名与上游零重叠 — 文档给它开了免前缀的口子，得有人守着", () => {
    // UI-DESIGN.md §0.1 允许 .tui-* 不带 bro- 前缀，理由是「本身已是独占
    // 命名空间」。那是个断言，不是事实——上游哪天加个 .tui 就静默破功。
    const upstream = classNames(upstreamCss);
    const collisions = [...classNames(tui)].filter((c) => upstream.has(c));
    expect(collisions).toEqual([]);
  });

  it("TUI 类名要么 tui- 开头要么 bro- 开头 — 免前缀的范围仅限 TUI 自身", () => {
    for (const name of classNames(tui)) {
      expect(name).toMatch(/^\.(tui|bro-)/);
    }
  });

  it("引用的令牌全部已定义 — 前缀迁移最容易漏改引用", () => {
    const defined = customProps(tokens);
    // 扫全部 src/**/*.css，不只是主题层。游戏样式引用一个不存在的令牌，
    // CSS 不报错，只是那条声明整条失效——盯着界面看是看不出来的。
    for (const file of allCssFiles(srcDir)) {
      const css = stripComments(readFileSync(file, "utf-8"));
      const refs = css.match(/var\((--bro-[\w-]+)/g) ?? [];
      for (const ref of refs) {
        const name = ref.slice(4);
        const where = path.relative(srcDir, file);
        expect(defined.has(name), `${where} 引用了未定义的令牌 ${name}`).toBe(
          true,
        );
      }
    }
  });

  it("亮暗两套定义同一批令牌 — 只在一套里定义的会在另一套静默变空", () => {
    // 只在暗色定义、亮色引用的令牌，在亮色下 var() 拿到空值，那条声明
    // 整条失效。表现是「某个东西在亮色模式下没有阴影/没有描边」，而且
    // 只在切过去的那一刻才看得见。
    const light = customProps(
      tokens.slice(tokens.indexOf(":root.light"), tokens.indexOf(":root.dark")),
    );
    const dark = customProps(
      tokens.slice(tokens.indexOf(":root.dark"), tokens.lastIndexOf(":root {")),
    );

    // 明确登记的单边令牌：辉光是暗色模式专有的表达手段（UI-DESIGN.md §1.2），
    // 亮色下没有对应概念，不是漏写。
    const darkOnly = new Set(["--bro-accent-glow"]);

    expect([...dark].filter((n) => !light.has(n) && !darkOnly.has(n))).toEqual(
      [],
    );
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
  });
});

describe("TUI 渲染层（§6）", () => {
  it("使用等宽字体", () => {
    expect(tui).toMatch(/font-family:\s*var\(--bro-font-mono\)/);
  });

  it("TUI 区域内无圆角、无阴影、无模糊 — 完全禁用玻璃语言", () => {
    const block = tui.slice(
      tui.indexOf(".tui {"),
      tui.indexOf("}", tui.indexOf(".tui {")),
    );
    expect(block).toMatch(/border-radius:\s*0/);
    expect(block).toMatch(/box-shadow:\s*none/);
    expect(block).toMatch(/backdrop-filter:\s*none/);
  });

  it("字符网格行高固定，否则 box-drawing 边框错位", () => {
    const block = tui.slice(
      tui.indexOf(".tui {"),
      tui.indexOf("}", tui.indexOf(".tui {")),
    );
    expect(block).toMatch(/line-height:\s*1\.4/);
  });

  it("光标闪烁在 reduced-motion 下停止", () => {
    expect(tui).toContain("prefers-reduced-motion: reduce");
  });

  it("焦点环存在且未被移除（§9 任何情况不可移除）", () => {
    const rules = stripComments(tui);
    expect(rules).toMatch(/focus-visible/);
    expect(rules).toMatch(/outline:\s*2px\s+solid\s+var\(--bro-accent\)/);
    expect(rules).not.toMatch(/outline:\s*(none|0)\b/);
  });
});
