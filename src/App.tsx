import { useRef, useState, useEffect } from "react";
import { sc, fetchCompanies, getCompanyId, setCompanyId, clearCompanyId, isGstCompany, invoicePrefixFor } from "./lib/company";
import type { Company } from "./lib/company";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { fmtDate } from "./lib/formatDate";
import { computeProfitMonthly, profitTotals } from "./lib/profitCalc";
import { computeStockValue } from "./lib/stockValue";
import { isTransferRow } from "./lib/bankAccounts";
import { buildAllocations, loadDbAllocations, type AllocBill } from "./lib/billAllocations";
import { backfillPaymentAllocations } from "./lib/allocationBackfill";
import { currentFY } from "./lib/financialYear";
import { allowedMenus, canOpen, roleLabel, type AppUser } from "./lib/roles";
import "./App.css";
import Login from "./pages/Login";
import UsersRoles from "./pages/UsersRoles";
import ActivityLog from "./pages/ActivityLog";
import SyncBanner from "./components/SyncBanner";

// Operational Pages
import Customers from "./pages/Customers";
import JobCards from "./pages/JobCards";
import Invoices from "./pages/Invoices";
import Purchase from "./pages/Purchase";
import PaymentsLedger from "./pages/PaymentsLedger";
import BankPassbook from "./pages/BankPassbook";
import Warranty from "./pages/Warranty";
import PrintCenter from "./pages/PrintCenter";
import LabelPrint from "./pages/LabelPrint";
import MyCompanyDetails from "./pages/MyCompanyDetails";

// Master Record Pages
import ItemMaster from "./pages/ItemMaster";
import Vendors from "./pages/Vendors";
import TechnicianMaster from "./pages/TechnicianMaster";
import CustomerWisePrice from "./pages/CustomerWisePrice";

// All 6 Reports
import Stock from "./pages/Stock";
import SalesReport from "./pages/SalesReport";
import PurchaseReport from "./pages/PurchaseReport";
import ExpenseReport from "./pages/ExpenseReport";
import NetProfitReport from "./pages/NetProfitReport";
import SalaryReport from "./pages/SalaryReport";
import ItemWiseQtyInOutReport from "./pages/ItemWiseQtyInOutReport";

type MenuItem = {
  name: string;
  icon: string;
};

const mainMenuItems: MenuItem[] = [
  { name: "Dashboard", icon: "⌂" },
  { name: "Module Repair", icon: "🔧" },
  { name: "Sales / Invoice", icon: "🧾" },
  { name: "Purchase", icon: "📦" },
  { name: "Payments / Ledger", icon: "₹" },
  { name: "Bank Passbook & Expenses", icon: "💰" },
  { name: "Warranty", icon: "🛡" },
  { name: "Print Center", icon: "🖨️" },
  { name: "Label Print", icon: "🏷️" },
];

const masterSubItems: MenuItem[] = [
  { name: "Customers", icon: "👥" },
  { name: "Item Master", icon: "⚙" },
  { name: "Customer Wise Price", icon: "💰" },
  { name: "Vendor Master", icon: "🏢" },
  { name: "Technician Master", icon: "👨‍🔧" },
  { name: "My Company Details", icon: "🏢" },
];

