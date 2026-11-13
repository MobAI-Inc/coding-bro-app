use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const CODING_BRO_PROVIDER_ID: &str = "coding-bro-plan";

struct ProcessLaunch {
    command: String,
    environment: Vec<(String, String)>,
    unset_environment: Vec<&'static str>,
    cleanup_paths: Vec<PathBuf>,
}

pub fn launch_coding_bro_terminal(
    target: &str,
    app: &str,
    executable_command: &str,
    cwd: &str,
    api_base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    validate_coding_bro_launch(executable_command, api_base_url, api_key, model)?;
    let launch = build_coding_bro_process_launch(
        app,
        executable_command,
        api_base_url.trim_end_matches('/'),
        api_key,
        model,
    )?;
    let script_path = create_private_process_launcher(&launch)?;
    let script_command = shell_escape(&script_path.to_string_lossy());
    let result = launch_terminal(target, &script_command, Some(cwd), None);
    if result.is_err() {
        let _ = std::fs::remove_file(&script_path);
        cleanup_paths(&launch.cleanup_paths);
    }
    result
}

fn validate_coding_bro_launch(
    executable_command: &str,
    api_base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    if executable_command.trim().is_empty() {
        return Err("CLI 启动命令为空".to_string());
    }
    if !(api_base_url.starts_with("https://") || api_base_url.starts_with("http://")) {
        return Err("Coding Bro API 地址无效".to_string());
    }
    if api_key.is_empty() || api_key.contains('\n') || api_key.contains('\r') {
        return Err("Coding Bro 会话凭据无效".to_string());
    }
    if model.trim().is_empty() || model.contains('\n') || model.contains('\r') {
        return Err("Coding Bro 模型无效".to_string());
    }
    Ok(())
}

