// Ported from backend/constants/permissions.js
export const PERMISSIONS = {
  PROFILE_VIEW: 'profile.view',
  PROFILE_UPDATE: 'profile.update',
  MANIFEST_VIEW_TODAY: 'manifest.view_today',
  MANIFEST_VIEW_HISTORY: 'manifest.view_history',
  MANIFEST_UPDATE: 'manifest.update',
  DELIVERY_BOARD_VIEW: 'delivery_board.view',
  COLLECTION_RECORD: 'collection.record',
  COLLECTION_VIEW_HISTORY: 'collection.view_history',
  CUSTOMER_VIEW_BASIC: 'customer.view_basic',
  AREA_VIEW: 'area.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

export const PERMISSION_META: Record<string, { label: string; group: string }> = {
  'profile.view': { label: 'View profile', group: 'Profile' },
  'profile.update': { label: 'Update profile', group: 'Profile' },
  'manifest.view_today': { label: "View today's manifest", group: 'Manifest' },
  'manifest.view_history': { label: 'View manifest history', group: 'Manifest' },
  'manifest.update': { label: 'Update manifest entries', group: 'Manifest' },
  'delivery_board.view': { label: 'View delivery board', group: 'Deliveries' },
  'collection.record': { label: 'Record collections', group: 'Collections' },
  'collection.view_history': { label: 'View collection history', group: 'Collections' },
  'customer.view_basic': { label: 'View basic customer info', group: 'Customers' },
  'area.view': { label: 'View areas', group: 'Areas' },
};

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  agent: [...ALL_PERMISSIONS],
  delivery: [...ALL_PERMISSIONS],
  delivery_partner: [...ALL_PERMISSIONS],
};

export const DELIVERY_ROLES = new Set(['agent', 'delivery', 'delivery_partner']);
