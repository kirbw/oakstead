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

For LAN access, keep `OAKSTEAD_DEFAULT_HOST=0.0.0.0` or set the same value from School Setup -> Network Access and restart the service. Keep Oakstead behind a trusted LAN, VPN, or protective reverse proxy.
