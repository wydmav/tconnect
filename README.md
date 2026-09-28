T-Connect — Connected Hotspots

Multi-tenant cloud controller & monetization engine for MikroTik hotspot networks.One architecture · five verticals · Lesotho.
Vertical	What it means
☕ Connected Hotspots	Cafés, retail, co-working — voucher & day-pass monetization
🏡 Connected Communities	Estates & villages — micro-billing on shared Starlink backhaul
🚌 Connected Buses	Transit Wi-Fi with centralized passes
🏟️ Connected Stadiums	High-density events, VIP tiers
🌳 Connected Parks	Public zones, free tiers with paid upsell

Every vertical runs the same core: MikroTik RouterOS routers, adopted over a one-linescript, managed through encrypted WireGuard tunnels, authenticated against a centralRADIUS + PostgreSQL backend, monetized through plug-in payment gateways(OTTvoucher · EcoCash · MyWallet · xPayments — Phase B).
Status (honest)
Phase	Scope	Status
A	Core backend, DB + tenant isolation (RLS), auth + TOTP MFA, RBAC + invites, router adoption (one-liner, WireGuard, heartbeat/config agent), plans, vouchers, central RADIUS (entitlements, device limits, speed caps, accounting), admin dashboard	✅ Complete — runs locally end-to-end, deployed to VPS
B	Payment gateways, wizard, webhooks, transaction ledger	⏳ Awaiting gateway API docs & sandbox credentials
C	Branded captive portal (per-site), full OS popup validation	⏳ Planned
D	Cross-operator roaming networks	⏳ Core roaming already works operator-wide (central RADIUS)
E	3-level bandwidth caps UI, fair-use, site caps, DNS content filtering	⏳ Planned
F	Full analytics suite, role-adaptive views	⏳ Partial (live KPIs, session ledger, CSV export done)
G	Production hardening, monitoring, backup drills	⏳ Baseline in place (see Operations)

Verified locally: adoption flow, router online status, voucher atomicity (no double-spend),2-device limit enforcement, exact plan entitlement (M10 → 24 h → correct Session-Timeout andrate attributes returned via real RADIUS packets), accounting → live dashboard, MFA, RBAC, audit log.

Requires real hardware / pending: RouterOS script execution on physical hAP ax³,captive-portal popup behavior on iOS/Android/Windows, real speed enforcement, payment gateways.
Architecture

                         ┌──────────────── VPS (Docker Compose) ─────────────────┐ MikroTik routers ──WG──▶│  Caddy (TLS) ─▶ API (NestJS) ─▶ PostgreSQL 16 / Redis │ (hAP ax³, behind        │                    │                                   │  Starlink CGNAT —       │  RADIUS (auth/acct/CoA)   Admin UI (Next.js)           │  tunnels are            │  WireGuard hub + manager (per-router keys)             │  router-initiated)      │  Nightly encrypted backups → offsite                   │                         └───────────────────────────────────────────────────────┘ Payment gateways ──webhooks (Phase B)──▶ Caddy

Routers expose nothing to the internet. Management (API-SSL) is bound to the tunnelnetwork only; telnet/ftp/api are disabled at adoption. All entitlement state lives centrally,which is what makes roaming between sites possible without a second payment.
Repository layout

