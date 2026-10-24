import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  findActiveByParty,
  findActiveByPartyAndPeriod,
  findTransactionById,
} from '../transactions/transaction.repository.js';

export interface PassbookFilters {
  startDate?: string;
  endDate?: string;
}

export async function findPaymentById(paymentTxnId: string, tenantId: string, dbOrTx: DBOrTx = db) {
  return findTransactionById(paymentTxnId, tenantId, dbOrTx);
}

export async function listCustomerPassbook(
  tenantId: string,
  userId: string,
  filters: PassbookFilters,
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  return findActiveByParty(tenantId, 'customer', userId, filters, pagination, dbOrTx);
}

/**
 * Returns every active transaction for a customer within a period, without
 * pagination. Used by the ledger view so monthly totals can never be truncated
 * by the default passbook page size.
 */
export async function listCustomerLedgerForPeriod(
  tenantId: string,
  userId: string,
  startDate: string,
  endDate: string,
  dbOrTx: DBOrTx = db,
) {
  return findActiveByPartyAndPeriod(tenantId, 'customer', userId, startDate, endDate, dbOrTx);
}
