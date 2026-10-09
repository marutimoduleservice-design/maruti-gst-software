import { sc, getCompanyId } from "../lib/company";
import { supabase } from "../lib/supabase";
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/formatDate";
import { aggregateHsn, round2, stateName, type HsnSummaryRow } from "../lib/gst";

type Invoice = {
  id: number;
  invoice_no: string;
  invoice_date: string;
  customer_id: number;
  invoice_type: string;
  total_amount: number;
  taxable_amount?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  round_off?: number | null;
  place_of_supply?: string | null;
  supply_type?: string | null;
  customer_gstin?: string | null;
};

type InvoiceItem = {
  invoice_id: number;
  quantity: number | null;
  rate: number | null;
  total: number | null;
  hsn_code?: string | null;
  gst_percent?: number | null;
  taxable_value?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
};

type Purchase = {
  id: number;
  inward_no?: string | null;
  purchase_no?: string | null;
  purchase_date: string | null;
  vendor_name?: string | null;
  vendor_gstin?: string | null;
  hsn_code?: string | null;
  gst_percent?: number | null;
  taxable_value?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
};

type Customer = {
  id: number;
  business_name?: string | null;
  customer_name?: string | null;
  gst_number?: string | null;
  state_code?: string | null;
  state_name?: string | null;
};

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const today = () => new Date().toISOString().slice(0, 10);

