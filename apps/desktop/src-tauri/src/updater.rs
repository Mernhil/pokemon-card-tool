//! Auto-update: check GitHub Releases (tauri.conf.json -> plugins.updater),
//! download + verify the signed installer in the background, then let the
//! user choose when to install.
//!
//! The UI lives in the web app (apps/web/components/update-banner.tsx). It
//! asks `update_status` on load and listens for a `tcgvault:update-ready`
//! DOM event we dispatch when a download finishes; its "Restart & install"
//! button calls `install_update`. Both commands are exposed to the local
//! server's origin by capabilities/local-app-updater.json. If the app's pages
//! aren't up (the server failed to start), a native dialog asks instead, so a
//! broken install can still receive the fix.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often to look for a new release while the app stays open.
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// First check shortly after launch, once the window is busy with other things.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct UpdateState {
    /// A downloaded, signature-verified update waiting to be installed.
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    installing: AtomicBool,
    /// Set once the window shows the app (not the splash), i.e. the web UI
    /// is there to announce updates.
    pub ui_ready: AtomicBool,
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
            if let Err(err) = tauri::async_runtime::block_on(check_and_download(&handle)) {
                eprintln!("[updater] {err}");
            }
            std::thread::sleep(CHECK_INTERVAL);
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

    let Some(update) = updater(handle)?
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?
    else {
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
    crate::stop_server(handle);

    if let Err(err) = update.install(&bytes) {
        // Put it back so the user can retry.
        *state.pending.lock().unwrap() = Some((update, bytes));
        state.installing.store(false, Ordering::SeqCst);
        return Err(format!("install failed: {err}"));
    }
    // macOS / Linux: installed in place; start the new version.
    handle.restart();
}

/// For the web UI: the update waiting to be installed, if any.
#[tauri::command]
pub fn update_status(state: tauri::State<'_, UpdateState>) -> Option<UpdateInfo> {
    state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .map(|(update, _)| UpdateInfo::of(update))
}

/// For the web UI's "Restart & install" button.
#[tauri::command]
pub fn install_update(handle: AppHandle) -> Result<(), String> {
    install(&handle)
}
