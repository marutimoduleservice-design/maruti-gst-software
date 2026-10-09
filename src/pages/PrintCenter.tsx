import { useEffect, useState, useMemo } from "react";
import { sc } from "../lib/company";
import {
  buildAllocations,
  getDbAllocations,
  loadDbAllocations,
  type AllocBill,
} from "../lib/billAllocations";
import QRCode from "qrcode";
import { SIGNATURE_DATA_URL } from "../lib/signatureData";
import { currentFY, fyFromStartYear, fyOptions, fyStartYear } from "../lib/financialYear";

type TabKey = "po" | "invoice" | "receipt" | "payment" | "ledger";

const ALL_PARTY_KEY = "__ALL_PARTY__";

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: "po", label: "Purchase PO", icon: "🛒", desc: "Purchase Order for vendor" },
  { key: "invoice", label: "Sales Invoice", icon: "🧾", desc: "Invoice for customer" },
  { key: "receipt", label: "Payment Receipt", icon: "💵", desc: "Money received from customer" },
  { key: "payment", label: "Payment Paid", icon: "🏦", desc: "Money paid to vendor" },
  { key: "ledger", label: "Customer Ledger", icon: "📒", desc: "Full account statement" },
];

const COMPANY = {
  name: "MARUTI MODULE SERVICE",
  tagline: "Electronic Jacquard Module Service & Repairing Specialist",
  address: "Surat, Gujarat, India",
  phone: "",
  email: "",
  gstin: "",
  pan: "",
  state_code: "24",
  udyam_number: "UDYAM-GJ-22-0603419",
  bank_name: "",
  bank_account_holder: "",
  bank_account_number: "",
  bank_ifsc: "",
  upi_id: "",
  signature_name: "Authorised Signatory",
  website: "",
  po_terms: "",
  sales_terms: "",
};

