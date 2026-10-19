import { useEffect, useMemo, useState } from "react";
import { sc, getCompanyId } from "../lib/company";
import { supabase } from "../lib/supabase";
import { fmtDate } from "../lib/formatDate";

type ItemRecord = {
  id: number;
  item_code: string | null;
  item_name: string;
  opening_stock?: number | null;
  purchase_price?: number | null;
  cost_price?: number | null;
};

type BomRow = {
  parent_item_id: number;
  child_item_id: number;
  quantity: number;
};

type AssemblyRecord = {
  id: number;
  assembly_no: string;
  assembly_date: string;
  set_item_id: number;
  set_item_name: string;
  set_item_code: string;
  set_quantity: number;
  set_rate: number;
  total_cost: number;
  remarks: string;
  created_at?: string;
};

type AssemblyItemRecord = {
  id: number;
  assembly_id: number;
  component_item_name: string;
  component_item_code: string;
  component_inward_no: string;
  quantity: number;
  rate: number;
};

type PurchaseRecord = {
  id: number;
  inward_no: string | null;
  purchase_no?: string | null;
  item_name: string | null;
  item_code?: string | null;
  quantity: number | null;
  rate?: number | null;
};

type SoldRecord = {
  inward_no: string | null;
  item_name: string | null;
  quantity: number | null;
};

const lineKey = (inwardNo: unknown, itemName: unknown) =>
  `${String(inwardNo || "").trim().toLowerCase()}|${String(itemName || "").trim().toLowerCase()}`;

const digitsOf = (value: unknown) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
};

const matchesItem = (item: ItemRecord, itemName?: string | null, itemCode?: string | null) => {
  const cleanName = String(itemName || "").trim().toLowerCase();
  const cleanCode = String(itemCode || "").trim().toLowerCase();
  const ownName = String(item.item_name || "").trim().toLowerCase();
  const ownCode = String(item.item_code || "").trim().toLowerCase();
  if (cleanCode && ownCode && cleanCode === ownCode) return true;
  if (cleanName && ownName && cleanName === ownName) return true;
  return false;
};

