/**
 * 台球：Q16.16 定点数。
 *
 * 台球是六款游戏里唯一**不传状态、传输入**的（TECH-DESIGN.md §6.3）：玩家提交
 * 「角度 + 力度 + 击球点」，两端客户端与服务端各自演算，必须得到**逐位相同**的
 * 结果。差一个最低位，几十次碰撞放大之后就是「我这边进袋了，你那边没进」，
 * 而这局是扣了积分的。
 *
 * 浮点做不到这件事。IEEE-754 的加减乘除本身是精确定义的，但一整条物理链路上
 * 逃不掉的是超越函数 —— `Math.sin`、`Math.cos`、`Math.pow` 在 ECMAScript 里是
 * **implementation-approximated**，规范允许各引擎自行取近似。同一份代码在
 * Windows 的 V8、macOS 的 JavaScriptCore、服务端的 Node 上可以给出不同的最低位。
 * 于是整个解算层不碰浮点，改用 32 位整数表示的定点数：高 16 位整数、低 16 位小数。
 *
 * 表示范围 [-32768, 32768)，精度 1/65536 ≈ 0.0000153。球桌用「米」作单位的话，
 * 精度是 15 微米、量程是 ±32 公里 —— 对一张 2.84m 的球台绰绰有余。
 *
 * ## 取整方向：向零截断，不是 floor
 *
 * 这是刻意选的，理由是**镜像对称**。floor 向 -∞ 取整，会让 `mul(-a, b)` 不等于
 * `-mul(a, b)`：raw 1 × raw 1 得 0，而 raw -1 × raw 1 得 -1。放到球桌上就是
 * 向左滚的球和向右滚的球减速快慢不同、左库和右库反弹角度不同。误差只有 1/65536，
 * 但它是**系统性偏向**的，几十次碰撞累积后不会互相抵消。向零截断保证
 * `mul(-a, b) === -mul(a, b)`，左右两侧的物理完全镜像。
 *
 * ## 溢出：抛错，不回绕
 *
 * 越界一律抛 `FixedOverflowError`。回绕（`| 0` 的默认行为）会让球瞬间闪现到
 * 桌子另一头，而且是**静默**的 —— 演算继续跑下去，两端各自得到不同的错误结果，
 * 最后表现为「对局不同步」这种极难定位的现象。抛错至少把现场留在出问题的那一步。
 */

/**
 * Q16.16 定点数。
 *
 * 类型上就是 `number`，但**语义上不是**：它是放大了 65536 倍的整数，直接参与
 * `+ - * /` 会得到垃圾。只能经本模块的函数运算。取这个别名是为了让函数签名把
 * 意图说清楚 —— TypeScript 不会替我们拦住误用。
 */
export type Fixed = number;

/** 小数位数。 */
export const FRACTION_BITS = 16;

/** 1.0 的定点表示，也是换算比例。 */
export const ONE: Fixed = 1 << FRACTION_BITS;

/** 0.5，碰撞求解里出现频率最高的常数。 */
export const HALF: Fixed = ONE / 2;

export const ZERO: Fixed = 0;

/** 可表示的上下界。超出即溢出。 */
export const MAX_FIXED: Fixed = 0x7fffffff;
export const MIN_FIXED: Fixed = -0x80000000;

/** 定点运算越界。回绕会让球闪现，所以宁可抛出来。 */
export class FixedOverflowError extends Error {
  constructor(operation: string, value: number) {
    super(`定点数溢出：${operation} 得到 ${value}，超出 Q16.16 范围`);
    this.name = "FixedOverflowError";
  }
}

function checked(value: number, operation: string): Fixed {
  if (value > MAX_FIXED || value < MIN_FIXED || !Number.isFinite(value)) {
    throw new FixedOverflowError(operation, value);
  }
  return value;
}

/** 向零截断的整数除法。取整方向的唯一来源，别在别处另写一份。 */
function truncDiv(numerator: number, denominator: number): number {
  const quotient = numerator / denominator;
  return quotient < 0 ? Math.ceil(quotient) : Math.floor(quotient);
}

/** 整数 -> 定点。 */
export function fromInt(n: number): Fixed {
  return checked(n * ONE, `fromInt(${n})`);
}

