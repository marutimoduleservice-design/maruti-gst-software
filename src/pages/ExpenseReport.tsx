import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import { isBounced, isTransferRow } from "../lib/bankAccounts";

type ExpenseItem = {
  id: number;
  transaction_date: string;
  created_at?: string;
  particulars: string;
  notes?: string;
  party_name?: string;
  transaction_type: string;
  payment_out: number;
  payment_mode?: string;
  remarks?: string;
};

function isPersonalRow(item: ExpenseItem) {
  // Same detection jo `src/lib/profitCalc.ts` aur Bank Passbook use karte hain,
  // taaki Expense Report aur Net Profit Report ka Personal figure match kare.
  const type = String(item.transaction_type || "").toLowerCase();
  const part = String(item.particulars || "").toLowerCase();
  return (
    type.includes("owner drawing") ||
    type.includes("personal") ||
    part.includes("owner drawing") ||
    part.includes("personal")
  );
}

function ExpenseReport() {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("All");

  const loadExpenses = async () => {
    setLoading(true);
    try {
      const { data, error } = await sc("bank_transactions")
        .select("*")
        .gt("payment_out", 0)
        .order("id", { ascending: false });

      if (error) throw error;

      if (data && Array.isArray(data)) {
        // Strict filter to show ONLY pure expenses/manual outlays, excluding vendor purchases & customer receipts
        const pureExpenses = data.filter((row: any) => {
          // Bounce/return: paisa bahar hi nahi gaya, kharcha kaise maana jaaye.
          if (isBounced(row)) return false;

          // Apne hi account se dusre account me paisa transfer (Cash Box -> Bank) —
          // ye kharcha nahi hai, isliye expense me nahi aana chahiye.
          if (isTransferRow(row)) return false;

          const part = String(row.particulars || row.notes || "").toLowerCase();
          const type = String(row.transaction_type || "").toLowerCase();

          if (
            part.includes("vendor payment") ||
            part.includes("purchase payment") ||
            part.includes("inw-") ||
            type.includes("vendor payment") ||
            type.includes("purchase payment")
          ) {
            return false;
          }

          if (
            part.includes("customer receipt") ||
            part.includes("inv-") ||
            type.includes("customer receipt")
          ) {
            return false;
          }

          return true;
        });

        const mapped = pureExpenses.map((row: any) => ({
          id: row.id,
          transaction_date:
            row.transaction_date ||
            (row.created_at ? row.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
          particulars: row.particulars || row.notes || "Direct Expense",
          notes: row.notes || "",
          party_name: row.party_name || "",
          transaction_type: row.transaction_type || "Expense (-)",
          payment_out: Number(row.payment_out || row.debit_amount || row.amount || 0),
          payment_mode: row.payment_mode || "Bank / UPI",
          remarks: row.remarks || "",
        }));

        setExpenses(mapped);
      }
    } catch (err) {
      console.error("Error loading expenses:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, []);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((item) => {
      const q = search.trim().toLowerCase();
      const part = String(item.particulars || "").toLowerCase();
      const type = String(item.transaction_type || "").toLowerCase();
      const mode = String(item.payment_mode || "").toLowerCase();

      const matchesSearch =
        !q || part.includes(q) || type.includes(q) || mode.includes(q);

      const matchesCategory =
        selectedCategoryFilter === "All" ||
        type.includes(selectedCategoryFilter.toLowerCase());

      const itemDate = item.transaction_date || "";
      const matchesFrom = !fromDate || itemDate >= fromDate;
      const matchesTo = !toDate || itemDate <= toDate;

      return matchesSearch && matchesCategory && matchesFrom && matchesTo;
    });
  }, [expenses, search, selectedCategoryFilter, fromDate, toDate]);

  const expCols = {
    date: (e: any) => String(e.transaction_date || ""),
    particulars: (e: any) => String(e.particulars || ""),
    mode: (e: any) => String(e.payment_mode || ""),
    amount: (e: any) => Number(e.payment_out || 0),
  } as const;
  const { sort, sorted: sortedExpenses } = useSortedRows(filteredExpenses, expCols, "date", "desc");

  const totalExpenseAmount = useMemo(() => {
    // Owner Drawings / Personal ek alag box me aata hai, isliye yahan se exclude.
    return filteredExpenses.reduce(
      (sum, item) => (isPersonalRow(item) ? sum : sum + Number(item.payment_out || 0)),
      0
    );
  }, [filteredExpenses]);

  const totalPersonalAmount = useMemo(() => {
    return filteredExpenses.reduce(
      (sum, item) => (isPersonalRow(item) ? sum + Number(item.payment_out || 0) : sum),
      0
    );
  }, [filteredExpenses]);

  // Dono ka total — pure expenses + owner drawings.
  const totalAllAmount = useMemo(
    () => totalExpenseAmount + totalPersonalAmount,
    [totalExpenseAmount, totalPersonalAmount]
  );

  return (
    <div style={{ width: "100%", paddingBottom: 40 }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Expense Report
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            शुद्ध व्यावसायिक खर्चों और बैंक भुगतानों की विस्तृत रिपोर्ट (वेंडर परचेज और सेल्स को छोड़कर)।
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => window.print()}
            style={{
              background: "#f1f5f9",
              color: "#334155",
              border: "1px solid #cbd5e1",
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🖨️ Print Report
          </button>

          <button
            onClick={loadExpenses}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🔄 Refresh Report
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS SECTION */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div style={kpiBoxStyle("#fef2f2", "#fecaca")}>
          <span style={{ fontSize: 12, color: "#991b1b", fontWeight: 700 }}>
            Total Pure Expenses (-) [कुल शुद्ध खर्चे]
          </span>
          <strong
            style={{
              display: "block",
              fontSize: 22,
              color: "#dc2626",
              marginTop: 6,
            }}
          >
            ₹ {totalExpenseAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
          <small style={{ color: "#64748b", fontSize: 11, marginTop: 4, display: "block" }}>
            Excluding vendor inward bills, customer sales & owner drawings
          </small>
        </div>

        <div style={kpiBoxStyle("#f5f3ff", "#ddd6fe")}>
          <span style={{ fontSize: 12, color: "#5b21b6", fontWeight: 700 }}>
            Owner Drawings / Personal [मालिक व्यक्तिगत]
          </span>
          <strong
            style={{
              display: "block",
              fontSize: 22,
              color: "#7c3aed",
              marginTop: 6,
            }}
          >
            ₹ {totalPersonalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
          <small style={{ color: "#64748b", fontSize: 11, marginTop: 4, display: "block" }}>
            Personal withdrawals — not a business expense
          </small>
        </div>

        <div style={kpiBoxStyle("#f8fafc", "#cbd5e1")}>
          <span style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>
            Total All Expenses (-) [सभी कुल खर्चे]
          </span>
          <strong
            style={{
              display: "block",
              fontSize: 22,
              color: "#0f172a",
              marginTop: 6,
            }}
          >
            ₹ {totalAllAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
          <small style={{ color: "#64748b", fontSize: 11, marginTop: 4, display: "block" }}>
            Business expenses + owner drawings
          </small>
        </div>
      </div>

      {/* FILTER TOOLBAR */}
      <div
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <input
          type="text"
          placeholder="Search Particulars, Type, Mode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            minWidth: 260,
            outline: "none",
            background: "#fff",
          }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="All">All Categories</option>
            <option value="Expense">Office / General Expense</option>
            <option value="Salary">Staff Salary</option>
            <option value="Rent">Rent</option>
            <option value="Charges">Bank Charges / Taxes</option>
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={filterSelectStyle}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={filterSelectStyle}
            />
          </div>

          {(search || selectedCategoryFilter !== "All" || fromDate || toDate) && (
            <button
              onClick={() => {
                setSearch("");
                setSelectedCategoryFilter("All");
                setFromDate("");
                setToDate("");
              }}
              style={{
                background: "#e2e8f0",
                color: "#334155",
                border: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ ...thStyle, width: 60 }}>Sr No</th>
                <SortTh label="Date" active={sort.key === "date"} dir={sort.dir} onToggle={() => sort.toggle("date")} style={thStyle} />
                <SortTh label="Particulars / Description" active={sort.key === "particulars"} dir={sort.dir} onToggle={() => sort.toggle("particulars")} style={thStyle} />
                <SortTh label="Payment Mode" active={sort.key === "mode"} dir={sort.dir} onToggle={() => sort.toggle("mode")} style={thStyle} />
                <SortTh label="Amount (₹)" active={sort.key === "amount"} dir={sort.dir} onToggle={() => sort.toggle("amount")} style={{ ...thStyle, textAlign: "right", color: "#dc2626" }} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading expense report...
                  </td>
                </tr>
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    कोई शुद्ध खर्च रिकॉर्ड नहीं मिला।
                  </td>
                </tr>
              ) : (
                sortedExpenses.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={{ ...tdStyle, color: "#64748b", fontWeight: 600 }}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: "#334155" }}>{fmtDate(item.transaction_date)}</span>
                    </td>
                    <td style={tdStyle}>
                      <strong style={{ color: "#0f172a", display: "block" }}>{item.particulars}</strong>
                      <span style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600 }}>
                        {item.transaction_type}
                      </span>
                      {isPersonalRow(item) && (
                        <span
                          style={{
                            marginLeft: 6,
                            background: "#ede9fe",
                            color: "#5b21b6",
                            padding: "2px 8px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 800,
                          }}
                        >
                          PERSONAL
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          background: "#f1f5f9",
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#475569",
                        }}
                      >
                        {item.payment_mode}
                      </span>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 800,
                        color: isPersonalRow(item) ? "#7c3aed" : "#dc2626",
                        fontSize: 14,
                      }}
                    >
                      ₹ {item.payment_out.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const kpiBoxStyle = (background: string, borderColor: string): React.CSSProperties => ({
  background,
  padding: "16px 18px",
  borderRadius: 12,
  border: `1px solid ${borderColor}`,
});

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "13px 14px",
  color: "#334155",
};

const filterSelectStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

export default ExpenseReport; 