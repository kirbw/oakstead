# Installing Oakstead

This guide covers source-based Windows or Linux deployments. If you only want to see what Oakstead does, start with the [public demo](https://demo.oakstead.school).

> [!NOTE]
> Oakstead does not currently publish a tested Windows installer. Windows packaging support is still under development, so current Windows and Linux installations run from source.

## Source installation

Use a source installation when running Oakstead on Linux, developing the project, or managing the Node.js service yourself.

#### Requirements

- Node.js **22.13 or newer** with npm available. Node.js 24 or newer is also supported.
- A writable runtime data directory for `school.db`, `backups/`, uploads, `.oakstead-update-status.json`, and custom school assets.
- Git in `PATH` if you want source installations to use Oakstead's in-app system updater.
- A trusted local network, VPN, or protective reverse proxy. Oakstead should not be exposed directly to the public internet.

Oakstead uses Node's built-in `node:sqlite` module. A separate SQLite command-line tool or database server is not required.

Clone the repository and start Oakstead:

```bash
git clone https://github.com/kirbw/oakstead.git
cd oakstead
npm install
npm start
```

Open `http://localhost:3000`.

## First login

The initial administrator account is:

```text
Username: admin
Password: ChangeMeNow!
```

Change this password immediately, before entering real family or student data.

## Configuration

Oakstead reads settings from a local `.env` file when one is present. A minimal source-install example is:

```dotenv
PORT=3000
OAKSTEAD_DATA_DIR=/srv/oakstead
```

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port. Defaults to `3000`. |
| `HOST` | Explicit bind host. Use `127.0.0.1` for local-only access or `0.0.0.0` for LAN access. This overrides the saved Network Access setting. |
| `OAKSTEAD_DEFAULT_HOST` | Default bind host when `HOST` is unset. Defaults to `127.0.0.1`. |
| `OAKSTEAD_DEFAULT_PORT` | Default port when `PORT` is unset. Defaults to `3000`. |
| `OAKSTEAD_DATA_DIR` | Directory for the database, backups, uploads, and update status. Source installs default to the project directory. |
| `DB_FILE` | SQLite database path. Defaults to `school.db` inside `OAKSTEAD_DATA_DIR`. |
| `OAKSTEAD_UPDATE_MODE` | Update strategy. Current source installations use `git`, which is the default. |
| `DEMO_MODE` | Enables a disposable public demo and disables authentication. Never enable it for real school data. |
| `DEMO_REFRESH_HOURS` | Demo reset interval from 1 to 24 hours. Defaults to `2`. |

## Network access and security

Oakstead defaults to local-only access. Administrators can use **School Setup → Network Access** to choose:

- **Local only:** binds to `127.0.0.1`; only the host computer can open Oakstead.
- **Trusted LAN:** binds to `0.0.0.0`; other devices use the host IP address shown in Oakstead.

On a headless Linux server, change the saved network mode from the command line:

```bash
sudo systemctl stop oakstead
sudo -u oakstead env OAKSTEAD_DATA_DIR=/var/lib/oakstead node /opt/oakstead/server.js --set-network-access lan
sudo systemctl restart oakstead
```

Use `--set-network-access local` to return to local-only mode, or `--network-status` to print the saved mode and next-start URLs. Setting `HOST=0.0.0.0` in the service environment temporarily overrides the saved setting.

Oakstead stores sensitive student and family information. If it must be reachable beyond a trusted network or VPN, put it behind HTTPS and a protective edge such as Cloudflare, a web application firewall, or an equivalent reverse proxy with rate limiting, request filtering, and access controls.

For production source installs, run Oakstead under a supervisor such as systemd or pm2 so it starts after reboots and can restart after updates. See the included [Linux deployment examples](../packaging/linux/README.md).

## Data and backups

The primary database is `school.db` inside the configured data directory. SQLite runs in WAL mode, so copying only `school.db` while Oakstead is running can miss recent writes.

Use **School Setup → Backups** to create and download a consistent backup. If you must copy the database manually, stop Oakstead first. Keep an external backup of the database, `backups/`, uploaded assets, and any custom school branding before server maintenance or upgrades.

## System updates

Administrators can update Oakstead from **School Setup → System Updates** and choose the current release or a pre-release channel.

Source installs use `OAKSTEAD_UPDATE_MODE=git`. Oakstead fetches tags from the configured `origin`, checks out the selected release, runs `npm install`, validates the server, and restarts the app.

Commit or remove local source changes before using the in-app updater. Oakstead creates a database backup during updates, but that does not replace an external backup plan.

## Demo data

To create disposable sample records in a non-production database, run:

```bash
node scripts/seed-demo.js --reset
```

To run a public disposable demo, explicitly set `DEMO_MODE=1`. Demo mode treats every visitor as an administrator and disables authentication. Never enable it on an installation that contains real records.

## Validation

Check the server syntax after installation or configuration changes:

```bash
npm run check
```

Developers working on the extracted server helpers can also run:

```bash
npm run test:refactor
```

## Platform-specific details

- [Linux systemd deployment](../packaging/linux/README.md)
- [Release notes](../RELEASE_NOTES.md)
