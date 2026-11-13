use crate::policy::{valid_model_id, validate_api_url, AuthorizedCredential};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};

const KEY_ENV: &str = "CODING_BRO_LITE_API_KEY";
const PROVIDER: &str = "coding_bro_lite";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    pub installed: bool,
    pub can_install: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
}

impl CodexStatus {
    pub fn unavailable() -> Self {
        Self {
            installed: false,
            can_install: cfg!(target_os = "windows"),
            version: None,
            executable_path: None,
        }
    }
}

fn selection_file() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("coding-bro-lite/codex-path"))
}
fn selected_codex() -> Option<PathBuf> {
    fs::read_to_string(selection_file()?)
        .ok()
        .map(PathBuf::from)
}
pub fn select_directory(directory: String) -> Result<CodexStatus, String> {
    let root = validate_directory(&directory)?;
    let candidates = [
        "resources/codex.exe",
        "app/resources/codex.exe",
        "codex.exe",
        "codex.cmd",
        "bin/codex",
        "codex",
    ];
    let path = candidates
        .iter()
        .map(|p| root.join(p))
        .find(|p| p.is_file() && codex_status_at(p).installed)
        .ok_or("目录中没有可用的 Codex CLI 或桌面端内置 CLI")?;
    let file = selection_file().ok_or("无法读取配置目录")?;
    fs::create_dir_all(file.parent().ok_or("配置目录无效")?).map_err(|_| "无法创建配置目录")?;
    fs::write(file, path.to_string_lossy().as_bytes()).map_err(|_| "无法保存 Codex 目录")?;
    Ok(codex_status_at(&path))
}
#[cfg(target_os = "windows")]
fn windows_bundle_candidates() -> Vec<PathBuf> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-AppxPackage -Name OpenAI.Codex | ForEach-Object { $_.InstallLocation }"])
        .creation_flags(0x08000000).output();
    output
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.trim().is_empty())
                .map(|s| PathBuf::from(s.trim()).join("app/resources/codex.exe"))
                .collect()
        })
        .unwrap_or_default()
}

pub fn find_codex() -> Option<PathBuf> {
    if let Some(path) = selected_codex() {
        if codex_status_at(&path).installed {
            return Some(path);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(path) = crate::windows_tools::managed_codex() {
        if codex_status_at(&path).installed {
            return Some(path);
        }
    }
    #[cfg(target_os = "windows")]
    let mut directories = crate::windows_tools::search_directories();
    #[cfg(not(target_os = "windows"))]
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        directories.extend([
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join(".volta/bin"),
            home.join(".cargo/bin"),
        ]);
        #[cfg(unix)]
        if let Ok(versions) = fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = versions
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .collect();
            versions.sort();
            directories.extend(versions.into_iter().rev().map(|path| path.join("bin")));
        }
    }
    #[cfg(unix)]
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    // Finder does not inherit an interactive shell's PATH. Prefer separately
    // installed CLI binaries, then try the official app bundle locations.
    #[cfg(target_os = "macos")]
    let bundled = macos_bundle_candidates(dirs::home_dir().as_deref());
    #[cfg(target_os = "windows")]
    let bundled = windows_bundle_candidates();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let bundled = Vec::new();
    find_codex_in(directories, bundled)
}

#[cfg(target_os = "macos")]
fn macos_bundle_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = home {
        roots.push(home.join("Applications"));
    }
    roots
        .into_iter()
        .flat_map(|root| {
            [
                root.join("Codex.app/Contents/Resources/codex"),
                root.join(
                    "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
                ),
            ]
        })
        .collect()
}

fn find_codex_in(directories: Vec<PathBuf>, bundled: Vec<PathBuf>) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let names = ["codex.exe", "codex.cmd"];
    #[cfg(not(target_os = "windows"))]
    let names = ["codex"];
    #[cfg(target_os = "windows")]
    let mut seen = std::collections::BTreeSet::new();
    for directory in directories {
        #[cfg(target_os = "windows")]
        if !seen.insert(directory.to_string_lossy().to_lowercase()) {
            continue;
        }
        #[cfg(target_os = "windows")]
        if !directory.is_absolute() {
            continue;
        }
        let directory = if directory.is_absolute() {
            directory
        } else {
            let Ok(current) = std::env::current_dir() else {
                continue;
            };
            current.join(directory)
        };
        for name in names {
            let path = directory.join(name);
            if path.is_file() && executable_file(&path) {
                #[cfg(target_os = "windows")]
                {
                    let path = crate::windows_tools::native_npm_binary(&path).unwrap_or(path);
                    if codex_status_at(&path).installed {
                        return Some(path);
                    }
                    continue;
                }
                // Keep the npm shim path: canonicalizing its symlink can break
                // package-relative binary resolution in JS launchers.
                #[cfg(not(target_os = "windows"))]
                return Some(path);
            }
        }
    }
    bundled
        .into_iter()
        .find(|path| path.is_file() && executable_file(path))
}

