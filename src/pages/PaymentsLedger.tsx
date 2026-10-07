import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { enqueueOffline, isOffline } from "../lib/offlineQueue";
import { currentFY, fyFromStartYear, fyOptions, fyOfDate, fyStartYear } from "../lib/financialYear";
import { SortTh, useSortedRows } from "../lib/tableSort";
import {
  buildAllocations,
  deleteVoucherAllocations,
  escapeRegExp,
  getDbAllocations,
  isReceiptRow,
  isVendorPaymentRow,
  loadDbAllocations,
  saveVoucherAllocations,
  voucherAllocRows,
  voucherAmount,
  type AllocBill,
} from "../lib/billAllocations";
import type { BankAccount } from "../lib/bankAccounts";
import { defaultAccount, isBounced, isCashAccount, loadBankAccounts } from "../lib/bankAccounts";

type Vendor = {
  id: number;
  vendor_code: string | null;
  business_name: string;
  mobile?: string | null;
};

type Customer = {
  id: number;
  customer_code?: string | null;
  business_name?: string | null;
  customer_name?: string | null;
  mobile?: string | null;
};

type PurchaseBill = {
  id: number;
  inward_no: string;
  purchase_no?: string;
  purchase_date: string;
  vendor_id?: number | null;
  vendor_name: string;
  vendor_code?: string;
  item_name: string;
  total_amount: number;
  status: "Paid" | "Partial" | "Pending";
  paid_amount?: number;
  deduction_amount?: number;
  pending_amount?: number;
};

type InvoiceBill = {
  id: number;
  invoice_no: string;
  invoice_date: string;
  customer_id?: number | null;
  customer_name: string;
  business_name?: string | null;
  total_amount: number;
  status: "Paid" | "Partial" | "Pending";
  received_amount?: number;
  deduction_amount?: number;
  pending_amount?: number;
};

