# CivicResolve — hosting handoff (home box → deb2)

Written 2026-11-05. CivicResolve now runs on **deb2**; the old home box runs nothing civic-related.
Anything below that says "old box" is the rollback path, not a live path.

---

## 1. What moved

| Piece | Old location | New location |
|---|---|---|
| Portal (Next.js 15.2.4) | `~/CivicResolve` | `/opt/civicresolve/app` |
| WhatsApp bridge (Express) | `~/civicresolve-whatsapp` | `/opt/civicresolve/whatsapp` |
| Docs/marketing site (static) | `~/civic-site` | `/opt/civicresolve/site` |
| MySQL 8.0 (data) | docker `civicresolve-mysql` :3307 | docker `civic-mysql` :3307 |
| Redis 7 | docker `civic-redis` :6379 | docker `civic-redis` :6379 |
| Uploaded photos | `app/public/uploads` (9.2 MB) | same path on deb2 |
| Public edge | cloudflared tunnel `be491a70` (home box) | cloudflared tunnel `df3ec594-4cbe-4cf0-9872-1bdb7cbd52d4` (deb2) |

Cutover was a DNS rewrite of two CNAMEs; the Meta webhook URL never changed.

---

## 2. Host facts

- **Host**: `deb2`, Ubuntu 24.04.4 LTS, 7.6 GB RAM, 458 GB disk (79% used)
- **Address**: `100.92.91.114` (Tailscale), `deb2.tail38bd54.ts.net`
- **SSH**: `ssh deb2` (user `newer`, key-based, configured in `~/.ssh/config` locally). `newer` is in `sudo` + `docker`, but **sudo wants the password** — service restarts therefore go through `ssh root@100.92.91.114`.
- **Node**: `/opt/node22` (v22.22.1), deliberately not the system v18. `npm` from that install.
- **Repos**: `Newer1107/CivicResolve` (master, public), `Newer1107/civicresolve-whatsapp` (main, private). deb2 holds a GitHub token in `/home/newer/.gh_token` and a `store` credential helper in `~/.git-credentials` (both chmod 600) so `git pull` works on the private repo.

---

## 3. Runtime layout

```
internet
  └── Cloudflare (civic.raunaktech.site, civicresolve.raunaktech.site)
        └── cloudflared  (systemd: cloudflared, tunnel df3ec594…, protocol http2)
              ├── /webhook/whatsapp  ──► 127.0.0.1:3320  civic-whatsapp (Express bridge)
              ├── everything else    ──► 127.0.0.1:3111  civic-app (next start)
              └── civicresolve.*     ──► 127.0.0.1:8099  civic-site (python http.server)

civic-app ──► MySQL 127.0.0.1:3307 (docker civic-mysql)
          ──► Redis 127.0.0.1:6379 (docker civic-redis, cache only, fail-open)
          ──► DeepSeek API (text + vision)
civic-whatsapp ──► same MySQL, Meta Graph API, DeepSeek, bridge HTTP
```

Ports 3111 / 3320 / 8099 / 3307 / 6379 are bound to **127.0.0.1 only**. Only cloudflared faces the internet.

### Services (system-level, in `/etc/systemd/system/`)

| Unit | Runs as | Command |
|---|---|---|
| `civic-app.service` | newer | `/opt/node22/bin/node node_modules/next/dist/bin/next start -p 3111 -H 127.0.0.1` |
| `civic-whatsapp.service` | newer | `/opt/node22/bin/node src/index.js` |
| `civic-site.service` | newer | `python3 -m http.server 8099 --bind 127.0.0.1` |
| `cloudflared.service` | root | tunnel `df3ec594…`, config `/etc/cloudflared/config.yml` |

All are `Restart=always`, enabled at boot.

```bash
ssh root@100.92.91.114 'systemctl status civic-app civic-whatsapp civic-site cloudflared'
ssh root@100.92.91.114 'systemctl restart civic-app'
ssh deb2 'journalctl -u civic-app -n 50 --no-pager'   # readable as newer
```

---

## 4. Data