fn build_coding_bro_process_launch(
    app: &str,
    executable_command: &str,
    api_origin: &str,
    api_key: &str,
    model: &str,
) -> Result<ProcessLaunch, String> {
    let openai_base_url = format!("{api_origin}/v1");
    let quoted_model = shell_escape(model);
    let mut cleanup_paths = Vec::new();

    let (command, environment, unset_environment) = match app {
        "claude" => (
            format!("{executable_command} --model {quoted_model}"),
            vec![
                ("ANTHROPIC_BASE_URL".to_string(), api_origin.to_string()),
                ("ANTHROPIC_AUTH_TOKEN".to_string(), api_key.to_string()),
                ("ANTHROPIC_MODEL".to_string(), model.to_string()),
                (
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                    model.to_string(),
                ),
                (
                    "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                    model.to_string(),
                ),
                (
                    "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                    model.to_string(),
                ),
            ],
            vec!["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
        ),
        "codex" => {
            let overrides = [
                "model_provider=\"coding_bro\"".to_string(),
                format!("model={}", json_string(model)?),
                "model_reasoning_effort=\"high\"".to_string(),
                "disable_response_storage=true".to_string(),
                "model_providers.coding_bro.name=\"Coding Bro\"".to_string(),
                format!(
                    "model_providers.coding_bro.base_url={}",
                    json_string(&openai_base_url)?
                ),
                "model_providers.coding_bro.wire_api=\"responses\"".to_string(),
                "model_providers.coding_bro.requires_openai_auth=true".to_string(),
            ];
            let args = overrides
                .iter()
                .map(|value| format!("-c {}", shell_escape(value)))
                .collect::<Vec<_>>()
                .join(" ");
            (
                format!("{executable_command} {args}"),
                vec![("OPENAI_API_KEY".to_string(), api_key.to_string())],
                vec![],
            )
        }
        "gemini" => {
            let settings = serde_json::json!({
                "security": { "auth": { "selectedType": "gemini-api-key" } },
                "model": { "name": model }
            });
            let settings_path = write_private_temp_file(
                "coding-bro-gemini-",
                ".json",
                serde_json::to_vec_pretty(&settings)
                    .map_err(|e| format!("无法生成 Gemini 临时配置: {e}"))?
                    .as_slice(),
            )?;
            cleanup_paths.push(settings_path.clone());
            (
                format!("{executable_command} --model {quoted_model}"),
                vec![
                    (
                        "GEMINI_CLI_SYSTEM_SETTINGS_PATH".to_string(),
                        settings_path.to_string_lossy().into_owned(),
                    ),
                    ("GOOGLE_GEMINI_BASE_URL".to_string(), api_origin.to_string()),
                    ("GEMINI_API_KEY".to_string(), api_key.to_string()),
                ],
                vec!["GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI"],
            )
        }
        "opencode" => {
            let mut model_map = serde_json::Map::new();
            model_map.insert(
                model.to_string(),
                serde_json::json!({ "name": "Coding Bro" }),
            );
            let mut provider_map = serde_json::Map::new();
            provider_map.insert(
                CODING_BRO_PROVIDER_ID.to_string(),
                serde_json::json!({
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Coding Bro",
                    "options": {
                        "baseURL": openai_base_url,
                        "apiKey": api_key,
                        "setCacheKey": true
                    },
                    "models": model_map
                }),
            );
            let inline_config = serde_json::json!({
                "model": format!("{CODING_BRO_PROVIDER_ID}/{model}"),
                "provider": provider_map
            });
            (
                format!(
                    "{executable_command} --model {}",
                    shell_escape(&format!("{CODING_BRO_PROVIDER_ID}/{model}"))
                ),
                vec![(
                    "OPENCODE_CONFIG_CONTENT".to_string(),
                    serde_json::to_string(&inline_config)
                        .map_err(|e| format!("无法生成 OpenCode 临时配置: {e}"))?,
                )],
                vec![],
            )
        }
        "pi" => {
            let overlay_dir = create_pi_config_overlay(&openai_base_url, api_key, model)?;
            let user_session_dir = dirs::home_dir()
                .map(|home| home.join(".pi/agent/sessions"))
                .filter(|path| path.exists());
            cleanup_paths.push(overlay_dir.clone());
            let mut env = vec![(
                "PI_CODING_AGENT_DIR".to_string(),
                overlay_dir.to_string_lossy().into_owned(),
            )];
            if let Some(session_dir) = user_session_dir {
                env.push((
                    "PI_CODING_AGENT_SESSION_DIR".to_string(),
                    session_dir.to_string_lossy().into_owned(),
                ));
            }
            (
                format!(
                    "{executable_command} --provider {} --model {quoted_model}",
                    shell_escape(CODING_BRO_PROVIDER_ID)
                ),
                env,
                vec![],
            )
        }
        "hermes" => (
            format!("{executable_command} chat --provider openai-api --model {quoted_model}"),
            vec![
                ("OPENAI_API_KEY".to_string(), api_key.to_string()),
                ("OPENAI_BASE_URL".to_string(), openai_base_url),
            ],
            vec!["OPENROUTER_API_KEY"],
        ),
        _ => return Err(format!("不支持的 Coding Bro CLI: {app}")),
    };

    Ok(ProcessLaunch {
        command,
        environment,
        unset_environment,
        cleanup_paths,
    })
}

fn json_string(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("无法编码启动参数: {e}"))
}

fn write_private_temp_file(prefix: &str, suffix: &str, content: &[u8]) -> Result<PathBuf, String> {
    let mut builder = tempfile::Builder::new();
    builder.prefix(prefix).suffix(suffix);
    #[cfg(unix)]
    builder.permissions(std::fs::Permissions::from_mode(0o600));
    let mut file = builder
        .tempfile()
        .map_err(|e| format!("无法创建临时配置: {e}"))?;
    file.write_all(content)
        .map_err(|e| format!("无法写入临时配置: {e}"))?;
    file.flush().map_err(|e| format!("无法刷新临时配置: {e}"))?;
    file.into_temp_path()
        .keep()
        .map_err(|e| format!("无法保留临时配置: {e}"))
}

