import { num, resolveInOut, txnDate, type BankTxn } from "./bankAccounts";

/**
 * Bank Reconciliation — aapki books vs bank statement.
 *
 * Match ka poora logic yahan hai, UI sirf ye render karta hai.
 *
 * Status:
 *   matched    — dono me same hai
 *   pending    — books me likha par bank me abhi tak nahi (jaise cheque)
 *   only_bank  — sirf bank statement me hai, books me NAHI (chori/bhool — dhyan do)
 *   only_books — aapne likha par bank statement me nahi aaya
 */

export type Direction = "in" | "out";
export type ReconStatus = "matched" | "pending" | "only_bank" | "only_books";

export type StatementLine = {
  /** DB me 0 hoga; preview ke liye index. */
  localId: number;
  txn_date: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  raw: string;
};

export type BookRow = {
  id: number;
  date: string;
  direction: Direction;
  amount: number;
  mode: string;
  particulars: string;
  party: string;
  isTransfer: boolean;
};

export type MatchPair = {
  lineIndex: number;
  bookIndex: number;
  dateGap: number;
};

export type ReconItem = {
  status: ReconStatus;
  /** Books side */
  txnId: number | null;
  txnDate: string | null;
  amount: number;
  direction: Direction;
  particulars: string;
  party: string;
  mode: string;
  /** Statement side */
  lineIndex: number | null;
  lineDate: string | null;
  lineDescription: string;
  /** days ke hisaab se farak (matched par) */
  dateGap: number | null;
};

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  matched: "✓ Match",
  pending: "Pending",
  only_bank: "⚠ Sirf bank me",
  only_books: "Sirf books me",
};

export const RECON_STATUS_COLOR: Record<ReconStatus, string> = {
  matched: "#15803d",
  pending: "#b45309",
  only_bank: "#dc2626",
  only_books: "#2563eb",
};

export const RECON_STATUS_BG: Record<ReconStatus, string> = {
  matched: "#dcfce7",
  pending: "#fef3c7",
  only_bank: "#fee2e2",
  only_books: "#dbeafe",
};

// ---------------------------------------------------------------------------
// Numbers / dates
// ---------------------------------------------------------------------------

/** "₹1,23,456.78", "(1,234)", "-12.5", "4,781.00 Dr" -> 123456.78 / 1234 / 12.5 / 4781 */
export function parseAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.abs(raw) : 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // trailing Dr/Cr marker hatao (direction caller decide karta hai)
  const flag = s.match(/\b(dr|cr|debit|credit)\b\.?\s*$/i);
  if (flag && typeof flag.index === "number") s = s.slice(0, flag.index).trim();
  if (!s || s === "-" || s === "+") return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  // pehle bana number nikalte hain — "Rs. 900" me "." alag reh jaata tha
  const m = s.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** dd-mm-yyyy | dd/mm/yyyy | yyyy-mm-dd | dd-Mon-yyyy -> yyyy-mm-dd (warna null) */
export function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    let yy = +y;
    if (yy < 100) yy += yy > 70 ? 1900 : 2000;
    // dd-mm-yyyy hi maanenge (Indian format). Agar pehla >12 hai to wahi day hai.
    return iso(yy, +mo, +d);
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      let yy = +m[3];
      if (yy < 100) yy += yy > 70 ? 1900 : 2000;
      return iso(yy, mo, +m[1]);
    }
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dayGap(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t1 = Date.parse(a + "T00:00:00Z");
  const t2 = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round((t1 - t2) / 86400000);
}

// ---------------------------------------------------------------------------
// CSV / paste parsing
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Banks aksar amount ko bina quote ke "4,781.00" likhte hain — comma split ho
 * jaata hai. Cell jod kar expected column count laate hain.
 */
