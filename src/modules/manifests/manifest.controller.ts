import type { Context } from 'hono';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok } from '../../shared/utils/response.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import type {
  GenerateInput,
  ManifestEntryParam,
  ManifestHistoryQuery,
  ManifestIdParam,
  ManifestQuery,
  ResequenceInput,
  UpdateEntryInput,
} from './manifest.schema.js';
import {
  generateManifests,
  getHistoryService,
  getManifestService,
  getMyTodayService,
  listManifestsByDateService,
  resequenceService,
  updateManifestEntry,
} from './manifest.service.js';

export const generateManifestsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = (c.get('body') ?? {}) as GenerateInput;
  const date = body.date ?? toDateOnlyString(istToday());
  const result = await generateManifests(user.tenantId, date, body.slot ?? 'both');
  if (result.skipped) return ok(c, { message: 'No deliveries scheduled — this date is a holiday.', ...result });
  return created(c, result);
};

export const listManifestsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ManifestQuery;
  const date = query.date ?? toDateOnlyString(istToday());
  const manifests = await listManifestsByDateService(user.tenantId, date, query.slot);
  return ok(c, { count: manifests.length, manifests });
};

export const getManifestController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ManifestIdParam;
  const manifest = await getManifestService(user.tenantId, params.id);
  return ok(c, { manifest });
};

export const myTodayManifestController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const result = await getMyTodayService(user.tenantId, user.id);
  return ok(c, result);
};

export const myHistoryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ManifestHistoryQuery;
  const result = await getHistoryService(user.tenantId, user.id, query.fromDate);
  return ok(c, result);
};

export const resequenceManifestController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ManifestIdParam;
  const body = c.get('body') as ResequenceInput;
  const manifest = await resequenceService(user.tenantId, params.id, body.orderedEntryIds);
  return ok(c, { message: 'Manifest resequenced.', manifest });
};

export const updateManifestEntryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ManifestEntryParam;
  const body = c.get('body') as UpdateEntryInput;
  const result = await updateManifestEntry(user.tenantId, params.entryId, body, {
    id: user.id,
    role: user.role,
  });
  if (result.manifest.id !== params.id) {
    throw new AppError('Entry not found in manifest.', 404);
  }
  return ok(c, { message: 'Entry updated.', entry: result.entry, manifestComplete: result.manifestComplete });
};
