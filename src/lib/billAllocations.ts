import { isBounced } from "./bankAccounts";
import { getCompanyId, sc } from "./company";

/**
 * Vendor payment / customer receipt vouchers se bill allocation ka shared logic.
 *
 * `purchases` table me `pending_amount` / `paid_amount` / `deduction_amount`
 * koi column nahi hai — aur `invoices.pending_amount` kabhi update hi nahi
 * hota. Isliye har jagah voucher (bank_transactions) se hi hisaab nikalte hain.
 *
 * Do source hain, is order me:
 *   1. `payment_allocations` table — naya permanent source of truth. Har
 *      payment ki har bill ke liye ek row (amount + deduction). Text badalne
 *      par bhi allocation safe rehti hai.
 *   2. Purana text-parse (particulars me "INV-01: 500.00") — fallback. Table
 *      rows na mile (purani entry / migration pending) ya table read fail ho
 *      to bilkul purane algorithm se hi numbers nikalte hain, isliye purana
 *      data aur screen ke aaj ke figures kabhi nahi badalte.
 */

export type AllocBill = { id: number; ref: string; date: string; total: number };
export type BillAllocation = { paid: number; deduction: number };

// bank_transaction_id -> (bill_id -> us voucher ka allocation)
export type AllocCache = Map<number, Map<number, BillAllocation>> | null;

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

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

export const isReceiptRow = (row: any) =>
  String(row.transaction_type || "").toLowerCase().includes("customer receipt") ||
  String(row.particulars || "").toLowerCase().includes("customer receipt");

// ── Text fallback parser ─────────────────────────────────────────────────────
// A voucher row can carry per-bill amounts ("INV-01: 500, INV-02: 300") or only a
// voucher total. When explicit amounts exist they win, otherwise the amount is
// spread over the referenced bills in date order (oldest first).
// `target` me accumulate karta hai — cumulative history banane ke liye rows ko
// order me ek-ek karke yahi par dala jaata hai.
export const applyAllocations = (
  target: Map<number, BillAllocation>,
  bills: AllocBill[],
  rows: any[]
): void => {
  const refs = bills.map((b) => b.ref).filter(Boolean);

  rows.forEach((row: any) => {
    // Bounced / returned payment bill ko settle nahi karta — udhaar wapas
    // outstanding ho jaata hai, isliye allocation me count hi mat karo.
    if (isBounced(row)) return;
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
      const previous = target.get(bill.id) || { paid: 0, deduction: 0 };
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

      target.set(bill.id, {
        paid: previous.paid + paidForBill,
        deduction: previous.deduction + deductionForBill,
      });
    });
  });
};

export const parseAllocations = (
  bills: AllocBill[],
  rows: any[]
): Map<number, BillAllocation> => {
  const allocations = new Map<number, BillAllocation>();
  applyAllocations(allocations, bills, rows);
  return allocations;
};

// ── payment_allocations table cache ──────────────────────────────────────────
let dbAllocCache: AllocCache = null;
let dbAllocLoaded = false;
let dbAllocWarned = false;

// DB rows se per-voucher cache banao.
export const buildDbAllocCache = (rows: any[]): AllocCache => {
  const map = new Map<number, Map<number, BillAllocation>>();
  (rows || []).forEach((r: any) => {
    const txnId = Number(r.bank_transaction_id);
    const billId = Number(r.invoice_id ?? r.purchase_id ?? 0);
    if (!txnId || !billId) return;
    const per = map.get(txnId) || new Map<number, BillAllocation>();
    const prev = per.get(billId) || { paid: 0, deduction: 0 };
    per.set(billId, {
      paid: prev.paid + round2(r.amount),
      deduction: prev.deduction + round2(r.deduction),
    });
    map.set(txnId, per);
  });
  return map;
};