function mergeThousandGroups(cells: string[], expected: number): string[] {
  const out = [...cells];
  while (out.length > expected && out.length >= 2) {
    let merged = false;
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i].trim();
      const b = out[i + 1].trim();
      if (/^\d{1,3}$/.test(a) && /^\d{3}(?:\.\d+)?$/.test(b)) {
        out.splice(i, 2, `${a},${b}`);
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  return out;
}

const COL_ALIASES: Record<string, string[]> = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "dt", "tran date"],
  description: ["description", "narration", "particulars", "details", "remark", "remarks",
    "reference", "transaction remarks", "narr", "info"],
  debit: ["debit", "debit amount", "withdrawal", "withdrawal amount", "paid out", "dr amount",
    "debits", "paid out amount", "debit/withdrawal"],
  credit: ["credit", "credit amount", "deposit", "deposit amount", "paid in", "cr amount",
    "credits", "paid in amount", "credit/deposit"],
  amount: ["amount", "transaction amount", "tran amount", "amt"],
  drcr: ["dr/cr", "cr/dr", "type", "dc", "dr cr", "transaction type", "indicator", "particulars type"],
  balance: ["balance", "closing balance", "running balance", "available balance", "bal"],
};

function normHeader(h: string): string {
  return String(h || "").toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

function findCol(headers: string[], kind: string): number {
  const aliases = COL_ALIASES[kind];
  const normed = headers.map(normHeader);
  for (const alias of aliases) {
    const exact = normed.indexOf(alias);
    if (exact >= 0) return exact;
  }
  for (let i = 0; i < normed.length; i++) {
    if (aliases.some((a) => normed[i] === a || normed[i].includes(a))) return i;
  }
  return -1;
}

export type ParseResult = {
  lines: StatementLine[];
  detectedColumns: Record<string, string | null>;
  format: "csv" | "line" | "empty";
  skipped: number;
};

/**
 * Statement text/CSV parse karta hai. Pehle CSV (header detect) try karta hai,
 * warna free-form line parsing — dono Indian bank export ke saath chalte hain.
 */
export function parseStatement(text: string): ParseResult {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return { lines: [], detectedColumns: {}, format: "empty", skipped: 0 };

  const rows = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  // --- CSV path: pehli non-empty row headers lag rahi ho? ---
  const first = splitCsvLine(rows[0]);
  const hasHeader =
    rows.length > 1 &&
    first.length >= 3 &&
    first.some((h) => normHeader(h) === "date" || normHeader(h).includes("date")) &&
    first.some((h) =>
      ["amount", "debit", "credit", "withdrawal", "deposit", "balance", "dr/cr"]
        .some((k) => normHeader(h) === k || normHeader(h).includes(k)),
    );

  if (hasHeader) {
    const cols = {
      date: findCol(first, "date"),
      description: findCol(first, "description"),
      debit: findCol(first, "debit"),
      credit: findCol(first, "credit"),
      amount: findCol(first, "amount"),
      drcr: findCol(first, "drcr"),
      balance: findCol(first, "balance"),
    };
    const detected: Record<string, string | null> = {};
    (Object.keys(cols) as (keyof typeof cols)[]).forEach((k) => {
      detected[k] = cols[k] >= 0 ? first[cols[k]] : null;
    });

    const lines: StatementLine[] = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const cells = mergeThousandGroups(splitCsvLine(rows[i]), first.length);
      if (cells.length < 2) { skipped++; continue; }

      const get = (idx: number) => (idx >= 0 ? cells[idx] ?? "" : "");
      const d = parseDate(get(cols.date));
      let debit = cols.debit >= 0 ? parseAmount(get(cols.debit)) : 0;
      let credit = cols.credit >= 0 ? parseAmount(get(cols.credit)) : 0;

      if (cols.debit < 0 || cols.credit < 0) {
        const amt = Math.abs(parseAmount(get(cols.amount)));
        const flag = normHeader(get(cols.drcr));
        const isDebit =
          /^(dr|debit|withdrawal|paid out|w)$/.test(flag) || flag.startsWith("dr") ||
          flag.includes("debit") || flag.includes("withdraw");
        if (isDebit) debit = amt;
        else credit = amt;
      }
      if (debit < 0 && credit === 0) { credit = Math.abs(debit); debit = 0; }
      if (credit < 0 && debit === 0) { debit = Math.abs(credit); credit = 0; }
      debit = Math.abs(debit);
      credit = Math.abs(credit);

      if (!d && debit === 0 && credit === 0) { skipped++; continue; }

      lines.push({
        localId: lines.length,
        txn_date: d,
        description: get(cols.description) || cells.slice(1).join(" "),
        debit,
        credit,
        balance: cols.balance >= 0 ? parseAmount(get(cols.balance)) : null,
        raw: rows[i],
      });
    }
    if (lines.length > 0) return { lines, detectedColumns: detected, format: "csv", skipped };
  }

  // --- free-form line path ---
  const lines: StatementLine[] = [];
  let skipped = 0;
  const unknown: { idx: number; amount: number }[] = [];
  for (const row of rows) {
    const parsed = parseFreeLine(row);
    if (!parsed) { skipped++; continue; }
    const { amount: hint, ...rest } = parsed;
    const idx = lines.length;
    lines.push({ localId: idx, ...rest, raw: row });
    if (rest.debit === 0 && rest.credit === 0 && hint > 0) unknown.push({ idx, amount: hint });
  }
  inferDirectionFromBalance(lines, unknown);
  return {
    lines,
    detectedColumns: { description: "auto (line parse)" },
    format: "line",
    skipped,
  };
}

