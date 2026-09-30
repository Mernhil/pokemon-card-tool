//! Auto-update: check GitHub Releases (tauri.conf.json -> plugins.updater),
//! download + verify the signed installer in the background, then let the
//! user choose when to install.
//!
//! The UI lives in the web app (apps/web/components/update-banner.tsx and
//! check-for-updates-button.tsx). It asks `update_status` on load and
//! listens for a `tcgvault:update-ready` DOM event we dispatch when a
//! download finishes; its "Restart & install" button calls `install_update`,
//! and a settings button calls `check_for_updates` to check right away
//! instead of waiting for the background loop. All three commands are
//! exposed to the local server's origin by
//! capabilities/local-app-updater.json. If the app's pages aren't up (the
//! server failed to start), a native dialog asks instead, so a broken
//! install can still receive the fix.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often to look for a new release while the app stays open.
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// First check shortly after launch, once the window is busy with other things.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(5);
/// How often the loop looks at the clock. Comparing wall-clock time (not one long sleep) means a
/// PC that slept through the interval checks again within a minute of waking.
const TICK: Duration = Duration::from_secs(60);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Default)]
pub struct UpdateState {
    /// A downloaded, signature-verified update waiting to be installed.
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    installing: AtomicBool,
    /// Set once the window shows the app (not the splash), i.e. the web UI
    /// is there to announce updates.
    pub ui_ready: AtomicBool,
    /// Unix seconds of the last check that reached the release server (0 = none yet).
    last_checked: AtomicU64,
    /// Unix seconds of the last attempt, successful or not: paces the loop so a failing
    /// network isn't retried every tick.
    last_attempt: AtomicU64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
}

impl UpdateInfo {
    fn of(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone().filter(|n| !n.trim().is_empty()),
        }
    }
}

/// Starts the background check loop. Call once from setup.
pub fn spawn_checks(handle: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let state = handle.state::<UpdateState>();
            let due = now_secs().saturating_sub(state.last_attempt.load(Ordering::SeqCst))
                >= CHECK_INTERVAL.as_secs();
            if due {
                state.last_attempt.store(now_secs(), Ordering::SeqCst);
                if let Err(err) = tauri::async_runtime::block_on(check_and_download(&handle)) {
                    eprintln!("[updater] {err}");
                }
            }
            std::thread::sleep(TICK);
        }
    });
}

fn updater(handle: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    #[allow(unused_mut)]
    let mut builder = handle.updater_builder();
    // Debug builds only: point at a local test release (see apps/desktop/README.md,
    // "Testing auto-update"). Release builds always use tauri.conf.json.
    #[cfg(debug_assertions)]
    {
        if let Ok(endpoint) = std::env::var("TCG_VAULT_UPDATE_ENDPOINT") {
            let url = endpoint.parse().map_err(|e| format!("bad endpoint: {e}"))?;
            builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
        }
        if let Ok(pubkey) = std::env::var("TCG_VAULT_UPDATE_PUBKEY") {
            builder = builder.pubkey(pubkey);
        }
    }
    builder.build().map_err(|e| e.to_string())
}

async fn check_and_download(handle: &AppHandle) -> Result<(), String> {
    let state = handle.state::<UpdateState>();
    if state.pending.lock().unwrap().is_some() {
        return Ok(()); // already downloaded; waiting for the user
    }

    state.last_attempt.store(now_secs(), Ordering::SeqCst);
    let checked = updater(handle)?
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?;
    state.last_checked.store(now_secs(), Ordering::SeqCst);
    announce_checked(handle);
    let Some(update) = checked else {
        return Ok(());
    };

    println!("[updater] downloading {}", update.version);
    // `download` verifies the signature against the pubkey before returning.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    let info = UpdateInfo::of(&update);
    *state.pending.lock().unwrap() = Some((update, bytes));
    println!("[updater] {} ready to install", info.version);
    announce(handle, &info);
    Ok(())
}

/// Lets the web UI refresh its "last checked" time.
fn announce_checked(handle: &AppHandle) {
    if handle.state::<UpdateState>().ui_ready.load(Ordering::SeqCst) {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.eval("window.dispatchEvent(new CustomEvent('tcgvault:update-checked'))");
        }
    }
}