// Table cache load (har data-load par force=True se taaki save/delete/backfill
// ke baad turant naye rows dikhein). Table abhi bana nahi hai (migration SQL
// pending) to error sirf ek baar warn hota hai aur app purane text-parse par
// chalta rehta hai.
export async function loadDbAllocations(force = false): Promise<void> {
  if (dbAllocLoaded && !force) return;
  dbAllocLoaded = true;
  try {
    const { data, error } = await sc("payment_allocations").select(
      "bank_transaction_id, invoice_id, purchase_id, amount, deduction"
    );
    if (error) throw error;
    dbAllocCache = buildDbAllocCache(data || []);
    dbAllocWarned = false;
  } catch (err: any) {
    dbAllocCache = dbAllocCache || new Map();
    if (!dbAllocWarned) {
      dbAllocWarned = true;
      console.warn(
        "payment_allocations load failed — text fallback active (migration SQL chalana zaroori hai):",
        err?.message || err
      );
    }
  }
}

export const getDbAllocations = (
  txnId: number,
  cache: AllocCache = dbAllocCache
): Map<number, BillAllocation> | null =>
  cache ? cache.get(Number(txnId)) || null : null;

// ── Table-first reader ───────────────────────────────────────────────────────
// Har voucher ke liye: table me rows hain to unhe seedha maano (source of
// truth), warna usi voucher ka purana text-parse karo. Dono ka sum bilkul
// same aata hai, isliye migration ke dauran figures same rehte hain.
export const buildAllocations = (
  bills: AllocBill[],
  rows: any[],
  cache: AllocCache = dbAllocCache
): Map<number, BillAllocation> => {
  const allocations = new Map<number, BillAllocation>();

  const accumulate = (billId: number, value: BillAllocation) => {
    const prev = allocations.get(billId) || { paid: 0, deduction: 0 };
    allocations.set(billId, {
      paid: prev.paid + value.paid,
      deduction: prev.deduction + value.deduction,
    });
  };

  rows.forEach((row: any) => {
    if (isBounced(row)) return;
    const db = getDbAllocations(Number(row.id), cache);
    if (db && db.size > 0) {
      db.forEach((value, billId) => {
        // Bill delete ho chuki ho to uski purani line ab kisi screen par aati
        // hi nahi — skip. Payment ki history table me bachi rehti hai.
        if (!bills.some((b) => b.id === billId)) return;
        accumulate(billId, value);
      });
      return;
    }
    // Text fallback: allocations map me hi cumulative — outstanding har row par
    // running total se nikalta hai (over-pay cap ke saath), bilkul jaise purana
    // buildAllocations karta tha. Naya map per row bana kar sum karne se figures
    // badal jaate.
    applyAllocations(allocations, bills, [row]);
  });

  return allocations;
};

// ── Table writer ─────────────────────────────────────────────────────────────
// Naye voucher ki rows = (is voucher ke baad ka cumulative) - (pehle ka
// cumulative). Aise per-voucher values bilkul usi algorithm se nikalte hain jo
// screen purane text par chalakar aaj tak deti aayi hai — backfill/save ke baad
// figures kabhi nahi badalte.
const voucherDeltaRows = (
  kind: "invoice" | "purchase",
  bills: AllocBill[],
  priorRows: any[],
  savedRecord: any,
  insertAt: number
): Array<{ invoice_id: number | null; purchase_id: number | null; amount: number; deduction: number }> => {
  const before = parseAllocations(bills, priorRows);
  const ordered = [...priorRows];
  ordered.splice(
    Math.max(0, Math.min(insertAt, ordered.length)),
    0,
    savedRecord
  );
  const after = parseAllocations(bills, ordered);
  // Sirf usi voucher me referenced bills ki line chahiye — unka delta (kabhi 0
  // bhi, taaki edit-prefill me selection text jaisa bana rahe).
  const referencedNow = parseAllocations(bills, [savedRecord]);
  const rows: Array<{ invoice_id: number | null; purchase_id: number | null; amount: number; deduction: number }> = [];
  referencedNow.forEach((_, billId) => {
    const a = after.get(billId) || { paid: 0, deduction: 0 };
    const b = before.get(billId) || { paid: 0, deduction: 0 };
    rows.push({
      invoice_id: kind === "invoice" ? billId : null,
      purchase_id: kind === "purchase" ? billId : null,
      amount: round2(a.paid - b.paid),
      deduction: round2(a.deduction - b.deduction),
    });
  });
  return rows;
};

// Offline queue ke liye: rows bina transaction_id ke (sync ke waqt id judti hai).
export const voucherAllocRows = (
  kind: "invoice" | "purchase",
  bills: AllocBill[],
  priorRows: any[],
  savedRecord: any,
  insertAt: number
) => voucherDeltaRows(kind, bills, priorRows, savedRecord, insertAt);