/**
 * Ek free-form line:
 *   02-10-2026  UPI-YOGI SALES-4781.00   4,781.00 Dr   23564.35
 *   2026-10-02,UPI/YOGI/4781,4781.00,DR
 */
function parseFreeLine(
  row: string,
): {
  txn_date: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  amount: number;
} | null {
  const dateM = row.match(
    /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[- ][A-Za-z]{3,}[- ]\d{2,4})/,
  );
  const date = dateM ? parseDate(dateM[1]) : null;

  // Date hata kar number nikalte hain — warna "02-10-2026" ke digit bhi amount ban jaate hain
  const scan = dateM ? row.replace(dateM[0], " ") : row;

  // scan par hi match karna zaroori hai taaki index/position match karein
  const dirM = scan.match(/\b(dr|cr|debit|credit|withdrawal|deposit)\b/i);
  const flag = dirM ? dirM[1].toLowerCase() : "";

  const one = (): RegExp =>
    /(?:₹|rs\.?)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
  const numsOf = (s: string): number[] =>
    Array.from(s.matchAll(one()))
      .map((x) => Math.abs(parseAmount(x[1])))
      .filter((v) => v > 0);

  const allNums = numsOf(scan);
  if (allNums.length === 0 && !date) return null;

  let amount = 0;
  let balance: number | null = null;

  if (flag && dirM && typeof dirM.index === "number") {
    // amount = Dr/Cr flag ke theek pehle wala number; uske baad wala balance
    const beforeNums = numsOf(scan.slice(0, dirM.index));
    const afterNums = numsOf(scan.slice(dirM.index + dirM[0].length));
    if (beforeNums.length) {
      amount = beforeNums[beforeNums.length - 1];
      balance = afterNums.length ? afterNums[afterNums.length - 1] : null;
    } else if (afterNums.length) {
      amount = afterNums[0];
      balance = afterNums.length > 1 ? afterNums[afterNums.length - 1] : null;
    }
  } else if (allNums.length >= 2) {
    balance = allNums[allNums.length - 1];
    amount = allNums[allNums.length - 2];
  } else {
    amount = allNums[0];
  }

  const isDebit = flag === "dr" || flag === "debit" || flag === "withdrawal";
  const isCredit = flag === "cr" || flag === "credit" || flag === "deposit";

  const description = scan
    .replace(/\b(dr|cr|debit|credit|withdrawal|deposit)\b/ig, " ")
    .replace(one(), " ")
    .replace(/\s+/g, " ")
    .replace(/[-–—/|,:]+$/, "")
    .trim();

  if (!date && amount === 0 && balance === null) return null;

  return {
    txn_date: date,
    description: description || row.trim(),
    debit: isDebit ? amount : 0,
    credit: isCredit ? amount : 0,
    balance,
    amount,
  };
}