/**
 * 分数 -> 定点。**这是书写非整数常量的首选方式。**
 *
 * 写 `fromRatio(1, 3)` 而不是 `fromFloat(0.333)`：前者把「三分之一」这个意图
 * 留在代码里，取整只发生一次且方向明确；后者先经过一次十进制字面量到二进制
 * 浮点的转换，再截断一次，两次误差叠加，而且读代码的人无从判断 0.333 是不是
 * 手滑少写了一位。
 */
export function fromRatio(numerator: number, denominator: number): Fixed {
  if (denominator === 0) {
    throw new Error("fromRatio 分母为 0");
  }
  return checked(
    truncDiv(numerator * ONE, denominator),
    `fromRatio(${numerator}/${denominator})`,
  );
}

/**
 * 浮点 -> 定点。
 *
 * 单次转换本身是确定的（IEEE-754 的乘法与截断都是精确定义的），所以它可以安全地
 * 用在**输入边界**上 —— 比如把用户拖出来的角度转进定点域。
 *
 * 但它不该出现在物理常量里。一旦有人写 `fromFloat(0.1 + 0.2)`，浮点误差就已经
 * 在进门前发生了，定点域再精确也救不回来。常量用 `fromRatio`。
 */
export function fromFloat(x: number): Fixed {
  if (!Number.isFinite(x)) {
    throw new FixedOverflowError(`fromFloat(${x})`, x);
  }
  const scaled = x * ONE;
  return checked(
    scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled),
    `fromFloat(${x})`,
  );
}

/**
 * 定点 -> 浮点。
 *
 * **只用于渲染与显示。** 一旦转成浮点，确定性就失效了 —— 任何拿它算出来的值都
 * 不能再回到物理状态里。除法用的是 2 的幂，这一步本身无误差。
 */
export function toFloat(x: Fixed): number {
  return x / ONE;
}

/** 定点 -> 整数，向零截断。 */
export function toInt(x: Fixed): number {
  return truncDiv(x, ONE);
}

export function add(a: Fixed, b: Fixed): Fixed {
  return checked(a + b, "add");
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return checked(a - b, "sub");
}

export function neg(a: Fixed): Fixed {
  return checked(-a, "neg");
}

export function abs(a: Fixed): Fixed {
  return checked(a < 0 ? -a : a, "abs");
}

/**
 * 乘法。
 *
 * 中间量 `a * b` 在结果不溢出时**是精确的**：结果要落在 int32 内意味着
 * |a×b| < 2^47，远低于双精度整数的精确上限 2^53。所以这里不需要拆高低位。
 *
 * 但**不能**写成 `(a * b) >> FRACTION_BITS`。JS 的位运算会先把操作数转成 int32，
 * `a * b` 那个 47 位的中间量在移位之前就被截断了 —— 这是定点数实现里最经典的
 * 一个坑，而且它只在数值较大时才出错，小数据的测试全绿。除以 2 的幂用普通除法
 * 无误差，再按向零方向取整。
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return checked(truncDiv(a * b, ONE), "mul");
}

/**
 * 除法。
 *
 * `a * ONE` 最大 2^47，远在双精度可精确表示整数的上限 2^53 之内，所以被除数是
 * 精确的；IEEE-754 的除法又保证正确舍入（误差 < 0.5 ulp），商不会被推过整数
 * 边界。因此直接截断即可，**不需要**额外的舍入校正。
 *
 * 这里曾经写过一段「若 |q×b| > |numerator| 则回退一位」的校正。4,062,945 组
 * 样本（含质数、2 的幂、int32 边界）跑下来一次都没触发过 —— 它不是保险，是
 * 永远执行不到的死代码，留着只会让人以为截断本身不可靠。
 */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) {
    throw new Error("定点数除以 0");
  }
  return checked(truncDiv(a * ONE, b), "div");
}

/**
 * 整数平方根，逐位求解。
 *
 * 不用 `Math.sqrt`：虽然 IEEE-754 要求 sqrt 正确舍入、主流引擎也都直接用硬件
 * 指令，但这是整条链路上唯一还依赖浮点行为的地方，而**确定性的价值在于不用去
 * 赌**。逐位法全程只有整数的加、减、乘 2、除 2（都是 2 的幂，精确），没有任何
 * 可解释的余地。
 *
 * 输入上限 2^47（`sqrt` 传进来的最大值），远在 2^53 之内。
 */
