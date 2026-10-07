import { sc } from "../lib/company";
import { useEffect, useState } from 'react';
import { LayoutDashboard, TrendingUp, ShoppingBag, DollarSign, Wallet, ArrowUpRight } from 'lucide-react';
import { computeProfitMonthly, currentYear, fyStart, profitTotals } from '../lib/profitCalc';

const Dashboard = () => {
  const [metrics, setMetrics] = useState({
    totalSales: 0,
    totalPurchases: 0,
    netProfit: 0,
    outstandingReceivables: 0,
    outstandingPayables: 0,
    totalExpenses: 0,
  });
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBusinessData();
  }, []);

  const fetchBusinessData = async () => {
    try {
      setLoading(true);

      const { data: invoices } = await sc("invoices").select('*');
      const { data: purchases } = await sc("purchases").select('*');
      const { data: expensesRaw } = await sc("bank_transactions").select('*');
      // Bounced/returned rows paisa nahi — profit aur expense se exclude.
      const expenses = expensesRaw?.filter((row: any) => !row.bounced_at) || [];
      const { data: customers } = await sc("customers").select('*').limit(5);
      const { data: invoiceLines } = await sc("invoice_items").select('*');
      const { data: jobCards } = await sc("job_cards").select('*');
      const { data: itemsData } = await sc("items").select('*');

      const salesTotal = invoices?.reduce((acc, inv) => acc + (Number(inv.total_amount) || Number(inv.amount) || 0), 0) || 0;
      const purchaseTotal = purchases?.reduce((acc, pur) => acc + (Number(pur.total_amount) || Number(pur.amount) || 0), 0) || 0;
      const expenseTotal = expenses?.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0) || 0;

      const startYear = fyStart(`${currentYear}-${String(currentYear + 1).slice(-2)}`);
      const monthly = computeProfitMonthly({
        invoices: invoices || [],
        lines: invoiceLines || [],
        purchases: purchases || [],
        items: itemsData || [],
        bankRows: expenses || [],
        jobs: jobCards || [],
        startYear,
      });
      const totals = profitTotals(monthly);

      setMetrics({
        totalSales: salesTotal,
        totalPurchases: purchaseTotal,
        netProfit: totals.netProfit,
        outstandingReceivables: 0,
        outstandingPayables: 0,
        totalExpenses: expenseTotal,
      });

      if (customers) {
        setTopCustomers(customers);
      }
    } catch (error) {
      console.error('Error fetching business metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  return (
    <div className="p-8 bg-slate-50 min-h-screen space-y-8">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-md flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-amber-400" />
            Business Analysis Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">Maruti Module Service - Financial & Operational Overview</p>
        </div>
        <button 
          onClick={fetchBusinessData}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl text-sm transition-colors shadow"
        >
          Refresh Data
        </button>
      </div>

      {/* Top 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Sales</span>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><TrendingUp className="w-5 h-5" /></div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold text-slate-900">{loading ? '...' : formatCurrency(metrics.totalSales)}</h2>
            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 mt-1"><ArrowUpRight className="w-4 h-4" /> Live from Invoices</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Purchases</span>
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><ShoppingBag className="w-5 h-5" /></div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold text-slate-900">{loading ? '...' : formatCurrency(metrics.totalPurchases)}</h2>
            <span className="text-xs text-slate-400 font-medium mt-1 block">Live from Purchase Table</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Net Profit</span>
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl"><DollarSign className="w-5 h-5" /></div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold text-slate-900">{loading ? '...' : formatCurrency(metrics.netProfit)}</h2>
            <span className="text-xs text-amber-600 font-medium mt-1 block">From Net Profit Report (current FY)</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Outstanding Receivables</span>
            <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl"><Wallet className="w-5 h-5" /></div>
          </div>
          <div className="mt-4">
            <h2 className="text-3xl font-extrabold text-slate-900">{loading ? '...' : formatCurrency(metrics.outstandingReceivables)}</h2>
            <span className="text-xs text-rose-600 font-medium mt-1 block">Pending Payments</span>
          </div>
        </div>
      </div>

      {/* Middle Grid: Charts / Analytics Placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Monthly Sales & Profit</h3>
          <p className="text-xs text-slate-500 mb-4">Performance across active months</p>
          <div className="h-64 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400">
            <TrendingUp className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm font-medium">Monthly Trend Chart Ready</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Monthly Expenses</h3>
          <p className="text-xs text-slate-500 mb-4">Expense breakdown by month</p>
          <div className="h-64 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400">
            <Wallet className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm font-medium">Expense Analysis Chart Ready</p>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Top Customers & Financial Summary Balance Proxy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers by Sales */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Top Customers by Sales</h3>
          <p className="text-xs text-slate-500 mb-4">Leading clients based on transaction volume</p>
          
          <div className="space-y-3">
            {topCustomers.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">No customer records found yet.</p>
            ) : (
              topCustomers.map((c, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="font-semibold text-slate-800 text-sm">{c.name || c.customer_name || 'Customer ' + (idx + 1)}</span>
                  <span className="text-sm font-bold text-blue-600">{formatCurrency(c.total_sales || 0)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Financial Summary (Balance Proxy) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-900 text-white px-6 py-4">
            <h3 className="text-base font-bold">Financial Summary (Balance Proxy)</h3>
            <p className="text-xs text-slate-400">Assets vs Liabilities Overview</p>
          </div>
          <div className="p-6">
            <div className="responsive-table-wrapper">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase bg-slate-50">
                  <th className="py-3 px-4">Assets / Receivables</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 border-l border-slate-200">Liabilities / Payables</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="text-sm text-slate-700">
                <tr className="border-b border-slate-100">
                  <td className="py-3.5 px-4 font-medium">Outstanding Receivables</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-rose-600">{formatCurrency(metrics.outstandingReceivables)}</td>
                  <td className="py-3.5 px-4 border-l border-slate-100 font-medium">Outstanding Payables</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-amber-600">{formatCurrency(metrics.outstandingPayables)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-3.5 px-4 font-medium">Total Sales</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-emerald-600">{formatCurrency(metrics.totalSales)}</td>
                  <td className="py-3.5 px-4 border-l border-slate-100 font-medium">Total Purchases</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-blue-600">{formatCurrency(metrics.totalPurchases)}</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-4 font-medium">Net Profit</td>
                  <td className="py-3.5 px-4 text-right font-bold text-emerald-700">{formatCurrency(metrics.netProfit)}</td>
                  <td className="py-3.5 px-4 border-l border-slate-100 font-medium">Total Expenses</td>
                  <td className="py-3.5 px-4 text-right font-semibold text-rose-600">{formatCurrency(metrics.totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;