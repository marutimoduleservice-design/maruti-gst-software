import { sc } from "./company";

/**
 * Bank / Cash / UPI accounts ke liye shared logic.
 *
 * Pehle saara paisa ek hi pool me tha, isliye "kitna cash box me hai aur kitna
 * bank me" ka jawab kahi nahi milta tha. Ab har transaction ek account se
 * judti hai, aur balance per account nikalti hai.
 */

export type AccountType = "Bank" | "Cash" | "UPI";

export type BankAccount = {
  id: number;
  company_id?: number;
  name: string;
  account_type: AccountType;
  bank_name?: string | null;
  account_no?: string | null;
  opening_balance: number;
  is_default: boolean;
  active: boolean;
  sort_order?: number;
};

export type BankTxn = {
  id: number;
  account_id?: number | null;
  transaction_no?: string | null;
  transaction_date?: string | null;
  created_at?: string | null;
  particulars?: string | null;
  notes?: string | null;
  party_name?: string | null;
  transaction_type?: string | null;
  type?: string | null;
  payment_in?: number | null;
  payment_out?: number | null;
  credit_amount?: number | null;
  debit_amount?: number | null;
  amount?: number | null;
  total_amount?: number | null;
  payment_mode?: string | null;
  remarks?: string | null;
  is_transfer?: boolean | null;
  transfer_to_account_id?: number | null;
  cheque_no?: string | null;
  cheque_date?: string | null;
  utr_no?: string | null;
  bounce_reason?: string | null;
  bounced_at?: string | null;
};

export const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Apne account se dusre account me transfer — income/expense nahi hota. */
export const TRANSFER_TYPE = "Account Transfer (+/-)";

/**
 * Payment bounce / cheque return. `bounced_at` non-null hone ka matlab paisa
 * bank se kabhi bahar hi nahi gaya — isliye balance, expense, profit aur bill
 * allocation ki har calculation me ye row exclude hoti hai. Row passbook /
 * ledger me dikhti zaroor hai (badge ke saath), sirf hisaab me nahi aati.
 *
 * Migration se pehle column hi nahi hota, tab `undefined` → false, behaviour
 * bilkul waisi hi rehti hai jaise aaj hai.
 */
export const isBounced = (row: { bounced_at?: string | null } | null | undefined): boolean =>
  Boolean(row && row.bounced_at);

export function isTransferRow(row: BankTxn): boolean {
  return row.is_transfer === true || String(row.transaction_type || "").trim() === TRANSFER_TYPE;
}

/**
 * Raw bank_transactions row se payment_in / payment_out nikaalti hai.
 *
 * Purane rows me kabhi kabhi sirf `amount` bhara hota hai (dono zero), to
 * transaction_type se direction guess karna padta tha. Yehi fallback yahan
 * ek jagah rakh diya hai taaki har report same rule use kare.
 */
export function resolveInOut(row: BankTxn): { pIn: number; pOut: number } {
  // `||` zaroori hai, `??` nahi: agar amount = 0 ho to total_amount lena
  // chahiye (purane passbook ka behaviour waisa hi tha). `??` use karte to
  // 0 par ruk jaata aur legacy rows ka paisa chhoot jaata.
  const rawAmt = num(row.amount || row.total_amount);
  let pIn = num(row.payment_in ?? row.credit_amount);
  let pOut = num(row.payment_out ?? row.debit_amount);

  if (pIn === 0 && pOut === 0) {
    const typeStr = String(row.transaction_type || row.type || "").toLowerCase();
    const looksLikeInflow =
      typeStr.includes("+") ||
      typeStr.includes("deposit") ||
      typeStr.includes("capital") ||
      typeStr.includes("credit") ||
      typeStr.includes("income") ||
      typeStr.includes("receipt");
    if (looksLikeInflow) pIn = rawAmt;
    else pOut = rawAmt;
  }

  return { pIn, pOut };
}

/** Transaction ki date — transaction_date pehle, warna created_at. */
export function txnDate(row: BankTxn, fallback = new Date().toISOString().slice(0, 10)): string {
  return row.transaction_date || (row.created_at ? row.created_at.slice(0, 10) : fallback);
}

/**
 * Har account ke liye opening + IN - OUT nikalta hai, saath me totals.
 * Rows kisi bhi order me ho, chalega — order se koi lena-dena nahi.
 */
export function accountTotals(accounts: BankAccount[], rows: BankTxn[]) {
  const map = new Map<number, { inTotal: number; outTotal: number; balance: number; count: number }>();

  accounts.forEach((account) => {
    map.set(account.id, { inTotal: 0, outTotal: 0, balance: num(account.opening_balance), count: 0 });
  });

  rows.forEach((row) => {
    const accountId = Number(row.account_id);
    if (!accountId) return; // orphan row — kisi account me count nahi hoga
    const bucket = map.get(accountId);
    if (!bucket) return;
    bucket.count += 1;
    if (isBounced(row)) return; // bounce = paisa hila hi nahi, balance me nahi
    const { pIn, pOut } = resolveInOut(row);
    bucket.inTotal += pIn;
    bucket.outTotal += pOut;
    bucket.balance += pIn - pOut;
  });

  return map;
}

/**
 * Chronological running balance, account ke andar. Acha — purana hisab
 * starting balance se shuru hota hai, har row ke baad update hota hai.
 */
export function withRunningBalance(rows: BankTxn[], openingBalance = 0): BankTxn[] {
  let running = openingBalance;
  return rows.map((row) => {
    // Bounced row: amount dikhega (aur badge bhi), par running balance
    // wahi ka wahi rehta hai — paisa bahar gaya hi nahi tha.
    if (isBounced(row)) return { ...row, running_balance: running };
    const { pIn, pOut } = resolveInOut(row);
    running += pIn - pOut;
    return { ...row, payment_in: pIn, payment_out: pOut, running_balance: running };
  });
}

/**
 * Accounts load karo. Agar table abhi tak banayi hi nahi gayi (migration
 * chalti hi nahi) to ek default pseudo-account de deta hai, taaki page
 * blank-crash na ho — sirf accounts manage karna band rahega.
 */
export async function loadBankAccounts(includeInactive = false): Promise<BankAccount[]> {
  const fallback: BankAccount[] = [
    {
      id: 0,
      name: "Cash Box",
      account_type: "Cash",
      opening_balance: 0,
      is_default: true,
      active: true,
      sort_order: 0,
    },
  ];

  try {
    let query = sc("bank_accounts").select("*").order("sort_order", { ascending: true });
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) {
      console.error("bank_accounts load error:", error);
      return fallback;
    }
    const rows = (data || []) as BankAccount[];
    return rows.length > 0 ? rows : fallback;
  } catch (err) {
    console.error("bank_accounts load error:", err);
    return fallback;
  }
}

/** Naye entries ka default account (Manage Accounts se toggle hota hai). */
export function defaultAccount(accounts: BankAccount[]): BankAccount | null {
  if (accounts.length === 0) return null;
  return accounts.find((a) => a.is_default && a.active) || accounts.find((a) => a.active) || accounts[0];
}

export const accountLabel = (account?: BankAccount | null) =>
  account ? `${account.name} (${account.account_type})` : "Unknown Account";

export const isCashAccount = (account?: BankAccount | null) =>
  String(account?.account_type || "").toLowerCase() === "cash";
