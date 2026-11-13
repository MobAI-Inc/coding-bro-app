//! 积分本地视图。
//!
//! 本模块只承载展示所需的只读视图。
//!
//! 合规口径：积分与现金无关，不可购买、不可转让、不可提现，

use serde::{Deserialize, Serialize};

/// 积分变动来源。与服务端 `points_ledger.source` 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointsSource {
    /// token 消耗产出。BYOK 请求不走此路径（防无成本套利）。
    Consumption,
    GameWin,
    GameEntry,
    Redeem,
    Daily,
}

/// 积分余额视图。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointsView {
    pub balance: i64,
    /// 本月已兑换额度（美元），用于展示距月度上限还剩多少。
    pub redeemed_this_month_usd: f64,
    pub monthly_redeem_cap_usd: f64,
    pub as_of: i64,
}

/// 单条积分流水，用于积分中心的明细列表。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointsEntry {
    pub ts: i64,
    /// 正为产出，负为消耗。
    pub delta: i64,
    pub source: PointsSource,
    pub balance_after: i64,
}
