# Deploying Skillego Multiplayer Server

## Architecture

```
GitHub Pages                     Cloudflare Tunnel              Home PC (WSL2)
(public client)                  (hidden proxy)                 (Docker)
+-----------------------+  wss   +-------------------------+    +------------------+
| yourusername.github.io| -----> | skillego.crisiscontrol  | -> | skillego-server  |
| /skillego             |        | .app                    |    | container :3000  |
| (HTML/JS/CSS)         |        | (not public-facing)     |    | (WebSocket only) |
+-----------------------+        +-------------------------+    +------------------+

Players visit GitHub Pages. Multiplayer traffic routes silently
through Cloudflare to the Docker container. Nobody sees crisiscontrol.app.
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

The server runs on port 3001 (host) mapped to 3000 (container).
It's WebSocket-only — no HTML served. Verify with:
```bash
curl http://localhost:3001    # should get 404 or empty (no static files)
```

### 4. Expose via Cloudflare Tunnel

Add Skillego to your existing `cloudflared` tunnel config
(usually `~/.cloudflared/config.yml`):

```yaml
ingress:
  # Existing crisiscontrol.app rules...
  - hostname: crisiscontrol.app
    service: http://localhost:XXXX

  # Skillego multiplayer backend
  - hostname: skillego.crisiscontrol.app
    service: http://localhost:3001

  - service: http_status:404
```

Then in the Cloudflare dashboard, add a CNAME DNS record:
- Name: `skillego`
- Target: `<your-tunnel-id>.cfargotunnel.com`
- Proxy: enabled (orange cloud)

### 5. Restart the tunnel

```bash
sudo systemctl restart cloudflared
# or: cloudflared tunnel run <tunnel-name>
```

### 6. Test

Open your GitHub Pages URL, open dev console. Should see:
```
Connected to Skillego server
```

Create a multiplayer game, share the code. Done.

## Client Configuration

The server URL is set in `index.html`:

```html
<script>
    var SKILLEGO_SERVER = "https://skillego.crisiscontrol.app";
</script>
```

This line is already committed. To disable multiplayer (standalone CPU-only),
comment it out.

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
