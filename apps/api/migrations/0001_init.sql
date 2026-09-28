-- T-Connect schema v1 — full schema + roles + Row-Level Security (tenant isolation)

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text UNIQUE NOT NULL,
  currency text NOT NULL DEFAULT 'LSL', currency_symbol text NOT NULL DEFAULT 'M',
  timezone text NOT NULL DEFAULT 'Africa/Maseru',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL, name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  totp_secret_enc text, totp_enabled boolean NOT NULL DEFAULT false,
  is_platform_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_operator_id uuid REFERENCES operators(id),
  csrf text NOT NULL,
  ip text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions ( key text PRIMARY KEY, description text NOT NULL DEFAULT '' );
INSERT INTO permissions (key) VALUES
 ('platform.manage'),('team.read'),('team.manage'),('roles.manage'),('invites.manage'),
 ('sites.read'),('sites.manage'),('routers.read'),('routers.manage'),
 ('plans.read'),('plans.manage'),('vouchers.read'),('vouchers.manage'),
 ('payments.read'),('payments.manage'),('gateways.manage'),
 ('analytics.read'),('audit.read'),('bandwidth.manage'),('contentfilter.manage'),('portal.manage');

CREATE TABLE roles (
  id bigserial PRIMARY KEY,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,
  key text NOT NULL, name text NOT NULL, is_system boolean NOT NULL DEFAULT true,
  UNIQUE (operator_id, key)
);
CREATE TABLE role_permissions (
  role_id bigint REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE member_roles (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,
  role_id bigint REFERENCES roles(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','site')),
  site_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX member_roles_unique ON member_roles (user_id, operator_id, role_id, scope_type, COALESCE(site_id, 0));

CREATE TABLE invites (
  id bigserial PRIMARY KEY,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,
  email text NOT NULL, role_id bigint REFERENCES roles(id),
  scope_type text NOT NULL DEFAULT 'global', site_id bigint,
  token_hash text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, accepted_at timestamptz
);

CREATE TABLE sites (
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name text NOT NULL,
  vertical text NOT NULL DEFAULT 'hotspot' CHECK (vertical IN ('hotspot','community','bus','stadium','park')),
  ssid text, address text, lat double precision, lng double precision,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE routers_tunnel_num_seq;

CREATE TABLE routers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  site_id bigint REFERENCES sites(id) ON DELETE SET NULL,
  name text NOT NULL, identity text UNIQUE,
  board_name text, ros_version text, serial text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted','retired')),
  tunnel_num int UNIQUE NOT NULL DEFAULT nextval('routers_tunnel_num_seq'),
  tunnel_ip text, wg_public_key text,
  api_user text, api_password_enc text,
  router_key_hash text UNIQUE, radius_secret_enc text,
  agent_line_enc text,
  last_seen_at timestamptz, uptime text, cpu_load int,
  config_revision int NOT NULL DEFAULT 0,
  adopted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adoption_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  router_id uuid REFERENCES routers(id) ON DELETE SET NULL,
  token_hash text UNIQUE NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, used_at timestamptz
);

CREATE TABLE walled_garden_entries (
  id bigserial PRIMARY KEY,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,   -- NULL = global default
  kind text NOT NULL CHECK (kind IN ('http','ip')),
  dst_host text NOT NULL, note text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true
);
INSERT INTO walled_garden_entries (kind, dst_host, note) VALUES
 ('http','captive.apple.com','iOS/macOS probe'),
 ('http','www.apple.com','iOS/macOS success page'),
 ('http','connectivitycheck.gstatic.com','Android probe'),
 ('http','clients3.google.com','Android probe'),
 ('http','connectivitycheck.android.com','Android probe'),
 ('http','msftconnecttest.com','Windows probe'),
 ('http','www.msftconnecttest.com','Windows probe'),
 ('http','detectportal.firefox.com','Firefox probe'),
 ('ip','www.google.com','Chrome HTTPS probe'),
 ('ip','www.gstatic.com','Chrome HTTPS probe'),
 ('ip','ottvoucher.com','OTTvoucher - CONFIRM exact domains Phase B'),
 ('ip','paylesotho.co.ls','xPayments - CONFIRM Phase B'),
 ('ip','xpayments.paylesotho.co.ls','xPayments - CONFIRM Phase B'),
 ('ip','ecocash.co.ls','EcoCash Lesotho - CONFIRM Phase B'),
 ('ip','mywallet.co.ls','MyWallet Lesotho - CONFIRM Phase B');

CREATE TABLE plans (
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'LSL',
  duration_seconds bigint,                 -- NULL = time-unlimited
  data_cap_mb bigint,                      -- NULL = data-unlimited
  rate_down_kbps int, rate_up_kbps int,
  burst_down_kbps int, burst_up_kbps int,
  max_devices int NOT NULL DEFAULT 2,      -- phone + laptop default
  max_concurrent_sessions int NOT NULL DEFAULT 2,
  idle_timeout_s int NOT NULL DEFAULT 1800,
  activation text NOT NULL DEFAULT 'on_first_login' CHECK (activation IN ('on_first_login','on_issue')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE voucher_batches (
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  count int NOT NULL, note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vouchers (
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  batch_id bigint NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  code_hash text UNIQUE NOT NULL,
  code_enc text,                            -- AES-GCM so admins can re-display codes
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','active','revoked','expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vouchers_op_status ON vouchers (operator_id, status);

CREATE TABLE voucher_devices (
  voucher_id bigint NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  mac text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voucher_id, mac)
);

CREATE TABLE radius_sessions (
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL,
  router_id uuid REFERENCES routers(id) ON DELETE SET NULL,
  voucher_id bigint REFERENCES vouchers(id) ON DELETE SET NULL,
  session_id text NOT NULL, username text, mac text, framed_ip text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_update timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  bytes_in bigint NOT NULL DEFAULT 0, bytes_out bigint NOT NULL DEFAULT 0,
  UNIQUE (router_id, session_id)
);
CREATE INDEX rs_voucher ON radius_sessions (voucher_id);
CREATE INDEX rs_open ON radius_sessions (closed_at) WHERE closed_at IS NULL;

CREATE TABLE auth_log (
  id bigserial PRIMARY KEY,
  operator_id uuid, router_id uuid, username text,
  result text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (               -- Phase B writes; dashboard reads => revenue == ledger by construction
  id bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  entry_type text NOT NULL,                 -- payment | voucher_issue | adjustment
  amount_minor bigint NOT NULL, currency text NOT NULL DEFAULT 'LSL',
  payment_tx_id bigint, voucher_id bigint, site_id bigint, plan_id bigint, method text,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE config_revisions (
  id bigserial PRIMARY KEY,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,   -- required by the RLS policy loop
  router_id uuid NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  revision int NOT NULL, script text NOT NULL,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  operator_id uuid, user_id uuid,
  action text NOT NULL, entity_type text, entity_id text,
  data jsonb NOT NULL DEFAULT '{}', ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ roles (DB users) ============
-- Created/kept in sync by apps/api/src/migrate.ts (passwords from *_URL env values).

-- ============ RLS: tenant isolation (fail-closed) ============
ALTER TABLE sites            ENABLE ROW LEVEL SECURITY; ALTER TABLE sites            FORCE ROW LEVEL SECURITY;
ALTER TABLE routers          ENABLE ROW LEVEL SECURITY; ALTER TABLE routers          FORCE ROW LEVEL SECURITY;
ALTER TABLE adoption_tokens  ENABLE ROW LEVEL SECURITY; ALTER TABLE adoption_tokens  FORCE ROW LEVEL SECURITY;
ALTER TABLE plans            ENABLE ROW LEVEL SECURITY; ALTER TABLE plans            FORCE ROW LEVEL SECURITY;
ALTER TABLE voucher_batches  ENABLE ROW LEVEL SECURITY; ALTER TABLE voucher_batches  FORCE ROW LEVEL SECURITY;
ALTER TABLE vouchers         ENABLE ROW LEVEL SECURITY; ALTER TABLE vouchers         FORCE ROW LEVEL SECURITY;
ALTER TABLE invites          ENABLE ROW LEVEL SECURITY; ALTER TABLE invites          FORCE ROW LEVEL SECURITY;
ALTER TABLE member_roles     ENABLE ROW LEVEL SECURITY; ALTER TABLE member_roles     FORCE ROW LEVEL SECURITY;
ALTER TABLE roles            ENABLE ROW LEVEL SECURITY; ALTER TABLE roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE walled_garden_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE walled_garden_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_logs       FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries   ENABLE ROW LEVEL SECURITY; ALTER TABLE ledger_entries   FORCE ROW LEVEL SECURITY;
ALTER TABLE config_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE config_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE radius_sessions  ENABLE ROW LEVEL SECURITY; ALTER TABLE radius_sessions  FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_log         ENABLE ROW LEVEL SECURITY; ALTER TABLE auth_log         FORCE ROW LEVEL SECURITY;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','routers','adoption_tokens','plans','voucher_batches','vouchers',
                           'invites','member_roles','roles','walled_garden_entries','audit_logs',
                           'ledger_entries','config_revisions','radius_sessions','auth_log'] LOOP
    EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO app_api USING (current_setting(''app.tenant'', true) IN (operator_id::text, ''*'')) WITH CHECK (current_setting(''app.tenant'', true) IN (operator_id::text, ''*''))', t, t);
  END LOOP;
END $$;

CREATE POLICY walled_global ON walled_garden_entries FOR SELECT TO app_api USING (operator_id IS NULL);

-- RADIUS role: cross-tenant reads + the writes it needs (and nothing more)
CREATE POLICY p_radius_ro ON routers         FOR SELECT TO app_radius USING (true);
CREATE POLICY p_radius_ro ON plans           FOR SELECT TO app_radius USING (true);
CREATE POLICY p_radius_ro ON vouchers        FOR SELECT TO app_radius USING (true);
CREATE POLICY p_radius_vu ON vouchers        FOR UPDATE TO app_radius USING (true) WITH CHECK (true);
CREATE POLICY p_radius_rw ON voucher_devices FOR ALL    TO app_radius USING (true) WITH CHECK (true);
CREATE POLICY p_radius_rw ON radius_sessions FOR ALL    TO app_radius USING (true) WITH CHECK (true);
CREATE POLICY p_radius_w  ON auth_log        FOR INSERT TO app_radius WITH CHECK (true);

-- grants for app_api
GRANT CONNECT ON DATABASE tconnect TO app_api;
GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, permissions TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON operators, sites, routers, adoption_tokens, plans,
  voucher_batches, vouchers, invites, member_roles, roles, role_permissions,
  walled_garden_entries, config_revisions, audit_logs, ledger_entries TO app_api;
GRANT SELECT ON radius_sessions, auth_log TO app_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;

-- grants for app_radius
GRANT CONNECT ON DATABASE tconnect TO app_radius;
GRANT USAGE ON SCHEMA public TO app_radius;
GRANT SELECT ON routers, plans, vouchers TO app_radius;
GRANT UPDATE ON vouchers TO app_radius;                 -- SELECT ... FOR UPDATE requires this
GRANT SELECT, INSERT, UPDATE ON voucher_devices TO app_radius;
GRANT SELECT, INSERT, UPDATE ON radius_sessions TO app_radius;
GRANT INSERT ON auth_log TO app_radius;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_radius;