/**
 * Dr/Cr flag nahi mila to direction balance ke change se nikaalte hain:
 * balance badha = money in, ghata = money out. Agar balance hi nahi to
 * pichhli known line ke hisaab se, warna money out maan lete hain.
 */
function inferDirectionFromBalance(
  lines: StatementLine[],
  unknown: { idx: number; amount: number }[],
): void {
  for (const { idx, amount } of unknown) {
    const line = lines[idx];
    if (!line || line.debit > 0 || line.credit > 0) continue;

    const prev = lines.slice(0, idx).reverse().find((l) => l.balance !== null);
    const diff = prev && prev.balance !== null && line.balance !== null ? line.balance - prev.balance : 0;

    if (diff > 0) line.credit = amount;
    else if (diff < 0) line.debit = amount;
    else line.debit = amount;
  }
}

// ---------------------------------------------------------------------------
// Books side
// ---------------------------------------------------------------------------

export function toBookRow(row: BankTxn): BookRow | null {
  const { pIn, pOut } = resolveInOut(row);
  const isTransfer = row.is_transfer === true || String(row.transaction_type || "") === "Account Transfer (+/-)";
  if (pIn === 0 && pOut === 0) return null;
  const direction: Direction = pIn > 0 ? "in" : "out";
  return {
    id: Number(row.id),
    date: txnDate(row),
    direction,
    amount: direction === "in" ? pIn : pOut,
    mode: String(row.payment_mode || ""),
    particulars: String(row.particulars || ""),
    party: String(row.party_name || ""),
    isTransfer,
  };
}

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

export type MatchOptions = {
  /** date ka farak kitne din tak acceptable hai (default 3) */
  toleranceDays: number;
  /** rupaye ka farak (default 0.01) */
  toleranceAmount: number;
};

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { toleranceDays: 3, toleranceAmount: 0.01 };

/**
 * Greedy 1:1 match. Pehle perfect date wale pairs, phir chhoti doori wale.
 * Already-matched pairs (existingMatches) ko preserve karta hai.
 */