const reportSubItems: MenuItem[] = [
  { name: "Stock Report", icon: "📊" },
  { name: "Sales Report", icon: "📈" },
  { name: "Purchase Report", icon: "📉" },
  { name: "Expense Report", icon: "💳" },
  { name: "Net Profit Report", icon: "💵" },
  { name: "Worker Salary", icon: "👷" },
  { name: "Item Wise Qty In Out Report", icon: "🔄" },
];

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  // Migration abhi nahi chali hai to sabko "run the SQL" wala screen dikhao,
  // warna sab users "No Role" se block ho jayenge.
  const [migrationPending, setMigrationPending] = useState(false);
  // SIGNED_IN event par true hota hai; role load hone ke baad ek baar
  // login_events me record karke phir se false. (Refresh par record nahi.)
  const loginEventPending = useRef(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [activeMenu, setActiveMenu] = useState("Dashboard");
  const [mastersOpen, setMastersOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 700);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);

  const [dash, setDash] = useState({
    totalSales: 0,
    totalPurchases: 0,
    totalExpenses: 0,
    netProfit: 0,
    personal: 0,
    saving: 0,
    stockValue: 0,
    totalCustomers: 0,
    totalJobCards: 0,
    completedRepairs: 0,
    warrantyQty: 0,
    rejectQty: 0,
    pendingReceivables: 0,
    pendingPayables: 0,
    totalOutstanding: 0,
    recentInvoices: [] as any[],
    recentPurchases: [] as any[],
    lowStockItems: [] as any[],
    topCustomersBySale: [] as any[],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (mounted) {
        setSession(currentSession);
        setAuthLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Tab wapas aane par (ya har ~1 hour) Supabase token refresh karta hai.
      // Uska session object naya hota hai par user wahi — agar setSession kar
      // diya to role effect dobara chal kar poori app ko loading screen se
      // unmount karta tha (naam: "Loading your access role...") aur form ki
      // unsaved entries bhi kharab ho jati thin. Isliye in events par session
      // state mat badlo. Token client andar khud update kar leta hai.
      if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") {
        setSession(nextSession);
      }
      if (event === "SIGNED_IN") loginEventPending.current = true;
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Role profile load: session ke hisaab se app_users me dhoondho.
  // Table khaali hai to pehla login user Admin ban jaata hai (bootstrap).
  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (!session) {
        if (!cancelled) {
          setAppUser(null);
          setRoleLoading(false);
        }
        loginEventPending.current = false;
        return;
      }
      const uid = session.user.id;
      const email = String(session.user.email || "").toLowerCase();

      // Same user ke liye session dobara set hua (tab wapas aana / token
      // event) to role ka full load mat karo — warna "Loading your access
      // role..." screen poori app ko unmount kar deti thi aur bina save ki
      // entries kharab ho jati thin. Sirf naya login ya user change par load.
      if (appUser && appUser.auth_user_id === uid) {
        if (loginEventPending.current) {
          loginEventPending.current = false;
          supabase
            .from("login_events")
            .insert({
              auth_user_id: uid,
              email,
              full_name: appUser.full_name || "",
              role: appUser.role,
              user_agent: navigator.userAgent,
            })
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) console.warn("login_events insert fail:", error.message);
            });
        }
        return;
      }

      setRoleLoading(true);
      try {
        const { data: rows, error } = await sc("app_users")
          .select("*")
          .or(`auth_user_id.eq.${uid},email.eq.${email}`);
        if (error) throw error;
        setMigrationPending(false);

        let profile: AppUser | null = ((rows || []) as AppUser[])[0] || null;

        if (!profile) {
          // Table khaali hai? Bootstrap: pehla login user = Admin.
          const { count } = await sc("app_users").select("id", { count: "exact", head: true });
          if (count === 0) {
            const boot: AppUser = {
              id: 0,
              auth_user_id: uid,
              email,
              full_name: String((session.user.user_metadata as any)?.full_name || session.user.email || "Admin"),
              role: "admin",
              technician_id: null,
              active: true,
            };
            const { data: inserted, error: insertErr } = await sc("app_users")
              .insert({ auth_user_id: uid, email, full_name: boot.full_name, role: "admin" })
              .select("*")
              .single();
            if (!insertErr && inserted) profile = inserted as AppUser;
            else {
              // Insert fail = lockout ka risk. Session ke liye admin maano, error log karo.
              console.error("Admin bootstrap insert fail:", insertErr?.message);
              profile = boot;
            }
          }
        } else if (!profile.auth_user_id) {
          // Profile email se mili par auth uid link nahi — abhi link karo.
          const { error: claimErr } = await supabase.rpc("claim_app_user");
          if (claimErr) console.warn("claim_app_user fail:", claimErr.message);
          profile = { ...profile, auth_user_id: uid };
        }

        if (cancelled) return;

        if (!profile) {
          setAppUser(null);
        } else {
          setAppUser(profile);
          if (loginEventPending.current) {
            loginEventPending.current = false;
            const { error: logErr } = await supabase.from("login_events").insert({
              auth_user_id: uid,
              email,
              full_name: profile.full_name || "",
              role: profile.role,
              user_agent: navigator.userAgent,
            });
            if (logErr) console.warn("login_events insert fail:", logErr.message);
          }
        }
      } catch (error: any) {
        console.error("Role profile load fail:", error);
        const code = String(error?.code || "");
        const msg = String(error?.message || "");
        if (
          code === "42P01" ||
          code === "PGRST205" ||
          /does not exist|schema cache/i.test(msg)
        ) {
          setMigrationPending(true);
        }
        if (!cancelled) setAppUser(null);
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [session, appUser]);

  // Payment allocations ka ek-time backfill: purane vouchers ki bill-wise
  // lines `particulars` text se nikal kar `payment_allocations` table me daal
  // do. Sirf admin ke session me, ek baar (sessionStorage guard). Migration SQL
  // abhi nahi chali to chup-chaap skip — screens waise bhi text fallback par
  // chalti hain. Backfill ke baad koi figure nahi badalta (rows wahi purane
  // algorithm se bante hain).
  useEffect(() => {
    if (roleLoading || !appUser || appUser.role !== "admin") return;
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem("m5_alloc_backfill_v1")) return;
    sessionStorage.setItem("m5_alloc_backfill_v1", "1");
    backfillPaymentAllocations()
      .then((n) => {
        if (n > 0) console.log(`payment_allocations backfill: ${n} lines inserted`);
      })
      .catch((err) => {
        sessionStorage.removeItem("m5_alloc_backfill_v1");
        console.warn(
          "payment_allocations backfill skip (migration SQL pending?):",
          err?.message || err
        );
      });
  }, [roleLoading, appUser]);

  // Role/permission ke hisaab se activeMenu ko allowed menu par wapas lao
  // (jaise Dashboard ke quick action se koi restricted page khul jaye).
  useEffect(() => {
    if (roleLoading || !appUser) return;
    if (!canOpen(appUser.role, activeMenu)) {
      setActiveMenu(allowedMenus(appUser.role)[0] || "Dashboard");
    }
  }, [roleLoading, appUser, activeMenu]);

  useEffect(() => {
    if (session) fetchDashboardStats();
  }, [session]);

  const loadCompanies = async () => {
    try {
      setCompaniesLoading(true);
      const list = await fetchCompanies();
      setCompanies(list);

      const savedId = getCompanyId();
      const match = list.find((c) => c.id === savedId) || list[0] || null;
      if (match) {
        setCompanyId(match.id);
        setCurrentCompany(match);
      }
    } catch (error) {
      console.error("Error loading companies:", error);
    } finally {
      setCompaniesLoading(false);
    }
  };

  useEffect(() => {
    if (session && companiesLoading && companies.length === 0) {
      loadCompanies();
    }
  }, [session]);

  const switchCompany = (company: Company) => {
    setCompanyId(company.id);
    setCurrentCompany(company);
    setSwitcherOpen(false);
    selectMenu("Dashboard");
    fetchDashboardStats();
  };

  const fmt = (v: number) => `₹ ${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);

      const [jobsRes, invoicesRes, purchasesRes, bankRes, customersRes, itemsRes, invoiceItemsRes] = await Promise.all([
        sc("job_cards").select("*"),
        sc("invoices").select("id, invoice_no, invoice_date, total_amount, customer_id"),
        sc("purchases").select("id, inward_no, item_name, quantity, rate, total_amount, vendor_name, created_at"),
        sc("bank_transactions").select("*"),
        sc("customers").select("id, customer_name, business_name"),
        sc("items").select("id, item_code, item_name, opening_stock, purchase_price, cost_price, min_stock"),
        sc("invoice_items").select("*"),
      ]);

      const jobCards = jobsRes.data || [];
      const invoices = invoicesRes.data || [];
      const purchases = purchasesRes.data || [];
      // Bounced/returned payment asli paisa nahi hai — expenses, receipts aur
      // outstanding ki har calculation se bahar.
      const bankRows = (bankRes.data || []).filter((r: any) => !r.bounced_at);
      const customerRows = customersRes.data || [];
      const allItems = itemsRes.data || [];
      const invoiceItems = invoiceItemsRes.data || [];

      const customerById = new Map<number, string>(
        customerRows.map((c: any) => [Number(c.id), c.business_name || c.customer_name || ""])
      );

      const totalSales = invoices.reduce((s, i) => s + (Number(i.total_amount) || 0), 0);
      const totalPurchases = purchases.reduce((s, p) => {
        const qty = Number(p.quantity || 0);
        const rate = Number(p.rate || 0);
        return s + (Number(p.total_amount) || qty * rate || 0);
      }, 0);

      const totalExpenses = bankRows.reduce((s, r) => {
        // Apne hi account ka transfer (Cash Box -> Bank) expense nahi hai.
        if (isTransferRow(r)) return s;
        const type = String(r.transaction_type || r.type || "").toLowerCase();
        const particulars = String(r.particulars || "").toLowerCase();
        const out = Number(r.payment_out || r.debit_amount || r.amount) || 0;
        const isReceipt = type.includes("customer receipt") || particulars.includes("customer receipt");
        const isPersonal = type.includes("owner drawing") || type.includes("personal") || particulars.includes("personal");
        const isCapital = type.includes("capital") || type.includes("deposit");
        const isVendor = type.includes("vendor payment") || type.includes("purchase payment") || particulars.includes("inw-");
        if (!isReceipt && !isPersonal && !isCapital && !isVendor && out > 0) return s + out;
        return s;
      }, 0);

      const profitTotalsRow = profitTotals(computeProfitMonthly({
        invoices,
        lines: invoiceItems,
        purchases,
        items: allItems,
        bankRows,
        jobs: jobCards,
        startYear: currentFY().startYear,
      }));
      const netProfit = profitTotalsRow.netProfit;
      const personal = profitTotalsRow.personal;
      const saving = profitTotalsRow.saving;

      // Customer Outstanding = Invoice total - receipts - discounts (deduction)
      // Allocation ka source `payment_allocations` table hai (buildAllocations
      // table-first hai); rows abhi bani nahi to wahi purana text-parse chalega.
      await loadDbAllocations(true);
      const receiptRows = bankRows.filter((r: any) => {
        const type = String(r.transaction_type || r.type || "").toLowerCase();
        const particulars = String(r.particulars || "").toLowerCase();
        return type.includes("customer receipt") || particulars.includes("customer receipt");
      });
      const invoiceBillsForAlloc: AllocBill[] = (invoices || []).map((invoice: any) => ({
        id: Number(invoice.id),
        ref: String(invoice.invoice_no || ""),
        date: String(invoice.invoice_date || ""),
        total: Number(invoice.total_amount || 0),
      }));
      const allocById = buildAllocations(invoiceBillsForAlloc, receiptRows);
      const receiptAllocations = new Map<string, { received: number; deduction: number }>();
      invoiceBillsForAlloc.forEach((b) => {
        const alloc = allocById.get(b.id);
        if (alloc && (alloc.paid > 0 || alloc.deduction > 0)) {
          receiptAllocations.set(b.ref, { received: alloc.paid, deduction: alloc.deduction });
        }
      });

      const totalOutstanding = (invoices || []).reduce((s, i: any) => {
        const alloc = receiptAllocations.get(String(i.invoice_no || "")) || { received: 0, deduction: 0 };
        return s + Math.max(0, Number(i.total_amount || 0) - alloc.received - alloc.deduction);
      }, 0);

      const pendingPayables = purchases.reduce((s, p) => {
        const status = String((p as any).payment_status || "").toLowerCase();
        if (status === "pending" || status === "unpaid") return s + (Number(p.total_amount) || Number(p.quantity || 0) * Number(p.rate || 0) || 0);
        return s;
      }, 0);

      const totalJobCards = jobCards.length;
      const completedRepairs = jobCards.filter((j) => ["closed", "completed"].includes(String(j.status || "").toLowerCase())).length;
      const warrantyQty = jobCards.reduce((s, j) => s + (Number(j.warranty_quantity) || 0), 0);
      const rejectQty = jobCards.reduce((s, j) => s + (Number(j.reject_quantity) || 0), 0);

      const inwardMap: Record<string, { qty: number; rate: number }> = {};
      const outwardByItem: Record<number, number> = {};
      const inwardKey = (inw: string, id: number) => `${inw.toLowerCase()}|${id}`;

      purchases.forEach((p: any) => {
        const item = allItems.find((it) =>
          (p.item_code && it.item_code && String(p.item_code).toLowerCase() === String(it.item_code).toLowerCase()) ||
          (p.item_name && it.item_name && String(p.item_name).toLowerCase() === String(it.item_name).toLowerCase())
        );
        const inw = String(p.inward_no || "").trim();
        if (item && inw) {
          const key = inwardKey(inw, item.id);
          inwardMap[key] = { qty: (inwardMap[key]?.qty || 0) + Number(p.quantity || 0), rate: Number(p.rate || 0) > 0 ? Number(p.rate || 0) : (inwardMap[key]?.rate || 0) };
        }
      });

      invoiceItems.forEach((inv: any) => {
        const item = allItems.find((it) =>
          (inv.item_code && it.item_code && String(inv.item_code).toLowerCase() === String(it.item_code).toLowerCase()) ||
          (inv.item_name && it.item_name && String(inv.item_name).toLowerCase() === String(it.item_name).toLowerCase())
        );
        if (item) outwardByItem[item.id] = (outwardByItem[item.id] || 0) + Number(inv.quantity || 0);
      });

      // Stock value = baaki inward batches ki value + baaki opening stock ki value.
      // Pehle yahan har inward ka poora qty x rate add hota tha, isliye beche gaye
      // stock ke baad bhi value poora dikhta tha (189129 vs 6876.31).
      // Ab wahi shared logic use ho raha hai jo Stock Report page chalata hai.
      const stockValue = computeStockValue({ items: allItems, purchases, lines: invoiceItems, jobs: jobCards });

      const lowStockItems = allItems.filter((it) => {
        const opening = Number(it.opening_stock || 0);
        const inTotal = Object.entries(inwardMap).filter(([k]) => k.endsWith(`|${it.id}`)).reduce((s, [, e]) => s + e.qty, 0);
        const cur = opening + inTotal - (outwardByItem[it.id] || 0);
        return cur > 0 && cur <= Number(it.min_stock || 5);
      }).slice(0, 5);

      const sortedInvoices = [...invoices].sort((a, b) => {
        const da = String((a as any).invoice_date || "").slice(0, 10);
        const db = String((b as any).invoice_date || "").slice(0, 10);
        return db.localeCompare(da);
      }).slice(0, 5);
      const recentInvoices = sortedInvoices.map((inv: any) => ({
        ...inv,
        customer_name: customerById.get(Number(inv.customer_id)) || "—",
      }));

      const sortedPurchases = [...purchases].sort((a, b) => {
        const da = String(a.created_at || "").slice(0, 10);
        const db = String(b.created_at || "").slice(0, 10);
        return db.localeCompare(da);
      }).slice(0, 5);

      const customerSaleMap = new Map<number, { name: string; total: number; invoiceCount: number }>();
      invoices.forEach((inv: any) => {
        const cid = Number(inv.customer_id || 0);
        if (!cid) return;
        const amt = Number(inv.total_amount || 0);
        const existing = customerSaleMap.get(cid) || { name: customerById.get(cid) || "Unknown", total: 0, invoiceCount: 0 };
        customerSaleMap.set(cid, { name: existing.name, total: existing.total + amt, invoiceCount: existing.invoiceCount + 1 });
      });
      const topCustomersBySale = [...customerSaleMap.entries()]
        .map(([id, v]) => ({ id, name: v.name, total: v.total, invoiceCount: v.invoiceCount }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      setDash({
        totalSales,
        totalPurchases,
        totalExpenses,
        netProfit,
        personal,
        saving,
        stockValue,
        totalCustomers: customersRes.count || (customersRes.data || []).length,
        totalJobCards,
        completedRepairs,
        warrantyQty,
        rejectQty,
        pendingReceivables: totalOutstanding,
        totalOutstanding,
        pendingPayables,
        recentInvoices,
        recentPurchases: sortedPurchases,
        lowStockItems,
        topCustomersBySale,
      });
    } catch (error) {
      console.error("Error fetching live stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const isMasterActive = masterSubItems.some((item) => item.name === activeMenu);
  const isReportActive = reportSubItems.some((item) => item.name === activeMenu);

  // Role ke hisaab se dikhne wale menus.
  const roleMenus = allowedMenus(appUser?.role);
  const visibleMasters = masterSubItems.filter((item) => roleMenus.includes(item.name));
  const visibleReports = reportSubItems.filter((item) => roleMenus.includes(item.name));

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Logout error:", error);
  };

  const selectMenu = (menuName: string) => {
    // Role allow nahi karta to menu switch hi mat karo.
    if (appUser && !canOpen(appUser.role, menuName)) return;
    setActiveMenu(menuName);
    if (window.innerWidth <= 700) setSidebarCollapsed(true);
  };

  const renderContent = () => {
    // Role ke allow kiye menus ke bahar kuch bhi render mat karo.
    if (appUser && !canOpen(appUser.role, activeMenu)) {
      return (
        <div className="page-title">
          <div>
            <h1>Access Denied</h1>
            <p>Aapke role ({roleLabel(appUser.role)}) ke liye ye page allowed nahi hai.</p>
          </div>
        </div>
      );
    }

    // 1. Dashboard
    if (activeMenu === "Dashboard") {
      const d = dash;
      return (
        <>
          <div className="page-title">
            <div>
              <h1>Dashboard</h1>
              <p>Maruti Module Service - Business Overview</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary-button" onClick={fetchDashboardStats}>Refresh</button>
              <button className="primary-button" onClick={() => selectMenu("Module Repair")}>+ New Job Card</button>
            </div>
          </div>

          {/* ROW 1 - Core Financial KPIs */}
          <div className="dash-kpi-row">
            <div className="dash-kpi-card dash-kpi-green">
              <div className="dash-kpi-top"><span>Total Sales</span><div className="dash-kpi-icon green">📈</div></div>
              <strong>{loading ? "..." : fmt(d.totalSales)}</strong>
              <small>All invoices</small>
            </div>
            <div className="dash-kpi-card dash-kpi-blue">
              <div className="dash-kpi-top"><span>Total Purchases</span><div className="dash-kpi-icon blue">📦</div></div>
              <strong>{loading ? "..." : fmt(d.totalPurchases)}</strong>
              <small>All inward stock</small>
            </div>
            <div className="dash-kpi-card dash-kpi-amber">
              <div className="dash-kpi-top"><span>Net Profit</span><div className="dash-kpi-icon amber">💰</div></div>
              <strong style={{ color: d.netProfit >= 0 ? "#16a34a" : "#dc2626" }}>{loading ? "..." : fmt(d.netProfit)}</strong>
              <small>From Net Profit Report (current FY)</small>
            </div>
            <div className="dash-kpi-card dash-kpi-teal">
              <div className="dash-kpi-top"><span>Stock Value</span><div className="dash-kpi-icon teal">📋</div></div>
              <strong>{loading ? "..." : fmt(d.stockValue)}</strong>
              <small>Current asset value</small>
            </div>
            <div className="dash-kpi-card" style={{ background: "#fff7ed", borderColor: "#fed7aa" }}>
              <div className="dash-kpi-top"><span>Total Outstanding</span><div className="dash-kpi-icon rose">₹</div></div>
              <strong style={{ color: "#dc2626" }}>{loading ? "..." : fmt(d.totalOutstanding)}</strong>
              <small>Customer pending amount</small>
            </div>
          </div>

          {/* ROW 2 - Operational KPIs */}
          <div className="dash-kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="dash-kpi-card-sm">
              <div className="dash-kpi-icon-sm indigo">💳</div>
              <div><span>Expenses</span><strong>{loading ? "..." : fmt(d.totalExpenses)}</strong></div>
            </div>
            <div className="dash-kpi-card-sm">
              <div className="dash-kpi-icon-sm purple">👤</div>
              <div><span>Owner Drawings / Personal</span><strong>{loading ? "..." : fmt(d.personal)}</strong></div>
            </div>
            <div className="dash-kpi-card-sm">
              <div className="dash-kpi-icon-sm green">🏦</div>
              <div><span>Saving</span><strong>{loading ? "..." : fmt(d.saving)}</strong></div>
            </div>
          </div>

          {/* ROW 3 - Outstanding + Financial Summary */}
          <div className="dash-grid-2">
            <div className="panel">
              <div className="panel-header">
                <div><h2>Outstanding Balances</h2><p>Receivables & Payables</p></div>
              </div>
              <div className="dash-outstanding">
                <div className="dash-outstand-item">
                  <div className="dash-outstand-header">
                    <span className="dash-badge green">Receivable</span>
                    <span className="dash-outstand-label">Pending from Customers</span>
                  </div>
                  <strong className="text-green">{loading ? "..." : fmt(d.pendingReceivables)}</strong>
                </div>
                <div className="dash-outstand-divider"></div>
                <div className="dash-outstand-item">
                  <div className="dash-outstand-header">
                    <span className="dash-badge red">Payable</span>
                    <span className="dash-outstand-label">Pending to Vendors</span>
                  </div>
                  <strong className="text-red">{loading ? "..." : fmt(d.pendingPayables)}</strong>
                </div>
              </div>
              <div className="dash-profit-bar">
                <div className="dash-profit-label">
                  <span>Profit Margin</span>
                  <strong style={{ color: d.totalSales > 0 && d.netProfit >= 0 ? "#16a34a" : "#dc2626" }}>
                    {d.totalSales > 0 ? ((d.netProfit / d.totalSales) * 100).toFixed(1) : "0.0"}%
                  </strong>
                </div>
                <div className="dash-bar-track">
                  <div className="dash-bar-fill" style={{ width: `${Math.min(100, Math.max(0, d.totalSales > 0 ? (d.netProfit / d.totalSales) * 100 : 0))}%`, background: d.netProfit >= 0 ? "#16a34a" : "#dc2626" }}></div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div><h2>Quick Actions</h2><p>Frequently used</p></div>
              </div>
              <div className="dash-quick-grid">
                <button onClick={() => selectMenu("Module Repair")}><span>🔧</span><div><strong>New Job Card</strong><small>Module repair</small></div></button>
                <button onClick={() => selectMenu("Sales / Invoice")}><span>🧾</span><div><strong>Create Invoice</strong><small>Sell spare parts</small></div></button>
                <button onClick={() => selectMenu("Purchase")}><span>📦</span><div><strong>New Purchase</strong><small>Stock inward</small></div></button>
                <button onClick={() => selectMenu("Bank Passbook & Expenses")}><span>💰</span><div><strong>Bank / Expense</strong><small>Record payment</small></div></button>
                <button onClick={() => selectMenu("Customers")}><span>👥</span><div><strong>Customers</strong><small>Manage list</small></div></button>
                <button onClick={() => selectMenu("Payments / Ledger")}><span>₹</span><div><strong>Payments</strong><small>Ledger view</small></div></button>
                <button onClick={() => selectMenu("Stock Report")}><span>📊</span><div><strong>Stock Report</strong><small>Live inventory</small></div></button>
                <button onClick={() => selectMenu("Net Profit Report")}><span>💵</span><div><strong>Profit Report</strong><small>P&L statement</small></div></button>
              </div>
            </div>
          </div>

          {/* ROW 4 - Recent Invoices + Recent Purchases */}
          <div className="dash-grid-2">
            <div className="panel">
              <div className="panel-header">
                <div><h2>Recent Invoices</h2><p>Last 5 sales</p></div>
                <button className="link-button" onClick={() => selectMenu("Sales Report")}>View All →</button>
              </div>
              {d.recentInvoices.length === 0 ? (
                <div className="empty-state"><div>🧾</div><h3>No invoices yet</h3><p>Create your first invoice to see it here.</p></div>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                    <tbody>
                      {d.recentInvoices.map((inv: any, i: number) => (
                        <tr key={i}>
                          <td><strong>{inv.invoice_no || `INV-${inv.id}`}</strong></td>
                          <td>{fmtDate(inv.invoice_date)}</td>
                          <td>{inv.customer_name || "-"}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#16a34a" }}>{fmt(Number(inv.total_amount) || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <div><h2>Recent Purchases</h2><p>Last 5 inward entries</p></div>
                <button className="link-button" onClick={() => selectMenu("Purchase Report")}>View All →</button>
              </div>
              {d.recentPurchases.length === 0 ? (
                <div className="empty-state"><div>📦</div><h3>No purchases yet</h3><p>Record your first purchase to see it here.</p></div>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead><tr><th>Inward No</th><th>Item</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                    <tbody>
                      {d.recentPurchases.map((p: any, i: number) => (
                        <tr key={i}>
                          <td><strong>{p.inward_no || "-"}</strong></td>
                          <td>{p.item_name || "-"}</td>
                          <td style={{ textAlign: "right" }}>{Number(p.quantity || 0)}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#2563eb" }}>{fmt(Number(p.total_amount) || Number(p.quantity || 0) * Number(p.rate || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ROW 4B - Top 10 Customers By Sale */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">
              <div><h2>🏆 Top 10 Customers By Sale</h2><p>Highest billing customers this period</p></div>
              <button className="link-button" onClick={() => selectMenu("Customers")}>View All →</button>
            </div>
            {d.topCustomersBySale.length === 0 ? (
              <div className="empty-state"><div>👥</div><h3>No sale data yet</h3><p>Create invoices to see your top customers here.</p></div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Customer Name</th>
                      <th style={{ textAlign: "center" }}>Invoices</th>
                      <th style={{ textAlign: "right" }}>Total Sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topCustomersBySale.map((c: any, i: number) => (
                      <tr key={c.id}>
                        <td><span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: 8, fontSize: 12, fontWeight: 800,
                          background: i === 0 ? "#fef3c7" : i === 1 ? "#e2e8f0" : i === 2 ? "#ffedd5" : "#f8fafc",
                          color: i === 0 ? "#92400e" : i === 1 ? "#475569" : i === 2 ? "#9a3412" : "#64748b",
                        }}>{i + 1}</span></td>
                        <td><strong style={{ color: "#0f172a", fontSize: 14 }}>{c.name}</strong></td>
                        <td style={{ textAlign: "center", color: "#64748b", fontSize: 13 }}>{c.invoiceCount} {c.invoiceCount === 1 ? "bill" : "bills"}</td>
                        <td style={{ textAlign: "right", fontWeight: 800, fontSize: 15, color: "#16a34a" }}>{fmt(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ROW 5 - Low Stock Alert */}
          {d.lowStockItems.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div><h2>Low Stock Alert</h2><p>Items below minimum stock level</p></div>
                <button className="link-button" onClick={() => selectMenu("Stock Report")}>View Stock →</button>
              </div>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Item</th><th style={{ textAlign: "right" }}>Current Stock</th><th style={{ textAlign: "right" }}>Min Level</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.lowStockItems.map((it: any, i: number) => (
                      <tr key={i}>
                        <td><strong>{it.item_name}</strong></td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{Number(it.opening_stock || 0)}</td>
                        <td style={{ textAlign: "right" }}>{Number(it.min_stock || 5)}</td>
                        <td><span className="dash-badge red">Low</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      );
    }

    // 2. Operational Pages
    if (activeMenu === "Customers") return <Customers />;
    if (activeMenu === "Module Repair")
      return (
        <JobCards
          technicianScopeId={
            appUser && appUser.role === "technician" ? appUser.technician_id : undefined
          }
        />
      );
    if (activeMenu === "Sales / Invoice") return <Invoices />;
    if (activeMenu === "Purchase") return <Purchase />;
    if (activeMenu === "Payments / Ledger") return <PaymentsLedger />;
    if (activeMenu === "Bank Passbook & Expenses") return <BankPassbook />;
    if (activeMenu === "Warranty") return <Warranty />;
    if (activeMenu === "Print Center") return <PrintCenter />;
    if (activeMenu === "Label Print") return <LabelPrint />;

    // 3. Master Records
    if (activeMenu === "Item Master") return <ItemMaster />;
    if (activeMenu === "Customer Wise Price") return <CustomerWisePrice />;
    if (activeMenu === "Vendor Master") return <Vendors />;
    if (activeMenu === "Technician Master") return <TechnicianMaster />;
    if (activeMenu === "My Company Details") return <MyCompanyDetails />;

    // 4. Reports
    if (activeMenu === "Stock Report") return <Stock />;
    if (activeMenu === "Sales Report") return <SalesReport />;
    if (activeMenu === "Purchase Report") return <PurchaseReport />;
    if (activeMenu === "Expense Report") return <ExpenseReport />;
    if (activeMenu === "Net Profit Report") return <NetProfitReport />;
  if (activeMenu === "Worker Salary") return <SalaryReport />;
    if (activeMenu === "Item Wise Qty In Out Report") return <ItemWiseQtyInOutReport />;

    // 5. Users & Roles (admin only)
    if (activeMenu === "Users & Roles") return <UsersRoles currentUid={session?.user.id || ""} />;

    // 6. Activity Log (Admin + Auditor)
    if (activeMenu === "Activity Log") return <ActivityLog />;

    return (
      <div className="page-title">
        <div>
          <h1>{activeMenu}</h1>
          <p>{activeMenu} module is active and ready.</p>
        </div>
      </div>
    );
  };

  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        Checking login session...
      </div>
    );
  }

  if (!session) return <Login />;

  if (recoveryMode) {
    return <PasswordRecovery onComplete={() => setRecoveryMode(false)} />;
  }

  if (roleLoading) {
    return <div className="auth-loading-screen">Loading your access role...</div>;
  }

  if (migrationPending) {
    return (
      <AccessBlocked
        title="Setup Pending"
        message="Role system ka database migration abhi chalna baaki hai. Admin ko 'supabase/user-roles-migration.sql' file Supabase SQL Editor me chalani hogi."
        onLogout={handleLogout}
      />
    );
  }

  if (!appUser) {
    return (
      <AccessBlocked
        title="No Role Assigned"
        message="Is email ke liye koi role assign nahi hua hai. Admin se 'Users & Roles' page par role assign karwaein, phir login karein."
        onLogout={handleLogout}
      />
    );
  }

  if (!appUser.active) {
    return (
      <AccessBlocked
        title="Access Disabled"
        message="Aapka access deactivate kar diya gaya hai. Admin se sampark karein."
        onLogout={handleLogout}
      />
    );
  }

  if (allowedMenus(appUser.role).length === 0) {
    return (
      <AccessBlocked
        title={appUser.role === "pending" ? "Awaiting Approval" : "No Role Assigned"}
        message={
          appUser.role === "pending"
            ? "Aapki profile ban gayi hai, par abhi tak role assign nahi hua. Admin ko 'Users & Roles' par role dena baaki hai."
            : "Abhi aapko koi menu allow nahi hua hai. Admin se role assign karwaein."
        }
        onLogout={handleLogout}
      />
    );
  }

  if (companiesLoading) {
    return <div className="auth-loading-screen">Loading companies...</div>;
  }

  if (!currentCompany) {
    return (
      <CompanyPicker
        companies={companies}
        onSelect={switchCompany}
        onCreated={(company) => {
          setCompanies((prev) => [...prev, company]);
          switchCompany(company);
        }}
      />
    );
  }

  return (
    <div className="app-layout">
      <SyncBanner />
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Open sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>
        <div className="brand">
          <div className="brand-logo">M</div>
          <div>
            <h2>MARUTI</h2>
            <span>MODULE SERVICE</span>
          </div>
        </div>

        <div className="menu-title">MAIN MENU</div>

        <nav className="navigation" ref={navigationRef}>
          {mainMenuItems
            .filter((item) => roleMenus.includes(item.name))
            .map((item) => (
            <button
              key={item.name}
              className={`menu-item ${activeMenu === item.name ? "active" : ""}`}
              onClick={() => selectMenu(item.name)}
            >
              <span className="menu-icon">{item.icon}</span>
              <span>{item.name}</span>
            </button>
          ))}

          {/* MASTER RECORDS ACCORDION */}
          {visibleMasters.length > 0 && (
          <div style={{ margin: "4px 0" }}>
            <button
              className={`menu-item ${isMasterActive ? "active" : ""}`}
              onClick={() => setMastersOpen(!mastersOpen)}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="menu-icon">🗂</span>
                <span style={{ fontWeight: 600 }}>Master Records</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  transform: mastersOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              >
                ▼
              </span>
            </button>

            {mastersOpen && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  paddingLeft: 12,
                  margin: "4px 0 6px 14px",
                  borderLeft: "2px solid rgba(255, 255, 255, 0.12)",
                  gap: 3,
                }}
              >
                {visibleMasters.map((sub) => (
                  <button
                    key={sub.name}
                    className={`menu-item ${activeMenu === sub.name ? "active" : ""}`}
                    onClick={() => selectMenu(sub.name)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      borderRadius: 6,
                    }}
                  >
                    <span className="menu-icon" style={{ fontSize: 14 }}>{sub.icon}</span>
                    <span>{sub.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* REPORTS ACCORDION */}
          {visibleReports.length > 0 && (
          <div style={{ margin: "4px 0" }}>
            <button
              className={`menu-item ${isReportActive ? "active" : ""}`}
              onClick={() => setReportsOpen(!reportsOpen)}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="menu-icon">📈</span>
                <span style={{ fontWeight: 600 }}>Reports & Analysis</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  transform: reportsOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              >
                ▼
              </span>
            </button>

            {reportsOpen && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  paddingLeft: 12,
                  margin: "4px 0 6px 14px",
                  borderLeft: "2px solid rgba(255, 255, 255, 0.12)",
                  gap: 3,
                }}
              >
                {visibleReports.map((sub) => (
                  <button
                    key={sub.name}
                    className={`menu-item ${activeMenu === sub.name ? "active" : ""}`}
                    onClick={() => selectMenu(sub.name)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      borderRadius: 6,
                    }}
                  >
                    <span className="menu-icon" style={{ fontSize: 14 }}>{sub.icon}</span>
                    <span>{sub.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
        </nav>

        <div className="sidebar-controls">
          <button
            className="sidebar-scroll-button"
            type="button"
            aria-label="Scroll sidebar menu down"
            title="Scroll menu down"
            onClick={() => navigationRef.current?.scrollTo({
              top: navigationRef.current.scrollHeight,
              behavior: "smooth",
            })}
          >
            <span aria-hidden="true">⌄</span>
            <span>Scroll down</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          {roleMenus.includes("Settings") && (
            <button
              className={`menu-item ${activeMenu === "Settings" ? "active" : ""}`}
              onClick={() => selectMenu("Settings")}
            >
              <span className="menu-icon">⚙</span>
              <span>Settings</span>
            </button>
          )}

          {roleMenus.includes("Activity Log") && (
            <button
              className={`menu-item ${activeMenu === "Activity Log" ? "active" : ""}`}
              onClick={() => selectMenu("Activity Log")}
            >
              <span className="menu-icon">🕘</span>
              <span>Activity Log</span>
            </button>
          )}

          {roleMenus.includes("Users & Roles") && (
            <button
              className={`menu-item ${activeMenu === "Users & Roles" ? "active" : ""}`}
              onClick={() => selectMenu("Users & Roles")}
            >
              <span className="menu-icon">👥</span>
              <span>Users & Roles</span>
            </button>
          )}

          <div className="user-box">
            <div className="user-avatar">{(appUser.full_name || session.user.email || "U").charAt(0).toUpperCase()}</div>
            <div>
              <strong>{roleLabel(appUser.role)}</strong>
              <span>{appUser.full_name || session.user.email || "User"}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Logout"
              style={{
                marginLeft: "auto",
                padding: "5px 8px",
                border: "1px solid #526078",
                borderRadius: 5,
                background: "transparent",
                color: "#cbd5e1",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className={`main-content ${sidebarCollapsed ? "main-content-expanded" : ""}`}>
        <header className="topbar">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={sidebarCollapsed ? "Open navigation" : "Close navigation"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? "☰" : "✕"}
          </button>
          <div className="breadcrumb">
            <span>Maruti Module Service</span>
            <span>/</span>
            {isMasterActive && <span>Master Records / </span>}
            {isReportActive && <span>Reports / </span>}
            <span>{activeMenu}</span>
          </div>

          <div className="topbar-right">
            <div className="company-switcher">
              <button
                type="button"
                className="company-switcher-button"
                onClick={() => setSwitcherOpen((open) => !open)}
                title="Switch company"
              >
                <span className="company-switcher-name">{currentCompany.name}</span>
                <span className={`company-tax-badge ${isGstCompany(currentCompany) ? "gst" : "non-gst"}`}>
                  {isGstCompany(currentCompany) ? "GST" : "Non-GST"}
                </span>
                <span aria-hidden="true">▾</span>
              </button>

              {switcherOpen && (
                <div className="company-switcher-menu">
                  {companies.map((company) => (
                    <button
                      key={company.id}
                      type="button"
                      className={`company-switcher-item ${company.id === currentCompany.id ? "active" : ""}`}
                      onClick={() => switchCompany(company)}
                    >
                      <span>{company.name}</span>
                      <small>{company.tax_mode}</small>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="company-switcher-logout"
                    onClick={async () => {
                      clearCompanyId();
                      await supabase.auth.signOut();
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>

            <button className="notification-button">🔔</button>
            <div className="date-box">
              <span>Today</span>
              <strong>{new Date().toLocaleDateString("en-IN")}</strong>
            </div>
          </div>
        </header>

        <section className="content-area">{renderContent()}</section>
      </main>
    </div>
  );
}

function CompanyPicker({
  companies,
  onSelect,
  onCreated,
}: {
  companies: Company[];
  onSelect: (company: Company) => void;
  onCreated: (company: Company) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [taxMode, setTaxMode] = useState("Regular GST");
  const [gstin, setGstin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Company name required hai.");
      return;
    }
    if (taxMode === "Regular GST" && gstin.trim().length !== 15) {
      setError("GST company ke liye GSTIN 15 characters ka hona chahiye.");
      return;
    }

    setSaving(true);
    const isGst = taxMode !== "Non-GST";
    const prefix = isGst ? "GSTINV/" : "INV/";

    const { data, error: insertError } = await supabase
      .from("companies")
      .insert({
        name: trimmed,
        tax_mode: taxMode,
        gstin: gstin.trim(),
        active: true,
        invoice_prefix: prefix,
        financial_year_start: "04-01",
      })
      .select()
      .single();

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setName("");
    setGstin("");
    onCreated(data as Company);
  };

  return (
    <div style={companyPickerWrap}>
      <div style={companyPickerCard}>
        <div style={companyPickerLogo}>M</div>
        <h1 style={companyPickerTitle}>Select Company</h1>
        <p style={companyPickerSub}>Apni company choose karein. Har company ka data alag rahega.</p>

        <div style={companyListWrap}>
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              style={companyListButton}
              onClick={() => onSelect(company)}
            >
              <div style={companyListLeft}>
                <strong>{company.name}</strong>
                <small>
                  {company.tax_mode}
                  {company.gstin ? ` • ${company.gstin}` : ""}
                </small>
              </div>
              <span style={invoicePrefixFor(company) === "GSTINV/" ? taxBadgeGst : taxBadgeNonGst}>
                {invoicePrefixFor(company)}
              </span>
            </button>
          ))}

          {companies.length === 0 && (
            <p style={{ color: "#64748b", fontSize: 13 }}>Koi company nahi mili. Neeche se banayein.</p>
          )}
        </div>

        {!showAdd ? (
          <button type="button" style={addCompanyButton} onClick={() => setShowAdd(true)}>
            + New Company
          </button>
        ) : (
          <form onSubmit={handleCreate} style={{ marginTop: 18, textAlign: "left" }}>
            <label style={fieldLabel}>Company Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maruti Module Service - GST"
              style={fieldInput}
            />

            <label style={fieldLabel}>Tax Mode</label>
            <select value={taxMode} onChange={(e) => setTaxMode(e.target.value)} style={fieldInput}>
              <option value="Regular GST">Regular GST</option>
              <option value="Non-GST">Non-GST</option>
            </select>

            {taxMode !== "Non-GST" && (
              <>
                <label style={fieldLabel}>GSTIN (15 characters)</label>
                <input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="22AAAAA0000A1Z5"
                  maxLength={15}
                  style={fieldInput}
                />
              </>
            )}

            {error && <p style={authErrorStyle}>{error}</p>}

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" style={{ ...addCompanyButton, marginTop: 0, background: "#64748b" }} onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ ...addCompanyButton, marginTop: 0, background: saving ? "#94a3b8" : "#0B5ED7" }}>
                {saving ? "Creating..." : "Create Company"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const companyPickerWrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f5f7fb",
  padding: 20,
  boxSizing: "border-box",
};

const companyPickerCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 440,
  background: "#fff",
  padding: 30,
  borderRadius: 14,
  boxShadow: "0 0 24px rgba(15,23,42,0.10)",
  boxSizing: "border-box",
};

const companyPickerLogo: React.CSSProperties = {
  width: 60,
  height: 60,
  margin: "0 auto 14px",
  borderRadius: 16,
  background: "linear-gradient(145deg, #f97316, #c2410c)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 32,
  fontWeight: 900,
};

const companyPickerTitle: React.CSSProperties = {
  margin: 0,
  textAlign: "center",
  color: "#0f172a",
  fontSize: 22,
};

const companyPickerSub: React.CSSProperties = {
  margin: "8px 0 20px",
  textAlign: "center",
  color: "#64748b",
  fontSize: 13,
};

const companyListWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const companyListButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  background: "#f8fafc",
  cursor: "pointer",
  textAlign: "left",
};

const companyListLeft: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

const taxBadgeGst: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
  fontSize: 11,
  fontWeight: 700,
};

const taxBadgeNonGst: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 999,
  background: "#e2e8f0",
  color: "#475569",
  fontSize: 11,
  fontWeight: 700,
};

const addCompanyButton: React.CSSProperties = {
  width: "100%",
  marginTop: 18,
  padding: 12,
  background: "#0B5ED7",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 700,
  cursor: "pointer",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
  margin: "12px 0 5px",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  boxSizing: "border-box",
  fontSize: 14,
};

function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");

    if (password.length < 6) {
      setErrorMessage("Password कम से कम 6 characters का होना चाहिए।");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("New password और confirm password match नहीं कर रहे हैं।");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMessage(error.message);
      setSaving(false);
      return;
    }

    setMessage("Password successfully update हो गया। Login page पर जा रहे हैं...");
    await supabase.auth.signOut();
    setSaving(false);
    setTimeout(onComplete, 800);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f7fb",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#fff",
          padding: 30,
          borderRadius: 12,
          boxShadow: "0 0 20px rgba(0,0,0,0.1)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 14px",
              borderRadius: 16,
              background: "linear-gradient(145deg, #f97316, #c2410c)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 36,
              fontWeight: 900,
            }}
          >
            M
          </div>
          <h1 style={{ margin: 0, color: "#0f172a", fontSize: 23 }}>Set New Password</h1>
          <p style={{ color: "#64748b", fontSize: 13, margin: "7px 0 0" }}>
            Apna naya password enter karein.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <PasswordField
            label="New Password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggle={() => setShowPassword((visible) => !visible)}
          />
          <PasswordField
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirmPassword}
            onToggle={() => setShowConfirmPassword((visible) => !visible)}
          />

          {errorMessage && <p style={authErrorStyle}>{errorMessage}</p>}
          {message && <p style={authSuccessStyle}>{message}</p>}

          <button
            type="submit"
            disabled={saving}
            style={{
              width: "100%",
              padding: 12,
              background: saving ? "#94a3b8" : "#0B5ED7",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", color: "#334155", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={visible ? "text" : "password"}
          required
          minLength={6}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: "100%",
            padding: "12px 44px 12px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            boxSizing: "border-box",
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          style={{
            position: "absolute",
            right: 8,
            top: 6,
            height: 32,
            border: "none",
            background: "transparent",
            color: "#64748b",
            cursor: "pointer",
          }}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function AccessBlocked({
  title,
  message,
  onLogout,
}: {
  title: string;
  message: string;
  onLogout: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f7fb",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          background: "#fff",
          padding: 30,
          borderRadius: 14,
          boxShadow: "0 0 24px rgba(15,23,42,0.10)",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 14px",
            borderRadius: 16,
            background: "linear-gradient(145deg, #f97316, #c2410c)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 30,
            fontWeight: 900,
          }}
        >
          🔒
        </div>
        <h1 style={{ margin: 0, color: "#0f172a", fontSize: 21 }}>{title}</h1>
        <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, margin: "10px 0 20px" }}>{message}</p>
        <button
          type="button"
          onClick={onLogout}
          style={{
            width: "100%",
            padding: 12,
            background: "#0B5ED7",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}

const authErrorStyle: React.CSSProperties = {
  color: "#b91c1c",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 7,
  padding: "9px 10px",
  fontSize: 13,
};

const authSuccessStyle: React.CSSProperties = {
  color: "#166534",
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 7,
  padding: "9px 10px",
  fontSize: 13,
};

export default App;