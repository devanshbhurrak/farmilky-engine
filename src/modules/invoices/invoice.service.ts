// Module façade over the shared invoice service.
//
// payments/returns modules dynamically import '../invoices/invoice.service.js'
// expecting a named `syncInvoiceStatusAfterPayment` export — this file
// guarantees that contract. Core logic lives in the shared service so both
// entry points share one implementation.
export {
  generateInvoice,
  generateBulkInvoices,
  syncInvoiceStatusAfterPayment,
  markOverdueInvoices,
  getPreviousBalance,
  getInvoiceDetail,
  getMyInvoiceDetail,
  lastDayOfMonth,
  netPayable,
  invoiceService,
} from '../../shared/services/invoiceService.js';
export type {
  GenerateInvoiceOptions,
  BulkInvoiceOptions,
} from '../../shared/services/invoiceService.js';