tconnect/├── README.md                       ← this file├── package.json                    workspace root (npm workspaces)├── package-lock.json               committed for reproducible builds├── docker-compose.yml              PRODUCTION stack├── docker-compose.dev.yml          LOCAL stack (WireGuard + TLS simulated)├── .env.example                    production env template (all secrets, no values)├── .env.dev                        local env values (throwaway dev credentials only)├── gitleaks.toml                   secret-scan policy (CI-enforced)├── .github/workflows/ci.yml        CI: gitleaks → build → unit tests│├── infra/│   ├── caddy/Caddyfile             prod reverse proxy + automatic HTTPS│   ├── caddy/Caddyfile.dev         local proxy (plain HTTP :8080)│   ├── caddy/Caddyfile.internal    created only when sharing another proxy (see deploy §5)│   ├── wg/                         WireGuard hub: Dockerfile, entrypoint, peer manager API│   └── backup/backup.sh            encrypted (age) DB dumps → offsite via rclone│├── tools/│   ├── simulator.js                fake hAP ax³ + client devices: real adoption POST,│   │                               real heartbeats, REAL RADIUS packets. The local demo.│   ├── mock-wg.js                  local stand-in for the WireGuard hub manager│   └── mikrotik.dict               MikroTik RADIUS vendor dictionary (Rate-Limit etc.)│├── packages/│   ├── shared/                     permissions, roles, verticals (single source of truth)│   └── routeros/                   RouterOS script renderer — the one-liner, provisioning│                                   and config scripts (escaped, version-aware, idempotent)│├── apps/│   ├── api/                        NestJS controller service│   │   ├── migrations/0001_init.sql  full schema + Postgres Row-Level Security (tenant isolation)│   │   └── src/                    auth+MFA, setup wizard, RBAC guards, sites, routers,│   │                               adoption engine, plans, vouchers, team/invites, roles,│   │                               stats, health, audit│   ├── radius/                     RADIUS auth + accounting service (entitlements, device│   │                               slots, concurrent-session limits, speed caps, usage)│   └── admin/                      Next.js dashboard (dark fleet-orchestrator UI):│                                   setup, login, invite accept, dashboard (live KPIs,│                                   24-h load, session ledger), routers, sites, plans,│                                   vouchers, team, audit│└── tests/    ├── unit/renderer.test.mjs      RouterOS renderer unit tests (no DB needed)    └── verify.mjs                  integration check against a running local stack

Prerequisites

Local: Docker (Desktop ≥ 4 GB RAM), Node 22 on the host (for the simulator), git.Production VPS: Ubuntu 24.04 (Contabo), ≥ 4 vCPU / 8 GB RAM / 100+ GB NVMe, a domain you control.
Run locally (10 minutes)

git clone <repo> tconnect && cd tconnectnpm install --no-audit --no-fund      # host deps for the simulator + lockfilecp .env.dev .envecho "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env   # the one secret that must be freshdocker compose -f docker-compose.dev.yml up -d --build         # first build: ~3–5 mindocker compose -f docker-compose.dev.yml logs -f api           # wait for "[api] listening on :3000"

Open http://localhost:8080.

    You're redirected to /setup → create the operator ("T-Connect") and your owner account →scan the TOTP QR with any authenticator app → verify. (There are no default credentialsanywhere in this system — the first account is created here, and MFA is mandatory forprivileged roles.)
    Sites → create "Maseru Mall" (vertical: hotspot, SSID: T-Connect).
    Plans → the seeded Day Pass · M10.00 · 24 h · 2 devices is the M10↔24h acceptance plan.Optionally edit it and set a speed (e.g. 4 Mbps down / 2 Mbps up) — you'll see that exactrate returned at login below.
    Routers → + Add Router (assign it to the site) → copy the one-liner.
    Terminal — adopt the simulated hAP ax³ (paste the one-liner, then Enter on an empty line):

node tools/simulator.js adopt

The Routers page flips to online within seconds. Audit shows router.adopted.

    Vouchers → Generate batch (Day Pass × 5) → CSV downloads → take one code.
    Terminal — a client device connects (the money path):

node tools/simulator.js connect --code <CODE> --stay

Expected output — the plan's entitlement, enforced centrally:

  ✓ Access-Accept — entitlement granted    Session-Timeout: 86400              ← exactly 24 h    Mikrotik-Rate-Limit: 4096k/2048k    ← the plan's speed cap  ✓ Accounting Start — session is now live on the dashboard

The Dashboard shows the session live (site, code, plan, M-price, climbing usage).A second device is accepted (phone + laptop). A third device is rejected —run it and check the reason:

node tools/simulator.js connect --code <CODE> --mac AA:BB:CC:00:00:99docker compose -f docker-compose.dev.yml exec postgres psql -U tc_admin -d tconnect \  -c "SELECT username,result,reason FROM auth_log ORDER BY id DESC LIMIT 5"# → "device limit reached"   (anti-sharing, enforced centrally across all sites)

Reset everything: docker compose -f docker-compose.dev.yml down -v
5-minute management demo script

    Login + TOTP code → "every admin account requires MFA."
    Dashboard: KPIs, vertical strip, live session ledger.
    Add router → show the one-line adoption script → "one paste, any site, two minutes."
    node tools/simulator.js adopt → router goes online live on screen.
    Generate vouchers → CSV → connect --code → session appears on the dashboard with usage.
    Third device rejected → "codes can't be shared — 2 devices max, enforced centrally."
    Roadmap slide: payments (Phase B), branded captive portal (C), roaming networks (D),bandwidth & content filtering (E).

