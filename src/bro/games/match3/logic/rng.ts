/**
 * 确定性伪随机数发生器（mulberry32）。
 *
 * 消消乐联机是「同种子异步竞速」（OSS-REUSE.md §7）：两名玩家拿到完全
 * 相同的初始盘面和完全相同的补充序列，比谁得分高。随机性一旦不可复现，
 * 这个玩法就不成立——不是体验变差，是规则失效。因此：
 *
 * 1. **禁止 `Math.random()`。** 它的种子不可控、算法由引擎决定，同一份
 *    代码在 Node 与浏览器上都可能产生不同序列。服务端结算与客户端预演
 *    必须逐格一致，这条没有折中余地。
 *
 * 2. **状态外置，不藏在闭包里。** 常见写法 `createRng(seed)` 返回一个
 *    带内部状态的闭包函数，但那样 RNG 状态无法随对局快照一起下发，断线
 *    重连后补充序列就接不上了（GameState 只传得走数据，传不走闭包）。
 *    这里把状态做成一个 uint32 数字：可序列化、可比较、可断言。代价是
 *    每次取值都要接收并传回新状态，调用处啰嗦——这是刻意用可读性换
 *    可复现性。
 *
 * 3. **选 mulberry32 而非更强的 PCG/xoshiro。** 三消只需要「分布够均匀
 *    且跨端一致」，不需要密码学强度或超长周期（2^32 对单局几千次取值
 *    绰绰有余）。mulberry32 只用 int32 与 `Math.imul`，在任何 JS 引擎上
 *    位运算结果完全一致；引入 64 位运算反而会把 BigInt 的性能与实现
 *    差异带进来。
 */

/** 发生器状态。一个 uint32，可直接放进对局快照随网络传输。 */
export type RngState = number;

/** 一次取值的结果：新状态 + 取到的值。状态必须回传，否则序列会卡住不动。 */
export interface RngDraw<T> {
  readonly state: RngState;
  readonly value: T;
}

/**
 * 由种子创建初始状态。
 *
 * 不对种子做额外散列：mulberry32 在每次输出前都会对状态做雪崩混合，
 * 相邻种子（比如自增的对局号）不会产生相关的序列。
 *
 * @param seed 任意数字，按 uint32 截断。
 */
export function createRng(seed: number): RngState {
  return seed >>> 0;
}

/**
 * 把字符串种子散列成数字种子（FNV-1a 32 位）。
 *
 * 服务端的 matchId 是字符串，而对局双方必须由同一个字符串推出同一个
 * 数值种子。用 FNV-1a 是因为它实现短、无依赖、跨语言实现一致——服务端
 * 若换成 Go/Rust 重写，同一个 matchId 仍要算出同一个种子。
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 取下一个 32 位无符号整数。
 *
 * 纯函数：同一个 `state` 传入任意多次，返回完全相同的结果。
 */
export function nextUint32(state: RngState): RngDraw<number> {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: next >>> 0, value: (t ^ (t >>> 14)) >>> 0 };
}

/** 取下一个 `[0, 1)` 区间的浮点数。 */
export function nextFloat(state: RngState): RngDraw<number> {
  const draw = nextUint32(state);
  return { state: draw.state, value: draw.value / 0x100000000 };
}

/**
 * 取下一个 `[0, boundExclusive)` 区间的整数。
 *
 * 直接取模而不做拒绝采样：拒绝采样会让「一次取值消耗几步状态」变得依赖
 * 取值本身，序列对齐的推理成本陡增；而实际 bound 只有个位数（元素种类
 * 数、候选集大小），2^32 下的模偏差量级在 1e-9 以下，对公平性的影响远
 * 小于两名玩家的手速差异。
 */
export function nextInt(
  state: RngState,
  boundExclusive: number,
): RngDraw<number> {
  if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
    throw new RangeError(`上界必须是正整数: ${boundExclusive}`);
  }
  const draw = nextUint32(state);
  return { state: draw.state, value: draw.value % boundExclusive };
}
