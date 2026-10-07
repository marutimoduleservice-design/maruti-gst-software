import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";

type TransactionRecord = {
  id: string | number;
  date: string;
  item_code: string;
  item_name: string;
  type: "Purchase" | "Sale";
  entry_no: string;
  qty: number;
};

type ItemMaster = {
  id: number;
  item_code: string | null;
  item_name: string | null;
};

function ItemWiseQtyInOutReport() {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [itemsList, setItemsList] = useState<ItemMaster[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedItem, setSelectedItem] = useState("All");
  const [selectedType, setSelectedType] = useState("All");

  const loadData = async () => {
    setLoading(true);

    try {
      // 1. Fetch Item Master list for dropdown & code mapping
      const { data: itemData } = await sc("items")
        .select("id, item_code, item_name");

      const itemMap: Record<string, string> = {};
      if (itemData) {
        setItemsList(itemData as ItemMaster[]);
        itemData.forEach((it) => {
          if (it.item_name) {
            itemMap[it.item_name.trim().toLowerCase()] = it.item_code || "-";
          }
        });
      }

      const combined: TransactionRecord[] = [];

      // 2. Fetch Purchases (Inward -> Positive Qty)
      const { data: purchaseData } = await sc("purchases")
        .select("*")
        .order("id", { ascending: false });

      if (purchaseData) {
        purchaseData.forEach((p: any) => {
          const iName = p.item_name || "Unknown Item";
          const iCode =
            p.item_code ||
            itemMap[iName.trim().toLowerCase()] ||
            "ITM-GEN";

          combined.push({
            id: `PUR-${p.id}`,
            date: p.purchase_date || p.created_at?.slice(0, 10) || "-",
            item_code: iCode,
            item_name: iName,
            type: "Purchase",
            entry_no: p.inward_no || `INW-${p.id}`,
            qty: Math.abs(Number(p.quantity || 0)),
          });
        });
      }

      // 3. Fetch Invoices / Sales (Outward -> Negative Qty)
      // Check invoice_items first
      const { data: invoiceItemsData, error: invItemsErr } = await sc("invoice_items")
        .select("*, invoices(invoice_no, invoice_date, created_at)");

      if (!invItemsErr && invoiceItemsData && invoiceItemsData.length > 0) {
        invoiceItemsData.forEach((invItem: any) => {
          const iName = invItem.item_name || invItem.description || "Module Part";
          const iCode =
            invItem.item_code ||
            itemMap[iName.trim().toLowerCase()] ||
            "ITM-GEN";

          combined.push({
            id: `INV-ITEM-${invItem.id}`,
            date:
              invItem.invoices?.invoice_date ||
              invItem.created_at?.slice(0, 10) ||
              "-",
            item_code: iCode,
            item_name: iName,
            type: "Sale",
            entry_no: invItem.invoices?.invoice_no || `INV-${invItem.invoice_id}`,
            qty: Math.abs(Number(invItem.quantity || 1)),
          });
        });
      } else {
        // Fallback: If items are stored directly inside invoices or as JSON
        const { data: invData } = await sc("invoices")
          .select("*")
          .order("id", { ascending: false });

        if (invData) {
          invData.forEach((inv: any) => {
            if (Array.isArray(inv.items)) {
              inv.items.forEach((it: any, idx: number) => {
                const iName = it.item_name || it.name || "Module Repair Part";
                const iCode =
                  it.item_code ||
                  itemMap[iName.trim().toLowerCase()] ||
                  "ITM-GEN";

                combined.push({
                  id: `INV-${inv.id}-${idx}`,
                  date: inv.invoice_date || inv.created_at?.slice(0, 10) || "-",
                  item_code: iCode,
                  item_name: iName,
                  type: "Sale",
                  entry_no: inv.invoice_no || `INV-${inv.id}`,
                  qty: Math.abs(Number(it.quantity || it.qty || 1)),
                });
              });
            } else if (inv.item_name) {
              const iName = inv.item_name;
              const iCode =
                inv.item_code ||
                itemMap[iName.trim().toLowerCase()] ||
                "ITM-GEN";

              combined.push({
                id: `INV-${inv.id}`,
                date: inv.invoice_date || inv.created_at?.slice(0, 10) || "-",
                item_code: iCode,
                item_name: iName,
                type: "Sale",
                entry_no: inv.invoice_no || `INV-${inv.id}`,
                qty: Math.abs(Number(inv.quantity || 1)),
              });
            }
          });
        }
      }

      // Sort by Date Descending
      combined.sort((a, b) => (a.date < b.date ? 1 : -1));
      setTransactions(combined);
    } catch (err) {
      console.error("Error loading Item In/Out data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered Ledger
  const filteredData = useMemo(() => {
    return transactions.filter((t) => {
      const q = search.trim().toLowerCase();
      const code = t.item_code.toLowerCase();
      const name = t.item_name.toLowerCase();
      const entry = t.entry_no.toLowerCase();

      const matchesSearch =
        !q || code.includes(q) || name.includes(q) || entry.includes(q);

      const matchesItem =
        selectedItem === "All" ||
        t.item_code === selectedItem ||
        t.item_name === selectedItem;

      const matchesType =
        selectedType === "All" || t.type === selectedType;

      const matchesFrom = !fromDate || t.date >= fromDate;
      const matchesTo = !toDate || t.date <= toDate;

      return (
        matchesSearch &&
        matchesItem &&
        matchesType &&
        matchesFrom &&
        matchesTo
      );
    });
  }, [transactions, search, selectedItem, selectedType, fromDate, toDate]);

  // Aggregate Movement Totals
  const qioCols = {
    date: (t: any) => String(t.transaction_date || ""),
    item_code: (t: any) => String(t.item_code || ""),
    item_name: (t: any) => String(t.item_name || ""),
    entry_no: (t: any) => String(t.entry_no || ""),
    type: (t: any) => String(t.transaction_type || ""),
    qty: (t: any) => Number(t.quantity || 0),
  } as const;
  const { sort, sorted: sortedTransactions } = useSortedRows(filteredData, qioCols, "date", "desc");

  const totals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;

    filteredData.forEach((t) => {
      if (t.type === "Purchase") {
        totalIn += t.qty;
      } else {
        totalOut += t.qty;
      }
    });

    return {
      totalIn,
      totalOut,
      netMovement: totalIn - totalOut,
    };
  }, [filteredData]);

  // Export to CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) {
      alert("एक्सपोर्ट करने के लिए कोई डेटा नहीं है!");
      return;
    }

    const headers = [
      "Date",
      "Item Code",
      "Item Name",
      "Purchase / Sale",
      "Entry Number",
      "Qty In (+)",
      "Qty Out (-)",
      "Net Flow Qty",
    ];

    const rows = filteredData.map((item) => {
      const isPurchase = item.type === "Purchase";
      const formattedQty = `${isPurchase ? "+" : "-"}${item.qty}`;

      return [
        `"${item.date}"`,
        `"${item.item_code}"`,
        `"${item.item_name}"`,
        `"${item.type}"`,
        `"${item.entry_no}"`,
        isPurchase ? item.qty : 0,
        !isPurchase ? item.qty : 0,
        `"${formattedQty}"`,
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
      `Item_Wise_Qty_In_Out_${new Date().toISOString().slice(0, 10)}.csv`
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
            Item Wise Qty In Out Report
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            Detailed inventory audit log: Purchases (Inward / +) and Sales (Outward / -).
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

      {/* SUMMARY KPI CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <SummaryCard
          title="Total Inward Qty (+)"
          value={`+${totals.totalIn.toLocaleString("en-IN")}`}
          subtitle="Stock Purchased / Added"
          background="#f0fdf4"
          textColor="#15803d"
        />
        <SummaryCard
          title="Total Outward Qty (-)"
          value={`-${totals.totalOut.toLocaleString("en-IN")}`}
          subtitle="Stock Sold / Consumed"
          background="#fef2f2"
          textColor="#b91c1c"
        />
        <SummaryCard
          title="Net Quantity Movement"
          value={`${totals.netMovement >= 0 ? "+" : ""}${totals.netMovement.toLocaleString("en-IN")}`}
          subtitle="Inward minus Outward"
          background="#eff6ff"
          textColor="#1d4ed8"
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
          placeholder="Search Item Code, Item Name, Entry No..."
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
            value={selectedItem}
            onChange={(e) => setSelectedItem(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Items</option>
            {itemsList.map((it) => (
              <option key={it.id} value={it.item_code || it.item_name || ""}>
                {it.item_code ? `${it.item_code} - ` : ""}
                {it.item_name}
              </option>
            ))}
          </select>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Movements</option>
            <option value="Purchase">Purchase (Inward +)</option>
            <option value="Sale">Sale (Outward -)</option>
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
            selectedItem !== "All" ||
            selectedType !== "All") && (
            <button
              onClick={() => {
                setSearch("");
                setFromDate("");
                setToDate("");
                setSelectedItem("All");
                setSelectedType("All");
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

      {/* REPORT DATA TABLE */}
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
                <SortTh label="Date" active={sort.key === "date"} dir={sort.dir} onToggle={() => sort.toggle("date")} style={thStyle} />
                <SortTh label="Item Code" active={sort.key === "item_code"} dir={sort.dir} onToggle={() => sort.toggle("item_code")} style={thStyle} />
                <SortTh label="Item Name" active={sort.key === "item_name"} dir={sort.dir} onToggle={() => sort.toggle("item_name")} style={thStyle} />
                <SortTh label="Purchase / Sale" active={sort.key === "type"} dir={sort.dir} onToggle={() => sort.toggle("type")} style={thStyle} />
                <SortTh label="Entry Number" active={sort.key === "entry_no"} dir={sort.dir} onToggle={() => sort.toggle("entry_no")} style={thStyle} />
                <SortTh label="Qty" active={sort.key === "qty"} dir={sort.dir} onToggle={() => sort.toggle("qty")} style={thStyle} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "#64748b",
                    }}
                  >
                    Loading inventory transactions...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: 40,
                      color: "#64748b",
                    }}
                  >
                    No transactions found.
                  </td>
                </tr>
              ) : (
sortedTransactions.map((item) => {
                  const isPurchase = item.type === "Purchase";

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        fontSize: 13,
                      }}
                    >
                      <td style={tdStyle}>{fmtDate(item.date)}</td>
                      <td style={tdStyle}>
                        <strong style={{ color: "#475569" }}>
                          {item.item_code}
                        </strong>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {item.item_name}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            background: isPurchase ? "#dcfce7" : "#fee2e2",
                            color: isPurchase ? "#166534" : "#991b1b",
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            display: "inline-block",
                          }}
                        >
                          {item.type}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <strong style={{ color: "#2563eb" }}>
                          {item.entry_no}
                        </strong>
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 800,
                          fontSize: 14,
                          color: isPurchase ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {isPurchase ? `+${item.qty}` : `-${item.qty}`}
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
          fontSize: 22,
          color: textColor,
          marginTop: 4,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
      <small
        style={{
          color: "#64748b",
          fontSize: 11,
          marginTop: 2,
          display: "block",
        }}
      >
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

export default ItemWiseQtyInOutReport;