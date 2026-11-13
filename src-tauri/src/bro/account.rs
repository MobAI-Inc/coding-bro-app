//! 登录态与订阅态。
//!
//! 客户端只持有服务端下发的账户视图，不做任何本地推断。

use serde::{Deserialize, Serialize};

/// 订阅档位。
///
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Lite,
    Pro,
    Ultra,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessMethod {
    /// 订阅制，按档位与三层额度窗口计费。
    Plan,
    /// 按量付费。
    Payg,
    Byok,
}

/// 服务端下发的账户视图。仅用于展示，不作为任何计费依据。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountView {
    pub user_id: String,
    pub email: String,
    pub access_method: AccessMethod,
    /// PAYG / BYOK 用户为 None。
    pub tier: Option<Tier>,
    /// 订阅周期结束时间（Unix 秒）。
    pub period_end: Option<i64>,
}
