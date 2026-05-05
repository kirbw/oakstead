# Oakstead Windows Packaging

This packaging path creates an installer that runs Oakstead as a Windows service and stores school data in `%ProgramData%\Oakstead`.

## Required local vendor files

Place these files before running the packaging prep script:

- `packaging/windows/vendor/node/` containing the Windows x64 Node.js runtime, including `node.exe`.
- `packaging/windows/vendor/sqlite/` containing `sqlite3.exe` from the SQLite Windows tools bundle.
- `packaging/windows/vendor/winsw/Oakstead.Service.exe`, a renamed WinSW x64 service wrapper executable.

These binaries are intentionally not committed to the repo.

## Build

```powershell
npm run prepare:windows
iscc packaging\windows\Oakstead.iss /DAppVersion=0.0.6
```

The installer output is written to `dist/windows/installer/Oakstead-Setup-v0.0.6.exe`.

## Runtime behavior

- App binaries install under `Program Files\Oakstead`.
- Data, uploads, backups, and service logs live under `%ProgramData%\Oakstead`.
- The service runs with `OAKSTEAD_UPDATE_MODE=installer`, so the in-app updater checks GitHub release assets instead of running Git commands.
- The service default bind host is `0.0.0.0`, which enables LAN access. Admins can switch back to local-only from School Setup -> Network Access.
- The installer can add a Windows Firewall rule for TCP port 3000.
