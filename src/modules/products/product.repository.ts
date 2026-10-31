import { and, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { customerPrices, products, productVariants, tenants } from '../../shared/db/schema/index.js';

export async function findTenantBySlug(slug: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0];
}

interface ProductListFilters {
  category?: string;
  search?: string;
  isAvailable?: boolean;
}

function buildProductConditions(tenantId: string, opts: ProductListFilters) {
  const conditions = [eq(products.tenantId, tenantId), isNull(products.deletedAt)];
  if (opts.category) {
    conditions.push(eq(products.category, opts.category as typeof products.category.enumValues[number]));
  }
  if (opts.isAvailable !== undefined) {
    conditions.push(eq(products.isAvailable, opts.isAvailable));
  }
  if (opts.search && opts.search.trim() !== '') {
    const q = `%${opts.search.trim()}%`;
    conditions.push(or(ilike(products.name, q), ilike(products.description, q))!);
  }
  return and(...conditions);
}

export async function listProducts(
  tenantId: string,
  opts: { limit: number; offset: number } & ProductListFilters,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(products)
    .where(buildProductConditions(tenantId, opts))
    .orderBy(products.sortOrder, products.name)
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countProducts(
  tenantId: string,
  opts: ProductListFilters,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(products)
    .where(buildProductConditions(tenantId, opts));
  return rows[0]?.value ?? 0;
}

export async function findProductById(tenantId: string, productId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function findVariantsByProductId(tenantId: string, productId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.productId, productId)))
    .orderBy(productVariants.sortOrder, productVariants.label);
}

export async function findVariantsByProductIds(
  tenantId: string,
  productIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (productIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.tenantId, tenantId), inArray(productVariants.productId, productIds)))
    .orderBy(productVariants.sortOrder, productVariants.label);
}

export async function findVariantById(tenantId: string, variantId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, variantId)))
    .limit(1);
  return rows[0];
}

export interface NewProductRow {
  name: string;
  description?: string | null;
  category: typeof products.category.enumValues[number];
  basePrice?: number | string | null;
  unit?: typeof products.unit.enumValues[number];
  fatContent?: number | string | null;
  stock?: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  sortOrder?: number;
}

export async function createProductRow(tenantId: string, data: NewProductRow, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .insert(products)
    .values({
      tenantId,
      name: data.name,
      description: data.description ?? null,
      category: data.category,
      basePrice: data.basePrice == null ? null : String(data.basePrice),
      unit: data.unit ?? 'L',
      fatContent: data.fatContent == null ? null : String(data.fatContent),
      stock: data.stock ?? 0,
      imageUrl: data.imageUrl ?? null,
      isAvailable: data.isAvailable ?? true,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();
  return rows[0]!;
}

export async function updateProductRow(
  tenantId: string,
  productId: string,
  data: Partial<NewProductRow>,
  dbOrTx: DBOrTx = db,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.category !== undefined) patch.category = data.category;
  if (data.basePrice !== undefined) patch.basePrice = data.basePrice == null || data.basePrice === '' ? null : String(data.basePrice);
  if (data.unit !== undefined) patch.unit = data.unit;
  if (data.fatContent !== undefined) patch.fatContent = data.fatContent == null || data.fatContent === '' ? null : String(data.fatContent);
  if (data.stock !== undefined) patch.stock = data.stock;
  if (data.imageUrl !== undefined) patch.imageUrl = data.imageUrl;
  if (data.isAvailable !== undefined) patch.isAvailable = data.isAvailable;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  const rows = await (dbOrTx as typeof db)
    .update(products)
    .set(patch)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)))
    .returning();
  return rows[0];
}

export async function softDeleteProductRow(tenantId: string, productId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .update(products)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)))
    .returning({ id: products.id });
  return rows[0];
}

export interface NewVariantRow {
  label: string;
  quantity: number | string;
  unit: typeof productVariants.unit.enumValues[number];
  price: number | string;
  discountedPrice?: number | string | null;
  stock?: number;
  isDefault?: boolean;
  isAvailable?: boolean;
  sortOrder?: number;
}

