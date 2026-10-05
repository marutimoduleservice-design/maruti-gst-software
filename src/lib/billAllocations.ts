/**
 * Vendor payment vouchers se bill allocation ka shared logic.
 *
 * `purchases` table me `pending_amount` / `paid_amount` / `deduction_amount`
 * koi column nahi hai - ye sab runtime par Bank Passbook ke "Vendor Payment"
 * vouchers se nikalte hain. Payments & Ledger aur Purchase Report dono ko
 * bilkul same figure dena hai, isliye logic ek jagah rakha gaya hai.
 */

export type AllocBill = { id: number; ref: string; date: string; total: number };
export type BillAllocation = { paid: number; deduction: number };

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A voucher row stores BOTH sides: a vendor payment has payment_in = 0 and
// payment_out = amount, a receipt the other way round. "?? " cannot be used here —
// 0 is not nullish — so pick the first non-zero side, else fall back to `amount`.
export const voucherAmount = (row: any): number => {
  const pIn = Number(row.payment_in ?? row.credit_amount ?? 0);
  const pOut = Number(row.payment_out ?? row.debit_amount ?? 0);
  if (pIn || pOut) return pIn || pOut;
  return Number(row.amount || 0);
};

export const isVendorPaymentRow = (row: any) =>
  String(row.transaction_type || "").toLowerCase().includes("vendor payment") ||
  String(row.particulars || "").toLowerCase().includes("vendor payment");

// A voucher row can carry per-bill amounts ("INV-01: 500, INV-02: 300") or only a
// voucher total. When explicit amounts exist they win, otherwise the amount is
// spread over the referenced bills in date order (oldest first).
export const buildAllocations = (bills: AllocBill[], rows: any[]): Map<number, BillAllocation> => {
  const allocations = new Map<number, BillAllocation>();
  const refs = bills.map((b) => b.ref).filter(Boolean);

  rows.forEach((row: any) => {
    const particulars = String(row.particulars || "");
    if (!particulars) return;

    const explicit = new Map<string, number>();
    let anyExplicit = false;
    refs.forEach((ref) => {
      const m = particulars.match(new RegExp(`${escapeRegExp(ref)}:\\s*([\\d.]+)`));
      if (m) {
        explicit.set(ref, Number(m[1]) || 0);
        anyExplicit = true;
      }
    });

    const referenced = bills
      .filter((b) => b.ref && particulars.includes(b.ref))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.id - b.id;
      });
    if (referenced.length === 0) return;

    let remainingPaid = voucherAmount(row);
    let remainingDeduction = Number(particulars.match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);

    referenced.forEach((bill) => {
      const previous = allocations.get(bill.id) || { paid: 0, deduction: 0 };
      const outstandingBefore = Math.max(0, bill.total - previous.paid - previous.deduction);

      let paidForBill: number;
      if (anyExplicit && explicit.has(bill.ref)) {
        paidForBill = Math.min(explicit.get(bill.ref) || 0, outstandingBefore);
      } else if (anyExplicit) {
        paidForBill = 0;
      } else {
        paidForBill = Math.min(remainingPaid, outstandingBefore);
      }
      remainingPaid -= paidForBill;

      const outstandingAfter = Math.max(0, outstandingBefore - paidForBill);
      const deductionForBill = Math.min(remainingDeduction, outstandingAfter);
      remainingDeduction -= deductionForBill;

      allocations.set(bill.id, {
        paid: previous.paid + paidForBill,
        deduction: previous.deduction + deductionForBill,
      });
    });
  });

  return allocations;
};

/**
 * Purchase bill ka due amount: Bill total - (paid + deduction).
 * Payments & Ledger isi value ko "Pending" dikhata hai.
 */
export const purchaseDueAmount = (
  purchase: { total_amount?: number | null; quantity?: number | null; rate?: number | null },
  allocation?: BillAllocation
) => {
  const total = Number(
    purchase.total_amount ?? Number(purchase.quantity || 0) * Number(purchase.rate || 0)
  );
  const paid = Number(allocation?.paid || 0) + Number(allocation?.deduction || 0);
  return Math.max(0, total - paid);
};

/**
 * Vendor payment vouchers particulars me saare inward numbers chipke hote hain
 * ( kabhi 40+ ), jisse passbook ki line unreadably lambi ho jaati hai. Display ke
 * liye un inward numbers ko unke PO number se replace kar deta hai.
 *
 * Sirf rendering par lagta hai - DB row aur allocation logic bilkul unchanged
 * rehte hain, isliye bill settlement pe koi asar nahi padta.
 */
export const vendorPaymentParticularsWithPo = (
  particulars: string,
  inwardToPo: Map<string, string>
): string => {
  const text = String(particulars || "");
  const match = text.match(/^(Vendor Payment:\s*[^(]*)\(([^)]*)\)(.*)$/i);
  if (!match) return particulars;

  const [, head, refList, tail] = match;
  const refs = refList
    .split(",")
    .map((r) => r.split(":")[0].trim())
    .filter(Boolean);
  if (refs.length === 0) return particulars;

  const poNumbers: string[] = [];
  refs.forEach((ref) => {
    const po = inwardToPo.get(ref.toLowerCase());
    if (po && !poNumbers.includes(po)) poNumbers.push(po);
  });

  // Koi ref map nahi hua (purana/adhura data) - to original text hi rakho.
  if (poNumbers.length === 0) return particulars;

  return `${head.trim()} (${poNumbers.join(", ")})${tail}`;
};