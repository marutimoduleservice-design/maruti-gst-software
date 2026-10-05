import { useEffect, useMemo, useState } from "react";
import { sc } from "../lib/company";
import { computeProfitMonthly, money, profitTotals, toNumber, type ProfitMonthly } from "../lib/profitCalc";
import { currentFY, fyOptions, fyStartYear } from "../lib/financialYear";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Invoice = { id: number; invoice_date: string | null; total_amount: number | null };
type JobCard = { job_date: string | null; repairing_quantity: number | null; warranty_quantity: number | null; reject_quantity: number | null; business_name?: string | null; customer_id?: number | null; customer_name?: string | null };
type BankRow = { transaction_date: string | null; created_at: string | null; amount: number | null; debit_amount: number | null; payment_out: number | null; payment_in: number | null; particulars: string | null; type: string | null; transaction_type: string | null };
type Purchase = { inward_no: string | null; purchase_no?: string | null; item_name: string | null; item_code?: string | null; rate: number | null; purchase_rate?: number | null; quantity: number | null };
type Item = { id: number; item_name: string | null; item_code: string | null; purchase_price: number | null; cost_price: number | null; opening_stock: number | null };
type InvoiceLine = { invoice_id: number; inward_no: string | null; item_name: string | null; item_code?: string | null; quantity: number | null; cost_rate: number | null; total_cost?: number | null };
type Monthly = ProfitMonthly;

