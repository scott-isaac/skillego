# Deploying Skillego Multiplayer Server

## Architecture

```
GitHub Pages                     Cloudflare Tunnel              Your PC (WSL2)
(public client)                  (hidden proxy)                 (Docker)
+-----------------------+  wss   +-------------------------+    +------------------+
| yourusername.github.io| -----> | skillego.yourdomain.com | -> | skillego-server  |
| /skillego             |        | (not public-facing)     |    | container :3000  |
| (HTML/JS/CSS)         |        |                         |    | (WebSocket only) |
+-----------------------+        +-------------------------+    +------------------+

Players visit GitHub Pages. Multiplayer traffic routes silently
through Cloudflare to the Docker container. Your domain stays hidden.
```

## Setup on Home PC (WSL2)

### 1. Pull the repo

```bash
cd /path/to/skillego
git pull
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env:
#   ALLOWED_ORIGINS=https://yourusername.github.io
```

### 3. Build and run

```bash
docker compose up -d --build
```

The server runs on port 3000.
It's WebSocket-only — no HTML served. Verify with:
```bash
curl http://localhost:3000/socket.io/?EIO=4&transport=polling
# Should return a 200 with a JSON-ish body (socket.io handshake)
```

### 4. Expose via Cloudflare Tunnel

Add Skillego to your `cloudflared` tunnel config
(check `~/.cloudflared/config.yml` or `/etc/cloudflared/config.yml`):

```yaml
ingress:
  # Your existing rules...

  # Skillego multiplayer backend
  - hostname: skillego.yourdomain.com
    service: http://localhost:3000

  - service: http_status:404
```

Then in the Cloudflare dashboard, add a CNAME DNS record:
- Name: `skillego` (or whatever subdomain you chose)
- Target: `<your-tunnel-id>.cfargotunnel.com`
- Proxy: enabled (orange cloud)

### 5. Restart the tunnel

```bash
sudo systemctl restart cloudflared
```

**Note:** If cloudflared runs as a service, make sure the service config
points to the right file (e.g. `/etc/cloudflared/config.yml`).

### 6. Configure GitHub Actions

In your repo on GitHub, go to **Settings > Secrets and variables > Actions > Variables**
and add a repository variable:

- Name: `SKILLEGO_SERVER`
- Value: `https://skillego.yourdomain.com`

The deploy workflows will inject this into a `server-config.js` file during build.
The URL never appears in the source code.

### 7. Test

Push to main (or dev) to trigger a deploy, then open your GitHub Pages URL
and check the browser console. Should see:
```
Connected to Skillego server
```

Create a multiplayer game, share the link. Done.

## Managing

```bash
# View logs
docker compose logs -f skillego

# Restart
docker compose restart

# Stop
docker compose down

# Rebuild after code changes
git pull && docker compose up -d --build
```

## Security

- **CORS**: `ALLOWED_ORIGINS` in `.env` restricts which domains can connect.
  Set to your GitHub Pages URL only in production.
- **Cloudflare**: All traffic proxied — your home IP is never exposed.
- **Game state**: Server validates all moves server-side (anti-cheat).
  Covered pieces are masked before sending to clients.
- **No database**: Games are in-memory. Server restart clears active rooms.
  Game logs persist to `./gamelogs/` via Docker volume mount.
