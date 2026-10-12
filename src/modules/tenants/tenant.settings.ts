import type { DBOrTx } from '../../shared/types/index.js';
import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from '../../shared/db/schema/tenants.js';
import { findTenantById } from './tenant.repository.js';

export type { TenantSettings };

// Single source of truth lives next to the column definition.
export const DEFAULT_RETURN_WINDOW_MS = DEFAULT_TENANT_SETTINGS.returnWindowMs;
export const DEFAULT_VACATION_MAX_DAYS = DEFAULT_TENANT_SETTINGS.vacationMaxDays;

export interface ResolvedTenantSettings {
  returnWindowMs: number;
  vacationMaxDays: number;
}

/**
 * Load per-tenant business-rule overrides from `tenants.tenant_settings`
 * (JSONB), falling back to built-in defaults for missing/invalid keys.
 */
export async function getTenantSettings(
  tenantId: string,
  dbOrTx: DBOrTx,
): Promise<ResolvedTenantSettings> {
  let raw: TenantSettings = {};
  try {
    const tenant = await findTenantById(tenantId, dbOrTx);
    if (tenant?.tenantSettings && typeof tenant.tenantSettings === 'object') {
      raw = tenant.tenantSettings as TenantSettings;
    }
  } catch {
    raw = {};
  }
  const returnWindowMs =
    typeof raw.returnWindowMs === 'number' &&
    Number.isFinite(raw.returnWindowMs) &&
    raw.returnWindowMs > 0
      ? raw.returnWindowMs
      : DEFAULT_RETURN_WINDOW_MS;
  const vacationMaxDays =
    typeof raw.vacationMaxDays === 'number' &&
    Number.isFinite(raw.vacationMaxDays) &&
    raw.vacationMaxDays > 0
      ? Math.floor(raw.vacationMaxDays)
      : DEFAULT_VACATION_MAX_DAYS;
  return { returnWindowMs, vacationMaxDays };
}
