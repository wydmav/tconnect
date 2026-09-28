export const PERMISSIONS = [
  'platform.manage', 'team.read', 'team.manage', 'roles.manage', 'invites.manage',
  'sites.read', 'sites.manage', 'routers.read', 'routers.manage',
  'plans.read', 'plans.manage', 'vouchers.read', 'vouchers.manage',
  'payments.read', 'payments.manage', 'gateways.manage',
  'analytics.read', 'audit.read', 'bandwidth.manage', 'contentfilter.manage', 'portal.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const VERTICALS = ['hotspot', 'community', 'bus', 'stadium', 'park'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_META: Record<Vertical, { label: string; icon: string; color: string }> = {
  hotspot:    { label: 'Hotspots',   icon: '☕', color: '#f05e17' },
  community:  { label: 'Communities', icon: '🏡', color: '#06b6d4' },
  bus:        { label: 'Buses',      icon: '🚌', color: '#10b981' },
  stadium:    { label: 'Stadiums',   icon: '🏟️', color: '#a855f7' },
  park:       { label: 'Parks',      icon: '🌳', color: '#3b82f6' },
};

export const SYSTEM_ROLES: { key: string; name: string; perms: Permission[] }[] = [
  { key: 'owner',        name: 'Owner',        perms: [...PERMISSIONS] },
  { key: 'admin',        name: 'Admin',        perms: ['team.read','sites.read','sites.manage','routers.read','routers.manage','plans.read','plans.manage','vouchers.read','vouchers.manage','payments.read','payments.manage','gateways.manage','analytics.read','audit.read','bandwidth.manage','contentfilter.manage','portal.manage'] },
  { key: 'technical',    name: 'Technical',    perms: ['routers.read','routers.manage','sites.read','plans.read','vouchers.read','bandwidth.manage','contentfilter.manage','portal.manage','analytics.read','audit.read'] },
  { key: 'collaborator', name: 'Collaborator', perms: ['sites.read','sites.manage','plans.read','vouchers.read','vouchers.manage','portal.manage','analytics.read'] },
  { key: 'viewer',       name: 'Viewer',       perms: ['sites.read','routers.read','plans.read','vouchers.read','analytics.read'] },
];
export const MFA_REQUIRED_ROLES = ['owner', 'admin', 'technical'];

export const PLAN_SCHEMA_FIELDS = ['name', 'priceMinor', 'durationSeconds', 'dataCapMb', 'rateDownKbps', 'rateUpKbps', 'maxDevices', 'maxConcurrentSessions'] as const;