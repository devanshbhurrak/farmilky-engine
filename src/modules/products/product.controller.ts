import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  CreateProductInput,
  ProductIdParam,
  ProductListQuery,
  UpdateProductInput,
} from './product.schema.js';
import {
  createProduct,
  deleteProduct,
  getPublicProduct,
  listPublicProducts,
  resolvePublicTenantId,
  updateProduct,
} from './product.service.js';

async function resolveTenant(c: Context): Promise<string> {
  const query = c.get('query') as ProductListQuery | undefined;
  const headerSlug = c.req.header('x-tenant-slug');
  const rawSlug = new URL(c.req.url).searchParams.get('slug');
  const slug = headerSlug ?? query?.slug ?? rawSlug;
  return resolvePublicTenantId(slug);
}

export const listProductsController = async (c: Context) => {
  const tenantId = await resolveTenant(c);
  const query = (c.get('query') ?? {}) as ProductListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listPublicProducts(tenantId, {
    page,
    limit,
    offset,
    category: query.category,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const getProductController = async (c: Context) => {
  const tenantId = await resolveTenant(c);
  const params = c.get('params') as ProductIdParam;
  const product = await getPublicProduct(tenantId, params.id);
  return ok(c, product);
};

export const createProductController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateProductInput;
  const product = await createProduct(user.tenantId, body);
  return created(c, product);
};

export const updateProductController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ProductIdParam;
  const body = c.get('body') as UpdateProductInput;
  const product = await updateProduct(user.tenantId, params.id, body);
  return ok(c, product);
};

export const deleteProductController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ProductIdParam;
  await deleteProduct(user.tenantId, params.id);
  return ok(c, { deleted: true });
};