Production deployment (VPS → your subdomain)

Target: controller at app.<yourdomain>.ls, routers tunnel to hub.<yourdomain>.ls.
1. DNS first (at ZEECOM) — BEFORE deploying
Type	Host	Value	Purpose
A	app	<VPS IPv4>	Controller + admin UI (Caddy auto-HTTPS)
A	hub	<VPS IPv4>	WireGuard endpoint for routers

Caddy cannot issue a certificate until DNS resolves, so verify first:

dig +short app.<yourdomain>.ls     # must return the VPS IPdig +short hub.<yourdomain>.ls     # same

2. Shared-server check (if other services run on this VPS)

The stack only binds three host ports: 80/tcp, 443/tcp, 51820/udp. Postgres, Redis,API, RADIUS and the admin UI live inside the Docker network and never touch host ports.

sudo ss -tulpn | grep -E ':(80|443|51820)\b' || echo "all free"sudo docker ps --format '{{.Names}}: {{.Ports}}'

Situation	Action
All three free	Deploy as documented below — nothing to change
80/443 taken by an existing proxy	Run our Caddy on loopback (127.0.0.1:8080:80 with Caddyfile.internal, auto_https off) and have the front proxy forward app.<domain> → 127.0.0.1:8080
51820/udp taken	Set WG_PORT=<free udp port> in .env (compose, renderer and provisioning script all honor it), open it in the firewall

On a shared server: deploy under /opt/tconnect owned by your user, never run ufw reset,and use sudo docker … rather than joining the docker group. Loopback port bindings are theonly host ports that stay private — Docker's published ports bypass ufw.
3. Server prep (once)

sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git age rclonesudo ufw status verbose                 # add only what you need on a shared boxsudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 51820/udp && sudo ufw enable

4. Get the code (deploy key)

ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub# → GitHub: repo → Settings → Deploy keys (read-only)sudo mkdir -p /opt/tconnect && sudo chown $USER:$USER /opt/tconnectgit clone git@github.com:<org>/tconnect.git /opt/tconnect && cd /opt/tconnect

5. Configure and launch

cp .env.example .env && nano .env

Fill every value. Generate secrets:

openssl rand -base64 32   # APP_ENCRYPTION_KEYopenssl rand -hex 32      # TOKEN_PEPPER, SESSION_SECRET, WG_MANAGER_TOKEN, REDIS_PASSWORDopenssl rand -hex 24      # DB passwords (must match the *_URL connection strings)

Set DOMAIN=app.<yourdomain>.ls, WG_HOST=hub.<yourdomain>.ls (and WG_PORT if needed).Then: chmod 600 .env

    ⚠️ Back up .env somewhere safe. Losing APP_ENCRYPTION_KEY or TOKEN_PEPPERmakes encrypted router credentials and all voucher hashes unrecoverable.

sudo docker compose up -d --buildsudo docker compose logs -f api        # wait for: [migrate] applied 0001_init.sql → listening on :3000sudo docker compose logs radius        # expect: [radius] auth :1812 / acct :1813curl https://app.<yourdomain>.ls/healthz    # → {"ok":true}  (first cert issue takes ~1 min)

6. First run + adopt a real router

    Open https://app.<yourdomain>.ls → setup wizard → real owner account + MFA.Do this immediately after deploy — while the DB is empty the wizard is open, and thefirst person to complete it becomes the owner. (Optionally lock 80/443 to your IP withufw until you're ready.)
    Create the real site(s), confirm the M10 plan.
    Routers → Add → copy the one-liner.
    On the hAP ax³ (WAN → Starlink LAN port): Winbox → System → Device Mode → Advanced(if Terminal says fetch is blocked) → New Terminal → paste → online in under 2 minutes.
    Generate a real voucher batch → join the SSID on a phone → redeem the code →connected for exactly the plan's duration/speed/device limits.

7. Updating & rollback

cd /opt/tconnect && git pull && sudo docker compose up -d --build   # migrations auto-apply# rollback: git checkout <tag> && sudo docker compose up -d --build  (tag releases: git tag v0.1.0)

