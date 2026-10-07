import { sc } from "./company";
import {
  computeReplacementGroups,
  isReceiptRow,
  isVendorPaymentRow,
  loadDbAllocations,
  type AllocBill,
} from "./billAllocations";

// ── One-time backfill ────────────────────────────────────────────────────────
// Purane vouchers ki bill-wise lines `bank_transactions.particulars` text se
// nikal kar `payment_allocations` table me daal deta hai. Har session me ek
// baar chalta hai (App.tsx session guard), idempotent hai: jis voucher ki
// rows pehle se hain use chhod deta hai.
//
// Guarantee: rows wahi algorithm se nikalte hain jo screens aaj tak text par
// chalakar dikhati aayi hain (cumulative, id-order), isliye backfill ke baad
// kisi screen ka ek rupya nahi badlega.

let running = false;
const LOCK_KEY = "m5_alloc_backfill_lock_v1";

export async function backfillPaymentAllocations(): Promise<number> {
  if (running) return 0;
  // Do tabs ek saath admin ho to ek hi chale — localStorage lock shared hai.
  // Lock 2 minute me expire ho jaata hai (crash case me atakna nahi chahiye).
  try {
    const lock = Number(localStorage.getItem(LOCK_KEY) || 0);
    if (lock && Date.now() - lock < 120000) return 0;
    localStorage.setItem(LOCK_KEY, String(Date.now()));
  } catch {
    // Storage blocked — lock ke bina chal lo, `running` guard abhi bhi hai.
  }
  running = true;
  try {
    const { data: existing, error: exErr } = await sc("payment_allocations").select(
      "bank_transaction_id"
    );
    if (exErr) throw exErr;
    const alreadyDone = new Set(
      (existing || []).map((r: any) => Number(r.bank_transaction_id))
    );

    // Screens select w/o order chalati hain (de-facto id order) — same order
    // yahan bhi, taaki cumulative context same rahe.
    const { data: txns, error: txErr } = await sc("bank_transactions")
      .select(
        "id, transaction_type, particulars, payment_in, credit_amount, payment_out, debit_amount, amount, bounced_at"
      )
      .order("id", { ascending: true });
    if (txErr) throw txErr;

    const receipts = (txns || []).filter(
      (r: any) => !alreadyDone.has(Number(r.id)) && isReceiptRow(r)
    );
    const vendorPayments = (txns || []).filter(
      (r: any) => !alreadyDone.has(Number(r.id)) && isVendorPaymentRow(r)
    );
    if (receipts.length === 0 && vendorPayments.length === 0) return 0;

    const [invRes, purRes] = await Promise.all([
      sc("invoices").select("id, invoice_no, invoice_date, total_amount"),
      sc("purchases").select("id, inward_no, purchase_no, purchase_date, total_amount"),
    ]);
    if (invRes.error) throw invRes.error;
    if (purRes.error) throw purRes.error;

    const invoiceBills: AllocBill[] = (invRes.data || []).map((i: any) => ({
      id: Number(i.id),
      ref: String(i.invoice_no || ""),
      date: String(i.invoice_date || ""),
      total: Number(i.total_amount || 0),
    }));
    const purchaseBills: AllocBill[] = (purRes.data || []).map((p: any) => ({
      id: Number(p.id),
      ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`),
      date: String(p.purchase_date || ""),
      total: Number(p.total_amount || 0),
    }));

    const chunks: any[][] = [];
    let chunk: any[] = [];

    const flush = () => {
      if (chunk.length) {
        chunks.push(chunk);
        chunk = [];
      }
    };

    // Row computation billAllocations ka shared `computeReplacementGroups`
    // (startIndex = 0, yaani poore ordered list ka first-pass delta) — backfill,
    // save aur edit teeno ek hi algorithm chalate hain.
    const processKind = (
      kind: "invoice" | "purchase",
      bills: AllocBill[],
      rows: any[]
    ) => {
      for (const g of computeReplacementGroups(kind, bills, rows, 0)) {
        // Ek voucher ki rows kabhi do statements me split mat ho — warna beech
        // me fail hone par adhoori lines reh jati hain. Isliye chunk full ho
        // to pehle flush karo.
        if (chunk.length + g.length > 500) flush();
        chunk.push(...g);
      }
    };

    processKind("invoice", invoiceBills, receipts);
    processKind("purchase", purchaseBills, vendorPayments);
    flush();
    if (chunks.length === 0) return 0;

    let inserted = 0;
    for (const c of chunks) {
      const { error } = await sc("payment_allocations").insert(c);
      if (error) throw error;
      inserted += c.length;
    }

    if (inserted > 0) await loadDbAllocations(true);
    return inserted;
  } catch (err) {
    // Fail hone par lock chhod do taaki agli baar (ya doosra tab) retry kar sake.
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      // ignore
    }
    throw err;
  } finally {
    running = false;
  }
}
