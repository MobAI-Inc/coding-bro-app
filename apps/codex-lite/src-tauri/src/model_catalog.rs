use crate::launcher::{codex_command, replace_private_file};
use crate::policy::valid_model_id;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
const GENERIC_PROMPT: &str = include_str!("../third-party/codex/prompt.md");
const UPDATE_MESSAGE: &str = "当前 Codex CLI 不支持 Lite 独立模型目录，请更新 Codex CLI 后重试";

fn metadata_command(executable: &Path, home: &Path) -> Command {
    let mut command = codex_command(executable);
    // Only OS/runtime paths survive. Neither account credentials nor a provider
    // API key enter these offline metadata subprocesses.
    command.env_clear();
    for key in [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(path) = crate::windows_tools::command_path(executable) {
        command.env("PATH", path);
    }
    #[cfg(target_os = "windows")]
    for key in [
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("CODEX_HOME", home)
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

fn read_metadata(mut command: Command, timeout: Duration) -> Result<Value, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // npm shims spawn the binary with inherited stdout. Keep this metadata
        // subprocess tree in its own group so a timeout can reclaim both.
        command.process_group(0);
    }
    let deadline = Instant::now() + timeout;
    let mut child = command.spawn().map_err(|_| UPDATE_MESSAGE.to_string())?;
    #[cfg(target_os = "windows")]
    let _job = crate::windows_process::BackgroundJob::attach(&mut child)
        .map_err(|_| UPDATE_MESSAGE.to_string())?;
    let Some(stdout) = child.stdout.take() else {
        stop_metadata(&mut child);
        return Err(UPDATE_MESSAGE.to_string());
    };
    // The bundled catalog exceeds a pipe buffer. Drain while the child runs,
    // retaining a bounded amount rather than waiting before reading stdout.
    let (sender, reader) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(MAX_METADATA_BYTES + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = sender.send(result);
    });
    let completed = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                stop_metadata(&mut child);
                break false;
            }
        }
    };
    let bytes = match reader.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Ok(bytes)) => bytes,
        _ => {
            stop_metadata(&mut child);
            return Err(UPDATE_MESSAGE.to_string());
        }
    };
    if !completed || bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err(UPDATE_MESSAGE.to_string());
    }
    serde_json::from_slice(&bytes).map_err(|_| UPDATE_MESSAGE.to_string())
}

