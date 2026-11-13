/** 托管席位的基准决策质量。只影响行动策略，不参与玩家积分结算。 */
export const TABLE_BASE_QUALITY = 0.95;

/** 低于初始筹码 95% 后，托管席位进入保守恢复策略。 */
export const TABLE_NEUTRAL_FLOOR = 0.95;

/** 高于初始筹码 105% 后，托管席位逐步释放进攻强度。 */
export const TABLE_NEUTRAL_CEILING = 1.05;

export interface TableStrategyProfile {
  readonly bankrollRatio: number;
  readonly quality: number;
  readonly mistakeRate: number;
  readonly recoveryBias: number;
  readonly releaseBias: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 根据托管席位相对初始筹码调整策略强度。
 * 这里只改变行动选择，不改牌、不改玩家奖励。
 */
export function tableStrategyProfile(
  startingStack: number,
  currentBankroll: number,
): TableStrategyProfile {
  const safeStarting = Math.max(
    1,
    Number.isFinite(startingStack) ? startingStack : 1,
  );
  const safeCurrent = Math.max(
    0,
    Number.isFinite(currentBankroll) ? currentBankroll : safeStarting,
  );
  const bankrollRatio = safeCurrent / safeStarting;
  const recoveryBias = clamp01((TABLE_NEUTRAL_FLOOR - bankrollRatio) / 0.25);
  const releaseBias = clamp01((bankrollRatio - TABLE_NEUTRAL_CEILING) / 0.25);
  const quality =
    recoveryBias > 0
      ? 1
      : Math.max(0.87, TABLE_BASE_QUALITY - releaseBias * 0.08);

  return {
    bankrollRatio,
    quality,
    mistakeRate: 1 - quality,
    recoveryBias,
    releaseBias,
  };
}
