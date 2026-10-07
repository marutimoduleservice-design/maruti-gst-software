import { sc, getCompanyId } from "../lib/company";
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import Reconciliation from "../components/Reconciliation";
import { deleteVoucherAllocations, vendorPaymentParticularsWithPo } from "../lib/billAllocations";
import type { BankAccount, BankTxn } from "../lib/bankAccounts";
import {
  TRANSFER_TYPE,
  accountTotals,
  defaultAccount,
  isBounced,
  isCashAccount,
  loadBankAccounts,
  num,
  txnDate,
  withRunningBalance,
} from "../lib/bankAccounts";

type LedgerRow = BankTxn & {
  running_balance?: number;
  account_id: number;
  _kind?: "txn" | "daytotal";
};

const TXN_TYPES = [
  "Bank Deposit / Capital (+)",
  "Direct Income / Profit (+)",
  "Office Expense / Rent (-)",
  "Staff Salary / Wages (-)",
  "Bank Charges / Taxes (-)",
  "Owner Drawings / Personal (-)",
];

const today = () => new Date().toISOString().slice(0, 10);

const emptyTxnForm = () => ({
  transaction_type: TXN_TYPES[0],
  notes: "",
  amount: "",
  payment_mode: "Bank / UPI",
  // Kaunsa account — khali matlab "jo bhi chuna hua hai" (preferred account).
  account_id: "",
  transaction_date: today(),
});

const emptyAccountForm = () => ({
  id: 0,
  name: "",
  account_type: "Bank" as "Bank" | "Cash" | "UPI",
  bank_name: "",
  account_no: "",
  opening_balance: "",
  is_default: false,
  active: true,
});

