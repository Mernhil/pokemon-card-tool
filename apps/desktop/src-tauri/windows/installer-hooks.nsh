; Tauri NSIS installer hooks (tauri.conf.json -> bundle.windows.nsis.installerHooks).
;
; Before files are copied, stop any TCG Vault server (the bundled node.exe)
; still running from this install directory. Versions up to 0.1.4 left it
; running after the app closed, which both made the installer fail to
; overwrite node.exe ("Error opening file for writing") and kept serving the
; old version's pages to the new app. Only node.exe processes whose path is
; inside $INSTDIR are touched, never other Node programs.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  Sleep 500
!macroend

; Same on uninstall, so the files can be removed.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  Sleep 500
!macroend
