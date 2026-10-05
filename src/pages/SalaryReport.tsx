import { sc } from "../lib/company";
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/formatDate";
import { currentFY } from "../lib/financialYear";
import { round2, workerShareAmount, money } from "../lib/amountSplit";

// -----------------------------------------------------------------------------
// Worker names aur unka Module Service % dono Technician Master (`technicians`
// table) se aate hain — is file me kuch hardcoded nahi hai. Naam badalna ho to
// Technician Master badal dein; % bhi wahan se hi padha jaata hai.
// -----------------------------------------------------------------------------

const CARD_COLORS = ["#2563eb", "#7c3aed", "#d97706", "#059669", "#db2777", "#0891b2", "#65a30d"];

type Worker = {
  id: number;
  name: string;
  percent: number;
  color: string;
};

const FALLBACK_MODULE_RATE = 50;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type JobCardRow = {
  id: number;
  job_no: string | null;
  job_date: string | null;
  customer_id: number | null;
  business_name: string | null;
  repairing_quantity: number | null;
  warranty_quantity: number | null;
  reject_quantity: number | null;
  status: string | null;
};

type ReportRow = {
  id: number;
  job_no: string;
  job_date: string;
  monthKey: string;
  businessName: string;
  repairingQty: number;
  billedQty: number;
  charge: number;
  billStatus: "Paid" | "Partial" | "Unbilled";
  /** Is job card par kitne workers tick the. */
  workerCount: number;
  /** worker id -> fixed % ka amount (chutti wale ka 0). */
  shares: Record<string, number>;
  /** Charge − workers ka total: shop ke paas bacha hua amount. */
  retained: number;
};

const monthKeyOf = (value: string) => String(value || "").slice(0, 7);