fn executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

pub(crate) fn codex_command(executable: &Path) -> Command {
    #[cfg(target_os = "windows")]
    if executable
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        // npm's Windows shim is shell source. Invoke its fixed Codex JS entry
        // through Node instead so directory/model values never reach cmd.exe.
        let entry = executable
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("node_modules/@openai/codex/bin/codex.js");
        let node = executable
            .parent()
            .map(|p| p.join("node.exe"))
            .filter(|p| p.is_file())
            .or_else(|| {
                crate::windows_tools::search_directories()
                    .into_iter()
                    .map(|p| p.join("node.exe"))
                    .find(|p| p.is_file())
            })
            .unwrap_or_else(|| executable.with_file_name("node.exe"));
        let mut command = Command::new(node);
        command.arg(entry);
        if let Some(path) = crate::windows_tools::command_path(executable) {
            command.env("PATH", path);
        }
        return command;
    }
    let command = Command::new(executable);
    #[cfg(target_os = "windows")]
    let command = {
        let mut command = command;
        if let Some(path) = crate::windows_tools::command_path(executable) {
            command.env("PATH", path);
        }
        command
    };
    command
}

pub fn codex_status() -> CodexStatus {
    let Some(path) = find_codex() else {
        return CodexStatus::unavailable();
    };
    codex_status_at(&path)
}

pub(crate) fn codex_status_at(path: &Path) -> CodexStatus {
    let mut command = codex_command(path);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let version = command.spawn().ok().and_then(|mut child| {
        #[cfg(target_os = "windows")]
        let _job = crate::windows_process::BackgroundJob::attach(&mut child).ok()?;
        #[cfg(target_os = "windows")]
        let output = {
            let stdout = child.stdout.take()?;
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || {
                let mut output = String::new();
                let result = stdout
                    .take(1024)
                    .read_to_string(&mut output)
                    .map(|_| output);
                let _ = sender.send(result);
            });
            receiver
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    #[cfg(target_os = "windows")]
                    let output = output
                        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                        .ok()?
                        .ok()?;
                    #[cfg(not(target_os = "windows"))]
                    let output = {
                        let mut output = String::new();
                        child
                            .stdout
                            .take()?
                            .take(1024)
                            .read_to_string(&mut output)
                            .ok()?;
                        output
                    };
                    return Some(output.trim().to_string());
                }
                Ok(Some(_)) | Err(_) => return None,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            }
        }
    });
    CodexStatus {
        #[cfg(target_os = "windows")]
        installed: version
            .as_ref()
            .is_some_and(|v| v.starts_with("codex-cli ")),
        #[cfg(not(target_os = "windows"))]
        installed: version.is_some(),
        can_install: cfg!(target_os = "windows"),
        version,
        executable_path: Some(path.to_string_lossy().into_owned()),
    }
}

pub fn validate_directory(value: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(value).map_err(|_| "项目目录不存在或无法访问".to_string())?;
    #[cfg(target_os = "windows")]
    let path = {
        // Rust canonicalize adds a verbatim prefix that breaks ordinary shells
        // and tools. Retain UNC semantics while returning a conventional path.
        let text = path.to_string_lossy();
        // Keep the extended form for long paths; stripping it loses Win32
        // access on systems where the global long-path policy is disabled.
        if text.encode_utf16().count() >= 248 {
            path
        } else if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            PathBuf::from(rest)
        } else {
            path
        }
    };
    if !path.is_dir() {
        return Err("请选择一个项目目录".to_string());
    }
    Ok(path)
}

