#!/usr/bin/env node
/**
 * 变异测试：对源文件做定向的文本替换，跑用例，报告**存活**的变异体。
 *
 * 不用 Stryker 之类的通用工具，理由是它们对定点数学几乎无效 —— 通用变异器
 * 生成的大半是「把 65536 改成 65537」这类在物理上无意义的变体，噪音淹没信号。
 * 手工列出的变异体每一个都对应一条真实的写错方式。
 *
 * 用法：node scripts/mutate.mjs <mutants.json>
 *
 * 变异体文件格式：{ "target": "src/...", "tests": "tests/...", "mutants": [
 *   { "id": "M1", "desc": "...", "from": "原文", "to": "改后" } ] }
 *
 * 标了 `"equivalent": true` 的变异体是**已经定性过**的等价变异体（改了但语义
 * 相同），不计入变异分。这个标记不是「杀不掉就贴上」的免死金牌 —— 每一个都要
 * 在 desc 里写明为什么等价，且实测验证过。反过来，等价变异体若哪天被杀死了，
 * 说明等价的依据已经不成立，脚本会报错要求重新定性。
 *
 * `from` 必须在目标文件中**恰好出现一次** —— 出现多次就说明这个变异体的定位
 * 是模糊的，改了哪一处不确定，报告也就没有意义。脚本会在动源文件之前一次校验
 * 完所有锚点，直接报错而不是猜。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const specPath = process.argv[2];
if (!specPath) {
  console.error("用法: node scripts/mutate.mjs <mutants.json>");
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const original = readFileSync(spec.target, "utf8");

function runTests() {
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=dot", spec.tests], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return true; // 全绿
  } catch {
    return false; // 有用例红了
  }
}

// 先校验所有变异体的锚点，**在动源文件之前**。
//
// 这一步曾经写在循环里：发现锚点不唯一就 process.exit(1)。而 process.exit 不会
// 跑 finally —— 于是脚本带着上一个变异体的改动退出，源文件被留在变异状态，
// 下一次运行「基线未通过」。（真发生过：M64 的变异被留在了盘上。）
// 校验不需要写文件，那就一次全部验完再开始，让「动过源文件」的窗口里只剩
// 一种退出路径。
const badAnchors = spec.mutants
  .map((m) => ({ m, count: original.split(m.from).length - 1 }))
  .filter(({ count }) => count !== 1);
if (badAnchors.length > 0) {
  for (const { m, count } of badAnchors) {
    console.error(`${m.id} 的 from 在目标文件中出现 ${count} 次，必须恰好 1 次`);
  }
  process.exit(1);
}

// 再确认基线是绿的。基线红的话所有变异体都会「被杀死」，报告全是假阳性。
if (!runTests()) {
  console.error("基线用例未通过，变异测试无意义。先修用例。");
  process.exit(1);
}

const survivors = [];
const unexpectedlyKilled = [];
try {
  for (const m of spec.mutants) {
    writeFileSync(spec.target, original.replace(m.from, m.to));
    const green = runTests();
    if (green) {
      if (!m.equivalent) survivors.push(m);
      console.log(`${m.equivalent ? "等价" : "存活"} ${m.id}  ${m.desc}`);
    } else {
      if (m.equivalent) unexpectedlyKilled.push(m);
      console.log(`杀死 ${m.id}  ${m.desc}`);
    }
  }
} finally {
  // 无论如何都要还原，否则一次 Ctrl-C 就把源文件留在变异状态。
  writeFileSync(spec.target, original);
}

const equivalent = spec.mutants.filter((m) => m.equivalent).length;
const total = spec.mutants.length;
const scored = total - equivalent;
console.log(`\n变异分 ${scored - survivors.length}/${scored}（另有 ${equivalent} 个已定性的等价变异体不计分）`);
if (survivors.length > 0) {
  console.log("\n存活的变异体需要逐个定性（补用例 / 等价变异体 / 死代码 / 设计缺陷）：");
  for (const m of survivors) console.log(`  ${m.id}  ${m.desc}`);
}
// 等价变异体被杀死 = 它不再等价了。多半是实现变了，而当初判定等价的那个理由
// （「这个分支被上游短路了」之类）已经不成立 —— 结论要重新做，不是把标记删掉。
if (unexpectedlyKilled.length > 0) {
  console.log("\n以下变异体标了 equivalent 却被杀死了，等价性的依据已失效，需重新定性：");
  for (const m of unexpectedlyKilled) console.log(`  ${m.id}  ${m.desc}`);
  process.exitCode = 1;
}
