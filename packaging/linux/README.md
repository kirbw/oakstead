# Oakstead Linux Service

This example keeps Linux/source deployments on the Git-based update path while using the same cross-platform runtime settings as the Windows installer.

## Layout

- App checkout: `/opt/oakstead`
- Data directory: `/var/lib/oakstead`
- Environment file: `/etc/oakstead/oakstead.env`
- Service unit: `/etc/systemd/system/oakstead.service`

## Install sketch

```bash
sudo useradd --system --home /var/lib/oakstead --shell /usr/sbin/nologin oakstead
sudo mkdir -p /opt/oakstead /var/lib/oakstead /etc/oakstead
sudo chown -R oakstead:oakstead /var/lib/oakstead
sudo cp packaging/linux/oakstead.env.example /etc/oakstead/oakstead.env
sudo cp packaging/linux/oakstead.service /etc/systemd/system/oakstead.service
sudo systemctl daemon-reload
sudo systemctl enable --now oakstead
```

For LAN access on a fresh database, keep `OAKSTEAD_DEFAULT_HOST=0.0.0.0`. After the database exists, the saved Network Access setting wins unless `HOST` is set. Admins can change it from School Setup -> Network Access, or from SSH on a headless server:

```bash
sudo systemctl stop oakstead
sudo -u oakstead env OAKSTEAD_DATA_DIR=/var/lib/oakstead node /opt/oakstead/server.js --set-network-access lan
sudo systemctl restart oakstead
```

Use `--set-network-access local` to switch back to local-only mode, or `--network-status` to print the saved and next-start URLs. If you need an immediate environment override, add `HOST=0.0.0.0` to `/etc/oakstead/oakstead.env` and restart the service; the in-app Network Access form remains read-only while `HOST` is set. Keep Oakstead behind a trusted LAN, VPN, or protective reverse proxy.