#[derive(Serialize, Deserialize)]
struct LaunchSpec {
    executable: PathBuf,
    directory: PathBuf,
    codex_home: PathBuf,
    model_id: String,
    inference_base_url: String,
    token: String,
}

#[derive(Serialize)]
struct CodexConfig<'a> {
    model: &'a str,
    model_catalog_json: &'a str,
    model_provider: &'static str,
    model_providers: BTreeMap<&'static str, ProviderConfig<'a>>,
}

#[derive(Serialize)]
struct ProviderConfig<'a> {
    name: &'static str,
    base_url: &'a str,
    env_key: &'static str,
    wire_api: &'static str,
    requires_openai_auth: bool,
    supports_websockets: bool,
    http_headers: BTreeMap<&'static str, &'static str>,
}

fn config_text(model_id: &str, base_url: &str, model_catalog: &Path) -> Result<String, String> {
    // Official Codex contract: env_key provides a bearer token, and wire_api
    // accepts Responses only. Never serialize credentials to config.toml.
    // https://learn.chatgpt.com/docs/config-file/config-reference
    let provider = ProviderConfig {
        name: "Coding Bro Lite",
        base_url,
        env_key: KEY_ENV,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
        http_headers: BTreeMap::from([("X-Coding-Bro-Product", "codex-lite")]),
    };
    toml::to_string(&CodexConfig {
        model: model_id,
        model_catalog_json: model_catalog.to_str().ok_or("模型目录路径无效")?,
        model_provider: PROVIDER,
        model_providers: BTreeMap::from([(PROVIDER, provider)]),
    })
    .map_err(|_| "无法生成 Codex 配置".to_string())
}

// Reuse one Lite-owned profile. Older builds created a UUID profile per launch,
// losing both Codex onboarding state and Electron local storage every time.
fn persistent_codex_home(data: &Path) -> Result<PathBuf, String> {
    let pointer = data.join("codex-profile");
    let sessions = data.join("codex-sessions");
    if let Ok(name) = fs::read_to_string(&pointer) {
        let name = name.trim();
        if name == "persistent" || uuid::Uuid::parse_str(name).is_ok() {
            let home = sessions.join(name);
            create_session_directory(&home)?;
            return Ok(home);
        }
        return Err("Lite Codex 配置目录记录无效".into());
    }
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(&sessions) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&name).is_err() || !path.is_dir() {
                continue;
            }
            let state_file = path.join(".codex-global-state.json");
            let state: serde_json::Value = fs::read(&state_file)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            let atoms = &state["electron-persisted-atom-state"];
            let completed = atoms["last_completed_onboarding"]
                .as_i64()
                .is_some_and(|v| v > 0)
                || atoms["electron:onboarding-projectless-completed"].as_bool() == Some(true);
            let desktop = path.join("desktop-data").is_dir();
            let modified = fs::metadata(&state_file)
                .or_else(|_| fs::metadata(&path))
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((completed, desktop, modified, name));
        }
    }
    candidates.sort();
    let name = candidates
        .pop()
        .map(|item| item.3)
        .unwrap_or_else(|| "persistent".into());
    let home = sessions.join(&name);
    create_session_directory(&home)?;
    replace_private_file(&pointer, name.as_bytes())?;
    Ok(home)
}

pub(crate) fn replace_private_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Codex 配置路径无效")?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建 Codex 配置文件")?;
    file.write_all(content).map_err(|_| "无法写入 Codex 配置")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "无法保存 Codex 配置")?;
    file.persist(path).map_err(|_| "无法更新 Codex 配置")?;
    Ok(())
}

