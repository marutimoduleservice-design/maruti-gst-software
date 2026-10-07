import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Customer = {
  id: number;
  customer_name: string;
  business_name?: string;
  mobile: string;
  payment_term?: string | null;
};

type Item = {
  id: number;
  item_code: string;
  item_name: string;
  unit: string | null;
  purchase_price: number | null;
  sale_price: number | null;
};

function CustomerWisePrice() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [prices, setPrices] = useState<Record<number, string>>({});

  const loadData = async () => {
    setLoading(true);
    const [custRes, itemRes] = await Promise.all([
      sc("customers").select("*").order("business_name"),
      sc("items").select("*").order("item_name"),
    ]);
    if (custRes.error) console.error("Customer load error:", custRes.error);
    if (itemRes.error) console.error("Item load error:", itemRes.error);
    setCustomers((custRes.data || []) as Customer[]);
    setItems((itemRes.data || []) as Item[]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadCustomerPrices = async (customerId: string) => {
    setPrices({});
    if (!customerId) return;
    const { data, error } = await sc("customer_item_prices")
      .select("*")
      .eq("customer_id", customerId);
    if (error) {
      console.error("Price load error:", error);
      return;
    }
    const map: Record<number, string> = {};
    (data || []).forEach((row: any) => {
      map[Number(row.item_id)] = String(row.agreed_rate ?? "");
    });
    setPrices(map);
  };

  const handleCustomerSelect = (value: string) => {
    setSelectedCustomerId(value);
    loadCustomerPrices(value);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.item_name.toLowerCase().includes(q) ||
        (it.item_code || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const cwpCols = {
    item_code: (i: any) => String(i.item_code || ""),
    item_name: (i: any) => String(i.item_name || ""),
    unit: (i: any) => String(i.unit || "PCS"),
    purchase_price: (i: any) => Number(i.purchase_price || 0),
    sale_price: (i: any) => Number(i.sale_price || 0),
    customer_price: (i: any) => Number(prices[i.id] || 0),
  } as const;
  const { sort, sorted: sortedItems } = useSortedRows(filteredItems, cwpCols, "item_code");

  const handleSave = async () => {
    if (!selectedCustomerId) {
      alert("Pehle customer select karo.");
      return;
    }
    setSaving(true);
    try {
      const customerId = Number(selectedCustomerId);
      const { data: existingRows, error: loadErr } = await sc("customer_item_prices")
        .select("id, item_id")
        .eq("customer_id", customerId);
      if (loadErr) throw loadErr;
      const existingIds = new Map<number, number>();
      (existingRows || []).forEach((row: any) => {
        existingIds.set(Number(row.item_id), Number(row.id));
      });

      for (const item of items) {
        const raw = (prices[item.id] || "").trim();
        const numericVal = raw === "" ? NaN : Number(raw);
        const value = isNaN(numericVal) || !(numericVal >= 0) ? null : numericVal;
        const oldRowId = existingIds.get(item.id);

        if (value === null) {
          if (oldRowId) {
            const { error: delErr } = await sc("customer_item_prices")
              .delete()
              .eq("id", oldRowId);
            if (delErr) throw delErr;
          }
        } else {
          const { error } = await sc("customer_item_prices").upsert(
            {
              customer_id: customerId,
              item_id: item.id,
              agreed_rate: value,
              active: true,
              effective_from: new Date().toISOString().split("T")[0],
            },
            { onConflict: "customer_id,item_id" }
          );
          if (error) throw error;
        }
      }
      alert("Customer wise prices saved successfully!");
    } catch (err: any) {
      console.error("Save error:", err);
      alert("Save failed: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "18px 20px" }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 18, margin: 0, marginBottom: 4 }}>Customer Wise Price</h2>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          Customer select karo aur har item ka us customer ke liye special sale price set karo. Invoice banate samay yahi rate apply hoga.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <select
            value={selectedCustomerId}
            onChange={(e) => handleCustomerSelect(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              minWidth: 300,
              background: "#fff",
            }}
          >
            <option value="">-- Select Customer --</option>
            {customers.map((cus) => (
              <option key={cus.id} value={cus.id}>
                {cus.business_name || cus.customer_name}
                {cus.mobile ? ` (${cus.mobile})` : ""}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search Item by Name / Code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 12px", width: 270, borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <button
            onClick={handleSave}
            disabled={saving || !selectedCustomerId}
            style={{
              background: "#f97316",
              color: "#fff",
              border: "none",
              padding: "9px 18px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: 14,
              opacity: saving || !selectedCustomerId ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Prices"}
          </button>
        </div>
      </div>

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
            padding: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <h3 style={{ fontSize: 15, margin: 0 }}>
            Items ({filteredItems.length})
          </h3>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Blank price = Item Master ka default Sale Price use hoga
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
                <SortTh label="Code" active={sort.key === "item_code"} dir={sort.dir} onToggle={() => sort.toggle("item_code")} style={{ padding: 12 }} />
                <SortTh label="Item Name" active={sort.key === "item_name"} dir={sort.dir} onToggle={() => sort.toggle("item_name")} style={{ padding: 12 }} />
                <SortTh label="Unit" active={sort.key === "unit"} dir={sort.dir} onToggle={() => sort.toggle("unit")} style={{ padding: 12 }} />
                <SortTh label="Purchase Price" active={sort.key === "purchase_price"} dir={sort.dir} onToggle={() => sort.toggle("purchase_price")} style={{ padding: 12 }} align="right" />
                <SortTh label="Default Sale Price" active={sort.key === "sale_price"} dir={sort.dir} onToggle={() => sort.toggle("sale_price")} style={{ padding: 12 }} align="right" />
                <SortTh label="Customer Wise Price" active={sort.key === "customer_price"} dir={sort.dir} onToggle={() => sort.toggle("customer_price")} style={{ padding: 12 }} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
                    Loading items...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
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
                    <td style={{ padding: 12 }}>₹{(it.purchase_price || 0).toLocaleString("en-IN")}</td>
                    <td style={{ padding: 12 }}>₹{(it.sale_price || 0).toLocaleString("en-IN")}</td>
                    <td style={{ padding: 12 }}>
                      <input
                        type="number"
                        placeholder={String(it.sale_price ?? "")}
                        value={prices[it.id] ?? ""}
                        disabled={!selectedCustomerId}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [it.id]: e.target.value }))
                        }
                        style={{
                          width: 130,
                          padding: "7px 9px",
                          border: "1px solid #cbd5e1",
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
        Tip: Invoicing ke samay is customer ke liye spare part select karte hi yahan set kiye gaye rate apne aap apply ho jayenge.
      </p>
    </div>
  );
}

export default CustomerWisePrice;