function isqrt(n: number): number {
  if (n <= 0) {
    return 0;
  }
  let remainder = n;
  let result = 0;
  // 起始位取不超过 n 的最大 4 的幂。
  //
  // 此处写 `n` 或 `remainder` 效果相同 —— remainder 刚被赋成 n，改动它的主循环
  // 还没开始（变异测试确认过这两种写法无法区分）。用 `n` 是因为它读起来就是
  // 「相对于输入定初值」，不必先确认 remainder 此刻的值。
  let bit = 1;
  while (bit * 4 <= n) {
    bit *= 4;
  }
  while (bit >= 1) {
    if (remainder >= result + bit) {
      remainder -= result + bit;
      // result 与 bit 全程保持整数：bit 是 4 的幂，而 result 每轮要么减半、要么
      // 减半后加一个 4 的幂，归纳可知 result 恒为偶数进入下一轮。所以这里的
      // `/ 2` 与 `/ 4` 都是精确的，不需要 Math.floor 兜底。
      result = result / 2 + bit;
    } else {
      result = result / 2;
    }
    bit /= 4;
  }
  return result;
}

/**
 * 平方根。负数抛错而不是返回 0 —— 物理量里出现负的平方根一定是上游算错了，
 * 悄悄返回 0 会让错误一路漂到「球停在了奇怪的位置」才被发现。
 */
export function sqrt(x: Fixed): Fixed {
  if (x < 0) {
    throw new Error(`定点数开平方遇到负数：${x}`);
  }
  // sqrt(x/ONE) * ONE === sqrt(x * ONE)。x ≤ 2^31，乘 2^16 后 ≤ 2^47，精确。
  return checked(isqrt(x * ONE), "sqrt");
}

/** 平方。写成独立函数是因为它在碰撞检测里到处出现，`mul(x, x)` 读起来更吵。 */
export function square(x: Fixed): Fixed {
  return mul(x, x);
}

/**
 * 直角边求斜边，**不经过 Q16.16 中间量**。
 *
 * ## 为什么不能写成 sqrt(square(x) + square(y))
 *
 * 那是最自然的写法，也是错的 —— 而且错得毫无征兆。`square` 的结果要落回
 * Q16.16，小量在这一步会被压扁：0.0039（raw 256）平方之后是 **raw 1**，也就是
 * 能表示的最小正数。于是 raw 255 的平方直接归零，raw 256 到 raw 362 全部映射到
 * 同一个 raw 1。后面再开方，得到的「长度」只能取 {0, 256, 362, 443, 512, …}
 * 这一串离散值 —— 开方**恢复不了平方时已经丢掉的位**。
 *
 * 后果不止是长度不准。`vNormalize` 拿它做除数，实测慢速下单位向量的模长会是
 * 1.28 甚至 0（0.005 米/秒时 1.280，0.004 米/秒时 0）。摩擦力方向 `-u/|u|` 正是
 * 这么算的，也就是说球快停下时摩擦力会凭空强 28%、或者完全消失。这类误差不会
 * 报错，只会让「球快停时的最后一点走位」在两端算出不同结果。
 *
 * 改成在**原始整数域**里求平方和：x_raw = x·2^16，于是 x_raw² + y_raw² =
 * (x²+y²)·2^32，直接开方就得到 |v|·2^16，正是要的定点结果。全程只有 isqrt 末尾
 * 那一次取整。同样的扫描下最坏相对误差从 100% 降到 0.31%。
 *
 * 顺带把量程从 181 米/秒（受 vLenSq 落在 Q16.16 内所限）放宽到 1024 米/秒。
 *
 * @throws 平方和超出双精度可精确表示整数的范围时抛错 —— 越过 2^53 之后加法本身
 *   就开始丢位，结果会**静默地**在不同引擎上不一致，正是定点层要杜绝的事。
 */
export function hypot(x: Fixed, y: Fixed): Fixed {
  const sumSq = x * x + y * y;
  if (sumSq > Number.MAX_SAFE_INTEGER) {
    throw new FixedOverflowError("hypot", sumSq);
  }
  return checked(isqrt(sumSq), "hypot");
}

export function min(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

export function clamp(x: Fixed, lo: Fixed, hi: Fixed): Fixed {
  if (lo > hi) {
    throw new Error(`clamp 上下界颠倒：lo=${lo} hi=${hi}`);
  }
  return x < lo ? lo : x > hi ? hi : x;
}
