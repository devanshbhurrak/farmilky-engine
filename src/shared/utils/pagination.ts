export interface PaginationQuery {
  page?: string | number;
  limit?: string | number;
  sortBy?: string;
  sortOrder?: string;
}

export interface ParsedPagination {
  page: number;
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

export function parsePagination(
  query: PaginationQuery,
  opts?: { maxLimit?: number; defaultLimit?: number; allowedSortFields?: string[] },
): ParsedPagination {
  const maxLimit = opts?.maxLimit ?? 100;
  const defaultLimit = opts?.defaultLimit ?? 20;
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit ?? defaultLimit) || defaultLimit));
  let sortBy: string | undefined;
  if (query.sortBy && (!opts?.allowedSortFields || opts.allowedSortFields.includes(query.sortBy))) {
    sortBy = query.sortBy;
  }
  const sortOrder = String(query.sortOrder ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { page, limit, offset: (page - 1) * limit, sortBy, sortOrder };
}

export function buildMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
