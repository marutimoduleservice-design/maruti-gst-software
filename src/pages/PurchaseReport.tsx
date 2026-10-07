import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import {
  buildAllocations,
  isVendorPaymentRow,
  loadDbAllocations,
  purchaseDueAmount,
  type AllocBill,
  type BillAllocation,
} from "../lib/billAllocations";

type PurchaseItem = {
  id: number;
  inward_no: string | null;
  purchase_no?: string | null;
  purchase_date: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_code: string | null;
  item_name: string | null;
  quantity: number | null;
  rate: number | null;
  total_amount: number | null;
  status: string | null;
};

type Vendor = {
  id: number;
  vendor_code: string | null;
  business_name: string | null;
  contact_person: string | null;
};

function PurchaseReport() {
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [purchaseAllocations, setPurchaseAllocations] = useState<Map<number, BillAllocation>>(new Map());
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  // Bill total - (paid + deduction) = Due amount.
  // purchases table me pending_amount column nahi hai - Ledger Bank Passbook ke
  // "Vendor Payment" vouchers se allocation banata hai. Yahi allocation use karne
  // se Purchase Report aur Payments & Ledger ka due amount match karta hai.
  const billOf = (item: PurchaseItem) =>
    Number(item.total_amount ?? Number(item.quantity || 0) * Number(item.rate || 0));

  const dueOf = (item: PurchaseItem) => {
    const allocation = purchaseAllocations.get(item.id);
    return purchaseDueAmount(item, allocation);
  };

  const isPaidRow = (item: PurchaseItem) => {
    if (billOf(item) <= 0) return false;
    return dueOf(item) <= 0.005;
  };

  // Filters
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");

  const loadData = async () => {
    setLoading(true);

    // 1. Fetch Vendors for filter dropdown
    const { data: vendorData } = await sc("vendors")
      .select("id, vendor_code, business_name, contact_person")
      .order("business_name");

    if (vendorData) setVendors(vendorData);

    // 2. Fetch Purchases
    const [purchaseResult, bankResult] = await Promise.all([
      sc("purchases").select("*").order("id", { ascending: false }),
      sc("bank_transactions").select("*"),
    ]);

    const { data: purchaseData, error } = purchaseResult;

    if (error) {
      console.error("Purchases load error:", error);
    } else {
      const purchaseRows = (purchaseData || []) as PurchaseItem[];
      setPurchases(purchaseRows);

      // Vendor payment vouchers se har bill ka paid/deduction nikalo —
      // buildAllocations table-first hai, isliye cache fresh hona zaroori.
      await loadDbAllocations(true);
      const bills: AllocBill[] = purchaseRows.map((p) => ({
        id: p.id,
        ref: p.inward_no || p.purchase_no || `INW-${p.id}`,
        date: String(p.purchase_date || ""),
        total: Number(p.total_amount || 0),
      }));
      const vendorPayments = (bankResult.data || []).filter(isVendorPaymentRow);
      setPurchaseAllocations(buildAllocations(bills, vendorPayments));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter Data
  const filteredData = useMemo(() => {
    return purchases.filter((item) => {
      const q = search.trim().toLowerCase();
      const inwNo = (item.inward_no || "").toLowerCase();
      const vName = (item.vendor_name || "").toLowerCase();
      const vCode = (item.vendor_code || "").toLowerCase();
      const iName = (item.item_name || "").toLowerCase();

      const matchesSearch =
        !q ||
        inwNo.includes(q) ||
        vName.includes(q) ||
        vCode.includes(q) ||
        iName.includes(q);

      const matchesVendor =
        selectedVendor === "All" ||
        String(item.vendor_id) === selectedVendor ||
        item.vendor_name === selectedVendor;

      const isPaidStatus = isPaidRow(item);
      const matchesStatus =
        selectedStatus === "All" ||
        (isPaidStatus && selectedStatus.toLowerCase() === "paid") ||
        (!isPaidStatus && selectedStatus.toLowerCase() === "pending");

      const itemDate = item.purchase_date || "";
      const matchesFrom = !fromDate || itemDate >= fromDate;
      const matchesTo = !toDate || itemDate <= toDate;

      return (
        matchesSearch &&
        matchesVendor &&
        matchesStatus &&
        matchesFrom &&
        matchesTo
      );
    });
  }, [purchases, purchaseAllocations, search, fromDate, toDate, selectedVendor, selectedStatus]);

  const purCols = {
    inward_no: (p: any) => String(p.inward_no || p.purchase_no || ""),
    purchase_date: (p: any) => String(p.purchase_date || ""),
    vendor: (p: any) => String(p.vendor_name || ""),
    item: (p: any) => String(p.item_name || ""),
    qty: (p: any) => Number(p.quantity || 0),
    rate: (p: any) => Number(p.rate || 0),
    bill: (p: any) => billOf(p),
    status: (p: any) => (isPaidRow(p) ? "Paid" : "Pending"),
  } as const;
  const { sort, sorted: sortedPurchases } = useSortedRows(filteredData, purCols, "purchase_date", "desc");

  // Summary Totals
  const totals = useMemo(() => {
    return filteredData.reduce(
      (acc, item) => {
        const qty = Number(item.quantity || 0);
        const bill = billOf(item);
        const due = dueOf(item);

        return {
          totalQty: acc.totalQty + qty,
          totalBill: acc.totalBill + bill,
          totalPaid: acc.totalPaid + (bill - due),
          totalPending: acc.totalPending + due,
        };
      },
      { totalQty: 0, totalBill: 0, totalPaid: 0, totalPending: 0 }
    );
  }, [filteredData, purchaseAllocations]);

  // Export to CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) {
      alert("एक्सपोर्ट करने के लिए कोई डेटा नहीं है!");
      return;
    }

    const headers = [
      "Inward No",
      "Date",
      "Vendor",
      "Item Name",
      "Qty",
      "Rate (₹)",
      "Total Bill (₹)",
      "Status",
    ];

    const rows = filteredData.map((item) => {
      const qty = Number(item.quantity || 0);
      const rate = Number(item.rate || 0);
      const bill = Number(item.total_amount ?? qty * rate);
      const vendorText = item.vendor_code
        ? `${item.vendor_code} - ${item.vendor_name || "-"}`
        : item.vendor_name || "-";

      return [
        `"${item.inward_no || "-"}"`,
        `"${item.purchase_date || "-"}"`,
        `"${vendorText}"`,
        `"${item.item_name || "-"}"`,
        qty,
        rate.toFixed(2),
        bill.toFixed(2),
        `"${item.status || "Pending"}"`,
      ].join(",");
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Purchase_Report_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ width: "100%" }}>
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
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#0f172a",
              margin: 0,
            }}
          >
            Purchase Report
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            Item-wise inward stock, vendor purchases, rates and expense billing breakdown.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={exportToCSV}
            style={{
              background: "#0284c7",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            📥 Export CSV
          </button>
          <button
            onClick={() => window.print()}
            style={{
              background: "#475569",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <SummaryCard
          title="Total Inward Qty"
          value={totals.totalQty.toLocaleString("en-IN")}
          subtitle={`${filteredData.length} Items Inward`}
          background="#eff6ff"
          textColor="#1d4ed8"
        />
        <SummaryCard
          title="Total Purchase Bill"
          value={`₹ ${totals.totalBill.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
          })}`}
          subtitle="Gross Inward Value"
          background="#fff7ed"
          textColor="#c2410c"
        />
        <SummaryCard
          title="Paid Purchases"
          value={`₹ ${totals.totalPaid.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
          })}`}
          subtitle="Settled Payments"
          background="#f0fdf4"
          textColor="#15803d"
        />
        <SummaryCard
          title="Pending Inward Due"
          value={`₹ ${totals.totalPending.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
          })}`}
          subtitle="To be Paid"
          background="#fef2f2"
          textColor="#b91c1c"
        />
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
          placeholder="Search Inward No, Vendor, Item..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            minWidth: 260,
            outline: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <select
            value={selectedVendor}
            onChange={(e) => setSelectedVendor(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {v.vendor_code ? `${v.vendor_code} - ` : ""}
                {v.business_name}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending / Unpaid</option>
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              From:
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={filterInputStyle}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              To:
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={filterInputStyle}
            />
          </div>

          {(fromDate ||
            toDate ||
            search ||
            selectedVendor !== "All" ||
            selectedStatus !== "All") && (
            <button
              onClick={() => {
                setSearch("");
                setFromDate("");
                setToDate("");
                setSelectedVendor("All");
                setSelectedStatus("All");
              }}
              style={{
                background: "#f1f5f9",
                color: "#475569",
                border: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* PURCHASE REPORT TABLE */}
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
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#f8fafc",
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <SortTh label="Inward No" active={sort.key === "inward_no"} dir={sort.dir} onToggle={() => sort.toggle("inward_no")} style={thStyle} />
                <SortTh label="Date" active={sort.key === "purchase_date"} dir={sort.dir} onToggle={() => sort.toggle("purchase_date")} style={thStyle} />
                <SortTh label="Vendor" active={sort.key === "vendor"} dir={sort.dir} onToggle={() => sort.toggle("vendor")} style={thStyle} />
                <SortTh label="Item" active={sort.key === "item"} dir={sort.dir} onToggle={() => sort.toggle("item")} style={thStyle} />
                <SortTh
                  label={`Qty [Total: ${totals.totalQty}]`}
                  active={sort.key === "qty"}
                  dir={sort.dir}
                  onToggle={() => sort.toggle("qty")}
                  style={{ ...thStyle, textAlign: "right" }}
                  align="right"
                />
                <SortTh label="Rate (₹)" active={sort.key === "rate"} dir={sort.dir} onToggle={() => sort.toggle("rate")} style={thStyle} align="right" />
                <SortTh
                  label={`Total Bill [₹${totals.totalBill.toFixed(2)}]`}
                  active={sort.key === "bill"}
                  dir={sort.dir}
                  onToggle={() => sort.toggle("bill")}
                  style={{ ...thStyle, textAlign: "right" }}
                  align="right"
                />
                <SortTh label="Status" active={sort.key === "status"} dir={sort.dir} onToggle={() => sort.toggle("status")} style={{ ...thStyle, textAlign: "center" }} align="center" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "#64748b",
                    }}
                  >
                    Loading purchase records...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "#64748b",
                    }}
                  >
                    No purchase records found.
                  </td>
                </tr>
              ) : (
sortedPurchases.map((item) => {
                  const qty = Number(item.quantity || 0);
                  const rate = Number(item.rate || 0);
                  const bill = billOf(item);
                  const due = dueOf(item);
                  const paid = isPaidRow(item);
                  const status = paid ? "Paid" : due > 0 ? "Pending" : "Paid";

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        fontSize: 13,
                      }}
                    >
                      <td style={tdStyle}>
                        <strong style={{ color: "#2563eb" }}>
                          {item.inward_no || "-"}
                        </strong>
                      </td>
                      <td style={tdStyle}>{fmtDate(item.purchase_date)}</td>
                      <td style={tdStyle}>
                        <strong>
                          {item.vendor_code ? `${item.vendor_code} - ` : ""}
                          {item.vendor_name || "-"}
                        </strong>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item.item_name || "-"}
                        </span>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 700,
                        }}
                      >
                        {qty}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: "#64748b",
                        }}
                      >
                        ₹ {rate.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#0f172a",
                        }}
                      >
                        ₹ {bill.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                        <small
                          style={{
                            display: "block",
                            color: due > 0 ? "#dc2626" : "#16a34a",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {due > 0 ? `Due ₹ ${due.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "Fully Paid"}
                        </small>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span
                          style={{
                            background: paid
                              ? "#dcfce7"
                              : "#fee2e2",
                            color: paid
                              ? "#166534"
                              : "#991b1b",
                            padding: "4px 10px",
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            display: "inline-block",
                          }}
                        >
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  background,
  textColor,
}: {
  title: string;
  value: string;
  subtitle: string;
  background: string;
  textColor: string;
}) {
  return (
    <div
      style={{
        background,
        padding: "16px 18px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
        {title}
      </span>
      <strong
        style={{
          display: "block",
          fontSize: 18,
          color: textColor,
          marginTop: 4,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
      <small style={{ color: "#64748b", fontSize: 11, marginTop: 2, display: "block" }}>
        {subtitle}
      </small>
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

const tdStyle: React.CSSProperties = {
  padding: "13px 14px",
  color: "#334155",
  whiteSpace: "nowrap",
};

const filterInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

export default PurchaseReport;