fn create_pi_config_overlay(
    openai_base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<PathBuf, String> {
    let user_dir = dirs::home_dir()
        .ok_or_else(|| "无法定位用户目录".to_string())?
        .join(".pi/agent");
    let mut builder = tempfile::Builder::new();
    builder.prefix("coding-bro-pi-");
    #[cfg(unix)]
    builder.permissions(std::fs::Permissions::from_mode(0o700));
    let temp_dir = builder
        .tempdir()
        .map_err(|e| format!("无法创建 Pi 临时配置目录: {e}"))?;
    let overlay_dir = temp_dir.keep();

    if let Err(error) =
        populate_pi_overlay(&user_dir, &overlay_dir, openai_base_url, api_key, model)
    {
        let _ = std::fs::remove_dir_all(&overlay_dir);
        return Err(error);
    }
    Ok(overlay_dir)
}

fn populate_pi_overlay(
    user_dir: &Path,
    overlay_dir: &Path,
    openai_base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    if user_dir.is_dir() {
        for entry in
            std::fs::read_dir(user_dir).map_err(|e| format!("无法读取 Pi 配置目录: {e}"))?
        {
            let entry = entry.map_err(|e| format!("无法读取 Pi 配置项: {e}"))?;
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some("models.json" | "settings.json" | "auth.json" | "sessions")
            ) {
                continue;
            }
            let target = overlay_dir.join(&name);
            #[cfg(unix)]
            std::os::unix::fs::symlink(entry.path(), target)
                .map_err(|e| format!("无法链接 Pi 配置资源: {e}"))?;
        }
    }

    for name in ["settings.json", "auth.json"] {
        let source = user_dir.join(name);
        if source.is_file() {
            let target = overlay_dir.join(name);
            std::fs::copy(&source, &target).map_err(|e| format!("无法复制 Pi {name}: {e}"))?;
            #[cfg(unix)]
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("无法保护 Pi {name}: {e}"))?;
        }
    }

    let models_path = user_dir.join("models.json");
    let mut models = if models_path.is_file() {
        serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(&models_path).map_err(|e| format!("无法读取 Pi models.json: {e}"))?,
        )
        .map_err(|e| format!("Pi models.json 格式无效: {e}"))?
    } else {
        serde_json::json!({})
    };
    let root = models
        .as_object_mut()
        .ok_or_else(|| "Pi models.json 顶层必须是对象".to_string())?;
    let providers = root
        .entry("providers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| "Pi models.json providers 必须是对象".to_string())?;
    providers.insert(
        CODING_BRO_PROVIDER_ID.to_string(),
        serde_json::json!({
            "name": "coding-bro",
            "baseUrl": openai_base_url,
            "api": "openai-responses",
            "apiKey": api_key,
            "models": [{ "id": model, "name": "Coding Bro" }]
        }),
    );
    let content = serde_json::to_vec_pretty(&models)
        .map_err(|e| format!("无法生成 Pi 临时 models.json: {e}"))?;
    let target = overlay_dir.join("models.json");
    std::fs::write(&target, content).map_err(|e| format!("无法写入 Pi 临时配置: {e}"))?;
    #[cfg(unix)]
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("无法保护 Pi 临时配置: {e}"))?;
    Ok(())
}