/// Tells the web UI (or, without one, a native dialog) that an update is ready.
fn announce(handle: &AppHandle, info: &UpdateInfo) {
    let state = handle.state::<UpdateState>();
    if state.ui_ready.load(Ordering::SeqCst) {
        if let Some(window) = handle.get_webview_window("main") {
            let detail = serde_json::to_string(info).unwrap_or_else(|_| "null".into());
            let _ = window.eval(&format!(
                "window.dispatchEvent(new CustomEvent('tcgvault:update-ready', {{ detail: {detail} }}))"
            ));
            return;
        }
    }

    let accepted = handle
        .dialog()
        .message(format!(
            "TCG Vault {} is ready to install (you have {}). Install it now?",
            info.version, info.current_version
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart and install".into(),
            "Later".into(),
        ))
        .blocking_show();
    if accepted {
        if let Err(err) = install(handle) {
            handle
                .dialog()
                .message(format!("Update failed: {err}"))
                .title("TCG Vault")
                .buttons(MessageDialogButtons::Ok)
                .blocking_show();
        }
    }
}

fn install(handle: &AppHandle) -> Result<(), String> {
    let state = handle.state::<UpdateState>();
    if state.installing.swap(true, Ordering::SeqCst) {
        return Ok(()); // a second click while already installing
    }
    let Some((update, bytes)) = state.pending.lock().unwrap().take() else {
        state.installing.store(false, Ordering::SeqCst);
        return Err("no update is ready to install".into());
    };

    // On Windows `install` launches the installer and exits this process
    // without a RunEvent::Exit, so the server must be stopped first — so it
    // doesn't outlive us and the installer can overwrite node.exe. (macOS and
    // Linux replace files in place while they're in use; no need there.)
    #[cfg(windows)]
    {
        crate::stop_server(handle);
        // Killing the process doesn't mean Windows has released its file
        // handles yet (node.exe itself and the Prisma query engine DLL it
        // has loaded). The NSIS pre-install hook polls those exact files
        // before extracting, but giving the OS a head start here means it's
        // less likely to need the full poll.
        std::thread::sleep(Duration::from_millis(500));
    }

    if let Err(err) = update.install(&bytes) {
        // Put it back so the user can retry.
        *state.pending.lock().unwrap() = Some((update, bytes));
        state.installing.store(false, Ordering::SeqCst);
        return Err(format!("install failed: {err}"));
    }
    // macOS / Linux: installed in place; start the new version.
    handle.restart();
}

fn pending_info(state: &UpdateState) -> Option<UpdateInfo> {
    state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .map(|(update, _)| UpdateInfo::of(update))
}

/// For the web UI: the update waiting to be installed, if any.
#[tauri::command]
pub fn update_status(state: tauri::State<'_, UpdateState>) -> Option<UpdateInfo> {
    pending_info(&state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOverview {
    current_version: String,
    /// Unix seconds of the last successful check, if there was one this run.
    last_checked_at: Option<u64>,
    pending: Option<UpdateInfo>,
}

/// For the web UI's version / "last checked" lines and the sidebar's update dot.
#[tauri::command]
pub fn update_overview(handle: AppHandle, state: tauri::State<'_, UpdateState>) -> UpdateOverview {
    let last = state.last_checked.load(Ordering::SeqCst);
    UpdateOverview {
        current_version: handle.package_info().version.to_string(),
        last_checked_at: (last > 0).then_some(last),
        pending: pending_info(&state),
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CheckResult {
    UpToDate,
    Ready { info: UpdateInfo },
}

/// For the web UI's "Check for updates" button: runs a check right away
/// (rather than waiting for the background loop) and reports the outcome.
#[tauri::command]
pub async fn check_for_updates(handle: AppHandle) -> Result<CheckResult, String> {
    if let Some(info) = pending_info(&handle.state::<UpdateState>()) {
        return Ok(CheckResult::Ready { info });
    }
    check_and_download(&handle).await?;
    Ok(match pending_info(&handle.state::<UpdateState>()) {
        Some(info) => CheckResult::Ready { info },
        None => CheckResult::UpToDate,
    })
}

/// For the web UI's "Restart & install" button.
#[tauri::command]
pub fn install_update(handle: AppHandle) -> Result<(), String> {
    install(&handle)
}
