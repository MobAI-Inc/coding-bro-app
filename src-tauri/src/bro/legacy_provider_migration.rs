use std::collections::HashMap;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::Value;

use crate::app_config::AppType;
use crate::provider::Provider;
use crate::services::ProviderService;
use crate::store::AppState;

const MANAGED_PROVIDER_ID: &str = "coding-bro-plan";
const PREVIOUS_PROVIDERS_KEY: &str = "previous-providers";

const LEGACY_APPS: [AppType; 6] = [
    AppType::Claude,
    AppType::Codex,
    AppType::Gemini,
    AppType::OpenCode,
    AppType::Pi,
    AppType::Hermes,
];

/// Undo the persistent provider installs created by early Coding Bro builds.
///
/// New builds never persist this provider. This migration is intentionally
/// native and runs during application setup so it also works when the main
/// window stays hidden in the tray. It switches an exclusive CLI away from the
/// managed provider before deleting it; additive CLIs only lose the owned
/// `coding-bro-plan` node.
pub(crate) fn migrate(state: &AppState, legacy_store_path: &Path) -> Result<usize, String> {
    let previous = read_previous_providers(legacy_store_path);
    let mut migrated = 0usize;
    let mut failures = Vec::new();

    for app_type in LEGACY_APPS {
        let app_name = app_type.as_str().to_string();
        let providers = match ProviderService::list(state, app_type.clone()) {
            Ok(providers) => providers,
            Err(error) => {
                failures.push(format!("{app_name}: 无法读取 provider: {error}"));
                continue;
            }
        };
        if !providers.contains_key(MANAGED_PROVIDER_ID) {
            continue;
        }

        if !app_type.is_additive_mode() {
            let effective_current = match ProviderService::current(state, app_type.clone()) {
                Ok(current) => current,
                Err(error) => {
                    failures.push(format!("{app_name}: 无法读取当前 provider: {error}"));
                    continue;
                }
            };
            let database_current = match state.db.get_current_provider(&app_name) {
                Ok(current) => current,
                Err(error) => {
                    failures.push(format!("{app_name}: 无法读取数据库当前 provider: {error}"));
                    continue;
                }
            };
            // Historical builds could leave settings and SQLite disagreeing.
            // ProviderService::current intentionally prefers settings, while
            // ProviderService::delete protects both pointers. Restore when
            // either one still names the managed provider.
            if needs_restore(&effective_current, database_current.as_deref()) {
                let fallback =
                    select_fallback(&providers, previous.get(&app_name).map(String::as_str));
                let Some(fallback) = fallback else {
                    failures.push(format!("{app_name}: 找不到可安全恢复的原 provider"));
                    continue;
                };
                if let Err(error) = ProviderService::switch(state, app_type.clone(), &fallback) {
                    failures.push(format!("{app_name}: 恢复 {fallback} 失败: {error}"));
                    continue;
                }
            }
        }

        match ProviderService::delete(state, app_type, MANAGED_PROVIDER_ID) {
            Ok(()) => migrated += 1,
            Err(error) => failures.push(format!(
                "{app_name}: 删除旧 Coding Bro provider 失败: {error}"
            )),
        }
    }

    if failures.is_empty() {
        archive_legacy_store(legacy_store_path)?;
        Ok(migrated)
    } else {
        Err(failures.join("; "))
    }
}

fn needs_restore(effective_current: &str, database_current: Option<&str>) -> bool {
    effective_current == MANAGED_PROVIDER_ID || database_current == Some(MANAGED_PROVIDER_ID)
}

fn read_previous_providers(path: &Path) -> HashMap<String, String> {
    let Ok(bytes) = std::fs::read(path) else {
        return HashMap::new();
    };
    let Ok(Value::Object(root)) = serde_json::from_slice::<Value>(&bytes) else {
        return HashMap::new();
    };
    root.get(PREVIOUS_PROVIDERS_KEY)
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(app, provider)| {
                    provider
                        .as_str()
                        .map(|provider| (app.clone(), provider.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn select_fallback(
    providers: &IndexMap<String, Provider>,
    remembered: Option<&str>,
) -> Option<String> {
    remembered
        .filter(|id| *id != MANAGED_PROVIDER_ID && providers.contains_key(*id))
        .map(str::to_string)
        .or_else(|| {
            providers
                .values()
                .find(|provider| {
                    provider.id != MANAGED_PROVIDER_ID
                        && provider.category.as_deref() == Some("official")
                })
                .map(|provider| provider.id.clone())
        })
        .or_else(|| {
            providers
                .values()
                .find(|provider| provider.id != MANAGED_PROVIDER_ID)
                .map(|provider| provider.id.clone())
        })
}

fn archive_legacy_store(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut archive = PathBuf::from(format!("{}.migrated", path.display()));
    let mut suffix = 1usize;
    while archive.exists() {
        archive = PathBuf::from(format!("{}.migrated.{suffix}", path.display()));
        suffix += 1;
    }
    std::fs::rename(path, &archive).map_err(|error| {
        format!(
            "无法归档旧 Coding Bro provider 状态 {}: {error}",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(id: &str, category: Option<&str>) -> Provider {
        let mut provider =
            Provider::with_id(id.to_string(), id.to_string(), serde_json::json!({}), None);
        provider.category = category.map(str::to_string);
        provider
    }

    #[test]
    fn fallback_prefers_the_recorded_provider_then_official() {
        let providers = IndexMap::from([
            (
                MANAGED_PROVIDER_ID.to_string(),
                provider(MANAGED_PROVIDER_ID, Some("custom")),
            ),
            (
                "official".to_string(),
                provider("official", Some("official")),
            ),
            ("previous".to_string(), provider("previous", Some("custom"))),
        ]);

        assert_eq!(
            select_fallback(&providers, Some("previous")).as_deref(),
            Some("previous")
        );
        assert_eq!(
            select_fallback(&providers, Some("missing")).as_deref(),
            Some("official")
        );
    }

    #[test]
    fn restore_is_required_when_either_current_pointer_is_stale() {
        assert!(needs_restore(MANAGED_PROVIDER_ID, Some("official")));
        assert!(needs_restore("official", Some(MANAGED_PROVIDER_ID)));
        assert!(!needs_restore("official", Some("official")));
    }

    #[test]
    fn legacy_store_is_archived_without_overwriting_an_older_archive() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = dir.path().join("managed.json");
        let first_archive = dir.path().join("managed.json.migrated");
        std::fs::write(&store, b"current").expect("write store");
        std::fs::write(&first_archive, b"older").expect("write older archive");

        archive_legacy_store(&store).expect("archive store");

        assert!(!store.exists());
        assert_eq!(
            std::fs::read(first_archive).expect("read older archive"),
            b"older"
        );
        assert_eq!(
            std::fs::read(dir.path().join("managed.json.migrated.1")).expect("read new archive"),
            b"current"
        );
    }
}