const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (v: unknown): string =>
  `₹ ${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (v: unknown): string => {
  const s = String(v || "").slice(0, 10);
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};

const dueDateFromTerm = (invoiceDate: string, term: string): string => {
  const d = new Date(invoiceDate + "T00:00:00");
  if (isNaN(d.getTime())) return invoiceDate;
  const days = String(term || "").match(/(\d+)\s*Days/i);
  if (days) {
    d.setDate(d.getDate() + Number(days[1]));
  } else if (/10\s*(th|st)?\s*(of)?\s*(every\s+)?next\s*month/i.test(String(term || ""))) {
    d.setMonth(d.getMonth() + 1, 10);
  }
  return d.toISOString().slice(0, 10);
};

const numToWords = (num: number): string => {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (num === 0) return "Zero";
  const two = (n: number): string => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : ""));
  const three = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  let str = "";
  const cr = Math.floor(num / 10000000);
  const lk = Math.floor((num % 10000000) / 100000);
  const th = Math.floor((num % 100000) / 1000);
  const re = Math.floor(num % 1000);
  if (cr) str += three(cr) + " Crore ";
  if (lk) str += three(lk) + " Lakh ";
  if (th) str += three(th) + " Thousand ";
  if (re) str += three(re);
  return str.trim();
};

const openPrintWindow = (title: string, body: string) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 5mm 5mm; }
  html { margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #172033; margin: 0; padding: 0; background: #f1f5f9; }
  .preview-bar { position: sticky; top: 0; z-index: 100; max-width: 820px; margin: 0 auto 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; box-shadow: 0 6px 18px rgba(15,23,42,0.25); }
  .preview-bar .p-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; }
  .preview-bar .p-btns { display: flex; gap: 8px; }
  .preview-bar button { border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .preview-bar .btn-print { background: #f59e0b; color: #0f172a; }
  .preview-bar .btn-close { background: #374151; color: #e5e7eb; }
  .paper { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 10mm 12mm; border: 1px solid #e2e8f0; box-shadow: 0 4px 24px rgba(15,23,42,0.08); display: flex; flex-direction: column; }
  .paper .signatures { margin-top: auto; }
  @media print { body { background: #fff; padding: 0; width: 200mm; } .preview-bar { display: none !important; } .paper { width: 200mm; min-height: 287mm; overflow: visible; border: none; box-shadow: none; padding: 0; margin: 0; } body { font-size: 12px; } .paper table { font-size: 11.5px; margin: 4px 0; } .paper td, .paper th { padding: 4px 6px; line-height: 1.35; } .paper table.inv-items td { padding: 8px 6px; line-height: 1.5; font-size: 12px; } .paper .company-top { padding-bottom: 6px; margin-bottom: 6px; } .paper .company-top h1 { font-size: 20px; } .paper .company-top p { font-size: 10px; margin-top: 2px; } .paper .doc-title { font-size: 16px; margin: 8px 0 2px; } .paper .doc-band { margin-bottom: 6px; } .paper .meta-grid { margin-bottom: 8px; } .paper .party-box, .paper .info-box { padding: 8px 10px; } .paper .party-box .name { font-size: 13px; } .paper .amount-words { margin: 4px 0; padding: 6px 10px; font-size: 11px; } .paper .pay-table { margin: 4px 0; } .paper .pay-table td { padding: 3px 6px; } .paper .terms-box { font-size: 10px; padding: 6px 10px; margin: 4px 0 0; line-height: 1.4; } .paper .terms-box ol li { margin-bottom: 1px; } .paper .signatures { margin-top: auto; } .paper .signature .line { width: 130px; min-height: 20px; } }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  table, table tbody { page-break-inside: auto; }
  .company-top { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
  .company-top h1 { margin: 0; font-size: 26px; letter-spacing: 2px; color: #0f172a; font-weight: 900; }
  .company-top p { margin: 4px 0 0; font-size: 12px; color: #475569; letter-spacing: 0.5px; }
  .doc-title { text-align: center; margin: 12px 0 4px; font-size: 20px; letter-spacing: 4px; font-weight: 800; color: #1e293b; }
  .doc-band { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 18px; letter-spacing: 1px; }
  .meta-grid { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
  .party-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; flex: 1; background: #fff; }
  .party-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 700; }
  .party-box .name { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 3px; }
  .party-box div { font-size: 12px; color: #334155; margin-top: 2px; word-wrap: break-word; overflow-wrap: break-word; }
  .party-box .addr { white-space: normal; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
  .info-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; min-width: 250px; background: #fff; }
  .info-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
  .info-row b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12.5px; }
  table.inv-items td { padding: 9px 10px; line-height: 1.5; font-size: 12.5px; }
  th { background: #f8fafc; color: #334155; padding: 9px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }
  td { border: 1px solid #d8dee9; padding: 8px 10px; color: #1e293b; }
  .tot-row td { background: #f8fafc; font-weight: 800; font-size: 13px; }
  .tot-row .grand td { background: #f8fafc; color: #0f172a; font-weight: 900; font-size: 14px; }
  .amount-words { font-size: 12px; color: #334155; margin: 10px 0; padding: 10px 12px; background: #fff; border-left: 4px solid #94a3b8; border-radius: 4px; }
  .notes { font-size: 11px; color: #64748b; margin: 14px 0; }
  .signatures { display: flex; justify-content: space-between; margin-top: 42px; }
  .signature { text-align: center; font-size: 12px; color: #475569; display: flex; flex-direction: column; align-items: center; }
  .signature .line { border-top: 1.5px solid #64748b; width: 180px; margin: auto 0 0; padding-top: 6px; font-weight: 700; color: #0f172a; min-height: 26px; }
  .signature .sig-img { max-width: 130px; height: auto; display: block; margin: 0 0 10px; }
  .signature .s-label { font-size: 10px; font-weight: 500; color: #475569; margin-top: 2px; }
  .footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; letter-spacing: 1px; }
  .badge { display: inline-block; background: #f8fafc; color: #475569; font-size: 10px; font-weight: 800; padding: 2px 10px; border-radius: 99px; letter-spacing: 1px; border: 1px solid #e2e8f0; }
  .pay-table { margin: 12px 0 4px; }
  .pay-table td { border: 1px solid #d8dee9; padding: 7px 10px; font-size: 11.5px; }
  .terms-box { margin: 12px 0 0; padding: 10px 12px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #fff; font-size: 11px; color: #475569; line-height: 1.6; }
  .terms-box ol li { margin-bottom: 3px; }
  .inv-summary { display: flex; justify-content: flex-end; margin: 10px 0; font-size: 13px; }
  .inv-summary .sum-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 18px; font-weight: 800; color: #0f172a; }
</style></head><body>
<div class="preview-bar">
  <div class="p-title">📄 ${esc(title)} — Preview</div>
  <div class="p-btns">
    <button class="btn-print" onclick="window.print()">🖨️ Print Now</button>
    <button class="btn-close" onclick="window.close()">✕ Close</button>
  </div>
</div>
<div class="paper">
  <div class="company-top">
    <h1>${esc(COMPANY.name)}</h1>
    <p>${esc(COMPANY.tagline)}</p>
    <p style="margin-top:4px;font-size:11px;color:#64748b">${esc(COMPANY.address)}</p>
    <p style="margin-top:4px;font-size:11px;color:#64748b">${[COMPANY.phone ? "Ph: " + esc(COMPANY.phone) : "", COMPANY.email ? "Email: " + esc(COMPANY.email) : "", COMPANY.website ? "Web: " + esc(COMPANY.website) : "", COMPANY.gstin ? "GSTIN: " + esc(COMPANY.gstin) : "", COMPANY.pan ? "PAN: " + esc(COMPANY.pan) : ""].filter(Boolean).join(" &nbsp;|&nbsp; ")}</p>
  </div>
  ${body}
  <div class="footer">This is a computer generated document &nbsp;•&nbsp; Generated on ${esc(new Date().toLocaleString("en-IN"))} &nbsp;•&nbsp; Thank you for your business</div>
</div>
</body></html>`;

  const printWindow = window.open("", "_blank", "width=1050,height=850");
  if (!printWindow) {
    alert("Preview window block ho gaya. Browser pop-up allow karein.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
};

function PrintCenter() {
  const [activeTab, setActiveTab] = useState<TabKey>("po");
  const [loading, setLoading] = useState(true);

  const [purchases, setPurchases] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [partyFilter, setPartyFilter] = useState("");
  const [recordFilter, setRecordFilter] = useState("");
  const [activePartyKey, setActivePartyKey] = useState<string>("");
  const [quickQuery, setQuickQuery] = useState("");
  const [ledgerFY, setLedgerFY] = useState<string>(() => currentFY().label);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [pRes, tRes, iiRes, cRes, vRes, btRes, compRes] = await Promise.all([
          sc("purchases").select("*").order("id", { ascending: true }),
          sc("invoices").select("*").order("id", { ascending: true }),
          sc("invoice_items").select("*").order("id", { ascending: true }),
          sc("customers").select("*").order("business_name"),
          sc("vendors").select("*").order("business_name"),
          sc("bank_transactions").select("*").order("id", { ascending: true }),
          sc("company_settings").select("*").limit(1),
        ]);
        const compRow = compRes.data && compRes.data[0];
        if (compRow) {
          Object.assign(COMPANY, {
            name: compRow.business_name || COMPANY.name,
            tagline: compRow.tagline || COMPANY.tagline,
            address: compRow.business_address || COMPANY.address,
            phone: compRow.phone || "",
            email: compRow.email || "",
            gstin: compRow.gstin || "",
            pan: compRow.pan || "",
            state_code: compRow.state_code || "24",
            udyam_number: compRow.udyam_number || COMPANY.udyam_number,
            bank_name: compRow.bank_name || "",
            bank_account_holder: compRow.bank_account_holder || "",
            bank_account_number: compRow.bank_account_number || "",
            bank_ifsc: compRow.bank_ifsc || "",
            upi_id: compRow.upi_id || "",
            signature_name: compRow.signature_name || "Authorised Signatory",
            website: compRow.website || "",
            po_terms: compRow.po_terms || "",
            sales_terms: compRow.sales_terms || "",
          });
        }
        const purchasesData = pRes.data || [];
        const invoicesData = tRes.data || [];
        const invoiceItemsData = iiRes.data || [];
        const customersData = cRes.data || [];
        const vendorsData = vRes.data || [];
        // Bounced/returned rows ko ledgers/statements me count mat karo.
        const bankRows = (btRes.data || []).filter((r: any) => !r.bounced_at);

        const customerById = new Map<number, any>(customersData.map((c: any) => [Number(c.id), c]));
        const receiptRows = bankRows.filter((r: any) => {
          const t = String(r.transaction_type || r.type || "").toLowerCase();
          const p = String(r.particulars || "").toLowerCase();
          return t.includes("customer receipt") || p.includes("customer receipt");
        }).map((r: any) => ({
          ...r,
          customerRefs: (invoicesData as any[]).filter((iv) => String(r.particulars || "").includes(String(iv.invoice_no || ""))),
        }));

        // Customer-wise received/deduction — `payment_allocations` table se
        // (buildAllocations table-first). Rows nahi to wahi purana text-parse.
        await loadDbAllocations(true);
        const invoiceBillsForAlloc: AllocBill[] = (invoicesData as any[]).map((iv: any) => ({
          id: Number(iv.id),
          ref: String(iv.invoice_no || ""),
          date: String(iv.invoice_date || ""),
          total: Number(iv.total_amount || 0),
        }));
        const allocByInvoiceId = buildAllocations(invoiceBillsForAlloc, receiptRows);
        const customerAllocations = new Map<string, { received: number; deduction: number }>();
        invoiceBillsForAlloc.forEach((b) => {
          const alloc = allocByInvoiceId.get(b.id);
          if (alloc && (alloc.paid > 0 || alloc.deduction > 0)) {
            customerAllocations.set(b.ref, { received: alloc.paid, deduction: alloc.deduction });
          }
        });
        const mappedInvoicesData = (invoicesData as any[]).map((inv: any) => {
          const alloc = customerAllocations.get(String(inv.invoice_no || "")) || { received: 0, deduction: 0 };
          const totalAmt = Number(inv.total_amount || 0);
          const pendingAmt = Math.max(0, totalAmt - alloc.received - alloc.deduction);
          const status2 = pendingAmt <= 0 && totalAmt > 0
            ? "Paid"
            : alloc.received > 0 || alloc.deduction > 0
              ? "Partial"
              : "Pending";
          return {
            ...inv,
            status: status2,
            received_amount: alloc.received,
            deduction_amount: alloc.deduction,
            pending_amount: pendingAmt,
          } as any;
        });
        const paymentRows = bankRows.filter((r: any) => {
          const t = String(r.transaction_type || r.type || "").toLowerCase();
          const p = String(r.particulars || "").toLowerCase();
          return t.includes("vendor payment") || t.includes("purchase payment") || p.includes("vendor payment") || p.includes("purchase payment") || p.includes("inw-");
        }).map((r: any) => {
          const inwSet = new Set<string>(
            String(r.particulars || "").match(/INW-\d+/gi)?.map((x: string) => x.toUpperCase()) || []
          );
          const matched = inwSet.size
            ? (purchasesData as any[]).filter((p) => inwSet.has(String(p.inward_no || "").toUpperCase()))
            : [];
          return { ...r, customerRefs: [], paymentRefs: matched };
        });

        setPurchases(purchasesData);
        setInvoices(mappedInvoicesData);
        setInvoiceItems(invoiceItemsData);
        setCustomers(customersData);
        setVendors(vendorsData);
        setReceipts(receiptRows as any[]);
        setPayments(paymentRows as any[]);

        const firstPOGroups: any[] = [];
        const seenPO = new Set<string>();
        purchasesData.forEach((p: any) => {
          const poNo = String(p.purchase_no || p.inward_no || "");
          if (!seenPO.has(poNo)) {
            seenPO.add(poNo);
            firstPOGroups.push(p);
          }
        });
        setSelectedPO(firstPOGroups.length ? firstPOGroups[firstPOGroups.length - 1] : null);
        setSelectedInvoice(invoicesData.length ? invoicesData[invoicesData.length - 1] : null);
        setSelectedReceipt(receiptRows.length ? receiptRows[receiptRows.length - 1] : null);
        setSelectedPayment(paymentRows.length ? paymentRows[paymentRows.length - 1] : null);
        setSelectedCustomer(customersData.length ? customersData[customersData.length - 1] : null);
        void customerById;
      } catch (err) {
        console.error("Print center load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const customerName = (id: unknown) => {
    const c = customers.find((cc) => String(cc.id) === String(id));
    return c ? c.business_name || c.customer_name || "Customer" : "—";
  };

  const vendorName = (pid: unknown, vName?: unknown) => {
    if (vName) return String(vName);
    const v = vendors.find((vv) => String(vv.id) === String(pid));
    return v ? v.business_name || v.name || "Vendor" : "Vendor";
  };

  const vendorRecord = (pid: unknown, vName?: unknown) => {
    const byId = vendors.find((vv) => String(vv.id) === String(pid));
    if (byId) return byId;
    if (vName) return vendors.find((vv) => String(vv.business_name || vv.name || "").toLowerCase() === String(vName).toLowerCase()) || null;
    return null;
  };

  const customerRecord = (id: unknown) => customers.find((cc) => String(cc.id) === String(id)) || null;

  // Group purchases by PO number so dropdown shows one entry per PO + vendor
  const poGroups = useMemo(() => {
    const groups = new Map<string, any>();
    purchases.forEach((p: any) => {
      const poNo = String(p.purchase_no || p.inward_no || "");
      if (!groups.has(poNo)) {
        groups.set(poNo, {
          purchase_no: poNo,
          vendor_id: p.vendor_id,
          vendor_name: p.vendor_name,
          vendor_code: p.vendor_code,
          purchase_date: p.purchase_date,
          firstId: p.id,
        });
      }
    });
    return [...groups.values()].sort((a, b) => String(a.purchase_no).localeCompare(String(b.purchase_no)));
  }, [purchases]);

  const printBodyForPO = (po: any) => {
    const poRows = purchases.filter((p) => String(p.purchase_no || "") === String(po.purchase_no || ""));
    const items = poRows.map((p) => ({
      item: p.item_name || "-",
      code: p.item_code || "-",
      qty: Number(p.quantity || 0),
      rate: Number(p.rate || 0),
      total: Number(p.total_amount) || Number(p.quantity || 0) * Number(p.rate || 0),
    }));
    const total = items.reduce((s, i) => s + i.total, 0);
    const vendor = vendorRecord(po.vendor_id, po.vendor_name);
    const rawStatus = String(po.payment_status || po.status || "").toLowerCase();
    const statusLabel = rawStatus.includes("paid") ? "Paid" : rawStatus.includes("partial") ? "Partial" : "Unpaid";
    const poTerms = COMPANY.po_terms ? COMPANY.po_terms.split(/\n+/).map((t) => `<li>${esc(t.trim())}</li>`).join("") : "";
    return `
  <div class="doc-title">PURCHASE ORDER</div>
  <div class="doc-band">PO No: ${esc(po.purchase_no || po.inward_no || "-")} &nbsp;•&nbsp; Date: ${esc(fmtDate(po.purchase_date))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Supplier</div>
      <div class="name">${po.vendor_code ? "<span style=\"font-weight:800\">Code: " + esc(po.vendor_code) + " | </span>" : ""}${esc(vendorName(po.vendor_id, po.vendor_name))}</div>
      <div>${vendor?.address ? esc(vendor.address) : ""}</div>
      <div>${vendor?.mobile ? "Mobile: " + esc(vendor.mobile) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>PO Reference</span><b>${esc(po.purchase_no || po.inward_no || "-")}</b></div>
      <div class="info-row"><span>Status</span><b>${esc(statusLabel)}</b></div>
      <div class="info-row"><span>Payment Mode</span><b>${esc(po.payment_mode || "—")}</b></div>
      <div class="info-row"><span>Total Amount</span><b>${money(total)}</b></div>
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Code</th><th>Item Description</th><th class="c">Qty</th><th class="r">Rate (₹)</th><th class="r">Amount (₹)</th></tr></thead>
    <tbody>${items.map((i, idx) => `<tr><td>${idx + 1}</td><td>${esc(i.code)}</td><td style="font-weight:600">${esc(i.item)}</td><td class="c">${i.qty}</td><td class="r">${i.rate.toFixed(2)}</td><td class="r">${money(i.total)}</td></tr>`).join("")}</tbody>
    <tr class="tot-row"><td colspan="5" style="text-align:right">Grand Total</td><td class="r">${money(total)}</td></tr>
  </table>
  <div class="amount-words"><b>Amount in words:</b> ${numToWords(Math.round(total))} Rupees Only</div>
  <div style="page-break-inside: avoid; break-inside: avoid;">
    <div class="terms-box"><b>Terms &amp; Conditions:</b>${poTerms ? `<ol style="margin:4px 0 0 16px;padding:0">${poTerms}</ol>` : ` This purchase order is subject to the standard terms &amp; conditions of the company. Delivery quality must be as per sample approved.`}</div>
    <div class="signatures">
      <div class="signature"><div class="line">Authorised Signatory</div>Prepared By</div>
      <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>Owner / Manager</div>
      <div class="signature"><div class="line">Received By</div>Store / Accounts</div>
    </div>
  </div>`;
  };

  const printBodyForInvoice = async (inv: any) => {
    const customer = customers.find((cc) => String(cc.id) === String(inv.customer_id));
    const items = invoiceItems.filter((it) => String(it.invoice_id) === String(inv.id));
    const itemsTotal = items.length
      ? items.reduce((s, it) => s + (Number(it.total) || Number(it.quantity || 0) * Number(it.rate || 0)), 0)
      : Number(inv.total_amount) || 0;
    const total = Number(inv.total_amount) || itemsTotal;

    // GST: header values saved invoice par, warna lines se fallback.
    const itemTaxable = items.reduce((s, it: any) => s + (Number(it.taxable_value) || Number(it.total) || 0), 0);
    const itemCgst = items.reduce((s, it: any) => s + (Number(it.cgst_amount) || 0), 0);
    const itemSgst = items.reduce((s, it: any) => s + (Number(it.sgst_amount) || 0), 0);
    const itemIgst = items.reduce((s, it: any) => s + (Number(it.igst_amount) || 0), 0);
    const headerTax = Number(inv.cgst_amount || 0) + Number(inv.sgst_amount || 0) + Number(inv.igst_amount || 0);
    const gstMode = headerTax > 0 || itemCgst + itemSgst + itemIgst > 0 || (Boolean(COMPANY.gstin) && itemTaxable > 0);
    const tTaxable = Number(inv.taxable_amount || 0) || itemTaxable;
    const cgst = Number(inv.cgst_amount || 0) || itemCgst;
    const sgst = Number(inv.sgst_amount || 0) || itemSgst;
    const igst = Number(inv.igst_amount || 0) || itemIgst;
    const roundOff = Number(inv.round_off || 0);
    const customerGstin = inv.customer_gstin || customer?.gst_number || "";
    const placeOfSupply = inv.place_of_supply || customer?.state_name || "";
    let qrDataUrl = "";
    if (COMPANY.upi_id) {
      const upiLink = `upi://pay?pa=${encodeURIComponent(COMPANY.upi_id)}&pn=${encodeURIComponent(COMPANY.bank_account_holder || COMPANY.name)}&am=${total.toFixed(2)}&cu=INR`;
      try {
        qrDataUrl = await QRCode.toDataURL(upiLink, { width: 216, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
      } catch {
        qrDataUrl = "";
      }
    }
    const itemRows = items.length
      ? items.map((it: any, i: number) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(it.item_name || "-")}</td>
          ${gstMode ? `<td class="c">${esc(it.hsn_code || "—")}</td>` : ""}
          <td class="c">${Number(it.quantity || 0)}</td>
          <td class="r">${money(Number(it.rate || 0))}</td>
          <td class="r">${money(Number(it.taxable_value) || Number(it.total) || Number(it.quantity || 0) * Number(it.rate || 0))}</td>
        </tr>`).join("")
      : `<tr>
          <td class="c">1</td>
          <td>Module Service & Spare Parts</td>
          ${gstMode ? `<td class="c">—</td>` : ""}
          <td class="c">1</td>
          <td class="r">${money(total)}</td>
          <td class="r">${money(total)}</td>
        </tr>`;
    const gstTaxSummary = gstMode
      ? `<table style="width:100%;margin:2px 0 6px">
          <tbody>
            <tr><td style="text-align:right">Taxable Value</td><td class="r" style="width:130px">${money(tTaxable)}</td></tr>
            ${igst > 0
              ? `<tr><td style="text-align:right">IGST</td><td class="r">${money(igst)}</td></tr>`
              : `<tr><td style="text-align:right">CGST</td><td class="r">${money(cgst)}</td></tr>
                 <tr><td style="text-align:right">SGST</td><td class="r">${money(sgst)}</td></tr>`}
            ${roundOff !== 0 ? `<tr><td style="text-align:right">Round Off</td><td class="r">${money(roundOff)}</td></tr>` : ""}
            <tr class="tot-row"><td style="text-align:right">Grand Total</td><td class="r">${money(total)}</td></tr>
          </tbody>
        </table>`
      : "";
    const invReceipts = receipts.filter((rc) =>
      (rc.customerRefs || []).some((r: any) => String(r.id) === String(inv.id))
    );
    const receivedForInv = invReceipts.reduce((s, rc) => s + Number(rc.payment_in ?? rc.credit_amount ?? 0), 0);
    const invStatus = receivedForInv >= total && total > 0 ? "Paid" : "Pending";
    const payTerm = customer?.payment_term || "Cash";
    const dueDate = dueDateFromTerm(String(inv.invoice_date || ""), payTerm);
    const salesTerms = COMPANY.sales_terms ? COMPANY.sales_terms.split(/\n+/).map((t) => `<li>${esc(t.trim())}</li>`).join("") : "";
    const terms = COMPANY.sales_terms
      ? `<ol style="margin:4px 0 0 16px;padding:0">${salesTerms}</ol>`
      : `<ol style="margin:4px 0 0 16px;padding:0">
  <li>3-month standard module service warranty (labor only). Any replacement parts will incur material charges. Condition: Warranty applies only if a new upper cord is installed.</li>
  <li>Premium Service Includes 1 Year Warranty. All Upper Cords And Iron Hooks Are Replaced With New Parts During Service.</li>
  <li>Warranty Does Not Cover Physical Damage, Water Damage, Power Surges, Mishandling.</li>
  <li>${COMPANY.gstin ? "This is a GST invoice." : "This is a non-GST invoice."} Goods once sold will not take back. MSME/Udyam Registration No. ${esc(COMPANY.udyam_number)}</li>
</ol>`;
    return `
  <div class="doc-title">INVOICE</div>
  <div class="doc-band">${esc(String(inv.invoice_no || ""))} &nbsp;•&nbsp; ${esc(fmtDate(inv.invoice_date))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Billed To</div>
      <div class="name">${esc(customer?.business_name || customer?.customer_name || "Walk-in Customer")}</div>
      <div>${customer?.business_address || customer?.address ? esc(customer.business_address || customer.address) : ""}</div>
      <div>${customer?.mobile ? "Mobile: " + esc(customer.mobile) : ""}</div>
      <div>${esc(payTerm) !== "Cash" ? "Payment Terms: " + esc(payTerm) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Invoice No</span><b>${esc(inv.invoice_no || "-")}</b></div>
      <div class="info-row"><span>Invoice Date</span><b>${esc(fmtDate(inv.invoice_date))}</b></div>
      <div class="info-row"><span>Payment Status</span><b style="color:${invStatus === "Paid" ? "#15803d" : "#dc2626"}">${esc(invStatus)}</b></div>
      <div class="info-row"><span>Due Date</span><b>${/10\s*(th|st)?\s*(of)?\s*(every\s+)?next\s*month/i.test(payTerm) ? "Date 10th Of Next Month" : esc(fmtDate(dueDate))}</b></div>
      <div class="info-row"><span>Total Amount</span><b>${money(total)}</b></div>
      ${gstMode && customerGstin ? `<div class="info-row"><span>Customer GSTIN</span><b>${esc(customerGstin)}</b></div>` : ""}
      ${gstMode ? `<div class="info-row"><span>Place of Supply</span><b>${esc(placeOfSupply || "—")}</b></div>` : ""}
    </div>
  </div>
  <table class="inv-items">
    <thead><tr><th class="c" style="width:44px">#</th><th>Item Description</th>${gstMode ? `<th class="c" style="width:80px">HSN/SAC</th>` : ""}<th class="c" style="width:60px">Qty</th><th class="r" style="width:100px">Rate (₹)</th><th class="r" style="width:110px">Amount (₹)</th></tr></thead>
    <tbody>${itemRows}</tbody>
    ${gstMode ? "" : `<tr class="tot-row"><td colspan="4" style="text-align:right">Grand Total</td><td class="r">${money(total)}</td></tr>`}
  </table>
  ${gstTaxSummary}
  <div class="amount-words"><b>Amount In Words:</b> ${numToWords(Math.round(total))} Rupees Only</div>
  <table class="pay-table">
    <tr class="tot-row"><td class="r" style="text-align:left;background:#f8fafc" colspan="5"><b>Payment Details — For ${esc(COMPANY.bank_account_holder || COMPANY.name)}</b></td></tr>
    <tr><td>Account Name</td><td><b>${esc(COMPANY.bank_account_holder || COMPANY.name)}</b></td><td>Account No.</td><td><b>${esc(COMPANY.bank_account_number || "")}</b></td></tr>
    <tr><td>Bank Name</td><td><b>${esc(COMPANY.bank_name || "")}</b></td><td>IFSC No.</td><td><b>${esc(COMPANY.bank_ifsc || "")}</b></td></tr>
    <tr><td>G-Pay / UPI</td><td><b>${esc(COMPANY.upi_id || "")}</b></td><td></td><td></td></tr>
  </table>
  <div style="display:flex;gap:16px;align-items:stretch">
    <div style="flex:1;display:flex">
      <div class="terms-box" style="flex:1;display:flex;flex-direction:column;justify-content:center;margin:0"><b style="font-size:12px;margin-bottom:4px">Terms &amp; Conditions:</b>${terms}</div>
    </div>
    <div style="text-align:center;padding:12px 14px;border:1px solid #cbd5e1;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:140px">
      <img src="${qrDataUrl}" alt="Scan to Pay" style="width:110px;height:110px;border-radius:6px"/>
      <div style="font-size:10px;margin-top:6px;color:#475569;font-weight:700">Scan to Pay</div>
    </div>
  </div>
  <div class="signatures">
    <div class="signature"><div class="line">Receiver's Signature</div></div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div></div>
  </div>`;
  };

  const printBodyForReceipt = (rc: any) => {
    const amount = Number(rc.payment_in ?? rc.credit_amount ?? 0);
    const refs = (rc.customerRefs || []);
    const customerLabel = refs[0] ? customerName(refs[0].customer_id) : "Customer";
    const cust = refs[0] ? customerRecord(refs[0].customer_id) : null;
    const totalDisc = Number(String(rc.particulars || "").match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);

    // Bill-wise allocation: table-first — is receipt ki `payment_allocations`
    // rows seedha use karo. Rows nahi (purani entry) to wahi purana
    // text-distribution, exactly like the Payments & Ledger pending list.
    const dbAlloc = getDbAllocations(Number(rc.id));
    const billRows: Array<{ no: string; date: string; custName: string; total: number; received: number; deduction: number; pending: number; status: string }> = [];
    if (dbAlloc && dbAlloc.size > 0) {
      const invoiceById = new Map<number, any>(
        (invoices as any[]).map((iv: any) => [Number(iv.id), iv])
      );
      dbAlloc.forEach((alloc, invId) => {
        const iv = invoiceById.get(invId);
        if (!iv) return;
        const invTotal = Number(iv.total_amount || 0);
        const pending = Math.max(0, invTotal - alloc.paid - alloc.deduction);
        billRows.push({
          no: iv.invoice_no || "-",
          date: String(iv.invoice_date || "").slice(0, 10),
          custName: customerLabel,
          total: invTotal,
          received: alloc.paid,
          deduction: alloc.deduction,
          pending,
          status:
            pending <= 0 && invTotal > 0
              ? "Paid"
              : alloc.paid > 0 || alloc.deduction > 0
                ? "Partial"
                : "Pending",
        });
      });
    } else {
      let remainingReceived = amount;
      let remainingDisc = totalDisc;
      refs.forEach((iv: any) => {
        const invTotal = Number(iv.total_amount || 0);
        const outstandingBefore = Math.max(0, invTotal - 0);
        const receivedForInvoice = Math.min(remainingReceived, outstandingBefore);
        remainingReceived -= receivedForInvoice;
        const outstandingAfterReceipt = Math.max(0, outstandingBefore - receivedForInvoice);
        const deductionForInvoice = Math.min(remainingDisc, outstandingAfterReceipt);
        remainingDisc -= deductionForInvoice;
        const pending = Math.max(0, invTotal - receivedForInvoice - deductionForInvoice);
        const status = pending <= 0 && invTotal > 0 ? "Paid" : receivedForInvoice > 0 || deductionForInvoice > 0 ? "Partial" : "Pending";
        billRows.push({
          no: iv.invoice_no || "-",
          date: String(iv.invoice_date || "").slice(0, 10),
          custName: customerLabel,
          total: invTotal,
          received: receivedForInvoice,
          deduction: deductionForInvoice,
          pending,
          status,
        });
      });
    }

    const billTable = billRows.length
      ? `<div class="receipt-bills">
      <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#475569;margin:16px 0 4px">Against Bills (${billRows.length})</div>
      <table style="margin-top:4px">
        <thead>
          <tr>
            <th>Invoice No</th>
            <th>Date</th>
            <th>Customer Name</th>
            <th class="r">Invoice Total (₹)</th>
            <th class="r">Rec. Amount (₹)</th>
            <th class="r">Deduction (₹)</th>
            <th class="r">Pending (₹)</th>
            <th class="c">Status</th>
          </tr>
        </thead>
        <tbody>
          ${billRows
            .map(
              (b) => `<tr>
            <td style="font-weight:700;color:#2563eb">${esc(b.no)}</td>
            <td>${esc(fmtDate(b.date))}</td>
            <td>${esc(b.custName)}</td>
            <td class="r">${money(b.total)}</td>
            <td class="r" style="color:#15803d;font-weight:700">${money(b.received)}</td>
            <td class="r" style="color:#b45309">${money(b.deduction)}</td>
            <td class="r" style="color:#dc2626;font-weight:700">${money(b.pending)}</td>
            <td class="c"><span class="badge" style="color:${b.status === "Paid" ? "#166534" : "#92400e"}">${esc(b.status)}</span></td>
          </tr>`
            )
            .join("")}
        </tbody>
        <tr class="tot-row">
          <td colspan="3" style="text-align:right">Total</td>
          <td class="r">${money(billRows.reduce((s, b) => s + b.total, 0))}</td>
          <td class="r">${money(billRows.reduce((s, b) => s + b.received, 0))}</td>
          <td class="r">${money(billRows.reduce((s, b) => s + b.deduction, 0))}</td>
          <td class="r">${money(billRows.reduce((s, b) => s + b.pending, 0))}</td>
          <td class="c">—</td>
        </tr>
      </table>
    </div>`
      : "";

    return `
  <div class="doc-title">PAYMENT RECEIPT</div>
  <div class="doc-band">Receipt No: ${esc(rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || ""))} &nbsp;•&nbsp; Date: ${esc(fmtDate(rc.transaction_date || rc.created_at))}</div>
  <div style="text-align:center;margin-bottom:14px"><span class="badge">PAID</span></div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Received From</div>
      <div class="name">${esc(customerLabel)}</div>
      <div class="addr">${cust?.business_address || cust?.address ? esc(cust.business_address || cust.address) : ""}</div>
      <div>${cust?.mobile ? "Mobile: " + esc(cust.mobile) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Receipt No</span><b style="color:#2563eb">${esc(rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || ""))}</b></div>
      <div class="info-row"><span>Payment Mode</span><b>${esc(rc.payment_mode || rc.mode || "Cash")}</b></div>
      <div class="info-row"><span>Amount Received</span><b style="color:#15803d">${money(amount)}</b></div>
      <div class="info-row"><span>Bills Covered</span><b>${refs.length}</b></div>
      ${totalDisc > 0 ? `<div class="info-row"><span>Discount</span><b style="color:#b45309">${money(totalDisc)}</b></div>` : ""}
    </div>
  </div>
  ${billTable}
  <div style="display:flex;align-items:center;gap:16px;padding:22px;border:1px solid #16a34a;border-radius:10px;margin:10px 0">
    <div style="font-size:40px">✅</div>
    <div>
      <div style="font-size:20px;font-weight:900;color:#15803d">${money(amount)}</div>
      <div style="font-size:12px;color:#166534"><b>Rupees:</b> ${numToWords(Math.round(amount))} Only</div>
    </div>
  </div>
  <div class="notes"><b>Notes:</b> ${esc(rc.notes || rc.remarks || "Payment acknowledged. Thank you.")}</div>
  <div class="signatures">
    <div class="signature"><div class="line">Customer Signature</div>Received By</div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>Cashier / Manager</div>
  </div>`;
  };

  const printBodyForPayment = (pm: any) => {
    const amount = Number(pm.payment_out ?? pm.debit_amount ?? 0);
    const vendorPart = String(pm.particulars || "").replace(/^Vendor Payment:\s*/i, "").split(/[\(\[]/)[0].trim();
    const vendor = vendors.find((vv) => String(vv.business_name || vv.name || "").toLowerCase() === String(vendorPart || "").toLowerCase()) || vendors.find((vv) => String(vv.business_name || vv.name || "").toLowerCase().includes(String(vendorPart || "").toLowerCase().slice(0, 6)));

    const totalDiscPM = Number(String(pm.particulars || "").match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);
    let remainingPaid = amount;
    let remainingDiscPM = totalDiscPM;
    const pRefs = (pm.paymentRefs || []);
    const billGroups: Array<{ no: string; date: string; vendName: string; total: number; paid: number; deduction: number; pending: number; status: string }> = [];

    // Per-bill allocation table-first: is payment ki `payment_allocations` rows
    // seedha. Rows nahi to purana text-distribution (neeche wala branch).
    const dbPm = getDbAllocations(Number(pm.id));
    if (dbPm && dbPm.size > 0) {
      const purchaseById = new Map<number, any>(
        (purchases as any[]).map((pv: any) => [Number(pv.id), pv])
      );
      // Ek hi inward number ki multiple purchase rows ho sakti hain — pehle
      // inward ke naam se group karo (purana code bhi yahi karta tha).
      const grouped = new Map<string, { pv: any; paid: number; deduction: number; total: number }>();
      dbPm.forEach((alloc, billId) => {
        const pv = purchaseById.get(billId);
        if (!pv) return;
        const inw = String(pv.inward_no || pv.purchase_no || `INW-${pv.id}`).toUpperCase();
        const groupTotal = Number(pv.total_amount || 0);
        const prev = grouped.get(inw);
        if (prev) {
          prev.paid += alloc.paid;
          prev.deduction += alloc.deduction;
          prev.total += groupTotal;
        } else {
          grouped.set(inw, { pv, paid: alloc.paid, deduction: alloc.deduction, total: groupTotal });
        }
      });
      grouped.forEach(({ pv, paid, deduction, total }, inw) => {
        const pending = Math.max(0, total - paid - deduction);
        const status = pending <= 0 && total > 0 ? "Paid" : paid > 0 || deduction > 0 ? "Partial" : "Pending";
        billGroups.push({
          no: inw,
          date: String(pv.purchase_date || "").slice(0, 10),
          vendName: pv.vendor_name || vendorPart || (vendor?.business_name || vendor?.name || "-"),
          total,
          paid,
          deduction,
          pending,
          status,
        });
      });
    }

    // Per-bill amounts saved in the voucher as "INW-1: 500.00". When present they win,
    // otherwise the voucher amount is spread over the bills in list order.
    const explicitPaidByRef = new Map<string, number>();
    const explicitRe = /([A-Za-z0-9_\-\/]+)\s*:\s*([\d.]+)/g;
    let explicitMatch: RegExpExecArray | null;
    while ((explicitMatch = explicitRe.exec(String(pm.particulars || ""))) !== null) {
      explicitPaidByRef.set(explicitMatch[1].trim().toUpperCase(), Number(explicitMatch[2]) || 0);
    }
    const hasExplicitBills = explicitPaidByRef.size > 0;

    const seenRows = new Set<string>();
    if (!dbPm || dbPm.size === 0) pRefs.forEach((pv: any) => {
      const inw = String(pv.inward_no || pv.purchase_no || `INW-${pv.id}`).toUpperCase();
      if (seenRows.has(inw)) return;
      seenRows.add(inw);
      const groupTotal = pRefs.filter((q: any) => String(q.inward_no || q.purchase_no || `INW-${q.id}`).toUpperCase() === inw).reduce((s: number, q: any) => s + Number(q.total_amount || 0), 0);
      const paidForBill = hasExplicitBills
        ? Math.min(explicitPaidByRef.get(inw) || 0, groupTotal)
        : Math.min(remainingPaid, groupTotal);
      if (!hasExplicitBills) remainingPaid -= paidForBill;
      const outstandingAfterPay = Math.max(0, groupTotal - paidForBill);
      const dedForBill = Math.min(remainingDiscPM, outstandingAfterPay);
      remainingDiscPM -= dedForBill;
      const pending = Math.max(0, groupTotal - paidForBill - dedForBill);
      const status = pending <= 0 && groupTotal > 0 ? "Paid" : paidForBill > 0 || dedForBill > 0 ? "Partial" : "Pending";
      billGroups.push({
        no: inw,
        date: String(pv.purchase_date || "").slice(0, 10),
        vendName: pv.vendor_name || vendorPart || (vendor?.business_name || vendor?.name || "-"),
        total: groupTotal,
        paid: paidForBill,
        deduction: dedForBill,
        pending,
        status,
      });
    });
    const pmBillTable = billGroups.length
      ? `<div class="receipt-bills">
      <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#475569;margin:16px 0 4px">Against Inward Bills (${billGroups.length})</div>
      <table style="margin-top:4px">
        <thead>
          <tr>
            <th>Inward No</th>
            <th>Date</th>
            <th>Vendor Name</th>
            <th class="r">Bill Total (₹)</th>
            <th class="r">Paid Amount (₹)</th>
            <th class="r">Deduction (₹)</th>
            <th class="r">Pending (₹)</th>
            <th class="c">Status</th>
          </tr>
        </thead>
        <tbody>
          ${billGroups
            .map(
              (b) => `<tr>
            <td style="font-weight:700;color:#2563eb">${esc(b.no)}</td>
            <td>${esc(fmtDate(b.date))}</td>
            <td>${esc(b.vendName)}</td>
            <td class="r">${money(b.total)}</td>
            <td class="r" style="color:#15803d;font-weight:700">${money(b.paid)}</td>
            <td class="r" style="color:#b45309">${money(b.deduction)}</td>
            <td class="r" style="color:#dc2626;font-weight:700">${money(b.pending)}</td>
            <td class="c"><span class="badge" style="color:${b.status === "Paid" ? "#166534" : "#92400e"}">${esc(b.status)}</span></td>
          </tr>`
            )
            .join("")}
        </tbody>
        <tr class="tot-row">
          <td colspan="3" style="text-align:right">Total</td>
          <td class="r">${money(billGroups.reduce((s, b) => s + b.total, 0))}</td>
          <td class="r">${money(billGroups.reduce((s, b) => s + b.paid, 0))}</td>
          <td class="r">${money(billGroups.reduce((s, b) => s + b.deduction, 0))}</td>
          <td class="r">${money(billGroups.reduce((s, b) => s + b.pending, 0))}</td>
          <td class="c">—</td>
        </tr>
      </table>
    </div>`
      : "";
    return `
  <div class="doc-title">PAYMENT VOUCHER</div>
  <div class="doc-band">Voucher No: ${esc(pm.transaction_no || "PM-" + String(pm.id || ""))} &nbsp;•&nbsp; Date: ${esc(fmtDate(pm.transaction_date || pm.created_at || ""))}</div>
  <div style="text-align:center;margin-bottom:14px"><span class="badge">PAID</span></div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Paid To</div>
      <div class="name">${esc(vendorPart || "Supplier")}</div>
      <div>${vendor?.address ? esc(vendor.address) : ""}</div>
      <div>${vendor?.mobile ? "Mobile: " + esc(vendor.mobile) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Payment Mode</span><b>${esc(pm.payment_mode || pm.mode || "Cash")}</b></div>
      <div class="info-row"><span>Amount Paid</span><b style="color:#dc2626">${money(amount)}</b></div>
      <div class="info-row"><span>Bills Covered</span><b>${billGroups.length}</b></div>
      ${totalDiscPM > 0 ? `<div class="info-row"><span>Deduction</span><b style="color:#b45309">${money(totalDiscPM)}</b></div>` : ""}
    </div>
  </div>
  ${pmBillTable}
  <div style="display:flex;align-items:center;gap:16px;padding:22px;border:1px solid #dc2626;border-radius:10px;margin:10px 0">
    <div style="font-size:40px">💸</div>
    <div>
      <div style="font-size:20px;font-weight:900;color:#b91c1c">${money(amount)}</div>
      <div style="font-size:12px;color:#991b1b"><b>Rupees:</b> ${numToWords(Math.round(amount))} Only</div>
    </div>
  </div>
  <div class="notes"><b>Notes:</b> ${esc(pm.notes || pm.remarks || "Vendor payable settlement.")}</div>
  <div class="signatures">
    <div class="signature"><div class="line">Received By</div>Supplier / Vendor</div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>For ${esc(COMPANY.name)}</div>
  </div>`;
  };

  const printBodyForLedger = (customer: any) => {
    const custInvoices = invoices.filter((iv) => String(iv.customer_id) === String(customer.id));
    const receiptRows = receipts.filter((rc) =>
      (rc.customerRefs || []).some((iv: any) => String(iv.customer_id) === String(customer.id))
    );
    const totalBilled = custInvoices.reduce((s, iv) => s + Number(iv.total_amount || 0), 0);
    const totalReceived = receiptRows.reduce((s, rc) => s + Number(rc.payment_in ?? rc.credit_amount ?? 0), 0);
    const balance = totalBilled - totalReceived;
    let runningBalance = 0;
    const rows: string[] = [];
    custInvoices.forEach((iv: any) => {
      runningBalance += Number(iv.total_amount || 0);
      rows.push(`<tr><td>${esc(fmtDate(iv.invoice_date || ""))}</td><td>${esc(iv.invoice_no || "-")}</td><td>Invoice</td><td class="r">${money(Number(iv.total_amount) || 0)}</td><td class="r">—</td><td class="r">${money(runningBalance)}</td></tr>`);
    });
    receiptRows.forEach((rc: any) => {
      const amt = Number(rc.payment_in ?? rc.credit_amount ?? 0);
      runningBalance -= amt;
      rows.push(`<tr><td>${esc(fmtDate(rc.transaction_date || rc.created_at || ""))}</td><td>${esc(rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || ""))}</td><td>Receipt</td><td class="r">—</td><td class="r">${money(amt)}</td><td class="r">${money(runningBalance)}</td></tr>`);
    });
    rows.sort((a, b) => a.localeCompare(b));
    const cust = customer || customerRecord((customer?.id ?? ""));
    return `
  <div class="doc-title">CUSTOMER LEDGER</div>
  <div class="doc-band">Account Statement &nbsp;•&nbsp; Generated on ${esc(new Date().toLocaleString("en-IN"))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Customer</div>
      <div class="name">${esc(cust.business_name || cust.customer_name || "Customer")}</div>
      <div>${cust.business_address || cust.address ? esc(cust.business_address || cust.address) : ""}</div>
      <div>${cust.mobile ? "Mobile: " + esc(cust.mobile) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Total Invoices</span><b>${custInvoices.length}</b></div>
      <div class="info-row"><span>Total Billed</span><b>${money(totalBilled)}</b></div>
      <div class="info-row"><span>Total Received</span><b style="color:#15803d">${money(totalReceived)}</b></div>
      <div class="info-row"><span>Outstanding</span><b style="color:${balance > 0 ? "#dc2626" : "#15803d"}">${money(balance)}</b></div>
    </div>
  </div>
  ${custInvoices.length === 0 && receiptRows.length === 0 ? '<div class="notes">No transactions found for this customer.</div>' : `
  <table>
    <thead><tr><th>Date</th><th>Reference No.</th><th>Particulars</th><th class="r">Debit (₹)</th><th class="r">Credit (₹)</th><th class="r">Balance (₹)</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
    <tr class="tot-row"><td colspan="3" style="text-align:right">Closing Balance</td><td class="r">${money(totalBilled)}</td><td class="r">${money(totalReceived)}</td><td class="r">${money(balance)}</td></tr>
  </table>
  <div class="amount-words"><b>Outstanding amount in words:</b> ${numToWords(Math.round(balance))} Rupees Only</div>`}
  <div class="signatures">
    <div class="signature"><div class="line">Customer Signature</div>Acknowledged</div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>Accounts Department</div>
  </div>`;
  };

  const printBodyForLedgerYear = (customer: any, mode: "complete" | "pending") => {
    const startYear = fyStartYear(ledgerFY);
    const { from, to } = fyFromStartYear(startYear);
    const cust = customer || {};
    const custInvoices = invoices.filter((iv) => String(iv.customer_id) === String(cust.id) && String(iv.invoice_date || "") >= from && String(iv.invoice_date || "") <= to);
    const invoiceNumbers = new Set(custInvoices.map((iv) => iv.invoice_no));
    const receiptRows = receipts.filter((rc) =>
      String(rc.transaction_date || "") >= from && String(rc.transaction_date || "") <= to &&
      (rc.customerRefs || []).some((iv: any) => String(iv.customer_id) === String(cust.id))
    );
    const totalBilled = custInvoices.reduce((s, iv) => s + Number(iv.total_amount || 0), 0);
    const totalReceived = receiptRows.reduce((s, rc) => s + Number(rc.payment_in ?? rc.credit_amount ?? 0), 0);
    const totalDeduction = custInvoices.reduce((s, iv) => s + Number(iv.deduction_amount || 0), 0);
    const totalPending = custInvoices.reduce((s, iv) => s + Number(iv.pending_amount ?? iv.total_amount ?? 0), 0);
    if (custInvoices.length === 0) {
      alert(`इस Financial Year (${ledgerFY}) में इस customer का कोई invoice नहीं मिला!`);
      return null;
    }
    const rows: string[] = [];
    if (mode === "complete") {
      custInvoices.forEach((iv: any) => rows.push(`<tr><td>${esc(fmtDate(iv.invoice_date))}</td><td>${esc(iv.invoice_no)}</td><td>Invoice Bill</td><td class="r">${money(Number(iv.total_amount || 0))}</td><td class="r">—</td></tr>`));
      receiptRows.forEach((rc: any) => {
        const disc = Number(String(rc.particulars || "").match(/\[Disc:\s*₹([\d.]+)\]/i)?.[1] || 0);
        rows.push(`<tr><td>${esc(fmtDate(rc.transaction_date))}</td><td>${esc(rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || ""))}</td><td>Customer Receipt ${disc ? "/ Discount " + money(disc) : ""}</td><td class="r">—</td><td class="r">${money(Number(rc.payment_in ?? rc.credit_amount ?? 0))}</td></tr>`);
      });
      rows.sort((a, b) => a.localeCompare(b));
    } else {
      const pendingInvoices = custInvoices.filter((iv: any) => Number(iv.pending_amount ?? iv.total_amount ?? 0) > 0);
      pendingInvoices.forEach((iv: any) => {
        const cRecv = Number(iv.received_amount || 0);
        const cDisc = Number(iv.deduction_amount || 0);
        const cPend = Number(iv.pending_amount ?? Math.max(0, Number(iv.total_amount || 0) - cRecv - cDisc));
        const cStatus = cPend <= 0 && Number(iv.total_amount || 0) > 0 ? "Paid" : cRecv > 0 || cDisc > 0 ? "Partial" : "Pending";
        rows.push(`<tr>
        <td style="font-weight:700;color:#2563eb">${esc(iv.invoice_no || "-")}</td>
        <td>${esc(fmtDate(iv.invoice_date))}</td>
        <td>${esc(cust.business_name || cust.customer_name || customerName(iv.customer_id) || "-")}</td>
        <td class="r">${money(Number(iv.total_amount || 0))}</td>
        <td class="r" style="color:#15803d;font-weight:700">${money(cRecv)}</td>
        <td class="r" style="color:#b45309">${money(cDisc)}</td>
        <td class="r" style="color:#dc2626;font-weight:700">${money(cPend)}</td>
        <td class="c"><span class="badge" style="color:${cStatus === "Paid" ? "#166534" : "#92400e"}">${esc(cStatus)}</span></td>
      </tr>`);
      });
      void pendingInvoices;
    }
    void invoiceNumbers;
    return `
  <div class="doc-title">CUSTOMER ${mode === "complete" ? "COMPLETE" : "PENDING"} LEDGER</div>
  <div class="doc-band">Financial Year: ${esc(ledgerFY)} (01/04/${startYear} - 31/03/${startYear + 1}) &nbsp;•&nbsp; Generated on ${esc(new Date().toLocaleString("en-IN"))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Customer</div>
      <div class="name">${esc(cust.business_name || cust.customer_name || "Customer")}</div>
      <div>${cust.business_address || cust.address ? esc(cust.business_address || cust.address) : ""}</div>
      <div>${cust.mobile ? "Mobile: " + esc(cust.mobile) : ""}</div>
    </div>
    <div class="info-box">
      ${mode === "complete" ? `
      <div class="info-row"><span>Total Bills</span><b>${money(totalBilled)}</b></div>
      <div class="info-row"><span>Received</span><b style="color:#15803d">${money(totalReceived)}</b></div>
      <div class="info-row"><span>Deduction</span><b>${money(totalDeduction)}</b></div>
      <div class="info-row"><span>Pending</span><b style="color:#dc2626">${money(totalPending)}</b></div>` : `
      <div class="info-row"><span>Total Outstanding</span><b style="color:#dc2626">${money(totalPending)}</b></div>
      <div class="info-row"><span>Total Bills</span><b>${money(totalBilled)}</b></div>`}
    </div>
  </div>
  ${rows.length === 0 ? '<div class="notes">इस Financial Year में कोई pending bill नहीं है।</div>' : `${
      mode === "pending"
        ? `<table style="margin-top:16px">
    <thead>
      <tr>
        <th>Invoice No</th>
        <th>Date</th>
        <th>Customer Name</th>
        <th class="r">Invoice Total (₹)</th>
        <th class="r">Rec. (₹)</th>
        <th class="r">Disc. (₹)</th>
        <th class="r">Pending (₹)</th>
        <th class="c">Status</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
    <tr class="tot-row">
      <td colspan="3" style="text-align:right">Total</td>
      <td class="r">${money(custInvoices.filter((iv: any) => Number(iv.pending_amount ?? iv.total_amount ?? 0) > 0).reduce((s, iv) => s + Number(iv.total_amount || 0), 0))}</td>
      <td class="r">${money(custInvoices.filter((iv: any) => Number(iv.pending_amount ?? iv.total_amount ?? 0) > 0).reduce((s, iv) => s + Number(iv.received_amount || 0), 0))}</td>
      <td class="r">${money(custInvoices.filter((iv: any) => Number(iv.pending_amount ?? iv.total_amount ?? 0) > 0).reduce((s, iv) => s + Number(iv.deduction_amount || 0), 0))}</td>
      <td class="r">${money(custInvoices.filter((iv: any) => Number(iv.pending_amount ?? iv.total_amount ?? 0) > 0).reduce((s, iv) => s + Number(iv.pending_amount ?? 0), 0))}</td>
      <td class="c">—</td>
    </tr>
  </table>`
        : `<table>
    <thead><tr><th>Date</th><th>Invoice / Receipt Ref.</th><th>Particulars</th><th class="r">Debit / Bill (₹)</th><th class="r">Credit / Receipt (₹)</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`
    }`}
  <div class="amount-words"><b>${mode === "complete" ? "Pending" : "Outstanding"} amount in words:</b> ${numToWords(Math.round(totalPending))} Rupees Only</div>
  <div class="signatures">
    <div class="signature"><div class="line">Customer Signature</div>Acknowledged</div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>Accounts Department</div>
  </div>`;
  };

  const printBodyForAllPartyPending = () => {
    const startYear = fyStartYear(ledgerFY);
    const { from, to } = fyFromStartYear(startYear);
    const fyInvoices = invoices.filter(
      (iv: any) => String(iv.invoice_date || "") >= from && String(iv.invoice_date || "") <= to
    );
    if (fyInvoices.length === 0) {
      alert(`इस Financial Year (${ledgerFY}) में कोई invoice नहीं मिला!`);
      return null;
    }

    const map = new Map<string, any>();
    fyInvoices.forEach((iv: any) => {
      const key = String(iv.customer_id || 0);
      if (!map.has(key)) {
        const c = customers.find((x: any) => String(x.id) === key);
        map.set(key, {
          key,
          name: c?.business_name || c?.customer_name || "Walk-in Customer",
          bills: 0,
          billed: 0,
          received: 0,
          deduction: 0,
          pending: 0,
        });
      }
      const r = map.get(key);
      r.bills += 1;
      r.billed += Number(iv.total_amount || 0);
      r.received += Number(iv.received_amount || 0);
      r.deduction += Number(iv.deduction_amount || 0);
      r.pending += Number(iv.pending_amount ?? iv.total_amount ?? 0);
    });

    // Sirf un parties ko rakho jinka kuch pending hai — fully paid (Pending ₹0)
    // wale is "Total Pending Report" me nahi chahiye.
    const partyRows = Array.from(map.values())
      .filter((r: any) => r.pending > 0.00001)
      .sort((a: any, b: any) => b.pending - a.pending);

    if (partyRows.length === 0) {
      alert(`इस Financial Year (${ledgerFY}) में कोई pending amount नहीं है — सभी bills paid हैं।`);
      return null;
    }

    const tBills = partyRows.reduce((s: number, r: any) => s + r.bills, 0);
    const tBilled = partyRows.reduce((s: number, r: any) => s + r.billed, 0);
    const tReceived = partyRows.reduce((s: number, r: any) => s + r.received, 0);
    const tDeduction = partyRows.reduce((s: number, r: any) => s + r.deduction, 0);
    const tPending = partyRows.reduce((s: number, r: any) => s + r.pending, 0);

    const rows = partyRows.map((r: any, i: number) => {
      const status = r.pending <= 0.00001 ? "Paid" : r.received > 0 || r.deduction > 0 ? "Partial" : "Pending";
      return `<tr>
        <td style="text-align:center;color:#64748b">${i + 1}</td>
        <td style="font-weight:700;color:#0f172a">${esc(r.name)}</td>
        <td class="c">${r.bills}</td>
        <td class="r">${money(r.billed)}</td>
        <td class="r" style="color:#15803d">${money(r.received)}</td>
        <td class="r" style="color:#b45309">${money(r.deduction)}</td>
        <td class="r" style="color:#dc2626;font-weight:700">${money(r.pending)}</td>
        <td class="c"><span class="badge" style="color:${status === "Paid" ? "#166534" : "#92400e"}">${esc(status)}</span></td>
      </tr>`;
    });

    return `
  <div class="doc-title">ALL PARTY TOTAL PENDING REPORT</div>
  <div class="doc-band">Financial Year: ${esc(ledgerFY)} (01/04/${startYear} - 31/03/${startYear + 1}) &nbsp;•&nbsp; Generated on ${esc(new Date().toLocaleString("en-IN"))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Report For</div>
      <div class="name">All Parties</div>
      <div>${esc(COMPANY.name)}</div>
      <div>${COMPANY.address ? esc(COMPANY.address) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Total Parties</span><b>${partyRows.length}</b></div>
      <div class="info-row"><span>Total Bills</span><b>${money(tBilled)}</b></div>
      <div class="info-row"><span>Received</span><b style="color:#15803d">${money(tReceived)}</b></div>
      <div class="info-row"><span>Deduction</span><b style="color:#b45309">${money(tDeduction)}</b></div>
      <div class="info-row"><span>Total Pending</span><b style="color:#dc2626">${money(tPending)}</b></div>
    </div>
  </div>
  <table style="margin-top:16px">
    <thead>
      <tr>
        <th class="c">#</th>
        <th>Party Name</th>
        <th class="c">Bills</th>
        <th class="r">Total Bills (₹)</th>
        <th class="r">Received (₹)</th>
        <th class="r">Disc. (₹)</th>
        <th class="r">Pending (₹)</th>
        <th class="c">Status</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
    <tr class="tot-row">
      <td class="c">—</td>
      <td style="text-align:right">Total (${tBills} bills)</td>
      <td class="c">${tBills}</td>
      <td class="r">${money(tBilled)}</td>
      <td class="r">${money(tReceived)}</td>
      <td class="r">${money(tDeduction)}</td>
      <td class="r">${money(tPending)}</td>
      <td class="c">—</td>
    </tr>
  </table>
  <div class="amount-words"><b>Total Pending amount in words:</b> ${numToWords(Math.round(tPending))} Rupees Only</div>
  <div class="signatures">
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div>Accounts Department</div>
  </div>`;
  };

  useEffect(() => {
    setPartyFilter("");
    setRecordFilter("");
    setActivePartyKey("");
  }, [activeTab]);

  const handlePrint = async () => {
    if (activeTab === "po" && selectedPO) openPrintWindow("Purchase PO - " + (selectedPO.purchase_no || ""), printBodyForPO(selectedPO));
    if (activeTab === "invoice" && selectedInvoice) openPrintWindow("Sales Invoice - " + (selectedInvoice.invoice_no || ""), await printBodyForInvoice(selectedInvoice));
    if (activeTab === "receipt" && selectedReceipt) openPrintWindow("Payment Receipt", printBodyForReceipt(selectedReceipt));
    if (activeTab === "payment" && selectedPayment) openPrintWindow("Payment Voucher", printBodyForPayment(selectedPayment));
    if (activeTab === "ledger" && selectedCustomer) openPrintWindow("Customer Ledger - " + (selectedCustomer.business_name || selectedCustomer.customer_name || ""), printBodyForLedger(selectedCustomer));
  };

  // Build lists for the current tab: parties (left) + their records (right)
  const buildLists = (): { parties: any[]; recordsFor: (pk: string) => any[] } => {
    if (activeTab === "po") {
      const partyMap = new Map<string, any>();
      poGroups.forEach((g: any) => {
        const key = String(g.vendor_id ?? "") + "|" + String(vendorName(g.vendor_id, g.vendor_name));
        if (!partyMap.has(key)) partyMap.set(key, { key, name: vendorName(g.vendor_id, g.vendor_name) });
      });
      const parties = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const recordsFor = (pk: string) =>
        poGroups
          .filter((g) => pk === String(g.vendor_id ?? "") + "|" + String(vendorName(g.vendor_id, g.vendor_name)))
          .map((g: any) => {
            const rows = purchases.filter((p) => String(p.purchase_no || "") === String(g.purchase_no || ""));
            const total = rows.reduce((s, p) => s + (Number(p.total_amount) || Number(p.quantity || 0) * Number(p.rate || 0)), 0);
            return { key: g.purchase_no, no: g.purchase_no, date: String(g.purchase_date || "").slice(0, 10), amount: total, badge: "PO", payload: rows[0] || g };
          });
      return { parties, recordsFor };
    }
    if (activeTab === "invoice") {
      const partyMap = new Map<string, any>();
      invoices.forEach((iv: any) => {
        const pid = String(iv.customer_id ?? "");
        const nm = pid ? customerName(iv.customer_id) : "Walk-in Customer";
        if (!partyMap.has(pid)) partyMap.set(pid, { key: pid, name: nm });
      });
      const parties = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const recordsFor = (pk: string) =>
        invoices
          .filter((iv: any) => String(iv.customer_id ?? "") === pk)
          .sort((a: any, b: any) => String(a.invoice_no).localeCompare(String(b.invoice_no)))
          .map((iv: any) => ({
            key: iv.id,
            no: iv.invoice_no,
            date: String(iv.invoice_date || "").slice(0, 10),
            amount: Number(iv.total_amount) || 0,
            badge: "INV",
            payload: iv,
          }));
      return { parties, recordsFor };
    }
    if (activeTab === "receipt") {
      const partyMap = new Map<string, any>();
      receipts.forEach((rc: any) => {
        const ref = (rc.customerRefs || [])[0];
        const pid = ref ? String(ref.customer_id ?? "") : "walkin";
        const nm = ref ? customerName(ref.customer_id) : "Walk-in Customer";
        if (!partyMap.has(pid)) partyMap.set(pid, { key: pid, name: nm });
      });
      const parties = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const recordsFor = (pk: string) =>
        receipts
          .filter((rc: any) => {
            const ref = (rc.customerRefs || [])[0];
            const pid = ref ? String(ref.customer_id ?? "") : "walkin";
            return pid === pk;
          })
          .map((rc: any) => ({
            key: rc.id,
            no: rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || ""),
            date: String(rc.transaction_date || rc.created_at || "").slice(0, 10),
            amount: Number(rc.payment_in ?? rc.credit_amount ?? 0),
            badge: "RC",
            payload: rc,
          }));
      return { parties, recordsFor };
    }
    if (activeTab === "payment") {
      const partyMap = new Map<string, any>();
      payments.forEach((pm: any) => {
        const vendorPart = String(pm.particulars || "").replace(/^Vendor Payment:\s*/i, "").split(/[\(\[]/)[0].trim() || "Supplier";
        if (!partyMap.has(vendorPart)) partyMap.set(vendorPart, { key: vendorPart, name: vendorPart });
      });
      const parties = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      const recordsFor = (pk: string) =>
        payments
          .filter((pm: any) => {
            const vendorPart = String(pm.particulars || "").replace(/^Vendor Payment:\s*/i, "").split(/[\(\[]/)[0].trim() || "Supplier";
            return vendorPart === pk;
          })
          .map((pm: any) => ({
            key: pm.id,
            no: pm.transaction_no || "PM-" + String(pm.id || ""),
            date: String(pm.transaction_date || pm.created_at || "").slice(0, 10),
            amount: Number(pm.payment_out ?? pm.debit_amount ?? 0),
            badge: "PM",
            payload: pm,
          }));
      return { parties, recordsFor };
    }
    // ledger tab
    const partyMap = new Map<string, any>();
    invoices.forEach((iv: any) => {
      const pid = String(iv.customer_id ?? "");
      const nm = pid ? customerName(iv.customer_id) : "Walk-in Customer";
      if (!partyMap.has(pid)) partyMap.set(pid, { key: pid, name: nm });
    });
    customers.forEach((c: any) => {
      const pid = String(c.id ?? "");
      if (!partyMap.has(pid)) partyMap.set(pid, { key: pid, name: c.business_name || c.customer_name || "Customer" });
    });
    const parties = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    const recordsFor = (pk: string) => {
      const cust = customers.find((c) => String(c.id) === pk);
      return pk === "walkin"
        ? invoices.filter((iv) => !iv.customer_id).map((iv: any) => ({ key: iv.id, no: iv.invoice_no, date: String(iv.invoice_date || "").slice(0, 10), amount: Number(iv.total_amount) || 0, badge: "LEDGER", payload: { ...iv, _ledgerName: "Walk-in Customer" } }))
        : cust
          ? [{ key: cust.id, no: cust.business_name || cust.customer_name || "Customer", date: "Account Statement", amount: invoices.filter((iv) => String(iv.customer_id) === pk).reduce((s, iv) => s + Number(iv.total_amount || 0), 0) - receipts.filter((rc) => (rc.customerRefs || []).some((r: any) => String(r.customer_id) === pk)).reduce((s, rc) => s + Number(rc.payment_in ?? rc.credit_amount ?? 0), 0), badge: "LEDGER", payload: cust }]
          : [];
    };
    return { parties, recordsFor };
  };

  // Quick search across all document types
  const quickResults = (() => {
    const q = quickQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: any[] = [];
    invoices.forEach((iv: any) => {
      const nm = String(iv.customer_id ?? "") ? customerName(iv.customer_id) : "Walk-in Customer";
      if ((String(iv.invoice_no || "") + " " + nm).toLowerCase().includes(q)) out.push({ type: "invoice", badge: "INV", label: `${iv.invoice_no} — ${nm}`, payload: iv });
    });
    poGroups.forEach((g: any) => {
      const nm = vendorName(g.vendor_id, g.vendor_name);
      if ((String(g.purchase_no || "") + " " + nm).toLowerCase().includes(q)) out.push({ type: "po", badge: "PO", label: `${g.purchase_no} — ${nm}`, payload: g });
    });
    receipts.forEach((rc: any) => {
      const ref = (rc.customerRefs || [])[0];
      const nm = ref ? customerName(ref.customer_id) : "Walk-in Customer";
      const rNo = rc.transaction_no || rc.reference_no || "RC-" + String(rc.id || "");
      if ((rNo + " " + nm).toLowerCase().includes(q)) out.push({ type: "receipt", badge: "RC", label: `${rNo} — ${nm}`, payload: rc });
    });
    payments.forEach((pm: any) => {
      const nm = String(pm.particulars || "").replace(/^Vendor Payment:\s*/i, "").split(/[\(\[]/)[0].trim() || "Supplier";
      const pNo = pm.transaction_no || "PM-" + String(pm.id || "");
      if ((pNo + " " + nm).toLowerCase().includes(q)) out.push({ type: "payment", badge: "PM", label: `${pNo} — ${nm}`, payload: pm });
    });
    customers.forEach((c: any) => {
      const nm = c.business_name || c.customer_name || "Customer";
      if (nm.toLowerCase().includes(q)) out.push({ type: "customer", badge: "CUST", label: nm, payload: c });
    });
    return out.slice(0, 40);
  })();

  const runQuickResult = async (r: any) => {
    setQuickQuery("");
    if (r.type === "invoice") { setActiveTab("invoice"); setSelectedInvoice(r.payload); openPrintWindow("Sales Invoice - " + (r.payload.invoice_no || ""), await printBodyForInvoice(r.payload)); }
    else if (r.type === "po") { setActiveTab("po"); setSelectedPO(purchases.find((p) => String(p.purchase_no || "") === String(r.payload.purchase_no || "")) || r.payload); openPrintWindow("Purchase PO - " + (r.payload.purchase_no || ""), printBodyForPO(r.payload)); }
    else if (r.type === "receipt") { setActiveTab("receipt"); setSelectedReceipt(r.payload); openPrintWindow("Payment Receipt", printBodyForReceipt(r.payload)); }
    else if (r.type === "payment") { setActiveTab("payment"); setSelectedPayment(r.payload); openPrintWindow("Payment Voucher", printBodyForPayment(r.payload)); }
    else { setActiveTab("ledger"); setSelectedCustomer(r.payload); openPrintWindow("Customer Ledger - " + (r.payload.business_name || r.payload.customer_name || ""), printBodyForLedger(r.payload)); }
  };

  const openRecord = async (r: any) => {
    if (activeTab === "po") { setSelectedPO(r.payload); openPrintWindow("Purchase PO - " + (r.payload.purchase_no || ""), printBodyForPO(r.payload)); }
    else if (activeTab === "invoice") { setSelectedInvoice(r.payload); openPrintWindow("Sales Invoice - " + (r.payload.invoice_no || ""), await printBodyForInvoice(r.payload)); }
    else if (activeTab === "receipt") { setSelectedReceipt(r.payload); openPrintWindow("Payment Receipt", printBodyForReceipt(r.payload)); }
    else if (activeTab === "payment") { setSelectedPayment(r.payload); openPrintWindow("Payment Voucher", printBodyForPayment(r.payload)); }
    else if (activeTab === "ledger") { setSelectedCustomer(r.payload._ledgerName ? null : r.payload); const cust = r.payload._ledgerName ? invoices.find((iv) => String(iv.id) === String(r.key)) : r.payload; openPrintWindow("Customer Ledger" + (cust ? " - " + (r.payload._ledgerName || cust.business_name || cust.customer_name || "") : ""), printBodyForLedger(r.payload._ledgerName ? (customers.find((c) => String(c.id) === String(cust?.customer_id)) || cust) : r.payload)); }
  };

  const renderBrowser = () => {
    const { parties, recordsFor } = buildLists();
    const activeKey = activePartyKey || (parties.length ? parties[0].key : "");
    const allPartyActive = activeTab === "ledger" && activeKey === ALL_PARTY_KEY;
    const activeParty = allPartyActive
      ? { key: ALL_PARTY_KEY, name: "All Party" }
      : parties.find((p) => p.key === activeKey) || parties[0] || null;
    const pFilter = partyFilter.trim().toLowerCase();
    const rFilter = recordFilter.trim().toLowerCase();
    const partyList = activeTab === "ledger" ? [{ key: ALL_PARTY_KEY, name: "All Party" }, ...parties] : parties;
    const filteredParties = partyList.filter((p) => !pFilter || p.name.toLowerCase().includes(pFilter));
    const records = allPartyActive ? [] : activeParty ? recordsFor(activeParty.key) : [];
    const filteredRecords = records.filter((r) => !rFilter || String(r.no + r.badge || "").toLowerCase().includes(rFilter));

    const boxStyle: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", overflow: "hidden" };
    const panelHead = (txt: string, count: number) => (
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9", fontWeight: 800, fontSize: 13, color: "#0f172a", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{txt}</span>
        <span style={{ background: "#e0f2fe", color: "#0369a1", borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{count}</span>
      </div>
    );

    return (
      <div>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px" }}>
            <span style={{ fontSize: 17 }}>🔍</span>
            <input
              type="text"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Quick search — Invoice No / PO No / Receipt / Payment / Customer / Vendor name type karo..."
              style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14, color: "#0f172a" }}
            />
            {quickQuery && (
              <button onClick={() => setQuickQuery("")} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, color: "#64748b" }}>✕</button>
            )}
          </div>
          {quickResults.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 32px rgba(15,23,42,0.18)", zIndex: 50, maxHeight: 320, overflowY: "auto" }}>
              {quickResults.map((r: any, i: number) => (
                <button key={i} onClick={() => runQuickResult(r)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: "11px 14px", border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", cursor: "pointer", fontSize: 13 }}>
                  <span style={{ background: "#0f172a", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, minWidth: 42, textAlign: "center" }}>{r.badge}</span>
                  <span style={{ color: "#0f172a", fontWeight: 600, flex: 1 }}>{r.label}</span>
                  <span style={{ color: "#0284c7", fontSize: 12 }}>Preview →</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 14 }}>
          <div style={boxStyle}>
            {panelHead(`👥 ${activeTab === "invoice" || activeTab === "receipt" || activeTab === "ledger" ? "Customers" : "Vendors"}`, filteredParties.length)}
            <div style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
              <input type="text" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} placeholder="Search party..." style={{ width: "100%", padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 9, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {filteredParties.length === 0 && <p style={{ padding: "18px 14px", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>No parties found</p>}
              {filteredParties.map((p: any) => (
                <button key={p.key} onClick={() => setActivePartyKey(p.key)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "12px 14px", border: "none", borderBottom: "1px solid #f8fafc", cursor: "pointer", background: activeKey === p.key ? "#eff6ff" : "#fff", fontWeight: activeKey === p.key ? 700 : 500, color: activeKey === p.key ? "#1d4ed8" : "#334155", fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: activeKey === p.key ? "#1d4ed8" : "#cbd5e1", flexShrink: 0 }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div style={boxStyle}>
            {panelHead(`🧾 ${activeTab === "po" ? "Purchase Orders" : activeTab === "invoice" ? "Invoices" : activeTab === "receipt" ? "Receipts" : activeTab === "payment" ? "Payments" : "Ledger"} — ${activeParty ? activeParty.name : ""}`, filteredRecords.length)}
            {activeTab === "ledger" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>📅</span>
                <select value={ledgerFY} onChange={(e) => setLedgerFY(e.target.value)} style={{ padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 9, fontSize: 13, background: "#fff", color: "#0f172a", outline: "none" }}>
                  {fyOptions(7).map((fy) => (
                    <option key={fy} value={fy}>{fy} FY</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const cust = activeParty ? customers.find((c) => String(c.id) === String(activeParty.key)) || null : null;
                    const body = printBodyForLedgerYear(cust || activeParty, "complete");
                    if (body) openPrintWindow("Customer Complete Ledger - " + ((cust || activeParty)?.business_name || (cust || activeParty)?.customer_name || activeParty?.name || ""), body);
                  }}
                  disabled={allPartyActive}
                  style={{ background: allPartyActive ? "#cbd5e1" : "#0f766e", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 12, cursor: allPartyActive ? "not-allowed" : "pointer", opacity: allPartyActive ? 0.7 : 1 }}
                >
                  🖨️ Complete Ledger PDF
                </button>
                <button
                  onClick={() => {
                    const cust = activeParty ? customers.find((c) => String(c.id) === String(activeParty.key)) || null : null;
                    const body = printBodyForLedgerYear(cust || activeParty, "pending");
                    if (body) openPrintWindow("Customer Pending Ledger - " + ((cust || activeParty)?.business_name || (cust || activeParty)?.customer_name || activeParty?.name || ""), body);
                  }}
                  disabled={allPartyActive}
                  style={{ background: allPartyActive ? "#cbd5e1" : "#b91c1c", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 12, cursor: allPartyActive ? "not-allowed" : "pointer", opacity: allPartyActive ? 0.7 : 1 }}
                >
                  🖨️ Pending Ledger PDF
                </button>
                {allPartyActive && (
                  <button
                    onClick={() => {
                      const body = printBodyForAllPartyPending();
                      if (body) openPrintWindow("All Party Total Pending Report - " + ledgerFY, body);
                    }}
                    style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
                  >
                    🖨️ Total Pending Report (All Parties)
                  </button>
                )}
              </div>
            )}
            <div style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
              <input type="text" value={recordFilter} onChange={(e) => setRecordFilter(e.target.value)} placeholder="Search number..." style={{ width: "100%", padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 9, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {filteredRecords.length === 0 && <p style={{ padding: "18px 14px", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>Records nahi mile</p>}
              {filteredRecords.map((r: any) => (
                <button key={String(r.key)} onClick={() => openRecord(r)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: "#fff", transition: "background .15s" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")} onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}>
                  <span style={{ background: "#0f172a", color: "#fff", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 800, minWidth: 54, textAlign: "center" }}>{r.badge}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{r.no}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{r.date}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: activeTab === "payment" ? "#dc2626" : "#15803d" }}>{money(r.amount)}</div>
                  <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>👁 Preview</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const canPrint =
    (activeTab === "po" && !!selectedPO) ||
    (activeTab === "invoice" && !!selectedInvoice) ||
    (activeTab === "receipt" && !!selectedReceipt) ||
    (activeTab === "payment" && !!selectedPayment) ||
    (activeTab === "ledger" && !!selectedCustomer);

  return (
    <div style={{ width: "100%" }}>
      <div className="page-title">
        <div>
          <h1>🖨️ Print Center</h1>
          <p>Professional print &amp; billing documents — one click ready</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: activeTab === tab.key ? "#0f172a" : "#fff",
              color: activeTab === tab.key ? "#fff" : "#1e293b",
              border: activeTab === tab.key ? "1px solid #0f172a" : "1px solid #e2e8f0",
              borderRadius: 14,
              padding: "16px 14px",
              cursor: "pointer",
              textAlign: "left",
              boxShadow: activeTab === tab.key ? "0 8px 22px rgba(15,23,42,0.18)" : "0 2px 8px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{tab.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{tab.label}</div>
            <div style={{ fontSize: 11, color: activeTab === tab.key ? "#aeb8c8" : "#64748b", marginTop: 3 }}>{tab.desc}</div>
          </button>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        {loading ? (
          <p style={{ textAlign: "center", color: "#64748b", padding: 30 }}>Loading records...</p>
        ) : (
          <>
            <div style={{ marginBottom: 18 }}>{renderBrowser()}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
              <button
                onClick={handlePrint}
                disabled={!canPrint}
                style={{
                  background: canPrint ? "#0284c7" : "#cbd5e1",
                  color: "#fff",
                  border: "none",
                  padding: "12px 28px",
                  borderRadius: 10,
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: canPrint ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                🖨️ Print {TABS.find((t) => t.key === activeTab)?.label || ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PrintCenter;