- **Database**: `civicresolve_dev` inside container `civic-mysql`, root password = `DB_PASSWORD` from `/opt/civicresolve/.env`.
- **State at cutover**: 20 issues, 34 users, 41 issue updates, 19 `wa_messages`, 1 duplicate relationship (issue 22 merged into 17). Verified identical on both boxes.
- **Compose file**: `/opt/civicresolve/docker-compose.yml` (`docker compose up -d` from that dir). MySQL data + Redis AOF live in named volumes `civicresolve_mysql-data` / `civicresolve_redis-data`.
- **Uploads**: `/opt/civicresolve/app/public/uploads/` — served through `app/uploads/[...path]/route.ts`.

### Backup / restore

```bash
# dump (on deb2)
docker exec civic-mysql sh -lc 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick civicresolve_dev' | gzip > civic-$(date +%F).sql.gz

# restore
gunzip -c civic-YYYY-MM-DD.sql.gz | docker exec -i civic-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" civicresolve_dev'
```

**There is no cron backup yet on deb2** (the box has none for Nextcloud either). Adding one is outstanding.

---

## 5. Config & secrets

Never printed, always on disk, chmod 600:

| File | Holds |
|---|---|
| `/opt/civicresolve/.env` | copy of the app env; used by `docker-compose.yml` for MySQL creds |
| `/opt/civicresolve/app/.env` | portal: DB, Redis, JWT, DeepSeek, email, feature flags, `BRIDGE_URL`/`BRIDGE_API_KEY` |
| `/opt/civicresolve/whatsapp/.env` | bridge: `DATABASE_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, DeepSeek, `BRIDGE_API_KEY`, `PORT` |
| `/root/.cloudflared/cert.pem` + `df3ec594….json` | Cloudflare tunnel origin cert + credentials |
| `/home/newer/.gh_token`, `~/.git-credentials` | GitHub read access for the private repo |

The old box keeps its own copies under `~/CivicResolve/.env` and `~/civicresolve-whatsapp/.env` for rollback.

**Outstanding security item**: the DeepSeek key was pasted in chat during development — rotate it after the demo.

---

## 6. Edge / DNS

- New tunnel: **`df3ec594-4cbe-4cf0-9872-1bdb7cbd52d4`** (`civic-deb2`), locally-managed, config `/etc/cloudflared/config.yml`, `protocol: http2` (QUIC is unreliable on this link — same reason as the old box).
- CNAMEs now point here: `civic.raunaktech.site`, `civicresolve.raunaktech.site`, plus `civic-deb2.raunaktech.site` kept as a same-origin test host.
- Old tunnel `be491a70` (home box) is still registered but no DNS points at it. Its systemd unit `civic-tunnel` is **stopped and disabled**; delete the tunnel from the Cloudflare dashboard when you are sure you will not roll back.
- Re-route DNS if a record is ever lost:
  ```bash
  ssh root@100.92.91.114 'cloudflared tunnel --origincert /root/.cloudflared/cert.pem route dns --overwrite-dns civic-deb2 civic.raunaktech.site'
  ```

### Ingress (order matters — the path rule must come first)

```yaml
ingress:
  - hostname: civic.raunaktech.site
    path: ^/webhook/whatsapp
    service: http://127.0.0.1:3320
  - hostname: civic.raunaktech.site
    service: http://127.0.0.1:3111
  - hostname: civicresolve.raunaktech.site
    service: http://127.0.0.1:8099
  - hostname: civic-deb2.raunaktech.site
    service: http://127.0.0.1:3111
  - service: http_status:404
```

---

## 7. WhatsApp / Meta

Nothing changed at Meta during the move — the callback URL is still
`https://civic.raunaktech.site/webhook/whatsapp`, which is what makes the cutover invisible.

- App **CivicResolve Demo** `1455467770016032`, business `1348404383590131`
- WABA `1155254556919783`, phone number ID `1354165821123398`, display **+1 555 153 4991**
- System user `civicresolve`, token type `SYSTEM_USER`, `expires_at: 0` (never expires), scopes messaging + management, app **and** WABA assets assigned
- Allow-listed recipient: `+91 9372499047`. Only allow-listed numbers work — **this is still a Meta test number**, a production number is required for a jury demo.

