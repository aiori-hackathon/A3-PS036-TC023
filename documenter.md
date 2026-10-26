# Code Changes Documentation (`documenter.md`)

This document records all modifications made to the repository to enable **Cloudflare Tunnel (`cloudflared`)** for secure, zero-trust remote hosting on a Proxmox VM.

If you ever wish to revert these changes to test a different hosting approach (such as Direct Static Public IP exposure, Nginx reverse proxy, or VPN/WireGuard), use this document as an exact reversion guide.

---

## Change 1: Restrict Workbench UI Binding to Localhost

### Target File
- [`src/docker-compose.yml`](docker-compose.yml#L88-L89)

### Previous Snippet
```yaml
  ui:
    build: { context: ., dockerfile: docker/ui/Dockerfile }
    image: pqcmtl/ui:latest
    container_name: pqcmtl-ui
    restart: unless-stopped
    ports:
      - "8080:8080"
```

### Current Snippet
```yaml
  ui:
    build: { context: ., dockerfile: docker/ui/Dockerfile }
    image: pqcmtl/ui:latest
    container_name: pqcmtl-ui
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
```

### Reason for Change
- **Security & Port Cloaking**: Binding port `8080` to `0.0.0.0` (default) exposed the Workbench UI (and its root PTY WebSocket terminal) to all external interfaces, meaning anyone port-scanning your static public IP could directly access the terminal.
- Binding to `127.0.0.1:8080:8080` ensures the service only listens on the loopback interface inside the VM. Only local processes on the VM (specifically `cloudflared`) can communicate with it.

### How to Revert
If you decide to host via direct IP without Cloudflare:
Change `127.0.0.1:8080:8080` back to `8080:8080`.

---

## Change 2: Cloudflare Tunnel Helper Script

### Target File
- [`src/run_tunnel.sh`](run_tunnel.sh) *(New File)*

### Previous Snippet
*(File did not exist)*

### Current Snippet
```bash
#!/usr/bin/env bash
# ==============================================================================
# PS-036: PQC DNSSEC MTL Benchmark Testbed
# Cloudflare Tunnel Launcher for Zero-Trust Remote Hosting
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")"

# 1. Checks if cloudflared is installed; prints install instructions if missing
# 2. Verifies Workbench UI is responsive; starts it if needed
# 3. Executes: exec cloudflared tunnel --url http://127.0.0.1:8080
```

### Reason for Change
- Automates launching the Cloudflare Quick Tunnel.
- Eliminates manual typing of long tunnel flags.
- Validates that the local UI is running before initiating the tunnel.

### How to Revert
Delete the file:
```bash
rm src/run_tunnel.sh
```

---

## Change 3: Helper Command in `tb.sh`

### Target File
- [`src/tb.sh`](tb.sh#L167-L168)

### Previous Snippet
```bash
  ./tb.sh up                         start root, tld-lab, sld-aiori, resolver, client
  ./tb.sh ui                         start containerized Workbench UI (port 8080)
  ./tb.sh test                       dig + dig +trace + PQC chain validation from the client
```

### Current Snippet
```bash
  ./tb.sh up                         start root, tld-lab, sld-aiori, resolver, client
  ./tb.sh ui                         start containerized Workbench UI (port 8080)
  ./run_tunnel.sh                    start Cloudflare Quick Tunnel (public HTTPS access)
  ./tb.sh test                       dig + dig +trace + PQC chain validation from the client
```

### Reason for Change
- Documents the tunnel launcher command inside `./tb.sh help` so evaluators and operators can easily discover it.

### How to Revert
Remove the `./run_tunnel.sh` line from `cmd_help()` in `src/tb.sh`.

---

## Summary of Reversion Command

To revert everything back to the exact initial state in one shell command:
```bash
git checkout src/docker-compose.yml src/tb.sh && rm -f src/run_tunnel.sh documenter.md
```