fn create_private_process_launcher(launch: &ProcessLaunch) -> Result<PathBuf, String> {
    let mut script = String::from("#!/bin/sh\nlauncher_path=$0\nrm -f -- \"$launcher_path\"\n");
    if !launch.cleanup_paths.is_empty() {
        let cleanup = launch
            .cleanup_paths
            .iter()
            .map(|path| shell_escape(&path.to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");
        script.push_str(&format!(
            "cleanup() {{ rm -rf -- {cleanup}; }}\ntrap cleanup EXIT\ntrap 'exit 130' HUP INT TERM\n"
        ));
    }
    if !launch.unset_environment.is_empty() {
        script.push_str("unset");
        for key in &launch.unset_environment {
            script.push(' ');
            script.push_str(key);
        }
        script.push('\n');
    }
    for (key, value) in &launch.environment {
        if !key
            .chars()
            .all(|character| character == '_' || character.is_ascii_uppercase())
        {
            cleanup_paths(&launch.cleanup_paths);
            return Err(format!("无效的会话环境变量: {key}"));
        }
        script.push_str(&format!("export {key}={}\n", shell_escape(value)));
    }
    script.push_str(&launch.command);
    script.push('\n');

    let mut builder = tempfile::Builder::new();
    builder.prefix("coding-bro-session-").suffix(".sh");
    #[cfg(unix)]
    builder.permissions(std::fs::Permissions::from_mode(0o700));
    let mut file = builder
        .tempfile()
        .map_err(|e| format!("无法创建会话启动器: {e}"))?;
    file.write_all(script.as_bytes())
        .map_err(|e| format!("无法写入会话启动器: {e}"))?;
    file.flush()
        .map_err(|e| format!("无法刷新会话启动器: {e}"))?;
    file.into_temp_path()
        .keep()
        .map_err(|e| format!("无法保留会话启动器: {e}"))
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(path);
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub fn launch_terminal(
    target: &str,
    command: &str,
    cwd: Option<&str>,
    custom_config: Option<&str>,
) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Resume command is empty".to_string());
    }

    if !cfg!(target_os = "macos") {
        return Err("Terminal resume is only supported on macOS".to_string());
    }

    match target {
        "terminal" => launch_macos_terminal(command, cwd),
        "iTerm" | "iterm" => launch_iterm(command, cwd),
        "ghostty" => launch_ghostty(command, cwd),
        "kitty" => launch_kitty(command, cwd),
        "wezterm" => launch_wezterm(command, cwd),
        "kaku" => launch_kaku(command, cwd),
        "alacritty" => launch_alacritty(command, cwd),
        #[cfg(unix)]
        "warp" => launch_warp(command, cwd),
        "custom" => launch_custom(command, cwd, custom_config),
        _ => Err(format!("Unsupported terminal target: {target}")),
    }
}

fn launch_macos_terminal(command: &str, cwd: Option<&str>) -> Result<(), String> {
    // AppleScript's `do script` requires macOS Automation permission. A newly
    // installed/ad-hoc signed build can therefore leave `osascript` waiting for
    // an Apple Event reply forever, which in turn keeps the launch dialog at
    // 100%. Terminal natively opens executable `.command` files through Launch
    // Services, so use that path instead: it needs no Automation permission and
    // the script removes itself as soon as Terminal starts it.
    let script_path = create_macos_terminal_command_file(command, cwd)?;
    let status = Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(&script_path)
        .status()
        .map_err(|e| format!("Failed to launch Terminal: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        let _ = std::fs::remove_file(script_path);
        Err("Terminal command execution failed".to_string())
    }
}

fn create_macos_terminal_command_file(
    command: &str,
    cwd: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let full_command = build_shell_command(command, cwd);
    let mut script_builder = tempfile::Builder::new();
    script_builder.prefix("coding-bro-").suffix(".command");
    #[cfg(unix)]
    script_builder.permissions(std::fs::Permissions::from_mode(0o700));
    let mut script_file = script_builder
        .tempfile()
        .map_err(|e| format!("Failed to create Terminal command file: {e}"))?;

    writeln!(
        &mut script_file,
        "#!/bin/sh\nscript_path=$0\nrm -f -- \"$script_path\"\nshell_path=\"${{SHELL:-/bin/zsh}}\"\ncase \"${{shell_path##*/}}\" in\n  fish) exec \"$shell_path\" -lc {} ;;\n  sh|dash) exec \"$shell_path\" -c {} ;;\n  *) exec \"$shell_path\" -lic {} ;;\nesac",
        shell_escape(&full_command),
        shell_escape(&full_command),
        shell_escape(&full_command)
    )
    .map_err(|e| format!("Failed to write Terminal command file: {e}"))?;
    script_file
        .flush()
        .map_err(|e| format!("Failed to flush Terminal command file: {e}"))?;

    script_file
        .into_temp_path()
        .keep()
        .map_err(|e| format!("Failed to persist Terminal command file: {e}"))
}

fn launch_iterm(command: &str, cwd: Option<&str>) -> Result<(), String> {
    let full_command = build_shell_command(command, cwd);
    let escaped = escape_osascript(&full_command);
    // iTerm2 AppleScript to create a new window and execute command
    let script = format!(
        r#"tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
        write text "{escaped}"
    end tell
end tell"#
    );

    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| format!("Failed to launch iTerm: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("iTerm command execution failed".to_string())
    }
}

fn launch_ghostty(command: &str, cwd: Option<&str>) -> Result<(), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut args = vec![
        "-na".to_string(),
        "Ghostty".to_string(),
        "--args".to_string(),
        "--quit-after-last-window-closed=true".to_string(),
    ];

    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            args.push(format!("--working-directory={dir}"));
        }
    }

    args.push("-e".to_string());
    args.push(shell);
    args.push("-l".to_string());
    args.push("-c".to_string());
    args.push(command.to_string());

    let status = Command::new("open")
        .args(&args)
        .status()
        .map_err(|e| format!("Failed to launch Ghostty: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch Ghostty. Make sure it is installed.".to_string())
    }
}

