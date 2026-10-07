import { useEffect, useMemo, useState } from "react";
import { num, type BankAccount, type BankTxn } from "../lib/bankAccounts";
import { sc } from "../lib/company";
import {
  autoMatch,
  booksForAccount,
  buildReconItems,
  DEFAULT_MATCH_OPTIONS,
  parseAmount,
  parseStatement,
  RECON_STATUS_BG,
  RECON_STATUS_COLOR,
  RECON_STATUS_LABEL,
  summarise,
  type ReconItem,
  type ReconStatus,
  type StatementLine,
} from "../lib/reconciliation";

type Props = {
  accounts: BankAccount[];
  rows: BankTxn[];
  onClose: () => void;
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 18,
  marginBottom: 18,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
  marginBottom: 5,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 7,
  fontSize: 13,
  background: "#fff",
  boxSizing: "border-box",
};
const th: React.CSSProperties = {
  padding: "8px 9px",
  fontSize: 11,
  fontWeight: 800,
  color: "#475569",
  textAlign: "left",
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
};
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type LoadedBatch = {
  id: number;
  account_id: number;
  label: string | null;
  source: string;
  line_count: number;
  created_at: string;
};

export default function Reconciliation({ accounts, rows, onClose }: Props) {
  const bankAccounts = useMemo(() => accounts.filter((a) => a.account_type !== "Cash"), [accounts]);
  const cashAccounts = useMemo(() => accounts.filter((a) => a.account_type === "Cash"), [accounts]);

  const [mode, setMode] = useState<"bank" | "cash">("bank");
  const [accountId, setAccountId] = useState<number>(bankAccounts[0]?.id ?? 0);
  const [cashAccountId, setCashAccountId] = useState<number>(cashAccounts[0]?.id ?? 0);

  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<StatementLine[]>([]);
  const [parseInfo, setParseInfo] = useState<{ format: string; skipped: number; cols: Record<string, string | null> } | null>(null);
  const [tolerance, setTolerance] = useState(DEFAULT_MATCH_OPTIONS.toleranceDays);
  const [items, setItems] = useState<ReconItem[]>([]);
  const [filter, setFilter] = useState<ReconStatus | "all">("all");
  const [batches, setBatches] = useState<LoadedBatch[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [cashCount, setCashCount] = useState("");

  const bookRows = useMemo(() => booksForAccount(rows, accountId), [rows, accountId]);

  // ---- batches load for selected account ----
  useEffect(() => {
    if (mode !== "bank" || !accountId) {
      setBatches([]);
      setActiveBatchId(null);
      return;
    }
    sc("bank_statement_batches")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("batches load:", error);
          return;
        }
        const list = (data || []) as LoadedBatch[];
        setBatches(list);
        if (list.length) loadBatch(list[0].id);
        else {
          setActiveBatchId(null);
          setItems([]);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, accountId]);

  async function loadBatch(id: number) {
    const { data, error } = await sc("bank_statement_lines")
      .select("*")
      .eq("batch_id", id)
      .order("seq", { ascending: true });
    if (error) {
      console.error("lines load:", error);
      return;
    }
    const lines: StatementLine[] = ((data || []) as any[]).map((r) => ({
      localId: Number(r.seq),
      txn_date: r.txn_date || null,
      description: r.description || "",
      debit: num(r.debit),
      credit: num(r.credit),
      balance: r.balance === null || r.balance === undefined ? null : num(r.balance),
      raw: r.raw_text || "",
      // DB id bhi rakhte hain taaki manual override save ho sake
      ...({ dbId: Number(r.id) } as any),
      ...({ isIgnored: r.is_ignored === true } as any),
    }));
    const existing = new Map<number, number>();
    (data || []).forEach((r: any) => {
      if (r.matched_transaction_id) existing.set(Number(r.seq), Number(r.matched_transaction_id));
    });
    setActiveBatchId(id);
    setParsed(lines);
    setParseInfo({
      format: "csv",
      skipped: 0,
      cols: {},
    });
    setPaste("");
    const built = buildReconItems(bookRows, lines, existing);
    setItems(built);
    setMsg(`${lines.length} lines load ho gayi — links yahan se badal kar dobara save kar sakte hain.`);
  }

  // ---- parse ----
  function doParse(text: string) {
    const res = parseStatement(text);
    setPaste(text);
    setParsed(res.lines);
    setParseInfo({ format: res.format, skipped: res.skipped, cols: res.detectedColumns });
    const matches = autoMatch(bookRows, res.lines, { ...DEFAULT_MATCH_OPTIONS, toleranceDays: tolerance });
    setItems(buildReconItems(bookRows, res.lines, matches));
    setActiveBatchId(null);
    setMsg(res.lines.length ? "" : "Kuch parse nahi hua — format check karein.");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => doParse(String(reader.result || ""));
    reader.readAsText(f);
    e.target.value = "";
  }

  function rematch(newTolerance = tolerance) {
    const matches = autoMatch(bookRows, parsed, { ...DEFAULT_MATCH_OPTIONS, toleranceDays: newTolerance });
    setItems(buildReconItems(bookRows, parsed, matches));
  }

  // ---- manual override in state ----
  function linkLine(lineIdx: number | null, bookId: number) {
    if (lineIdx === null) return;
    setItems((prev) => {
      const line = parsed[lineIdx];
      if (!line) return prev;
      // pehle se kisi aur line se linked ho to use unlink karo
      const cleared = prev.map((it) =>
        it.lineIndex !== null && it.lineIndex !== lineIdx && it.txnId === bookId
          ? { ...it, status: "only_books" as ReconStatus, lineIndex: null, lineDate: null, lineDescription: "", dateGap: null }
          : it,
      );
      const book = bookRows.find((b) => b.id === bookId);
      if (!book) return cleared;
      return cleared.map((it) =>
        it.lineIndex === lineIdx
          ? {
              ...it,
              status: "matched" as ReconStatus,
              txnId: book.id,
              txnDate: book.date,
              amount: book.amount,
              direction: book.direction,
              particulars: book.particulars,
              party: book.party,
              mode: book.mode,
              dateGap: diffDays(line.txn_date, book.date),
            }
          : it,
      );
    });
  }

  function unlinkLine(lineIdx: number | null) {
    if (lineIdx === null) return;
    setItems((prev) =>
      prev.map((it) =>
        it.lineIndex === lineIdx
          ? {
              ...it,
              status: "only_bank" as ReconStatus,
              txnId: null,
              txnDate: null,
              particulars: "",
              party: "",
              mode: "",
              dateGap: null,
            }
          : it,
      ),
    );
  }

  // ---- save ----
  async function save() {
    if (!parsed.length || !accountId) return;
    setBusy(true);
    setMsg("");
    try {
      const byLine = new Map<number, number>();
      items.forEach((it) => {
        if (it.lineIndex !== null && it.txnId !== null && it.status === "matched") {
          byLine.set(it.lineIndex, it.txnId);
        }
      });

      if (activeBatchId !== null) {
        // pehle se save kiya gaya statement — sirf links update karo
        const { error: cErr } = await sc("bank_statement_lines")
          .update({ matched_transaction_id: null })
          .eq("batch_id", activeBatchId);
        if (cErr) throw cErr;
        for (const [seq, bookId] of byLine) {
          const { error } = await sc("bank_statement_lines")
            .update({ matched_transaction_id: bookId })
            .eq("batch_id", activeBatchId)
            .eq("seq", seq);
          if (error) throw error;
        }
        setMsg(`✅ ${byLine.size} links update ho gaye.`);
        return;
      }

      const { data: batch, error: bErr } = await sc("bank_statement_batches")
        .insert({
          account_id: accountId,
          label: `Statement ${new Date().toLocaleDateString("en-IN")} (${parsed.length} lines)`,
          source: parseInfo?.format === "csv" ? "csv" : "paste",
          line_count: parsed.length,
          period_from: parsed.find((l) => l.txn_date)?.txn_date ?? null,
          period_to: [...parsed].reverse().find((l) => l.txn_date)?.txn_date ?? null,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      const payload = parsed.map((l, i) => ({
        batch_id: (batch as any).id,
        account_id: accountId,
        seq: i,
        txn_date: l.txn_date,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
        balance: l.balance,
        raw_text: l.raw,
        matched_transaction_id: byLine.has(i) ? byLine.get(i)! : null,
        is_ignored: false,
      }));
      const { error: lErr } = await sc("bank_statement_lines").insert(payload);
      if (lErr) throw lErr;

      setMsg(`✅ ${parsed.length} lines save ho gayi (${byLine.size} matched).`);
      const { data: list } = await sc("bank_statement_batches")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
      setBatches((list || []) as LoadedBatch[]);
      setActiveBatchId((batch as any).id);
    } catch (err: any) {
      setMsg("❌ " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBatch(id: number) {
    if (!window.confirm("Ye statement delete karein?")) return;
    const { error } = await sc("bank_statement_batches").delete().eq("id", id);
    if (error) {
      setMsg("❌ " + error.message);
      return;
    }
    setBatches((b) => b.filter((x) => x.id !== id));
    if (activeBatchId === id) {
      setActiveBatchId(null);
      setItems([]);
      setParsed([]);
      setPaste("");
    }
  }

  const stats = summarise(items);
  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);
  const unmatchedBooks = items.filter((i) => i.status === "only_books");

  // ---- cash mode ----
  const cashBooks = useMemo(() => booksForAccount(rows, cashAccountId), [rows, cashAccountId]);
  const cashOpening = num(accounts.find((a) => a.id === cashAccountId)?.opening_balance);
  const cashBalance = cashBooks.reduce((s, b) => s + (b.direction === "in" ? b.amount : -b.amount), cashOpening);
  const counted = cashCount.trim() === "" ? null : parseAmount(cashCount);
  const cashDiff = counted === null ? null : counted - cashBalance;

  return (
    <div>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
            🔄 Bank Reconciliation
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
            Aapki books vs bank statement — har line ko match karke dekh lijiye kuch chhoot to nahi raha.
          </p>
        </div>
        <button onClick={onClose} style={{ ...input, width: "auto", cursor: "pointer", fontWeight: 700 }}>
          ✕ Band karein
        </button>
      </div>

      {/* MODE */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["bank", "cash"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              ...input,
              width: "auto",
              cursor: "pointer",
              fontWeight: 800,
              background: mode === m ? "#0f172a" : "#fff",
              color: mode === m ? "#fff" : "#334155",
            }}
          >
            {m === "bank" ? "🏦 Bank Statement" : "💵 Cash Count"}
          </button>
        ))}
      </div>

      {mode === "cash" ? (
        <div style={panel}>
          <p style={{ fontSize: 13, color: "#334155", marginTop: 0 }}>
            Ginti karke jo cash haath me hai wo daaliye — software ka hisaab usse match hoga.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={label}>Cash Account</label>
              <select
                value={cashAccountId}
                onChange={(e) => setCashAccountId(Number(e.target.value))}
                style={input}
              >
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Cash Count (physical) ₹</label>
              <input
                value={cashCount}
                onChange={(e) => setCashCount(e.target.value)}
                placeholder="जितना हाथ में है"
                style={input}
                inputMode="decimal"
              />
            </div>
            <div>
              <label style={label}>Difference</label>
              <div
                style={{
                  ...input,
                  fontWeight: 800,
                  color: cashDiff === null ? "#94a3b8" : Math.abs(cashDiff) < 0.01 ? "#15803d" : "#dc2626",
                  background: "#f8fafc",
                }}
              >
                {cashDiff === null ? "—" : `₹ ${money(cashDiff)}`}
              </div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Entry</th>
                <th style={{ ...th, textAlign: "right" }}>IN</th>
                <th style={{ ...th, textAlign: "right" }}>OUT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cell}>—</td>
                <td style={cell}><b>Opening Balance</b></td>
                <td style={{ ...cell, textAlign: "right" }}>{money(cashOpening)}</td>
                <td style={{ ...cell, textAlign: "right" }}>—</td>
              </tr>
              {cashBooks.map((b) => (
                <tr key={b.id}>
                  <td style={cell}>{b.date}</td>
                  <td style={cell}>{b.particulars || b.party}</td>
                  <td style={{ ...cell, textAlign: "right", color: b.direction === "in" ? "#15803d" : "#94a3b8" }}>
                    {b.direction === "in" ? money(b.amount) : "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "right", color: b.direction === "out" ? "#dc2626" : "#94a3b8" }}>
                    {b.direction === "out" ? money(b.amount) : "—"}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc" }}>
                <td style={{ ...cell, fontWeight: 800 }} colSpan={2}>Books me cash</td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 800 }} colSpan={2}>
                  ₹ {money(cashBalance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* INPUT */}
          <div style={panel}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={label}>Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                  style={input}
                >
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.bank_name ? `— ${a.bank_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={label}>Date tolerance (din)</label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={tolerance}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTolerance(v);
                    if (parsed.length) rematch(v);
                  }}
                  style={input}
                />
              </div>
            </div>

            <label style={label}>Bank statement paste karein (ya CSV upload karein)</label>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onBlur={() => paste.trim() && doParse(paste)}
              placeholder={"Date,Narration,Debit,Credit,Balance\n02-10-2026,UPI-YOGI SALES,,4781.00,23564.35"}
              rows={7}
              style={{ ...input, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <label
                style={{
                  ...input,
                  width: "auto",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#f1f5f9",
                  textAlign: "center",
                }}
              >
                📂 CSV file choose karein
                <input type="file" accept=".csv,.txt,.tsv" onChange={onFile} style={{ display: "none" }} />
              </label>
              <button
                onClick={() => paste.trim() && doParse(paste)}
                style={{ ...input, width: "auto", cursor: "pointer", fontWeight: 800, background: "#2563eb", color: "#fff" }}
              >
                🔍 Parse & Match
              </button>
              <button
                onClick={() => rematch()}
                disabled={!parsed.length}
                style={{ ...input, width: "auto", cursor: "pointer", fontWeight: 700 }}
              >
                🔁 Dobara match
              </button>
              <button
                onClick={save}
                disabled={!parsed.length || busy}
                style={{
                  ...input,
                  width: "auto",
                  cursor: "pointer",
                  fontWeight: 800,
                  background: parsed.length && !busy ? "#15803d" : "#cbd5e1",
                  color: "#fff",
                }}
              >
                {busy ? "Saving…" : "💾 Save statement"}
              </button>
            </div>

            {parseInfo && (
              <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0" }}>
                Format: <b>{parseInfo.format}</b> · {parsed.length} lines parse · {parseInfo.skipped} skipped
                {parseInfo.format === "csv" && (
                  <>
                    {" · columns → "}
                    {Object.entries(parseInfo.cols)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                  </>
                )}
              </p>
            )}
            {msg && <p style={{ fontSize: 13, margin: "8px 0 0", fontWeight: 700 }}>{msg}</p>}

            {batches.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Saved statements:</span>
                {batches.map((b) => (
                  <span key={b.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <button
                      onClick={() => loadBatch(b.id)}
                      style={{
                        ...input,
                        width: "auto",
                        cursor: "pointer",
                        fontWeight: activeBatchId === b.id ? 800 : 500,
                        background: activeBatchId === b.id ? "#e0f2fe" : "#fff",
                      }}
                    >
                      {new Date(b.created_at).toLocaleDateString("en-IN")} · {b.line_count} lines
                    </button>
                    <button
                      onClick={() => deleteBatch(b.id)}
                      title="Delete"
                      style={{ ...input, width: "auto", cursor: "pointer", color: "#dc2626" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* SUMMARY */}
          {items.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
              {(["matched", "pending", "only_bank", "only_books"] as ReconStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(filter === s ? "all" : s)}
                  style={{
                    textAlign: "left",
                    background: RECON_STATUS_BG[s],
                    border: filter === s ? `2px solid ${RECON_STATUS_COLOR[s]}` : "2px solid transparent",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: RECON_STATUS_COLOR[s] }}>
                    {RECON_STATUS_LABEL[s]}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: RECON_STATUS_COLOR[s], lineHeight: 1.2 }}>
                    {stats[s]}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* UNMATCHED BOOKS WARNING */}
          {unmatchedBooks.length > 0 && (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 14,
                fontSize: 13,
                color: "#1e40af",
              }}
            >
              <b>⚠ {unmatchedBooks.length} entries sirf books me hain</b> — bank statement me nahi aaye. Agar
              inme se koi cheque hai jo abhi clear nahi hua to wo <b>Pending</b> dikhega; baaki ka matlab hai
              entry bank me ja chuki hai par statement me cover nahi hui (ya galat account).
            </div>
          )}

          {/* TABLE */}
          {visible.length > 0 && (
            <div style={{ ...panel, padding: 0, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={th}>Status</th>
                    <th style={th}>Books — date / entry</th>
                    <th style={{ ...th, textAlign: "right" }}>Amount</th>
                    <th style={th}>Bank statement — date / narration</th>
                    <th style={{ ...th, textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((it, i) => (
                    <tr key={`${it.status}-${it.txnId ?? "l"}-${it.lineIndex ?? i}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            background: RECON_STATUS_BG[it.status],
                            color: RECON_STATUS_COLOR[it.status],
                            fontWeight: 800,
                            fontSize: 11,
                            padding: "3px 7px",
                            borderRadius: 5,
                          }}
                        >
                          {RECON_STATUS_LABEL[it.status]}
                        </span>
                      </td>
                      <td style={cell}>
                        {it.txnId !== null ? (
                          <>
                            <div style={{ fontSize: 12, color: "#64748b" }}>
                              {it.txnDate} {it.mode ? `· ${it.mode}` : ""}
                            </div>
                            <div style={{ fontWeight: 600 }}>
                              {it.particulars || it.party || `#${it.txnId}`}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>
                        <span style={{ color: it.direction === "in" ? "#15803d" : "#dc2626" }}>
                          {it.direction === "in" ? "+" : "−"} ₹{money(it.amount)}
                        </span>
                        {it.dateGap !== null && it.dateGap !== 0 && (
                          <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>
                            {it.dateGap > 0 ? `${it.dateGap} din pehle` : `${-it.dateGap} din baad`}
                          </div>
                        )}
                      </td>
                      <td style={cell}>
                        {it.lineIndex !== null ? (
                          <>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{it.lineDate || "date nahi"}</div>
                            <div style={{ fontWeight: 600 }}>{it.lineDescription || "—"}</div>
                          </>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...cell, textAlign: "center" }}>
                        {it.lineIndex !== null && it.status === "only_bank" ? (
                          <select
                            value=""
                            onChange={(e) => e.target.value && linkLine(it.lineIndex, Number(e.target.value))}
                            style={{ ...input, width: 180, fontSize: 12, padding: "5px 6px" }}
                          >
                            <option value="">— link karein —</option>
                            {unmatchedBooks
                              .filter((b) => Math.abs(b.amount - it.amount) <= 0.01)
                              .map((b) => (
                                <option key={b.txnId!} value={b.txnId!}>
                                  {b.txnDate} · ₹{money(b.amount)} · {(b.particulars || b.party).slice(0, 28)}
                                </option>
                              ))}
                          </select>
                        ) : it.lineIndex !== null && it.status === "matched" ? (
                          <button
                            onClick={() => unlinkLine(it.lineIndex)}
                            style={{ ...input, width: "auto", cursor: "pointer", fontSize: 12, padding: "5px 8px" }}
                          >
                            Unlink
                          </button>
                        ) : (
                          <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filter !== "all" && (
                <div style={{ padding: 10, textAlign: "center" }}>
                  <button
                    onClick={() => setFilter("all")}
                    style={{ ...input, width: "auto", cursor: "pointer", fontWeight: 700 }}
                  >
                    Sab dikhayein ({items.length})
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "9px",
  fontSize: 13,
  verticalAlign: "top",
  color: "#1e293b",
};

function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t1 = Date.parse(a + "T00:00:00Z");
  const t2 = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round((t1 - t2) / 86400000);
}