// Cumulative recompute — bilkul wahi order/algorithm jo read path use karta
// hai. startIndex se aage ke har voucher ke naye delta rows (per-voucher group)
// return karta hai. Pure function (testable); DB write saveVoucherAllocations
// karta hai.
export const computeReplacementGroups = (
  kind: "invoice" | "purchase",
  bills: AllocBill[],
  orderedRows: any[],
  startIndex: number
): any[][] => {
  const groups: any[][] = [];
  const accum = parseAllocations(bills, orderedRows.slice(0, startIndex));
  for (let i = Math.max(0, startIndex); i < orderedRows.length; i++) {
    const row = orderedRows[i];
    const txnId = Number(row.id || 0);
    const before = new Map(accum);
    const fresh = parseAllocations(bills, [row]);
    applyAllocations(accum, bills, [row]);
    if (!txnId || fresh.size === 0) continue;
    const txnRows: any[] = [];
    fresh.forEach((_, billId) => {
      const a = accum.get(billId) || { paid: 0, deduction: 0 };
      const b = before.get(billId) || { paid: 0, deduction: 0 };
      txnRows.push({
        bank_transaction_id: txnId,
        invoice_id: kind === "invoice" ? billId : null,
        purchase_id: kind === "purchase" ? billId : null,
        amount: round2(a.paid - b.paid),
        deduction: round2(a.deduction - b.deduction),
      });
    });
    if (txnRows.length) groups.push(txnRows);
  }
  return groups;
};

// Save/edit ke baad table rows ko replace karta hai aur cache refresh karta hai.
//
//   orderedRows  — us kind ki poori ordered list, NAYE record ko uski jagah rakha
//                  hua (edit me jagah par replace, create me end par append)
//   startIndex   — jahan se stale rows shuru hote hain (edit index / create me end)
//   replaceIds   — jinke purane rows delete karne hain. Edit me startIndex se
//                  aage ke sabhi voucher ke ids — kyunki unka delta bhi cumulative
//                  context ka hissa hai (purane algorithm ke saath screen aaj jo
//                  dikhata hai wahi rehna chahiye). Create me sirf nayi id.
//
// Table missing ho ya insert fail ho to sirf log hota hai — text fallback waise
// bhi screen sahi rakhta hai, isliye save kabhi fail nahi hota.
export async function saveVoucherAllocations(
  kind: "invoice" | "purchase",
  bills: AllocBill[],
  orderedRows: any[],
  startIndex: number,
  replaceIds: number[]
): Promise<void> {
  try {
    const ids = [...new Set(replaceIds.map(Number).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 200) {
      const { error: delErr } = await sc("payment_allocations")
        .delete()
        .in("bank_transaction_id", ids.slice(i, i + 200))
        .eq("company_id", getCompanyId());
      if (delErr) throw delErr;
    }

    const groups = computeReplacementGroups(kind, bills, orderedRows, startIndex);

    // Ek voucher ki rows kabhi do statements me split mat ho (partial insert).
    const chunks: any[][] = [];
    let chunk: any[] = [];
    for (const g of groups) {
      if (chunk.length && chunk.length + g.length > 500) {
        chunks.push(chunk);
        chunk = [];
      }
      chunk.push(...g);
    }
    if (chunk.length) chunks.push(chunk);

    for (const c of chunks) {
      const { error: insErr } = await sc("payment_allocations").insert(c);
      if (insErr) throw insErr;
    }
  } catch (err: any) {
    console.error(
      "payment_allocations save failed — text fallback active (migration SQL chalana zaroori hai):",
      err?.message || err
    );
  } finally {
    await loadDbAllocations(true);
  }
}

// Voucher delete par uski allocation lines bhi hatao (best-effort — table
// missing ho to delete nahi rukega).
export async function deleteVoucherAllocations(txnId: number): Promise<void> {
  try {
    const { error } = await sc("payment_allocations")
      .delete()
      .eq("bank_transaction_id", Number(txnId))
      .eq("company_id", getCompanyId());
    if (error) throw error;
    await loadDbAllocations(true);
  } catch {
    // Fallback text-parse delete ke baad waise bhi kuch nahi dikhata.
  }
}

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