import type { PostgrestQueryBuilder } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const STORAGE_KEY = "maruti.company_id";

export type Company = {
  id: number;
  name: string;
  tax_mode: string;
  gstin: string | null;
  invoice_prefix: string | null;
  financial_year_start: string | null;
  active: boolean;
};

// Tables jisme company_id column hai. Inhe current company se filter karna zaroori hai.
export const COMPANY_SCOPED_TABLES = new Set<string>([
  "customers",
  "vendors",
  "items",
  "item_master",
  "purchases",
  "invoices",
  "invoice_items",
  "job_cards",
  "job_card_technicians",
  "bank_transactions",
  "bank_accounts",
  "warranty_claims",
  "warranty_returns",
  "customer_opening_balances",
  "company_business_settings",
  "company_settings",
  "technicians",
  "customer_item_prices",
  "bank_statement_batches",
  "bank_statement_lines",
  "payment_allocations",
]);

export function getCompanyId(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function setCompanyId(id: number): void {
  localStorage.setItem(STORAGE_KEY, String(id));
}

export function clearCompanyId(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("active", true)
    .order("id", { ascending: true });

  if (error) throw error;
  return (data || []) as Company[];
}

export function isGstCompany(company: Company | null | undefined): boolean {
  if (!company) return false;
  return String(company.tax_mode || "").trim().toLowerCase() !== "non-gst";
}

export function invoicePrefixFor(company: Company | null | undefined): string {
  const prefix = company?.invoice_prefix;
  if (prefix && prefix.trim()) return prefix.trim();
  return isGstCompany(company) ? "GSTINV/" : "INV/";
}

// Company-aware query builder.
// supabase me .eq() .select() ke BAAD hi lagta hai, isliye yahan .select() ko
// intercept karke current company ka filter laga dete hain. Isse har page me
// sirf `supabase.from("x")` ki jagah `sc("x")` likhna kaafi hai.
export function sc(table: string) {
  const builder = supabase.from(table);

  if (!COMPANY_SCOPED_TABLES.has(table)) return builder;

  const proxied = new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      // .select() ke baad current company ka filter laga do
      if (prop === "select") {
        return (...args: unknown[]) => {
          const selected = Reflect.apply(value, target, args) as any;
          return selected.eq("company_id", getCompanyId());
        };
      }

      // .insert() / .upsert() me company_id automatically add kar do,
      // warna nayi company ka data purani company me chala jayega.
      if (prop === "insert" || prop === "upsert") {
        return (...args: unknown[]) => {
          const payload = args[0];
          const stamp = (row: any) => ({ ...row, company_id: getCompanyId() });
          const stamped = Array.isArray(payload) ? payload.map(stamp) : stamp(payload);
          return Reflect.apply(value, target, [stamped, ...args.slice(1)]);
        };
      }

      return value.bind(target);
    },
  });

  return proxied as PostgrestQueryBuilder<any, any, any, string, unknown>;
}

// Insert ke liye company_id automatically add karo.
export function withCompany<T extends Record<string, any>>(row: T): T & { company_id: number } {
  return { ...row, company_id: getCompanyId() };
}
