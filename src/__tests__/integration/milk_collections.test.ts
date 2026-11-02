import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';
import { toDateOnlyString, istToday } from '../../shared/utils/dateUtils.js';

dbOnly('Milk Collection End-to-End Suite', () => {
  it('performs full milk collection lifecycle: generate, daily list, confirm, no supply, history aggregates, edit correction, and missing detection', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { createSupplier } = await import('../../modules/suppliers/supplier.service.js');
    const {
      generateCollections,
      getDailyCollections,
      confirmCollection,
      getCollectionHistory,
      updateCollection,
      getMissingCollections,
      getTodayShift,
    } = await import('../../modules/milk-collections/milkCollection.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { suppliers } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Milk Integration Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    // 1. Create 2 suppliers with morning & evening sessions
    const sup1 = await createSupplier(tenantId, {
      name: 'Farmer Ramesh',
      phone: `91${Date.now().toString().slice(-8)}`,
      morningSession: true,
      eveningSession: true,
      defaultMorningQty: 25,
      expectedEveningQty: 20,
      defaultRatePerLiter: 42.5,
    } as never, adminId);

    const sup2 = await createSupplier(tenantId, {
      name: 'Farmer Suresh',
      phone: `92${Date.now().toString().slice(-8)}`,
      morningSession: true,
      eveningSession: false,
      defaultMorningQty: 15,
      defaultRatePerLiter: 40,
    } as never, adminId);

    const today = toDateOnlyString(istToday());

    // 2. Test Auto-Generation via generateCollections
    const genResult = await generateCollections(tenantId, today, adminId);
    expect(genResult.created).toBe(3); // sup1 morning & evening + sup2 morning
    expect(genResult.date).toBe(today);

    // 3. Test getDailyCollections (returns collections + summary stats + supplierPhone)
    const daily = await getDailyCollections(tenantId, today);
    expect(daily.collections.length).toBe(3);
    expect(daily.summary.total).toBe(3);
    expect(daily.summary.pending).toBe(3);
    expect(daily.summary.confirmed).toBe(0);
    expect(daily.summary.totalLiters).toBe(0);
    expect(daily.summary.totalAmount).toBe(0);

    const rameshMorning = daily.collections.find((c) => c.supplierId === sup1.id && c.session === 'morning');
    expect(rameshMorning).toBeDefined();
    expect(rameshMorning?.supplierPhone).toBe(sup1.phone);
    expect(rameshMorning?.expectedQty).toBe(25);
    expect(rameshMorning?.status).toBe('pending');
    expect(rameshMorning?.isConfirmed).toBe(false);

    // 4. Test Single Confirm with actualQty, ratePerLiter, fat, snf
    const confirmRes = await confirmCollection(
      tenantId,
      rameshMorning!.id,
      {
        actualQty: 26.5,
        ratePerLiter: 43,
        fatContent: 4.2,
        snf: 8.6,
        notes: 'Good quality batch',
      },
      adminId,
    );
    expect(confirmRes.collection.status).toBe('confirmed');
    expect(Number(confirmRes.collection.actualQty)).toBe(26.5);
    expect(Number(confirmRes.collection.ratePerLiter)).toBe(43);
    expect(Number(confirmRes.collection.fatContent)).toBe(4.2);
    expect(Number(confirmRes.collection.snf)).toBe(8.6);
    expect(confirmRes.txn).toBeDefined(); // Credit transaction created for supplier
    expect(Number(confirmRes.txn?.amount)).toBe(1139.5); // 26.5 * 43

    // 5. Test "No Supply" Shortcut (actualQty = 0)
    const sureshMorning = daily.collections.find((c) => c.supplierId === sup2.id && c.session === 'morning');
    expect(sureshMorning).toBeDefined();
    const noSupplyRes = await confirmCollection(
      tenantId,
      sureshMorning!.id,
      {
        actualQty: 0,
        ratePerLiter: 40,
      },
      adminId,
    );
    expect(noSupplyRes.collection.status).toBe('confirmed');
    expect(Number(noSupplyRes.collection.actualQty)).toBe(0);
    expect(noSupplyRes.txn).toBeNull(); // No financial transaction created for 0 L

    // 6. Test Daily Summary & Shift Stats updated in DB
    const dailyAfterConfirm = await getDailyCollections(tenantId, today);
    expect(dailyAfterConfirm.summary.confirmed).toBe(2);
    expect(dailyAfterConfirm.summary.pending).toBe(1);
    expect(dailyAfterConfirm.summary.totalLiters).toBe(26.5);
    expect(dailyAfterConfirm.summary.totalAmount).toBe(1139.5);

    const shift = await getTodayShift(tenantId);
    expect(shift.morning.confirmed).toBe(2);
    expect(shift.morning.total).toBe(2);
    expect(shift.morning.qty).toBe(26.5);
    expect(shift.morning.amount).toBe(1139.5);
    expect(shift.evening.confirmed).toBe(0);
    expect(shift.evening.total).toBe(1);

    // 7. Test History Query & Aggregates
    const history = await getCollectionHistory(tenantId, {
      startDate: today,
      endDate: today,
      page: '1',
      limit: '50',
    });
    expect(history.rows.length).toBe(3);
    expect(history.aggregates.totalLiters).toBe(26.5);
    expect(history.aggregates.totalAmount).toBe(1139.5);
    expect(history.aggregates.avgFat).toBe(4.2);
    expect(history.aggregates.avgSnf).toBe(8.6);
    expect(history.rows[0].supplierPhone).toBeDefined();

    // 8. Test Update / Correction of Confirmed Entry
    const updated = await updateCollection(
      tenantId,
      rameshMorning!.id,
      {
        actualQty: 25.0,
        ratePerLiter: 42.5,
        fatContent: 4.0,
        snf: 8.5,
        notes: 'Corrected quantity',
      },
      adminId,
    );
    expect(updated.collection.status).toBe('confirmed');
    expect(Number(updated.collection.actualQty)).toBe(25.0);
    expect(Number(updated.collection.ratePerLiter)).toBe(42.5);
    expect(updated.txn).toBeDefined();
    expect(Number(updated.txn?.amount)).toBe(1062.5); // 25 * 42.5

    // Verify DB supplier balance updated
    const [sup1Db] = await db.select().from(suppliers).where(eq(suppliers.id, sup1.id));
    expect(Number(sup1Db.balance)).toBe(1062.5);

    // 9. Test Missing Detection
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    const pastDateStr = toDateOnlyString(pastDate);
    const missing = await getMissingCollections(tenantId, {
      startDate: pastDateStr,
      endDate: pastDateStr,
    });
    // For past date, no records exist yet for active suppliers
    expect(missing.total).toBe(3); // sup1 (morning, evening) + sup2 (morning)
    expect(missing.missing.some((m) => m.supplierId === sup1.id && m.session === 'morning')).toBe(true);
  });
});