fn launch_kitty(command: &str, cwd: Option<&str>) -> Result<(), String> {
    let full_command = build_shell_command(command, cwd);

    // 获取用户默认 shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let status = Command::new("open")
        .arg("-na")
        .arg("kitty")
        .arg("--args")
        .arg("-e")
        .arg(&shell)
        .arg("-l")
        .arg("-c")
        .arg(&full_command)
        .status()
        .map_err(|e| format!("Failed to launch Kitty: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch Kitty. Make sure it is installed.".to_string())
    }
}

fn launch_wezterm(command: &str, cwd: Option<&str>) -> Result<(), String> {
    // wezterm start --cwd ... -- command
    // To invoke via `open`, we use `open -na "WezTerm" --args start ...`
    let args = build_wezterm_compatible_args("WezTerm", command, cwd);

    let status = Command::new("open")
        .args(args.iter().map(String::as_str))
        .status()
        .map_err(|e| format!("Failed to launch WezTerm: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch WezTerm.".to_string())
    }
}

fn launch_kaku(command: &str, cwd: Option<&str>) -> Result<(), String> {
    // Kaku is a WezTerm-derived terminal and keeps a compatible `start` entrypoint.
    let args = build_wezterm_compatible_args("Kaku", command, cwd);

    let status = Command::new("open")
        .args(args.iter().map(String::as_str))
        .status()
        .map_err(|e| format!("Failed to launch Kaku: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch Kaku.".to_string())
    }
}

fn build_wezterm_compatible_args(app_name: &str, command: &str, cwd: Option<&str>) -> Vec<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    build_wezterm_compatible_args_with_shell(app_name, command, cwd, &shell)
}

fn build_wezterm_compatible_args_with_shell(
    app_name: &str,
    command: &str,
    cwd: Option<&str>,
    shell: &str,
) -> Vec<String> {
    let full_command = build_shell_command(command, None);
    let mut args = vec![
        "-na".to_string(),
        app_name.to_string(),
        "--args".to_string(),
        "start".to_string(),
    ];

    if let Some(dir) = cwd {
        args.push("--cwd".to_string());
        args.push(dir.to_string());
    }

    // Invoke shell to run the command string (to handle pipes, etc)
    args.push("--".to_string());
    args.push(shell.to_string());
    args.push("-c".to_string());
    args.push(full_command);
    args
}

#[cfg(unix)]
fn launch_warp(command: &str, cwd: Option<&str>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let cwd = cwd.ok_or("Failed to resume session without cwd")?;

    let mut script_file = tempfile::Builder::new()
        .disable_cleanup(true)
        .permissions(std::fs::Permissions::from_mode(0o755))
        .tempfile_in(cwd)
        .map_err(|e| format!("Failed to create temporary script file for launching Warp: {e}"))?;

    writeln!(
        &mut script_file,
        r#"#!/usr/bin/env sh

        rm -- "$0"

        exec {command}
        "#,
    )
    .map_err(|e| format!("Failed to write to temporary script file for Warp: {e}"))?;

    let mut warp_url = url::Url::parse("warp://action/new_tab").unwrap();
    warp_url
        .query_pairs_mut()
        .append_pair("path", &script_file.path().to_string_lossy());
    let warp_url = warp_url.to_string();

    let status = Command::new("open")
        .args(["-a", "Warp", &warp_url])
        .status()
        .map_err(|e| format!("Failed to launch Warp: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch Warp.".to_string())
    }
}

