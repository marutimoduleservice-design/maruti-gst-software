import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import { vendorPaymentParticularsWithPo } from "../lib/billAllocations";

type PassbookItem = {
  id: number;
  transaction_date: string;
  created_at?: string;
  particulars: string;
  transaction_type: string;
  payment_in: number;
  payment_out: number;
  running_balance?: number;
};

function BankPassbook() {
  const [passbookList, setPassbookList] = useState<PassbookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [formData, setFormData] = useState({
    transaction_type: "Bank Deposit / Capital (+)",
    notes: "",
    amount: "",
    payment_mode: "Bank / UPI",
    transaction_date: new Date().toISOString().slice(0, 10),
  });

  const loadAllPassbookData = async () => {
    setLoading(true);

    try {
      const [bankResult, purchaseResult] = await Promise.all([
        sc("bank_transactions").select("*").order("id", { ascending: true }),
        sc("purchases").select("inward_no, purchase_no"),
      ]);

      const { data: bankData, error } = bankResult;

      if (error) throw error;

      // Inward number -> PO number. Vendor payment lines me 40+ inward numbers ki
      // jagah PO number dikhane ke liye chahiye.
      const inwardToPo = new Map<string, string>();
      (purchaseResult.data || []).forEach((p: any) => {
        const po = String(p.purchase_no || "").trim();
        const inward = String(p.inward_no || "").trim();
        if (po && inward) inwardToPo.set(inward.toLowerCase(), po);
      });

      if (bankData && Array.isArray(bankData)) {
        let currentBalance = 0;

        const calculated: PassbookItem[] = bankData.map((row: any) => {
          const rawAmt = Number(row.amount || row.total_amount || 0);
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

          currentBalance = currentBalance + pIn - pOut;

const rawParticulars = row.particulars || row.notes || "Bank Transaction";
            const isVendorPayment = typeStr.includes("vendor payment");

            return {
              id: row.id,
              transaction_date:
                row.transaction_date ||
                (row.created_at ? row.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
              created_at: row.created_at,
              particulars: isVendorPayment
                ? vendorPaymentParticularsWithPo(rawParticulars, inwardToPo)
                : rawParticulars,
            transaction_type:
              row.transaction_type || (pIn > 0 ? "Bank Deposit (+)" : "Bank Payment (-)"),
            payment_in: pIn,
            payment_out: pOut,
            running_balance: currentBalance,
          };
        });

        setPassbookList(calculated.reverse());
      }
    } catch (err) {
      console.error("Passbook load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllPassbookData();
  }, []);

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();

    const amt = Number(formData.amount || 0);
    if (amt <= 0) {
      alert("❌ कृपया सही राशि दर्ज करें!");
      return;
    }

    setSaving(true);

    const isInflow = formData.transaction_type.includes("(+)");
    const pIn = isInflow ? amt : 0;
    const pOut = isInflow ? 0 : amt;

    const newRecord = {
      transaction_date: formData.transaction_date,
      particulars: formData.notes || (isInflow ? "Bank: Deposit / Capital" : "Direct Expense / Outflow"),
      notes: formData.notes,
      party_name: isInflow ? "Bank / Capital Account" : "Expense Account",
      transaction_type: formData.transaction_type,
      payment_in: pIn,
      payment_out: pOut,
      amount: amt,
      type: isInflow ? "credit" : "debit",
      payment_mode: formData.payment_mode,
    };

    try {
      const { error } = await sc("bank_transactions").insert([newRecord]);
      if (error) throw error;

      alert(`✅ ₹${amt.toLocaleString("en-IN")} पासबुक में दर्ज हुआ!`);
      setFormData({
        transaction_type: "Bank Deposit / Capital (+)",
        notes: "",
        amount: "",
        payment_mode: "Bank / UPI",
        transaction_date: new Date().toISOString().slice(0, 10),
      });
      await loadAllPassbookData();
    } catch (err: any) {
      console.error("Save error:", err);
      alert("❌ Save Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("क्या आप वाकई इस ट्रांजेक्शन को पासबुक से हटाना चाहते हैं?")) return;

    try {
      const { error } = await sc("bank_transactions").delete().eq("id", id);
      if (error) throw error;
      await loadAllPassbookData();
    } catch (err: any) {
      alert("Delete error: " + err.message);
    }
  };

  const filteredList = useMemo(() => {
    return passbookList.filter((t) => {
      const q = search.trim().toLowerCase();
      const part = String(t.particulars || "").toLowerCase();
      const type = String(t.transaction_type || "").toLowerCase();
      const date = String(t.transaction_date || "").toLowerCase();
      return !q || part.includes(q) || type.includes(q) || date.includes(q);
    });
  }, [passbookList, search]);

  const pbCols = {
    date: (t: any) => String(t.transaction_date || ""),
    particulars: (t: any) => String(t.particulars || ""),
    payment_in: (t: any) => Number(t.payment_in || 0),
    payment_out: (t: any) => Number(t.payment_out || 0),
    balance: (t: any) => Number(t.running_balance || 0),
  } as const;
  const { sort, sorted: sortedList } = useSortedRows(filteredList, pbCols, "date", "desc");

  const totals = useMemo(() => {
    return passbookList.reduce(
      (acc, t) => ({
        totalIn: acc.totalIn + Number(t.payment_in || 0),
        totalOut: acc.totalOut + Number(t.payment_out || 0),
      }),
      { totalIn: 0, totalOut: 0 }
    );
  }, [passbookList]);

  const netBankBalance = totals.totalIn - totals.totalOut;

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
          Bank Passbook & Expenses Ledger
        </h1>
        <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
          सभी जमा (Payment IN), वास्तविक निकासी/भुगतान (Payment OUT) और लाइव बैंक बैलेंस का बहीखाता।
        </p>
      </div>

      {/* KPI METRIC CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div style={kpiBoxStyle("#f0fdf4")}>
          <span style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>
            Total Payment IN (+) [कुल जमा]
          </span>
          <strong style={{ display: "block", fontSize: 22, color: "#15803d", marginTop: 4 }}>
            ₹ {totals.totalIn.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div style={kpiBoxStyle("#fef2f2")}>
          <span style={{ fontSize: 12, color: "#991b1b", fontWeight: 700 }}>
            Total Payment OUT (-) [वास्तविक भुगतान]
          </span>
          <strong style={{ display: "block", fontSize: 22, color: "#dc2626", marginTop: 4 }}>
            ₹ {totals.totalOut.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div style={kpiBoxStyle(netBankBalance >= 0 ? "#eff6ff" : "#fff1f2")}>
          <span style={{ fontSize: 12, color: netBankBalance >= 0 ? "#1e40af" : "#9f1239", fontWeight: 700 }}>
            🏦 Net Available Bank Balance
          </span>
          <strong style={{ display: "block", fontSize: 22, color: netBankBalance >= 0 ? "#1d4ed8" : "#be123c", marginTop: 4 }}>
            ₹ {netBankBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>
      </div>

      {/* DIRECT ADJUSTMENT / DEPOSIT FORM */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          padding: 20,
          marginBottom: 20,
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#ea580c" }}>
          💰 Bank Passbook & Direct Adjustment
        </h3>

        <form onSubmit={handleSaveTransaction}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <label style={labelStyle}>Transaction Type *</label>
              <select
                value={formData.transaction_type}
                onChange={(e) => setFormData({ ...formData, transaction_type: e.target.value })}
                style={inputStyle}
              >
                <option value="Bank Deposit / Capital (+)">Bank Deposit / Capital (+)</option>
                <option value="Direct Income / Profit (+)">Direct Income / Profit (+)</option>
                <option value="Office Expense / Rent (-)">Office Expense / Rent (-)</option>
                <option value="Staff Salary / Wages (-)">Staff Salary / Wages (-)</option>
                <option value="Bank Charges / Taxes (-)">Bank Charges / Taxes (-)</option>
                <option value="Owner Drawings / Personal (-)">Owner Drawings / Personal (-)</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Notes / Particulars *</label>
              <input
                type="text"
                required
                placeholder="e.g. Rent, Salary, Owner Capital, Investment"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                style={{ ...inputStyle, fontWeight: 700, fontSize: 15 }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              width: "100%",
              background: "#ea580c",
              color: "#fff",
              border: "none",
              padding: "11px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {saving ? "Saving Transaction..." : "Save Bank Transaction"}
          </button>
        </form>
      </div>

      {/* PASSBOOK TABLE */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              Bank Passbook Ledger (Payment IN / OUT)
            </h3>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Live Chronological Statement with Exact Running Balance
            </span>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              placeholder="Search Bank Transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "7px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 13,
                minWidth: 240,
                outline: "none",
                background: "#fff",
              }}
            />
            <button
              onClick={loadAllPassbookData}
              style={{
                background: "#0f172a",
                color: "#fff",
                border: "none",
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ ...thStyle, width: 60 }}>Sr No</th>
                <SortTh label="Date" active={sort.key === "date"} dir={sort.dir} onToggle={() => sort.toggle("date")} style={thStyle} />
                <SortTh label="Particulars / Description" active={sort.key === "particulars"} dir={sort.dir} onToggle={() => sort.toggle("particulars")} style={thStyle} />
                <SortTh label="Payment In (+)" active={sort.key === "payment_in"} dir={sort.dir} onToggle={() => sort.toggle("payment_in")} style={{ ...thStyle, textAlign: "right", color: "#16a34a" }} align="right" />
                <SortTh label="Payment Out (-)" active={sort.key === "payment_out"} dir={sort.dir} onToggle={() => sort.toggle("payment_out")} style={{ ...thStyle, textAlign: "right", color: "#dc2626" }} align="right" />
                <SortTh label="Balance (₹)" active={sort.key === "balance"} dir={sort.dir} onToggle={() => sort.toggle("balance")} style={{ ...thStyle, textAlign: "right", color: "#0f172a" }} align="right" />
                <th style={{ ...thStyle, textAlign: "center", width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading passbook ledger...
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    कोई पासबुक ट्रांजेक्शन नहीं मिला।
                  </td>
                </tr>
              ) : (
                sortedList.map((t, idx) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={{ ...tdStyle, color: "#64748b", fontWeight: 600 }}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: "#334155" }}>{fmtDate(t.transaction_date)}</span>
                    </td>
                    <td style={tdStyle}>
                      <strong style={{ color: "#0f172a", display: "block" }}>{t.particulars}</strong>
                      <span
                        style={{
                          fontSize: 11,
                          color: t.payment_in > 0 ? "#15803d" : "#b91c1c",
                          fontWeight: 600,
                        }}
                      >
                        {t.transaction_type}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                      {t.payment_in > 0 ? `₹ ${t.payment_in.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                      {t.payment_out > 0 ? `₹ ${t.payment_out.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                      ₹ {Number(t.running_balance || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <button
                        onClick={() => handleDelete(t.id)}
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          border: "1px solid #fecaca",
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
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

const kpiBoxStyle = (background: string): React.CSSProperties => ({
  background,
  padding: "16px 18px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.05)",
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

const inputStyle: React.CSSProperties = {
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

export default BankPassbook;