const formatLedgerDate = (value?: string | null) => {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

// RC / PM numbering resets on 1 April (FY change) like Tally: the year segment
// is the FY START year, so Jan-Mar invoices/receipts continue the same series.
const getNextTransactionNo = async (prefix: "RC" | "PM", date: string): Promise<string> => {
  const year = fyOfDate(date).startYear;
  const { data } = await sc("bank_transactions")
    .select("transaction_no")
    .like("transaction_no", `${prefix}-${year}-%`)
    .order("id", { ascending: false })
    .limit(1);
  const last = data && data.length ? Number(String(data[0].transaction_no || "0").split("-").pop() || 0) : 0;
  return `${prefix}-${year}-${String(last + 1).padStart(4, "0")}`;
};

const money = (value: number) =>
  `₹ ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// Voucher particulars carry either "REF: 500.00" per bill (partial payments) or
// just a comma list of refs when a single bill is settled in full.
const formatBillRefs = (
  bills: { id: number; ref: string }[],
  allocations: Record<number, number>
) => {
  const hasExplicit = bills.length > 0 && bills.every((b) => (Number(allocations[b.id] || 0) || 0) > 0);
  const refs = bills
    .map((b) => (hasExplicit ? `${b.ref}:${(Number(allocations[b.id] || 0) || 0).toFixed(2)}` : b.ref))
    .join(", ");
  return { hasExplicit, refs };
};

// A voucher row can carry per-bill amounts ("INV-01: 500, INV-02: 300") or only a
// voucher total. When explicit amounts exist they win, otherwise the amount is
// spread over the referenced bills in date order (oldest first).
// Logic ab `../lib/billAllocations` me hai taaki Purchase Report bhi wahi use kare.

function PaymentsLedger() {
  const [activeTab, setActiveTab] = useState<"Vendors" | "Customers">("Vendors");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<PurchaseBill[]>([]);
  const [invoices, setInvoices] = useState<InvoiceBill[]>([]);
  const [bankRows, setBankRows] = useState<any[]>([]);
  const [ledgerFinancialYear, setLedgerFinancialYear] = useState(currentFY().label);
  const [availableBalance, setAvailableBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Party list search
  const [partySearch, setPartySearch] = useState("");

  // Selected party + entry
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [entrySelectedIds, setEntrySelectedIds] = useState<number[]>([]);
  const [entryForm, setEntryForm] = useState({
    deduction: 0,
    amount: 0,
    payment_mode: "Bank / UPI",
    account_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    remarks: "",
    cheque_no: "",
    cheque_date: "",
    utr_no: "",
  });
  const [savingEntry, setSavingEntry] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<any>(null);
  // Chhoti report: sabhi bounced/returned payments ek jagah
  const [showBounceList, setShowBounceList] = useState(false);
  const [billAllocations, setBillAllocations] = useState<Record<number, number>>({});
  // Har payment kis account se hua — Cash Box, HDFC, UPI etc.
  const [accounts, setAccounts] = useState<BankAccount[]>([]);

  const calculateLiveBalance = async (): Promise<any[]> => {
    try {
      let totalInflow = 0;
      let totalOutflow = 0;

      const { data: bankData, error } = await sc("bank_transactions").select("*");
      if (error) throw error;

      const rows = bankData || [];

      if (rows.length) {
        rows.forEach((row: any) => {
          // Bounce/return: paisa account me aaya/gya hi nahi — balance me mat lo.
          if (isBounced(row)) return;
          const rawAmt = Number(row.amount || 0);
          let pIn = Number(row.payment_in ?? row.credit_amount ?? 0);
          let pOut = Number(row.payment_out ?? row.debit_amount ?? 0);
          const typeStr = String(row.transaction_type || row.type || "").toLowerCase();

          if (pIn === 0 && pOut === 0) {
            if (
              typeStr.includes("+") ||
              typeStr.includes("deposit") ||
              typeStr.includes("capital") ||
              typeStr.includes("credit") ||
              typeStr.includes("income") ||
              typeStr.includes("receipt")
            ) {
              pIn = rawAmt;
            } else {
              pOut = rawAmt;
            }
          }

          totalInflow += pIn;
          totalOutflow += pOut;
        });
      }

      const net = totalInflow - totalOutflow;
      setAvailableBalance(net);
      setBankRows(rows);
      return rows;
    } catch (err) {
      console.error("Live balance error in ledger:", err);
      return [];
    }
  };

  const loadData = async () => {
    setLoading(true);

    try {
      // payment_allocations cache fresh — iske baad wale buildAllocations calls
      // table-first chalenge (migration pending ho to wahi purana text-parse).
      await loadDbAllocations(true);
      const bankRowsLive = await calculateLiveBalance();
      console.log("bankRowsLive:", bankRowsLive.length);

      const { data: vData } = await sc("vendors").select("*").order("business_name");
      if (vData) setVendors(vData as Vendor[]);

      const { data: cData } = await sc("customers").select("*").order("business_name");
      if (cData) setCustomers(cData as Customer[]);

      const { data: pData } = await sc("purchases")
        .select("*")
        .order("id", { ascending: false });

      const vendorPayments = bankRowsLive.filter(
        (row: any) =>
          String(row.transaction_type || "").toLowerCase().includes("vendor payment") ||
          String(row.particulars || "").toLowerCase().includes("vendor payment")
      );

      if (pData) {
        const purchaseBills: AllocBill[] = (pData as any[]).map((p: any) => ({
          id: p.id,
          ref: p.inward_no || p.purchase_no || `INW-${p.id}`,
          date: String(p.purchase_date || ""),
          total: Number(p.total_amount || 0),
        }));
        const purchaseAllocations = buildAllocations(purchaseBills, vendorPayments);

        const mappedPurchases = (pData as any[]).map((p: any) => {
          const allocation = purchaseAllocations.get(p.id) || { paid: 0, deduction: 0 };
          const totalAmount = Number(p.total_amount || 0);
          const pendingAmount = Math.max(0, totalAmount - allocation.paid - allocation.deduction);
          const status = pendingAmount <= 0 && totalAmount > 0
            ? "Paid"
            : allocation.paid > 0 || allocation.deduction > 0
              ? "Partial"
              : "Pending";

          return {
            ...p,
            inward_no: p.inward_no || p.purchase_no || `INW-${p.id}`,
            status,
            total_amount: totalAmount,
            paid_amount: allocation.paid,
            deduction_amount: allocation.deduction,
            pending_amount: pendingAmount,
          };
        });
        setPurchases(mappedPurchases as PurchaseBill[]);
      }

      const { data: iData } = await sc("invoices")
        .select("*")
        .order("id", { ascending: false });

      if (iData) {
        const customerReceipts = bankRowsLive.filter((row: any) =>
          String(row.transaction_type || "").toLowerCase().includes("customer receipt") ||
          String(row.particulars || "").toLowerCase().includes("customer receipt")
        );

        const customerById = new Map<number, any>((cData || []).map((customer: any) => [Number(customer.id), customer]));
        const invoiceBills: AllocBill[] = (iData as any[]).map((invoice: any) => ({
          id: invoice.id,
          ref: String(invoice.invoice_no || ""),
          date: String(invoice.invoice_date || ""),
          total: Number(invoice.total_amount || 0),
        }));
        const receiptAllocations = buildAllocations(invoiceBills, customerReceipts);

        const mappedInvoices = iData.map((inv: any) => {
          const customer = customerById.get(Number(inv.customer_id));
          const invoiceCustomerName = customer?.business_name || customer?.customer_name || inv.customer_name || "-";
          const allocation = receiptAllocations.get(inv.id) || {
            paid: 0,
            deduction: 0,
          };
          const receivedAmount = allocation.paid;
          const deductionAmount = allocation.deduction;
          const totalAmount = Number(inv.total_amount || 0);
          const pendingAmount = Math.max(0, totalAmount - receivedAmount - deductionAmount);
          const status = pendingAmount <= 0 && totalAmount > 0
            ? "Paid"
            : receivedAmount > 0 || deductionAmount > 0
              ? "Partial"
              : "Pending";

          return {
            ...inv,
            customer_name: invoiceCustomerName,
            business_name: customer?.business_name || inv.business_name || null,
            status,
            total_amount: totalAmount,
            received_amount: receivedAmount,
            deduction_amount: deductionAmount,
            pending_amount: pendingAmount,
          };
        });
        setInvoices(mappedInvoices as InvoiceBill[]);
      }
    } catch (err) {
      console.error("Error loading Ledger data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadBankAccounts().then((list) => {
      setAccounts(list);
      const preferred = defaultAccount(list);
      if (preferred) {
        setEntryForm((prev) => (prev.account_id ? prev : { ...prev, account_id: String(preferred.id) }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── PARTY LIST (left panel) ───────────────────────────────
  const partyList = useMemo(() => {
    const q = partySearch.trim().toLowerCase();

    if (activeTab === "Vendors") {
      return vendors
        .map((v) => {
          const bills = purchases.filter((p) => String(p.vendor_id) === String(v.id));
          const total = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0);
          const outstanding = bills.reduce(
            (s, b) => s + Number(b.pending_amount ?? b.total_amount ?? 0),
            0
          );
          const name = v.business_name || v.vendor_code || "Vendor";
          return {
            key: String(v.id),
            name,
            code: v.vendor_code || "",
            mobile: v.mobile || "",
            total,
            outstanding,
          };
        })
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
        .sort((a, b) => b.outstanding - a.outstanding);
    }

    return customers
      .map((c) => {
        const custInvoices = invoices.filter((i) => String(i.customer_id) === String(c.id));
        const total = custInvoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
        const outstanding = custInvoices.reduce(
          (s, i) => s + Number(i.pending_amount ?? i.total_amount ?? 0),
          0
        );
        const name = c.business_name || c.customer_name || c.customer_code || "Customer";
        return {
          key: String(c.id),
          name,
          code: c.customer_code || "",
          mobile: c.mobile || "",
          total,
          outstanding,
        };
      })
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [activeTab, partySearch, vendors, customers, purchases, invoices]);

  const selectedParty = partyList.find((p) => p.key === selectedPartyId) || null;

  // ─── PENDING BILLS for selected party ──────────────────────
  const pendingBills = useMemo(() => {
    if (!selectedPartyId) return [];
    if (activeTab === "Customers") {
      return invoices
        .filter(
          (inv) => {
            const belongsToParty = String(inv.customer_id) === String(selectedPartyId);
            const isPending = Number(inv.pending_amount ?? inv.total_amount ?? 0) > 0;
            return belongsToParty && (isPending || !!editingVoucher);
          }
        )
        .map((inv) => ({
          id: inv.id,
          no: inv.invoice_no,
          date: inv.invoice_date,
          name: inv.business_name || inv.customer_name || "-",
          total: Number(inv.total_amount || 0),
          received: Number(inv.received_amount || 0),
          deduction: Number(inv.deduction_amount || 0),
          pending: Number(inv.pending_amount ?? inv.total_amount ?? 0),
          status: inv.status || "Pending",
        }));
    }
    return purchases
      .filter((p) => {
        const match =
          String(p.vendor_id) === String(selectedPartyId) ||
          p.vendor_name === String(selectedPartyId);
        const isPending = Number(p.pending_amount ?? p.total_amount ?? 0) > 0;
        return match && (isPending || !!editingVoucher);
      })
      .map((p) => ({
        id: p.id,
        no: p.inward_no || p.purchase_no || `INW-${p.id}`,
        date: p.purchase_date,
        name: p.vendor_name || "-",
        total: Number(p.total_amount || 0),
        received: Number(p.paid_amount || 0),
        deduction: Number(p.deduction_amount || 0),
        pending: Number(p.pending_amount ?? p.total_amount ?? 0),
        status: p.status || "Pending",
      }));
  }, [activeTab, selectedPartyId, invoices, purchases, editingVoucher]);

  const pendingCols = {
    no: (b: any) => String(b.no || ""),
    date: (b: any) => String(b.date || ""),
    name: (b: any) => String(b.name || ""),
    total: (b: any) => Number(b.total || 0),
    received: (b: any) => Number(b.received || 0),
    deduction: (b: any) => Number(b.deduction || 0),
    pending: (b: any) => Number(b.pending || 0),
    status: (b: any) => String(b.status || ""),
  } as const;
  const { sort, sorted: sortedPendingBills } = useSortedRows(pendingBills, pendingCols, "date", "desc");

  const selectedTotal = useMemo(
    () => pendingBills.filter((b) => entrySelectedIds.includes(b.id)).reduce((s, b) => s + b.pending, 0),
    [pendingBills, entrySelectedIds]
  );

  const recentVouchers = useMemo(() => {
    if (!selectedParty || !selectedParty.name) return [];
    const nameL = selectedParty.name.toLowerCase();
    return bankRows
      .filter((r: any) => {
        const partyL = String(r.party_name || "").toLowerCase();
        const particularsL = String(r.particulars || "").toLowerCase();
        const partyMatch = partyL === nameL || particularsL.includes(nameL);
        if (activeTab === "Customers") {
          return (
            partyMatch &&
            (String(r.transaction_type || "").toLowerCase().includes("customer receipt") ||
              String(r.particulars || "").toLowerCase().includes("customer receipt"))
          );
        }
        return (
          partyMatch &&
          (String(r.transaction_type || "").toLowerCase().includes("vendor payment") ||
            String(r.particulars || "").toLowerCase().includes("vendor payment"))
        );
      })
      .sort((a: any, b: any) => String(b.transaction_date || "").localeCompare(String(a.transaction_date || "")))
      .slice(0, 25);
  }, [selectedParty, activeTab, bankRows]);

  const voucherCols = {
    date: (v: any) => String(v.transaction_date || v.created_at || ""),
    serial_no: (v: any) =>
      String(
        activeTab === "Customers"
          ? v.transaction_no || v.reference_no || `RC-${v.id}`
          : v.transaction_no || `PM-${v.id}`
      ),
    amount: (v: any) => Number(voucherAmount(v)),
    mode: (v: any) => String(v.payment_mode || v.mode || "-"),
  } as const;
  const { sort: vSort, sorted: sortedVouchers } = useSortedRows(recentVouchers, voucherCols, "date", "desc");

  // ─── Actions ──────────────────────────────────────────────
  const selectParty = (key: string) => {
    setSelectedPartyId(key);
    setEntrySelectedIds([]);
    setEntryForm({
      deduction: 0,
      amount: 0,
      payment_mode: "Bank / UPI",
      account_id: entryForm.account_id,
      entry_date: new Date().toISOString().slice(0, 10),
      remarks: "",
      cheque_no: "",
      cheque_date: "",
      utr_no: "",
    });
  };

  const toggleBill = (id: number) => {
    setEntrySelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAllBills = () => {
    if (entrySelectedIds.length === pendingBills.length && pendingBills.length > 0) {
      setEntrySelectedIds([]);
    } else {
      setEntrySelectedIds(pendingBills.map((b) => b.id));
    }
  };

  useEffect(() => {
    const allocSum = entrySelectedIds.reduce((s, id) => s + (Number(billAllocations[id] || 0) || 0), 0);
    if (allocSum > 0 && allocSum <= selectedTotal) {
      setEntryForm((prev) => ({ ...prev, amount: allocSum }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billAllocations, activeTab]);

  const handleDiscountChange = (disc: number) => {
    setEntryForm({
      ...entryForm,
      deduction: disc,
      amount: Math.max(0, selectedTotal - disc),
    });
  };

  // Recompute a vendor's purchase statuses (Paid / Partial / Pending) from all
  // vendor-payment rows in bank_transactions. Used after editing/deleting a payment.
  const recomputeVendorStatuses = async (vendorId: number | string) => {
    const vendor = vendors.find((v) => String(v.id) === String(vendorId));
    const vendorName = vendor?.business_name || "";

    const { data: byId } = await sc("purchases")
      .select("*")
      .eq("vendor_id", vendorId);

    // Legacy bills may have no vendor_id, only the vendor name.
    const { data: byName } = vendorName
      ? await sc("purchases").select("*").eq("vendor_name", vendorName)
      : { data: [] as any[] };

    const merged = new Map<number, any>();
    [...(byName || []), ...(byId || [])].forEach((p: any) => merged.set(Number(p.id), p));
    const vendorBills = [...merged.values()];

    const { data: bankData } = await sc("bank_transactions").select("*");

    const vendorPayments = (bankData || []).filter(
      (row: any) =>
        String(row.transaction_type || "").toLowerCase().includes("vendor payment") ||
        String(row.particulars || "").toLowerCase().includes("vendor payment")
    );

    const purchaseAllocations = buildAllocations(
      vendorBills.map((p: any) => ({
        id: p.id,
        ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`),
        date: String(p.purchase_date || ""),
        total: Number(p.total_amount || 0),
      })),
      vendorPayments
    );

    for (const bill of vendorBills) {
      const alloc = purchaseAllocations.get(Number(bill.id)) || { paid: 0, deduction: 0 };
      const total = Number(bill.total_amount || 0);
      const status =
        alloc.paid + alloc.deduction + 0.005 >= total && total > 0
          ? "Paid"
          : alloc.paid > 0 || alloc.deduction > 0
            ? "Partial"
            : "Pending";
      const { error } = await sc("purchases").update({ status }).eq("id", bill.id);
      if (error) console.error("Status recompute failed:", bill.id, error);
    }
  };

  const startEditVoucher = (r: any) => {
    const disc = Number(String(r.particulars || "").match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);
    const amount = voucherAmount(r);

    setEditingVoucher(r);
    setEntryForm({
      deduction: disc,
      amount,
      payment_mode: r.payment_mode || r.mode || "Bank / UPI",
      account_id: r.account_id ? String(r.account_id) : entryForm.account_id,
      entry_date: r.transaction_date || new Date().toISOString().slice(0, 10),
      remarks: r.remarks || "",
      cheque_no: r.cheque_no || "",
      cheque_date: r.cheque_date ? String(r.cheque_date).slice(0, 10) : "",
      utr_no: r.utr_no || "",
    });

    const particulars = String(r.particulars || "");
    // Table-first: allocation rows hain to edit form unse bharo (text edit ya
    // cut ho jaye tab bhi sahi). Rows nahi to purana text-parse.
    const dbAlloc = getDbAllocations(Number(r.id));
    if (activeTab === "Customers") {
      const invById = new Map(invoices.map((i) => [Number(i.id), i]));
      if (dbAlloc && dbAlloc.size > 0) {
        const ids: number[] = [];
        const alloc: Record<number, number> = {};
        dbAlloc.forEach((v, id) => {
          if (!invById.has(id)) return;
          ids.push(id);
          alloc[id] = v.paid;
        });
        setEntrySelectedIds(ids);
        setBillAllocations(alloc);
      } else {
        const refNos = invoices
          .map((i) => String(i.invoice_no || ""))
          .filter((no) => no && particulars.includes(no));
        const ids = invoices
          .filter((i) => refNos.includes(String(i.invoice_no || "")))
          .map((i) => i.id);
        setEntrySelectedIds(ids);
        const alloc: Record<number, number> = {};
        invoices.forEach((inv) => {
          const no = String(inv.invoice_no || "");
          if (!no) return;
          const m = particulars.match(new RegExp(escapeRegExp(no) + ":\\s*([\\d.]+)"));
          if (m) alloc[inv.id] = Number(m[1]) || 0;
        });
        setBillAllocations(alloc);
      }
    } else {
      const purById = new Map(purchases.map((p) => [Number(p.id), p]));
      if (dbAlloc && dbAlloc.size > 0) {
        const ids: number[] = [];
        const alloc: Record<number, number> = {};
        dbAlloc.forEach((v, id) => {
          if (!purById.has(id)) return;
          ids.push(id);
          alloc[id] = v.paid;
        });
        setEntrySelectedIds(ids);
        setBillAllocations(alloc);
      } else {
        const refNos = purchases
          .map((p) => String(p.inward_no || p.purchase_no || `INW-${p.id}`))
          .filter((no) => no && particulars.includes(no));
        const ids = purchases
          .filter((p) => refNos.includes(String(p.inward_no || p.purchase_no || `INW-${p.id}`)))
          .map((p) => p.id);
        setEntrySelectedIds(ids);
        const alloc: Record<number, number> = {};
        purchases.forEach((p) => {
          const ref = String(p.inward_no || p.purchase_no || `INW-${p.id}`);
          if (!ref) return;
          const m = particulars.match(new RegExp(escapeRegExp(ref) + ":\\s*([\\d.]+)"));
          if (m) alloc[p.id] = Number(m[1]) || 0;
        });
        setBillAllocations(alloc);
      }
    }
  };

  const cancelEditVoucher = () => {
    setEditingVoucher(null);
    setEntrySelectedIds([]);
    setBillAllocations({});
    setEntryForm((prev) => ({ deduction: 0, amount: 0, payment_mode: "Bank / UPI", account_id: prev.account_id, entry_date: new Date().toISOString().slice(0, 10), remarks: "", cheque_no: "", cheque_date: "", utr_no: "" }));
  };

  const deleteVoucher = async (r: any) => {
    const label =
      activeTab === "Customers"
        ? r.transaction_no || r.reference_no || `RC-${r.id}`
        : r.transaction_no || `PM-${r.id}`;
    const amount = voucherAmount(r);
    if (!confirm(`Are you sure?\n\n"${label}" (${money(amount)}) को permanently डिलीट करें?\n\nइसका asar Bank Passbook व Ledger पर दिखेगा।`)) {
      return;
    }
    setSavingEntry(true);
    try {
      // Payment ki bill-wise lines ab permanent table me hain — voucher jaane
      // ke saath unhe bhi hatao (best-effort; table missing ho to delete rukega nahi).
      await deleteVoucherAllocations(Number(r.id));
      const { error } = await sc("bank_transactions").delete().eq("id", r.id);
      if (error) throw error;

      if (activeTab === "Vendors" && selectedPartyId) {
        await recomputeVendorStatuses(Number(selectedPartyId));
      }
      if (editingVoucher && Number(editingVoucher.id) === Number(r.id)) {
        cancelEditVoucher();
      }
      await loadData();
      alert(`🗑️ ${label} delete हो गया।`);
    } catch (err: any) {
      console.error("Delete error:", err);
      alert("❌ Error: " + err.message);
    } finally {
      setSavingEntry(false);
    }
  };

  // ─── BOUNCE / RETURN ──────────────────────────────────────
  // Cheque dishonour / payment wapas aana. Row par `bounced_at` set hote hi
  // buildAllocations, balance aur profit calculations us row ko ignore kar
  // dete hain — bill dobara outstanding ho jaata hai (udhaar wapas).
  const bouncedVouchers = useMemo(
    () =>
      bankRows
        .filter((r: any) => isBounced(r))
        .sort((a: any, b: any) =>
          String(b.bounced_at || "").localeCompare(String(a.bounced_at || ""))
        ),
    [bankRows]
  );

  const bounceVoucher = async (r: any) => {
    const label =
      activeTab === "Customers"
        ? r.transaction_no || r.reference_no || `RC-${r.id}`
        : r.transaction_no || `PM-${r.id}`;
    const amount = voucherAmount(r);
    const reason = prompt(
      `↩ BOUNCE / RETURN\n\n"${label}" (${money(amount)}) — ${r.party_name || "party"}\n\nYe payment dishonour hui hai. Reason likhein (उदा. "Cheque Bounce - Insufficient Funds"):`
    );
    if (reason === null) return;
    setSavingEntry(true);
    try {
      const { error } = await sc("bank_transactions")
        .update({
          bounced_at: new Date().toISOString(),
          bounce_reason: reason.trim() || "Bounced / Returned",
        })
        .eq("id", r.id);
      if (error) throw error;

      if (activeTab === "Vendors" && selectedPartyId) {
        await recomputeVendorStatuses(Number(selectedPartyId));
      }
      await loadData();
      alert(
        `↩ ${label} bounce mark हो गया.\n\nPaisa balance me wapas aa gaya aur bill dubara pending (outstanding) dikhega.`
      );
    } catch (err: any) {
      console.error("Bounce error:", err);
      alert("❌ Error: " + err.message);
    } finally {
      setSavingEntry(false);
    }
  };

  const undoBounceVoucher = async (r: any) => {
    const label =
      activeTab === "Customers"
        ? r.transaction_no || r.reference_no || `RC-${r.id}`
        : r.transaction_no || `PM-${r.id}`;
    if (
      !confirm(
        `↩ Undo Bounce\n\n"${label}" ko wapas normal payment maanein?\n\nYe tab karein jabki galati se bounce lag gaya ho — payment actually clear ho chuka hai.`
      )
    )
      return;
    setSavingEntry(true);
    try {
      const { error } = await sc("bank_transactions")
        .update({ bounced_at: null, bounce_reason: null })
        .eq("id", r.id);
      if (error) throw error;

      if (activeTab === "Vendors" && selectedPartyId) {
        await recomputeVendorStatuses(Number(selectedPartyId));
      }
      await loadData();
      alert(`✅ ${label} wapas normal payment ban gaya.`);
    } catch (err: any) {
      console.error("Undo bounce error:", err);
      alert("❌ Error: " + err.message);
    } finally {
      setSavingEntry(false);
    }
  };

  const printBounceList = () => {
    if (bouncedVouchers.length === 0) {
      alert("कोई bounced/returned payment नहीं मिली।");
      return;
    }
    const rows = bouncedVouchers
      .map(
        (r: any) =>
          `<tr><td>${formatLedgerDate(r.transaction_date || r.created_at)}</td><td>${r.transaction_no || `PM-${r.id}`}</td><td>${r.party_name || "-"}</td><td>${r.payment_mode || "-"}</td><td>${r.cheque_no || "-"}</td><td>${r.utr_no || "-"}</td><td class="right">${money(voucherAmount(r))}</td><td>${r.bounce_reason || "-"}</td><td>${formatLedgerDate(String(r.bounced_at || "").slice(0, 10))}</td></tr>`
      )
      .join("");
    const total = bouncedVouchers.reduce((s: number, r: any) => s + voucherAmount(r), 0);
    const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const html = `<!doctype html><html><head><title>Cheque Bounce List</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:30px}h1{margin:0 0 4px;color:#0f172a}h2{margin:0 0 18px;color:#475569;font-size:15px}p{margin:5px 0;color:#475569}.summary{display:flex;gap:24px;margin:20px 0;padding:14px;background:#fef2f2;border:1px solid #fca5a5}.summary b{display:block;color:#b91c1c;margin-top:4px}.right{text-align:right}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #cbd5e1;padding:9px;font-size:12px}th{background:#fee2e2;text-align:left}@media print{body{margin:12mm}}</style></head><body><h1>MARUTI MODULE SERVICE</h1><h2>Cheque Bounce / Returned Payments</h2><p><b>Report Generated:</b> ${generatedAt}</p><div class="summary"><div>Bounced Payments<b>${bouncedVouchers.length}</b></div><div>Total Amount<b>${money(total)}</b></div></div><table><thead><tr><th>Date</th><th>Voucher No</th><th>Party</th><th>Mode</th><th>Cheque No</th><th>UTR</th><th class="right">Amount (₹)</th><th>Reason</th><th>Bounced On</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:24px">This is a computer-generated statement.</p></body></html>`;
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
      alert("Print window block ho gaya. Browser pop-up allow karein.");
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();

    if (savingEntry) {
      alert("⏳ पिछला entry पहले से save हो रहा है, कृपया ज़रा रुकें...");
      return;
    }

    const amount = Number(entryForm.amount || 0);
    const deduction = Number(entryForm.deduction || 0);

    if (amount <= 0 && deduction <= 0) {
      alert("❌ कृपया सही राशि दर्ज करें!");
      return;
    }
    if (entrySelectedIds.length === 0) {
      alert(activeTab === "Customers" ? "❌ कृपया कम से कम 1 bill सेलेक्ट करें!" : "❌ कृपया कम से कम 1 bill सेलेक्ट करें!");
      return;
    }

    // In edit mode the referenced bills may already be (partially) paid, so the
    // cap is the sum of their original bill totals, not the current pending.
    const limitTotal = editingVoucher
      ? (activeTab === "Customers"
          ? invoices
              .filter((i) => entrySelectedIds.includes(i.id))
              .reduce((s, i) => s + Number(i.total_amount || 0), 0)
          : purchases
              .filter((p) => entrySelectedIds.includes(p.id))
              .reduce((s, p) => s + Number(p.total_amount || 0), 0)) - (editingVoucher ? 0 : 0)
      : selectedTotal;

    if (amount + deduction > limitTotal + 0.005) {
      alert(`❌ Entry limit exceeded. Selected bills ka ${editingVoucher ? "original total" : "pending amount"} sirf ${money(limitTotal)} hai.`);
      return;
    }

    if (entrySelectedIds.length > 0) {
      const netLabel = activeTab === "Customers" ? "Net Received" : "Net Payment";
      const allocSum = entrySelectedIds.reduce((s, id) => s + (Number(billAllocations[id] || 0) || 0), 0);
      const hasAny = entrySelectedIds.some((id) => (Number(billAllocations[id] || 0) || 0) > 0);
      if (hasAny) {
        const missing = entrySelectedIds.filter((id) => !(Number(billAllocations[id] || 0) > 0)).map((id) => {
          const b = pendingBills.find((bb) => bb.id === id);
          return b ? b.no : `#${id}`;
        });
        if (missing.length > 0) {
          alert(`❌ "Pay Now" amount har selected bill ke लिए दर्ज करें — इनमें खाली है: ${missing.join(", ")}`);
          return;
        }
        if (Math.abs(allocSum - amount) > 0.005) {
          alert(`❌ "Pay Now" का कुल (${money(allocSum)}) ${netLabel} (${money(amount)}) के बराबर होना चाहिए!`);
          return;
        }
      } else if (amount < selectedTotal - 0.005) {
        alert(`❌ आंशिक भुगतान के लिए कृपया "Pay Now" में हर bill का अलग amount दर्ज करें। (सिर्फ एक bill select करने पर total amount ही काफी है)`);
        return;
      }
    }
    if (activeTab === "Vendors" && !editingVoucher && amount > availableBalance) {
      alert(
        `⛔ भुगतान अस्वीकृत!\n\nउपलब्ध बैंक बैलेंस: ${money(availableBalance)}\nभुगतान राशि: ${money(amount)}\n\nकारण: पासबुक में पर्याप्त बैलेंस नहीं है।`
      );
      return;
    }

    // Payment proof: Cheque no/date sirf Cheque mode me, UTR har paisa-wale
    // (non-Cash) mode me. Jo field applicable nahi hai wo NULL save hota hai.
    const payDetails = {
      cheque_no: entryForm.payment_mode === "Cheque" ? entryForm.cheque_no.trim() || null : null,
      cheque_date: entryForm.payment_mode === "Cheque" ? entryForm.cheque_date || null : null,
      utr_no: entryForm.payment_mode !== "Cash" ? entryForm.utr_no.trim() || null : null,
    };

    // Record builders — offline queue aur online insert dono isi se banate hain
    // taaki dono paths ka data bilkul same rahe. transaction_no yahan nahi hai:
    // wo sync/insert ke waqt generate hota hai (FY-wise RC/PM series).
    const buildReceiptRecord = () => {
      const selectedInvs = invoices.filter((i) => entrySelectedIds.includes(i.id));
      const { hasExplicit, refs: invNos } = formatBillRefs(
        selectedInvs.map((i) => ({ id: i.id, ref: String(i.invoice_no || "") })),
        billAllocations
      );
      const custName = selectedParty?.name || "Customer";
      const record = {
        transaction_date: entryForm.entry_date,
        particulars: `Customer Receipt: ${custName} (${invNos})${deduction > 0 ? ` [Disc: ₹${deduction}]` : ""}`,
        notes: `Customer Receipt: ${custName} (${invNos})`,
        party_name: custName,
        transaction_type: "Customer Receipt (+)",
        type: "credit",
        payment_in: amount,
        payment_out: 0,
        credit_amount: amount,
        debit_amount: 0,
        amount: amount,
        payment_mode: entryForm.payment_mode,
        account_id: entryForm.account_id ? Number(entryForm.account_id) : null,
        remarks: entryForm.remarks || (deduction > 0 ? `Discount: ₹${deduction}` : ""),
        ...payDetails,
      };
      return { record, hasExplicit, invNos, custName };
    };

    const buildVendorRecord = () => {
      const selectedBills = purchases.filter((p) => entrySelectedIds.includes(p.id));
      const { hasExplicit, refs: inwardNos } = formatBillRefs(
        selectedBills.map((p) => ({ id: p.id, ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`) })),
        billAllocations
      );
      const vendorName = selectedParty?.name || "Vendor";
      const record = {
        transaction_date: entryForm.entry_date,
        particulars: `Vendor Payment: ${vendorName} (${inwardNos})${deduction > 0 ? ` [Disc: ₹${deduction}]` : ""}`,
        notes: `Vendor Payment: ${vendorName} (${inwardNos})`,
        party_name: vendorName,
        transaction_type: "Vendor Payment (-)",
        type: "debit",
        payment_in: 0,
        payment_out: amount,
        credit_amount: 0,
        debit_amount: amount,
        amount: amount,
        payment_mode: entryForm.payment_mode,
        account_id: entryForm.account_id ? Number(entryForm.account_id) : null,
        remarks: entryForm.remarks || (deduction > 0 ? `Discount: ₹${deduction}` : ""),
        ...payDetails,
      };
      // Bill statuses ledger allocation (paid / disc / pending) se aati hain,
      // wahi source jo table dikhata hai — DB aur screen kabhi disagree nahi.
      const statusUpdates: { bill_id: number; status: PurchaseBill["status"] }[] = selectedBills.map((p) => {
        const billPending = Number(p.pending_amount ?? p.total_amount ?? 0);
        const paidNow = hasExplicit ? Number(billAllocations[p.id] || 0) || 0 : billPending;
        return { bill_id: p.id, status: (paidNow + deduction >= billPending - 0.005 ? "Paid" : "Partial") as PurchaseBill["status"] };
      });
      return { record, statusUpdates, vendorName };
    };

    // 📴 Offline: entry queue me save hoti hai aur internet aate hi app apne aap
    // server par bhej deta hai (niche "pending sync" banner dikhta hai). Edit
    // offline me allow nahi — purani voucher par live checks offline nahi ho sakte.
    if (isOffline()) {
      if (editingVoucher) {
        alert("📴 Offline mode — voucher edit save nahi ho sakta. Internet connect karke dobara try karein.");
        return;
      }
      if (activeTab === "Customers") {
        const { record, custName } = buildReceiptRecord();
        enqueueOffline({
          label: `Receipt ₹${amount.toLocaleString("en-IN")} — ${custName}`,
          kind: "receipt",
          payload: {
            record,
            // Allocation rows abhi (bina txn id ke) ban jati hain — sync ke
            // waqt bank_transaction_id jud jayega.
            alloc_rows: voucherAllocRows(
              "invoice",
              invoices.map((i) => ({
                id: i.id,
                ref: String(i.invoice_no || ""),
                date: String(i.invoice_date || ""),
                total: Number(i.total_amount || 0),
              })),
              bankRows.filter(isReceiptRow),
              record,
              bankRows.filter(isReceiptRow).length
            ),
          },
        });
      } else {
        const { record, statusUpdates, vendorName } = buildVendorRecord();
        enqueueOffline({
          label: `Payment ₹${amount.toLocaleString("en-IN")} — ${vendorName}`,
          kind: "vendor_payment",
          payload: {
            record,
            status_updates: statusUpdates,
            alloc_rows: voucherAllocRows(
              "purchase",
              purchases.map((p) => ({
                id: p.id,
                ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`),
                date: String(p.purchase_date || ""),
                total: Number(p.total_amount || 0),
              })),
              bankRows.filter(isVendorPaymentRow),
              record,
              bankRows.filter(isVendorPaymentRow).length
            ),
          },
        });
      }
      alert("📴 Offline — entry queue me save ho gayi hai. Internet aate hi app apne aap save kar dega (niche 'pending sync' banner dikhega).");
      setEntrySelectedIds([]);
      setBillAllocations({});
      return;
    }

    setSavingEntry(true);
    try {
      if (editingVoucher) {
        // ── EDIT MODE: update the existing bank_transactions row, keep serial ──
        if (activeTab === "Customers") {
          const selectedInvs = invoices.filter((i) => entrySelectedIds.includes(i.id));
          const { refs: invNos } = formatBillRefs(
            selectedInvs.map((i) => ({ id: i.id, ref: String(i.invoice_no || "") })),
            billAllocations
          );
          const custName = selectedParty?.name || "Customer";

          const updatePayload = {
            transaction_date: entryForm.entry_date,
            particulars: `Customer Receipt: ${custName} (${invNos})${deduction > 0 ? ` [Disc: ₹${deduction}]` : ""}`,
            notes: `Customer Receipt: ${custName} (${invNos})`,
            party_name: custName,
            transaction_type: "Customer Receipt (+)",
            type: "credit",
            payment_in: amount,
            payment_out: 0,
            credit_amount: amount,
            debit_amount: 0,
            amount: amount,
            payment_mode: entryForm.payment_mode,
          account_id: entryForm.account_id ? Number(entryForm.account_id) : null,
            remarks: entryForm.remarks || (deduction > 0 ? `Discount: ₹${deduction}` : ""),
            ...payDetails,
          };

          const { error: updErr } = await sc("bank_transactions")
            .update(updatePayload)
            .eq("id", editingVoucher.id);
          if (updErr) throw updErr;

          // Table rows dobara calculate: edited voucher ki jagah naya record,
          // aur uske baad ke sab bhi (cumulative context badla hai).
          const receiptsAll = bankRows.filter(isReceiptRow);
          const editIdx = receiptsAll.findIndex(
            (x: any) => Number(x.id) === Number(editingVoucher.id)
          );
          const mergedReceipt = { ...editingVoucher, ...updatePayload };
          const orderedReceipts =
            editIdx >= 0
              ? receiptsAll.map((x: any, i: number) => (i === editIdx ? mergedReceipt : x))
              : [...receiptsAll, mergedReceipt];
          await saveVoucherAllocations(
            "invoice",
            invoices.map((i) => ({
              id: i.id,
              ref: String(i.invoice_no || ""),
              date: String(i.invoice_date || ""),
              total: Number(i.total_amount || 0),
            })),
            orderedReceipts,
            editIdx >= 0 ? editIdx : receiptsAll.length,
            editIdx >= 0
              ? receiptsAll.slice(editIdx).map((x: any) => Number(x.id))
              : [Number(editingVoucher.id)]
          );

          alert(`✅ Receipt ${editingVoucher.transaction_no || `RC-${editingVoucher.id}`} update हो गई!`);
        } else {
          const selectedBills = purchases.filter((p) => entrySelectedIds.includes(p.id));
          const { refs: inwardNos } = formatBillRefs(
            selectedBills.map((p) => ({ id: p.id, ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`) })),
            billAllocations
          );
          const vendorName = selectedParty?.name || "Vendor";

          const updatePayload = {
            transaction_date: entryForm.entry_date,
            particulars: `Vendor Payment: ${vendorName} (${inwardNos})${deduction > 0 ? ` [Disc: ₹${deduction}]` : ""}`,
            notes: `Vendor Payment: ${vendorName} (${inwardNos})`,
            party_name: vendorName,
            transaction_type: "Vendor Payment (-)",
            type: "debit",
            payment_in: 0,
            payment_out: amount,
            credit_amount: 0,
            debit_amount: amount,
            amount: amount,
            payment_mode: entryForm.payment_mode,
          account_id: entryForm.account_id ? Number(entryForm.account_id) : null,
            remarks: entryForm.remarks || (deduction > 0 ? `Discount: ₹${deduction}` : ""),
            ...payDetails,
          };

          const { error: updErr } = await sc("bank_transactions")
            .update(updatePayload)
            .eq("id", editingVoucher.id);
          if (updErr) throw updErr;

          const paymentsAll = bankRows.filter(isVendorPaymentRow);
          const editIdx = paymentsAll.findIndex(
            (x: any) => Number(x.id) === Number(editingVoucher.id)
          );
          const mergedPayment = { ...editingVoucher, ...updatePayload };
          const orderedPayments =
            editIdx >= 0
              ? paymentsAll.map((x: any, i: number) => (i === editIdx ? mergedPayment : x))
              : [...paymentsAll, mergedPayment];
          await saveVoucherAllocations(
            "purchase",
            purchases.map((p) => ({
              id: p.id,
              ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`),
              date: String(p.purchase_date || ""),
              total: Number(p.total_amount || 0),
            })),
            orderedPayments,
            editIdx >= 0 ? editIdx : paymentsAll.length,
            editIdx >= 0
              ? paymentsAll.slice(editIdx).map((x: any) => Number(x.id))
              : [Number(editingVoucher.id)]
          );

          if (selectedPartyId) {
            await recomputeVendorStatuses(Number(selectedPartyId));
          }
          alert(`✅ Payment ${editingVoucher.transaction_no || `PM-${editingVoucher.id}`} update हो गया!`);
        }

        cancelEditVoucher();
        await loadData();
        return;
      }

      if (activeTab === "Customers") {
        const { record, hasExplicit } = buildReceiptRecord();
        const transaction_no = await getNextTransactionNo("RC", entryForm.entry_date);

        const { data: inserted, error: bankErr } = await sc("bank_transactions")
          .insert([{ ...record, transaction_no }])
          .select("id");
        if (bankErr) throw bankErr;

        const newId = Number(inserted?.[0]?.id || 0);
        const priorReceipts = bankRows.filter(isReceiptRow);
        await saveVoucherAllocations(
          "invoice",
          invoices.map((i) => ({
            id: i.id,
            ref: String(i.invoice_no || ""),
            date: String(i.invoice_date || ""),
            total: Number(i.total_amount || 0),
          })),
          [...priorReceipts, { ...record, id: newId }],
          priorReceipts.length,
          [newId]
        );

        setInvoices((prev) =>
          prev.map((inv) => {
            if (!entrySelectedIds.includes(inv.id)) return inv;
            const alloc = hasExplicit ? (billAllocations[inv.id] || 0) : amount + deduction;
            const fullyCovered = alloc + deduction >= Number(inv.pending_amount ?? inv.total_amount ?? 0) - 0.005;
            return { ...inv, status: fullyCovered ? "Paid" : "Partial" };
          })
        );
        alert(`✅ ${money(amount)} की रसीद (RC) सफलतापूर्वक पासबुक में जमा हो गई!`);
      } else {
        const { record, statusUpdates } = buildVendorRecord();
        const transaction_no = await getNextTransactionNo("PM", entryForm.entry_date);

        const { data: inserted, error: bankErr } = await sc("bank_transactions")
          .insert([{ ...record, transaction_no }])
          .select("id");
        if (bankErr) throw bankErr;

        const newId = Number(inserted?.[0]?.id || 0);
        const priorPayments = bankRows.filter(isVendorPaymentRow);
        await saveVoucherAllocations(
          "purchase",
          purchases.map((p) => ({
            id: p.id,
            ref: String(p.inward_no || p.purchase_no || `INW-${p.id}`),
            date: String(p.purchase_date || ""),
            total: Number(p.total_amount || 0),
          })),
          [...priorPayments, { ...record, id: newId }],
          priorPayments.length,
          [newId]
        );

        const statusById = new Map<number, PurchaseBill["status"]>();
        statusUpdates.forEach((upd) => statusById.set(upd.bill_id, upd.status));

        for (const upd of statusUpdates) {
          const { error: updateErr } = await sc("purchases")
            .update({ status: upd.status })
            .eq("id", upd.bill_id);
          if (updateErr) console.error("Status update failed:", upd.bill_id, updateErr);
        }

        setPurchases((prev) =>
          prev.map((p) =>
            entrySelectedIds.includes(p.id)
              ? { ...p, status: statusById.get(p.id) || "Partial" }
              : p
          )
        );
        alert(`✅ ${money(amount)} का भुगतान (PM) सफलतापूर्वक दर्ज हो गया!`);
      }

      setEntrySelectedIds([]);
      setBillAllocations({});
      await loadData();
    } catch (err: any) {
      console.error("Entry error:", err);
      alert("❌ Error: " + err.message);
    } finally {
      setSavingEntry(false);
    }
  };

  const printLedger = (mode: "complete" | "pending") => {
    const startYear = fyStartYear(ledgerFinancialYear);
    const { from, to } = fyFromStartYear(startYear);

    if (activeTab === "Customers") {
      const partyInvoices = invoices.filter(
        (inv) =>
          inv.invoice_date >= from &&
          inv.invoice_date <= to &&
          (selectedPartyId === "" || String(inv.customer_id) === String(selectedPartyId))
      );
      if (partyInvoices.length === 0) {
        alert("इस Financial Year में कोई customer invoice नहीं मिला!");
        return;
      }
      const invoiceNumbers = new Set(partyInvoices.map((i) => i.invoice_no));
      const relevantReceipts = bankRows.filter((row: any) =>
        !isBounced(row) &&
        [...invoiceNumbers].some((no) => String(row.particulars || "").includes(String(no))) &&
        String(row.transaction_date || "") >= from &&
        String(row.transaction_date || "") <= to
      );
      const label = selectedParty?.name || "All Customers";
      const receiptRows = relevantReceipts.map((row: any) => {
        const refs = String(row.particulars || "").match(/INV-\d{4}-\d{4}/g) || [];
        const disc = Number(String(row.particulars || "").match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);
        return { date: row.transaction_date || "-", ref: [...new Set(refs)].join(", ") || "Receipt", received: Number(row.payment_in ?? row.credit_amount ?? 0), deduction: disc };
      });
      const pendingInvoices = partyInvoices.filter((i) => Number(i.pending_amount ?? i.total_amount ?? 0) > 0);
      const totalBill = partyInvoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const totalReceived = partyInvoices.reduce((s, i) => s + Number(i.received_amount || 0), 0);
      const totalDeduction = partyInvoices.reduce((s, i) => s + Number(i.deduction_amount || 0), 0);
      const totalPending = partyInvoices.reduce((s, i) => s + Number(i.pending_amount ?? i.total_amount ?? 0), 0);
      const rows = mode === "pending"
        ? pendingInvoices.map((i) => `<tr><td>${formatLedgerDate(i.invoice_date)}</td><td>${i.invoice_no}</td><td>Invoice</td><td class="right">${money(Number(i.total_amount || 0))}</td><td class="right">${money(Number(i.pending_amount ?? i.total_amount ?? 0))}</td></tr>`).join("")
        : [...partyInvoices.map((i) => `<tr><td>${formatLedgerDate(i.invoice_date)}</td><td>${i.invoice_no}</td><td>Invoice Bill</td><td class="right">${money(Number(i.total_amount || 0))}</td><td class="right">${money(0)}</td></tr>`), ...receiptRows.map((r) => `<tr><td>${formatLedgerDate(r.date)}</td><td>${r.ref}</td><td>Customer Receipt${r.deduction ? ` / Discount ${money(r.deduction)}` : ""}</td><td class="right">${money(0)}</td><td class="right">${money(r.received)}</td></tr>`)].sort().join("");
      const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      const html = `<!doctype html><html><head><title>Customer Ledger - ${label}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:30px}h1{margin:0 0 4px;color:#0f172a}h2{margin:0 0 18px;color:#475569;font-size:15px}p{margin:5px 0;color:#475569}.summary{display:flex;gap:24px;margin:20px 0;padding:14px;background:#f8fafc;border:1px solid #cbd5e1}.summary b{display:block;color:#0f172a;margin-top:4px}.right{text-align:right}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #cbd5e1;padding:9px;font-size:12px}th{background:#e2e8f0;text-align:left}.total{font-weight:700;background:#f1f5f9}@media print{body{margin:12mm}}</style></head><body><h1>MARUTI MODULE SERVICE</h1><h2>${mode === "complete" ? "Customer Complete Ledger" : "Customer Pending Ledger"} | FY ${ledgerFinancialYear}</h2><p><b>Customer:</b> ${label}</p><p><b>Report Generated:</b> ${generatedAt}</p><p>Period: 01/04/${startYear} to 31/03/${startYear + 1}</p>${mode === "complete" ? `<div class="summary"><div>Total Bills<b>${money(totalBill)}</b></div><div>Received<b>${money(totalReceived)}</b></div><div>Deduction<b>${money(totalDeduction)}</b></div><div>Pending<b>${money(totalPending)}</b></div></div><table><thead><tr><th>Date</th><th>Invoice / Receipt Ref.</th><th>Particulars</th><th class="right">Debit / Bill</th><th class="right">Credit / Receipt</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="summary"><div>Total Outstanding<b>${money(totalPending)}</b></div></div><table><thead><tr><th>Date</th><th>Invoice No.</th><th>Particulars</th><th class="right">Bill Total</th><th class="right">Pending Amount</th></tr></thead><tbody>${rows}</tbody></table>`}<p style="margin-top:24px">This is a computer-generated statement.</p></body></html>`;
      const printWindow = window.open("", "_blank", "width=1100,height=800");
      if (!printWindow) { alert("Print window block ho gaya. Browser pop-up allow karein."); return; }
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
      return;
    }

    // Vendor ledger
    const partyBills = purchases.filter(
      (p) =>
        p.purchase_date >= from &&
        p.purchase_date <= to &&
        (selectedPartyId === "" || String(p.vendor_id) === String(selectedPartyId))
    );
    if (partyBills.length === 0) {
      alert("इस Financial Year में कोई vendor purchase नहीं मिला!");
      return;
    }
    const label = selectedParty?.name || "All Vendors";
    const billNumbers = new Set(partyBills.map((p) => p.inward_no));
    const relevantPayments = bankRows.filter((row: any) =>
      !isBounced(row) &&
      [...billNumbers].some((no) => String(row.particulars || "").includes(String(no))) &&
      String(row.transaction_date || "") >= from &&
      String(row.transaction_date || "") <= to &&
      String(row.transaction_type || "").toLowerCase().includes("vendor")
    );
    const pendingBills = partyBills.filter((p) => Number(p.pending_amount ?? p.total_amount ?? 0) > 0);
    const totalBill = partyBills.reduce((s, p) => s + Number(p.total_amount || 0), 0);
    const totalPayment = relevantPayments.reduce((s, r) => s + Number(r.payment_out ?? r.debit_amount ?? 0), 0);
    const totalPending = partyBills.reduce((s, p) => s + Number(p.pending_amount ?? p.total_amount ?? 0), 0);
    const rows = mode === "pending"
      ? pendingBills.map((p) => `<tr><td>${formatLedgerDate(p.purchase_date)}</td><td>${p.inward_no}</td><td>${p.vendor_name || "-"}</td><td class="right">${money(Number(p.total_amount || 0))}</td><td class="right">${money(Number(p.pending_amount ?? p.total_amount ?? 0))}</td></tr>`).join("")
      : [...partyBills.map((p) => `<tr><td>${formatLedgerDate(p.purchase_date)}</td><td>${p.inward_no}</td><td>Purchase - ${p.vendor_name || "-"}</td><td class="right">${money(Number(p.total_amount || 0))}</td><td class="right">${money(0)}</td></tr>`), ...relevantPayments.map((r) => `<tr><td>${formatLedgerDate(r.transaction_date)}</td><td>${r.transaction_no || "PM-" + String(r.id || "")}</td><td>Payment</td><td class="right">${money(0)}</td><td class="right">${money(Number(r.payment_out ?? r.debit_amount ?? 0))}</td></tr>`)].sort().join("");
    const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const html = `<!doctype html><html><head><title>Vendor Ledger - ${label}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:30px}h1{margin:0 0 4px;color:#0f172a}h2{margin:0 0 18px;color:#475569;font-size:15px}p{margin:5px 0;color:#475569}.summary{display:flex;gap:24px;margin:20px 0;padding:14px;background:#f8fafc;border:1px solid #cbd5e1}.summary b{display:block;color:#0f172a;margin-top:4px}.right{text-align:right}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #cbd5e1;padding:9px;font-size:12px}th{background:#e2e8f0;text-align:left}@media print{body{margin:12mm}}</style></head><body><h1>MARUTI MODULE SERVICE</h1><h2>${mode === "complete" ? "Vendor Complete Ledger" : "Vendor Pending Ledger"} | FY ${ledgerFinancialYear}</h2><p><b>Vendor:</b> ${label}</p><p><b>Report Generated:</b> ${generatedAt}</p><p>Period: 01/04/${startYear} to 31/03/${startYear + 1}</p>${mode === "complete" ? `<div class="summary"><div>Total Bills<b>${money(totalBill)}</b></div><div>Paid<b>${money(totalPayment)}</b></div><div>Pending<b>${money(totalPending)}</b></div></div><table><thead><tr><th>Date</th><th>Bill / Payment Ref.</th><th>Particulars</th><th class="right">Bill Amount</th><th class="right">Payment</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="summary"><div>Total Outstanding<b>${money(totalPending)}</b></div></div><table><thead><tr><th>Date</th><th>Bill No.</th><th>Vendor</th><th class="right">Bill Total</th><th class="right">Pending Amount</th></tr></thead><tbody>${rows}</tbody></table>`}<p style="margin-top:24px">This is a computer-generated statement.</p></body></html>`;
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) { alert("Print window block ho gaya. Browser pop-up allow karein."); return; }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  // ─── STYLES ───────────────────────────────────────────────
  const panelCard: React.CSSProperties = {
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
  };

  const entryAmountEnabled = activeTab === "Vendors" && !editingVoucher ? entryForm.amount <= availableBalance : true;

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Payments &amp; Ledger
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            VP (Vendor Payment) &amp; CR (Customer Receipt) Voucher Entry
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={ledgerFinancialYear} onChange={(e) => setLedgerFinancialYear(e.target.value)} style={filterInputStyle}>
            {fyOptions(5).map((fy) => (
              <option key={fy} value={fy}>{fy}</option>
            ))}
          </select>

          <div
            style={{
              background: availableBalance > 0 ? "#f0fdf4" : "#fef2f2",
              border: `2px solid ${availableBalance > 0 ? "#86efac" : "#fca5a5"}`,
              padding: "6px 14px",
              borderRadius: 8,
              textAlign: "right",
            }}
          >
            <span style={{ fontSize: 11, color: "#64748b", display: "block", fontWeight: 700 }}>🏦 Live Passbook Balance</span>
            <strong style={{ fontSize: 15, color: availableBalance > 0 ? "#15803d" : "#b91c1c" }}>{money(availableBalance)}</strong>
          </div>

          <button
            onClick={() => setShowBounceList(true)}
            title="Cheque Bounce / Returned payments list"
            style={{
              background: bouncedVouchers.length > 0 ? "#fef2f2" : "#f8fafc",
              color: bouncedVouchers.length > 0 ? "#b91c1c" : "#475569",
              border: `2px solid ${bouncedVouchers.length > 0 ? "#fca5a5" : "#e2e8f0"}`,
              padding: "8px 12px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ⚠️ Bounce List{bouncedVouchers.length > 0 ? ` (${bouncedVouchers.length})` : ""}
          </button>

          <button
            onClick={() => loadData()}
            style={{ background: "#0f172a", color: "#fff", border: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
          >
            🔄 Refresh
          </button>

          <div style={{ display: "flex", background: "#e2e8f0", padding: 4, borderRadius: 10 }}>
            <button
              onClick={() => { setActiveTab("Vendors"); setSelectedPartyId(""); setEntrySelectedIds([]); }}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
                background: activeTab === "Vendors" ? "#0f172a" : "transparent",
                color: activeTab === "Vendors" ? "#fff" : "#475569",
              }}
            >
              💳 Vendor Payment (VP)
            </button>
            <button
              onClick={() => { setActiveTab("Customers"); setSelectedPartyId(""); setEntrySelectedIds([]); }}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
                background: activeTab === "Customers" ? "#0f172a" : "transparent",
                color: activeTab === "Customers" ? "#fff" : "#475569",
              }}
            >
              🧾 Customer Receipt (CR)
            </button>
          </div>
        </div>
      </div>

      {/* MAIN TWO-PANEL LAYOUT */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* LEFT: PARTY LIST */}
        <div style={{ ...panelCard, width: 300, flexShrink: 0 }}>
          <div style={{ padding: "14px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <strong style={{ fontSize: 13, color: "#0f172a", display: "block", marginBottom: 8 }}>
              {activeTab === "Vendors" ? "🏢 Vendor List" : "👥 Customer List"} ({partyList.length})
            </strong>
            <input
              type="text"
              placeholder="Search party by name / code..."
              value={partySearch}
              onChange={(e) => setPartySearch(e.target.value)}
              style={{ ...filterInputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto", padding: 6 }}>
            {loading ? (
              <p style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 13 }}>Loading...</p>
            ) : partyList.length === 0 ? (
              <p style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                कोई party नहीं मिली।
              </p>
            ) : (
              partyList.map((p) => {
                const active = p.key === selectedPartyId;
                return (
                  <button
                    key={p.key}
                    onClick={() => selectParty(p.key)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: 4,
                      borderRadius: 8,
                      border: active ? "2px solid #2563eb" : "1px solid #e2e8f0",
                      background: active ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13, color: "#0f172a", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.code ? `[${p.code}] ` : ""}{p.name}
                      </strong>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{p.mobile}</span>
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: 20,
                        background: p.outstanding > 0 ? "#fee2e2" : "#dcfce7",
                        color: p.outstanding > 0 ? "#b91c1c" : "#166534",
                      }}
                    >
                      {p.outstanding > 0 ? `Due ${money(p.outstanding)}` : "Clear ✓"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: ENTRY */}
        <div style={{ flex: 1, minWidth: 360 }}>
          {!selectedParty ? (
            <div style={{ ...panelCard, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 42 }}>{activeTab === "Vendors" ? "💳" : "🧾"}</div>
              <h3 style={{ margin: "10px 0 6px", color: "#0f172a", fontSize: 17 }}>
                {activeTab === "Vendors" ? "Vendor Payment Entry" : "Customer Receipt Entry"}
              </h3>
              <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
                बाईं ओर से party चुनें — उसके pending bills नीचे दिखेंगे, select karke entry save karein.
              </p>
            </div>
          ) : (
            <>
              {/* PARTY INFO BAR */}
              <div style={{ ...panelCard, padding: "14px 18px", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                      {activeTab === "Vendors" ? "VENDOR" : "CUSTOMER"}
                    </div>
                    <strong style={{ fontSize: 18, color: "#0f172a" }}>
                      {selectedParty.code ? `[${selectedParty.code}] ` : ""}
                      {selectedParty.name}
                    </strong>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      Total Bills: {money(selectedParty.total)} &nbsp;•&nbsp; Outstanding:{" "}
                      <span style={{ color: selectedParty.outstanding > 0 ? "#b91c1c" : "#166534", fontWeight: 800 }}>
                        {money(selectedParty.outstanding)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => printLedger("complete")} style={{ ...filterButtonStyle, background: "#0f766e", color: "#fff" }}>
                      🖨️ Complete Ledger
                    </button>
                    <button onClick={() => printLedger("pending")} style={{ ...filterButtonStyle, background: "#b91c1c", color: "#fff" }}>
                      🖨️ Pending Ledger
                    </button>
                  </div>
                </div>
              </div>

              {/* PENDING BILLS */}
              <div style={{ ...panelCard, marginBottom: 14 }}>
                <div
                  style={{
                    padding: "12px 16px",
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: 13, color: "#0f172a" }}>
                    🧾 {activeTab === "Customers" ? "Pending Invoices" : "Pending Bills"} ({pendingBills.length})
                  </strong>
                  {pendingBills.length > 0 && (
                    <button
                      onClick={toggleAllBills}
                      style={{ ...filterButtonStyle, background: "#e2e8f0", color: "#0f172a" }}
                    >
                      {entrySelectedIds.length === pendingBills.length ? "Uncheck All" : "☑ Select All Pending"}
                    </button>
                  )}
                </div>

                {pendingBills.length === 0 ? (
                  <p style={{ padding: 22, margin: 0, textAlign: "center", color: "#16a34a", fontSize: 13, fontWeight: 700 }}>
                    ✅ इस party का कोई बकाया (pending) bill नहीं है।
                  </p>
                ) : (
                  <div className="responsive-table-wrapper" style={{ maxHeight: 300, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                      <thead>
                        <tr style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
                          <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={entrySelectedIds.length === pendingBills.length && pendingBills.length > 0}
                              onChange={toggleAllBills}
                            />
                          </th>
                          <th style={thStyle}>{activeTab === "Customers" ? "Invoice No" : "Inward No"}</th>
                          <SortTh label="Date" active={sort.key === "date"} dir={sort.dir} onToggle={() => sort.toggle("date")} style={thStyle} />
                          <SortTh label={activeTab === "Customers" ? "Customer Name" : "Vendor Name"} active={sort.key === "name"} dir={sort.dir} onToggle={() => sort.toggle("name")} style={thStyle} />
                          <SortTh label={activeTab === "Customers" ? "Invoice Total (₹)" : "Bill Total (₹)"} active={sort.key === "total"} dir={sort.dir} onToggle={() => sort.toggle("total")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                          <SortTh label={activeTab === "Customers" ? "Rec. (₹)" : "Paid (₹)"} active={sort.key === "received"} dir={sort.dir} onToggle={() => sort.toggle("received")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                          <SortTh label="Disc. (₹)" active={sort.key === "deduction"} dir={sort.dir} onToggle={() => sort.toggle("deduction")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                          <th style={{ ...thStyle, textAlign: "right", width: 90 }}>Pay Now (₹)</th>
                          <SortTh label="Pending (₹)" active={sort.key === "pending"} dir={sort.dir} onToggle={() => sort.toggle("pending")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                          <SortTh label="Status" active={sort.key === "status"} dir={sort.dir} onToggle={() => sort.toggle("status")} style={{ ...thStyle, textAlign: "center" }} align="center" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPendingBills.map((b) => {
                          const isChecked = entrySelectedIds.includes(b.id);
                          return (
                            <tr
                              key={b.id}
                              style={{
                                borderBottom: "1px solid #f1f5f9",
                                fontSize: 12,
                                background: isChecked ? "#eff6ff" : "transparent",
                              }}
                            >
                              <td style={{ ...tdStyle, textAlign: "center" }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleBill(b.id)} />
                              </td>
                              <td style={{ ...tdStyle, fontWeight: 700, color: "#2563eb" }}>{b.no}</td>
                              <td style={tdStyle}>{formatLedgerDate(b.date)}</td>
                              <td style={tdStyle}>{b.name}</td>
                              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800 }}>{money(b.total)}</td>
                              <td style={{ ...tdStyle, textAlign: "right", color: "#15803d" }}>{money(b.received)}</td>
                              <td style={{ ...tdStyle, textAlign: "right", color: "#b45309" }}>{money(b.deduction)}</td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={b.pending}
                                  disabled={!isChecked}
                                  value={billAllocations[b.id] ?? ""}
                                  placeholder={isChecked ? "0" : "-"}
                                  onChange={(e) =>
                                    setBillAllocations((prev) => {
                                      const next = { ...prev };
                                      const v = Number(e.target.value);
                                      next[b.id] = isNaN(v) ? 0 : v;
                                      return next;
                                    })
                                  }
                                  onFocus={() => {
                                    if (isChecked && billAllocations[b.id] === undefined) {
                                      setBillAllocations((prev) => ({ ...prev, [b.id]: 0 }));
                                    }
                                  }}
                                  style={{
                                    width: "100%",
                                    minWidth: 70,
                                    padding: "4px 6px",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    textAlign: "right",
                                    background: isChecked ? "#fff" : "#f1f5f9",
                                    color: "#0f172a",
                                  }}
                                />
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{money(b.pending)}</td>
                              <td style={{ ...tdStyle, textAlign: "center" }}>
                                <span
                                  style={{
                                    background: b.status === "Partial" ? "#fef3c7" : "#fee2e2",
                                    color: b.status === "Partial" ? "#92400e" : "#991b1b",
                                    padding: "2px 8px",
                                    borderRadius: 20,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    display: "inline-block",
                                  }}
                                >
                                  {b.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ENTRY FORM */}
              <div style={{ ...panelCard, padding: 18 }}>
                {editingVoucher && (
                  <div
                    style={{
                      marginBottom: 14,
                      background: "#fef9c3",
                      border: "1px solid #fde047",
                      color: "#854d0e",
                      padding: "10px 14px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span>
                      ✏️ Editing{" "}
                      {activeTab === "Customers"
                        ? editingVoucher.transaction_no || `RC-${editingVoucher.id}`
                        : editingVoucher.transaction_no || `PM-${editingVoucher.id}`}
                      {" "}— Save par update hoga (serial No. वही रहेगा)
                    </span>
                    <button
                      type="button"
                      onClick={cancelEditVoucher}
                      style={{ background: "#fff", color: "#854d0e", border: "1px solid #fde047", borderRadius: 8, padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}
                    >
                      ✖ Cancel Edit
                    </button>
                  </div>
                )}
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      background: entrySelectedIds.length > 0 ? "#eff6ff" : "#f8fafc",
                      border: entrySelectedIds.length > 0 ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 14,
                      fontWeight: 800,
                      color: entrySelectedIds.length > 0 ? "#1e40af" : "#475569",
                    }}
                  >
                    <span>Selected Bills: {entrySelectedIds.length}</span>
                    <span>Total Pending: {money(selectedTotal)}</span>
                  </div>
                </div>

                <form onSubmit={handleSaveEntry}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Discount / Deduction (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={selectedTotal}
                        value={entryForm.deduction}
                        onChange={(e) => handleDiscountChange(Number(e.target.value))}
                        style={modalInputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>
                        {activeTab === "Customers" ? "Net Received (₹) *" : "Net Payment (₹) *"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={entryForm.amount}
                        onChange={(e) => setEntryForm({ ...entryForm, amount: Number(e.target.value) })}
                        style={{ ...modalInputStyle, fontSize: 15, fontWeight: 800, color: "#0f172a" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Mode *</label>
                      <select
                        value={entryForm.payment_mode}
                        onChange={(e) => {
                          const mode = e.target.value;
                          setEntryForm((prev) => {
                            // Mode = Cash lekin account bank wala hai → cash account
                            // par le jaao. Warna receipt banegi to Cash Book me
                            // dikhegi hi nahi, sirf Passbook me.
                            if (mode === "Cash") {
                              const cur = accounts.find((a) => String(a.id) === prev.account_id);
                              if (!isCashAccount(cur)) {
                                const cashAcc = accounts.find((a) => isCashAccount(a));
                                if (cashAcc) return { ...prev, payment_mode: mode, account_id: String(cashAcc.id) };
                              }
                            }
                            return { ...prev, payment_mode: mode };
                          });
                        }}
                        style={modalInputStyle}
                      >
                        <option value="Bank / UPI">Bank / UPI</option>
                        <option value="Cash">Cash</option>
                        <option value="Cheque">Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Date *</label>
                      <input
                        type="date"
                        required
                        value={entryForm.entry_date}
                        onChange={(e) => setEntryForm({ ...entryForm, entry_date: e.target.value })}
                        style={modalInputStyle}
                      />
                    </div>
                  </div>

                  {accounts.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Account (किस अकाउंट में पैसा आया/गया) *</label>
                      <select
                        value={entryForm.account_id}
                        onChange={(e) => {
                          const id = e.target.value;
                          const acc = accounts.find((a) => String(a.id) === id);
                          setEntryForm({
                            ...entryForm,
                            account_id: id,
                            // Account hi source of truth — Mode uske hisaab se.
                            // Par Cash ke alawa kisi bhi account par Cheque mode
                            // barqarar rakho, warna cheque no/date bharte-bharte
                            // mode wapas "Bank / UPI" ho jaayega.
                            payment_mode: acc
                              ? isCashAccount(acc)
                                ? "Cash"
                                : entryForm.payment_mode === "Cheque"
                                  ? "Cheque"
                                  : "Bank / UPI"
                              : entryForm.payment_mode,
                          });
                        }}
                        style={modalInputStyle}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.account_type}){a.is_default ? " — default" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Payment proof: Cheque mode me cheque no/date, har
                      paisa-wale (non-Cash) mode me UTR — bina UTR ke bank
                      transfer ka proof nahi milta. */}
                  {entryForm.payment_mode === "Cheque" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={labelStyle}>Cheque No.</label>
                        <input
                          type="text"
                          placeholder="उदा. 123456"
                          value={entryForm.cheque_no}
                          onChange={(e) => setEntryForm({ ...entryForm, cheque_no: e.target.value })}
                          style={modalInputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Cheque Date</label>
                        <input
                          type="date"
                          value={entryForm.cheque_date}
                          onChange={(e) => setEntryForm({ ...entryForm, cheque_date: e.target.value })}
                          style={modalInputStyle}
                        />
                      </div>
                    </div>
                  )}

                  {entryForm.payment_mode !== "Cash" && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>
                        UTR / Transaction Ref No. {activeTab === "Vendors" ? "(bank transfer proof)" : "(received payment proof)"}
                      </label>
                      <input
                        type="text"
                        placeholder="उदा. 225012345678 (UPI / NEFT / IMPS / RTGS reference)"
                        value={entryForm.utr_no}
                        onChange={(e) => setEntryForm({ ...entryForm, utr_no: e.target.value })}
                        style={modalInputStyle}
                      />
                    </div>
                  )}

                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Remarks / Note</label>
                    <input
                      type="text"
                      placeholder={activeTab === "Customers" ? "उदा. अग्रिम रसीद" : "उदा. आंशिक भुगतान"}
                      value={entryForm.remarks}
                      onChange={(e) => setEntryForm({ ...entryForm, remarks: e.target.value })}
                      style={modalInputStyle}
                    />
                  </div>

                  {activeTab === "Vendors" && !editingVoucher && entryForm.amount > availableBalance && (
                    <div
                      style={{
                        marginBottom: 12,
                        background: "#fef2f2",
                        border: "1px solid #fca5a5",
                        padding: "8px 12px",
                        borderRadius: 8,
                        color: "#b91c1c",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      ⛔ भुगतान अवरुद्ध: सॉफ्टवेयर में पर्याप्त बैलेंस नहीं है!
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEntrySelectedIds([]);
                        setBillAllocations({});
                        setEntryForm((prev) => ({ deduction: 0, amount: 0, payment_mode: "Bank / UPI", account_id: prev.account_id, entry_date: new Date().toISOString().slice(0, 10), remarks: "", cheque_no: "", cheque_date: "", utr_no: "" }));
                      }}
                      style={{ background: "#f1f5f9", color: "#475569", border: "none", padding: "10px 18px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
                    >
                      Clear
                    </button>
                    <button
                      type="submit"
                      disabled={!entryAmountEnabled || savingEntry}
                      style={{
                        background: activeTab === "Customers" ? "#15803d" : "#b45309",
                        color: "#fff",
                        border: "none",
                        padding: "10px 22px",
                        borderRadius: 8,
                        fontWeight: 700,
                        cursor: !entryAmountEnabled || savingEntry ? "not-allowed" : "pointer",
                        opacity: savingEntry ? 0.6 : 1,
                      }}
                    >
                      {savingEntry
                        ? editingVoucher
                          ? "⏳ Updating..."
                          : "⏳ Saving..."
                        : editingVoucher
                          ? activeTab === "Customers"
                            ? "💾 Update Receipt (RC)"
                            : "💾 Update Payment (PM)"
                          : activeTab === "Customers"
                            ? "💾 Save Receipt (RC)"
                            : "💾 Save Payment (PM)"}
                    </button>
                  </div>
                </form>
              </div>

              {/* RECENT VOUCHERS */}
              {recentVouchers.length > 0 && (
                <div style={{ ...panelCard, marginTop: 14 }}>
                  <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <strong style={{ fontSize: 13, color: "#0f172a" }}>📋 Recent {activeTab === "Customers" ? "Receipts" : "Payments"} ({recentVouchers.length})</strong>
                  </div>
                  <div className="responsive-table-wrapper" style={{ maxHeight: 220, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <SortTh label="Date" active={vSort.key === "date"} dir={vSort.dir} onToggle={() => vSort.toggle("date")} style={thStyle} />
                          <SortTh label="Serial No" active={vSort.key === "serial_no"} dir={vSort.dir} onToggle={() => vSort.toggle("serial_no")} style={thStyle} />
                          <SortTh label="Amount (₹)" active={vSort.key === "amount"} dir={vSort.dir} onToggle={() => vSort.toggle("amount")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                          <SortTh label="Mode" active={vSort.key === "mode"} dir={vSort.dir} onToggle={() => vSort.toggle("mode")} style={thStyle} />
                          <th style={thStyle}>Ref (Cheque / UTR)</th>
                          <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedVouchers.map((r: any, idx: number) => (
                          <tr key={r.id ?? idx} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                            <td style={tdStyle}>{formatLedgerDate(r.transaction_date || r.created_at)}</td>
                            <td style={{ ...tdStyle, fontWeight: 700, color: "#2563eb" }}>
                              {activeTab === "Customers"
                                ? r.transaction_no || r.reference_no || `RC-${r.id}`
                                : r.transaction_no || `PM-${r.id}`}
                              {r.bounced_at ? (
                                <span
                                  title={r.bounce_reason || "Bounced / Returned"}
                                  style={{
                                    display: "inline-block",
                                    marginLeft: 6,
                                    fontSize: 10,
                                    background: "#fee2e2",
                                    color: "#b91c1c",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    fontWeight: 800,
                                  }}
                                >
                                  ↩ BOUNCED
                                </span>
                              ) : null}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, textDecoration: r.bounced_at ? "line-through" : "none" }}>
                              {money(voucherAmount(r))}
                            </td>
                            <td style={tdStyle}>{r.payment_mode || r.mode || "-"}</td>
                            <td style={{ ...tdStyle, fontSize: 11, color: "#475569" }}>
                              {r.cheque_no
                                ? `Cheque ${r.cheque_no}${r.cheque_date ? ` (${formatLedgerDate(r.cheque_date)})` : ""}`
                                : r.utr_no
                                  ? `UTR ${r.utr_no}`
                                  : "—"}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                              {r.bounced_at ? (
                                <button
                                  onClick={() => undoBounceVoucher(r)}
                                  title="Undo bounce — payment actually clear ho chuka hai"
                                  style={{ background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 6, padding: "4px 8px", fontWeight: 700, cursor: "pointer", fontSize: 11, marginRight: 6 }}
                                >
                                  ↩ Undo
                                </button>
                              ) : (
                                <button
                                  onClick={() => bounceVoucher(r)}
                                  title="Cheque Bounce / Payment Return — udhaar wapas outstanding ho jayega"
                                  style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "4px 8px", fontWeight: 700, cursor: "pointer", fontSize: 11, marginRight: 6 }}
                                >
                                  ↩ Bounce
                                </button>
                              )}
                              <button
                                onClick={() => startEditVoucher(r)}
                                title="Edit this receipt/payment"
                                style={{ background: "#e0f2fe", color: "#0369a1", border: "none", borderRadius: 6, padding: "4px 8px", fontWeight: 700, cursor: "pointer", fontSize: 11, marginRight: 6 }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => deleteVoucher(r)}
                                title="Delete this receipt/payment"
                                style={{ background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 6, padding: "4px 8px", fontWeight: 700, cursor: "pointer", fontSize: 11 }}
                              >
                                🗑️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* CHEQUE BOUNCE LIST — chhoti report: sabhi bounced/returned payments */}
      {showBounceList && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setShowBounceList(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: 980,
              maxHeight: "85vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                background: "#fef2f2",
                borderBottom: "1px solid #fecaca",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong style={{ fontSize: 15, color: "#991b1b" }}>
                  ⚠️ Cheque Bounce / Return List ({bouncedVouchers.length})
                </strong>
                <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>
                  In payments ka paisa bank me nahi aaya/gaya — bill wapas outstanding hai.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={printBounceList} style={{ ...filterButtonStyle, background: "#0f172a", color: "#fff" }}>
                  🖨️ Print
                </button>
                <button onClick={() => setShowBounceList(false)} style={{ ...filterButtonStyle, background: "#fff", color: "#b91c1c", border: "1px solid #fca5a5" }}>
                  ✖ Close
                </button>
              </div>
            </div>

            <div style={{ overflow: "auto", padding: 0 }}>
              {bouncedVouchers.length === 0 ? (
                <p style={{ padding: 34, textAlign: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, margin: 0 }}>
                  ✅ कोई bounced/returned payment नहीं है — सब clear है।
                </p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Voucher No</th>
                      <th style={thStyle}>Party</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Amount (₹)</th>
                      <th style={thStyle}>Mode</th>
                      <th style={thStyle}>Cheque / UTR</th>
                      <th style={thStyle}>Reason</th>
                      <th style={thStyle}>Bounced On</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bouncedVouchers.map((r: any) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                        <td style={tdStyle}>{formatLedgerDate(r.transaction_date || r.created_at)}</td>
                        <td style={{ ...tdStyle, fontWeight: 700, color: "#2563eb" }}>
                          {r.transaction_no || (String(r.transaction_type || "").toLowerCase().includes("customer") ? `RC-${r.id}` : `PM-${r.id}`)}
                        </td>
                        <td style={tdStyle}>{r.party_name || "-"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, textDecoration: "line-through" }}>
                          {money(voucherAmount(r))}
                        </td>
                        <td style={tdStyle}>{r.payment_mode || r.mode || "-"}</td>
                        <td style={{ ...tdStyle, fontSize: 11, color: "#475569" }}>
                          {r.cheque_no ? `Cheque ${r.cheque_no}` : r.utr_no ? `UTR ${r.utr_no}` : "—"}
                        </td>
                        <td style={{ ...tdStyle, color: "#b91c1c" }}>{r.bounce_reason || "-"}</td>
                        <td style={tdStyle}>{formatLedgerDate(String(r.bounced_at || "").slice(0, 10))}</td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <button
                            onClick={() => {
                              undoBounceVoucher(r);
                            }}
                            title="Payment clear ho chuka hai — wapas normal karein"
                            style={{ background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 6, padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: 11 }}
                          >
                            ↩ Undo Bounce
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#fef2f2" }}>
                      <td colSpan={3} style={{ ...tdStyle, fontWeight: 800, color: "#991b1b" }}>
                        Total bounced amount
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#b91c1c" }}>
                        {money(bouncedVouchers.reduce((s: number, r: any) => s + voucherAmount(r), 0))}
                      </td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const filterButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const filterInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "#334155",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  marginTop: 4,
  boxSizing: "border-box",
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#334155",
};

export default PaymentsLedger;