; Tauri NSIS installer hooks (tauri.conf.json -> bundle.windows.nsis.installerHooks).
;
; Tauri's template runs NSIS_HOOK_PREINSTALL *before* its own "is the app
; running?" check, which force-kills only tcg-vault-desktop.exe. Killing
; the app that way used to leave its server (the bundled node.exe) running
; and holding files open, so extraction failed with "Error opening file for
; writing" on node.exe / the Prisma engine DLL. So this hook does the whole
; job itself, in order, and waits until it's done:
;   1. the app and its whole process tree (taskkill /T),
;   2. any node.exe still running from this install directory — orphans from
;      versions <= 0.1.4, which never stopped their server. Only processes
;      whose path is inside $INSTDIR are touched, never other Node programs.
; 0.1.6+ also ties the server to the app with a Windows job object, so this
; is mostly a safety net from then on.
;
; NSIS_HOOK_PREINSTALL also wipes $INSTDIR\web (tauri.conf.json's
; bundle.resources maps resources/web -> web) before extraction. NSIS only
; ever adds/overwrites files on an upgrade; it never removes ones that
; existed in an older version but not the new one, so the Next.js build's
; content-hashed JS/CSS chunks (and anything else dropped from a later
; release) used to accumulate forever. Deleting the whole tree first makes
; every install start clean; the app itself is never taken from here (it's
; installed under $INSTDIR directly), so nothing but bundled web assets is
; touched.
;
; NSIS_HOOK_POSTINSTALL notifies the shell that the exe (and therefore its
; icon) changed. Windows caches shell icons per file; overwriting
; tcg-vault-desktop.exe in place (as every update does) can leave the
; taskbar/desktop shortcut showing a stale or generic icon until Explorer's
; icon cache is invalidated.

!macro TCGV_STOP_RUNNING
  nsExec::Exec `taskkill /F /T /IM tcg-vault-desktop.exe`
  Pop $0

  StrCpy $1 0
  tcgv_stop_loop:
    ; Exit code = how many node.exe from $INSTDIR are still alive afterwards.
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$p = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'OrdinalIgnoreCase') }; $$p | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; exit @(Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'OrdinalIgnoreCase') }).Count"`
    Pop $0
    StrCmp $0 "0" tcgv_stop_done
    StrCmp $0 "error" tcgv_stop_done ; PowerShell unavailable: let the installer's own retry prompt handle it
    IntOp $1 $1 + 1
    IntCmp $1 10 tcgv_stop_done
    Sleep 500
    Goto tcgv_stop_loop
  tcgv_stop_done:
  ; Give Windows a moment to release file handles of the killed processes.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TCGV_STOP_RUNNING

  IfFileExists "$INSTDIR\web\*.*" 0 tcgv_no_stale_web
    RMDir /r "$INSTDIR\web"
  tcgv_no_stale_web:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TCGV_STOP_RUNNING
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; SHCNE_ASSOCCHANGED + SHCNF_IDLIST: broadcast that file associations/icons
  ; changed, forcing Explorer to drop its cached icon for the exe we just
  ; overwrote instead of continuing to show the previous (or default) one.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, i 0, i 0)'
!macroend
