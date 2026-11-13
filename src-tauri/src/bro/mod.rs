//! Coding Bro 新增能力。
//!
//! 全部自研代码集中在本模块下，尽量不改动 fork 自 cc-switch 的原有文件，
//! 便于长期从上游 rebase。必须改动原有文件时，改动点用 `// BRO:` 标记。
//!

// 骨架阶段：类型已定义但尚未接线，逐模块实现后移除本条。
#![allow(dead_code)]

pub mod account;
pub mod gateway_client;
pub(crate) mod legacy_provider_migration;
pub mod points;
pub mod quota_mirror;
pub mod takeover;
