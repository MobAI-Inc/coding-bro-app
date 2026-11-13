//! Windows-only private CLI installation. Never edits global npm or user PATH.
use crate::launcher::{codex_status_at, CodexStatus};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

pub const VERSION: &str = "0.167.1";
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

fn root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|p| p.join("com.codingbro.lite/tools/codex"))
        .ok_or_else(|| "无法读取 Windows 本地应用目录".into())
}

pub fn managed_codex() -> Option<PathBuf> {
    let root = root().ok()?;
    let directory = fs::read_to_string(root.join("current.txt")).ok()?;
    if directory == "."
        || directory == ".."
        || directory.is_empty()
        || !directory
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
    {
        return None;
    }
    let base = root.join(directory);
    ["x86_64", "aarch64"]
        .into_iter()
        .map(|arch| base.join(format!("codex-{arch}-pc-windows-msvc.exe")))
        .find(|p| complete_package(p))
}

/// A runnable --version alone cannot detect quarantined sandbox/search helpers.
fn complete_package(executable: &Path) -> bool {
    executable.is_file()
        && executable.parent().is_some_and(|base| {
            [
                "codex-package.json",
                "codex-resources/codex-command-runner.exe",
                "codex-resources/codex-windows-sandbox-setup.exe",
                "codex-path/rg.exe",
            ]
            .iter()
            .all(|file| base.join(file).is_file())
        })
}

pub fn install() -> Result<CodexStatus, String> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| "Codex 安装正在进行，请稍候")?;
    let (arch, digest) = match std::env::consts::ARCH {
        "x86_64" => (
            "x86_64",
            "191bd0dcd77a6aa17d4f8a4ab166fc9d05d24ca4b7015789e2aa9a53dcafb658",
        ),
        "aarch64" => (
            "aarch64",
            "af401c1c83a8d4005b0330eb180f42f6acf1954919da402ec73ada6f153c8192",
        ),
        _ => return Err("此 Codex 安装包支持 Windows x64 和 ARM64".into()),
    };
    let root = root()?;
    fs::create_dir_all(&root).map_err(|_| "无法创建 Codex 安装目录，请检查磁盘权限")?;
    let stage = tempfile::Builder::new()
        .prefix("download-")
        .tempdir_in(&root)
        .map_err(|_| "无法创建 Codex 下载目录")?;
    let asset = format!("codex-{arch}-pc-windows-msvc.exe.zip");
    let url = format!("https://github.com/openai/codex/releases/download/rust-v{VERSION}/{asset}");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .user_agent(concat!("Coding-Bro-Lite/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "无法初始化 Codex 下载")?;
    let mut response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Codex 下载失败，请检查 GitHub 网络连接后重试")?;
    let archive_path = stage.path().join("codex.zip");
    let mut archive = fs::File::create(&archive_path).map_err(|_| "无法保存 Codex 下载")?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|_| "Codex 下载中断，请重试")?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > 512 * 1024 * 1024 {
            return Err("Codex 下载文件大小异常".into());
        }
        hash.update(&buffer[..count]);
        archive
            .write_all(&buffer[..count])
            .map_err(|_| "磁盘空间不足或无法保存 Codex")?;
    }
    if format!("{:x}", hash.finalize()) != digest {
        return Err("Codex 下载校验失败，已保留原有版本，请重试".into());
    }
    drop(archive);
    let package = stage.path().join("package");
    fs::create_dir(&package).map_err(|_| "无法创建 Codex 解压目录")?;
    let mut zip =
        zip::ZipArchive::new(fs::File::open(&archive_path).map_err(|_| "无法读取 Codex 下载")?)
            .map_err(|_| "Codex 压缩包无效")?;
    let mut expanded = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| "无法读取 Codex 压缩包")?;
        let relative = entry.enclosed_name().ok_or("Codex 压缩包路径无效")?;
        if entry.is_symlink() {
            return Err("Codex 压缩包包含不支持的链接".into());
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > 2 * 1024 * 1024 * 1024 {
            return Err("Codex 解压大小异常".into());
        }
        let destination = package.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(destination).map_err(|_| "无法解压 Codex 目录")?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|_| "无法解压 Codex 目录")?;
            }
            let mut output = fs::File::create(destination).map_err(|_| "无法解压 Codex 文件")?;
            std::io::copy(&mut entry, &mut output).map_err(|_| "Codex 解压失败，请检查磁盘空间")?;
        }
    }
    let executable_name = format!("codex-{arch}-pc-windows-msvc.exe");
    if !complete_package(&package.join(&executable_name)) {
        return Err("Codex 安装包缺少运行组件".into());
    }
    let directory = format!("{VERSION}-{}", uuid::Uuid::new_v4());
    let destination = root.join(&directory);
    fs::rename(&package, &destination).map_err(|_| "无法保存 Codex 安装目录")?;
    // Validate in the final location before switching current.txt. This also
    // catches scanners blocking execution when the staged directory is moved.
    let status = codex_status_at(&destination.join(&executable_name));
    if !status.installed
        || status.version.as_deref() != Some(format!("codex-cli {VERSION}").as_str())
    {
        let _ = fs::remove_dir_all(&destination);
        return Err(
            "下载的 Codex 无法运行或版本不符，请检查 Windows 安全软件或系统兼容性；原有版本已保留"
                .into(),
        );
    }
    // Versioned directories avoid replacing an executable held open by Windows.
    // Publish only after successful validation; keep running/previous installs.
    let publish = (|| {
        let mut marker =
            tempfile::NamedTempFile::new_in(&root).map_err(|_| "无法写入 Codex 版本信息")?;
        marker
            .write_all(directory.as_bytes())
            .map_err(|_| "无法写入 Codex 版本信息")?;
        marker
            .as_file()
            .sync_all()
            .map_err(|_| "无法保存 Codex 版本信息")?;
        marker
            .persist(root.join("current.txt"))
            .map_err(|_| "无法激活 Codex 版本")?;
        Ok::<_, String>(())
    })();
    if let Err(error) = publish {
        let _ = fs::remove_dir_all(destination);
        return Err(error);
    }
    Ok(status)
}