fn create_session_directory(home: &Path) -> Result<(), String> {
    fs::create_dir_all(home).map_err(|_| "无法创建 Lite 会话目录".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(home, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法设置会话目录权限".to_string())?;
    }
    Ok(())
}

fn write_config(
    home: &Path,
    model_id: &str,
    base_url: &str,
    model_catalog: &Path,
) -> Result<(), String> {
    let generated: toml::Value = toml::from_str(&config_text(model_id, base_url, model_catalog)?)
        .map_err(|_| "无法生成 Codex 配置")?;
    let path = home.join("config.toml");
    let mut config: toml::Value = if path.exists() {
        toml::from_str(&fs::read_to_string(&path).map_err(|_| "无法读取 Codex 配置")?)
            .map_err(|_| "现有 Codex 配置无效，请在高级设置中修复")?
    } else {
        toml::Value::Table(Default::default())
    };
    let table = config.as_table_mut().ok_or("现有 Codex 配置无效")?;
    for (key, value) in generated.as_table().ok_or("Codex 配置无效")? {
        if key == "model_providers" {
            let providers = table
                .entry(key.clone())
                .or_insert_with(|| toml::Value::Table(Default::default()))
                .as_table_mut()
                .ok_or("现有模型提供商配置无效")?;
            providers.insert(PROVIDER.into(), value[PROVIDER].clone());
        } else {
            table.insert(key.clone(), value.clone());
        }
    }
    replace_private_file(
        &path,
        toml::to_string(&config)
            .map_err(|_| "无法生成 Codex 配置")?
            .as_bytes(),
    )
}

pub(crate) fn write_private_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "无法写入 Codex 配置".to_string())?;
    file.write_all(content)
        .map_err(|_| "无法写入 Codex 配置".to_string())
}

struct Handoff {
    address: SocketAddr,
    ticket: String,
    received: mpsc::Receiver<Result<(), String>>,
    cancelled: Arc<AtomicBool>,
}

fn start_handoff(spec: LaunchSpec) -> Result<Handoff, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "无法创建 Codex 安全启动连接".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法初始化 Codex 启动连接".to_string())?;
    let address = listener
        .local_addr()
        .map_err(|_| "无法读取 Codex 启动地址".to_string())?;
    let ticket = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let expected = ticket.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancel = cancelled.clone();
    let (sender, received) = mpsc::channel();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !cancel.load(Ordering::Relaxed) && Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, peer)) if peer.ip().is_loopback() => {
                    // Winsock accepted sockets inherit the nonblocking listener
                    // mode. The authenticated handoff uses blocking deadlines.
                    if stream.set_nonblocking(false).is_err() {
                        continue;
                    }
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let mut request = String::new();
                    if BufReader::new(&stream)
                        .take(256)
                        .read_line(&mut request)
                        .is_ok()
                        && request.trim_end() == expected
                    {
                        if let Ok(mut payload) = serde_json::to_vec(&spec) {
                            payload.push(b'\n');
                            let sent = stream.write_all(&payload).is_ok();
                            #[cfg(target_os = "windows")]
                            let started = if sent {
                                let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                                let mut ready = String::new();
                                match BufReader::new(&stream).take(2048).read_line(&mut ready) {
                                    Ok(_) if ready.trim_end() == "started" => Ok(()),
                                    Ok(0) => {
                                        Err("Codex 控制台在发送启动确认前关闭连接，请查看终端错误"
                                            .into())
                                    }
                                    Ok(_) => Err(ready
                                        .trim_end()
                                        .strip_prefix("error:")
                                        .unwrap_or("Codex 控制台返回了无效启动确认")
                                        .to_string()),
                                    Err(error) => {
                                        Err(format!("无法读取 Codex 控制台启动确认：{error}"))
                                    }
                                }
                            } else {
                                Err("无法发送 Codex 启动配置".to_string())
                            };
                            #[cfg(not(target_os = "windows"))]
                            let started = if sent {
                                Ok(())
                            } else {
                                Err("无法发送 Codex 启动配置".to_string())
                            };
                            let _ = sender.send(started);
                        }
                        return; // A ticket can be redeemed exactly once.
                    }
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(_) => break,
            }
        }
        let _ = sender.send(Err("终端未能接收 Codex 启动配置，请重试".to_string()));
    });
    Ok(Handoff {
        address,
        ticket,
        received,
        cancelled,
    })
}

