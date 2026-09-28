// RouterOS script renderer — the ONLY place that generates scripts pushed to routers.
// Every embedded value is escaped; hosts are charset-validated; output is idempotent.

const SAFE_HOST = /^[a-zA-Z0-9.-]+$/;
const assertHost = (h: string) => { if (!SAFE_HOST.test(h)) throw new Error(`unsafe host: ${h}`); };

/** Escape a value for embedding inside a RouterOS "string literal". */
export function ros(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

/** Escape a whole script body for embedding as an on-event="..." value (keeps $ literal for schedule-time evaluation). */
function rosInline(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

export interface Walled { http: string[]; ip: string[] }

/** The one-liner the admin pastes into the router terminal. */
export function oneLiner(domain: string, token: string): string {
  assertHost(domain);
  const d = ros(domain), t = ros(token);
  return [
    `:do { :resolve "${d}" } on-error={ /log error "T-Connect: DNS cannot resolve ${d}. Check IP > DNS."; :error "dns" }`,
    `:local dm false; :do { :local c [:parse ":return ([/system/device-mode/get fetch] = false)"]; :set dm [$c] } on-error={}; :if ($dm) do={ /log error "T-Connect: /tool fetch blocked by Device Mode. Go to System > Device Mode, set Advanced, then run this again."; :error "device-mode" }`,
    `:local v [/system resource get version]; :local b [/system routerboard get board-name]; :local s ""; :do { :set s [/system routerboard get serial-number] } on-error={}; :local info ("v=" . $v . "|b=" . $b . "|s=" . $s)`,
    `:do { /tool fetch url="https://${d}/adopt/${t}" http-method=post http-data=$info dst-path="tc-adopt.rsc"; /import file="tc-adopt.rsc"; /file remove "tc-adopt.rsc" } on-error={ /log error "T-Connect: adoption download failed - check uplink."; :do { /file remove "tc-adopt.rsc" } on-error={} }`,
  ].join('; ');
}

function agentBody(domain: string, routerId: string, key: string): string {
  return [
    ':global tcRev',
    ':do {',
    ':local u [/system resource get uptime]',
    ':local cl [/system resource get cpu-load]',
    `:do { /tool fetch url="https://${domain}/hb/${routerId}" http-method=post http-data="u=$u&c=$cl" http-header-field="Authorization: Bearer ${key}" } on-error={}`,
    `:do { /tool fetch url="https://${domain}/cfg/${routerId}" http-method=post http-data="rev=$tcRev" http-header-field="Authorization: Bearer ${key}" dst-path="tc-cfg.rsc"`,
    ':local c [/file get "tc-cfg.rsc" content]',
    ':if ($c != "NOCHANGE") do={ /import file="tc-cfg.rsc"; /file remove "tc-cfg.rsc" }',
    '} on-error={}',
    '} on-error={ /log warning "T-Connect agent failed" }',
  ].join(' ');
}

/** Pre-escaped scheduler on-event body for this router (contains its key — controller stores it encrypted as agent_line_enc). */
export function agentEvent(domain: string, routerId: string, routerKey: string): string {
  return rosInline(agentBody(domain, routerId, routerKey));
}

/** Shared config sections used by both provisioning (rev 1) and re-configure scripts. */
function configSections(o: { walled: Walled; ssid?: string }): string[] {
  const lines: string[] = [];
  if (o.ssid) {
    const s = ros(o.ssid);
    lines.push(`:do { /interface wifi set [find] ssid="${s}" } on-error={ :do { /interface wifiwave2 set [find] ssid="${s}" } on-error={ /log warning "T-Connect: could not set SSID" } }`);
  }
  lines.push(
    `:local br ""; :local best 0;`,
    `:foreach b in=[/interface bridge find] do={ :local cnt [:len [/interface bridge port find where bridge=$b]]; :if ($cnt > $best) do={ :set best $cnt; :set br [/interface bridge get $b name] } };`,
    `:if ([:len $br] = 0) do={ /log error "T-Connect: no bridge found - check dashboard"; :error "no-bridge" };`,
    `:local ha "";`,
    `:foreach a in=[/ip address find where interface=$br] do={ :local ad [/ip address get $a address]; :set ha [:pick $ad 0 [:find $ad "/"]] };`,
    `:if ([:len $ha] = 0) do={ :log error "T-Connect: bridge has no IP - enable DHCP server on the bridge"; :error "no-ip" };`,
    `:if ([:len [/ip dhcp-server find disabled=no interface=$br]] = 0) do={ /log warning "T-Connect: no DHCP server on bridge - clients may not get addresses" };`,
    `:do { /ip hotspot remove [find name="tconnect"] } on-error={};`,
    `:do { /ip hotspot profile remove [find name="tconnect"] } on-error={};`,
    `/ip hotspot profile add name="tconnect" hotspot-address=$ha html-directory="hotspot" login-by=http-pap use-radius=yes radius-accounting=yes nas-port-type="wireless-802.11";`,
    `/ip hotspot add name="tconnect" interface=$br profile="tconnect" disabled=no;`,
    `:do { /ip hotspot walled-garden remove [find comment="tconnect"] } on-error={};`,
  );
  for (const h of o.walled.http) {
    const e = ros(h);
    lines.push(`/ip hotspot walled-garden add dst-host="${e}" action=allow comment="tconnect";`);
    lines.push(`/ip hotspot walled-garden add dst-host=".${e}" action=allow comment="tconnect";`);
  }
  lines.push(`:do { /ip hotspot walled-garden ip remove [find comment="tconnect"] } on-error={};`);
  for (const h of o.walled.ip) {
    const e = ros(h);
    lines.push(`/ip hotspot walled-garden ip add dst-host="${e}" action=allow comment="tconnect";`);
    lines.push(`/ip hotspot walled-garden ip add dst-host=".${e}" action=allow comment="tconnect";`);
  }
  return lines;
}

export interface ProvisionOptions {
  domain: string; wgHost: string; routerId: string; shortId: string;
  apiUser: string; apiPass: string; wgPriv: string; serverPub: string;
  tunnelIp: string; radiusSecret: string; routerKey: string;
  walled: Walled; ssid?: string;
  agentEvent?: string;
  wgPort?: number;
}

/** One-time provisioning script, returned by POST /adopt/:token (single-use token, over TLS). */
export function provisionScript(o: ProvisionOptions): string {
  assertHost(o.domain); assertHost(o.wgHost);
  const p = (v: string) => ros(v);
  const agent = o.agentEvent ?? agentEvent(o.domain, o.routerId, o.routerKey);
  return `# T-Connect provisioning - router ${o.shortId}
# Safe to re-run. Generated by the controller - do not edit.
:log info "T-Connect: provisioning start (${p(o.shortId)})";
:do {
  /system identity set name="tc-${p(o.shortId)}";
  :do { /user remove [find comment="tconnect-mgmt"] } on-error={};
  /user add name="${p(o.apiUser)}" password="${p(o.apiPass)}" group=full comment="tconnect-mgmt";
  :do { /ip service disable telnet,ftp,api } on-error={};
  :do { /ip service set api-ssl address=10.200.0.0/16,192.168.88.0/24 } on-error={};
  :do { /ip service set winbox address=10.200.0.0/16,192.168.88.0/24 } on-error={};
  :do { /interface wireguard remove [find name="tc-tunnel"] } on-error={};
  /interface wireguard add name="tc-tunnel" listen-port=13231 private-key="${p(o.wgPriv)}";
  /interface wireguard peers add interface="tc-tunnel" public-key="${p(o.serverPub)}" endpoint-address="${p(o.wgHost)}" endpoint-port="${o.wgPort ?? 51820}" allowed-address="10.200.0.1/32" persistent-keepalive="25s";
  :do { /ip address remove [find interface="tc-tunnel"] } on-error={};
  /ip address add address="${p(o.tunnelIp)}/32" interface="tc-tunnel";
  :do { /ip route remove [find dst-address="10.200.0.1/32"] } on-error={};
  /ip route add dst-address="10.200.0.1/32" gateway="tc-tunnel";
  :do { /radius remove [find comment="tconnect"] } on-error={};
  /radius add address="10.200.0.1" secret="${p(o.radiusSecret)}" service=hotspot timeout="3s" comment="tconnect";
  /radius incoming set accept=yes port=3799 secret="${p(o.radiusSecret)}";
 ${configSections(o).map((l) => '  ' + l).join('\n')}
  :do { /system scheduler remove [find name="tc-agent"] } on-error={};
  /system scheduler add name="tc-agent" interval="30s" start-time="startup" on-event="${agent}";
  :global tcRev; :set tcRev 1;
  /tool fetch url="https://${p(o.domain)}/hb/${p(o.routerId)}" http-method=post http-data="u=booted" http-header-field="Authorization: Bearer ${p(o.routerKey)}";
  :log info "T-Connect: provisioning complete";
} on-error={ :log error "T-Connect: provisioning FAILED - see previous log entries" }`;
}

export interface ConfigOptions {
  rev: number; domain: string; routerId: string;
  agentEvent: string; walled: Walled; ssid?: string;
}

/** Recurring config script (rev > 1). Idempotent; ends by setting the revision global. */
export function configScript(o: ConfigOptions): string {
  assertHost(o.domain);
  const agent = o.agentEvent;
  return `# T-Connect config rev ${o.rev}
:do {
 ${configSections(o).map((l) => '  ' + l).join('\n')}
  :do { /system scheduler remove [find name="tc-agent"] } on-error={};
  /system scheduler add name="tc-agent" interval="30s" start-time="startup" on-event="${agent}";
  :global tcRev; :set tcRev ${o.rev};
  :log info "T-Connect: config rev ${o.rev} applied";
} on-error={ :log error "T-Connect: config rev ${o.rev} FAILED" }`;
}