**Hard constraint:** the 711 hotel bot shares this Meta business/app family. Do not touch `automationadmin`, the app-level callback `ba85aab5-7cd2-4506-8195-701e48c1a18f`, or the 711 phone number ID.

---

## 8. Deploying a change

```bash
ssh deb2
cd /opt/civicresolve/app        # or whatsapp
git pull
/opt/node22/bin/npm install --legacy-peer-deps   # only when dependencies change
/opt/node22/bin/npm run build                    # app only; takes ~90 s, needs ~1.5 GB RAM
exit
ssh root@100.92.91.114 'systemctl restart civic-app'   # or civic-whatsapp
```

Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://civic.raunaktech.site/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://civicresolve.raunaktech.site/     # 200
ssh deb2 'curl -s http://127.0.0.1:3320/api/health'                                # bridge health
```

Note: `.next` is rebuilt in place, so a failed build leaves the previous build intact only until `next start` restarts — if the build fails, **do not restart**, fix and rebuild.

---

## 9. Traps found during this migration

1. **`npm install` on a clean host resolves `mysql2` to 3.24.x**, which imports `node:diagnostics_channel`; Next's webpack refuses it and the build dies with `UnhandledSchemeError`. Fixed at source — `package.json` now pins `mysql2` to `3.19.0`. Keep it pinned.
2. **npm 10.9.4 (and 9.2.0) crash with `Cannot read properties of null (reading 'edgesOut')`** on this lockfile because of the `vitest@4.1.12` peer set. Workaround used on deb2: `--legacy-peer-deps`. If a fresh install must be done from scratch, drop `vitest`/`@vitest/*` from `devDependencies`, install, then restore `package.json`. Tests are not run on the server.
3. **`civicresolve-whatsapp/prisma/schema.prisma` was committed as an absolute symlink** into the old home directory, so every clone had a dangling schema and `prisma generate` failed. Fixed in commit `628e44f` — it is now a real file. **When the portal schema changes, copy it across again** (`cp app/prisma/schema.prisma whatsapp/prisma/schema.prisma`).
4. **`mysqladmin ping` healthcheck shows `unhealthy`** even when MySQL is fine — the check runs without credentials inside the container. Ignore; wait for `ready for connections` in `docker logs civic-mysql` before importing a dump.
5. **Two boxes answering the same hostname** is the failure mode to avoid: old units were stopped *and disabled*, not just stopped.
6. Service management as `newer` fails with "Interactive authentication required" — restart via `ssh root@…`, which is key-based.

---

## 10. Rollback (still available)

Old box still has code, `.env`, data and a full DB copy.

```bash
# 1. point DNS back (run where the old tunnel's cert is)
cloudflared tunnel route dns --overwrite-dns be491a70 civic.raunaktech.site
cloudflared tunnel route dns --overwrite-dns be491a70 civicresolve.raunaktech.site

# 2. bring the old services up
systemctl --user enable --now civic-app civic-whatsapp civic-site civic-tunnel civic-verify.timer

# 3. stop deb2
ssh root@100.92.91.114 'systemctl stop civic-app civic-whatsapp civic-site cloudflared'
```

Any data written on deb2 after the move would have to be dumped and restored onto the old box before rolling back.

---

## 11. Open items

- **No scheduled backups** on deb2 (DB + uploads). Nextcloud has the same gap.
- **76 pending package updates**; security-only unattended upgrades not configured.
- **Meta test number** — needs a production number on WABA `1155254556919783` for the jury demo.
- **Docs site is stale** — `/system.html` and the portal still name **CoE** as the AI provider; the app moved to DeepSeek in `e81e50f`.
- **DeepSeek key rotation** after the demo.
- `civic-verify.timer` (the AI verification worker) was **not** migrated — it belongs to the old box's user systemd. The app's verification endpoints still work on demand; nothing schedules them. Decide whether to recreate it as a system timer on deb2.
- Challenge deck still needs re-export to PDF by hand.
