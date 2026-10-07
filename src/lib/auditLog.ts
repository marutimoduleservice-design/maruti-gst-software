// Audit Trail (Activity Log) helpers.
// Data DB trigger se aata hai (supabase/audit-log-migration.sql) — frontend ko
// sirf padhna aur present karna hai. Client se log kabhi write nahi hote.
import { supabase } from "./supabase";

export type AuditEntry = {
  id: number;
  auth_user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  entity: string;
  entity_id: number | null;
  entity_label: string | null;
  action: "create" | "update" | "delete";
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
};

// Trigger ke TG_ARGV[0] se same naam.
export const AUDIT_ENTITIES = [
  "Invoice",
  "Customer",
  "Purchase",
  "Job Card",
  "Payment",
  "Vendor",
  "Item",
  "Technician",
  "Warranty",
  "Customer Price",
] as const;

const FIELD_LABELS: Record<string, string> = {
  // Invoice
  invoice_no: "Invoice No",
  invoice_date: "Invoice Date",
  invoice_type: "Invoice Type",
  customer_name: "Customer",
  customer_id: "Customer",
  subtotal: "Subtotal",
  discount: "Discount",
  gst_amount: "GST Amount",
  grand_total: "Grand Total",
  payment_status: "Payment Status",
  paid_amount: "Paid Amount",
  balance_amount: "Balance Amount",
  due_date: "Due Date",
  notes: "Notes",
  // Customer / Vendor
  customer_code: "Customer Code",
  mobile: "Mobile",
  business_name: "Business Name",
  business_address: "Address",
  gst_available: "GST Available",
  gst_number: "GST Number",
  payment_term: "Payment Term",
  vendor_code: "Vendor Code",
  vendor_name: "Vendor",
  contact_person: "Contact Person",
  address: "Address",
  gst_status: "GST Status",
  // Purchase
  purchase_no: "Purchase No",
  purchase_date: "Purchase Date",
  inward_no: "Inward No",
  item_name: "Item",
  item_code: "Item Code",
  quantity: "Quantity",
  rate: "Rate",
  total_amount: "Total Amount",
  payment_mode: "Payment Mode",
  remarks: "Remarks",
  // Job card
  job_no: "Job No",
  job_date: "Job Date",
  status: "Status",
  warranty_quantity: "Warranty Qty",
  reject_quantity: "Reject Qty",
  estimated_cost: "Estimated Cost",
  final_amount: "Final Amount",
  // Bank transaction (payment)
  transaction_date: "Date",
  particulars: "Particulars",
  party_name: "Party",
  transaction_type: "Transaction Type",
  payment_in: "Payment In",
  payment_out: "Payment Out",
  amount: "Amount",
  type: "Credit / Debit",
  is_transfer: "Internal Transfer",
  cheque_number: "Cheque Number",
  utr_number: "UTR",
  is_bounced: "Bounced",
  bounce_reason: "Bounce Reason",
  // Item master
  unit: "Unit",
  hsn_code: "HSN Code",
  gst_percent: "GST %",
  purchase_price: "Purchase Price",
  sale_price: "Sale Price",
  cost_price: "Cost Price",
  opening_stock: "Opening Stock",
  min_stock: "Min Stock",
  // Technician
  name: "Name",
  salary: "Salary",
  share_percent: "Share %",
  // Warranty
  warranty_module_date: "Warranty Module Date",
  working_days: "Working Day",
  return_reason: "Return Reason",
};

export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type AuditChange = { key: string; label: string; from: string; to: string };

// Update entry me sirf wo fields jo sach me badle.
export function entryChanges(entry: AuditEntry): AuditChange[] {
  if (entry.action !== "update" || !entry.changed_fields || entry.changed_fields.length === 0) {
    return [];
  }
  const oldV = entry.old_values || {};
  const newV = entry.new_values || {};
  return entry.changed_fields.map((key) => ({
    key,
    label: fieldLabel(key),
    from: formatAuditValue(oldV[key]),
    to: formatAuditValue(newV[key]),
  }));
}

// Delete/create detail dikhane ke liye: kuch important fields (agar hain).
const SUMMARY_KEYS = [
  "customer_name",
  "business_name",
  "vendor_name",
  "grand_total",
  "total_amount",
  "amount",
  "payment_status",
  "status",
  "quantity",
];

export function entrySummaryValues(entry: AuditEntry): AuditChange[] {
  const source = entry.action === "delete" ? entry.old_values : entry.new_values;
  if (!source) return [];
  return SUMMARY_KEYS.filter((k) => source[k] !== undefined && source[k] !== null && source[k] !== "")
    .slice(0, 4)
    .map((key) => ({
      key,
      label: fieldLabel(key),
      from: "",
      to: formatAuditValue(source[key]),
    }));
}

export function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
};

type FetchOptions = {
  entity?: string;
  entityId?: number;
  action?: AuditEntry["action"];
  limit?: number;
};

type FetchResult = { rows: AuditEntry[]; error: string | null };

export async function fetchAuditEntries(options: FetchOptions = {}): Promise<FetchResult> {
  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 300);

  if (options.entity) query = query.eq("entity", options.entity);
  if (options.entityId !== undefined && options.entityId !== null) {
    query = query.eq("entity_id", options.entityId);
  }
  if (options.action) query = query.eq("action", options.action);

  const { data, error } = await query;
  if (error) {
    const message = error.message || "";
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      message.includes("audit_log") ||
      message.toLowerCase().includes("schema cache");
    return {
      rows: [],
      error: missing
        ? "Audit table abhi database me nahi hai. Supabase SQL Editor me supabase/audit-log-migration.sql chalayein."
        : `Activity Log load nahi hua: ${message}`,
    };
  }
  return { rows: (data as AuditEntry[]) ?? [], error: null };
}
