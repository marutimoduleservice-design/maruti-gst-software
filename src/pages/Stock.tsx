import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { SortTh, useSortedRows } from "../lib/tableSort";

type ItemRecord = {
  id: number;
  item_code: string | null;
  item_name: string;
  category?: string | null;
  unit?: string | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  cost_price?: number | null;
  opening_stock?: number | null;
  min_stock?: number | null;
};

type StockDisplayItem = {
  id: number | string;
  item_code: string;
  item_name: string;
  category: string;
  opening_qty: number;
  inward_qty: number;   // Total Purchased + Job Card Received
  outward_qty: number;  // Total Sold
  current_stock: number; // Opening + Inward - Outward
  rate: number;
  stock_value: number;  // current_stock * rate
  suggested_min?: number; // Auto-suggested reorder level
  min_stock?: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
};

function Stock() {
  const [stockList, setStockList] = useState<StockDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedCategory] = useState("All");

  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedItemName, setSelectedItemName] = useState("All");

  // Auto Suggest Min Stock - analysis state
  const [suggestedMin, setSuggestedMin] = useState<Record<number, number>>({});
  const [safetyDays, setSafetyDays] = useState(7);
  const [autoLoading, setAutoLoading] = useState(false);

  const loadStockData = async () => {
    setLoading(true);

    try {
      // 1. Fetch Item Master
      let { data: itemsData } = await sc("items")
        .select("*")
        .order("id", { ascending: true });

      if (!itemsData || itemsData.length === 0) {
        const fallback = await sc("item_master").select("*");
        if (fallback.data) itemsData = fallback.data;
      }

      const allItems: ItemRecord[] = (itemsData || []) as ItemRecord[];

      // 2. Fetch All Purchases (Inward Stock)
      const { data: purchaseData } = await sc("purchases")
        .select("inward_no, item_name, item_code, quantity, rate");

      // 3. Fetch All Sales / Invoices (Outward Stock)
      let { data: invoiceItemsData } = await sc("invoice_items")
        .select("inward_no, item_name, quantity");

      let invoiceFallback: any[] = [];
      if (!invoiceItemsData || invoiceItemsData.length === 0) {
        const { data: invData } = await sc("invoices").select("*");
        if (invData) invoiceFallback = invData;
      }

      // 4. Fetch Job Cards (Inward Stock for Repairing, Warranty & Reject Modules)
      let jobCardsData: any[] = [];
      try {
        const { data: jcData } = await sc("job_cards").select("*");
        if (jcData) jobCardsData = jcData;
      } catch (e) {
        console.log("Job cards fetch error:", e);
      }

      // Matcher helper function to find exact item in Item Master
      const findItem = (name?: string | null, code?: string | null) => {
        const cleanName = (name || "").trim().toLowerCase();
        const cleanCode = (code || "").trim().toLowerCase();

        return allItems.find((it) => {
          const itName = (it.item_name || "").trim().toLowerCase();
          const itCode = (it.item_code || "").trim().toLowerCase();

          if (cleanCode && itCode && cleanCode === itCode) return true;
          if (cleanName && itName && cleanName === itName) return true;
          return false;
        });
      };

      // Inward-level tracking: key = "inward_no|item_id" => { qty, rate }
      interface InwardEntry { qty: number; rate: number; value: number; }
      const inwardMap: Record<string, InwardEntry> = {};
      const outwardByItemId: Record<number, number> = {};
      const inwardByItemId: Record<number, number> = {};

      const inwardKey = (inwardNo: string, itemId: number) => `${String(inwardNo).trim().toLowerCase()}|${itemId}`;

      // Calculate Purchases (INWARD) - Har inward_no ke liye alag track
      (purchaseData || []).forEach((p: any) => {
        const qty = Number(p.quantity || 0);
        const rate = Number(p.rate || 0);
        const matched = findItem(p.item_name, p.item_code);
        const inwNo = String(p.inward_no || p.purchase_no || "").trim();

        if (matched && inwNo) {
          const key = inwardKey(inwNo, matched.id);
          const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
          inwardMap[key] = {
            qty: prev.qty + qty,
            rate: rate > 0 ? rate : prev.rate,
            value: prev.value + qty * rate,
          };
          inwardByItemId[matched.id] = (inwardByItemId[matched.id] || 0) + qty;
        }
      });

      // Calculate Job Cards (INWARD for Modules) - Job Card aane par stock IN hoga
      const moduleServiceItem = findItem("Module Service") || allItems.find((it) => (it.item_name || "").toLowerCase().includes("module service"));
      const warrantyServiceItem = findItem("Warranty Service") || allItems.find((it) => (it.item_name || "").toLowerCase().includes("warranty service"));
      const rejectModuleItem = findItem("Reject Module") || allItems.find((it) => (it.item_name || "").toLowerCase().includes("reject module"));

      (jobCardsData || []).forEach((jc: any) => {
        const repairingQty = Number(jc.repairing_qty ?? jc.repair_qty ?? jc.repairing_quantity ?? 0);
        const warrantyQty = Number(jc.warranty_qty ?? jc.warranty_quantity ?? 0);
        const rejectQty = Number(jc.reject_qty ?? jc.reject_quantity ?? 0);

        if (moduleServiceItem && repairingQty > 0) {
          const key = inwardKey("JOB-REP", moduleServiceItem.id);
          const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
          const r = prev.rate || Number(moduleServiceItem.purchase_price || 0) || 50;
          inwardMap[key] = { qty: prev.qty + repairingQty, rate: r, value: prev.value + repairingQty * r };
          inwardByItemId[moduleServiceItem.id] = (inwardByItemId[moduleServiceItem.id] || 0) + repairingQty;
        }
        if (warrantyServiceItem && warrantyQty > 0) {
          const key = inwardKey("JOB-WAR", warrantyServiceItem.id);
          const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
          const r = prev.rate || Number(warrantyServiceItem.purchase_price || 0);
          inwardMap[key] = { qty: prev.qty + warrantyQty, rate: r, value: prev.value + warrantyQty * r };
          inwardByItemId[warrantyServiceItem.id] = (inwardByItemId[warrantyServiceItem.id] || 0) + warrantyQty;
        }
        if (rejectModuleItem && rejectQty > 0) {
          const key = inwardKey("JOB-REJ", rejectModuleItem.id);
          const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
          const r = prev.rate || Number(rejectModuleItem.purchase_price || 0);
          inwardMap[key] = { qty: prev.qty + rejectQty, rate: r, value: prev.value + rejectQty * r };
          inwardByItemId[rejectModuleItem.id] = (inwardByItemId[rejectModuleItem.id] || 0) + rejectQty;
        }

        // Generic items list support agar job card me items array ho
        if (Array.isArray(jc.items)) {
          jc.items.forEach((it: any) => {
            const qty = Number(it.quantity || it.qty || 1);
            const matched = findItem(it.item_name || it.name, it.item_code);
            if (matched) {
              const key = inwardKey(`JOB-${matched.id}`, matched.id);
              const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
              const r = prev.rate || Number(matched.purchase_price || 0);
              inwardMap[key] = { qty: prev.qty + qty, rate: r, value: prev.value + qty * r };
              inwardByItemId[matched.id] = (inwardByItemId[matched.id] || 0) + qty;
            }
          });
        }
      });

      // Calculate Sales (OUTWARD) - Har inward_no se sold qty subtract
      (invoiceItemsData || []).forEach((inv: any) => {
        const qty = Number(inv.quantity || 0);
        const matched = findItem(inv.item_name, inv.item_code);
        const inwNo = String(inv.inward_no || "").trim();

        if (matched) {
          outwardByItemId[matched.id] = (outwardByItemId[matched.id] || 0) + qty;
          // JOB inward se sold hona normal nahi hai, skip
          if (inwNo && !inwNo.startsWith("JOB-")) {
            const key = inwardKey(inwNo, matched.id);
            if (inwardMap[key]) {
              const entry = inwardMap[key];
              const before = entry.qty;
              const sold = Math.min(qty, before);
              entry.qty = Math.max(0, before - sold);
              entry.value = before > 0 ? entry.value * (entry.qty / before) : 0;
            }
          }
        }
      });

      invoiceFallback.forEach((inv: any) => {
        if (Array.isArray(inv.items)) {
          inv.items.forEach((it: any) => {
            const qty = Number(it.quantity || it.qty || 1);
            const matched = findItem(it.item_name || it.name, it.item_code);
            if (matched) {
              outwardByItemId[matched.id] = (outwardByItemId[matched.id] || 0) + qty;
            }
          });
        } else if (inv.item_name) {
          const qty = Number(inv.quantity || 1);
          const matched = findItem(inv.item_name, inv.item_code);
          if (matched) {
            outwardByItemId[matched.id] = (outwardByItemId[matched.id] || 0) + qty;
          }
        }
      });

      // Build Processed Stock List - Inward-level stock valuation
      const serviceItemNames = ["module service", "warranty service", "reject module"];
      const isServiceItem = (name: string) => serviceItemNames.some((s) => name.toLowerCase().includes(s));

      const processedStock: StockDisplayItem[] = allItems.map((it) => {
        const opening = Number(it.opening_stock || 0);
        const inward = inwardByItemId[it.id] || 0;
        const outward = outwardByItemId[it.id] || 0;
        const currentStock = opening + inward - outward;

        // Stock value = remaining inward batch values + remaining opening stock value.
        // Sales pehle inward batch se katte hain, uske baad opening stock se — value
        // bhi wahi order follow karti hai. Pehle sirf batch values lete the, jisse
        // item ka pehla inward aate hi opening stock ki value gayab ho jati thi.
        let stockValue = 0;
        if (!isServiceItem(it.item_name)) {
          const itemInwardEntries = Object.entries(inwardMap).filter(([key]) => key.endsWith(`|${it.id}`));
          let batchQtyLeft = 0;
          for (const [, entry] of itemInwardEntries) {
            batchQtyLeft += Math.max(0, Number(entry.qty || 0));
            stockValue += Math.max(0, Number(entry.value || 0));
          }
          // Jo qty batch se nahi kat payi, wo opening stock se kati.
          const remainingOpening = Math.max(0, currentStock - batchQtyLeft);
          const openingRate = Number(it.purchase_price || 0) || Number(it.cost_price || 0);
          stockValue += remainingOpening * openingRate;
        }

        const candidateRates = [
          Number(it.purchase_price || 0),
          Number(it.cost_price || 0),
        ];
        const rate = candidateRates.find((candidate) => candidate > 0) || 0;

        let status: "In Stock" | "Low Stock" | "Out of Stock" = "In Stock";
        const minLevel = suggestedMin[it.id] ?? Number(it.min_stock || 5);
        if (currentStock <= 0) status = "Out of Stock";
        else if (currentStock <= minLevel) status = "Low Stock";

        return {
          id: it.id,
          item_code: it.item_code || `ITM-${it.id}`,
          item_name: it.item_name,
          category: it.category || "Module Parts",
          opening_qty: opening,
          inward_qty: inward,
          outward_qty: outward,
          current_stock: currentStock,
          rate: rate,
          stock_value: stockValue,
          suggested_min: suggestedMin[it.id] || undefined,
          min_stock: Number(it.min_stock || 0),
          status: status,
        };
      });

      setStockList(processedStock);
    } catch (err) {
      console.error("Error loading live stock data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStockData();
  }, []);

  // Auto Suggest Min Stock - analyze last 60 days sales and propose reorder level
  const runAutoSuggest = async () => {
    setAutoLoading(true);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(safetyDays || 7));
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      let { data: itemsData } = await sc("items").select("id, item_name, item_code");
      if (!itemsData || itemsData.length === 0) {
        const fallback = await sc("item_master").select("*");
        if (fallback.data) itemsData = fallback.data;
      }
      const itemMaster = (itemsData || []) as { id: number; item_name: string; item_code: string | null }[];

      const { data: invoiceData } = await sc("invoices")
        .select("id, invoice_date");

      const { data: invoiceItemsData } = await sc("invoice_items")
        .select("invoice_id, item_name, quantity");

      const dateById = new Map<number, string>();
      (invoiceData || []).forEach((inv: any) => dateById.set(Number(inv.id), String(inv.invoice_date || "")));

      const soldQty = new Map<number, number>();
      (invoiceItemsData || []).forEach((it: any) => {
        const dateStr = dateById.get(Number(it.invoice_id)) || "";
        if (dateStr && dateStr >= cutoffStr) {
          const keyName = String(it.item_name || "").trim().toLowerCase();
          const keyCode = String(it.item_code || "").trim().toLowerCase();
          const item = itemMaster.find((im) =>
            (keyCode && im.item_code && im.item_code.trim().toLowerCase() === keyCode) ||
            (keyName && im.item_name.trim().toLowerCase() === keyName)
          );
          if (item) {
            soldQty.set(Number(item.id), (soldQty.get(Number(item.id)) || 0) + Number(it.quantity || 0));
          }
        }
      });

      const avgCount = Math.max(1, Number(safetyDays || 7));
      const suggestions: Record<number, number> = {};
      soldQty.forEach((total, itemId) => {
        const avgDaily = total / avgCount;
        const suggested = Math.max(1, Math.ceil(avgDaily * 7));
        suggestions[itemId] = suggested;
      });
      setSuggestedMin(suggestions);
      const newItems = Object.keys(suggestions).length;
      alert(newItems === 0
        ? "Pichle " + safetyDays + " din me koi sale nahi mili — auto-suggest ke liye sale data chahiye."
        : `Auto Suggest complete: ${newItems} items ke liye suggested Min Stock nikala. "Apply Min Stock" button se save karein.`);
    } catch (err) {
      console.error("Auto suggest error:", err);
      alert("Auto Suggest error: " + (err as any).message);
    } finally {
      setAutoLoading(false);
    }
  };

  const applySuggestedMins = async () => {
    const entries = Object.entries(suggestedMin);
    if (entries.length === 0) {
      alert("Pehle Auto Suggest chalao.");
      return;
    }
    let ok = 0;
    for (const [idStr, suggested] of entries) {
      const { error } = await sc("items")
        .update({ min_stock: suggested })
        .eq("id", Number(idStr));
      if (!error) ok++;
    }
    alert(`Apply complete: ${ok}/${entries.length} items ka Min Stock update ho gaya.`);
    setSuggestedMin({});
    loadStockData();
  };

  // Filter Data
  const itemNameOptions = useMemo(() => {
    const names = Array.from(new Set(stockList.map((i) => i.item_name).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
    return names;
  }, [stockList]);

  const filteredData = useMemo(() => {
    return stockList.filter((item) => {
      const q = search.trim().toLowerCase();
      const code = item.item_code.toLowerCase();
      const name = item.item_name.toLowerCase();
      const cat = item.category.toLowerCase();

      const matchesSearch = !q || code.includes(q) || name.includes(q) || cat.includes(q);
      const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
      const matchesStatus = selectedStatus === "All" || item.status === selectedStatus;
      const matchesItemName = selectedItemName === "All" || item.item_name === selectedItemName;

      return matchesSearch && matchesCategory && matchesStatus && matchesItemName;
    });
  }, [stockList, search, selectedCategory, selectedStatus, selectedItemName]);

  const stockCols = {
    item_code: (s: any) => String(s.item_code || ""),
    item_name: (s: any) => String(s.item_name || ""),
    opening_qty: (s: any) => Number(s.opening_qty || 0),
    inward_qty: (s: any) => Number(s.inward_qty || 0),
    outward_qty: (s: any) => Number(s.outward_qty || 0),
    current_stock: (s: any) => Number(s.current_stock || 0),
    min_stock: (s: any) => Number(s.min_stock || 0),
    suggested_min: (s: any) => Number(s.suggested_min ?? 0),
    stock_value: (s: any) => Number(s.stock_value || 0),
    status: (s: any) => String(s.status || ""),
  } as const;
  const { sort, sorted: sortedStock } = useSortedRows(filteredData, stockCols, "item_name");

  // Totals
  const totals = useMemo(() => {
    return filteredData.reduce(
      (acc, item) => ({
        totalQty: acc.totalQty + item.current_stock,
        totalValue: acc.totalValue + item.stock_value,
        inwardQty: acc.inwardQty + item.inward_qty,
        outwardQty: acc.outwardQty + item.outward_qty,
      }),
      { totalQty: 0, totalValue: 0, inwardQty: 0, outwardQty: 0 }
    );
  }, [filteredData]);

  // Export CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) {
      alert("कोई डेटा नहीं है!");
      return;
    }

    const headers = [
      "Item Code",
      "Item Name",
      "Category",
      "Opening Qty",
      "Inward (Purchased)",
      "Outward (Sold)",
      "Current Stock",
      "Total Stock Value (₹)",
      "Stock Status",
    ];

    const rows = filteredData.map((item) => [
      `"${item.item_code}"`,
      `"${item.item_name}"`,
      `"${item.category}"`,
      item.opening_qty,
      item.inward_qty,
      item.outward_qty,
      item.current_stock,
      item.stock_value.toFixed(2),
      `"${item.status}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `Live_Stock_Report_${new Date().toISOString().slice(0, 10)}.csv`
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
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Live Stock & Inventory Valuation
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            लाइव फॉर्मूला: <strong>Current Stock = Opening + Purchases (Inward) - Sales (Outward)</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={loadStockData}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🔄 Refresh Stock
          </button>
          <button
            onClick={runAutoSuggest}
            disabled={autoLoading}
            style={{
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: autoLoading ? "wait" : "pointer",
            }}
          >
            {autoLoading ? "⚡ Analyzing..." : "⚡ Auto Suggest Min Stock"}
          </button>
          {Object.keys(suggestedMin).length > 0 && (
            <button
              onClick={applySuggestedMins}
              style={{
                background: "#059669",
                color: "#fff",
                border: "none",
                padding: "9px 16px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              ✅ Apply ({Object.keys(suggestedMin).length})
            </button>
          )}
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
            }}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div style={kpiBoxStyle("#eff6ff")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total In-Hand Stock</span>
          <strong style={{ fontSize: 22, color: "#1e40af", display: "block", marginTop: 4 }}>
            {totals.totalQty.toLocaleString("en-IN")} Units
          </strong>
          <small style={{ color: "#64748b", fontSize: 11 }}>Across all active parts</small>
        </div>

        <div style={kpiBoxStyle("#f0fdf4")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Inward (Purchased)</span>
          <strong style={{ fontSize: 22, color: "#15803d", display: "block", marginTop: 4 }}>
            +{totals.inwardQty.toLocaleString("en-IN")} Units
          </strong>
          <small style={{ color: "#64748b", fontSize: 11 }}>Live from Purchases</small>
        </div>

        <div style={kpiBoxStyle("#fef2f2")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Outward (Sold)</span>
          <strong style={{ fontSize: 22, color: "#b91c1c", display: "block", marginTop: 4 }}>
            -{totals.outwardQty.toLocaleString("en-IN")} Units
          </strong>
          <small style={{ color: "#64748b", fontSize: 11 }}>Live from Invoices</small>
        </div>

        <div style={kpiBoxStyle("#fff7ed")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Stock Valuation</span>
          <strong style={{ fontSize: 22, color: "#c2410c", display: "block", marginTop: 4 }}>
            ₹ {totals.totalValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
          <small style={{ color: "#64748b", fontSize: 11 }}>Current Asset Value</small>
        </div>
      </div>

      {/* FILTER BAR */}
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
          placeholder="Search Item Name, Code..."
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

        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
            Analysis Days:
            <select
              value={safetyDays}
              onChange={(e) => setSafetyDays(Number(e.target.value))}
              style={filterInputStyle}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
            Item Name:
            <select
              value={selectedItemName}
              onChange={(e) => setSelectedItemName(e.target.value)}
              style={{ ...filterInputStyle, minWidth: 220, maxWidth: 320 }}
            >
              <option value="All">All Items ({stockList.length})</option>
              {itemNameOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Stock Levels</option>
            <option value="In Stock">In Stock</option>
            <option value="Low Stock">Low Stock</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>

          {(search || selectedStatus !== "All" || selectedItemName !== "All") && (
            <button
              onClick={() => {
                setSearch("");
                setSelectedStatus("All");
                setSelectedItemName("All");
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

          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700, alignSelf: "center" }}>
            {filteredData.length} of {stockList.length} items
          </span>
        </div>
      </div>

      {/* STOCK TABLE */}
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
                <SortTh label="Item Code" active={sort.key === "item_code"} dir={sort.dir} onToggle={() => sort.toggle("item_code")} style={thStyle} />
                <SortTh label="Item Name" active={sort.key === "item_name"} dir={sort.dir} onToggle={() => sort.toggle("item_name")} style={thStyle} />
                <SortTh label="Opening" active={sort.key === "opening_qty"} dir={sort.dir} onToggle={() => sort.toggle("opening_qty")} style={thStyle} align="right" />
                <SortTh label="Inward (+)" active={sort.key === "inward_qty"} dir={sort.dir} onToggle={() => sort.toggle("inward_qty")} style={{ ...thStyle, textAlign: "right", color: "#16a34a" }} align="right" />
                <SortTh label="Outward (-)" active={sort.key === "outward_qty"} dir={sort.dir} onToggle={() => sort.toggle("outward_qty")} style={{ ...thStyle, textAlign: "right", color: "#dc2626" }} align="right" />
                <SortTh label="Current Stock" active={sort.key === "current_stock"} dir={sort.dir} onToggle={() => sort.toggle("current_stock")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                <SortTh label="Min Stock" active={sort.key === "min_stock"} dir={sort.dir} onToggle={() => sort.toggle("min_stock")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                <SortTh label="Suggested Min" active={sort.key === "suggested_min"} dir={sort.dir} onToggle={() => sort.toggle("suggested_min")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                <SortTh label="Stock Value" active={sort.key === "stock_value"} dir={sort.dir} onToggle={() => sort.toggle("stock_value")} style={{ ...thStyle, textAlign: "right" }} align="right" />
                <SortTh label="Status" active={sort.key === "status"} dir={sort.dir} onToggle={() => sort.toggle("status")} style={{ ...thStyle, textAlign: "center" }} align="center" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Calculating stock from Purchases and Sales...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    No stock records found.
                  </td>
                </tr>
              ) : (
                sortedStock.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={tdStyle}>
                      <strong style={{ color: "#2563eb" }}>{item.item_code}</strong>
                    </td>
                    <td style={tdStyle}>
                      <strong style={{ color: "#0f172a" }}>{item.item_name}</strong>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>
                      {item.opening_qty}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                      +{item.inward_qty}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                      -{item.outward_qty}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, fontSize: 14 }}>
                      {item.current_stock}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>
                      {Number(item.min_stock || 0)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {item.suggested_min !== undefined ? (
                        <strong style={{ color: "#7c3aed" }}>{item.suggested_min} ⚡</strong>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                      ₹ {item.stock_value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span
                        style={{
                          background:
                            item.status === "In Stock"
                              ? "#dcfce7"
                              : item.status === "Low Stock"
                              ? "#fef3c7"
                              : "#fee2e2",
                          color:
                            item.status === "In Stock"
                              ? "#166534"
                              : item.status === "Low Stock"
                              ? "#92400e"
                              : "#991b1b",
                          padding: "4px 10px",
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 700,
                          display: "inline-block",
                        }}
                      >
                        {item.status}
                      </span>
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

const filterInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

export default Stock;