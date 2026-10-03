#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Sidecar(Mutex<Option<Child>>);

/// Packaged layout (see tauri.conf.json bundle.resources):
///   <resourceDir>/sidecar/sidecar.cjs + node(.exe) + node_modules/
fn sidecar_paths(app: &tauri::AppHandle) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let dir = app.path().resource_dir().ok()?.join("sidecar");
    #[cfg(target_os = "windows")]
    let node = dir.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let node = dir.join("node");
    let script = dir.join("sidecar.cjs");
    Some((node, script))
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<Sidecar>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            if let Some((node, script)) = sidecar_paths(app.handle()) {
                if node.exists() && script.exists() {
                    match Command::new(&node).arg(&script).spawn() {
                        Ok(child) => {
                            *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
                        }
                        Err(e) => eprintln!("[nexus] sidecar spawn failed: {e}"),
                    }
                } else {
                    eprintln!("[nexus] sidecar files missing; UI will run disconnected");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if app.webview_windows().is_empty() {
                    stop_sidecar(&app);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nexus Agents");
}