fn launch_alacritty(command: &str, cwd: Option<&str>) -> Result<(), String> {
    // Alacritty: open -na Alacritty --args --working-directory ... -e shell -c command
    let full_command = build_shell_command(command, None);
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut args = vec!["-na", "Alacritty", "--args"];

    if let Some(dir) = cwd {
        args.push("--working-directory");
        args.push(dir);
    }

    args.push("-e");
    args.push(&shell);
    args.push("-c");
    args.push(&full_command);

    let status = Command::new("open")
        .args(&args)
        .status()
        .map_err(|e| format!("Failed to launch Alacritty: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to launch Alacritty.".to_string())
    }
}

fn launch_custom(
    command: &str,
    cwd: Option<&str>,
    custom_config: Option<&str>,
) -> Result<(), String> {
    let template = custom_config.ok_or("No custom terminal config provided")?;

    if template.trim().is_empty() {
        return Err("Custom terminal command template is empty".to_string());
    }

    let cmd_str = command;
    // `{cwd}` 是磁盘上扫来的路径，先做转义；`{command}` 保持原样——模板作者写下
    // 这个占位符的本意就是让它当命令展开。
    //
    // ⚠️ 这里的转义**不是完备防护**，只在占位符处于未加引号的 shell 词位置时成立。
    // 模板若写成 `echo "{cwd}"`，插入的单引号会落进双引号里变成普通字符，`cwd`
    // 里的 `$(...)` 照样求值。安全性取决于模板怎么写，而模板不由这里控制。
    //
    // 目前本分支无 UI 入口（终端选项列表没有 `custom`，前端也从不传
    // `customConfig`），所以不可达。**接线前必须换掉这个方案**——正确做法是让
    // 模板声明参数位、由此处按 argv 传递，而不是让用户拼 shell 字符串。
    let dir_str = shell_escape(cwd.unwrap_or("."));

    let final_cmd_line = template
        .replace("{command}", cmd_str)
        .replace("{cwd}", &dir_str);

    // Execute via sh -c
    let status = Command::new("sh")
        .arg("-c")
        .arg(&final_cmd_line)
        .status()
        .map_err(|e| format!("Failed to execute custom terminal launcher: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Custom terminal execution returned error code".to_string())
    }
}

fn build_shell_command(command: &str, cwd: Option<&str>) -> String {
    match cwd {
        Some(dir) if !dir.trim().is_empty() => {
            format!("cd {} && {}", shell_escape(dir), command)
        }
        _ => command.to_string(),
    }
}

/// POSIX 单引号转义。
///
/// **必须是单引号**：双引号内 `$(...)`、反引号、`$VAR` 照常展开，而这里包的是
/// `projectDir`——会话历史里记录的真实项目路径，macOS 允许目录名含 `$` `(` `)`，
/// 所以一个名为 `$(...)` 的目录就足以让命令替换在用户终端里执行。
///
/// 单引号内不做任何展开，唯一的特例是 `'` 自身无法被表示：用「闭合-转义-重开」
/// 的 `'\''` 序列绕过。
pub(crate) fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

