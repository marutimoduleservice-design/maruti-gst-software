export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export const GST_RATES = [0, 5, 12, 18, 28];

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function stateName(code: string | null | undefined): string {
  const c = String(code || "").trim();
  if (!c) return "";
  if (GST_STATE_CODES[c]) return GST_STATE_CODES[c];
  const padded = c.length === 1 ? `0${c}` : c;
  if (GST_STATE_CODES[padded]) return GST_STATE_CODES[padded];
  const lower = c.toLowerCase();
  const found = Object.values(GST_STATE_CODES).find((n) => n.toLowerCase() === lower);
  return found || c;
}

export function stateCodeFromName(value: string | null | undefined): string | null {
  const v = String(value || "").trim();
  if (!v) return null;
  if (GST_STATE_CODES[v]) return v;
  const padded = v.length === 1 ? `0${v}` : v;
  if (GST_STATE_CODES[padded]) return padded;
  const lower = v.toLowerCase();
  const hit = Object.entries(GST_STATE_CODES).find(([, n]) => n.toLowerCase() === lower);
  return hit ? hit[0] : null;
}

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = String(gstin || "").trim().toUpperCase();
  if (g.length < 2) return null;
  const code = g.slice(0, 2);
  return GST_STATE_CODES[code] ? code : null;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function isValidGstin(gstin: string | null | undefined): boolean {
  const g = String(gstin || "").trim().toUpperCase();
  if (!GSTIN_REGEX.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = BASE36.indexOf(g[i]);
    if (value < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checksum = (36 - (sum % 36)) % 36;
  return BASE36[checksum] === g[14];
}

export function isInterState(
  sellerState: string | null | undefined,
  placeOfSupply: string | null | undefined
): boolean {
  const seller = stateCodeFromName(sellerState);
  const buyer = stateCodeFromName(placeOfSupply);
  if (!seller || !buyer) return false;
  return seller !== buyer;
}

export type TaxSplit = {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

export function taxSplit(
  rate: number,
  gstPercent: number,
  interState: boolean
): TaxSplit {
  const taxable = round2(Number(rate) || 0);
  const pct = Number(gstPercent) || 0;
  if (pct <= 0) {
    return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable };
  }
  if (interState) {
    const igst = round2((taxable * pct) / 100);
    return { taxable, cgst: 0, sgst: 0, igst, total: round2(taxable + igst) };
  }
  const each = round2((taxable * pct) / 200);
  return { taxable, cgst: each, sgst: each, igst: 0, total: round2(taxable + each + each) };
}

export function roundOff(grandTotal: number): number {
  const value = Number(grandTotal) || 0;
  const rounded = Math.round(value);
  return round2(rounded - value);
}

export function amountInWords(value: number): string {
  const num = Math.round(Number(value) || 0);
  if (num === 0) return "Zero Rupees Only";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  const twoDigits = (n: number): string => {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${tens[t]}${o ? ` ${ones[o]}` : ""}`;
  };

  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts: string[] = [];
    if (h) parts.push(`${ones[h]} Hundred`);
    if (rest) parts.push(twoDigits(rest));
    return parts.join(" ");
  };

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = num % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return `${parts.join(" ").trim()} Rupees Only`;
}

export type HsnLine = {
  hsn_code?: string | null;
  gst_percent?: number | null;
  quantity?: number | null;
  taxable_value?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
};

export type HsnSummaryRow = {
  hsn_code: string;
  gst_percent: number;
  quantity: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
};

export function aggregateHsn(lines: HsnLine[]): HsnSummaryRow[] {
  const map = new Map<string, HsnSummaryRow>();
  for (const line of lines) {
    const hsn = String(line.hsn_code || "").trim() || "—";
    const pct = Number(line.gst_percent) || 0;
    const key = `${hsn}|${pct}`;
    const row = map.get(key) || {
      hsn_code: hsn,
      gst_percent: pct,
      quantity: 0,
      taxable_value: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
    };
    row.quantity += Number(line.quantity) || 0;
    row.taxable_value += Number(line.taxable_value) || 0;
    row.cgst_amount += Number(line.cgst_amount) || 0;
    row.sgst_amount += Number(line.sgst_amount) || 0;
    row.igst_amount += Number(line.igst_amount) || 0;
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      quantity: round2(row.quantity),
      taxable_value: round2(row.taxable_value),
      cgst_amount: round2(row.cgst_amount),
      sgst_amount: round2(row.sgst_amount),
      igst_amount: round2(row.igst_amount),
    }))
    .sort((a, b) => a.hsn_code.localeCompare(b.hsn_code) || a.gst_percent - b.gst_percent);
}
