// User Roles & Permissions — role matrix.
// Har role ko kaunse menus dikhenge ye yahan decide hota hai.
// Menu names bilkul wahi hain jo App.tsx sidebar me use hote hain.

export type StaffRole =
  | "admin"
  | "accountant"
  | "store"
  | "technician"
  | "auditor"
  | "pending"
  | "none";

export type AppUser = {
  id: number;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  role: StaffRole;
  technician_id: number | null;
  active: boolean;
  created_at?: string;
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin (Owner)",
  accountant: "Accountant",
  store: "Store Person",
  technician: "Technician",
  auditor: "Auditor (Read Only)",
  pending: "Awaiting Approval",
  none: "No Role",
};

// Users & Roles page ke dropdown ke liye (pending/none assign nahi hote).
export const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "admin", label: "Admin (Owner)" },
  { value: "accountant", label: "Accountant" },
  { value: "store", label: "Store Person" },
  { value: "technician", label: "Technician" },
  { value: "auditor", label: "Auditor (Read Only)" },
];

const ALL_MENUS: string[] = [
  "Dashboard",
  "Module Repair",
  "Sales / Invoice",
  "Purchase",
  "Payments / Ledger",
  "Bank Passbook & Expenses",
  "Warranty",
  "Print Center",
  "Label Print",
  "Customers",
  "Item Master",
  "Customer Wise Price",
  "Vendor Master",
  "Technician Master",
  "My Company Details",
  "Stock Report",
  "Sales Report",
  "Purchase Report",
  "Expense Report",
  "Net Profit Report",
  "Worker Salary",
  "Item Wise Qty In Out Report",
  "Settings",
  "Users & Roles",
  "Activity Log",
];

// Har role ki permission list. Sirf yahan menus me entries badalni hain.
const ACCESS: Record<StaffRole, string[]> = {
  // Admin = sab kuch (Users & Roles + Worker Salary + Technician Master sirf yahan).
  admin: ALL_MENUS,

  // Accountant: invoice / payment / purchase / expense / reports.
  // Item Master, Worker Salary, Technician Master, Label Print nahi.
  accountant: [
    "Dashboard",
    "Sales / Invoice",
    "Purchase",
    "Payments / Ledger",
    "Bank Passbook & Expenses",
    "Print Center",
    "Customers",
    "Customer Wise Price",
    "Vendor Master",
    "Sales Report",
    "Purchase Report",
    "Expense Report",
    "Net Profit Report",
  ],

  // Store person: sirf Purchase + Stock (Item Master, labels, vendor).
  store: [
    "Purchase",
    "Item Master",
    "Label Print",
    "Vendor Master",
    "Stock Report",
    "Purchase Report",
    "Item Wise Qty In Out Report",
  ],

  // Technician: sirf apna Module Repair.
  technician: ["Module Repair"],

  // Auditor: sab kuch sirf dekhne ke liye, par Salary report bhi nahi.
  // Activity Log (audit trail) bhi dikhta hai — padhne wala page hai.
  auditor: [
    "Dashboard",
    "Stock Report",
    "Sales Report",
    "Purchase Report",
    "Expense Report",
    "Net Profit Report",
    "Item Wise Qty In Out Report",
    "Activity Log",
  ],

  pending: [],
  none: [],
};

export function allowedMenus(role: string | null | undefined): string[] {
  if (!role) return [];
  return ACCESS[role as StaffRole] || [];
}

export function canOpen(role: string | null | undefined, menu: string): boolean {
  return allowedMenus(role).includes(menu);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return ROLE_LABELS.none;
  return ROLE_LABELS[role as StaffRole] || ROLE_LABELS.none;
}
