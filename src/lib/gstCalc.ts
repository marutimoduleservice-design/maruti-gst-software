// GST calculation helpers — CGST/SGST (intra-state) vs IGST (inter-state)

export type GstSplit = {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * amount = taxable value (GST ke pehle ka amount)
 * gstPercent = total GST rate (e.g. 18)
 * interState = true  -> IGST
 *           = false -> CGST + SGST (half-half)
 */
export function splitGst(amount: number, gstPercent: number, interState: boolean): GstSplit {
  const taxableValue = round2(amount);
  const rate = Number(gstPercent) || 0;
  const totalGst = round2((taxableValue * rate) / 100);

  if (rate <= 0) {
    return { taxableValue, cgst: 0, sgst: 0, igst: 0, total: taxableValue };
  }

  if (interState) {
    return { taxableValue, cgst: 0, sgst: 0, igst: totalGst, total: round2(taxableValue + totalGst) };
  }

  const half = round2(totalGst / 2);
  // Rounding beech me ho to difference IGST/CGST me se adjust kar do
  const sgst = round2(totalGst - half);

  return {
    taxableValue,
    cgst: half,
    sgst,
    igst: 0,
    total: round2(taxableValue + totalGst),
  };
}

// Company state code vs customer state code — same ho to CGST/SGST
export function isInterState(companyStateCode: string | null | undefined, customerStateCode: string | null | undefined): boolean {
  const a = String(companyStateCode ?? "").trim();
  const b = String(customerStateCode ?? "").trim();
  if (!a || !b) return false;
  return a !== b;
}

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

// GSTIN format check: 15 chars, 2 digits + 5 letters + 5 digits + 1 letter + 1 Z + 2 chars
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9]Z[A-Z0-9]$/;

export function isValidGstin(value: string | null | undefined): boolean {
  const gstin = String(value ?? "").trim().toUpperCase();
  if (!gstin) return true; // khali bhi chalega (Unregistered)
  return GSTIN_RE.test(gstin);
}

export function stateCodeFromGstin(value: string | null | undefined): string {
  const gstin = String(value ?? "").trim().toUpperCase();
  return /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : "";
}

export function formatGstBreakup(splits: GstSplit[]) {
  const totals = splits.reduce(
    (acc, s) => ({
      taxableValue: round2(acc.taxableValue + s.taxableValue),
      cgst: round2(acc.cgst + s.cgst),
      sgst: round2(acc.sgst + s.sgst),
      igst: round2(acc.igst + s.igst),
    }),
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 }
  );

  return {
    ...totals,
    totalGst: round2(totals.cgst + totals.sgst + totals.igst),
    grandTotal: round2(totals.taxableValue + totals.cgst + totals.sgst + totals.igst),
  };
}
