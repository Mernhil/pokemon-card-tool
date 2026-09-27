// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::time::Duration;
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 47823;

/// TCG Vault has no separate backend process to install or configure: the
/// Next.js standalone server (built by apps/web, bundled as a resource) is
/// spawned as a sidecar under a portable Node runtime, and the window just
/// points at http://127.0.0.1:PORT. See apps/desktop/README.md for how the
/// resources/binaries get into src-tauri/ before `tauri build` runs.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let app_data_dir = handle
                .path()
                .app_data_dir()
                .expect("app data dir should resolve on every desktop OS");
            std::fs::create_dir_all(&app_data_dir).ok();

            let database_url = format!(
                "file:{}",
                app_data_dir.join("local.db").to_string_lossy()
            );
            let media_dir = app_data_dir.join("media").to_string_lossy().to_string();
            std::fs::create_dir_all(&media_dir).ok();

            let server_js = handle
                .path()
                .resolve("web/apps/web/server.js", tauri::path::BaseDirectory::Resource)
                .expect("bundled server.js resource should exist — see apps/desktop/README.md");
            let migrations_dir = handle
                .path()
                .resolve(
                    "web/packages/db/prisma/migrations",
                    tauri::path::BaseDirectory::Resource,
                )
                .expect("bundled migrations resource should exist — see apps/desktop/README.md");

            let sidecar = handle
                .shell()
                .sidecar("node")
                .expect("the `node` sidecar binary must be at src-tauri/binaries/ — see apps/desktop/README.md")
                .args([server_js.to_string_lossy().to_string()])
                .env("PORT", PORT.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("DATABASE_URL", database_url)
                .env("MEDIA_DIR", media_dir)
                .env("TCG_VAULT_DESKTOP", "1")
                .env("MIGRATIONS_DIR", migrations_dir.to_string_lossy().to_string());

            let (mut rx, _child) = sidecar.spawn().expect("failed to spawn the local server");

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stderr(line) => {
                            eprintln!("[server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stdout(line) => {
                            println!("[server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[server] error: {err}");
                        }
                        _ => {}
                    }
                }
            });

            // The window is created pointing at 127.0.0.1:PORT immediately, but the
            // server needs a moment to boot; poll until it's actually accepting
            // connections before showing the window, so the user never sees a
            // browser-style connection-refused error flash by.
            if let Some(window) = handle.get_webview_window("main") {
                let window = window.clone();
                std::thread::spawn(move || {
                    for _ in 0..100 {
                        if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                            let _ = window.show();
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(150));
                    }
                    // Show it anyway after ~15s so the user at least sees an error
                    // instead of a permanently invisible app.
                    let _ = window.show();
                });
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let WindowEvent::Destroyed = event {
                // The sidecar is a child process of this one and Tauri/the OS
                // clean it up on exit; nothing else to do here.
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the TCG Vault desktop shell");
}
