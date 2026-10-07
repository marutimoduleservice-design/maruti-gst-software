import { sc } from "../lib/company";
import { useEffect, useState, useMemo, useRef } from "react";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Item = {
  id: number;
  item_code: string;
  item_name: string;
  unit: string | null;
  hsn_code: string | null;
  gst_percent: number | null;
  purchase_price: number | null;
  sale_price: number | null;
  opening_stock: number | null;
  min_stock: number | null;
};

// CSV Line Parser
const parseCSVLine = (text: string): string[] => {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ""));
  return result;
};

function ItemMaster() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Form States
  const [itemCode, setItemCode] = useState("ITM-0001");
  const [itemName, setItemName] = useState("");
  const [unit, setUnit] = useState("PCS");
  const [hsnCode, setHsnCode] = useState("");
  const [gstPercent, setGstPercent] = useState("18");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [minStock, setMinStock] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  // Bulk CSV State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadItems = async () => {
    setLoading(true);
    const { data, error } = await sc("items")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("Error loading items:", error);
    } else {
      const iList = (data || []) as Item[];
      setItems(iList);

      if (!editingId) {
        let maxNum = 0;
        iList.forEach((it) => {
          if (it.item_code && it.item_code.startsWith("ITM-")) {
            const num = parseInt(it.item_code.replace("ITM-", ""), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
        setItemCode(`ITM-${String(maxNum + 1).padStart(4, "0")}`);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadItems();
  }, []);

  const resetForm = () => {
    setItemName("");
    setUnit("PCS");
    setHsnCode("");
    setGstPercent("18");
    setPurchasePrice("");
    setSalePrice("");
    setOpeningStock("");
    setMinStock("");
    setEditingId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      alert("Item Name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        item_code: itemCode,
        item_name: itemName.trim(),
        unit: unit.trim() || "PCS",
        hsn_code: hsnCode.trim() || null,
        gst_percent: gstPercent ? Number(gstPercent) : 0,
        purchase_price: purchasePrice ? Number(purchasePrice) : 0,
        sale_price: salePrice ? Number(salePrice) : 0,
        opening_stock: openingStock ? Number(openingStock) : 0,
        min_stock: minStock ? Number(minStock) : 0,
      };

      if (editingId) {
        const { error } = await sc("items")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        alert("Item updated successfully!");
      } else {
        const { error } = await sc("items").insert([payload]);
        if (error) throw error;
        alert("Item saved successfully!");
      }

      resetForm();
      loadItems();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (it: Item) => {
    setEditingId(it.id);
    setItemCode(it.item_code);
    setItemName(it.item_name || "");
    setUnit(it.unit || "PCS");
    setHsnCode(it.hsn_code || "");
    setGstPercent(it.gst_percent !== null ? String(it.gst_percent) : "18");
    setPurchasePrice(it.purchase_price ? String(it.purchase_price) : "");
    setSalePrice(it.sale_price ? String(it.sale_price) : "");
    setOpeningStock(it.opening_stock ? String(it.opening_stock) : "");
    setMinStock(it.min_stock ? String(it.min_stock) : "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this item?")) return;
    const { error } = await sc("items").delete().eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadItems();
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("WARNING: Delete ALL items?")) return;
    const { error } = await sc("items").delete().neq("id", 0);
    if (error) alert("Error: " + error.message);
    else loadItems();
  };

  // Bulk Import CSV Logic
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) {
      alert("कृपया पहले एक .CSV फाइल सेलेक्ट करें।");
      return;
    }

    setSaving(true);
    const reader = new FileReader();

    reader.onerror = () => {
      alert("फाइल पढ़ने में समस्या आई!");
      setSaving(false);
    };

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) throw new Error("फाइल खाली है!");

        const rows = text
          .split(/\r?\n/)
          .map((r) => r.trim())
          .filter((r) => r.length > 0);

        if (rows.length <= 1) {
          throw new Error("फाइल में हेडर के अलावा कोई डेटा नहीं मिला।");
        }

        let maxNum = 0;
        items.forEach((it) => {
          if (it.item_code && it.item_code.startsWith("ITM-")) {
            const num = parseInt(it.item_code.replace("ITM-", ""), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });

        // CSV Column Order: Item Name, Unit, HSN Code, GST %, Purchase Price, Sale Price, Opening Stock, Min Stock
        const newItems = rows.slice(1).map((row, idx) => {
          const cols = parseCSVLine(row);
          const nextCode = `ITM-${String(maxNum + idx + 1).padStart(4, "0")}`;

          return {
            item_code: nextCode,
            item_name: cols[0]?.trim() || "Unknown Item",
            unit: cols[1]?.trim() || "PCS",
            hsn_code: cols[2]?.trim() || null,
            gst_percent: cols[3] ? Number(cols[3].replace(/[^0-9.]/g, "")) : 18,
            purchase_price: cols[4] ? Number(cols[4].replace(/[^0-9.]/g, "")) : 0,
            sale_price: cols[5] ? Number(cols[5].replace(/[^0-9.]/g, "")) : 0,
            opening_stock: cols[6] ? Number(cols[6].replace(/[^0-9.]/g, "")) : 0,
            min_stock: cols[7] ? Number(cols[7].replace(/[^0-9.]/g, "")) : 0,
          };
        });

        const { error } = await sc("items").insert(newItems);
        if (error) throw error;

        alert(`सफलतापूर्वक ${newItems.length} Items इम्पोर्ट हो गए!`);
        setCsvFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        await loadItems();
      } catch (err: any) {
        alert("Import error: " + err.message);
      } finally {
        setSaving(false);
      }
    };

    reader.readAsText(csvFile);
  };

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(
      (it) =>
        (it.item_name || "").toLowerCase().includes(q) ||
        (it.item_code || "").toLowerCase().includes(q) ||
        (it.hsn_code || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const itemCols = {
    item_code: (i: any) => String(i.item_code || ""),
    item_name: (i: any) => String(i.item_name || ""),
    unit: (i: any) => String(i.unit || "PCS"),
    hsn_code: (i: any) => String(i.hsn_code || ""),
    gst_percent: (i: any) => Number(i.gst_percent || 0),
    purchase_price: (i: any) => Number(i.purchase_price || 0),
    sale_price: (i: any) => Number(i.sale_price || 0),
    opening_stock: (i: any) => Number(i.opening_stock || 0),
    min_stock: (i: any) => Number(i.min_stock || 0),
  } as const;
  const { sort, sorted: sortedItems } = useSortedRows(filteredItems, itemCols, "item_code");

  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
          Item Master
        </h1>
        <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
          Manage products, spare parts, GST rates, and inventory thresholds.
        </p>
      </div>

      {/* ADD / EDIT ITEM CARD */}
      <div
        style={{
          background: "#fff",
          padding: 20,
          marginBottom: 20,
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
          <h2 style={{ fontSize: 16, margin: 0, color: editingId ? "#d97706" : "#0f172a" }}>
            {editingId ? `Edit Item (${itemCode})` : "Add New Item"}
          </h2>
          <div style={{ display: "flex", gap: 10 }}>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{
                  background: "#64748b",
                  color: "#fff",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: "bold",
                }}
              >
                Cancel Edit
              </button>
            )}
            <button
              onClick={handleDeleteAll}
              style={{
                background: "#dc2626",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: "bold",
              }}
            >
              🗑 Delete All Items
            </button>
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Item Code</label>
              <input
                type="text"
                value={itemCode}
                readOnly
                style={{
                  ...inputStyle,
                  background: "#f1f5f9",
                  fontWeight: "bold",
                  color: "#2563eb",
                }}
              />
            </div>
            <div>
              <label style={labelStyle}>Item Name *</label>
              <input
                type="text"
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Engine Control Module"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                style={inputStyle}
              >
                <option value="PCS">PCS</option>
                <option value="NOS">NOS</option>
                <option value="SET">SET</option>
                <option value="BOX">BOX</option>
                <option value="MTR">MTR</option>
                <option value="KG">KG</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>HSN Code</label>
              <input
                type="text"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                placeholder="e.g. 8504"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>GST Percent (%)</label>
              <select
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                style={inputStyle}
              >
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 15 }}>
            <div>
              <label style={labelStyle}>Purchase Price (₹)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Sale Price (₹)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Opening Stock</label>
              <input
                type="number"
                min="0"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Min Stock (Alert)</label>
              <input
                type="number"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="0"
                style={inputStyle}
              />
            </div>
          </div>

          <button
            type="submit"
            style={{
              width: "100%",
              background: editingId ? "#d97706" : "#2563eb",
              padding: 11,
              fontWeight: "bold",
              borderRadius: 6,
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : editingId ? "Update Item Details" : "＋ Save Item"}
          </button>
        </form>
      </div>

      {/* BULK IMPORT CSV CARD */}
      <div
        style={{
          background: "#f8fafc",
          padding: 20,
          marginBottom: 20,
          borderRadius: 14,
          border: "2px dashed #94a3b8",
        }}
      >
        <h3 style={{ fontSize: 15, margin: "0 0 6px", color: "#1e293b" }}>📂 Bulk Import Items via (.CSV File)</h3>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
          CSV Column Sequence: <code>Item Name, Unit, HSN Code, GST %, Purchase Price, Sale Price, Opening Stock, Min Stock</code>
        </p>
        <form onSubmit={handleBulkImport} style={{ display: "flex", gap: 15, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            style={{ fontSize: 13, padding: "6px", background: "#fff", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <button
            type="submit"
            style={{
              background: "#0284c7",
              padding: "9px 16px",
              borderRadius: 6,
              color: "#fff",
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
            }}
            disabled={saving || !csvFile}
          >
            {saving ? "Importing..." : "Upload & Import Excel Items"}
          </button>
        </form>
      </div>

      {/* ITEM LIST TABLE */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: 17, margin: 0 }}>Item List ({items.length})</h2>
          <input
            type="text"
            placeholder="Search Items by Name, Code, HSN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 12px", width: 280, borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
                <SortTh label="Code" active={sort.key === "item_code"} dir={sort.dir} onToggle={() => sort.toggle("item_code")} style={{ padding: 12 }} />
                <SortTh label="Item Name" active={sort.key === "item_name"} dir={sort.dir} onToggle={() => sort.toggle("item_name")} style={{ padding: 12 }} />
                <SortTh label="Unit" active={sort.key === "unit"} dir={sort.dir} onToggle={() => sort.toggle("unit")} style={{ padding: 12 }} />
                <SortTh label="HSN" active={sort.key === "hsn_code"} dir={sort.dir} onToggle={() => sort.toggle("hsn_code")} style={{ padding: 12 }} />
                <SortTh label="GST %" active={sort.key === "gst_percent"} dir={sort.dir} onToggle={() => sort.toggle("gst_percent")} style={{ padding: 12 }} align="right" />
                <SortTh label="Purchase Price" active={sort.key === "purchase_price"} dir={sort.dir} onToggle={() => sort.toggle("purchase_price")} style={{ padding: 12 }} align="right" />
                <SortTh label="Sale Price" active={sort.key === "sale_price"} dir={sort.dir} onToggle={() => sort.toggle("sale_price")} style={{ padding: 12 }} align="right" />
                <SortTh label="Opening Stock" active={sort.key === "opening_stock"} dir={sort.dir} onToggle={() => sort.toggle("opening_stock")} style={{ padding: 12 }} align="right" />
                <SortTh label="Min Stock" active={sort.key === "min_stock"} dir={sort.dir} onToggle={() => sort.toggle("min_stock")} style={{ padding: 12 }} align="right" />
                <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
                    Loading items...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
                    No items found.
                  </td>
                </tr>
              ) : (
                sortedItems.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={{ padding: 12 }}>
                      <strong style={{ color: "#2563eb" }}>{it.item_code}</strong>
                    </td>
                    <td style={{ padding: 12 }}>
                      <strong>{it.item_name}</strong>
                    </td>
                    <td style={{ padding: 12 }}>{it.unit || "PCS"}</td>
                    <td style={{ padding: 12 }}>{it.hsn_code || "—"}</td>
                    <td style={{ padding: 12 }}>{it.gst_percent || 0}%</td>
                    <td style={{ padding: 12 }}>₹{(it.purchase_price || 0).toLocaleString("en-IN")}</td>
                    <td style={{ padding: 12 }}>₹{(it.sale_price || 0).toLocaleString("en-IN")}</td>
                    <td style={{ padding: 12 }}>
                      <strong>{it.opening_stock || 0}</strong>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span
                        style={{
                          color: (it.opening_stock || 0) <= (it.min_stock || 0) && (it.min_stock || 0) > 0 ? "#dc2626" : "#0f172a",
                          fontWeight: (it.opening_stock || 0) <= (it.min_stock || 0) && (it.min_stock || 0) > 0 ? "bold" : "normal",
                        }}
                      >
                        {it.min_stock || 0}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          onClick={() => handleEdit(it)}
                          style={{
                            background: "#f97316",
                            color: "#fff",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(it.id)}
                          style={{
                            background: "#dc2626",
                            color: "#fff",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Delete
                        </button>
                      </div>
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

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: "bold",
  display: "block",
  marginBottom: 4,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  fontSize: 14,
  outline: "none",
};

export default ItemMaster;