function NetProfitReport() {
  const [financialYear, setFinancialYear] = useState(currentFY().label);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [invoiceRes, jobRes, bankRes, purchaseRes, itemRes, lineRes] = await Promise.all([
          sc("invoices").select("*"),
          sc("job_cards").select("*"),
          sc("bank_transactions").select("*").order("id", { ascending: true }),
          sc("purchases").select("*"),
          sc("items").select("*"),
          sc("invoice_items").select("*"),
        ]);
        const errors = [invoiceRes, jobRes, bankRes, purchaseRes, itemRes, lineRes]
          .filter((result) => result.error)
          .map((result) => result.error?.message)
          .filter(Boolean);
        if (errors.length > 0) throw new Error(errors.join(" | "));
        setInvoices((invoiceRes.data || []) as Invoice[]);
        setJobs((jobRes.data || []) as JobCard[]);
        setBankRows((bankRes.data || []) as BankRow[]);
        setPurchases((purchaseRes.data || []) as Purchase[]);
        let itemRows = itemRes.data || [];
        if (itemRows.length === 0) {
          const fallback = await sc("item_master").select("id, item_name, item_code, purchase_price, cost_price, opening_stock");
          if (fallback.error) throw fallback.error;
          itemRows = fallback.data || [];
        }
        setItems(itemRows as Item[]);
        setLines((lineRes.data || []) as InvoiceLine[]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load report data.";
        setLoadError(message);
        console.error("Error loading Net Profit data:", error);
      }
      finally { setLoading(false); }
    };
    load();
  }, [reloadKey]);

  const startYear = fyStartYear(financialYear);
  const elapsedMonthCount = useMemo(() => {
    const today = new Date();
    const currentFinancialYearStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    if (startYear < currentFinancialYearStart) return 12;
    if (startYear > currentFinancialYearStart) return 1;
    return Math.min(12, Math.max(1, today.getMonth() - 2));
  }, [startYear]);
  const monthly = useMemo<Monthly[]>(() => computeProfitMonthly({ invoices, lines, purchases, items, bankRows, jobs, startYear }), [invoices, lines, purchases, items, bankRows, jobs, startYear]);

  const totals = useMemo(() => profitTotals(monthly), [monthly]);
  const stockTotal = useMemo(() => {
    const findItem = (name?: string | null, code?: string | null) => items.find((item) =>
      (code && item.item_code && String(code).trim().toLowerCase() === String(item.item_code).trim().toLowerCase()) ||
      (name && item.item_name && String(name).trim().toLowerCase() === String(item.item_name).trim().toLowerCase())
    );
    interface InwardEntry { qty: number; rate: number; value: number; }
    const inwardMap: Record<string, InwardEntry> = {};
    const inwardKey = (inwardNo: string, itemId: number) => `${String(inwardNo).trim().toLowerCase()}|${itemId}`;
    const inwardByItemId: Record<number, number> = {};
    const outwardByItemId: Record<number, number> = {};

    purchases.forEach((purchase) => {
      const item = findItem(purchase.item_name, purchase.item_code);
      const inwNo = String(purchase.inward_no || purchase.purchase_no || "").trim();
      if (item && inwNo) {
        const key = inwardKey(inwNo, item.id);
        const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
        const rate = toNumber(purchase.rate);
        inwardMap[key] = {
          qty: prev.qty + toNumber(purchase.quantity),
          rate: rate > 0 ? rate : prev.rate,
          value: prev.value + toNumber(purchase.quantity) * rate,
        };
        inwardByItemId[item.id] = (inwardByItemId[item.id] || 0) + toNumber(purchase.quantity);
      }
    });

    lines.forEach((line) => {
      const item = findItem(line.item_name, line.item_code);
      const inwNo = String(line.inward_no || "").trim();
      if (item) {
        outwardByItemId[item.id] = (outwardByItemId[item.id] || 0) + toNumber(line.quantity);
        if (inwNo && !inwNo.startsWith("JOB-")) {
          const key = inwardKey(inwNo, item.id);
          if (inwardMap[key]) {
            const entry = inwardMap[key];
            const before = entry.qty;
            const sold = Math.min(toNumber(line.quantity), before);
            entry.qty = Math.max(0, before - sold);
            entry.value = before > 0 ? entry.value * (entry.qty / before) : 0;
          }
        }
      }
    });

    jobs.forEach((job) => {
      const serviceItems = [
        ["Module Service", job.repairing_quantity, "JOB-REP"],
        ["Warranty Service", job.warranty_quantity, "JOB-WAR"],
        ["Reject Module", job.reject_quantity, "JOB-REJ"],
      ] as const;
      serviceItems.forEach(([name, quantity, jobInw]) => {
        const item = findItem(name);
        if (item) {
          const key = inwardKey(jobInw, item.id);
          const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
          const fallbackRate = prev.rate || toNumber(item.purchase_price) || 50;
          inwardMap[key] = {
            qty: prev.qty + toNumber(quantity),
            rate: fallbackRate,
            value: prev.value + toNumber(quantity) * fallbackRate,
          };
          inwardByItemId[item.id] = (inwardByItemId[item.id] || 0) + toNumber(quantity);
        }
      });
    });

    const serviceItemNames = ["module service", "warranty service", "reject module"];
    const isServiceItem = (name: string) => serviceItemNames.some((s) => name.toLowerCase().includes(s));

    return items.reduce((sum, item) => {
      const currentStock = Math.max(0, toNumber(item.opening_stock) + (inwardByItemId[item.id] || 0) - (outwardByItemId[item.id] || 0));
      let itemStockValue = 0;
      if (!isServiceItem(item.item_name || "")) {
        const itemInwardEntries = Object.entries(inwardMap).filter(([key]) => key.endsWith(`|${item.id}`));
        if (itemInwardEntries.length > 0) {
          for (const [, entry] of itemInwardEntries) {
            itemStockValue += Math.max(0, entry.value);
          }
        } else {
          const fallbackRate = toNumber(item.purchase_price) || toNumber(item.cost_price);
          itemStockValue = Math.max(0, currentStock) * fallbackRate;
        }
      }
      return sum + itemStockValue;
    }, 0);
  }, [items, purchases, lines, jobs]);
  const warrantyPercentage = totals.repairQty ? totals.warrantyQty / totals.repairQty * 100 : 0;

  // ─── Party Wise Module Repair ──────────────────────────────
  // Job Card quantities ko Month + Business Name ke hisaab se group karta hai.
  const [partyMonth, setPartyMonth] = useState("All");
  const MONTH_LABELS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];

  const monthOf = (dateValue?: string | null) => {
    const raw = String(dateValue || "").slice(0, 10);
    if (!raw) return -1;
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return -1;
    const expectedYear = date.getMonth() >= 3 ? startYear : startYear + 1;
    if (date.getFullYear() !== expectedYear) return -1;
    return date.getMonth() >= 3 ? date.getMonth() - 3 : date.getMonth() + 9;
  };

  const partyRows = useMemo(() => {
    const grouped = new Map<string, { month: string; monthIndex: number; business: string; repair: number; warranty: number }>();

    jobs.forEach((job) => {
      const index = monthOf(job.job_date);
      if (index < 0) return;
      if (partyMonth !== "All" && MONTH_LABELS[index] !== partyMonth) return;

      const business = String(job.business_name || job.customer_name || "").trim() || "Unnamed Party";
      const key = `${index}|${business.toLowerCase()}`;
      const existing = grouped.get(key) || {
        month: MONTH_LABELS[index],
        monthIndex: index,
        business,
        repair: 0,
        warranty: 0,
      };
      existing.repair += toNumber(job.repairing_quantity);
      existing.warranty += toNumber(job.warranty_quantity);
      grouped.set(key, existing);
    });

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        grand: row.repair + row.warranty,
        warrantyPercent: row.repair ? (row.warranty / row.repair) * 100 : 0,
      }))
      .sort((a, b) => a.monthIndex - b.monthIndex || a.business.localeCompare(b.business, undefined, { numeric: true, sensitivity: "base" }));
  }, [jobs, startYear, partyMonth]);

  const partyCols = {
    month: (r: any) => String(r.month || ""),
    business: (r: any) => String(r.business || ""),
    repair: (r: any) => Number(r.repair || 0),
    warranty: (r: any) => Number(r.warranty || 0),
    grand: (r: any) => Number(r.grand || 0),
    warrantyPercent: (r: any) => Number(r.warrantyPercent || 0),
  } as const;
  const { sort: pSort, sorted: sortedPartyRows } = useSortedRows(partyRows, partyCols, "month");

  const partyTotals = useMemo(() => partyRows.reduce(
    (acc, row) => ({ repair: acc.repair + row.repair, warranty: acc.warranty + row.warranty }),
    { repair: 0, warranty: 0 }
  ), [partyRows]);
  const partyGrand = partyTotals.repair + partyTotals.warranty;
  const partyWarrantyPercent = partyTotals.repair ? (partyTotals.warranty / partyTotals.repair) * 100 : 0;

  const exportPartyCSV = () => {
    const headers = ["Business Name", "Total Module Service", "Total Warranty Service", "Grand Total", "Warranty Percentage"];
    const body = sortedPartyRows.map((row) => [`"${row.business}"`, row.repair, row.warranty, row.grand, `${row.warrantyPercent.toFixed(2)}%`].join(","));
    const total = ["Total", partyTotals.repair, partyTotals.warranty, partyGrand, `${partyWarrantyPercent.toFixed(2)}%`].join(",");
    const link = document.createElement("a");
    link.href = encodeURI(`data:text/csv;charset=utf-8,${[headers.join(","), ...body, total].join("\n")}`);
    link.download = `Party_Wise_Module_Repair_${financialYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToCSV = () => {
    const headers = ["Month", "Total Sale", "Total Cost", "Total Expense", "Gross Profit", "Payment Cut", "Net Profit", "Personal", "Saving", "Repair Qty", "Warranty Qty"];
    const rows = monthly.map((row) => [row.label, row.sale, row.cost, row.expense, row.grossProfit, row.deduction, row.netProfit, row.personal, row.saving, row.repairQty, row.warrantyQty].join(","));
    const total = ["Total", totals.sale, totals.cost, totals.expense, totals.grossProfit, totals.deduction, totals.netProfit, totals.personal, totals.saving, totals.repairQty, totals.warrantyQty].join(",");
    const link = document.createElement("a"); link.href = encodeURI(`data:text/csv;charset=utf-8,${[headers.join(","), ...rows, total].join("\n")}`); link.download = `Net_Profit_Report_${financialYear}.csv`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="profit-report-page">
      <div className="page-title profit-report-header"><div><h1>Net Profit Report</h1><p>Financial Year: {financialYear} | April to March</p></div><div className="profit-report-actions"><select value={financialYear} onChange={(event) => setFinancialYear(event.target.value)} style={filterInputStyle}>{fyOptions(5).map((fy) => (<option key={fy} value={fy}>{fy}</option>))}</select><button onClick={() => setReloadKey((value) => value + 1)} style={{ ...reportButtonStyle, background: "#0f172a" }}>🔄 Refresh Report</button><button onClick={exportToCSV} style={reportButtonStyle}>📥 Export CSV</button><button onClick={() => window.print()} style={{ ...reportButtonStyle, background: "#475569" }}>🖨 Print</button></div></div>
      {loadError && <div className="profit-report-error">Report data load nahi hua: {loadError}</div>}
      <div className="profit-kpi-grid"><MetricCard title="Total Sale" value={money(totals.sale)} subtitle="Direct + Job Card invoices" tone="blue" /><MetricCard title="Total Cost" value={money(totals.cost)} subtitle="Spare parts purchase cost" tone="orange" /><MetricCard title="Total Expense" value={money(totals.expense)} subtitle="Passbook expenses" tone="red" /><MetricCard title="Gross Profit" value={money(totals.grossProfit)} subtitle="Sale - Cost - Expense" tone="slate" /><MetricCard title="Payment Cut" value={money(totals.deduction)} subtitle="Customer discount" tone="amber" /><MetricCard title="Net Profit" value={money(totals.netProfit)} subtitle="Gross Profit - Payment Cut" tone={totals.netProfit >= 0 ? "green" : "red"} /><MetricCard title="Personal" value={money(totals.personal)} subtitle="Owner drawings" tone="purple" /><MetricCard title="Saving" value={money(totals.saving)} subtitle="Net Profit - Personal" tone="blue" /><MetricCard title="Stock Total" value={money(stockTotal)} subtitle="Current stock purchase value" tone="teal" /></div>
      <ProfitSection title="Monthly Profit & Loss" subtitle={`${startYear}-04-01 to ${startYear + 1}-03-31`}><div className="responsive-table-wrapper"><table className="profit-table"><thead><tr>{["Month", "Total Sale", "Total Cost", "Total Expense", "Gross Profit", "Payment Cut", "Net Profit", "Personal", "Saving"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={9}>Loading report...</td></tr> : [...monthly, { ...monthly[0], key: "total", label: `Per Month Avg (${elapsedMonthCount} Months)`, sale: totals.sale / elapsedMonthCount, cost: totals.cost / elapsedMonthCount, expense: totals.expense / elapsedMonthCount, grossProfit: totals.grossProfit / elapsedMonthCount, deduction: totals.deduction / elapsedMonthCount, netProfit: totals.netProfit / elapsedMonthCount, personal: totals.personal / elapsedMonthCount, saving: totals.saving / elapsedMonthCount, repairQty: totals.repairQty / elapsedMonthCount, warrantyQty: totals.warrantyQty / elapsedMonthCount }].map((row) => <tr key={row.key} className={row.key === "total" ? "total-row" : ""}><td><strong>{row.label}</strong></td><td>{money(row.sale)}</td><td>{money(row.cost)}</td><td>{money(row.expense)}</td><td>{money(row.grossProfit)}</td><td>{money(row.deduction)}</td><td>{money(row.netProfit)}</td><td>{money(row.personal)}</td><td>{money(row.saving)}</td></tr>)}</tbody></table></div></ProfitSection>
      <div className="profit-detail-grid"><ProfitSection title="Module Repair & Warranty" subtitle="Job Card quantities"><div className="repair-profit-summary"><div><span>Module Service</span><strong>{totals.repairQty}</strong></div><div><span>Warranty Service</span><strong>{totals.warrantyQty}</strong></div><div><span>Grand Total</span><strong>{totals.repairQty + totals.warrantyQty}</strong></div><div><span>Warranty Percentage</span><strong>{warrantyPercentage.toFixed(2)}%</strong></div></div></ProfitSection><ProfitSection title="Stock Valuation" subtitle="Current stock purchase value"><div className="stock-total-highlight">{money(stockTotal)}</div><p className="profit-note">Current stock quantity × purchase price.</p></ProfitSection></div>
      <ProfitSection title="Monthly Service & Warranty Report" subtitle="Job Card quantities by month"><div className="responsive-table-wrapper"><table className="profit-table"><thead><tr><th>Month</th><th>Module Service</th><th>Warranty Service</th><th>Grand Total</th><th>Warranty Percentage</th></tr></thead><tbody>{monthly.map((row) => <tr key={`service-${row.key}`}><td>{row.label}</td><td>{row.repairQty}</td><td>{row.warrantyQty}</td><td>{row.repairQty + row.warrantyQty}</td><td>{row.repairQty ? `${(row.warrantyQty / row.repairQty * 100).toFixed(2)}%` : "0.00%"}</td></tr>)}</tbody></table></div></ProfitSection>
      <section className="profit-section">
        <div className="profit-section-heading">
          <div>
            <h2>Party Wise Module Repair Report</h2>
            <span>Month + Business Name wise module & warranty quantities</span>
          </div>
          <div className="profit-report-actions">
            <select value={partyMonth} onChange={(event) => setPartyMonth(event.target.value)} style={filterInputStyle}>
              <option value="All">All Months</option>
              {MONTH_LABELS.map((label) => (<option key={label} value={label}>{label}</option>))}
            </select>
            <button onClick={exportPartyCSV} style={reportButtonStyle}>📥 Export CSV</button>
          </div>
        </div>
        <div className="responsive-table-wrapper">
          <table className="profit-table">
            <thead>
              <tr>
                <SortTh label="Business Name" active={pSort.key === "business"} dir={pSort.dir} onToggle={() => pSort.toggle("business")} />
                <SortTh label="Total Module Service" active={pSort.key === "repair"} dir={pSort.dir} onToggle={() => pSort.toggle("repair")} align="right" />
                <SortTh label="Total Warranty Service" active={pSort.key === "warranty"} dir={pSort.dir} onToggle={() => pSort.toggle("warranty")} align="right" />
                <SortTh label="Grand Total" active={pSort.key === "grand"} dir={pSort.dir} onToggle={() => pSort.toggle("grand")} align="right" />
                <SortTh label="Warranty Percentage" active={pSort.key === "warrantyPercent"} dir={pSort.dir} onToggle={() => pSort.toggle("warrantyPercent")} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}>Loading report...</td></tr>
              ) : sortedPartyRows.length === 0 ? (
                <tr><td colSpan={5}>Is financial year me koi module repair record nahi mila.</td></tr>
              ) : (
                <>
                  {sortedPartyRows.map((row, index) => (
                    <tr key={`${row.month}-${row.business}-${index}`}>
                      <td>{row.business}</td>
                      <td style={{ textAlign: "right" }}>{row.repair}</td>
                      <td style={{ textAlign: "right" }}>{row.warranty}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{row.grand}</td>
                      <td style={{ textAlign: "right" }}>{row.warrantyPercent.toFixed(2)}%</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{partyTotals.repair}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{partyTotals.warranty}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{partyGrand}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{partyWarrantyPercent.toFixed(2)}%</strong></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ProfitSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="profit-section"><div className="profit-section-heading"><div><h2>{title}</h2><span>{subtitle}</span></div></div>{children}</section>; }
function MetricCard({ title, value, subtitle, tone }: { title: string; value: string; subtitle: string; tone: string }) { return <div className={`profit-metric-card ${tone}`}><span>{title}</span><strong>{value}</strong><small>{subtitle}</small></div>; }
const reportButtonStyle: React.CSSProperties = { background: "#0284c7", color: "#fff", border: "none", padding: "9px 14px", borderRadius: 8, fontWeight: 700, cursor: "pointer" };
const filterInputStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff" };

export default NetProfitReport;