Contabo-specific notes

    If dig is correct but the site times out from outside, check the network firewall inthe Contabo customer panel — it sits in front of the OS firewall entirely.
    If Let's Encrypt fails on first start, DNS hadn't propagated yet — once dig shows theright IP: sudo docker compose restart caddy.

Environment variables
Variable	Purpose	Notes
DOMAIN	Public hostname Caddy serves	e.g. app.tconnect.co.ls
WG_HOST	WireGuard endpoint hostname for routers	e.g. hub.tconnect.co.ls
WG_PORT	Host UDP port for WireGuard	optional — only if 51820 is taken
LETSENCRYPT_EMAIL	TLS certificate notices	unused in loopback-proxy mode
DATABASE_ADMIN_URL	Migrations/DDL (tc_admin)	prod only
DATABASE_URL / RADIUS_DATABASE_URL	App roles (app_api / app_radius)	passwords must match POSTGRES_*
POSTGRES_ADMIN_PASSWORD, APP_DB_PASSWORD, RADIUS_DB_PASSWORD	DB role passwords	must match the URLs above
REDIS_URL, REDIS_PASSWORD	Cache + rate limiting	
APP_ENCRYPTION_KEY	AES-256-GCM key for secrets at rest	base64, 32 bytes — back it up
TOKEN_PEPPER	Pepper for voucher/token hashes	identical in api + radius — back it up
SESSION_SECRET	HMAC for temporary tokens (TOTP/enroll)	
WG_MANAGER_TOKEN	api ↔ WireGuard manager auth	
SMTP_URL	Invite emails (optional — links shown in UI otherwise)	

Local mode uses .env.dev (throwaway values) plus a locally generated APP_ENCRYPTION_KEY.
Operations

sudo docker compose ps                                        # service healthsudo docker compose logs -f api | radius | caddy              # tail logs (restart: unless-stopped)sudo docker compose exec postgres psql -U tc_admin -d tconnect   # DB shell (reporting queries)

Backups — minimum from day one (full offsite+encryption drill is Phase G):

# /etc/cron.d/tconnect-backup15 3 * * * $USER cd /opt/tconnect && sudo docker compose exec -T postgres pg_dump -U tc_admin tconnect | gzip > /var/backups/tconnect/db-$(date +\%F).sql.gz

Offsite + encrypted: configure rclone + an age public key, then use infra/backup/backup.sh.Monthly restore drill: restore a dump to a scratch DB and verify a table count — anuntested backup is not a backup.
Security

    MFA (TOTP) mandatory for Owner/Admin/Technical — enforced at first login, not optional.
    Passwords hashed with argon2id; all bearer tokens & voucher codes stored peppered-hash only.
    Tenant isolation: Postgres Row-Level Security, fail-closed. One operator can never seeanother's routers, vouchers, payments or sessions.
    Routers expose nothing: API-SSL bound to tunnel subnet, telnet/ftp/api disabled,per-router random credentials delivered once over TLS with a single-use expiring token.
    Webhooks (Phase B): signature-verified, idempotent by unique constraint.
    CSRF double-submit on all mutations, per-IP rate limits on auth/adoption, zod validationon every input, audit log on every privileged action, gitleaks in CI.
    Known limitation (tracked for Phase G hardening): the one-time adoption fetch runs withRouterOS default certificate behavior; provisioning re-runs are idempotent and re-adoptionrotates all secrets.

Testing

npm run build          # compiles all packages + apps (CI runs this)npm run test:unit      # RouterOS renderer unit testsnode tests/verify.mjs  # integration check against a running local stack

Troubleshooting
Symptom	Fix
Local: migration/role errors	docker compose -f docker-compose.dev.yml down -v and start fresh
Local: port 8080/1812 busy	Change the left side of the port mapping in docker-compose.dev.yml
Local: simulator RADIUS timeout	Check docker compose -f docker-compose.dev.yml ps; on Linux allow 1812/udp 1813/udp
Adoption: "token invalid or already used"	Tokens are single-use — Routers → re-adopt for a fresh one-liner
Prod: cert issuance fails	DNS not propagated yet — verify dig, then sudo docker compose restart caddy
Prod: site unreachable though dig is right	Check the Contabo customer-panel network firewall
Prod: 80/443/51820 conflicts	See deployment §2 (shared-server table)
