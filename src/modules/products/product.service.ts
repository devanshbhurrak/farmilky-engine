import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { toDateOnlyString } from '../../shared/utils/dateUtils.js';
import type { CreateProductInput, UpdateProductInput, UpdateVariantInput } from './product.schema.js';
import {
  countProducts,
  createProductRow,
  createVariantRows,
  decrementVariantStockRow,
  deleteVariantsExcluding,
  findApplicableCustomerPrice,
  findProductById,
  findTenantBySlug,
  findVariantById,
  findVariantsByProductId,
  findVariantsByProductIds,
  incrementVariantStockRow,
  listProducts,
  softDeleteProductRow,
  updateProductRow,
  updateVariantRow,
} from './product.repository.js';

export async function resolvePublicTenantId(slug: string | undefined | null): Promise<string> {
  if (!slug) throw new AppError('Tenant slug is required', 400);
  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new AppError('Unknown tenant', 400);
  return tenant.id;
}

function normalizeDefaults<T extends { isDefault?: boolean }>(variants: T[]): T[] {
  let seenDefault = false;
  return variants.map((v) => {
    if (v.isDefault && !seenDefault) {
      seenDefault = true;
      return v;
    }
    if (v.isDefault) return { ...v, isDefault: false };
    return v;
  });
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export async function listPublicProducts(
  tenantId: string,
  opts: { page: number; limit: number; offset: number; category?: string },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listProducts(tenantId, { limit: opts.limit, offset: opts.offset, category: opts.category }, dbOrTx),
    countProducts(tenantId, { category: opts.category }, dbOrTx),
  ]);
  const variants = await findVariantsByProductIds(
    tenantId,
    items.map((p) => p.id),
    dbOrTx,
  );
  const byProduct = new Map<string, typeof variants>();
  for (const v of variants) {
    const arr = byProduct.get(v.productId) ?? [];
    arr.push(v);
    byProduct.set(v.productId, arr);
  }
  return { items: items.map((p) => ({ ...p, variants: byProduct.get(p.id) ?? [] })), total };
}

export async function getPublicProduct(tenantId: string, productId: string, dbOrTx: DBOrTx = db) {
  const product = await findProductById(tenantId, productId, dbOrTx);
  if (!product) throw new AppError('Product not found', 404);
  const variants = await findVariantsByProductId(tenantId, productId, dbOrTx);
  return { ...product, variants };
}

export async function createProduct(tenantId: string, input: CreateProductInput, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const product = await createProductRow(
      tenantId,
      {
        name: input.name,
        description: input.description,
        category: input.category,
        basePrice: input.basePrice,
        unit: input.unit,
        fatContent: input.fatContent,
        stock: input.stock,
        imageUrl: input.imageUrl,
        isAvailable: input.isAvailable,
        sortOrder: input.sortOrder,
      },
      t,
    );
    const variants = normalizeDefaults(input.variants ?? []);
    const created = await createVariantRows(tenantId, product.id, variants, t);
    return { ...product, variants: created };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  input: UpdateProductInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const existing = await findProductById(tenantId, productId, t);
    if (!existing) throw new AppError('Product not found', 404);

    const { variants, ...fields } = input;
    const updated = await updateProductRow(tenantId, productId, stripUndefined(fields as Record<string, unknown>) as Parameters<typeof updateProductRow>[2], t);
    if (!updated) throw new AppError('Product not found', 404);

    let variantRows = await findVariantsByProductId(tenantId, productId, t);
    if (variants !== undefined) {
      const normalized = normalizeDefaults(variants);
      const keepIds: string[] = [];
      for (const v of normalized) {
        if (v.id) {
          const patch = stripUndefined({
            label: v.label,
            quantity: v.quantity,
            unit: v.unit,
            price: v.price,
            discountedPrice: v.discountedPrice,
            stock: v.stock,
            isDefault: v.isDefault,
            isAvailable: v.isAvailable,
            sortOrder: v.sortOrder,
          } satisfies Record<string, unknown>) as Partial<UpdateVariantInput>;
          const row = await updateVariantRow(tenantId, productId, v.id, patch, t);
          if (!row) throw new AppError('Product variant not found', 404);
          keepIds.push(v.id);
        } else {
          if (v.label === undefined || v.quantity === undefined || v.unit === undefined || v.price === undefined) {
            throw new AppError('New variants require label, quantity, unit and price', 422);
          }
          const created = await createVariantRows(
            tenantId,
            productId,
            [
              {
                label: v.label,
                quantity: v.quantity,
                unit: v.unit,
                price: v.price,
                discountedPrice: v.discountedPrice,
                stock: v.stock ?? 0,
                isDefault: v.isDefault ?? false,
                isAvailable: v.isAvailable ?? true,
                sortOrder: v.sortOrder ?? 0,
              },
            ],
            t,
          );
          if (created[0]) keepIds.push(created[0].id);
        }
      }
      await deleteVariantsExcluding(tenantId, productId, keepIds, t);
      variantRows = await findVariantsByProductId(tenantId, productId, t);
    }
    return { ...updated, variants: variantRows };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function deleteProduct(tenantId: string, productId: string, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const row = await softDeleteProductRow(tenantId, productId, t);
    if (!row) throw new AppError('Product not found', 404);
    return row;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function resolvePrice(
  tenantId: string,
  userId: string | null | undefined,
  variantId: string,
  dbOrTx: DBOrTx = db,
): Promise<{ price: number; isCustom: boolean }> {
  const variant = await findVariantById(tenantId, variantId, dbOrTx);
  if (!variant) throw new AppError('Product variant not found', 404);

  if (userId) {
    const today = toDateOnlyString(new Date());
    const custom = await findApplicableCustomerPrice(
      tenantId,
      userId,
      variantId,
      variant.productId,
      today,
      dbOrTx,
    );
    if (custom) return { price: Number(custom.price), isCustom: true };
  }

  if (variant.discountedPrice !== null && variant.discountedPrice !== undefined) {
    return { price: Number(variant.discountedPrice), isCustom: false };
  }
  if (variant.price !== null && variant.price !== undefined) {
    return { price: Number(variant.price), isCustom: false };
  }
  const product = await findProductById(tenantId, variant.productId, dbOrTx);
  if (product?.basePrice !== null && product?.basePrice !== undefined) {
    return { price: Number(product.basePrice), isCustom: false };
  }
  throw new AppError('Price not available for variant', 404);
}

export async function decrementVariantStock(
  tenantId: string,
  variantId: string,
  qty: number,
  tx: DBOrTx = db,
): Promise<void> {
  const rows = await decrementVariantStockRow(tenantId, variantId, qty, tx);
  if (rows.length === 0) throw new AppError('Insufficient stock for variant', 409);
}

export async function incrementVariantStock(
  tenantId: string,
  variantId: string,
  qty: number,
  tx: DBOrTx = db,
): Promise<void> {
  const rows = await incrementVariantStockRow(tenantId, variantId, qty, tx);
  if (rows.length === 0) throw new AppError('Product variant not found', 404);
}