export async function createVariantRows(
  tenantId: string,
  productId: string,
  variants: NewVariantRow[],
  dbOrTx: DBOrTx = db,
) {
  if (variants.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(productVariants)
    .values(
      variants.map((v) => ({
        tenantId,
        productId,
        label: v.label,
        quantity: String(v.quantity),
        unit: v.unit,
        price: String(v.price),
        discountedPrice: v.discountedPrice == null || v.discountedPrice === '' ? null : String(v.discountedPrice),
        stock: v.stock ?? 0,
        isDefault: v.isDefault ?? false,
        isAvailable: v.isAvailable ?? true,
        sortOrder: v.sortOrder ?? 0,
      })),
    )
    .returning();
}

export async function updateVariantRow(
  tenantId: string,
  productId: string,
  variantId: string,
  data: Partial<NewVariantRow>,
  dbOrTx: DBOrTx = db,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.label !== undefined) patch.label = data.label;
  if (data.quantity !== undefined) patch.quantity = String(data.quantity);
  if (data.unit !== undefined) patch.unit = data.unit;
  if (data.price !== undefined) patch.price = String(data.price);
  if (data.discountedPrice !== undefined)
    patch.discountedPrice = data.discountedPrice == null || data.discountedPrice === '' ? null : String(data.discountedPrice);
  if (data.stock !== undefined) patch.stock = data.stock;
  if (data.isDefault !== undefined) patch.isDefault = data.isDefault;
  if (data.isAvailable !== undefined) patch.isAvailable = data.isAvailable;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  const rows = await (dbOrTx as typeof db)
    .update(productVariants)
    .set(patch)
    .where(
      and(
        eq(productVariants.tenantId, tenantId),
        eq(productVariants.productId, productId),
        eq(productVariants.id, variantId),
      ),
    )
    .returning();
  return rows[0];
}

export async function deleteVariantsExcluding(
  tenantId: string,
  productId: string,
  keepIds: string[],
  dbOrTx: DBOrTx = db,
) {
  const base = and(eq(productVariants.tenantId, tenantId), eq(productVariants.productId, productId));
  if (keepIds.length === 0) {
    return (dbOrTx as typeof db).delete(productVariants).where(base);
  }
  return (dbOrTx as typeof db)
    .delete(productVariants)
    .where(and(base, notInArray(productVariants.id, keepIds)));
}

export async function findApplicableCustomerPrice(
  tenantId: string,
  userId: string,
  variantId: string,
  productId: string,
  today: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(customerPrices)
    .where(
      and(
        eq(customerPrices.tenantId, tenantId),
        eq(customerPrices.userId, userId),
        eq(customerPrices.productId, productId),
        sql`${customerPrices.effectiveFrom} <= ${today}`,
        sql`(${customerPrices.effectiveUntil} IS NULL OR ${customerPrices.effectiveUntil} >= ${today})`,
      ),
    )
    .orderBy(desc(customerPrices.effectiveFrom))
    .limit(20);
  const relevant = rows.filter((r) => r.variantId === variantId || r.variantId === null);
  relevant.sort((a, b) => {
    const aSpecific = a.variantId !== null ? 0 : 1;
    const bSpecific = b.variantId !== null ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    return b.effectiveFrom.localeCompare(a.effectiveFrom);
  });
  return relevant[0];
}

export async function decrementVariantStockRow(
  tenantId: string,
  variantId: string,
  qty: number,
  dbOrTx: DBOrTx = db,
) {
  const result = await (dbOrTx as typeof db).execute(
    sql`UPDATE product_variants SET stock = stock - ${qty}, updated_at = NOW() WHERE id = ${variantId} AND tenant_id = ${tenantId} AND stock >= ${qty} RETURNING id`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as unknown[];
  return rows;
}

export async function incrementVariantStockRow(
  tenantId: string,
  variantId: string,
  qty: number,
  dbOrTx: DBOrTx = db,
) {
  const result = await (dbOrTx as typeof db).execute(
    sql`UPDATE product_variants SET stock = stock + ${qty}, updated_at = NOW() WHERE id = ${variantId} AND tenant_id = ${tenantId} RETURNING id`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as unknown[];
  return rows;
}