pub fn launch(
    executable: PathBuf,
    directory: PathBuf,
    model_id: String,
    data_directory: PathBuf,
    credential: AuthorizedCredential,
    desktop: bool,
) -> Result<(), String> {
    static LAUNCH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LAUNCH_LOCK.lock().map_err(|_| "Codex 启动状态不可用")?;
    let codex_home = persistent_codex_home(&data_directory)?;
    let prepared = (|| {
        let catalog = crate::model_catalog::write_catalog(
            &executable,
            &codex_home,
            &credential.allowed_model_ids,
        )?;
        write_config(
            &codex_home,
            &model_id,
            &credential.inference_base_url,
            &catalog,
        )
    })();
    if let Err(error) = prepared {
        return Err(error);
    }
    if desktop {
        return launch_desktop(&executable, &directory, &codex_home, &credential.token);
    }
    let current_executable =
        std::env::current_exe().map_err(|_| "无法读取 Lite 启动程序".to_string())?;
    let handoff = start_handoff(LaunchSpec {
        executable,
        directory,
        codex_home: codex_home.clone(),
        model_id,
        inference_base_url: credential.inference_base_url,
        token: credential.token,
    })?;
    // A handoff ticket is a capability too: keep it out of process arguments.
    let ticket_file = codex_home.join(format!(".launch-ticket-{}", uuid::Uuid::new_v4()));
    if let Err(error) = write_private_file(&ticket_file, handoff.ticket.as_bytes()) {
        handoff.cancelled.store(true, Ordering::Relaxed);
        return Err(error);
    }
    if let Err(error) = open_terminal(
        &current_executable,
        &handoff.address.to_string(),
        &ticket_file.to_string_lossy(),
    ) {
        handoff.cancelled.store(true, Ordering::Relaxed);
        let _ = fs::remove_file(&ticket_file);
        return Err(error);
    }
    let started = handoff
        .received
        .recv_timeout(Duration::from_secs(30))
        .unwrap_or_else(|_| Err("终端未能接收 Codex 启动配置，请重试".to_string()));
    if let Err(error) = started {
        handoff.cancelled.store(true, Ordering::Relaxed);
        let _ = fs::remove_file(&ticket_file);
        return Err(error);
    }
    let _ = fs::remove_file(ticket_file);
    Ok(())
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn open_terminal(executable: &Path, address: &str, ticket_file: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut file = tempfile::Builder::new()
        .prefix("codex-lite-")
        .suffix(".command")
        .permissions(fs::Permissions::from_mode(0o700))
        .tempfile()
        .map_err(|_| "无法创建终端启动文件".to_string())?;
    // Contains only the launcher path and a private handoff file path. No API key,
    // access token, model input, or project directory enters shell source.
    writeln!(
        file,
        "#!/bin/sh\nrm -f -- \"$0\"\nexec {} --codex-lite-run {} {}",
        shell_quote(&executable.to_string_lossy()),
        shell_quote(address),
        shell_quote(ticket_file)
    )
    .map_err(|_| "无法写入终端启动文件".to_string())?;
    file.flush()
        .map_err(|_| "无法刷新终端启动文件".to_string())?;
    let path = file
        .into_temp_path()
        .keep()
        .map_err(|_| "无法保存终端启动文件".to_string())?;
    match Command::new("open")
        .args(["-a", "Terminal"])
        .arg(&path)
        .status()
    {
        Ok(status) if status.success() => Ok(()),
        _ => {
            let _ = fs::remove_file(path);
            Err("无法打开 macOS Terminal".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn open_terminal(executable: &Path, address: &str, ticket_file: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // The child allocates its own console. No shell interprets paths, tickets,
    // quotes, percent signs, ampersands, Unicode or project/model arguments.
    Command::new(executable)
        .args(["--codex-lite-run", address, ticket_file])
        .creation_flags(0x00000008) // DETACHED_PROCESS: child calls AllocConsole
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 Codex 控制台：{error}"))
}

#[cfg(target_os = "linux")]
fn open_terminal(executable: &Path, address: &str, ticket_file: &str) -> Result<(), String> {
    for (terminal, separator) in [
        ("x-terminal-emulator", "-e"),
        ("gnome-terminal", "--"),
        ("konsole", "-e"),
        ("xterm", "-e"),
    ] {
        if Command::new(terminal)
            .arg(separator)
            .arg(executable)
            .args(["--codex-lite-run", address, ticket_file])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("没有可用的终端，请安装 x-terminal-emulator、GNOME Terminal、Konsole 或 xterm".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn open_terminal(_: &Path, _: &str, _: &str) -> Result<(), String> {
    Err("当前平台不支持终端启动".to_string())
}

fn receive_handoff(address: &str, ticket: &str) -> Result<(LaunchSpec, TcpStream), String> {
    let address: SocketAddr = address
        .parse()
        .map_err(|_| "启动连接地址无效".to_string())?;
    if !address.ip().is_loopback()
        || address.port() == 0
        || ticket.len() != 64
        || !ticket.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("启动交接参数无效".to_string());
    }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|_| "Lite 启动连接已失效，请重新启动".to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "启动连接配置失败".to_string())?;
    writeln!(stream, "{ticket}").map_err(|_| "无法接收启动配置".to_string())?;
    let mut payload = String::new();
    BufReader::new(&stream)
        .take(65536)
        .read_line(&mut payload)
        .map_err(|_| "无法接收启动配置".to_string())?;
    serde_json::from_str(&payload)
        .map(|spec| (spec, stream))
        .map_err(|_| "Codex 启动配置无效".to_string())
}

fn process_command(spec: &LaunchSpec) -> Result<Command, String> {
    if !valid_model_id(&spec.model_id) || spec.token.is_empty() || spec.token.contains(['\r', '\n'])
    {
        return Err("Codex 启动参数无效".to_string());
    }
    validate_api_url(&spec.inference_base_url)?;
    let provider = format!("model_providers.{PROVIDER}");
    let overrides = [
        format!("model={}", toml::Value::String(spec.model_id.clone())),
        format!(
            "model_catalog_json={}",
            toml::Value::String(
                spec.codex_home
                    .join("models.json")
                    .to_string_lossy()
                    .into_owned()
            )
        ),
        format!("model_provider=\"{PROVIDER}\""),
        format!("{provider}.name=\"Coding Bro Lite\""),
        format!(
            "{provider}.base_url={}",
            toml::Value::String(spec.inference_base_url.clone())
        ),
        format!("{provider}.env_key=\"{KEY_ENV}\""),
        format!("{provider}.wire_api=\"responses\""),
        format!("{provider}.requires_openai_auth=false"),
        format!("{provider}.supports_websockets=false"),
        format!("{provider}.http_headers={{\"X-Coding-Bro-Product\"=\"codex-lite\"}}"),
    ];
    let mut command = codex_command(&spec.executable);
    for value in overrides {
        command.arg("-c").arg(value);
    }
    command
        .arg("--model")
        .arg(&spec.model_id)
        .arg("--cd")
        .arg(&spec.directory)
        .current_dir(&spec.directory)
        .env("CODEX_HOME", &spec.codex_home)
        .env(KEY_ENV, &spec.token)
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .env_remove("OPENAI_BASE_URL");
    Ok(command)
}

fn read_ticket_file(path: &Path) -> Result<String, String> {
    let mut ticket = String::new();
    fs::File::open(path)
        .map_err(|_| "启动交接凭据已失效")?
        .take(128)
        .read_to_string(&mut ticket)
        .map_err(|_| "无法读取启动交接凭据")?;
    let _ = fs::remove_file(path);
    Ok(ticket)
}

pub fn run_terminal_child(args: &[String]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        // The packaged app is a GUI executable; its terminal-only child must
        // allocate its console before Codex inherits its stdio.
        if windows_sys::Win32::System::Console::GetConsoleCP() == 0
            && windows_sys::Win32::System::Console::AllocConsole() == 0
        {
            return Err("无法创建 Codex 控制台".into());
        }
        windows_sys::Win32::System::Console::SetConsoleCP(65001);
        windows_sys::Win32::System::Console::SetConsoleOutputCP(65001);
    }
    if args.len() != 2 {
        return Err("Codex 启动交接参数无效".to_string());
    }
    let ticket = read_ticket_file(Path::new(&args[1]))?;
    let (spec, mut handoff) = receive_handoff(&args[0], &ticket)?;
    #[cfg(unix)]
    let mut command = process_command(&spec)?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let _ = &mut handoff;
        drop(handoff);
        let _error = command.exec();
        Err("无法启动 Codex CLI，请检查安装状态".to_string())
    }
    #[cfg(not(unix))]
    {
        let started = (|| {
            let mut command = process_command(&spec)?;
            #[cfg(target_os = "windows")]
            {
                // A custom handler protects only the waiting launcher. Unlike
                // SetConsoleCtrlHandler(NULL, TRUE), it is not inherited by
                // Codex: Ctrl+C remains available to the interactive CLI.
                if unsafe {
                    windows_sys::Win32::System::Console::SetConsoleCtrlHandler(
                        Some(terminal_control_handler),
                        1,
                    )
                } == 0
                {
                    return Err("无法设置控制台中断处理".to_string());
                }
                command
                    .stdin(
                        OpenOptions::new()
                            .read(true)
                            .write(true)
                            .open("CONIN$")
                            .map_err(|_| "无法打开控制台输入")?,
                    )
                    .stdout(
                        OpenOptions::new()
                            .read(true)
                            .write(true)
                            .open("CONOUT$")
                            .map_err(|_| "无法打开控制台输出")?,
                    )
                    .stderr(
                        OpenOptions::new()
                            .read(true)
                            .write(true)
                            .open("CONOUT$")
                            .map_err(|_| "无法打开控制台错误输出")?,
                    );
            }
            let mut child = command
                .spawn()
                .map_err(|error| format!("无法启动 Codex CLI：{error}"))?;
            // Catch immediate loader/configuration failures before the GUI says
            // startup succeeded. Later failures remain visible in the console.
            #[cfg(target_os = "windows")]
            {
                std::thread::sleep(Duration::from_millis(300));
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Codex 启动后立即退出（{status}），请查看控制台并安装或修复 Codex"
                    ));
                }
            }
            Ok::<_, String>(child)
        })();
        let mut child = match started {
            Ok(child) => child,
            Err(error) => {
                let _ = writeln!(handoff, "error:{error}");
                return Err(error);
            }
        };
        #[cfg(target_os = "windows")]
        if writeln!(handoff, "started").is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Lite 启动确认连接已关闭，请重新启动 Codex".into());
        }
        drop(handoff);
        let status = child.wait().map_err(|_| "无法读取 Codex 退出状态")?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Codex CLI 已退出（{status}）。检查上方错误后，返回 Lite 重试或修复 Codex。"
            ))
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn terminal_control_handler(event: u32) -> i32 {
    use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT};
    i32::from(event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT)
}