export function autoMatch(
  books: BookRow[],
  lines: StatementLine[],
  opts: MatchOptions = DEFAULT_MATCH_OPTIONS,
  existingMatches: Map<number, number> = new Map<number, number>(),
): Map<number, number> {
  const result = new Map<number, number>();
  const usedBooks = new Set<number>();
  const usedLines = new Set<number>();

  // Purane manual/auto matches pehle lock karo
  existingMatches.forEach((bookId, lineLocalId) => {
    const b = books.findIndex((x) => x.id === bookId);
    const l = lines.findIndex((x) => x.localId === lineLocalId);
    if (b >= 0 && l >= 0 && !usedBooks.has(b) && !usedLines.has(l)) {
      result.set(l, b);
      usedBooks.add(b);
      usedLines.add(l);
    }
  });

  type Cand = { l: number; b: number; gap: number; exactDate: boolean };
  const cands: Cand[] = [];

  for (let li = 0; li < lines.length; li++) {
    if (usedLines.has(li)) continue;
    const line = lines[li];
    const lAmt = line.debit > 0 ? line.debit : line.credit;
    const lDir: Direction = line.debit > 0 ? "out" : "in";
    if (lAmt <= 0) continue;

    for (let bi = 0; bi < books.length; bi++) {
      if (usedBooks.has(bi)) continue;
      const book = books[bi];
      if (book.direction !== lDir) continue;
      if (Math.abs(book.amount - lAmt) > opts.toleranceAmount) continue;

      const gap = Math.abs(dayGap(line.txn_date, book.date) ?? 9999);
      const exactDate = gap === 0;
      if (gap > opts.toleranceDays) continue;
      cands.push({ l: li, b: bi, gap, exactDate });
    }
  }

  cands.sort((x, y) => {
    if (x.exactDate !== y.exactDate) return x.exactDate ? -1 : 1;
    if (x.gap !== y.gap) return x.gap - y.gap;
    if (x.l !== y.l) return x.l - y.l;
    return x.b - y.b;
  });

  for (const c of cands) {
    if (usedLines.has(c.l) || usedBooks.has(c.b)) continue;
    // value = book ROW ID (array index nahi) — buildReconItems id se uthata hai
    result.set(c.l, books[c.b].id);
    usedLines.add(c.l);
    usedBooks.add(c.b);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

/**
 * Books + statement + matches se final reconciliation list banata hai.
 * `matchedByLine` = lineLocalId -> bookRowId (persisted/auto).
 */
export function buildReconItems(
  books: BookRow[],
  lines: StatementLine[],
  matchedByLine: Map<number, number>,
): ReconItem[] {
  const items: ReconItem[] = [];
  const usedBookIds = new Set<number>();

  const bookById = new Map(books.map((b) => [b.id, b]));

  lines.forEach((line, idx) => {
    const bookId = matchedByLine.get(line.localId);
    const book = bookId !== undefined ? bookById.get(bookId) : undefined;
    if (book) usedBookIds.add(book.id);

    if (book) {
      items.push({
        status: "matched",
        txnId: book.id,
        txnDate: book.date,
        amount: book.amount,
        direction: book.direction,
        particulars: book.particulars,
        party: book.party,
        mode: book.mode,
        lineIndex: idx,
        lineDate: line.txn_date,
        lineDescription: line.description,
        dateGap: dayGap(line.txn_date, book.date),
      });
      return;
    }

    const amt = line.debit > 0 ? line.debit : line.credit;
    items.push({
      status: "only_bank",
      txnId: null,
      txnDate: null,
      amount: amt,
      direction: line.debit > 0 ? "out" : "in",
      particulars: "",
      party: "",
      mode: "",
      lineIndex: idx,
      lineDate: line.txn_date,
      lineDescription: line.description,
      dateGap: null,
    });
  });

  // Unmatched books rows
  books.forEach((book) => {
    if (usedBookIds.has(book.id)) return;
    items.push({
      status: book.mode.trim().toLowerCase() === "cheque" ? "pending" : "only_books",
      txnId: book.id,
      txnDate: book.date,
      amount: book.amount,
      direction: book.direction,
      particulars: book.particulars,
      party: book.party,
      mode: book.mode,
      lineIndex: null,
      lineDate: null,
      lineDescription: "",
      dateGap: null,
    });
  });

  const order: Record<ReconStatus, number> = {
    only_bank: 0, pending: 1, only_books: 2, matched: 3,
  };
  items.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    const d = (a.lineDate || a.txnDate || "").localeCompare(b.lineDate || b.txnDate || "");
    return d || a.amount - b.amount;
  });

  return items;
}

export function summarise(items: ReconItem[]) {
  const s = { matched: 0, pending: 0, only_bank: 0, only_books: 0, total: items.length };
  items.forEach((i) => { s[i.status] += 1; });
  return s;
}

/** Reconciliation ke liye books rows (cash count ke alava) — transfers included. */
export function booksForAccount(rows: BankTxn[], accountId: number): BookRow[] {
  return rows
    .filter((r) => num(r.account_id) === accountId)
    // Bounced/returned payment bank statement me kabhi nahi aayegi, to books
    // side se bhi hatani chahiye — warna hamesha "only_books" dikha dega.
    .filter((r) => !r.bounced_at)
    .map(toBookRow)
    .filter((r): r is BookRow => r !== null);
}