function BankPassbook() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankRows, setBankRows] = useState<BankTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [view, setView] = useState<"passbook" | "cashbook">("passbook");
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm());
  const [accountError, setAccountError] = useState("");

  const [formData, setFormData] = useState(emptyTxnForm());
  const [transferForm, setTransferForm] = useState({
    from_account_id: "",
    to_account_id: "",
    amount: "",
    transfer_date: today(),
    notes: "",
  });
  const [transferring, setTransferring] = useState(false);

  const loadAllPassbookData = async () => {
    setLoading(true);
    try {
      const [accountList, bankResult, purchaseResult] = await Promise.all([
        loadBankAccounts(),
        sc("bank_transactions").select("*").order("id", { ascending: true }),
        sc("purchases").select("inward_no, purchase_no"),
      ]);

      setAccounts(accountList);

      const { data: bankData, error } = bankResult;
      if (error) throw error;

      // Inward number -> PO number. Vendor payment lines me 40+ inward numbers ki
      // jagah PO number dikhane ke liye chahiye.
      const inwardToPo = new Map<string, string>();
      (purchaseResult.data || []).forEach((p: any) => {
        const po = String(p.purchase_no || "").trim();
        const inward = String(p.inward_no || "").trim();
        if (po && inward) inwardToPo.set(inward.toLowerCase(), po);
      });

      if (bankData && Array.isArray(bankData)) {
        const mapped: BankTxn[] = bankData.map((row: any) => {
          const rawParticulars = row.particulars || row.notes || "Bank Transaction";
          const typeStr = String(row.transaction_type || row.type || "").toLowerCase();
          const isVendorPayment = typeStr.includes("vendor payment");
          return {
            ...row,
            particulars: isVendorPayment
              ? vendorPaymentParticularsWithPo(rawParticulars, inwardToPo)
              : rawParticulars,
          } as BankTxn;
        });
        setBankRows(mapped);
      }
    } catch (err) {
      console.error("Passbook load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllPassbookData();
  }, []);

  const preferredAccount = useMemo(() => defaultAccount(accounts), [accounts]);

  useEffect(() => {
    if (!preferredAccount) return;
    setTransferForm((prev) => ({
      ...prev,
      from_account_id: prev.from_account_id || String(preferredAccount.id),
    }));
  }, [preferredAccount]);

  const cashAccountIds = useMemo(
    () => new Set(accounts.filter((a) => isCashAccount(a)).map((a) => a.id)),
    [accounts]
  );

  /**
   * Rows ko account ke hisaab se group karke running balance nikalte hain.
   * "All Accounts" me bhi har account ka balance alag chalta hai — total pool
   * ka ek mixa hua balance kuch nahi batata.
   */
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const inScope = (row: BankTxn) => {
      const rowAccountId = num(row.account_id);
      if (selectedAccountId !== 0 && rowAccountId !== selectedAccountId) return false;
      if (view === "cashbook" && !cashAccountIds.has(rowAccountId)) return false;
      return true;
    };

    const ordered = bankRows.filter(inScope).sort((a, b) => {
      const accountDiff = num(a.account_id) - num(b.account_id);
      if (accountDiff !== 0) return accountDiff;
      const dateDiff = txnDate(a).localeCompare(txnDate(b));
      if (dateDiff !== 0) return dateDiff;
      return num(a.id) - num(b.id);
    });

    const byAccount = new Map<number, LedgerRow[]>();
    ordered.forEach((row) => {
      const key = num(row.account_id);
      const bucket = byAccount.get(key) || [];
      bucket.push({ ...row, account_id: key } as LedgerRow);
      byAccount.set(key, bucket);
    });

    const withBalance: LedgerRow[] = [];
    byAccount.forEach((rows, accountId) => {
      const account = accounts.find((a) => a.id === accountId);
      const opening = num(account?.opening_balance);
      withBalance.push(...(withRunningBalance(rows, opening) as LedgerRow[]));
    });

    withBalance.reverse();
    if (view !== "cashbook") return withBalance;

    // Cash book = din ke hisaab se, har din ke total row ke saath.
    const dayRows: LedgerRow[] = [];
    let currentDay = "";
    let dayIn = 0;
    let dayOut = 0;

    const flushDay = () => {
      if (!currentDay) return;
      dayRows.push({
        id: -Math.abs(Number(currentDay.replace(/-/g, "")) || 1),
        account_id: selectedAccountId,
        transaction_date: currentDay,
        particulars: `Day Total — ${fmtDate(currentDay)}`,
        transaction_type: "Day Total",
        payment_in: dayIn,
        payment_out: dayOut,
        _kind: "daytotal",
      } as LedgerRow);
    };

    withBalance.forEach((row) => {
      const day = txnDate(row);
      if (day !== currentDay) {
        flushDay();
        currentDay = day;
        dayIn = 0;
        dayOut = 0;
      }
      // Bounce/return row ka paisa din ke total me nahi jaata.
      if (!isBounced(row)) {
        dayIn += num(row.payment_in);
        dayOut += num(row.payment_out);
      }
      dayRows.push(row);
    });
    flushDay();
    return dayRows;
  }, [bankRows, accounts, selectedAccountId, view, cashAccountIds]);

  const totals = useMemo(
    () =>
      ledgerRows.reduce(
        (acc, t) =>
          t._kind === "daytotal" || isBounced(t)
            ? acc
            : { totalIn: acc.totalIn + num(t.payment_in), totalOut: acc.totalOut + num(t.payment_out) },
        { totalIn: 0, totalOut: 0 }
      ),
    [ledgerRows]
  );

  const netBalance = totals.totalIn - totals.totalOut;

  const perAccount = useMemo(() => {
    const map = accountTotals(accounts, bankRows);
    return accounts.map((account) => ({
      account,
      ...(map.get(account.id) || { inTotal: 0, outTotal: 0, balance: 0, count: 0 }),
    }));
  }, [accounts, bankRows]);

  const grandTotal = useMemo(() => perAccount.reduce((sum, row) => sum + row.balance, 0), [perAccount]);

  const filteredList = useMemo(
    () =>
      ledgerRows.filter((t) => {
        if (t._kind === "daytotal") return true;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const accountName = String(
          accounts.find((a) => a.id === t.account_id)?.name || ""
        ).toLowerCase();
        return (
          String(t.particulars || "").toLowerCase().includes(q) ||
          String(t.transaction_type || "").toLowerCase().includes(q) ||
          String(t.transaction_date || "").toLowerCase().includes(q) ||
          accountName.includes(q)
        );
      }),
    [ledgerRows, search, accounts]
  );

  const pbCols = {
    date: (t: any) => String(t.transaction_date || ""),
    particulars: (t: any) => String(t.particulars || ""),
    payment_in: (t: any) => Number(t.payment_in || 0),
    payment_out: (t: any) => Number(t.payment_out || 0),
    balance: (t: any) => Number(t.running_balance || 0),
  } as const;
  const { sort, sorted: sortedList } = useSortedRows(filteredList, pbCols, "date", "desc");

  /** Migration chalti hi nahi to crash nahi hona chahiye. */
  const accountsReady = !(accounts.length === 1 && accounts[0].id === 0);

  /**
   * Jin transactions ka account_id set nahi hai unka paisa kisi account ke
   * balance me nahi jaata. Ye chup-chaap chhupne nahi chahiye, warna "sab
   * mila" total aur "har account ka total" alag dikhenge.
   */
  const orphanTxnCount = useMemo(
    () => bankRows.filter((row) => !row.account_id).length,
    [bankRows]
  );
  const requireAccount = () => {
    if (!accountsReady) {
      alert(
        "❌ Bank accounts table abhi banayi nahi gayi.\n\nPehle Supabase SQL Editor me `bank-accounts-migration.sql` chalayein."
      );
      return false;
    }
    return true;
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAccount()) return;

    const amt = Number(formData.amount || 0);
    if (amt <= 0) {
      alert("❌ कृपया सही राशि दर्ज करें!");
      return;
    }
    // Account ka pehle se ye order hai:
    //   1. Form me jo chuna (dropdown)
    //   2. Screen par jo account dekh rahe hain (Cash Box dekh rahe hain to cash me daalo)
    //   3. Default account
    // Pehle sirf default use hota tha — isliye Cash Box select kar ke bhi entry
    // bank account me chala jaata tha aur Cash Book khaali rehta tha.
    const chosenInForm = Number(formData.account_id || 0);
    const accountId =
      chosenInForm || (selectedAccountId !== 0 ? selectedAccountId : 0) || preferredAccount?.id;
    if (!accountId) {
      alert("❌ Pehle koi bank account banaayein (Manage Accounts).");
      return;
    }

    setSaving(true);
    const isInflow = formData.transaction_type.includes("(+)");
    const pIn = isInflow ? amt : 0;
    const pOut = isInflow ? 0 : amt;

    try {
      const { error } = await sc("bank_transactions").insert([
        {
          account_id: accountId,
          transaction_date: formData.transaction_date,
          particulars:
            formData.notes || (isInflow ? "Bank: Deposit / Capital" : "Direct Expense / Outflow"),
          notes: formData.notes,
          party_name: isInflow ? "Bank / Capital Account" : "Expense Account",
          transaction_type: formData.transaction_type,
          payment_in: pIn,
          payment_out: pOut,
          amount: amt,
          type: isInflow ? "credit" : "debit",
          payment_mode: formData.payment_mode,
          is_transfer: false,
        },
      ]);
      if (error) throw error;

      alert(`✅ ₹${amt.toLocaleString("en-IN")} पासबुक में दर्ज हुआ!`);
      setFormData(emptyTxnForm());
      await loadAllPassbookData();
    } catch (err: any) {
      alert("❌ Save Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Account-to-account transfer = 2 rows (ek me se, ek me).
   * `is_transfer` flag se reports inhe income/expense se bahar rakhte hain,
   * warna Cash Box se bank me paisa bhejna ek "expense" ban jayega.
   */
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAccount()) return;

    const amt = Number(transferForm.amount || 0);
    const fromId = Number(transferForm.from_account_id);
    const toId = Number(transferForm.to_account_id);

    if (amt <= 0) return alert("❌ Sahi amount daalein.");
    if (!fromId || !toId) return alert("❌ Dono account chunein (kahan se → kahan me).");
    if (fromId === toId) return alert("❌ Source aur destination account alag hone chahiye.");

    const fromAccount = accounts.find((a) => a.id === fromId);
    const toAccount = accounts.find((a) => a.id === toId);
    const note = transferForm.notes.trim();
    const labelText = `${fromAccount?.name || "Account"} → ${toAccount?.name || "Account"}`;
    const particulars = `Transfer: ${labelText}${note ? ` (${note})` : ""}`;
    const base = {
      transaction_date: transferForm.transfer_date,
      particulars,
      notes: `Transfer: ${labelText}`,
      transaction_type: TRANSFER_TYPE,
      amount: amt,
      payment_mode: "Internal Transfer",
      is_transfer: true,
      credit_amount: 0,
      debit_amount: 0,
    };

    setTransferring(true);
    try {
      const { error } = await sc("bank_transactions").insert([
        {
          ...base,
          account_id: fromId,
          party_name: toAccount?.name || "Own Account",
          type: "debit",
          payment_in: 0,
          payment_out: amt,
          debit_amount: amt,
          transfer_to_account_id: toId,
        },
        {
          ...base,
          account_id: toId,
          party_name: fromAccount?.name || "Own Account",
          type: "credit",
          payment_in: amt,
          payment_out: 0,
          credit_amount: amt,
          transfer_to_account_id: fromId,
        },
      ]);
      if (error) throw error;

      alert(`✅ ₹${amt.toLocaleString("en-IN")} ka transfer ho gaya — ${labelText}`);
      setTransferForm({ ...transferForm, amount: "", notes: "" });
      await loadAllPassbookData();
    } catch (err: any) {
      alert("❌ Transfer Error: " + err.message);
    } finally {
      setTransferring(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("क्या आप वाकई इस ट्रांजेक्शन को पासबुक से हटाना चाहते हैं?")) return;
    try {
      // Voucher ki bill-wise allocation lines bhi hatao (best-effort).
      await deleteVoucherAllocations(Number(id));
      const { error } = await sc("bank_transactions").delete().eq("id", id);
      if (error) throw error;
      await loadAllPassbookData();
    } catch (err: any) {
      alert("Delete error: " + err.message);
    }
  };

  // --------------------------- Manage Accounts ---------------------------

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) {
      setAccountError("Account ka naam zaroori hai.");
      return;
    }
    setAccountError("");

    const payload: Record<string, unknown> = {
      name,
      account_type: accountForm.account_type,
      bank_name: accountForm.bank_name.trim() || null,
      account_no: accountForm.account_no.trim() || null,
      opening_balance: Number(accountForm.opening_balance || 0),
      is_default: accountForm.is_default,
      active: accountForm.active,
      sort_order: accounts.length,
    };

    try {
      if (accountForm.is_default) {
        await sc("bank_accounts").update({ is_default: false }).eq("company_id", getCompanyId());
      }

      if (accountForm.id) {
        const { error } = await sc("bank_accounts").update(payload).eq("id", accountForm.id);
        if (error) throw error;
      } else {
        const { error } = await sc("bank_accounts").insert([payload]);
        if (error) throw error;
      }

      setAccountForm(emptyAccountForm());
      await loadAllPassbookData();
    } catch (err: any) {
      setAccountError("Save Error: " + err.message);
    }
  };

  const toggleDefault = async (account: BankAccount) => {
    try {
      await sc("bank_accounts").update({ is_default: false }).eq("company_id", getCompanyId());
      const { error } = await sc("bank_accounts").update({ is_default: true }).eq("id", account.id);
      if (error) throw error;
      await loadAllPassbookData();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const toggleActive = async (account: BankAccount) => {
    try {
      const { error } = await sc("bank_accounts").update({ active: !account.active }).eq("id", account.id);
      if (error) throw error;
      await loadAllPassbookData();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const removeAccount = async (account: BankAccount) => {
    const used = bankRows.filter((r) => num(r.account_id) === account.id).length;
    if (used > 0) {
      alert(
        `❌ "${account.name}" me ${used} transaction hain. Delete karne se woh transactions orphan ho jayenge.\n\nAccount ko "Inactive" kar dijiye — history bachi rahegi.`
      );
      return;
    }
    if (!window.confirm(`"${account.name}" delete karein?`)) return;
    try {
      const { error } = await sc("bank_accounts").delete().eq("id", account.id);
      if (error) throw error;
      await loadAllPassbookData();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const startEditAccount = (account: BankAccount) => {
    setAccountForm({
      id: account.id,
      name: account.name,
      account_type: account.account_type,
      bank_name: account.bank_name || "",
      account_no: account.account_no || "",
      opening_balance: String(num(account.opening_balance)),
      is_default: account.is_default,
      active: account.active,
    });
  };

  const showAccountColumn = selectedAccountId === 0 && view === "passbook";

  if (showRecon) {
    return (
      <div style={{ width: "100%" }}>
        <Reconciliation accounts={accounts} rows={bankRows} onClose={() => setShowRecon(false)} />
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
          Bank Passbook, Cash Book & Expenses Ledger
        </h1>
        <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
          हर अकाउंट (Bank / Cash / UPI) अलग-अलग — हर लेन-देन के साथ उसी अकाउंट का अपना बैलेंस।
        </p>
      </div>

      {/* ACCOUNT SELECTOR + VIEW TABS */}
      <div style={panelBarStyle}>
        <div style={{ minWidth: 230 }}>
          <label style={labelStyle}>अकाउंट चुनें</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(Number(e.target.value))}
            style={inputStyle}
          >
            <option value={0}>सभी अकाउंट (All Accounts)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.account_type}){a.is_default ? " — default" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>बुक</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => setView("passbook")} style={tabStyle(view === "passbook")}>
              📒 Passbook
            </button>
            <button onClick={() => setView("cashbook")} style={tabStyle(view === "cashbook")}>
              💵 Cash Book
            </button>
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button onClick={() => setShowRecon(true)} style={secondaryBtn}>
            🔄 Reconciliation
          </button>
          <button onClick={() => { setShowAccounts((v) => !v); setAccountError(""); }} style={secondaryBtn}>
            🏦 Manage Accounts
          </button>
          <button onClick={loadAllPassbookData} style={secondaryBtn}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {!accountsReady && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: 14,
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          ⚠️ <strong>bank_accounts table abhi nahi hai.</strong> Supabase SQL Editor me{" "}
          <code>supabase/bank-accounts-migration.sql</code> chalayein. Tab tak nayi entry nahi banegi aur
          purana data "All Accounts" me dikhta rahega.
        </div>
      )}

      {/* MANAGE ACCOUNTS PANEL */}
      {showAccounts && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
            🏦 Bank / Cash / UPI Accounts
          </h3>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>
            <strong>Default</strong> account naye transactions me chuna jata hai.{" "}
            <strong>Opening Balance</strong> tabhi daalein jab us account ka pehle se balance ho — us din ke
            hisaab se; warna 0 rakhein taaki total dobara na ginne lage.
          </p>

          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={thStyle}>Account</th>
                  <th style={thStyle}>Type</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Opening</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>IN</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>OUT</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Balance</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Txn</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {perAccount.map(({ account, inTotal, outTotal, balance, count }) => (
                  <tr
                    key={account.id}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      fontSize: 13,
                      opacity: account.active ? 1 : 0.55,
                    }}
                  >
                    <td style={tdStyle}>
                      <strong style={{ color: "#0f172a" }}>{account.name}</strong>
                      {account.is_default && <span style={badge("#dcfce7", "#166534")}>DEFAULT</span>}
                      {!account.active && <span style={badge("#fee2e2", "#991b1b")}>INACTIVE</span>}
                      {(account.bank_name || account.account_no) && (
                        <span style={{ display: "block", fontSize: 11, color: "#64748b" }}>
                          {account.bank_name || ""}
                          {account.account_no ? ` • A/C ${account.account_no}` : ""}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>{account.account_type}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{moneyPlain(num(account.opening_balance))}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#16a34a" }}>{moneyPlain(inTotal)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#dc2626" }}>{moneyPlain(outTotal)}</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 800,
                        color: balance >= 0 ? "#0f172a" : "#be123c",
                      }}
                    >
                      {moneyPlain(balance)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>{count}</td>
                    <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => startEditAccount(account)} style={iconBtn} title="Edit">
                        ✏
                      </button>
                      {!account.is_default && (
                        <button onClick={() => toggleDefault(account)} style={iconBtn} title="Default banaayein">
                          ★
                        </button>
                      )}
                      <button onClick={() => toggleActive(account)} style={iconBtn} title="Active / Inactive">
                        {account.active ? "⏸" : "▶"}
                      </button>
                      <button
                        onClick={() => removeAccount(account)}
                        style={{ ...iconBtn, background: "#fee2e2", color: "#991b1b" }}
                        title="Delete"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#f8fafc", fontWeight: 800, fontSize: 13 }}>
                  <td colSpan={3} style={tdStyle}>कुल (All Accounts)</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#16a34a" }}>
                    {moneyPlain(perAccount.reduce((s, r) => s + r.inTotal, 0))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#dc2626" }}>
                    {moneyPlain(perAccount.reduce((s, r) => s + r.outTotal, 0))}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "right",
                      color: grandTotal >= 0 ? "#0f172a" : "#be123c",
                      fontSize: 14,
                    }}
                  >
                    {moneyPlain(grandTotal)}
                  </td>
                  <td style={tdStyle} colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>

          <form onSubmit={saveAccount} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
            <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#334155" }}>
              {accountForm.id ? "✏ Account update करें" : "+ नया Account बनाएँ"}
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr 1.5fr 1.2fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Account Name *</label>
                <input
                  required
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  placeholder="e.g. HDFC Current A/c, Cash Box"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={accountForm.account_type}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, account_type: e.target.value as "Bank" | "Cash" | "UPI" })
                  }
                  style={inputStyle}
                >
                  <option value="Bank">Bank</option>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Bank Name</label>
                <input
                  value={accountForm.bank_name}
                  onChange={(e) => setAccountForm({ ...accountForm, bank_name: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>A/C Number</label>
                <input
                  value={accountForm.account_no}
                  onChange={(e) => setAccountForm({ ...accountForm, account_no: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Opening Balance</label>
                <input
                  type="number"
                  step="0.01"
                  value={accountForm.opening_balance}
                  onChange={(e) => setAccountForm({ ...accountForm, opening_balance: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={accountForm.is_default}
                  onChange={(e) => setAccountForm({ ...accountForm, is_default: e.target.checked })}
                />
                Default account (नई entry इसमें जाएगी)
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={accountForm.active}
                  onChange={(e) => setAccountForm({ ...accountForm, active: e.target.checked })}
                />
                Active
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" style={primaryBtn("#0f766e")}>
                  {accountForm.id ? "Update Account" : "+ Add Account"}
                </button>
                {accountForm.id > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAccountForm(emptyAccountForm());
                      setAccountError("");
                    }}
                    style={secondaryBtn}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {accountError && <span style={{ color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>{accountError}</span>}
            </div>
          </form>
        </div>
      )}

      {orphanTxnCount > 0 && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#92400e",
            padding: 14,
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          ⚠️ <strong>{orphanTxnCount} transaction</strong> ka koi account nahi hai — inka paisa
          &quot;सभी अकाउंट&quot; me dikhta hai par kisi account ke balance me nahi jaata. Isliye
          &quot;कुल सभी अकाउंट बैलेंस&quot;, नीचे दिखने वाले account total से ₹
          {Math.abs(netBalance - grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })} ka
          farak hai.
          <br />
          <span style={{ fontSize: 12 }}>
            Theek karne ke liye Supabase me <code>bank-accounts-backfill-fix.sql</code>{" "}
            chalayein.
          </span>
        </div>
      )}

      {/* KPI CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
        <div style={kpiBoxStyle("#f0fdf4")}>
          <span style={kpiLabelStyle}>Total IN (+) — {view === "cashbook" ? "Cash Book" : "चयनित अकाउंट"}</span>
          <strong style={{ display: "block", fontSize: 22, color: "#15803d", marginTop: 4 }}>
            ₹ {totals.totalIn.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>
        <div style={kpiBoxStyle("#fef2f2")}>
          <span style={kpiLabelStyle}>Total OUT (-) — {view === "cashbook" ? "Cash Book" : "चयनित अकाउंट"}</span>
          <strong style={{ display: "block", fontSize: 22, color: "#dc2626", marginTop: 4 }}>
            ₹ {totals.totalOut.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>
        <div style={kpiBoxStyle(netBalance >= 0 ? "#eff6ff" : "#fff1f2")}>
          <span style={kpiLabelStyle}>
            {selectedAccountId === 0 ? "कुल सभी अकाउंट बैलेंस" : "अकाउंट बैलेंस"}
          </span>
          <strong
            style={{
              display: "block",
              fontSize: 22,
              color: netBalance >= 0 ? "#1d4ed8" : "#be123c",
              marginTop: 4,
            }}
          >
            ₹ {netBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
          {selectedAccountId === 0 && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              सभी अकाउंट मिलाकर: ₹ {grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </div>

      {/* ACCOUNT-WISE LIVE BALANCES — har account ka current paisa, aur total */}
      <div style={{ ...panelStyle, marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
            Account-wise Live Balance
          </span>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Total Live{" "}
            <strong style={{ color: grandTotal >= 0 ? "#0f172a" : "#be123c" }}>
              ₹ {grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </strong>
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 10,
          }}
        >
          {perAccount
            .filter((row) => row.account.active)
            .map(({ account, balance, count }) => {
              const isSelected = selectedAccountId === account.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelectedAccountId(isSelected ? 0 : account.id)}
                  title={isSelected ? "All Accounts par wapas jaayein" : "Sirf ye account dekhein"}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                    background: isSelected ? "#eff6ff" : "#fff",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#0f172a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {account.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: isCashAccount(account) ? "#16a34a" : "#475569",
                      }}
                    >
                      {account.account_type} · {count} txn
                    </span>
                  </span>
                  <strong
                    style={{
                      fontSize: 15,
                      color: balance >= 0 ? "#0f172a" : "#be123c",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ₹ {balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </strong>
                </button>
              );
            })}
        </div>
      </div>

      {/* NEW TRANSACTION + TRANSFER FORMS */}
      <div style={{ display: "grid", gridTemplateColumns: view === "cashbook" ? "1fr" : "1.25fr 1fr", gap: 16, marginBottom: 18 }}>
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "#ea580c" }}>
            💰 नई Entry —{" "}
            {(() => {
              const inForm = accounts.find(
                (a) => String(a.id) === String(formData.account_id || "")
              );
              const shown =
                inForm || accounts.find((a) => a.id === selectedAccountId) || preferredAccount;
              return shown ? shown.name : "कोई अकाउंट नहीं";
            })()}
          </h3>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "#64748b" }}>
            नीचे Account चुनें — Cash चुनते ही यह entry Cash Box में जाएगी और Cash Book वहीं
            दिखेगी। ऊपर जो account खुला है, यही उसमें लिखी जाएगी।
          </p>

          <form onSubmit={handleSaveTransaction}>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Transaction Type *</label>
                <select
                  value={formData.transaction_type}
                  onChange={(e) => setFormData({ ...formData, transaction_type: e.target.value })}
                  style={inputStyle}
                >
                  {TXN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Notes / Particulars *</label>
                <input
                  required
                  placeholder="e.g. Rent, Salary, Owner Capital"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  style={{ ...inputStyle, fontWeight: 700, fontSize: 15 }}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input
                  type="date"
                  value={formData.transaction_date}
                  onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Account</label>
                <select
                  value={formData.account_id || String(selectedAccountId !== 0 ? selectedAccountId : preferredAccount?.id || "")}
                  onChange={(e) => {
                    const id = e.target.value;
                    const acc = accounts.find((a) => String(a.id) === id);
                    setFormData({
                      ...formData,
                      account_id: id,
                      // Account hi asli hai — Mode uske hisaab se set karo, warna
                      // "Cash" chun ke bhi entry bank account me chali jayegi.
                      payment_mode: acc ? (isCashAccount(acc) ? "Cash" : "Bank / UPI") : formData.payment_mode,
                    });
                  }}
                  style={inputStyle}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.account_type}){a.is_default ? " — default" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Mode</label>
                <select
                  value={formData.payment_mode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setFormData((prev) => {
                      // Mode = Cash aur account cash type ka nahi hai → cash
                      // account par le jaao, warna Cash Book me entry dikhegi hi nahi.
                      if (mode === "Cash") {
                        const cur = accounts.find((a) => String(a.id) === prev.account_id);
                        if (!isCashAccount(cur)) {
                          const cashAcc = accounts.find((a) => isCashAccount(a));
                          if (cashAcc) return { ...prev, payment_mode: mode, account_id: String(cashAcc.id) };
                        }
                      }
                      return { ...prev, payment_mode: mode };
                    });
                  }}
                  style={inputStyle}
                >
                  <option>Bank / UPI</option>
                  <option>Cash</option>
                  <option>Cheque</option>
                  <option>UPI</option>
                  <option>Card</option>
                </select>
              </div>
              <button type="submit" disabled={saving} style={{ ...primaryBtn("#ea580c"), marginTop: 0 }}>
                {saving ? "Saving..." : "Save Entry"}
              </button>
            </div>
          </form>
        </div>

        {view !== "cashbook" && (
          <div style={panelStyle}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "#0f766e" }}>
              🔁 Account Transfer (अपने ही पैसे का)
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#64748b" }}>
              Cash Box से bank में डालना या bank से cash में निकालना — यह खर्च नहीं है, इसलिए profit और
              expense report में count नहीं होगा।
            </p>

            <form onSubmit={handleTransfer}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>किससे (From) *</label>
                  <select
                    required
                    value={transferForm.from_account_id}
                    onChange={(e) => setTransferForm({ ...transferForm, from_account_id: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">— चुनें —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>किसमें (To) *</label>
                  <select
                    required
                    value={transferForm.to_account_id}
                    onChange={(e) => setTransferForm({ ...transferForm, to_account_id: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">— चुनें —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                    style={{ ...inputStyle, fontWeight: 700, fontSize: 15 }}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input
                    type="date"
                    value={transferForm.transfer_date}
                    onChange={(e) => setTransferForm({ ...transferForm, transfer_date: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Remark</label>
                  <input
                    placeholder="e.g. Cash deposit HDFC me"
                    value={transferForm.notes}
                    onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <button type="submit" disabled={transferring} style={{ ...primaryBtn("#0f766e"), marginTop: 0 }}>
                  {transferring ? "..." : "🔁 Transfer"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* LEDGER TABLE */}
      <div style={{ ...panelStyle, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: "16px 20px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              {view === "cashbook"
                ? "💵 Cash Book — दिनवार हिसाब"
                : "📒 Passbook Ledger (Payment IN / OUT)"}
            </h3>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {view === "cashbook"
                ? "हर दिन का अलग टोटल — cash box का असली हिसाब"
                : "हर अकाउंट का अपना running balance"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              placeholder="Search Particulars / Account..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, marginTop: 0, minWidth: 250 }}
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ ...thStyle, width: 55 }}>Sr</th>
                <SortTh label="Date" active={sort.key === "date"} dir={sort.dir} onToggle={() => sort.toggle("date")} style={thStyle} />
                {showAccountColumn && <th style={thStyle}>अकाउंट</th>}
                <SortTh label="Particulars" active={sort.key === "particulars"} dir={sort.dir} onToggle={() => sort.toggle("particulars")} style={thStyle} />
                <SortTh label="IN (+)" active={sort.key === "payment_in"} dir={sort.dir} onToggle={() => sort.toggle("payment_in")} style={{ ...thStyle, textAlign: "right", color: "#16a34a" }} align="right" />
                <SortTh label="OUT (-)" active={sort.key === "payment_out"} dir={sort.dir} onToggle={() => sort.toggle("payment_out")} style={{ ...thStyle, textAlign: "right", color: "#dc2626" }} align="right" />
                <SortTh label="Balance" active={sort.key === "balance"} dir={sort.dir} onToggle={() => sort.toggle("balance")} style={{ ...thStyle, textAlign: "right", color: "#0f172a" }} align="right" />
                <th style={{ ...thStyle, textAlign: "center", width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading passbook ledger...
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    {view === "cashbook"
                      ? "Cash Box में कोई लेन-देन नहीं मिला।"
                      : "कोई पासबुक ट्रांजेक्शन नहीं मिला।"}
                  </td>
                </tr>
              ) : (
                sortedList.map((t, idx) => {
                  const isDayTotal = t._kind === "daytotal";
                  const accountName = accounts.find((a) => a.id === t.account_id)?.name;
                  return (
                    <tr
                      key={`${t.id}-${idx}`}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        fontSize: 13,
                        background: isDayTotal ? "#fffbeb" : "transparent",
                        fontWeight: isDayTotal ? 800 : 400,
                      }}
                    >
                      <td style={{ ...tdStyle, color: "#64748b", fontWeight: 600 }}>
                        {isDayTotal ? "" : idx + 1}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: "#334155" }}>{fmtDate(t.transaction_date)}</span>
                      </td>
                      {showAccountColumn && (
                        <td style={{ ...tdStyle, fontSize: 12, color: "#475569" }}>{accountName || "—"}</td>
                      )}
                      <td style={tdStyle}>
                        <strong style={{ color: "#0f172a", display: "block" }}>{t.particulars}</strong>
                        {!isDayTotal && (
                          <span
                            style={{
                              fontSize: 11,
                              color: num(t.payment_in) > 0 ? "#15803d" : "#b91c1c",
                              fontWeight: 600,
                            }}
                          >
                            {t.transaction_type}
                          </span>
                        )}
                        {/* Mode: paisa kis raaste se aaya/gaya — Cash, Cheque,
                            NEFT/UPI. Pehle save hota tha par dikhta nahi tha. */}
                        {!isDayTotal && t.payment_mode ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              fontWeight: 500,
                              marginLeft: 6,
                            }}
                          >
                            · {t.payment_mode}
                          </span>
                        ) : null}
                        {/* Bounce/return: paisa hua nahi — balance isko
                            ignore karta hai, par row dikhti rahe. */}
                        {!isDayTotal && isBounced(t) ? (
                          <span
                            title={t.bounce_reason || "Payment bounced / returned"}
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              background: "#fee2e2",
                              color: "#b91c1c",
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontWeight: 800,
                            }}
                          >
                            ↩ BOUNCED
                          </span>
                        ) : null}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                        {num(t.payment_in) > 0 ? `₹ ${moneyPlain(num(t.payment_in))}` : ""}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                        {num(t.payment_out) > 0 ? `₹ ${moneyPlain(num(t.payment_out))}` : ""}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                        {isDayTotal ? "" : `₹ ${moneyPlain(num(t.running_balance))}`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {!isDayTotal && (
                          <button onClick={() => handleDelete(t.id)} style={deleteBtn}>
                            Delete
                          </button>
                        )}
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

const moneyPlain = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2 });

const badge = (background: string, color: string): React.CSSProperties => ({
  marginLeft: 6,
  fontSize: 10,
  background,
  color,
  padding: "1px 6px",
  borderRadius: 4,
  fontWeight: 700,
});

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  padding: 20,
  boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
};

const panelBarStyle: React.CSSProperties = {
  ...panelStyle,
  display: "flex",
  gap: 16,
  alignItems: "flex-end",
  flexWrap: "wrap",
};

const primaryBtn = (background: string): React.CSSProperties => ({
  background,
  color: "#fff",
  border: "none",
  padding: "11px 18px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  marginTop: 4,
});

const secondaryBtn: React.CSSProperties = {
  background: "#fff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  padding: "9px 14px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  marginTop: 4,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "#0f766e" : "#fff",
  color: active ? "#fff" : "#334155",
  border: `1px solid ${active ? "#0f766e" : "#cbd5e1"}`,
  padding: "9px 16px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
});

const iconBtn: React.CSSProperties = {
  background: "#f1f5f9",
  color: "#334155",
  border: "1px solid #e2e8f0",
  padding: "3px 7px",
  borderRadius: 6,
  fontSize: 11,
  cursor: "pointer",
  marginRight: 4,
};

const deleteBtn: React.CSSProperties = {
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const kpiBoxStyle = (background: string): React.CSSProperties => ({
  background,
  padding: "16px 18px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.05)",
});

const kpiLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#475569" };

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = { padding: "13px 14px", color: "#334155" };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  marginTop: 4,
  boxSizing: "border-box",
  background: "#fff",
};

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#334155" };

export default BankPassbook;
