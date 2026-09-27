fn main() {
    // App commands callable from the web UI; tauri-build generates
    // `allow-<command>` permissions for them, granted to the local server's
    // origin in capabilities/local-app-updater.json.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["update_status", "install_update"]),
    ))
    .expect("failed to run tauri-build");
}
