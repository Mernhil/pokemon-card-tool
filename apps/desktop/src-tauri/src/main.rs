// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewWindow};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod updater;

/// The Node sidecar running the bundled Next.js server. Held so it can be
/// killed when the app exits: Windows does *not* kill child processes along
/// with their parent, and an orphaned server from an older version used to
/// keep answering on the old fixed port with pages whose JS/CSS chunks the
/// newly installed version had already replaced — every page then died with
/// "Application error: a client-side exception has occurred".
struct Server(Mutex<Option<CommandChild>>);

/// Windows: put the server in a job object that is killed when this process
/// ends — however it ends (closed, crashed, killed in Task Manager, or the
/// installer force-closing it). The job handle is deliberately never closed:
/// the OS closes it when we exit, which is what triggers the kill.
#[cfg(windows)]
fn kill_with_this_process(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            eprintln!("[server] CreateJobObjectW failed");
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            eprintln!("[server] SetInformationJobObject failed");
            CloseHandle(job);
            return;
        }
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            eprintln!("[server] OpenProcess({pid}) failed");
            CloseHandle(job);
            return;
        }
        if AssignProcessToJobObject(job, process) == 0 {
            eprintln!("[server] AssignProcessToJobObject failed");
        }
        CloseHandle(process);
    }
}

#[cfg(not(windows))]
fn kill_with_this_process(_pid: u32) {
    // Elsewhere the shell's exit handler plus the server's own parent-PID
    // watchdog (apps/web/lib/parent-watchdog.ts) cover it.
}

fn stop_server(handle: &AppHandle) {
    if let Some(child) = handle.state::<Server>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// A port nothing is listening on right now. Picked fresh every launch so a
/// stray server (another app, or an old TCG Vault) can never be mistaken for ours.
fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(47823)
}

/// Replaces the splash screen's text with an error (see scripts/prepare-resources.mjs).
fn show_error(window: &WebviewWindow, message: &str) {
    let js = format!(
        "window.showStartupError && window.showStartupError({})",
        serde_json::to_string(message).unwrap_or_else(|_| "\"\"".into())
    );
    let _ = window.eval(&js);
}

/// Opens an http(s) link in the default browser. The webview itself can't: it blocks
/// `target="_blank"` popups, and navigating it would replace the app.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) links can be opened".into());
    }
    // The OS opener directly (no shell parsing, so "&" in a URL is safe) rather than the shell
    // plugin, whose open scope can refuse links.
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(parsed.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// TCG Vault has no separate backend process to install or configure: the
/// Next.js standalone server (built by apps/web, bundled as a resource) is
/// spawned as a sidecar under a portable Node runtime. The window starts on
/// a local "Starting…" splash (build.frontendDist) and is navigated to the
/// server once it's accepting connections. See apps/desktop/README.md for how
/// the resources/binaries get into src-tauri/ before `tauri build` runs.
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Server(Mutex::new(None)))
        .manage(updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            updater::update_status,
            updater::install_update,
            updater::check_for_updates,
            open_external
        ])
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
            let log_path: PathBuf = app_data_dir.join("server.log");

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

            let port = free_port();

            let sidecar = handle
                .shell()
                .sidecar("node")
                .expect("the `node` sidecar binary must be at src-tauri/binaries/ — see apps/desktop/README.md")
                .args([server_js.to_string_lossy().to_string()])
                .env("PORT", port.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .env("DATABASE_URL", database_url)
                .env("MEDIA_DIR", media_dir)
                // Image cache + secrets.json (API keys) live here, never in the install dir.
                .env("TCG_VAULT_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                .env("TCG_VAULT_DESKTOP", "1")
                // Lets the server exit on its own if this process dies without
                // killing it (apps/web/lib/parent-watchdog.ts).
                .env("TCG_VAULT_PARENT_PID", std::process::id().to_string())
                .env("MIGRATIONS_DIR", migrations_dir.to_string_lossy().to_string());

            let window = handle
                .get_webview_window("main")
                .expect("tauri.conf.json defines the main window");

            let (mut rx, child) = match sidecar.spawn() {
                Ok(spawned) => spawned,
                Err(err) => {
                    show_error(&window, &format!("Couldn't start the local server: {err}"));
                    return Ok(());
                }
            };
            kill_with_this_process(child.pid());
            *handle.state::<Server>().0.lock().unwrap() = Some(child);

            updater::spawn_checks(handle.clone());

            // Server output goes to <app data>/server.log (truncated each launch)
            // so a failed start can be diagnosed on a machine without devtools.
            let exited = Arc::new(AtomicBool::new(false));
            {
                let exited = exited.clone();
                let window = window.clone();
                let log_path = log_path.clone();
                tauri::async_runtime::spawn(async move {
                    let mut log = OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(&log_path)
                        .ok();
                    while let Some(event) = rx.recv().await {
                        let line = match event {
                            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                                String::from_utf8_lossy(&line).trim_end().to_string()
                            }
                            CommandEvent::Error(err) => format!("[shell] error: {err}"),
                            CommandEvent::Terminated(payload) => {
                                exited.store(true, Ordering::SeqCst);
                                format!("[shell] server exited with code {:?}", payload.code)
                            }
                            _ => continue,
                        };
                        eprintln!("[server] {line}");
                        if let Some(file) = log.as_mut() {
                            let _ = writeln!(file, "{line}");
                        }
                        if exited.load(Ordering::SeqCst) {
                            show_error(
                                &window,
                                &format!(
                                    "The local server stopped unexpectedly. Details are in {}",
                                    log_path.display()
                                ),
                            );
                        }
                    }
                });
            }

            // Wait until the server accepts connections, then leave the splash.
            std::thread::spawn(move || {
                for _ in 0..400 {
                    if exited.load(Ordering::SeqCst) {
                        return;
                    }
                    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                        let url = Url::parse(&format!("http://127.0.0.1:{port}/browse"))
                            .expect("static URL is valid");
                        match window.navigate(url) {
                            Ok(()) => window
                                .state::<updater::UpdateState>()
                                .ui_ready
                                .store(true, Ordering::SeqCst),
                            Err(err) => {
                                show_error(&window, &format!("Couldn't open the app: {err}"))
                            }
                        }
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                show_error(
                    &window,
                    &format!(
                        "The local server didn't start within a minute. Details are in {}",
                        log_path.display()
                    ),
                );
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the TCG Vault desktop shell");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(handle);
        }
    });
}
