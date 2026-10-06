import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  AgentIdParam,
  AgentListQuery,
  AgentPerformanceQuery,
  AgentStatusInput,
  AssignAreaInput,
  CreateAgentInput,
  UpdateAgentInput,
} from './agent.schema.js';
import {
  assignAgentAreaService,
  createAgentService,
  getAgentPerformanceService,
  getAgentService,
  listAgentsService,
  removeAgentService,
  setAgentStatusService,
  updateAgentService,
} from './agent.service.js';

export const listAgentsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AgentListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listAgentsService(
    user.tenantId,
    { search: query.search },
    { limit, offset },
  );
  return paginated(c, items, buildMeta(total, page, limit));
};

export const createAgentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateAgentInput;
  const agent = await createAgentService(user.tenantId, body, user.id);
  return created(c, agent);
};

export const getAgentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const agent = await getAgentService(user.tenantId, params.id);
  return ok(c, agent);
};

export const updateAgentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const body = c.get('body') as UpdateAgentInput;
  const agent = await updateAgentService(user.tenantId, params.id, body);
  return ok(c, agent);
};

export const setAgentStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const body = c.get('body') as AgentStatusInput;
  const result = await setAgentStatusService(user.tenantId, params.id, body.isActive);
  return ok(c, result);
};

export const assignAgentAreaController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const body = c.get('body') as AssignAreaInput;
  const agent = await assignAgentAreaService(user.tenantId, params.id, body.areaId);
  return ok(c, agent);
};

export const removeAgentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const result = await removeAgentService(user.tenantId, params.id);
  return ok(c, result);
};

export const getAgentPerformanceController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AgentIdParam;
  const query = (c.get('query') ?? {}) as AgentPerformanceQuery;
  const performance = await getAgentPerformanceService(user.tenantId, params.id, {
    startDate: query.startDate,
  });
  return ok(c, performance);
};