#[cfg(target_os = "windows")]
pub fn show_terminal_error(error: &str) {
    // GUI-subsystem std::stderr may have no usable handle. Open the console
    // explicitly, and retain the error until the user presses Enter.
    if let Ok(mut output) = OpenOptions::new().write(true).open("CONOUT$") {
        let _ = writeln!(output, "\n{error}\n按 Enter 关闭此窗口。");
        if let Ok(input) = OpenOptions::new().read(true).write(true).open("CONIN$") {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                use windows_sys::Win32::System::Console::{
                    SetConsoleMode, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
                };
                SetConsoleMode(
                    input.as_raw_handle(),
                    ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT,
                );
            }
            let _ = BufReader::new(input).read_line(&mut String::new());
        }
    }
}

fn launch_desktop(cli: &Path, directory: &Path, home: &Path, token: &str) -> Result<(), String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(root) = cli.parent().and_then(Path::parent) {
            candidates.push(root.join("ChatGPT.exe"));
        }
        candidates.extend(windows_bundle_candidates().iter().filter_map(|p| {
            p.parent()
                .and_then(Path::parent)
                .map(|root| root.join("ChatGPT.exe"))
        }));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Codex.app/Contents/MacOS/Codex",
        ));
        if let Some(user) = dirs::home_dir() {
            candidates.push(user.join("Applications/Codex.app/Contents/MacOS/Codex"));
        }
    }
    let executable = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("未发现 Codex 桌面端，请安装桌面端或选择 CLI 模式")?;
    let user_data = home.join("desktop-data");
    let mut command = Command::new(executable);
    command
        .arg(format!("--user-data-dir={}", user_data.display()))
        .arg(directory)
        .current_dir(directory)
        .env("CODEX_HOME", home)
        .env("CODEX_ELECTRON_USER_DATA_PATH", &user_data)
        .env(KEY_ENV, token)
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .env_remove("OPENAI_BASE_URL");
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 Codex 桌面端".to_string())?;
    for _ in 0..10 {
        if let Some(status) = child.try_wait().map_err(|_| "无法检查 Codex 桌面端状态")? {
            // Electron returns success after handing a launch to an existing
            // instance using this persistent user-data directory.
            if status.success() {
                return Ok(());
            }
            return Err(format!(
                "Codex 桌面端启动后退出（{status}），请使用 CLI 模式或检查桌面端安装"
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}