const inr = (n: number) => `₹ ${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const downloadCsv = (filename: string, rows: (string | number)[][]) => {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

type Tab = "gstr1" | "hsn" | "itc";

function GstReport() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [company, setCompany] = useState<{ name: string; gstin: string; state_name: string }>({
    name: "",
    gstin: "",
    state_name: "",
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("gstr1");

  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());

  const loadData = async () => {
    setLoading(true);
    try {
      const [invRes, itemRes, custRes, compRes, purRes] = await Promise.all([
        sc("invoices").select("*").order("invoice_date", { ascending: false }),
        sc("invoice_items").select("*"),
        sc("customers").select("id, business_name, customer_name, gst_number, state_code, state_name"),
        supabase.from("companies").select("id, name, gst_number, state_name, state_code").eq("id", getCompanyId()).limit(1),
        sc("purchases").select("*").order("purchase_date", { ascending: false }),
      ]);

      setInvoices((invRes.data || []) as Invoice[]);
      setInvoiceItems((itemRes.data || []) as InvoiceItem[]);
      setCustomers((custRes.data || []) as Customer[]);
      setPurchases((purRes.data || []) as Purchase[]);

      const comp: any = (compRes.data || [])[0];
      if (comp) {
        setCompany({
          name: comp.name || "",
          gstin: comp.gst_number || "",
          state_name: comp.state_name || stateName(comp.state_code) || "",
        });
      }
    } catch (err) {
      console.error("GST report load error:", err);
      alert("GST report data load nahi hua. Migration chalayi gayi hai?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const customerById = useMemo(() => {
    const map = new Map<number, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const itemsByInvoice = useMemo(() => {
    const map = new Map<number, InvoiceItem[]>();
    invoiceItems.forEach((it) => {
      const list = map.get(it.invoice_id) || [];
      list.push(it);
      map.set(it.invoice_id, list);
    });
    return map;
  }, [invoiceItems]);

  const inRange = (date: string | null | undefined) =>
    Boolean(date) && String(date) >= fromDate && String(date) <= toDate;

  const rangeInvoices = useMemo(
    () => invoices.filter((inv) => inRange(inv.invoice_date)),
    [invoices, fromDate, toDate],
  );

  const rangePurchases = useMemo(
    () => purchases.filter((p) => inRange(p.purchase_date)),
    [purchases, fromDate, toDate],
  );

  const lineTotals = (items: InvoiceItem[]) => {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    items.forEach((it) => {
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      const lineTaxable =
        it.taxable_value !== null && it.taxable_value !== undefined
          ? Number(it.taxable_value)
          : Number(it.total) || qty * rate;
      taxable += lineTaxable;
      cgst += Number(it.cgst_amount) || 0;
      sgst += Number(it.sgst_amount) || 0;
      igst += Number(it.igst_amount) || 0;
    });
    return { taxable: round2(taxable), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst) };
  };

  // B2B / B2C + rate-wise summary (GSTR-1 style)
  const summary = useMemo(() => {
    const b2b = { count: 0, taxable: 0, tax: 0 };
    const b2c = { count: 0, taxable: 0, tax: 0 };
    const rateWise = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();

    rangeInvoices.forEach((inv) => {
      const items = itemsByInvoice.get(inv.id) || [];
      const t = lineTotals(items);
      const tax = round2(t.cgst + t.sgst + t.igst);
      const isB2B = Boolean(inv.customer_gstin) || inv.supply_type === "B2B";
      if (isB2B) {
        b2b.count += 1;
        b2b.taxable += t.taxable;
        b2b.tax += tax;
      } else {
        b2c.count += 1;
        b2c.taxable += t.taxable;
        b2c.tax += tax;
      }

      items.forEach((it) => {
        const pct = Number(it.gst_percent) || 0;
        const key = `${pct}`;
        const row = rateWise.get(key) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const qty = Number(it.quantity) || 0;
        const lineTaxable =
          it.taxable_value !== null && it.taxable_value !== undefined
            ? Number(it.taxable_value)
            : Number(it.total) || qty * (Number(it.rate) || 0);
        row.taxable += lineTaxable;
        row.cgst += Number(it.cgst_amount) || 0;
        row.sgst += Number(it.sgst_amount) || 0;
        row.igst += Number(it.igst_amount) || 0;
        rateWise.set(key, row);
      });
    });

    const rateRows = [...rateWise.entries()]
      .map(([pct, v]) => ({
        gst_percent: Number(pct),
        taxable: round2(v.taxable),
        cgst: round2(v.cgst),
        sgst: round2(v.sgst),
        igst: round2(v.igst),
      }))
      .sort((a, b) => a.gst_percent - b.gst_percent);

    return {
      b2b: { ...b2b, taxable: round2(b2b.taxable), tax: round2(b2b.tax) },
      b2c: { ...b2c, taxable: round2(b2c.taxable), tax: round2(b2c.tax) },
      rateRows,
    };
  }, [rangeInvoices, itemsByInvoice]);

  // HSN/SAC summary across all invoice lines in range
  const hsnRows: HsnSummaryRow[] = useMemo(() => {
    const lines = rangeInvoices.flatMap((inv) =>
      (itemsByInvoice.get(inv.id) || []).map((it) => ({
        hsn_code: it.hsn_code || "",
        gst_percent: Number(it.gst_percent) || 0,
        quantity: Number(it.quantity) || 0,
        taxable_value:
          it.taxable_value !== null && it.taxable_value !== undefined
            ? Number(it.taxable_value)
            : Number(it.total) || 0,
        cgst_amount: Number(it.cgst_amount) || 0,
        sgst_amount: Number(it.sgst_amount) || 0,
        igst_amount: Number(it.igst_amount) || 0,
      })),
    );
    return aggregateHsn(lines);
  }, [rangeInvoices, itemsByInvoice]);

  // Purchase ITC summary
  const itc = useMemo(() => {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    rangePurchases.forEach((p) => {
      const qty = Number((p as any).quantity) || 0;
      const rate = Number((p as any).rate) || 0;
      const t =
        p.taxable_value !== null && p.taxable_value !== undefined && Number(p.taxable_value) > 0
          ? Number(p.taxable_value)
          : Number((p as any).total_amount) || qty * rate;
      taxable += t || 0;
      cgst += Number(p.cgst_amount) || 0;
      sgst += Number(p.sgst_amount) || 0;
      igst += Number(p.igst_amount) || 0;
    });
    return {
      taxable: round2(taxable),
      cgst: round2(cgst),
      sgst: round2(sgst),
      igst: round2(igst),
      total: round2(cgst + sgst + igst),
    };
  }, [rangePurchases]);

  const exportCsv = () => {
    const stamp = `${fromDate}_to_${toDate}`;
    if (tab === "gstr1") {
      const rows: (string | number)[][] = [
        ["GSTR-1 Summary"],
        ["Company", company.name],
        ["GSTIN", company.gstin],
        ["Period", `${fromDate} to ${toDate}`],
        [],
        ["Section", "Invoices", "Taxable Value", "Tax"],
        ["B2B", summary.b2b.count, summary.b2b.taxable, summary.b2b.tax],
        ["B2C", summary.b2c.count, summary.b2c.taxable, summary.b2c.tax],
        [],
        ["Rate %", "Taxable Value", "CGST", "SGST", "IGST"],
        ...summary.rateRows.map((r) => [r.gst_percent, r.taxable, r.cgst, r.sgst, r.igst]),
      ];
      downloadCsv(`GSTR1_${stamp}.csv`, rows);
    } else if (tab === "hsn") {
      const rows: (string | number)[][] = [
        ["HSN/SAC Summary"],
        ["Period", `${fromDate} to ${toDate}`],
        [],
        ["HSN/SAC", "GST %", "Qty", "Taxable Value", "CGST", "SGST", "IGST"],
        ...hsnRows.map((r) => [
          r.hsn_code,
          r.gst_percent,
          r.quantity,
          r.taxable_value,
          r.cgst_amount,
          r.sgst_amount,
          r.igst_amount,
        ]),
      ];
      downloadCsv(`HSN_Summary_${stamp}.csv`, rows);
    } else {
      const rows: (string | number)[][] = [
        ["Purchase ITC Summary"],
        ["Period", `${fromDate} to ${toDate}`],
        [],
        ["Taxable Value", itc.taxable],
        ["CGST (Input)", itc.cgst],
        ["SGST (Input)", itc.sgst],
        ["IGST (Input)", itc.igst],
        ["Total ITC", itc.total],
      ];
      downloadCsv(`Purchase_ITC_${stamp}.csv`, rows);
    }
  };

  const tabButton = (key: Tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "9px 16px",
        borderRadius: 8,
        border: "1px solid #cbd5e1",
        background: tab === key ? "#2563eb" : "#fff",
        color: tab === key ? "#fff" : "#334155",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );

  const th: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    color: "#64748b",
    textAlign: "left",
    borderBottom: "1px solid #e2e8f0",
    whiteSpace: "nowrap",
  };
  const thR: React.CSSProperties = { ...th, textAlign: "right" };
  const td: React.CSSProperties = { padding: "9px 12px", fontSize: 13, color: "#334155", borderBottom: "1px solid #f1f5f9" };
  const tdR: React.CSSProperties = { ...td, textAlign: "right" };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 };

  return (
    <div style={{ width: "100%" }}>
      <div className="page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>GST Report (GSTR-1)</h1>
          <p>B2B/B2C sales summary, HSN-wise breakup aur purchase ITC.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <span style={{ color: "#64748b" }}>to</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8 }} />
          <button onClick={loadData} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>🔄 Refresh</button>
          <button onClick={exportCsv} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer" }}>📥 Export CSV</button>
          <button onClick={() => window.print()} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "#475569", color: "#fff", fontWeight: 700, cursor: "pointer" }}>🖨 Print</button>
        </div>
      </div>

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#475569" }}>
          <strong>{company.name}</strong>
          {company.gstin ? ` • GSTIN: ${company.gstin}` : " • Non-GST company"}
          {company.state_name ? ` • ${company.state_name}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {tabButton("gstr1", "GSTR-1 Summary")}
        {tabButton("hsn", "HSN / SAC Summary")}
        {tabButton("itc", "Purchase ITC")}
      </div>

      {loading ? (
        <div style={card}>Loading...</div>
      ) : tab === "gstr1" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div style={{ ...card, marginBottom: 0 }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>B2B Invoices</span>
              <strong style={{ display: "block", fontSize: 22, color: "#1d4ed8", marginTop: 4 }}>{summary.b2b.count}</strong>
              <small style={{ color: "#64748b" }}>Taxable {inr(summary.b2b.taxable)} • Tax {inr(summary.b2b.tax)}</small>
            </div>
            <div style={{ ...card, marginBottom: 0 }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>B2C Invoices</span>
              <strong style={{ display: "block", fontSize: 22, color: "#7c3aed", marginTop: 4 }}>{summary.b2c.count}</strong>
              <small style={{ color: "#64748b" }}>Taxable {inr(summary.b2c.taxable)} • Tax {inr(summary.b2c.tax)}</small>
            </div>
            <div style={{ ...card, marginBottom: 0 }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>Total Tax Liability</span>
              <strong style={{ display: "block", fontSize: 22, color: "#b45309", marginTop: 4 }}>
                {inr(round2(summary.b2b.tax + summary.b2c.tax))}
              </strong>
              <small style={{ color: "#64748b" }}>CGST + SGST + IGST</small>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>Rate-wise Summary (B2B + B2C)</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>GST Rate</th>
                    <th style={thR}>Taxable Value</th>
                    <th style={thR}>CGST</th>
                    <th style={thR}>SGST</th>
                    <th style={thR}>IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rateRows.length === 0 ? (
                    <tr><td style={td} colSpan={5}>Is period me koi invoice nahi mila.</td></tr>
                  ) : (
                    summary.rateRows.map((r) => (
                      <tr key={r.gst_percent}>
                        <td style={td}><strong>{r.gst_percent}%</strong></td>
                        <td style={tdR}>{inr(r.taxable)}</td>
                        <td style={tdR}>{inr(r.cgst)}</td>
                        <td style={tdR}>{inr(r.sgst)}</td>
                        <td style={tdR}>{inr(r.igst)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>Invoice Register</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Invoice No</th>
                    <th style={th}>Date</th>
                    <th style={th}>Customer</th>
                    <th style={th}>GSTIN</th>
                    <th style={th}>Type</th>
                    <th style={th}>Place of Supply</th>
                    <th style={thR}>Taxable</th>
                    <th style={thR}>Tax</th>
                    <th style={thR}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeInvoices.length === 0 ? (
                    <tr><td style={td} colSpan={9}>No invoices in this period.</td></tr>
                  ) : (
                    rangeInvoices.map((inv) => {
                      const items = itemsByInvoice.get(inv.id) || [];
                      const t = lineTotals(items);
                      const tax = round2(t.cgst + t.sgst + t.igst);
                      const cust = customerById.get(inv.customer_id);
                      const isB2B = Boolean(inv.customer_gstin) || inv.supply_type === "B2B";
                      return (
                        <tr key={inv.id}>
                          <td style={td}><strong style={{ color: "#2563eb" }}>{inv.invoice_no}</strong></td>
                          <td style={td}>{fmtDate(inv.invoice_date)}</td>
                          <td style={td}>{cust?.business_name || cust?.customer_name || "—"}</td>
                          <td style={td}>{inv.customer_gstin || cust?.gst_number || "—"}</td>
                          <td style={td}>{isB2B ? "B2B" : "B2C"}</td>
                          <td style={td}>{inv.place_of_supply || cust?.state_name || "—"}</td>
                          <td style={tdR}>{inr(t.taxable)}</td>
                          <td style={tdR}>{inr(tax)}</td>
                          <td style={tdR}><strong>{inr(Number(inv.total_amount) || 0)}</strong></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : tab === "hsn" ? (
        <div style={card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>HSN / SAC Summary</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>HSN / SAC</th>
                  <th style={thR}>GST %</th>
                  <th style={thR}>Qty</th>
                  <th style={thR}>Taxable Value</th>
                  <th style={thR}>CGST</th>
                  <th style={thR}>SGST</th>
                  <th style={thR}>IGST</th>
                </tr>
              </thead>
              <tbody>
                {hsnRows.length === 0 ? (
                  <tr><td style={td} colSpan={7}>Is period me koi invoice line nahi mili.</td></tr>
                ) : (
                  hsnRows.map((r, i) => (
                    <tr key={`${r.hsn_code}-${r.gst_percent}-${i}`}>
                      <td style={td}><strong>{r.hsn_code}</strong></td>
                      <td style={tdR}>{r.gst_percent}%</td>
                      <td style={tdR}>{r.quantity}</td>
                      <td style={tdR}>{inr(r.taxable_value)}</td>
                      <td style={tdR}>{inr(r.cgst_amount)}</td>
                      <td style={tdR}>{inr(r.sgst_amount)}</td>
                      <td style={tdR}>{inr(r.igst_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>Purchase Input Tax Credit (ITC)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <div><span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>Taxable Value</span><strong style={{ display: "block", fontSize: 18 }}>{inr(itc.taxable)}</strong></div>
            <div><span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>CGST (Input)</span><strong style={{ display: "block", fontSize: 18 }}>{inr(itc.cgst)}</strong></div>
            <div><span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>SGST (Input)</span><strong style={{ display: "block", fontSize: 18 }}>{inr(itc.sgst)}</strong></div>
            <div><span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>IGST (Input)</span><strong style={{ display: "block", fontSize: 18 }}>{inr(itc.igst)}</strong></div>
          </div>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: 13, color: "#475569" }}>Total ITC available: </span>
            <strong style={{ fontSize: 18, color: "#15803d" }}>{inr(itc.total)}</strong>
          </div>

          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Inward/PO</th>
                  <th style={th}>Date</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>GSTIN</th>
                  <th style={th}>HSN</th>
                  <th style={thR}>GST %</th>
                  <th style={thR}>Taxable</th>
                  <th style={thR}>Tax</th>
                </tr>
              </thead>
              <tbody>
                {rangePurchases.length === 0 ? (
                  <tr><td style={td} colSpan={8}>Is period me koi purchase nahi mili.</td></tr>
                ) : (
                  rangePurchases.map((p) => {
                    const tax = round2((Number(p.cgst_amount) || 0) + (Number(p.sgst_amount) || 0) + (Number(p.igst_amount) || 0));
                    const qty = Number((p as any).quantity) || 0;
                    const rate = Number((p as any).rate) || 0;
                    const taxable =
                      p.taxable_value !== null && p.taxable_value !== undefined && Number(p.taxable_value) > 0
                        ? Number(p.taxable_value)
                        : Number((p as any).total_amount) || qty * rate;
                    return (
                      <tr key={p.id}>
                        <td style={td}><strong style={{ color: "#2563eb" }}>{p.inward_no || p.purchase_no || `INW-${p.id}`}</strong></td>
                        <td style={td}>{fmtDate(p.purchase_date || "")}</td>
                        <td style={td}>{p.vendor_name || "—"}</td>
                        <td style={td}>{p.vendor_gstin || "—"}</td>
                        <td style={td}>{p.hsn_code || "—"}</td>
                        <td style={tdR}>{Number(p.gst_percent) || 0}%</td>
                        <td style={tdR}>{inr(taxable)}</td>
                        <td style={tdR}>{inr(tax)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default GstReport;
