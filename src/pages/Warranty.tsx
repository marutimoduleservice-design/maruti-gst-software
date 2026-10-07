import { sc } from "../lib/company";
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";

/**
 * Warranty Return tracking.
 *
 * Workflow: Job card par `warranty_quantity` se pata chalta hai kitne modules
 * warranty me aaye. Har module ki ek row banati hai — kyunki module par likhi
 * hui date har module ki alag hoti hai, isliye Working Day bhi alag hota hai.
 *
 * Warranty Module Date manually daali jaati hai (module par likhi date padh kar),
 * aur Working Day = Warranty Module Date − Job Card Date khud calculate hota hai.
 */

/** Sirf yehi 3 values database me allow hain (SQL check constraint ke saath). */
const REASONS = [
  "A - Module Check And OK",
  "B - Customer Side Problem / Damage",
  "C - Our Side Problem",
] as const;

type Reason = (typeof REASONS)[number];

type WarrantyReturn = {
  id: number;
  job_card_id: number;
  job_no: string;
  job_date: string;
  customer_name: string | null;
  warranty_module_date: string;
  working_days: number;
  return_reason: Reason;
  remark: string | null;
  created_at?: string;
};

type JobCardOption = {
  id: number;
  job_no: string | null;
  job_date: string | null;
  business_name: string | null;
  warranty_quantity: number | null;
};

type FormState = {
  id?: number;
  job_card_id: string;
  warranty_module_date: string;
  return_reason: Reason;
  remark: string;
};

/** Bulk entry grid me ek row = ek module. */
type BulkRow = {
  date: string;
  reason: Reason;
  remark: string;
};

const emptyBulkRow = (): BulkRow => ({
  date: "",
  reason: REASONS[0],
  remark: "",
});

