//! 与自有网关的通信。
//!
//! 这是客户端唯一的服务端出口。上游供应池的域名、鉴权与成本价只存在于服务端，
//!
//! 网关地址与鉴权协议待需求方提供，当前只定义接口形状。

use serde::{Deserialize, Serialize};

/// 网关调用错误。
///
/// 错误信息在服务端已完成脱敏映射，客户端原样展示即可，
/// 不得尝试从中解析或推断上游标识。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayError {
    /// 稳定错误码，用于客户端分支处理。
    pub code: String,
    /// 面向用户的可读信息，已脱敏。
    pub message: String,
}

/// 网关客户端。
///
/// TODO(接入): 网关 base URL、鉴权协议待需求方提供。
/// 实现落地时必须保证：任何上游标识不进入日志、错误信息与崩溃报告。
pub struct GatewayClient {
    _base_url: String,
}

impl GatewayClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            _base_url: base_url.into(),
        }
    }
}
