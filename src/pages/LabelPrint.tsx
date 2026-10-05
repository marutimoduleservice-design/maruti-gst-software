import { sc } from "../lib/company";
import { useEffect, useMemo, useState } from "react";

type Block = {
  id: number;
  name: string;
  qty: number;
  date: string;
};

type CellData = {
  name: string;
  date: string;
};

const LABEL_TOTAL = 84;
const LABEL_COLS = 4;
const LABEL_ROWS = 21;

// Geometry measured from the user's reference PDF (MARUTI LABLE.pdf).
// Page is A4. Text is centered on each sticker; fonts Calibri-Bold 11.04pt.
// 1pt = 25.4/72 mm
const MM_PT = 25.4 / 72;
const PT2MM = (v: number) => +(v * MM_PT).toFixed(2);
const COL_CX_MM = [84.8, 228.5, 372.3, 516.0].map(PT2MM); // column text centers
const ROW_NAME_CY_MM = (r: number) => PT2MM(61.7 + r * 36); // name line center per row
const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const today = () => new Date().toISOString().slice(0, 10);
const fmtIn = (dateStr: string) => {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateStr;
};

const printWindowHTML = (cells: CellData[]) => {
  const out: string[] = [];
  for (let r = 0; r < LABEL_ROWS; r++) {
    for (let c = 0; c < LABEL_COLS; c++) {
      const idx = r * LABEL_COLS + c;
      const cell = cells[idx];
      if (!cell || !(cell.name || cell.date)) continue;
      const cx = COL_CX_MM[c];
      const ny = ROW_NAME_CY_MM(r);
      const dy = PT2MM(61.7 + r * 36 + 13.4);
      if (cell.name)
        out.push(`<div class="ptext" style="left:${cx}mm;top:${ny}mm">${esc(cell.name)}</div>`);
      if (cell.date)
        out.push(`<div class="ptext" style="left:${cx}mm;top:${dy}mm">${esc(fmtIn(cell.date))}</div>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Label Print</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #f1f5f9; }
  .preview-bar { position: sticky; top: 0; z-index: 100; max-width: 900px; margin: 0 auto 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; box-shadow: 0 6px 18px rgba(15,23,42,0.25); }
  .preview-bar .p-title { font-size: 14px; font-weight: 800; }
  .preview-bar button { border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .btn-print { background: #f59e0b; color: #0f172a; }
  .btn-close { background: #374151; color: #e5e7eb; }
  .sheet { width: 210mm; height: 297mm; margin: 0 auto; background: #fff; position: relative; }
  .ptext { position: absolute; transform: translate(-50%, -50%); font-family: Calibri, 'Segoe UI', sans-serif; font-weight: bold; font-size: 11.04pt; color: #0f172a; text-align: center; white-space: nowrap; max-width: 44mm; overflow: hidden; text-overflow: ellipsis; }
  @media print { body { background: #fff; padding: 0; } .preview-bar { display: none !important; } .sheet { box-shadow: none; } }
</style></head><body>
<div class="preview-bar">
  <div class="p-title">🏷️ Label Print — Preview (${cells.filter((c) => c && (c.name || c.date)).length}/84)</div>
  <div style="display:flex;gap:8px">
    <button class="btn-print" onclick="window.print()">🖨️ Print Now</button>
    <button class="btn-close" onclick="window.close()">✕ Close</button>
  </div>
</div>
<div class="sheet">${out.join("")}</div>
</body></html>`;
};

export default function LabelPrint() {
  const [blocks, setBlocks] = useState<Block[]>([
    { id: 1, name: "", qty: 1, date: today() },
  ]);
  const [overrides, setOverrides] = useState<Record<number, CellData | null>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [customerNames, setCustomerNames] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await sc("customers").select("customer_name, business_name");
      const names = new Set<string>();
      (data || []).forEach((c: any) => {
        if (c.business_name) names.add(String(c.business_name).trim());
        if (c.customer_name) names.add(String(c.customer_name).trim());
      });
      setCustomerNames(Array.from(names).sort());
    })();
  }, []);

  const used = blocks.filter((b) => b.name.trim() && b.qty > 0).reduce((s, b) => s + b.qty, 0);
  const overflow = used > LABEL_TOTAL;

  const baseCells = useMemo<CellData[]>(() => {
    const cells: CellData[] = [];
    blocks.forEach((b) => {
      if (!b.name.trim() || b.qty <= 0) return;
      for (let i = 0; i < b.qty; i++) {
        cells.push({ name: b.name.trim(), date: b.date || today() });
      }
    });
    while (cells.length < LABEL_TOTAL) cells.push({ name: "", date: "" });
    return cells.slice(0, LABEL_TOTAL);
  }, [blocks]);

  const cells: CellData[] = useMemo(() => {
    return baseCells.map((c, i) => (i in overrides ? overrides[i] ?? { name: "", date: "" } : c));
  }, [baseCells, overrides]);

  const updateBlock = (id: number, patch: Partial<Block>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    const b = blocks.find((bb) => bb.id === id);
    if (b && "qty" in patch && patch.qty !== b.qty) {
      // blocks changed -> drop overrides to keep grid aligned
      setOverrides({});
    }
  };

  const addBlock = () =>
    setBlocks((prev) => [...prev, { id: Date.now(), name: "", qty: 1, date: today() }]);

  const removeBlock = (id: number) => {
    if (blocks.length <= 1) return;
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setOverrides({});
  };

  const updateSelected = (cell: CellData | null) => {
    if (selectedIdx === null) return;
    setOverrides((prev) => ({ ...prev, [selectedIdx]: cell && (cell.name || cell.date) ? cell : null }));
  };

  const handlePrint = () => {
    const active = cells.filter((c) => c && (c.name || c.date));
    if (active.length === 0) {
      alert("❌ कम से कम एक sticker में name या date भरें!");
      return;
    }
    const win = window.open("", "_blank", "width=1050,height=850");
    if (!win) {
      alert("❌ Popup blocked! ब्राउज़र ने popup block कर दिया — कृपया popup allow करें।");
      return;
    }
    win.document.write(printWindowHTML(cells));
    win.document.close();
  };

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            🏷️ Label Print
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            46mm × 11.1mm Stickers — A4 Sheet (4 Columns × 21 Rows = 84 Labels)
          </p>
        </div>
        <button
          onClick={handlePrint}
          style={{ background: "#0f172a", color: "#fff", border: "none", padding: "10px 22px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
        >
          🖨️ Print Labels
        </button>
      </div>

      <div
        style={{
          background: overflow ? "#fef2f2" : "#f0fdf4",
          border: `2px solid ${overflow ? "#fca5a5" : "#86efac"}`,
          padding: "12px 16px",
          borderRadius: 10,
          marginBottom: 16,
          fontWeight: 800,
          fontSize: 15,
          color: overflow ? "#b91c1c" : "#0f172a",
        }}
      >
        {overflow
          ? `⚠️ कुल ${used} label हो रही हैं — एक sheet में सिर्फ ${LABEL_TOTAL}! Quantity कम करें.`
          : `Sheet में ${used} / ${LABEL_TOTAL} labels भरे हैं — बाकी stickers खाली रहेंगी (कुछ print नहीं होगा).`}
      </div>

      {/* PARTY BLOCKS */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: "#0f172a" }}>🧾 Party Rows (quick fill top-to-bottom)</strong>
          <button
            onClick={addBlock}
            style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            + Add Party
          </button>
        </div>

        {blocks.map((b) => (
          <div
            key={b.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 110px 150px 44px",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                Party Name
              </label>
              <input
                list="label-customer-names"
                type="text"
                placeholder="जैसे MARUTI / H"
                value={b.name}
                onChange={(e) => updateBlock(b.id, { name: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                Qty
              </label>
              <input
                type="number"
                min="1"
                max={LABEL_TOTAL}
                value={b.qty}
                onChange={(e) => updateBlock(b.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontWeight: 700 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>
                Date
              </label>
              <input
                type="date"
                value={b.date}
                onChange={(e) => updateBlock(b.id, { date: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }}
              />
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                onClick={() => removeBlock(b.id)}
                disabled={blocks.length === 1}
                style={{
                  background: blocks.length === 1 ? "#f1f5f9" : "#fef2f2",
                  color: blocks.length === 1 ? "#94a3b8" : "#b91c1c",
                  border: "none",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: blocks.length === 1 ? "not-allowed" : "pointer",
                  marginTop: 20,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        <datalist id="label-customer-names">
          {customerNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <p style={{ fontSize: 12, color: "#64748b", margin: "12px 0 0", lineHeight: 1.5 }}>
          💡 Blocks से stickers ऊपर-से-नीचे fill होते हैं. फिर नीचे <b>किसी भी sticker cell पर click</b> करके उसका name/date अलग से बदल सकते हो — जैसे बीच की rows को खाली छोड़ना हो.
        </p>
      </div>

      {/* CELL EDITOR */}
      {selectedIdx !== null && (
        <div
          style={{
            background: "#eff6ff",
            border: "2px solid #bfdbfe",
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ fontSize: 14, color: "#1e40af", paddingBottom: 3 }}>
            Cell #{selectedIdx + 1} (Row {Math.floor(selectedIdx / LABEL_COLS) + 1} / Col {(selectedIdx % LABEL_COLS) + 1})
          </strong>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1e40af", marginBottom: 3 }}>Name</label>
            <input
              type="text"
              value={cells[selectedIdx]?.name || ""}
              onChange={(e) => updateSelected({ name: e.target.value, date: cells[selectedIdx]?.date || today() })}
              style={{ width: 170, padding: "8px 10px", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 13, fontWeight: 700, textTransform: "uppercase" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1e40af", marginBottom: 3 }}>Date</label>
            <input
              type="date"
              value={cells[selectedIdx]?.date || today()}
              onChange={(e) => updateSelected({ name: cells[selectedIdx]?.name || "", date: e.target.value })}
              style={{ width: 160, padding: "8px 10px", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 13 }}
            />
          </div>
          <button
            onClick={() => {
              updateSelected(null);
              setSelectedIdx(null);
            }}
            style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            ✕ Clear Cell
          </button>
          <button
            onClick={() => setSelectedIdx(null)}
            style={{ background: "#fff", color: "#475569", border: "1px solid #cbd5e1", padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Done
          </button>
        </div>
      )}

      {/* GRID PREVIEW */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${LABEL_COLS}, 1fr)`, gap: 3, padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12 }}>
        {cells.map((cell, i) => {
          const filled = !!(cell && (cell.name || cell.date));
          const selected = selectedIdx === i;
          return (
            <div
              key={i}
              onClick={() => setSelectedIdx(i)}
              style={{
                border: selected
                  ? "2px solid #2563eb"
                  : filled
                    ? `0.5px solid ${cell.name ? "#86efac" : "#fde68a"}`
                    : "0.5px dashed #e2e8f0",
                background: selected ? "#dbeafe" : filled ? (cell.name ? "#f0fdf4" : "#fefce8") : "#fff",
                borderRadius: 6,
                padding: "6px 4px",
                textAlign: "center",
                minHeight: 52,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 2,
                cursor: "pointer",
                boxShadow: selected ? "0 0 0 3px rgba(37,99,235,0.15)" : "none",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 900, color: "#0f172a", textTransform: "uppercase", lineHeight: 1.2, wordBreak: "break-word" }}>
                {cell?.name || "–"}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: cell?.name ? "#b45309" : "#a16207" }}>
                {fmtIn(cell?.date || "")}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "#64748b", marginTop: 10 }}>
        <b>{cells.filter((c) => c && (c.name || c.date)).length}</b> stickers भरी हुई हैं — बाकी खाली print होंगी. Click any cell to edit.
      </p>
    </div>
  );
}