function SalaryReport() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [assignmentsMissing, setAssignmentsMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [showSplit, setShowSplit] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [jobRes, invRes, itemRes, priceRes, techRes, assignRes] = await Promise.all([
        sc("job_cards").select("*").order("id", { ascending: false }),
        sc("invoices").select("id, job_card_id"),
        sc("items").select("id, item_name, item_code, sale_price"),
        sc("customer_item_prices").select("*"),
        // Workers + unka fixed % — dono Technician Master se.
        sc("technicians").select("id, name, share_percent"),
        sc("job_card_technicians").select("job_card_id, technician_id"),
      ]);

      const jobRows = (jobRes.data || []) as JobCardRow[];

      // ---- Workers (Technician Master) ---------------------------------------
      const workerList: Worker[] = (techRes.data || [])
        .filter((t: any) => Number(t.share_percent || 0) > 0)
        .map((t: any, index: number) => ({
          id: Number(t.id),
          name: String(t.name || ""),
          percent: Number(t.share_percent || 0),
          color: CARD_COLORS[index % CARD_COLORS.length],
        }));
      setWorkers(workerList);

      // ---- Kaun kaun sa worker kis job card par tha --------------------------
      // Migration nahi chali hui ho to table nahi hogi — is case me salary nahi
      // dikhayenge, page chalti rahegi.
      const missingAssignments = !!assignRes.error;
      setAssignmentsMissing(missingAssignments);

      const techIds = new Set(workerList.map((w) => w.id));
      const assignedByJob = new Map<number, Set<number>>();
      if (!missingAssignments) {
        (assignRes.data || []).forEach((row: any) => {
          const jobId = Number(row.job_card_id);
          const techId = Number(row.technician_id);
          if (!jobId || !techIds.has(techId)) return;
          if (!assignedByJob.has(jobId)) assignedByJob.set(jobId, new Set());
          assignedByJob.get(jobId)!.add(techId);
        });
      }

      // ---- Module Service item lookup (exact name/code, then fuzzy) ----------
      // `items` live master hai; kuch jagah `item_master` bhi hota hai — dono me
      // se koi ek empty aaye to doosra try karo (Invoices.tsx waisa hi karta hai).
      let allItems = (itemRes.data || []) as any[];
      if (allItems.length === 0) {
        const fallbackItems = await sc("item_master").select("*");
        allItems = (fallbackItems.data || []) as any[];
      }
      const norm = (v: unknown) => String(v || "").trim().toLowerCase();
      const moduleServiceItem =
        allItems.find(
          (i: any) => norm(i.item_name) === "module service" || norm(i.item_code) === "sc0002"
        ) || allItems.find((i: any) => norm(i.item_name).includes("module service"));
      const masterRate = Number(moduleServiceItem?.sale_price) || FALLBACK_MODULE_RATE;

      // ---- Customer specific rate: customer_item_prices.agreed_rate ----------
      const priceByCustomer = new Map<string, number>();
      (priceRes.data || []).forEach((row: any) => {
        if (!moduleServiceItem) return;
        const matchesId =
          String(row.item_id) === String(moduleServiceItem.id) ||
          (moduleServiceItem.item_code && String(row.item_id) === String(moduleServiceItem.item_code));
        if (!matchesId) return;
        const rate = Number(row.agreed_rate);
        if (!Number.isNaN(rate) && rate >= 0) {
          priceByCustomer.set(String(row.customer_id), rate);
        }
      });

      // ---- Billed "JOB-REP" qty + actual charged amount per job card -------
      const jobIdByInvoice = new Map<number, number>();
      (invRes.data || []).forEach((inv: any) => {
        if (inv.job_card_id) jobIdByInvoice.set(Number(inv.id), Number(inv.job_card_id));
      });

      const billedQtyByJob = new Map<number, number>();
      const chargeByJob = new Map<number, number>();
      const { data: invoiceItems } = await sc("invoice_items")
        .select("invoice_id, inward_no, quantity, total, rate");

      (invoiceItems || []).forEach((it: any) => {
        if (String(it.inward_no || "") !== "JOB-REP") return;
        const jobId = jobIdByInvoice.get(Number(it.invoice_id));
        if (!jobId) return;
        const qty = Number(it.quantity || 0);
        billedQtyByJob.set(jobId, (billedQtyByJob.get(jobId) || 0) + qty);
        // Asli invoice amount hi source of truth — recompute na karein, kyunki
        // rate manually adjust bhi ho sakti hai invoice par.
        const charged = Number(it.total);
        const amount = Number.isFinite(charged) && charged !== 0 ? charged : Number(it.rate || 0) * qty;
        chargeByJob.set(jobId, (chargeByJob.get(jobId) || 0) + amount);
      });

      // ---- Build report rows ------------------------------------------------
      const reportRows: ReportRow[] = jobRows.map((job) => {
        const jobDate = String(job.job_date || "");
        const repairingQty = Number(job.repairing_quantity || 0);
        const billedQty = Number(billedQtyByJob.get(job.id) || 0);
        const customerRate = priceByCustomer.get(String(job.customer_id));
        const rate = customerRate ?? masterRate;

        // Charge sirf tab banta hai jab Module Service actually invoice hua ho.
        const invoiceCharge = Number(chargeByJob.get(job.id) || 0);
        const charge = invoiceCharge > 0 ? invoiceCharge : billedQty * rate;

        const billStatus: ReportRow["billStatus"] =
          billedQty <= 0 ? "Unbilled" : billedQty >= repairingQty ? "Paid" : "Partial";

        // ---- Fixed share: sirf tick hue workers ko, apne hi % par ----------
        // Chutti wale worker ko 0 milta hai aur baaki paisa kisi ko nahi jata —
        // koi renormalization nahi. Jo bacha waha shop ke paas rehta hai
        // (`retained`), isliye tables ka total hamesha charge se match karta hai.
        const assigned = assignedByJob.get(job.id) || new Set<number>();
        const shares: Record<string, number> = {};
        let distributed = 0;
        workerList.forEach((w) => {
          const amount = assigned.has(w.id) ? workerShareAmount(charge, w.percent) : 0;
          shares[String(w.id)] = amount;
          distributed += amount;
        });

        return {
          id: job.id,
          job_no: job.job_no || `JC-${job.id}`,
          job_date: jobDate,
          monthKey: monthKeyOf(jobDate),
          businessName: job.business_name || "—",
          repairingQty,
          billedQty,
          charge,
          billStatus,
          workerCount: assigned.size,
          shares,
          retained: round2(charge - distributed),
        };
      });

      setRows(reportRows);
    } catch (err) {
      console.error("Salary load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ---- Month dropdown: current FY + previous FY, newest first ---------------
  const monthOptions = useMemo(() => {
    const fy = currentFY();
    const opts: { key: string; label: string }[] = [];
    for (let back = 1; back >= 0; back--) {
      const startYear = fy.startYear - back;
      for (let i = 0; i < 12; i++) {
        const d = new Date(startYear, 3 + i, 1);
        opts.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
        });
      }
    }
    return opts.reverse();
  }, []);

  const filteredRows = useMemo(
    () => (selectedMonth === "all" ? rows : rows.filter((r) => r.monthKey === selectedMonth)),
    [rows, selectedMonth]
  );

  // ---- Worker totals — split per row phir sum, taaki rounding kaat na ho -----
  const workerTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    workers.forEach((w) => {
      totals[String(w.id)] = filteredRows.reduce((sum, r) => sum + Number(r.shares[String(w.id)] || 0), 0);
    });
    return totals;
  }, [filteredRows, workers]);

  const grandTotal = useMemo(
    () => filteredRows.reduce((sum, r) => sum + r.charge, 0),
    [filteredRows]
  );

  // Charge me se jo paisa kisi worker ko nahi gaya — chutti / untick / no-share.
  const retainedTotal = useMemo(
    () => filteredRows.reduce((sum, r) => sum + Number(r.retained || 0), 0),
    [filteredRows]
  );

  const columnTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        repairingQty: acc.repairingQty + r.repairingQty,
        billedQty: acc.billedQty + r.billedQty,
        charge: acc.charge + r.charge,
      }),
      { repairingQty: 0, billedQty: 0, charge: 0 }
    );
  }, [filteredRows]);

  const totalModules = useMemo(
    () => filteredRows.reduce((sum, r) => sum + r.billedQty, 0),
    [filteredRows]
  );

  const exportCSV = () => {
    if (!filteredRows.length) {
      alert("कोई data नहीं है!");
      return;
    }
    const headers = [
      "Job Card Number", "Job Card Date", "Business Name", "Repairing Module",
      "Billed Module", "Module Service Charge", "Status", "Technicians Assigned",
      "Shop Retained (Unassigned)",
      ...(showSplit ? workers.map((w) => `${w.name} (${w.percent}%)`) : []),
    ];
    const body = filteredRows.map((r) => [
      `"${r.job_no}"`, `"${fmtDate(r.job_date)}"`, `"${r.businessName}"`,
      r.repairingQty, r.billedQty, r.charge.toFixed(2), `"${r.billStatus}"`, r.workerCount,
      r.retained.toFixed(2),
      ...(showSplit ? workers.map((w) => Number(r.shares[String(w.id)] || 0).toFixed(2)) : []),
    ]);
    const csv = "data:text/csv;charset=utf-8," +
      [headers.join(","), ...body.map((line) => line.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Worker_Salary_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ width: "100%", paddingBottom: 40 }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          gap: 16, flexWrap: "wrap", marginBottom: 22,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Worker Salary Report
          </h1>
          <p style={{ color: "#64748b", margin: "5px 0 0", fontSize: 13.5 }}>
            Module Service charge ka worker-wise split — job card ke hisaab se, sirf billed modules par.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>Month:</span>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={selectStyle}>
              <option value="all">All Month</option>
              {monthOptions.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>

          <button onClick={exportCSV} style={outlineBtn}>
            ⬇️ Export
          </button>
          <button onClick={() => window.print()} style={outlineBtn}>
            🖨️ Print
          </button>
          <button onClick={loadData} style={primaryBtn}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* WORKER SHARE CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {workers.map((w) => {
          const earned = Number(workerTotals[String(w.id)] || 0);
          const shareOfPool = grandTotal > 0 ? (earned / grandTotal) * 100 : 0;
          return (
            <div
              key={w.id}
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "1px solid #e2e8f0",
                borderTop: `3px solid ${w.color}`,
                padding: "16px 18px 14px",
                boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: ".05em", textTransform: "uppercase" }}>
                  {w.name}
                </span>
                <span
                  style={{
                    background: `${w.color}1a`, color: w.color, padding: "3px 10px", borderRadius: 20,
                    fontSize: 12, fontWeight: 800,
                  }}
                >
                  {w.percent}%
                </span>
              </div>

              <strong style={{ display: "block", fontSize: 23, color: "#0f172a", marginTop: 10, letterSpacing: "-.01em" }}>
                {money(earned)}
              </strong>

              <div style={{ height: 6, background: "#f1f5f9", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, Math.max(0, shareOfPool))}%`, height: "100%", background: w.color }} />
              </div>
              <small style={{ display: "block", color: "#94a3b8", fontSize: 11, marginTop: 7 }}>
                Fixed {w.percent}% share · {totalModules} billed modules
              </small>
            </div>
          );
        })}
      </div>

      {/* POOL SUMMARY STRIP */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 14, background: "#0f172a", color: "#fff",
          padding: "14px 20px", borderRadius: 12, marginBottom: 18,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.85, letterSpacing: ".03em" }}>
          TOTAL MODULE SERVICE POOL{selectedMonth !== "all" ? ` — ${monthOptions.find((m) => m.key === selectedMonth)?.label}` : " — ALL MONTHS"}
        </span>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>Job Cards <strong style={{ color: "#fff", fontSize: 15 }}>{filteredRows.length}</strong></span>
          <span style={{ fontSize: 13, opacity: 0.8 }}>Billed Modules <strong style={{ color: "#fff", fontSize: 15 }}>{totalModules}</strong></span>
          <span style={{ fontSize: 13, opacity: 0.8 }}>Shop Retained (chutti/unassigned) <strong style={{ color: "#fbbf24", fontSize: 15 }}>{money(retainedTotal)}</strong></span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#4ade80" }}>{money(grandTotal)}</span>
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0",
          overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <div
          style={{
            padding: "13px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>Job Card Wise Earning Detail</span>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#475569", fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={showSplit} onChange={(e) => setShowSplit(e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer" }} />
            Show worker split columns
          </label>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ ...thStyle, width: 60 }}>Sr</th>
                <th style={thStyle}>Job Card Number</th>
                <th style={thStyle}>Job Card Date</th>
                <th style={thStyle}>Business Name</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Repairing Module</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Billed</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Module Service Charge</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Technicians Assigned</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Shop Retained</th>
                {showSplit && workers.map((w) => (
                  <th key={w.id} style={{ ...thStyle, textAlign: "right", color: w.color }}>{w.name}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10 + (showSplit ? workers.length : 0)} style={{ textAlign: "center", padding: 44, color: "#64748b" }}>
                    Loading salary report...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10 + (showSplit ? workers.length : 0)} style={{ textAlign: "center", padding: 44, color: "#64748b" }}>
                    इस महीने कोई job card नहीं मिला।
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, idx) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13, background: r.charge > 0 ? "#fff" : "#fcfcf" }}>
                    <td style={{ ...tdStyle, color: "#94a3b8", fontWeight: 600 }}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <strong style={{ color: "#2563eb" }}>{r.job_no}</strong>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: "#334155" }}>{fmtDate(r.job_date)}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>{r.businessName}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{r.repairingQty}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: r.billedQty > 0 ? "#16a34a" : "#cbd5e1" }}>{r.billedQty}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                      {r.charge > 0 ? money(r.charge) : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span style={statusBadge(r.billStatus)}>{r.billStatus}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, color: r.workerCount > 0 ? "#334155" : "#dc2626" }}>
                      {r.workerCount > 0 ? `${r.workerCount} worker${r.workerCount > 1 ? "s" : ""}` : "None"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: r.retained > 0 ? "#b45309" : "#cbd5e1" }}>
                      {r.retained > 0 ? money(r.retained) : "—"}
                    </td>
                    {showSplit && workers.map((w) => (
                      <td key={w.id} style={{ ...tdStyle, textAlign: "right", color: r.charge > 0 ? "#334155" : "#cbd5e1", fontWeight: 600 }}>
                        {r.charge > 0 ? money(Number(r.shares[String(w.id)] || 0)) : "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>

            {filteredRows.length > 0 && (
              <tfoot>
                <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", fontWeight: 800 }}>
                  <td style={{ ...tdStyle, color: "#64748b" }} colSpan={3}>TOTAL ({filteredRows.length} job cards)</td>
                  <td style={tdStyle} />
                  <td style={{ ...tdStyle, textAlign: "right", color: "#0f172a" }}>{columnTotals.repairingQty}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#16a34a" }}>{columnTotals.billedQty}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#0f172a" }}>{money(columnTotals.charge)}</td>
                  <td />
                  <td />
                  <td style={{ ...tdStyle, textAlign: "right", color: "#b45309" }}>{money(retainedTotal)}</td>
                  {showSplit && workers.map((w) => (
                    <td key={w.id} style={{ ...tdStyle, textAlign: "right", color: w.color }}>
                      {money(Number(workerTotals[String(w.id)] || 0))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {assignmentsMissing && (
        <div
          style={{
            marginTop: 14, padding: "13px 16px", borderRadius: 10,
            background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
            fontSize: 12.5, lineHeight: 1.7,
          }}
        >
          <strong>Database migration pending:</strong> Salary tabhi dikhega jab <code>supabase/job-card-technicians-migration.sql</code> Supabase me chala ho.
          Abhi worker assignment table nahi mil rahi, isliye worker cards khali hain.
        </div>
      )}

      {workers.length === 0 && !loading && !assignmentsMissing && (
        <div
          style={{
            marginTop: 14, padding: "13px 16px", borderRadius: 10,
            background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e",
            fontSize: 12.5, lineHeight: 1.7,
          }}
        >
          <strong>Koi worker share nahi:</strong> Technician Master me kisi technician ka <em>Module Service Share %</em> 0 se
          zyada nahi hai. Salary report workers tabhi dikhata hai jinka % set ho.
        </div>
      )}

      <p style={{ color: "#94a3b8", fontSize: 11.5, marginTop: 14, lineHeight: 1.7 }}>
        Note: Earning sirf un modules par banti hai jinka <strong>Module Service</strong> invoice ban chuka hai (Billed column).
        Warranty / Reject modules aur abhi tak invoice na hue job cards yahan ₹0 dikhate hain — unhone kaam kiya ho to
        billing complete karke uska earning yahan aayega. Har worker ko <strong>Technician Master wala apna fixed %</strong> milta
        hai — job card par tick na hone (chutti) par uska 0 hota hai aur baqi paisa kisi ko nahi jaata; wo
        <strong> Shop Retained</strong> column me dikhaya jaata hai.
      </p>
    </div>
  );
}

const statusBadge = (status: ReportRow["billStatus"]): React.CSSProperties => {
  const map = {
    Paid: { bg: "#dcfce7", fg: "#166534" },
    Partial: { bg: "#fef3c7", fg: "#92400e" },
    Unbilled: { bg: "#f1f5f9", fg: "#64748b" },
  } as const;
  const tone = map[status];
  return {
    background: tone.bg, color: tone.fg, padding: "4px 11px", borderRadius: 20,
    fontSize: 11, fontWeight: 800, display: "inline-block",
  };
};

const thStyle: React.CSSProperties = {
  padding: "12px 14px", fontSize: 11, fontWeight: 800, textTransform: "uppercase",
  color: "#64748b", letterSpacing: ".03em", whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = { padding: "12px 14px", color: "#334155" };

const selectStyle: React.CSSProperties = {
  padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8,
  fontSize: 13, outline: "none", background: "#fff", minWidth: 150,
};

const outlineBtn: React.CSSProperties = {
  background: "#fff", color: "#334155", border: "1px solid #cbd5e1", padding: "9px 15px",
  borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "#0f172a", color: "#fff", border: "none", padding: "9px 16px",
  borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
};

export default SalaryReport;