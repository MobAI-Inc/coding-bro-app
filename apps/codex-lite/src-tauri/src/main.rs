#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launcher;
mod model_catalog;
mod policy;
#[cfg(target_os = "windows")]
mod windows_process;
#[cfg(target_os = "windows")]
mod windows_tools;

use tauri::Manager;

#[tauri::command]
async fn select_codex_directory(directory: String) -> Result<launcher::CodexStatus, String> {
    tauri::async_runtime::spawn_blocking(move || launcher::select_directory(directory))
        .await
        .map_err(|_| "Codex 检测失败")?
}

#[tauri::command]
async fn get_codex_status() -> launcher::CodexStatus {
    tauri::async_runtime::spawn_blocking(launcher::codex_status)
        .await
        .unwrap_or_else(|_| launcher::CodexStatus::unavailable())
}

#[tauri::command]
async fn install_codex() -> Result<launcher::CodexStatus, String> {
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(windows_tools::install)
        .await
        .map_err(|_| "Codex 安装任务失败".to_string())?;
    #[cfg(not(target_os = "windows"))]
    Err("请使用官方 Codex CLI 安装方式".into())
}

#[tauri::command]
async fn launch_codex(
    app: tauri::AppHandle,
    directory: String,
    model_id: String,
    launch_mode: String,
    api_base_url: String,
    access_token: String,
    gateway_credential: Option<policy::GatewayCredential>,
) -> Result<(), String> {
    if launch_mode != "cli" && launch_mode != "desktop" {
        return Err("进入方式无效".into());
    }
    let executable = tauri::async_runtime::spawn_blocking(launcher::find_codex)
        .await
        .map_err(|_| "Codex 检测任务失败")?
        .ok_or("请先在项目页面安装或修复 Codex CLI")?;
    let directory = if directory.trim().is_empty() {
        dirs::home_dir().ok_or("无法读取默认项目目录")?
    } else {
        launcher::validate_directory(&directory)?
    };
    let credential =
        policy::authorize_launch(&api_base_url, &access_token, &model_id, gateway_credential)
            .await?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法读取 Lite 数据目录")?;
    tauri::async_runtime::spawn_blocking(move || {
        launcher::launch(
            executable,
            directory,
            model_id,
            data_dir,
            credential,
            launch_mode == "desktop",
        )
    })
    .await
    .map_err(|_| "Codex 启动任务失败".to_string())?
}

fn main() {
    // The terminal child uses a one-time loopback handoff before loading Tauri.
    // API credentials remain in memory and in the Codex child environment.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--codex-lite-run") {
        let result = launcher::run_terminal_child(&args[2..]);
        if let Err(error) = result {
            #[cfg(target_os = "windows")]
            launcher::show_terminal_error(&error);
            #[cfg(not(target_os = "windows"))]
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    let builder = tauri::Builder::default();
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_codex_status,
            select_codex_directory,
            install_codex,
            launch_codex
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Coding Bro Lite");
}
