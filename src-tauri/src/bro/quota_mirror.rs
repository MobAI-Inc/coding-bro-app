//! 额度本地镜像。
//!
//! 权威额度在服务端 Redis 计数器，本地镜像可能滞后于真实值。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuotaWindow {
    /// 5 小时滚动窗口。滚动而非固定，避免窗口边界瞬间获得双倍额度。
    #[serde(rename = "5h")]
    FiveHour,
    Week,
    Month,
}

/// 单个窗口的额度快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaSnapshot {
    pub window: QuotaWindow,
    /// 已消耗金额（美元）。
    pub consumed_usd: f64,
    /// 窗口额度上限（美元）。
    pub limit_usd: f64,
    /// 服务端生成该快照的时间（Unix 秒）。用于向用户表达数据新鲜度。
    pub as_of: i64,
}

impl QuotaSnapshot {
    /// 已用比例，钳制到 `[0.0, 1.0]`。
    ///
    /// 上限为 0 时返回 1.0（视为已满），避免除零并让 UI 走触顶分支。
    pub fn used_ratio(&self) -> f64 {
        if self.limit_usd <= 0.0 {
            return 1.0;
        }
        (self.consumed_usd / self.limit_usd).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(consumed: f64, limit: f64) -> QuotaSnapshot {
        QuotaSnapshot {
            window: QuotaWindow::FiveHour,
            consumed_usd: consumed,
            limit_usd: limit,
            as_of: 0,
        }
    }

    #[test]
    fn ratio_is_consumed_over_limit() {
        assert_eq!(snapshot(3.5, 14.0).used_ratio(), 0.25);
    }

    #[test]
    fn zero_limit_reads_as_full() {
        // 避免除零，并让 UI 走触顶分支而非显示 0%。
        assert_eq!(snapshot(0.0, 0.0).used_ratio(), 1.0);
    }

    #[test]
    fn overage_clamps_to_one() {
        // 服务端预扣与真实用量修正之间，本地镜像可能短暂超过上限。
        assert_eq!(snapshot(20.0, 14.0).used_ratio(), 1.0);
    }
}
