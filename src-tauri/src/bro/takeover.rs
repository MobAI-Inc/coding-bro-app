//! CLI 接管与还原。
//!
//! 封装 cc-switch 已有的配置写入与备份能力，对上只暴露 Coding Bro 需要的语义：
//! 把本地 CLI 指向本机代理，以及一键还原到接管前的状态。
//!

use serde::{Deserialize, Serialize};

/// 可接管的 CLI。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetCli {
    ClaudeCode,
    Codex,
    Gemini,
}

/// 接管状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TakeoverStatus {
    pub cli: TargetCli,
    pub active: bool,
    /// 接管前配置的备份路径。为 None 说明从未接管过。
    pub backup_path: Option<String>,
    pub proxy_port: Option<u16>,
}
