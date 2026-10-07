export type ProfitInvoice = { id: number; invoice_date: string | null; total_amount: number | null };
export type ProfitJob = { job_date: string | null; repairing_quantity: number | null; warranty_quantity: number | null; reject_quantity?: number | null };
export type ProfitBankRow = { transaction_date: string | null; created_at: string | null; amount: number | null; debit_amount: number | null; payment_out: number | null; payment_in: number | null; particulars: string | null; type: string | null; transaction_type: string | null; is_transfer?: boolean | null; bounced_at?: string | null };
export type ProfitPurchase = { inward_no: string | null; purchase_no?: string | null; item_name: string | null; item_code?: string | null; rate: number | null; purchase_rate?: number | null; quantity: number | null };
export type ProfitItem = { id: number; item_name: string | null; item_code: string | null; purchase_price: number | null; cost_price: number | null; opening_stock: number | null };
export type ProfitLine = { invoice_id: number; inward_no: string | null; item_name: string | null; item_code?: string | null; quantity: number | null; cost_rate: number | null; total_cost?: number | null };
export type ProfitMonthly = { key: string; label: string; sale: number; cost: number; expense: number; grossProfit: number; deduction: number; netProfit: number; personal: number; saving: number; repairQty: number; warrantyQty: number };

const months = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
export const currentYear = new Date().getFullYear();
export const toNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const money = (value: number) => `₹ ${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const dateOnly = (value?: string | null) => String(value || "").slice(0, 10);
export const fyStart = (value: string) => Number(value.slice(0, 4)) || currentYear;
export const monthPosition = (value: string | null | undefined, startYear: number) => {
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return -1;
  const expectedYear = date.getMonth() >= 3 ? startYear : startYear + 1;
  if (date.getFullYear() !== expectedYear) return -1;
  return date.getMonth() >= 3 ? date.getMonth() - 3 : date.getMonth() + 9;
};

export const lineCostRate = (line: ProfitLine, purchases: ProfitPurchase[], items: ProfitItem[]) => {
  const purchase = purchases.find((row) => String(row.inward_no || row.purchase_no || "") === String(line.inward_no || "") && String(row.item_name || "").trim().toLowerCase() === String(line.item_name || "").trim().toLowerCase());
  const item = items.find((row) => (line.item_code && row.item_code && String(line.item_code).toLowerCase() === String(row.item_code).toLowerCase()) || String(row.item_name || "").trim().toLowerCase() === String(line.item_name || "").trim().toLowerCase());
  return [line.cost_rate, toNumber(line.total_cost) / Math.max(1, toNumber(line.quantity)), purchase?.rate, purchase?.purchase_rate, item?.purchase_price, item?.cost_price].map(toNumber).find((rate) => rate > 0) || 0;
};

export const computeProfitMonthly = (data: {
  invoices: ProfitInvoice[];
  lines: ProfitLine[];
  purchases: ProfitPurchase[];
  items: ProfitItem[];
  bankRows: ProfitBankRow[];
  jobs: ProfitJob[];
  startYear: number;
}): ProfitMonthly[] => {
  const { invoices, lines, purchases, items, bankRows, jobs, startYear } = data;
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const rateFor = (line: ProfitLine) => lineCostRate(line, purchases, items);

  const rows = months.map((label, index) => ({ key: String(index), label, sale: 0, cost: 0, expense: 0, grossProfit: 0, deduction: 0, netProfit: 0, personal: 0, saving: 0, repairQty: 0, warrantyQty: 0 }));
  invoices.forEach((invoice) => { const index = monthPosition(invoice.invoice_date, startYear); if (index >= 0) rows[index].sale += toNumber(invoice.total_amount); });
  lines.forEach((line) => { const index = monthPosition(invoiceMap.get(line.invoice_id)?.invoice_date, startYear); if (index >= 0) rows[index].cost += toNumber(line.quantity) * rateFor(line); });
  jobs.forEach((job) => { const index = monthPosition(job.job_date, startYear); if (index >= 0) { rows[index].repairQty += toNumber(job.repairing_quantity); rows[index].warrantyQty += toNumber(job.warranty_quantity); } });
  bankRows.forEach((row) => {
    // Bounced/returned payment expense, personal aur deduction — kuch bhi
    // nahi tha; paisa hua hi nahi, isliye poori row skip.
    if (row.bounced_at) return;
    const index = monthPosition(row.transaction_date || row.created_at, startYear); if (index < 0) return;
    const type = String(row.transaction_type || row.type || "").toLowerCase();
    const particulars = String(row.particulars || "").toLowerCase();
    const out = toNumber(row.payment_out || row.debit_amount || row.amount);
    const receipt = type.includes("customer receipt") || particulars.includes("customer receipt");
    const personal = type.includes("owner drawing") || type.includes("personal") || particulars.includes("owner drawing") || particulars.includes("personal");
    const capital = type.includes("capital") || type.includes("deposit") || particulars.includes("capital") || particulars.includes("investment");
    const vendorPayment = type.includes("vendor payment") || type.includes("purchase payment") || particulars.includes("vendor payment") || particulars.includes("purchase payment") || particulars.includes("inw-");
    // Apne hi account me transfer (Cash Box -> HDFC) na income hai na expense —
    // warna har cash deposit profit kam kar degi.
    const transfer = row.is_transfer === true || type.includes("account transfer");
    if (receipt) rows[index].deduction += toNumber(particulars.match(/\[disc:\s*₹([\d.]+)\]/i)?.[1]);
    if (personal) rows[index].personal += out;
    if (!receipt && !personal && !capital && !vendorPayment && !transfer && out > 0) rows[index].expense += out;
  });
  return rows.map((row) => ({ ...row, grossProfit: row.sale - row.cost - row.expense, netProfit: row.sale - row.cost - row.expense - row.deduction, saving: row.sale - row.cost - row.expense - row.deduction - row.personal }));
};

export const profitTotals = (monthly: ProfitMonthly[]) => monthly.reduce((sum, row) => ({
  sale: sum.sale + row.sale, cost: sum.cost + row.cost, expense: sum.expense + row.expense, grossProfit: sum.grossProfit + row.grossProfit, deduction: sum.deduction + row.deduction, netProfit: sum.netProfit + row.netProfit, personal: sum.personal + row.personal, saving: sum.saving + row.saving, repairQty: sum.repairQty + row.repairQty, warrantyQty: sum.warrantyQty + row.warrantyQty,
}), { sale: 0, cost: 0, expense: 0, grossProfit: 0, deduction: 0, netProfit: 0, personal: 0, saving: 0, repairQty: 0, warrantyQty: 0 });