fn stop_metadata(child: &mut Child) {
    #[cfg(unix)]
    {
        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        // Only the dedicated process group created above is addressed.
        if let Ok(pid) = i32::try_from(child.id()) {
            unsafe { kill(-pid, 9) };
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn generic_model(model_id: &str) -> Value {
    // Based on the official model_info_from_slug fallback, not another model's
    // capabilities. Unknown gateway models expose text and no reasoning options;
    // context limits remain unknown. Provenance/license are in third-party/codex.
    let mut metadata = json!({
        "slug": model_id,
        "display_name": model_id,
        "description": null,
        "default_reasoning_level": null,
        "supported_reasoning_levels": [],
        "shell_type": "unified_exec",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 99,
        "upgrade": null,
        "availability_nux": null,
        "base_instructions": GENERIC_PROMPT,
        "model_messages": { "instructions_template": GENERIC_PROMPT },
        "include_skills_usage_instructions": false,
        "include_plugin_usage_instructions": false,
        "include_apps_usage_instructions": false,
        "supports_reasoning_summaries": false,
        "supports_reasoning_summary_parameter": false,
        "default_reasoning_summary": "none",
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "web_search_tool_type": "text",
        "truncation_policy": { "mode": "bytes", "limit": 10000 }
    });
    let details = json!({
        "supports_image_detail_original": false,
        "context_window": null,
        "max_context_window": null,
        "effective_context_window_percent": 95,
        "experimental_supported_tools": [],
        "input_modalities": ["text"],
        "supports_search_tool": false,
        "supports_experimental_context": false,
        "use_responses_lite": false,
        "supports_reasoning_effort_updates": false,
        "node_repl_auto_review_required": false,
        "node_repl_disabled": false,
        "tool_mode": null,
        "multi_agent_version": null,
        "multi_agent_reasoning_effort": null,
        "additional_speed_tiers": [],
        "service_tiers": [],
        "default_service_tier": null,
        "comp_hash": null
    });
    metadata
        .as_object_mut()
        .expect("model metadata object")
        .extend(details.as_object().expect("model metadata details").clone());
    metadata
}

fn authorized_catalog(bundled: &Value, allowed_model_ids: &[String]) -> Result<Value, String> {
    let models = bundled
        .get("models")
        .and_then(Value::as_array)
        .ok_or(UPDATE_MESSAGE)?;
    if models.is_empty() || allowed_model_ids.is_empty() {
        return Err(UPDATE_MESSAGE.to_string());
    }
    let mut seen = BTreeSet::new();
    let mut authorized = Vec::new();
    for id in allowed_model_ids {
        if !valid_model_id(id) {
            return Err("服务端模型目录包含无效标识，请刷新模型列表".to_string());
        }
        if !seen.insert(id) {
            continue;
        }
        let mut metadata = models
            .iter()
            .find(|model| model.get("slug").and_then(Value::as_str) == Some(id))
            .cloned()
            .unwrap_or_else(|| generic_model(id));
        let object = metadata.as_object_mut().ok_or(UPDATE_MESSAGE)?;
        object.insert("upgrade".into(), Value::Null);
        object.insert("availability_nux".into(), Value::Null);
        object.insert("visibility".into(), json!("list"));
        authorized.push(metadata);
    }
    Ok(json!({ "models": authorized }))
}

fn same_catalog(actual: &Value, expected: &Value) -> bool {
    let Some(actual) = actual.get("models").and_then(Value::as_array) else {
        return false;
    };
    let Some(expected) = expected.get("models").and_then(Value::as_array) else {
        return false;
    };
    let ids = |models: &[Value]| {
        models
            .iter()
            .filter_map(|model| model.get("slug").and_then(Value::as_str))
            .map(str::to_owned)
            .collect::<BTreeSet<_>>()
    };
    actual.len() == expected.len()
        && ids(actual) == ids(expected)
        && actual
            .iter()
            .all(|model| model.get("upgrade").is_none_or(Value::is_null))
}

pub fn write_catalog(
    executable: &Path,
    home: &Path,
    allowed_model_ids: &[String],
) -> Result<PathBuf, String> {
    let mut command = metadata_command(executable, home);
    command.args(["debug", "models", "--bundled"]);
    let bundled = read_metadata(command, METADATA_TIMEOUT)?;
    let catalog = authorized_catalog(&bundled, allowed_model_ids)?;
    let path = home.join("models.json");
    let bytes = serde_json::to_vec(&catalog).map_err(|_| UPDATE_MESSAGE)?;
    replace_private_file(&path, &bytes)?;

    // A configured catalog replaces the builtin/remote catalog. Parsing it with
    // this same CLI catches unsupported versions before opening any terminal.
    // The provider is loopback with no credential, even if an older CLI tries
    // to refresh instead of honoring model_catalog_json.
    let mut command = metadata_command(executable, home);
    command.args(["debug", "models"]);
    for value in [
        format!(
            "model_catalog_json={}",
            toml::Value::String(path.to_string_lossy().into_owned())
        ),
        "model_provider=\"codex_lite_metadata\"".to_string(),
        "model_providers.codex_lite_metadata.name=\"Lite metadata validation\"".to_string(),
        "model_providers.codex_lite_metadata.base_url=\"http://127.0.0.1:9/v1\"".to_string(),
        "model_providers.codex_lite_metadata.wire_api=\"responses\"".to_string(),
        "model_providers.codex_lite_metadata.requires_openai_auth=false".to_string(),
    ] {
        command.arg("-c").arg(value);
    }
    let parsed = read_metadata(command, METADATA_TIMEOUT)?;
    if !same_catalog(&parsed, &catalog) {
        return Err(UPDATE_MESSAGE.to_string());
    }
    Ok(path)
}