fn escape_osascript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_shell_command_keeps_command_without_cwd_prefix_when_not_provided() {
        assert_eq!(
            build_shell_command("claude --resume abc-123", None),
            "claude --resume abc-123"
        );
    }

    #[test]
    fn wezterm_compatible_terminals_use_start_and_cwd_arguments() {
        let args = build_wezterm_compatible_args_with_shell(
            "Kaku",
            "claude --resume abc-123",
            Some("/tmp/project dir"),
            "/bin/zsh",
        );

        assert_eq!(
            args,
            vec![
                "-na".to_string(),
                "Kaku".to_string(),
                "--args".to_string(),
                "start".to_string(),
                "--cwd".to_string(),
                "/tmp/project dir".to_string(),
                "--".to_string(),
                "/bin/zsh".to_string(),
                "-c".to_string(),
                "claude --resume abc-123".to_string(),
            ]
        );
    }

    #[test]
    fn ghostty_uses_working_directory_arg_for_cwd() {
        // cwd should be passed as --working-directory, not embedded in the shell command string
        // This avoids shell expansion of special characters in directory paths
        let cwd = "/tmp/project dir";
        let command = "claude --resume abc-123";

        // Verify build_shell_command does NOT include cwd when used in ghostty context
        // (ghostty passes cwd via --working-directory flag instead)
        assert_eq!(
            build_shell_command(command, None),
            "claude --resume abc-123"
        );

        // Verify shell_escape works correctly for paths with spaces
        assert_eq!(shell_escape(cwd), "'/tmp/project dir'");
    }

    #[test]
    fn shell_escape_neutralizes_command_substitution_in_directory_names() {
        // 这些字符在 macOS 目录名里全部合法，而 `cwd` 就是会话历史里的
        // `projectDir`——一个名为 `$(...)` 的目录必须原样落到 `cd` 后面，
        // 不能被 shell 求值。旧的双引号实现对这三种全部失守。
        assert_eq!(shell_escape("/tmp/$(id -un)"), "'/tmp/$(id -un)'");
        assert_eq!(shell_escape("/tmp/`id -un`"), "'/tmp/`id -un`'");
        assert_eq!(shell_escape("/tmp/$HOME"), "'/tmp/$HOME'");
    }

    #[test]
    fn shell_escape_handles_embedded_single_quote() {
        // 单引号是单引号包裹法唯一表示不了的字符，靠「闭合-转义-重开」绕过。
        assert_eq!(shell_escape("/tmp/it's"), r"'/tmp/it'\''s'");
    }

    #[test]
    fn shell_escape_survives_the_osascript_layer() {
        // Terminal / iTerm 的链路是两层：shell_escape 的结果先被塞进 AppleScript
        // 字符串字面量，由 escape_osascript 再转义一次，AppleScript 求值后才交给
        // shell。反斜杠会在中间那层被加倍，必须确认最终落到 shell 的字节没变形。
        let escaped = shell_escape("/tmp/it's");
        assert_eq!(escaped, r"'/tmp/it'\''s'");

        let for_applescript = escape_osascript(&escaped);
        assert_eq!(for_applescript, r"'/tmp/it'\\''s'");

        // AppleScript 把 `\\` 求值回单个 `\`，于是 shell 拿到的正是 escaped 本身。
        assert_eq!(for_applescript.replace(r"\\", r"\"), escaped);
    }

    #[test]
    fn build_shell_command_quotes_the_cwd_it_prefixes() {
        // Terminal / iTerm / kitty 三条路径都经这里；ghostty / wezterm / alacritty
        // 走 `cwd = None` 并把目录当独立 argv 传，不受影响。
        assert_eq!(
            build_shell_command("claude --resume x", Some("/tmp/$(id -un)")),
            "cd '/tmp/$(id -un)' && claude --resume x"
        );
    }

    #[cfg(unix)]
    #[test]
    fn terminal_command_file_is_executable_self_cleaning_and_uses_user_shell_profile() {
        use std::os::unix::fs::PermissionsExt;

        let script_path = create_macos_terminal_command_file(
            "codex --profile coding-bro",
            Some("/tmp/project dir"),
        )
        .expect("create terminal command file");
        let script = std::fs::read_to_string(&script_path).expect("read terminal command file");
        let mode = std::fs::metadata(&script_path)
            .expect("read terminal command file metadata")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o700);
        assert!(script.contains("rm -f -- \"$script_path\""));
        assert!(script.contains("fish) exec \"$shell_path\" -lc"));
        assert!(script.contains("sh|dash) exec \"$shell_path\" -c"));
        assert!(script.contains("*) exec \"$shell_path\" -lic"));
        assert!(script.contains("cd '\\''/tmp/project dir'\\'' && codex --profile coding-bro"));

        std::fs::remove_file(script_path).expect("clean terminal command file");
    }

    #[test]
    fn codex_launch_uses_invocation_overrides_instead_of_a_profile_write() {
        let launch = build_coding_bro_process_launch(
            "codex",
            "'/Applications/Codex/codex'",
            "https://coding.example",
            "gateway-secret",
            "codingbro-pro-2.0",
        )
        .expect("build Codex launch");

        assert!(launch.command.contains("model_provider=\"coding_bro\""));
        assert!(launch
            .command
            .contains("model_providers.coding_bro.wire_api=\"responses\""));
        assert!(launch.command.contains("https://coding.example/v1"));
        assert_eq!(
            launch.environment,
            vec![("OPENAI_API_KEY".to_string(), "gateway-secret".to_string())]
        );
        assert!(launch.cleanup_paths.is_empty());
    }

    #[test]
    fn opencode_inline_config_contains_the_real_provider_and_model_keys() {
        let launch = build_coding_bro_process_launch(
            "opencode",
            "opencode",
            "https://coding.example",
            "gateway-secret",
            "codingbro-max-2.0",
        )
        .expect("build OpenCode launch");
        let config = launch
            .environment
            .iter()
            .find(|(key, _)| key == "OPENCODE_CONFIG_CONTENT")
            .map(|(_, value)| value)
            .expect("inline config");
        let config: serde_json::Value = serde_json::from_str(config).expect("valid config JSON");

        assert_eq!(config["model"], "coding-bro-plan/codingbro-max-2.0");
        assert_eq!(
            config["provider"]["coding-bro-plan"]["models"]["codingbro-max-2.0"]["name"],
            "Coding Bro"
        );
        assert_eq!(
            config["provider"]["coding-bro-plan"]["options"]["apiKey"],
            "gateway-secret"
        );
    }

    #[cfg(unix)]
    #[test]
    fn pi_overlay_preserves_the_source_and_keeps_openrouter_available() {
        use std::os::unix::fs::PermissionsExt;

        let source = tempfile::tempdir().expect("source dir");
        let overlay = tempfile::tempdir().expect("overlay dir");
        let original = serde_json::json!({
            "providers": {
                "openrouter": {
                    "baseUrl": "https://openrouter.ai/api/v1",
                    "api": "openai-completions",
                    "models": [{ "id": "z-ai/glm-flash", "name": "GLM Flash" }]
                }
            }
        });
        std::fs::write(
            source.path().join("models.json"),
            serde_json::to_vec_pretty(&original).expect("serialize source"),
        )
        .expect("write source");
        std::fs::write(
            source.path().join("settings.json"),
            br#"{"defaultProvider":"openrouter","defaultModel":"z-ai/glm-flash"}"#,
        )
        .expect("write settings");
        std::fs::create_dir(source.path().join("extensions")).expect("extensions dir");

        populate_pi_overlay(
            source.path(),
            overlay.path(),
            "https://coding.example/v1",
            "gateway-secret",
            "codingbro-2.0",
        )
        .expect("populate overlay");

        let unchanged: serde_json::Value = serde_json::from_slice(
            &std::fs::read(source.path().join("models.json")).expect("read source"),
        )
        .expect("parse source");
        let isolated: serde_json::Value = serde_json::from_slice(
            &std::fs::read(overlay.path().join("models.json")).expect("read overlay"),
        )
        .expect("parse overlay");
        let mode = std::fs::metadata(overlay.path().join("models.json"))
            .expect("overlay metadata")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(unchanged, original);
        assert_eq!(
            isolated["providers"]["openrouter"]["models"][0]["id"],
            "z-ai/glm-flash"
        );
        assert_eq!(
            isolated["providers"]["coding-bro-plan"]["models"][0]["id"],
            "codingbro-2.0"
        );
        assert_eq!(mode, 0o600);
        assert!(overlay.path().join("extensions").is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn private_launcher_is_owner_only_and_deletes_itself_before_starting_cli() {
        use std::os::unix::fs::PermissionsExt;

        let launch = ProcessLaunch {
            command: "pi --provider coding-bro-plan".to_string(),
            environment: vec![("TEST_API_KEY".to_string(), "secret".to_string())],
            unset_environment: vec!["OPENROUTER_API_KEY"],
            cleanup_paths: vec![],
        };
        let path = create_private_process_launcher(&launch).expect("create launcher");
        let content = std::fs::read_to_string(&path).expect("read launcher");
        let mode = std::fs::metadata(&path)
            .expect("launcher metadata")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o700);
        assert!(content.contains("rm -f -- \"$launcher_path\""));
        assert!(content.contains("unset OPENROUTER_API_KEY"));
        assert!(content.contains("export TEST_API_KEY='secret'"));
        std::fs::remove_file(path).expect("remove launcher");
    }
}