/// npm versions use both the legacy vendor/codex and current vendor/bin layout.
pub fn native_npm_binary(shim: &Path) -> Option<PathBuf> {
    if !shim
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        return None;
    }
    let parent = shim.parent()?;
    for (package, target) in [
        ("codex-win32-x64", "x86_64-pc-windows-msvc"),
        ("codex-win32-arm64", "aarch64-pc-windows-msvc"),
    ] {
        for base in [
            parent.join(format!("node_modules/@openai/{package}")),
            parent
                .join("node_modules/@openai/codex/node_modules/@openai")
                .join(package),
            parent.join("node_modules/@openai/codex"),
        ] {
            for folder in ["bin", "codex"] {
                let candidate = base
                    .join("vendor")
                    .join(target)
                    .join(folder)
                    .join("codex.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Resolve the latest registered environment without mutating the GUI process.
/// Windows variable names are case insensitive; references may be nested.
fn expand_environment(
    value: &str,
    variables: &std::collections::BTreeMap<String, String>,
) -> String {
    let mut value = value.to_owned();
    for _ in 0..16 {
        let mut expanded = String::new();
        let mut rest = value.as_str();
        while let Some(start) = rest.find('%') {
            expanded.push_str(&rest[..start]);
            let after = &rest[start + 1..];
            let Some(end) = after.find('%') else {
                expanded.push_str(&rest[start..]);
                rest = "";
                break;
            };
            let reference = &rest[start..start + end + 2];
            let replacement = variables
                .get(&after[..end].to_ascii_uppercase())
                .map(String::as_str)
                .unwrap_or(reference);
            // Cyclic definitions must not grow without bound across passes.
            if expanded.len() + replacement.len() + after[end + 1..].len() > 32767 {
                return value;
            }
            expanded.push_str(replacement);
            rest = &after[end + 1..];
        }
        expanded.push_str(rest);
        if expanded == value {
            break;
        }
        value = expanded;
    }
    value
}

pub fn search_directories() -> Vec<PathBuf> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
        RegKey,
    };
    let mut variables: std::collections::BTreeMap<String, String> = std::env::vars_os()
        .filter_map(|(key, value)| {
            Some((
                key.into_string().ok()?.to_ascii_uppercase(),
                value.into_string().ok()?,
            ))
        })
        .collect();
    let inherited_path = std::env::var_os("PATH");
    let mut registered_paths = Vec::new();
    // User values override machine values; PATH itself concatenates both.
    for (hive, key) in [
        (
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
        (HKEY_CURRENT_USER, "Environment"),
    ] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(key) {
            for (name, _) in key.enum_values().filter_map(Result::ok) {
                if let Ok(value) = key.get_value::<String, _>(&name) {
                    if name.eq_ignore_ascii_case("PATH") {
                        registered_paths.push(value);
                    } else {
                        variables.insert(name.to_ascii_uppercase(), value);
                    }
                }
            }
        }
    }
    let mut directories = Vec::new();
    for path in registered_paths {
        directories.extend(std::env::split_paths(&expand_environment(
            &path, &variables,
        )));
    }
    // Preserve custom launch environments after the refreshed registered PATH.
    if let Some(path) = inherited_path {
        directories.extend(std::env::split_paths(&path));
    }
    for (key, suffix) in [
        ("APPDATA", "npm"),
        ("LOCALAPPDATA", "Microsoft/WinGet/Links"),
        ("LOCALAPPDATA", "Programs/nodejs"),
        ("LOCALAPPDATA", "Programs/OpenAI/Codex/bin"),
        ("PROGRAMFILES", "nodejs"),
        ("NVM_SYMLINK", ""),
        ("PNPM_HOME", ""),
        ("NPM_CONFIG_PREFIX", ""),
        ("CODEX_INSTALL_DIR", ""),
    ] {
        if let Some(value) = variables.get(key) {
            directories.push(PathBuf::from(expand_environment(value, &variables)).join(suffix));
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    directories
        .retain(|path| path.is_absolute() && seen.insert(path.to_string_lossy().to_lowercase()));
    directories
}

/// Older npm shims add vendor/<target>/path for ripgrep. Keep that contract
/// when invoking the native binary directly; current packages use codex-path.
pub fn command_path(executable: &Path) -> Option<std::ffi::OsString> {
    let mut directories = Vec::new();
    if let Some(parent) = executable.parent() {
        directories.push(parent.join("codex-path"));
        if let Some(root) = parent.parent() {
            directories.push(root.join("path"));
            directories.push(root.join("codex-path"));
        }
    }
    directories.retain(|path| path.is_dir());
    directories.extend(search_directories());
    std::env::join_paths(directories).ok()
}
