# Oakstead Windows Packaging

This packaging path creates an installer that runs Oakstead as a Windows service and stores school data in `%ProgramData%\Oakstead`.

## Required local vendor files

Place these files before running the packaging prep script:

- `packaging/windows/vendor/node/` containing the Windows x64 Node.js runtime (version 22.13 or newer; Oakstead uses the built-in `node:sqlite` module, which requires no flag as of 22.13), including `node.exe`.
- `packaging/windows/vendor/winsw/Oakstead.Service.exe`, a renamed WinSW x64 service wrapper executable.

These binaries are intentionally not committed to the repo.

## Build

```powershell
npm run prepare:windows
iscc packaging\windows\Oakstead.iss /DAppVersion=0.0.10
```

The installer output is written to `dist/windows/installer/Oakstead-Setup-v0.0.10.exe`.

## First Windows build checklist

1. Build from a clean release branch or tag after running `npm run check`.
2. Install Inno Setup 6 on the Windows build machine and make sure `iscc.exe` is available from PowerShell.
3. Download a supported Windows x64 Node.js runtime zip (version 22.13 or newer) and copy its extracted contents into `packaging/windows/vendor/node/` so `packaging/windows/vendor/node/node.exe` exists.
4. Download the WinSW x64 executable, rename it to `Oakstead.Service.exe`, and place it at `packaging/windows/vendor/winsw/Oakstead.Service.exe`.
5. Run `npm run prepare:windows` from the repository root. The script stages app files, runtime binaries, service files, and shortcuts under `dist/windows/`.
6. Run `iscc packaging\windows\Oakstead.iss /DAppVersion=0.0.10` to compile the installer.
7. Test the generated installer on a disposable Windows machine or VM. Confirm the Oakstead service installs, starts, opens at `http://127.0.0.1:3000`, writes data under `%ProgramData%\Oakstead`, and can survive a reboot.
8. Publish the installer as a GitHub Release asset named `Oakstead-Setup-v0.0.10.exe` so packaged installs can find future installer updates.

## Runtime behavior

- App binaries install under `Program Files\Oakstead`.
- Data, uploads, backups, and service logs live under `%ProgramData%\Oakstead`.
- The service runs with `OAKSTEAD_UPDATE_MODE=installer`, so the in-app updater checks GitHub release assets instead of running Git commands.
- The service default bind host is `0.0.0.0`, which enables LAN access. Admins can switch back to local-only from School Setup -> Network Access.
- The installer can add a Windows Firewall rule for TCP port 3000.