const REASON_TONE: Record<string, { bg: string; fg: string }> = {
  "A - Module Check And OK": { bg: "#dcfce7", fg: "#166534" },
  "B - Customer Side Problem / Damage": { bg: "#fef3c7", fg: "#92400e" },
  "C - Our Side Problem": { bg: "#fee2e2", fg: "#991b1b" },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Do `YYYY-MM-DD` dates ke beech ke poore din.
 *
 * `new Date("2026-04-01")` browser ki timezone me shift ho jaata hai, isliye
 * dono ko UTC midnight par parse karte hain — warna 1 din ka hisaab galat aa
 * sakta hai (jaise 1 Apr → 30 Mar = 2 din dikha deta hai).
 */
const daysBetween = (fromDate: string, toDate: string): number => {
  const from = Date.parse(`${String(fromDate || "").slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(toDate || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
};

function Warranty() {
  const [rows, setRows] = useState<WarrantyReturn[]>([]);
  const [jobCards, setJobCards] = useState<JobCardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>({
    job_card_id: "",
    warranty_module_date: todayStr(),
    return_reason: REASONS[0],
    remark: "",
  });
  const [saving, setSaving] = useState(false);

  // Bulk entry modal (ek job card ke saare modules ek saath)
  const [showBulk, setShowBulk] = useState(false);
  const [bulkJobId, setBulkJobId] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([emptyBulkRow()]);

  // Default OFF: jis job card ki entry ban chuki hai wo dropdown me nahi aata.
  // Partial job card (jaise 2/5) me baaki modules ki entry karne ke liye isko
  // ON karna padega.
  const [showCompletedJobCards, setShowCompletedJobCards] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // Warranty wale job cards hi chahiye — baaki koi warranty return
      // nahi ban sakta.
      const [jobRes, retRes] = await Promise.all([
        sc("job_cards")
          .select("id, job_no, job_date, business_name, warranty_quantity")
          .gt("warranty_quantity", 0)
          .order("id", { ascending: false }),
        sc("warranty_returns").select("*").order("id", { ascending: false }),
      ]);

      if (jobRes.error) {
        console.error(jobRes.error);
        setJobCards([]);
      } else {
        setJobCards((jobRes.data || []) as JobCardOption[]);
      }

      if (retRes.error) {
        // Table nahi hai -> migration chahiye. Page crash na kare, message dikhao.
        console.warn("warranty_returns load nahi hua:", retRes.error.message);
        setRows([]);
        setSchemaError(retRes.error.message);
      } else {
        setRows((retRes.data || []) as WarrantyReturn[]);
        setSchemaError("");
      }
    } catch (err) {
      console.error("Warranty load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ---- Har job card par kitni entry ban chuki hai -----------------------------
  const loggedByJob = useMemo(() => {
    const map: Record<number, number> = {};
    rows.forEach((r) => {
      map[r.job_card_id] = (map[r.job_card_id] || 0) + 1;
    });
    return map;
  }, [rows]);

  /**
   * Wo job cards jinki abhi bhi koi warranty module entry baaki hai.
   *
   * Ek job card ke sab modules ki entry ho jaane (jaise 12/12) ke baad hi wo
   * dropdown se hat jata hai. Tab tak dikhta rehta hai, kyunki baaki modules ki
   * entry abhi bani hai — har module ki apni row banti hai (11 modules = 11 rows).
   */
  const pendingJobCards = useMemo(
    () => jobCards.filter((j) => (loggedByJob[j.id] || 0) < (Number(j.warranty_quantity) || 0)),
    [jobCards, loggedByJob]
  );

  const availableJobCards = showCompletedJobCards ? jobCards : pendingJobCards;

  // Dropdown se kitne job cards hataye gaye (user ko visibility dene ke liye).
  const hiddenJobCards = jobCards.length - pendingJobCards.length;

  // Warranty qty total vs logged vs baaki — KPI cards ke liye.
  const stats = useMemo(() => {
    const totalQty = jobCards.reduce((s, j) => s + (Number(j.warranty_quantity) || 0), 0);
    const logged = rows.length;
    const pending = Math.max(0, totalQty - logged);
    const avgDays = logged
      ? Math.round((rows.reduce((s, r) => s + (Number(r.working_days) || 0), 0) / logged) * 10) / 10
      : 0;
    const ourSide = rows.filter((r) => r.return_reason === "C - Our Side Problem").length;
    const customerSide = rows.filter((r) => r.return_reason === "B - Customer Side Problem / Damage").length;
    return { totalQty, logged, pending, avgDays, ourSide, customerSide };
  }, [jobCards, rows]);

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        !q ||
        String(r.job_no || "").toLowerCase().includes(q) ||
        String(r.customer_name || "").toLowerCase().includes(q) ||
        String(r.remark || "").toLowerCase().includes(q);

      const matchesReason = reasonFilter === "All" || r.return_reason === reasonFilter;
      const date = String(r.warranty_module_date || "").slice(0, 10);
      const matchesFrom = !fromDate || date >= fromDate;
      const matchesTo = !toDate || date <= toDate;

      return matchesSearch && matchesReason && matchesFrom && matchesTo;
    });
  }, [rows, search, reasonFilter, fromDate, toDate]);

  const sortCols = {
    job_no: (r: WarrantyReturn) => String(r.job_no || ""),
    job_date: (r: WarrantyReturn) => String(r.job_date || ""),
    warranty_module_date: (r: WarrantyReturn) => String(r.warranty_module_date || ""),
    working_days: (r: WarrantyReturn) => Number(r.working_days || 0),
    return_reason: (r: WarrantyReturn) => String(r.return_reason || ""),
    remark: (r: WarrantyReturn) => String(r.remark || ""),
  };
  const { sort, sorted } = useSortedRows(filteredData, sortCols, "warranty_module_date", "desc");

  // ---- Form ke liye selected job card ---------------------------------------
  const selectedJob = availableJobCards.find((j) => String(j.id) === form.job_card_id) || null;
  const bulkJob = availableJobCards.find((j) => String(j.id) === bulkJobId) || null;
  const bulkFilled = bulkRows.filter((r) => r.date).length;
  const blankLines = bulkRows.length - bulkFilled;

  // Module date aur job card date ke beech ka live difference — user ko entry ke
  // waqt hi dikhta rahega, save karne ki zaroorat nahi.
  const liveWorkingDays = useMemo(() => {
    if (!selectedJob?.job_date || !form.warranty_module_date) return 0;
    return daysBetween(String(selectedJob.job_date), form.warranty_module_date);
  }, [selectedJob, form.warranty_module_date]);

  const openEditModal = (row: WarrantyReturn) => {
    setForm({
      id: row.id,
      job_card_id: String(row.job_card_id),
      warranty_module_date: String(row.warranty_module_date || "").slice(0, 10),
      return_reason: row.return_reason,
      remark: row.remark || "",
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedJob) {
      alert("Please select a Job Card.");
      return;
    }
    if (!form.warranty_module_date) {
      alert("Warranty Module Date daalein (module par likhi hui date).");
      return;
    }
    // Note: Warranty Module Date Job Card Date se PEHLE ki bhi ho sakti hai —
    // purane repair kiye module warranty me wapas aate hain, to module par
    // likhi date (back date) hamesha nayi job card date se purani hoti hai.
    // Isliye negative Working Day ko block nahi kiya jaata.

    // Job card ke wahan ke purane count se pata lagao ki ek nayi entry ban rahi
    // hai ya edit. Warranty qty se zyada entry na ho jaaye.
    const alreadyLogged = loggedByJob[selectedJob.id] || 0;
    if (!form.id && alreadyLogged >= (Number(selectedJob.warranty_quantity) || 0)) {
      const proceed = confirm(
        `${selectedJob.job_no} par warranty quantity ${selectedJob.warranty_quantity} hai aur ${alreadyLogged} entries ban chuki hain.\n\nAap ek aur entry de rahe hain — kya jaan bujh kar karna hai?`
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const payload = {
        job_card_id: selectedJob.id,
        // Snapshot fields: job card ka data chhin lena, taaki baad me job card
        // edit ya delete ho par bhi purana warranty record sahi dikhe.
        job_no: selectedJob.job_no || `JC-${selectedJob.id}`,
        job_date: String(selectedJob.job_date || "").slice(0, 10),
        customer_name: selectedJob.business_name || null,
        warranty_module_date: form.warranty_module_date,
        // Back date (module date job card se pehle) ho to bhi din positive
        // store hote hain — minus sign user ko nahi chahiye.
        working_days: Math.abs(liveWorkingDays),
        return_reason: form.return_reason,
        remark: form.remark.trim() || null,
      };

      if (form.id) {
        const { error } = await sc("warranty_returns").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await sc("warranty_returns").insert([payload]);
        if (error) throw error;
      }

      setShowModal(false);
      await loadData();
    } catch (err: any) {
      console.error(err);
      alert(`Warranty entry save nahi hui: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: WarrantyReturn) => {
    const ok = confirm(
      `${row.job_no} — ${fmtDate(row.warranty_module_date)} ki warranty entry delete karein?`
    );
    if (!ok) return;

    const { error } = await sc("warranty_returns").delete().eq("id", row.id);
    if (error) {
      alert(`Delete nahi hua: ${error.message}`);
      return;
    }
    await loadData();
  };

  const openBulkModal = () => {
    setBulkJobId("");
    setBulkRows([emptyBulkRow()]);
    setShowBulk(true);
  };

  /**
   * Bulk save: ek hi job card ke kai modules ek saath.
   *
   * Sirf un rows ko save karta hai jisme date bhari hai — isliye 11 modules
   * me se sirf 3 aaye hon to 3 line bhar kar baaki chhod dein, save ho jayega.
   * Saari rows ek hi INSERT me jaati hain, isliye ya sab save hota hai ya kuch
   * nahi (aadha data nahi bachega).
   */
  const handleBulkSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const job = availableJobCards.find((j) => String(j.id) === bulkJobId);
    if (!job) {
      alert("Please select a Job Card.");
      return;
    }

    const filled = bulkRows.filter((r) => r.date);
    if (filled.length === 0) {
      alert("Kam se kam ek module ki Warranty Module Date bhar dein.");
      return;
    }

    // Purane module ki back date job card se pehle ki ho sakti hai — wo valid
    // hai, isliye yahan koi date-wise block nahi hai (Working Day negative aayega).

    const remaining = (Number(job.warranty_quantity) || 0) - (loggedByJob[job.id] || 0);
    if (filled.length > remaining) {
      const ok = confirm(
        `${job.job_no} par warranty quantity ${job.warranty_quantity} hai, ${loggedByJob[job.id] || 0} entries pehle se hain.\n\nAap ${filled.length} aur entries bana rahe hain (baaki ${remaining}).\n\nJaari rakhein?`
      );
      if (!ok) return;
    }

    // Khaali lines chup-chaap skip ho jaati hain — isi se galti se adhoori entry
    // ban jaati thi. Isliye pehle bata do ki exactly kitni line save hogi.
    const blankCount = bulkRows.length - filled.length;
    if (blankCount > 0) {
      const ok = confirm(
        `${bulkRows.length} line me se sirf ${filled.length} me Warranty Module Date bhari hai.\n\n${blankCount} khaali line IGNORE ho jayengi — un modules ki entry nahi banegi.\n\nAage badhein? (Cancel karne par bhi date bhari lines save ho jayengi, kyunki wo ${filled.length} modules ki entry hain)`
      );
      if (!ok) return;
    }

    const payload = filled.map((r) => {
      const days = daysBetween(String(job.job_date || ""), r.date);
      return {
        job_card_id: job.id,
        job_no: job.job_no || `JC-${job.id}`,
        job_date: String(job.job_date || "").slice(0, 10),
        customer_name: job.business_name || null,
        warranty_module_date: r.date,
        working_days: Math.abs(days),
        return_reason: r.reason,
        remark: r.remark.trim() || null,
      };
    });

    setSaving(true);
    try {
      const { error } = await sc("warranty_returns").insert(payload);
      if (error) throw error;
      setShowBulk(false);
      await loadData();
    } catch (err: any) {
      console.error(err);
      alert(`Bulk entry save nahi hui: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const exportToCSV = () => {
    if (sorted.length === 0) {
      alert("Export ke liye koi entry nahi hai.");
      return;
    }

    const headers = [
      "Job Card Number",
      "Job Card Date",
      "Customer",
      "Warranty Module Date",
      "Working Day",
      "Reason for Return",
      "Remark",
    ];
    const body = sorted.map((r) => [
      `"${String(r.job_no || "").replace(/"/g, '""')}"`,
      `"${String(r.job_date || "").slice(0, 10)}"`,
      `"${String(r.customer_name || "").replace(/"/g, '""')}"`,
      `"${String(r.warranty_module_date || "").slice(0, 10)}"`,
      r.working_days,
      `"${r.return_reason}"`,
      `"${String(r.remark || "").replace(/"/g, '""')}"`,
    ]);

    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...body.map((l) => l.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Warranty_Returns_${todayStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ width: "100%", paddingBottom: 40 }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Warranty Return Tracking
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13.5 }}>
            Warranty me wapas aaye module — ek entry per module. Warranty Module Date module par likhi hui date se
            daalein, Working Day khud calculate ho jayega.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={openBulkModal} style={primaryBtn}>
            + Warranty Entry
          </button>
          <button onClick={exportToCSV} style={outlineBtn}>
            ⬇️ Export
          </button>
          <button onClick={() => window.print()} style={outlineBtn}>
            🖨️ Print
          </button>
          <button onClick={loadData} style={outlineBtn}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {schemaError && (
        <div
          style={{
            marginBottom: 16,
            padding: "13px 16px",
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 12.5,
            lineHeight: 1.7,
          }}
        >
          <strong>Database migration pending:</strong> Warranty entry save nahi ho rahi.{" "}
          <code>supabase/warranty-returns-migration.sql</code> Supabase ke SQL Editor me chalayein, phir page
          refresh karein. ({schemaError})
        </div>
      )}

      {/* KPI CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <StatCard
          title="Warranty Modules (Job Card)"
          value={stats.totalQty}
          subtitle="Job cards se total warranty qty"
          bg="#eff6ff"
          fg="#1e40af"
        />
        <StatCard
          title="Entry Ban Chuki"
          value={stats.logged}
          subtitle="Yahan record ki gayi"
          bg="#ecfdf5"
          fg="#166534"
        />
        <StatCard
          title="Baaki Modules"
          value={stats.pending}
          subtitle="Entry abhi nahi bani"
          bg="#fffbeb"
          fg="#92400e"
        />
        <StatCard
          title="Avg Working Day"
          value={stats.avgDays}
          subtitle="Module date − job card date"
          bg="#f5f3ff"
          fg="#5b21b6"
        />
        <StatCard
          title="Our Side Problem"
          value={stats.ourSide}
          subtitle="Reason C"
          bg="#fee2e2"
          fg="#991b1b"
        />
      </div>

      {/* FILTERS */}
      <div style={filterBar}>
        <input
          type="text"
          placeholder="Search Job Card No, Customer, Remark..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...filterInput, minWidth: 280 }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} style={filterInput}>
            <option value="All">All Reasons</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={filterLabel}>Module Date From:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={filterInput} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={filterLabel}>To:</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={filterInput} />
          </div>

          {(search || fromDate || toDate || reasonFilter !== "All") && (
            <button
              onClick={() => {
                setSearch("");
                setFromDate("");
                setToDate("");
                setReasonFilter("All");
              }}
              style={resetBtn}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div style={cardStyle}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <SortTh label="Job Card Number" active={sort.key === "job_no"} dir={sort.dir} onToggle={() => sort.toggle("job_no")} style={thStyle} />
                <SortTh label="Job Card Date" active={sort.key === "job_date"} dir={sort.dir} onToggle={() => sort.toggle("job_date")} style={thStyle} />
                <SortTh label="Warranty Module Date" active={sort.key === "warranty_module_date"} dir={sort.dir} onToggle={() => sort.toggle("warranty_module_date")} style={thStyle} />
                <SortTh label="Working Day" active={sort.key === "working_days"} dir={sort.dir} onToggle={() => sort.toggle("working_days")} style={{ ...thStyle, textAlign: "center" }} align="center" />
                <SortTh label="Reason for Return" active={sort.key === "return_reason"} dir={sort.dir} onToggle={() => sort.toggle("return_reason")} style={thStyle} />
                <SortTh label="Remark" active={sort.key === "remark"} dir={sort.dir} onToggle={() => sort.toggle("remark")} style={thStyle} />
                <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading warranty entries...
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Abhi tak koi warranty entry nahi bani. Job card se warranty module aate hi{" "}
                    <strong>+ Warranty Entry</strong> se entry kar dein.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => {
                  const tone = REASON_TONE[r.return_reason] || { bg: "#f1f5f9", fg: "#475569" };
                  const days = Number(r.working_days || 0);

                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                      <td style={tdStyle}>
                        <strong style={{ color: "#2563eb" }}>{r.job_no}</strong>
                        {r.customer_name && (
                          <small style={{ display: "block", color: "#64748b", fontWeight: 500 }}>
                            {r.customer_name}
                          </small>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#334155" }}>{fmtDate(r.job_date)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#0f172a" }}>
                        {fmtDate(r.warranty_module_date)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span
                          style={{
                            background: days < 0 ? "#f1f5f9" : days <= 7 ? "#dcfce7" : days <= 30 ? "#fef3c7" : "#fee2e2",
                            color: days < 0 ? "#475569" : days <= 7 ? "#166534" : days <= 30 ? "#92400e" : "#991b1b",
                            padding: "4px 11px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 800,
                            display: "inline-block",
                            minWidth: 46,
                          }}
                        >
                          {Math.abs(days)} {Math.abs(days) === 1 ? "day" : "days"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            background: tone.bg,
                            color: tone.fg,
                            padding: "5px 11px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            display: "inline-block",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.return_reason}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 280, color: "#1e293b" }}>
                        {r.remark || <span style={{ color: "#cbd5e1" }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                        <button onClick={() => openEditModal(r)} style={editBtn}>
                          ✏ Edit
                        </button>
                        <button onClick={() => handleDelete(r)} style={deleteBtn}>
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PENDING MODULE LIST — kis job card par kitne modules baaki hain */}
      <PendingModules jobCards={jobCards} loggedByJob={loggedByJob} />

      <p style={{ color: "#94a3b8", fontSize: 11.5, marginTop: 14, lineHeight: 1.7 }}>
        Note: Warranty Module Date wo date hai jo module ke upar likhi hoti hai — isiliye ye manually daali jaati hai.
        <strong> Working Day</strong> = Warranty Module Date − Job Card Date (hamesha positive dikhta hai).
        Grey chip ka matlab hai module par pehle repair ki date likhi hai aur wo warranty me baad me aaya —
        isliye date job card se purani (back date) hai; aisi entry bhi bilkul sahi save hoti hai. Reason <em>A</em> ka matlab hai module
        check karne par sab theek mila (warranty nahi, customer ne change/swap kar diya), <em>B</em> ka matlab
        customer side se damage hua, aur <em>C</em> ka matlab humari taraf se problem hai.
      </p>

      {/* BULK ENTRY MODAL — ek job card ke saare modules ek saath */}
      {showBulk && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 980 }}>
            <div style={modalHeader}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Warranty Entry</h3>
                <small style={{ color: "#94a3b8", fontSize: 12 }}>
                  Har module ki alag line. Warranty Module Date module par likhi hui date — Working Day khud ban jayega.
                </small>
              </div>
              <button onClick={() => setShowBulk(false)} style={closeBtn}>
                ✕
              </button>
            </div>

            <form onSubmit={handleBulkSave} style={{ padding: 22 }}>
              {/* JOB CARD */}
              <div style={jobCardBox}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
                >
                  <label style={{ ...labelStyle, color: "#2563eb" }}>Select Job Card (Warranty) *</label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showCompletedJobCards}
                      onChange={(e) => setShowCompletedJobCards(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    Jahan entry poori ho gayi hai wo bhi dikhao
                  </label>
                </div>
                <select
                  value={bulkJobId}
                  onChange={(e) => {
                    setBulkJobId(e.target.value);
                    // Job card change karte hi rows ki sankhya baki modules ke
                    // barabar kar dete hain (kam se kam 1).
                    const job = availableJobCards.find((j) => String(j.id) === e.target.value);
                    if (!job) {
                      setBulkRows([emptyBulkRow()]);
                      return;
                    }
                    const remaining = Math.max(1, (Number(job.warranty_quantity) || 0) - (loggedByJob[job.id] || 0));
                    setBulkRows(Array.from({ length: remaining }, emptyBulkRow));
                  }}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                >
                  <option value="">-- Choose Job Card --</option>
                  {availableJobCards.map((j) => {
                    const logged = loggedByJob[j.id] || 0;
                    const qty = Number(j.warranty_quantity) || 0;
                    return (
                      <option key={j.id} value={j.id}>
                        {j.job_no} — {j.business_name || "Customer"} · Warranty {qty} ({logged} logged,{" "}
                        {Math.max(0, qty - logged)} baaki)
                      </option>
                    );
                  })}
                </select>
                {pendingJobCards.length === 0 && !showCompletedJobCards && (
                  <small style={{ color: "#b91c1c", fontSize: 12, display: "block", marginTop: 6 }}>
                    Saari warranty entry complete ho gayi
                    {hiddenJobCards > 0
                      ? ` — ${hiddenJobCards} job card ke sab modules ki entry ban chuki hai. Upar wala checkbox on karke completed job cards dekh sakte hain.`
                      : " — abhi kisi job card par warranty quantity nahi hai."}
                  </small>
                )}
              </div>

              {bulkJob && (
                <div style={summaryStrip}>
                  <div>
                    <span style={summaryLabel}>Job Card Date</span>
                    <strong style={summaryValue}>{fmtDate(String(bulkJob.job_date || ""))}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Warranty Qty</span>
                    <strong style={summaryValue}>{Number(bulkJob.warranty_quantity) || 0}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Baaki</span>
                    <strong style={summaryValue}>
                      {Math.max(0, (Number(bulkJob.warranty_quantity) || 0) - (loggedByJob[bulkJob.id] || 0))}
                    </strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Line Bhari</span>
                    <strong style={summaryValue}>{bulkRows.filter((r) => r.date).length}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Customer</span>
                    <strong style={summaryValue}>{bulkJob.business_name || "—"}</strong>
                  </div>
                </div>
              )}

              {/* GRID */}
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => setBulkRows([...bulkRows, emptyBulkRow()])} style={smallBtn}>
                  + Line Add
                </button>
                {bulkRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBulkRows(bulkRows.slice(0, bulkRows.length - 1))}
                    style={smallBtn}
                  >
                    − Last Line Hatao
                  </button>
                )}
                {bulkJob && (
                  <button
                    type="button"
                    onClick={() => {
                      const jobDate = String(bulkJob.job_date || "").slice(0, 10);
                      const remaining = Math.max(
                        0,
                        (Number(bulkJob.warranty_quantity) || 0) - (loggedByJob[bulkJob.id] || 0)
                      );
                      setBulkRows(
                        Array.from({ length: Math.max(1, remaining) }, () => ({
                          date: jobDate,
                          reason: REASONS[0],
                          remark: "",
                        }))
                      );
                    }}
                    style={smallBtn}
                  >
                    ↻ Sabhi lines ki date = Job Card Date
                  </button>
                )}
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ ...thStyle, width: 44, textAlign: "center" }}>Line</th>
                        <th style={{ ...thStyle, width: 170 }}>Warranty Module Date</th>
                        <th style={{ ...thStyle, width: 105, textAlign: "center" }}>Working Day</th>
                        <th style={{ ...thStyle, width: 250 }}>Reason for Return</th>
                        <th style={thStyle}>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, idx) => {
                        const days =
                          bulkJob && row.date ? daysBetween(String(bulkJob.job_date || ""), row.date) : null;

                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                            <td style={{ ...tdStyle, textAlign: "center", fontWeight: 800, color: "#94a3b8" }}>
                              {idx + 1}
                            </td>
                            <td style={tdStyle}>
                              <input
                                type="date"
                                value={row.date}
                                onChange={(e) => {
                                  const next = [...bulkRows];
                                  next[idx] = { ...row, date: e.target.value };
                                  setBulkRows(next);
                                }}
                                style={{
                                  ...inputStyle,
                                  marginTop: 0,
                                }}
                              />
                            </td>
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              {days === null ? (
                                <span style={{ color: "#cbd5e1" }}>—</span>
                              ) : (
                                <span
                                  style={{
                                    background: days < 0 ? "#f1f5f9" : days <= 7 ? "#dcfce7" : days <= 30 ? "#fef3c7" : "#fee2e2",
                                    color: days < 0 ? "#475569" : days <= 7 ? "#166534" : days <= 30 ? "#92400e" : "#991b1b",
                                    padding: "3px 9px",
                                    borderRadius: 20,
                                    fontSize: 11.5,
                                    fontWeight: 800,
                                    display: "inline-block",
                                    minWidth: 42,
                                  }}
                                >
                                  {Math.abs(days)}d
                                </span>
                              )}
                            </td>
                            <td style={tdStyle}>
                              <select
                                value={row.reason}
                                onChange={(e) => {
                                  const next = [...bulkRows];
                                  next[idx] = { ...row, reason: e.target.value as Reason };
                                  setBulkRows(next);
                                }}
                                style={{ ...inputStyle, marginTop: 0 }}
                              >
                                {REASONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={tdStyle}>
                              <input
                                type="text"
                                placeholder="Optional"
                                value={row.remark}
                                onChange={(e) => {
                                  const next = [...bulkRows];
                                  next[idx] = { ...row, remark: e.target.value };
                                  setBulkRows(next);
                                }}
                                style={{ ...inputStyle, marginTop: 0 }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <small style={{ color: blankLines > 0 ? "#b45309" : "#64748b", fontSize: 11.5, display: "block", marginTop: 8, lineHeight: 1.6 }}>
                {blankLines > 0
                  ? `${blankLines} line ki date khali hai — un modules ki entry nahi banegi.`
                  : "Sabhi lines ki date bhari hai — sab modules ki entry ban jayegi."}
              </small>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                <button type="button" onClick={() => setShowBulk(false)} style={cancelBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={primaryBtn}>
                  {saving ? "Saving..." : `Save ${bulkFilled} Module`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT MODAL */}
      {showModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={modalHeader}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                  {form.id ? "Edit Warranty Entry" : "New Warranty Entry"}
                </h3>
                <small style={{ color: "#94a3b8", fontSize: 12 }}>
                  Ek row = ek module. Job card se warranty quantity aur date apne aap bharli jayegi.
                </small>
              </div>
              <button onClick={() => setShowModal(false)} style={closeBtn}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} style={{ padding: 22 }}>
              {/* JOB CARD + AUTO-FILL */}
              <div style={jobCardBox}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
                >
                  <label style={{ ...labelStyle, color: "#2563eb" }}>Select Job Card (Warranty) *</label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showCompletedJobCards}
                      onChange={(e) => setShowCompletedJobCards(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    Jahan entry poori ho gayi hai wo bhi dikhao
                  </label>
                </div>
                <select
                  value={form.job_card_id}
                  onChange={(e) => setForm({ ...form, job_card_id: e.target.value })}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                >
                  <option value="">-- Choose Job Card --</option>
                  {availableJobCards.map((j) => {
                    const logged = loggedByJob[j.id] || 0;
                    const qty = Number(j.warranty_quantity) || 0;
                    return (
                      <option key={j.id} value={j.id}>
                        {j.job_no} — {j.business_name || "Customer"} · Warranty {qty} ({logged} logged,{" "}
                        {Math.max(0, qty - logged)} baaki)
                      </option>
                    );
                  })}
                </select>

                {pendingJobCards.length === 0 && !showCompletedJobCards && (
                  <small style={{ color: "#b91c1c", fontSize: 12, display: "block", marginTop: 6 }}>
                    Saari warranty entry complete ho gayi
                    {hiddenJobCards > 0
                      ? ` — ${hiddenJobCards} job card ke sab modules ki entry ban chuki hai. Upar wala checkbox on karke completed job cards dekh sakte hain.`
                      : " — abhi kisi job card par warranty quantity nahi hai."}
                  </small>
                )}
              </div>

              {/* AUTO-FILLED SUMMARY */}
              {selectedJob && (
                <div style={summaryStrip}>
                  <div>
                    <span style={summaryLabel}>Job Card Date</span>
                    <strong style={summaryValue}>{fmtDate(String(selectedJob.job_date || ""))}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Warranty Qty</span>
                    <strong style={summaryValue}>{Number(selectedJob.warranty_quantity) || 0}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Entry Ban Chuki</span>
                    <strong style={summaryValue}>{loggedByJob[selectedJob.id] || 0}</strong>
                  </div>
                  <div>
                    <span style={summaryLabel}>Customer</span>
                    <strong style={summaryValue}>{selectedJob.business_name || "—"}</strong>
                  </div>
                </div>
              )}

              {/* DATE + WORKING DAY */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Warranty Module Date (module par likhi date) *</label>
                  <input
                    type="date"
                    required
                    value={form.warranty_module_date}
                    onChange={(e) => setForm({ ...form, warranty_module_date: e.target.value })}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Working Day (auto)</label>
                  <div
                    style={{
                      ...inputStyle,
                      background: "#f1f5f9",
                      fontWeight: 800,
                      color:
                        liveWorkingDays < 0
                          ? "#475569"
                          : liveWorkingDays <= 7
                          ? "#15803d"
                          : liveWorkingDays <= 30
                          ? "#b45309"
                          : "#b91c1c",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {!selectedJob
                      ? "Job card chunein"
                      : `${Math.abs(liveWorkingDays)} ${Math.abs(liveWorkingDays) === 1 ? "day" : "days"}`}
                  </div>
                </div>
              </div>

              {/* REASON */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Reason for Return *</label>
                <select
                  value={form.return_reason}
                  onChange={(e) => setForm({ ...form, return_reason: e.target.value as Reason })}
                  style={inputStyle}
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* REMARK */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Remark</label>
                <textarea
                  rows={3}
                  placeholder="उदा. Module par likha tha 12/04/2026, customer ne 25 din baad laaya / वाहन का वोल्टेज बहुत ऊँचा था"
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)} style={cancelBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={primaryBtn}>
                  {saving ? "Saving..." : form.id ? "Update Entry" : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** Warranty qty me se kitni entries baaki hain — job card wise list. */
function PendingModules({
  jobCards,
  loggedByJob,
}: {
  jobCards: JobCardOption[];
  loggedByJob: Record<number, number>;
}) {
  const pending = jobCards
    .map((j) => ({
      job_no: j.job_no || `JC-${j.id}`,
      business_name: j.business_name || "—",
      qty: Number(j.warranty_quantity) || 0,
      logged: loggedByJob[j.id] || 0,
    }))
    .filter((r) => r.logged < r.qty)
    .sort((a, b) => b.qty - b.logged - (a.qty - a.logged));

  if (!pending.length) return null;

  return (
    <div style={{ ...cardStyle, marginTop: 16 }}>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>
          Module Entry Baaki <span style={{ color: "#94a3b8", fontWeight: 600 }}>(entry nahi bani)</span>
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 16 }}>
        {pending.map((p) => (
          <div
            key={p.job_no}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "10px 13px",
              minWidth: 215,
              background: "#fff",
            }}
          >
            <strong style={{ display: "block", fontSize: 13, color: "#2563eb" }}>{p.job_no}</strong>
            <small style={{ display: "block", color: "#64748b", fontSize: 11.5, marginBottom: 6 }}>
              {p.business_name}
            </small>
            <span
              style={{
                background: "#fffbeb",
                color: "#92400e",
                padding: "3px 9px",
                borderRadius: 20,
                fontSize: 11.5,
                fontWeight: 700,
              }}
            >
              {p.logged}/{p.qty} logged · {p.qty - p.logged} baaki
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  bg,
  fg,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  bg: string;
  fg: string;
}) {
  return (
    <div style={{ background: bg, padding: "15px 17px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.05)" }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b" }}>{title}</span>
      <strong style={{ display: "block", fontSize: 24, color: fg, marginTop: 3, letterSpacing: "-.01em" }}>{value}</strong>
      <small style={{ display: "block", color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{subtitle}</small>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = { padding: "12px 14px", color: "#334155" };

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  overflow: "hidden",
  boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
};

const filterBar: React.CSSProperties = {
  background: "#fff",
  padding: 14,
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  marginBottom: 16,
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
};

const filterInput: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const filterLabel: React.CSSProperties = { fontSize: 12, color: "#64748b", fontWeight: 600 };

const resetBtn: React.CSSProperties = {
  background: "#f1f5f9",
  color: "#475569",
  border: "none",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  marginTop: 4,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#334155" };

const overlay: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(15, 23, 42, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 20,
};

const modal: React.CSSProperties = {
  background: "#fff",
  width: "100%",
  maxWidth: 660,
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 20px 40px rgba(0,0,42,0.2)",
  maxHeight: "92vh",
  overflowY: "auto",
};

const modalHeader: React.CSSProperties = {
  background: "#0f172a",
  color: "#fff",
  padding: "16px 22px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#fff",
  fontSize: 18,
  cursor: "pointer",
};

const jobCardBox: React.CSSProperties = {
  background: "#f8fafc",
  padding: 12,
  borderRadius: 10,
  border: "1px dashed #cbd5e1",
  marginBottom: 14,
};

const summaryStrip: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: 12,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: 10,
  padding: 12,
  marginBottom: 14,
};

const summaryLabel: React.CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};

const summaryValue: React.CSSProperties = { display: "block", fontSize: 14, fontWeight: 800, color: "#0f172a", marginTop: 2 };

const editBtn: React.CSSProperties = {
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  marginRight: 6,
};

const deleteBtn: React.CSSProperties = {
  background: "#fee2e2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "4px 9px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const cancelBtn: React.CSSProperties = {
  background: "#f1f5f9",
  color: "#475569",
  border: "none",
  padding: "9px 16px",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "9px 18px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const smallBtn: React.CSSProperties = {
  background: "#f1f5f9",
  color: "#334155",
  border: "1px solid #cbd5e1",
  padding: "6px 11px",
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const outlineBtn: React.CSSProperties = {
  background: "#fff",
  color: "#334155",
  border: "1px solid #cbd5e1",
  padding: "9px 15px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export default Warranty;