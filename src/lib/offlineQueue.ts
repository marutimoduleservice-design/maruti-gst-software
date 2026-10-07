import { sc } from "./company";
import { supabase } from "./supabase";
import { fyOfDate } from "./financialYear";

// ── Offline form queue ─────────────────────────────────────────────────────
// Internet nahi hai tab invoice/receipt/payment entries yahan queue me jati
// hain (localStorage), aur `online` event aate hi `runOfflineSync()` unhe
// apne aap server par bhej deta hai. Sirf tabhi enqueue hota hai jab
// `navigator.onLine === false` ho — matlab request kabhi network par gayi hi
// nahi — isliye duplicate-save ka koi risk nahi.

export type OfflineKind = "invoice" | "receipt" | "vendor_payment";

export interface OfflineEntry {
  id: string;
  created_at: string;
  label: string;
  kind: OfflineKind;
  payload: any;
  error?: string | null;
}

const STORAGE_KEY = "m5_offline_queue_v1";
const EVENT_NAME = "m5-offline-queue-change";

let syncing = false;

export const isOffline = (): boolean =>
  typeof navigator !== "undefined" && navigator.onLine === false;

export function getQueue(): OfflineEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveQueue(list: OfflineEntry[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full/blocked — queue persist nahi hogi, par session ke liye chalegi.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
}

export function enqueueOffline(
  entry: Omit<OfflineEntry, "id" | "created_at" | "error">
): OfflineEntry {
  const full: OfflineEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    error: null,
    ...entry,
  };
  saveQueue([...getQueue(), full]);
  return full;
}

export function removeOfflineEntry(id: string): void {
  saveQueue(getQueue().filter((entry) => entry.id !== id));
}

function patchEntry(id: string, patch: Partial<OfflineEntry>): void {
  saveQueue(getQueue().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
}

export function subscribeOfflineQueue(callback: () => void): () => void {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}

export function isNetworkError(err: any): boolean {
  if (isOffline()) return true;
  const message = String(err?.message || err || "");
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|socket hang up/i.test(
    message
  );
}

// RC / PM numbering FY change par reset hoti hai — sync ke waqt hi generate
// hota hai taaki queue me der tak rahi entry ka number galat na baithe.
async function getNextTransactionNo(prefix: "RC" | "PM", date: string): Promise<string> {
  const year = fyOfDate(date).startYear;
  const { data } = await sc("bank_transactions")
    .select("transaction_no")
    .like("transaction_no", `${prefix}-${year}-%`)
    .order("id", { ascending: false })
    .limit(1);
  const last = data && data.length ? Number(String(data[0].transaction_no || "0").split("-").pop() || 0) : 0;
  return `${prefix}-${year}-${String(last + 1).padStart(4, "0")}`;
}

async function replayEntry(entry: OfflineEntry): Promise<void> {
  if (entry.kind === "invoice") {
    const { error } = await supabase.rpc("save_invoice_atomic", entry.payload);
    if (error) throw error;
    return;
  }

  if (entry.kind === "receipt" || entry.kind === "vendor_payment") {
    const prefix = entry.kind === "receipt" ? "RC" : "PM";
    const record = entry.payload.record;
    const transaction_no = await getNextTransactionNo(prefix, record.transaction_date);
    const { data: inserted, error } = await sc("bank_transactions")
      .insert([{ ...record, transaction_no }])
      .select("id");
    if (error) throw error;

    // Allocation rows enqueue ke waqt hi ban chuki hain (bina txn id) — ab id
    // jud jaaye. Fail ho to koi baat nahi: screen text fallback par sahi rahegi,
    // entry phir se duplicate karne se bachne ke liye error mat throw karo.
    const allocRows = Array.isArray(entry.payload.alloc_rows) ? entry.payload.alloc_rows : [];
    const txnId = Number(inserted?.[0]?.id || 0);
    if (txnId && allocRows.length) {
      const { error: allocErr } = await sc("payment_allocations").insert(
        allocRows.map((r: any) => ({ ...r, bank_transaction_id: txnId }))
      );
      if (allocErr) console.error("Offline sync: payment_allocations insert failed", allocErr.message);
    }

    if (entry.kind === "vendor_payment" && Array.isArray(entry.payload.status_updates)) {
      for (const upd of entry.payload.status_updates) {
        const { error: updErr } = await sc("purchases")
          .update({ status: upd.status })
          .eq("id", upd.bill_id);
        if (updErr) console.error("Offline sync: purchase status update failed", upd.bill_id, updErr);
      }
    }
    return;
  }

  throw new Error(`Unknown offline entry kind: ${(entry as any).kind}`);
}

export async function runOfflineSync(): Promise<{ synced: number; failed: number }> {
  if (syncing || isOffline()) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const entry of getQueue()) {
      if (isOffline()) break;
      try {
        await replayEntry(entry);
        removeOfflineEntry(entry.id);
        synced++;
      } catch (err: any) {
        if (isNetworkError(err)) {
          // Abhi bhi network ja raha hai — age mat badho, agli baar retry hoga.
          patchEntry(entry.id, { error: "Network error — dobara try hoga" });
          break;
        }
        // Server ne reject kiya (validation/stock/etc) — entry safe hai, error
        // ke saath banner me dikhegi; user Retry ya Delete kar sakega.
        failed++;
        patchEntry(entry.id, { error: String(err?.message || err) });
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}