function BomAssembly() {
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [sold, setSold] = useState<SoldRecord[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyRecord[]>([]);
  const [assemblyItems, setAssemblyItems] = useState<AssemblyItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [selectedSetId, setSelectedSetId] = useState("");
  const [qty, setQty] = useState("1");
  const [remarks, setRemarks] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        sc("items").select("id, item_code, item_name, opening_stock, purchase_price, cost_price").order("item_name"),
        sc("item_bom").select("parent_item_id, child_item_id, quantity"),
        sc("purchases").select("id, inward_no, purchase_no, item_name, item_code, quantity, rate"),
        sc("invoice_items").select("inward_no, item_name, quantity"),
        sc("bom_assemblies").select("*").order("id", { ascending: false }).limit(20),
        sc("bom_assembly_items").select("id, assembly_id, component_item_name, component_item_code, component_inward_no, quantity, rate"),
      ]);

      const [itemRes, bomRes, purRes, soldRes, asmRes, asmItemRes] = results;
      if (itemRes.data) setItems(itemRes.data as ItemRecord[]);
      if (!bomRes.error && bomRes.data) {
        setBoms(
          (bomRes.data as any[]).map((b) => ({
            parent_item_id: Number(b.parent_item_id),
            child_item_id: Number(b.child_item_id),
            quantity: Number(b.quantity) || 1,
          })),
        );
      }
      if (purRes.data) setPurchases(purRes.data as PurchaseRecord[]);
      if (soldRes.data) setSold(soldRes.data as SoldRecord[]);
      if (asmRes.data) setAssemblies(asmRes.data as AssemblyRecord[]);
      if (asmItemRes.data) setAssemblyItems(asmItemRes.data as AssemblyItemRecord[]);
    } catch (err) {
      console.error("BOM load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Set/Kit dropdown me Item Master ke saare items, alphabetically (A->Z)
  const setOptions = useMemo(() => {
    return [...items].sort((a, b) =>
      String(a.item_name || "").localeCompare(String(b.item_name || ""), "en", { sensitivity: "base" }),
    );
  }, [items]);

  const childrenByParent = useMemo(() => {
    const map = new Map<number, { childId: number; qty: number }[]>();
    boms.forEach((b) => {
      const list = map.get(b.parent_item_id) || [];
      list.push({ childId: b.child_item_id, qty: b.quantity > 0 ? b.quantity : 1 });
      map.set(b.parent_item_id, list);
    });
    return map;
  }, [boms]);

  const soldByKey = useMemo(() => {
    const map: Record<string, number> = {};
    sold.forEach((row) => {
      if (row.inward_no && String(row.inward_no).startsWith("JOB-")) return;
      const key = lineKey(row.inward_no, row.item_name);
      map[key] = (map[key] || 0) + Number(row.quantity || 0);
    });
    return map;
  }, [sold]);

  // Assembly jo components already kha chuki hai (batch level)
  const assembledByKey = useMemo(() => {
    const map: Record<string, number> = {};
    assemblyItems.forEach((row) => {
      const key = lineKey(row.component_inward_no, row.component_item_name);
      map[key] = (map[key] || 0) + Number(row.quantity || 0);
    });
    return map;
  }, [assemblyItems]);

  // Item ka available stock = uske inward batches − sold − assembly consumption
  const availableForItem = (item: ItemRecord): number => {
    let available = 0;
    purchases.forEach((p) => {
      if (Number(p.quantity || 0) <= 0) return;
      if (!matchesItem(item, p.item_name, p.item_code)) return;
      const key = lineKey(p.inward_no || p.purchase_no, p.item_name);
      const left = Number(p.quantity || 0) - (soldByKey[key] || 0) - (assembledByKey[key] || 0);
      if (left > 0) available += left;
    });
    return available;
  };

  const selectedItem = items.find((it) => String(it.id) === selectedSetId);
  const children = selectedItem ? childrenByParent.get(Number(selectedItem.id)) || [] : [];
  const buildQty = Math.max(1, Number(qty) || 1);

  const previewRows = children.map((child) => {
    const childItem = items.find((it) => Number(it.id) === child.childId);
    const need = child.qty * buildQty;
    const available = childItem ? availableForItem(childItem) : 0;
    const rate = childItem
      ? Number(childItem.purchase_price || 0) || Number(childItem.cost_price || 0)
      : 0;
    return {
      childId: child.childId,
      name: childItem?.item_name || `Item #${child.childId}`,
      code: childItem?.item_code || "",
      perSet: child.qty,
      need,
      available,
      short: Math.max(0, need - available),
      rate,
      lineCost: rate * need,
    };
  });

  const componentCost = previewRows.reduce((sum, row) => sum + row.lineCost, 0);
  const costPerSet = buildQty > 0 ? componentCost / buildQty : 0;
  const hasShortage = previewRows.some((row) => row.short > 0);

  // Set ka ready stock (kitna assembled ban kar already pada hai aur bikta nahi saka)
  const readySetStock = useMemo(() => {
    if (!selectedItem) return 0;
    let total = 0;
    assemblies
      .filter((a) => Number(a.set_item_id) === Number(selectedItem.id))
      .forEach((a) => {
        const left = Number(a.set_quantity || 0) - (soldByKey[lineKey(a.assembly_no, a.set_item_name)] || 0);
        if (left > 0) total += left;
      });
    return total;
  }, [assemblies, selectedItem, soldByKey]);

  // Running INW series (RPC ke formula ka client-side preview)
  const nextInwardNo = useMemo(() => {
    let max = 1000;
    purchases.forEach((p) => {
      const raw = String(p.inward_no || "").trim() || String(p.purchase_no || "").trim();
      max = Math.max(max, digitsOf(raw));
    });
    assemblies.forEach((a) => {
      max = Math.max(max, digitsOf(a.assembly_no));
    });
    return `INW-${max + 1}`;
  }, [purchases, assemblies]);

  const runAssembly = async () => {
    if (!selectedItem) {
      alert("Pehle set/kit item select karo.");
      return;
    }
    if (hasShortage) {
      const shortList = previewRows
        .filter((row) => row.short > 0)
        .map((row) => `${row.name} (chahiye ${row.need}, available ${row.available})`)
        .join("\n");
      alert(`Components ki stock kam hai:\n\n${shortList}\n\nPehle Purchase karo, phir assembly chalao.`);
      return;
    }
    if (!window.confirm(
                `${buildQty} x "${selectedItem.item_name}" banane hain?\n\n` +
        `Components stock se kat jayenge.\nInward No: ${nextInwardNo}\nCost/Set: ₹${costPerSet.toFixed(2)}`,
    )) return;

    setRunning(true);
    try {
      const { data, error } = await supabase.rpc("run_bom_assembly", {
        p_set_item_id: Number(selectedItem.id),
        p_set_qty: buildQty,
        p_assembly_date: new Date().toISOString().slice(0, 10),
        p_remarks: remarks,
        p_company_id: getCompanyId(),
      });
      if (error) throw error;

      const result = data as any;
      const compList = (result?.components || [])
        .map((c: any) => `  • ${c.name}: ${c.qty}`)
        .join("\n");
      alert(
        `Assembly complete!\n\n` +
          `Inward No: ${result?.assembly_no}\n` +
          `Set: ${result?.set_quantity} x ${result?.set_item_name}\n` +
          `Cost/Set: ₹${Number(result?.set_rate || 0).toFixed(2)}\n` +
          `Total Cost: ₹${Number(result?.total_cost || 0).toFixed(2)}\n\n` +
          `Components consumed:\n${compList}\n\n` +
          `Ab Sales / Invoice menu se ye inward no. select karke invoice bana sakte ho.`,
      );
      setRemarks("");
      await loadData();
    } catch (err: any) {
      alert("Assembly fail ho gayi: " + (err?.message || String(err)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "linear-gradient(135deg,#2563eb,#4f46e5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 23,
              boxShadow: "0 8px 20px rgba(37,99,235,.20)",
            }}
          >
            🧩
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#0f172a" }}>
              BOM Assembly
            </h1>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 14 }}>
              Components se set/kit banao — stock auto maintain rehta hai.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 70, textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
          Loading BOM data...
        </div>
      ) : (
        <>
          {/* ASSEMBLY FORM */}
          <section style={cardStyle}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ ...labelStyle, minWidth: 300, flex: "1 1 300px" }}>
                Set / Kit Item
                <select
                  value={selectedSetId}
                  onChange={(e) => setSelectedSetId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">-- Set item select karo --</option>
                  {setOptions.map((it) => (
                    <option key={it.id} value={String(it.id)}>
                      {it.item_code ? `${it.item_code} - ` : ""}
                      {it.item_name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ ...labelStyle, width: 130 }}>
                Quantity
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={{ ...labelStyle, minWidth: 220, flex: "1 1 220px" }}>
                Remarks (optional)
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="jaise: batch for Surat order"
                  style={inputStyle}
                />
              </label>

              <button
                className="customer-primary-button"
                onClick={runAssembly}
                disabled={running || !selectedItem || hasShortage}
                style={{
                  opacity: running || !selectedItem || hasShortage ? 0.55 : 1,
                  cursor: running || !selectedItem || hasShortage ? "not-allowed" : "pointer",
                }}
              >
                {running ? "⏳ Running..." : "🧩 Run Assembly"}
              </button>
            </div>

            {selectedItem && (
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginTop: 18 }}>
                <InfoChip label="Naya Inward No" value={nextInwardNo} color="#2563eb" />
                <InfoChip label="Set ready stock" value={String(readySetStock)} color="#059669" />
                <InfoChip label="Cost per Set" value={`₹${costPerSet.toFixed(2)}`} color="#c2410c" />
                <InfoChip
                  label="Total Cost"
                  value={`₹${componentCost.toFixed(2)}`}
                  color="#7c3aed"
                />
              </div>
            )}
          </section>

          {/* COMPONENT PREVIEW */}
          {selectedItem && (
            <section style={{ ...cardStyle, marginTop: 18 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 16, color: "#0f172a" }}>
                Components (stock se katege)
              </h3>

              {children.length === 0 ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>
                  Is item ki BOM definition nahi hai. Pehle Item Master me BOM banao.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={thStyle}>Component</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty / Set</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Total Needed</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Available</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Rate</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Line Cost</th>
                        <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.childId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={tdStyle}>
                            <strong style={{ color: "#2563eb" }}>{row.code}</strong>{" "}
                            <span style={{ color: "#0f172a" }}>{row.name}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{row.perSet}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                            {row.need}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                            {row.available}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ₹{row.rate.toFixed(2)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ₹{row.lineCost.toFixed(2)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span
                              style={{
                                background: row.short > 0 ? "#fee2e2" : "#dcfce7",
                                color: row.short > 0 ? "#991b1b" : "#166534",
                                padding: "4px 10px",
                                borderRadius: 20,
                                fontSize: 11,
                                fontWeight: 700,
                                display: "inline-block",
                              }}
                            >
                              {row.short > 0 ? `Short ${row.short}` : "OK"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* RECENT ASSEMBLIES */}
          <section style={{ ...cardStyle, marginTop: 18 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 16, color: "#0f172a" }}>
              Recent Assemblies
            </h3>
            {assemblies.length === 0 ? (
              <p style={{ color: "#64748b", margin: 0 }}>Abhi tak koi assembly nahi hui.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={thStyle}>Inward No</th>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Set Item</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Cost / Set</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                      <th style={thStyle}>Components Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assemblies.map((asm) => {
                      const used = assemblyItems.filter((row) => Number(row.assembly_id) === Number(asm.id));
                      return (
                        <tr key={asm.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={tdStyle}>
                            <strong style={{ color: "#2563eb" }}>{asm.assembly_no}</strong>
                          </td>
                          <td style={tdStyle}>{fmtDate(asm.assembly_date)}</td>
                          <td style={tdStyle}>
                            <strong style={{ color: "#0f172a" }}>{asm.set_item_name}</strong>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                            {Number(asm.set_quantity || 0)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ₹{Number(asm.set_rate || 0).toFixed(2)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ₹{Number(asm.total_cost || 0).toFixed(2)}
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: "normal" }}>
                            {used.length === 0
                              ? "—"
                              : used.map((row) => `${row.component_item_name} ×${row.quantity}`).join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InfoChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 4px 18px rgba(15,23,42,.04)",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  fontSize: 13,
  fontWeight: 700,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  outline: "none",
};

const thStyle: React.CSSProperties = {
  padding: "13px 16px",
  textAlign: "left",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  color: "#334155",
  fontSize: 13,
  whiteSpace: "nowrap",
};

export default BomAssembly;
