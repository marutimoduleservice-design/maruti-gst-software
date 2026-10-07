import { sc } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import {
  buildAllocations,
  loadDbAllocations,
  type AllocBill,
} from "../lib/billAllocations";

type InvoiceItem = {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  job_no: string | null;
  job_card_id: number | null;
  invoice_type: string | null;
  customer_id: number | null;
  customer_name: string | null;
  business_name: string | null;
  total_amount: number | null;
  total_cost: number | null;
  received_amount: number | null;
  deduction_amount: number | null;
  pending_amount: number | null;
  payment_status: string | null;
};

type Customer = {
  id: number;
  customer_code: string | number | null;
  customer_name: string | null;
  business_name: string | null;
};

type ItemSalesRow = {
  id: string;
  invoice_id: number;
  invoice_no: string;
  invoice_date: string;
  customer_name: string;
  item_name: string;
  inward_no: string;
  quantity: number;
  sale_price: number;
  total_sale: number;
  purchase_price: number;
  total_cost: number;
  profit: number;
};

type ItemCostRow = {
  item_code?: string | null;
  item_name?: string | null;
  purchase_price?: number | null;
  cost_price?: number | null;
};

function SalesReport() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [itemSales, setItemSales] = useState<ItemSalesRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reportView, setReportView] = useState<"summary" | "items">("summary");
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("All");

  const loadData = async () => {
    setLoading(true);

    // 1. Fetch Customers for filter & lookup
    const { data: custData } = await sc("customers")
      .select("id, customer_code, customer_name, business_name")
      .order("business_name");

    if (custData) setCustomers(custData);

    // 2. Fetch Job Cards so Job No is derived from the actual invoice relation
    const { data: jobData, error: jobError } = await sc("job_cards")
      .select("id, job_no");
    if (jobError) console.error("Job cards load error:", jobError);
    const jobById = new Map<number, string>((jobData || []).map((job: any) => [Number(job.id), job.job_no]));

    // 3. Fetch Invoices and enrich them from their real relations
    const { data: invData, error } = await sc("invoices")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("Invoices load error:", error);
    } else {
      const customerById = new Map<number, Customer>((custData || []).map((customer: any) => [Number(customer.id), customer]));
      const purchaseRes = await sc("purchases").select("id, inward_no, purchase_no, item_name, item_code, rate, purchase_rate");
      const invoiceItemsRes = await sc("invoice_items").select("*");
      const itemsRes = await sc("items").select("item_code, item_name, purchase_price, cost_price");
      const legacyItemsRes = itemsRes.data?.length
        ? { data: [] as any[] }
        : await sc("item_master").select("item_code, item_name, purchase_price, cost_price");
      const receiptRes = await sc("bank_transactions").select(
        "id, particulars, payment_in, credit_amount, transaction_type, type, bounced_at"
      );
      const purchaseRows = purchaseRes.data || [];
      const masterCostRows = (itemsRes.data?.length ? itemsRes.data : legacyItemsRes.data || []) as ItemCostRow[];
      const receiptRows = (receiptRes.data || []).filter((row: any) =>
        // Bounced receipt customer ka payment nahi maana ja sakta.
        !row.bounced_at &&
        (String(row.transaction_type || "").toLowerCase().includes("customer receipt") ||
          String(row.particulars || "").toLowerCase().includes("customer receipt"))
      );
      // Allocation ka source `payment_allocations` table hai (buildAllocations
      // table-first). Rows abhi nahi bani to wahi purana text-parse chalega.
      await loadDbAllocations(true);
      const invoiceBillsForAlloc: AllocBill[] = (invData || []).map((invoice: any) => ({
        id: Number(invoice.id),
        ref: String(invoice.invoice_no || ""),
        date: String(invoice.invoice_date || ""),
        total: Number(invoice.total_amount || 0),
      }));
      const allocByInvoiceId = buildAllocations(invoiceBillsForAlloc, receiptRows);
      const receiptAllocations = new Map<string, { received: number; deduction: number }>();
      invoiceBillsForAlloc.forEach((b) => {
        const alloc = allocByInvoiceId.get(b.id);
        if (alloc && (alloc.paid > 0 || alloc.deduction > 0)) {
          receiptAllocations.set(b.ref, { received: alloc.paid, deduction: alloc.deduction });
        }
      });

      const findPurchase = (line: any) => purchaseRows.find((row: any) =>
        String(row.inward_no || row.purchase_no || "") === String(line.inward_no || "") &&
        String(row.item_name || "").trim().toLowerCase() === String(line.item_name || "").trim().toLowerCase()
      );
      const findItemMaster = (line: any) => masterCostRows.find((row: ItemCostRow) =>
        (line.item_code && row.item_code && String(row.item_code).trim().toLowerCase() === String(line.item_code).trim().toLowerCase()) ||
        (row.item_name && String(row.item_name).trim().toLowerCase() === String(line.item_name || "").trim().toLowerCase())
      );
      const getLineCostRate = (line: any) => {
        const purchase = findPurchase(line);
        const masterItem = findItemMaster(line);
        const candidates = [
          line.cost_rate,
          purchase?.rate,
          purchase?.purchase_rate,
          masterItem?.purchase_price,
          masterItem?.cost_price,
        ];
        const validCost = candidates
          .map((value) => Number(value))
          .find((value) => Number.isFinite(value) && value > 0);
        return validCost || 0;
      };
      const costByInvoice = new Map<number, number>();
      (invoiceItemsRes.data || []).forEach((line: any) => {
        const invoiceId = Number(line.invoice_id);
        const quantity = Number(line.quantity || 0);
        costByInvoice.set(invoiceId, (costByInvoice.get(invoiceId) || 0) + quantity * getLineCostRate(line));
      });
      const enrichedInvoices = (invData || []).map((invoice: any) => {
        const customer = customerById.get(Number(invoice.customer_id));
        const isDirectSale = invoice.invoice_type === "Direct" || !invoice.job_card_id;
        const allocation = receiptAllocations.get(String(invoice.invoice_no || "")) || {
          received: 0,
          deduction: 0,
        };
        const receivedAmount = allocation.received;
        const deductionAmount = allocation.deduction;
        const totalAmount = Number(invoice.total_amount || 0);
        return {
          ...invoice,
          total_cost: costByInvoice.get(Number(invoice.id)) || 0,
          job_no: isDirectSale ? null : (jobById.get(Number(invoice.job_card_id)) || null),
          customer_name: customer?.business_name || customer?.customer_name || invoice.customer_name || null,
          business_name: customer?.business_name || invoice.business_name || null,
          received_amount: receivedAmount,
          deduction_amount: deductionAmount,
          pending_amount: Math.max(0, totalAmount - receivedAmount - deductionAmount),
          payment_status: Math.max(0, totalAmount - receivedAmount - deductionAmount) === 0 && totalAmount > 0 ? "Paid" : receivedAmount > 0 || deductionAmount > 0 ? "Partial" : "Pending",
        };
      });
      setInvoices(enrichedInvoices as InvoiceItem[]);

      const invoiceById = new Map<number, any>(enrichedInvoices.map((invoice: any) => [Number(invoice.id), invoice]));
      const itemRows: ItemSalesRow[] = (invoiceItemsRes.data || []).map((line: any, index: number) => {
        const invoice = invoiceById.get(Number(line.invoice_id));
        const quantity = Number(line.quantity || 0);
        const salePrice = Number(line.rate || 0);
        const purchasePrice = getLineCostRate(line);
        const totalSale = Number(line.total ?? quantity * salePrice);
        const totalCost = quantity * purchasePrice;
        return {
          id: `${line.invoice_id}-${line.id || index}`,
          invoice_id: Number(line.invoice_id),
          invoice_no: invoice?.invoice_no || "-",
          invoice_date: invoice?.invoice_date || "-",
          customer_name: invoice?.business_name || invoice?.customer_name || "-",
          item_name: line.item_name || "-",
          inward_no: line.inward_no || "-",
          quantity,
          sale_price: salePrice,
          total_sale: totalSale,
          purchase_price: purchasePrice,
          total_cost: totalCost,
          profit: totalSale - totalCost,
        };
      });
      setItemSales(itemRows);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered list based on Search, Date range, and Customer
  const filteredData = useMemo(() => {
    return invoices.filter((item) => {
      const q = search.trim().toLowerCase();
      const invNo = (item.invoice_no || "").toLowerCase();
      const jobNo = (item.job_no || "DIRECT-SALE").toLowerCase();
      const custName = (item.business_name || item.customer_name || "").toLowerCase();

      const matchesSearch =
        !q || invNo.includes(q) || jobNo.includes(q) || custName.includes(q);

      const matchesCustomer =
        selectedCustomer === "All" ||
        String(item.customer_id) === selectedCustomer;

      const itemDate = item.invoice_date || "";
      const matchesFrom = !fromDate || itemDate >= fromDate;
      const matchesTo = !toDate || itemDate <= toDate;

      return matchesSearch && matchesCustomer && matchesFrom && matchesTo;
    });
  }, [invoices, search, fromDate, toDate, selectedCustomer]);

  const invCols = {
    invoice_no: (i: any) => i.invoice_no || "",
    job_no: (i: any) => i.job_no || "DIRECT-SALE",
    customer: (i: any) => i.business_name || i.customer_name || "",
    bill: (i: any) => Number(i.total_amount || 0),
    cost: (i: any) => Number(i.total_cost || 0),
    profit: (i: any) => Number(i.total_amount || 0) - Number(i.total_cost || 0),
    received: (i: any) => Number(i.received_amount || 0),
    deduction: (i: any) => Number(i.deduction_amount || 0),
    pending: (i: any) => {
      const bill = Number(i.total_amount || 0);
      return Number(i.pending_amount ?? (bill - Number(i.received_amount || 0) - Number(i.deduction_amount || 0)));
    },
  } as const;
  const { sort: invSort, sorted: sortedInvoices } = useSortedRows(filteredData, invCols, "invoice_no", "desc");

  const filteredItemSales = useMemo(() => {
    return itemSales.filter((item) => {
      const q = search.trim().toLowerCase();
      const matchesSearch = !q ||
        item.invoice_no.toLowerCase().includes(q) ||
        item.customer_name.toLowerCase().includes(q) ||
        item.item_name.toLowerCase().includes(q) ||
        item.inward_no.toLowerCase().includes(q);
      const matchesCustomer = selectedCustomer === "All" ||
        String(invoices.find((invoice) => invoice.id === item.invoice_id)?.customer_id) === selectedCustomer;
      const matchesFrom = !fromDate || item.invoice_date >= fromDate;
      const matchesTo = !toDate || item.invoice_date <= toDate;
      return matchesSearch && matchesCustomer && matchesFrom && matchesTo;
    }).sort((a, b) => {
      const aNumber = Number(a.invoice_no.match(/(\d+)$/)?.[1] || 0);
      const bNumber = Number(b.invoice_no.match(/(\d+)$/)?.[1] || 0);
      return bNumber - aNumber || b.invoice_no.localeCompare(a.invoice_no);
    });
  }, [itemSales, invoices, search, fromDate, toDate, selectedCustomer]);

  // Aggregate Totals
  const totals = useMemo(() => {
    return filteredData.reduce(
      (acc, item) => {
        const bill = Number(item.total_amount || 0);
        const cost = Number(item.total_cost || 0);
        const profit = bill - cost;
        const received = Number(item.received_amount || 0);
        const deduction = Number(item.deduction_amount || 0);
        const pending = Number(item.pending_amount ?? (bill - received - deduction));

        return {
          totalBill: acc.totalBill + bill,
          totalCost: acc.totalCost + cost,
          totalProfit: acc.totalProfit + profit,
          totalReceived: acc.totalReceived + received,
          totalDeduction: acc.totalDeduction + deduction,
          totalPending: acc.totalPending + pending,
        };
      },
      { totalBill: 0, totalCost: 0, totalProfit: 0, totalReceived: 0, totalDeduction: 0, totalPending: 0 }
    );
  }, [filteredData]);

  const itemTotals = useMemo(() => filteredItemSales.reduce(
    (acc, item) => ({
      qty: acc.qty + item.quantity,
      sale: acc.sale + item.total_sale,
      cost: acc.cost + item.total_cost,
      profit: acc.profit + item.profit,
    }),
    { qty: 0, sale: 0, cost: 0, profit: 0 }
  ), [filteredItemSales]);

  const itemCols = {
    invoice_no: (i: any) => i.invoice_no || "",
    invoice_date: (i: any) => i.invoice_date || "",
    customer_name: (i: any) => i.customer_name || "",
    item_name: (i: any) => i.item_name || "",
    inward_no: (i: any) => i.inward_no || "",
    quantity: (i: any) => Number(i.quantity || 0),
    sale_price: (i: any) => Number(i.sale_price || 0),
    total_sale: (i: any) => Number(i.total_sale || 0),
    purchase_price: (i: any) => Number(i.purchase_price || 0),
    total_cost: (i: any) => Number(i.total_cost || 0),
    profit: (i: any) => Number(i.total_sale || 0) - Number(i.total_cost || 0),
  } as const;
  const { sort: itemSort, sorted: sortedItemSales } = useSortedRows(filteredItemSales, itemCols, "invoice_no");

  // Export to CSV
  const exportToCSV = () => {
    if (reportView === "items") {
      if (filteredItemSales.length === 0) {
        alert("एक्सपोर्ट करने के लिए कोई item sales data नहीं है!");
        return;
      }
      const headers = ["Invoice No", "Date", "Customer Name", "Item Name", "Inward No.", "Qty", "Sale Price", "Total Sale", "Purchase Price", "Total Cost", "Profit"];
      const rows = filteredItemSales.map((item) => [
        item.invoice_no, item.invoice_date, item.customer_name, item.item_name, item.inward_no,
        item.quantity, item.sale_price.toFixed(2), item.total_sale.toFixed(2),
        item.purchase_price.toFixed(2), item.total_cost.toFixed(2), item.profit.toFixed(2),
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
      const itemCsv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
      const itemLink = document.createElement("a");
      itemLink.setAttribute("href", encodeURI(itemCsv));
      itemLink.setAttribute("download", `Item_Wise_Sales_Report_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(itemLink);
      itemLink.click();
      document.body.removeChild(itemLink);
      return;
    }

    if (filteredData.length === 0) {
      alert("एक्सपोर्ट करने के लिए कोई डेटा नहीं है!");
      return;
    }

    const headers = [
      "Invoice No",
      "Date",
      "Job No",
      "Customer",
      "Total Bill (₹)",
      "Total Cost (₹)",
      "Profit (₹)",
      "Received (₹)",
      "Deduction (₹)",
      "Pending (₹)",
    ];

    const rows = filteredData.map((item) => {
      const bill = Number(item.total_amount || 0);
      const cost = Number(item.total_cost || 0);
      const profit = bill - cost;
      const received = Number(item.received_amount || 0);
      const deduction = Number(item.deduction_amount || 0);
      const pending = Number(item.pending_amount ?? (bill - received - deduction));
      const customerLabel = item.business_name || item.customer_name || "-";

      return [
        `"${item.invoice_no || "-"}"`,
        `"${item.invoice_date || "-"}"`,
        `"${item.job_no || "DIRECT-SALE"}"`,
        `"${customerLabel}"`,
        bill.toFixed(2),
        cost.toFixed(2),
        profit.toFixed(2),
        received.toFixed(2),
        deduction.toFixed(2),
        pending.toFixed(2),
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Sales_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Sales Report
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            Detailed overview of billings, material cost, profits, and receivable balances.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={exportToCSV}
            style={{
              background: "#0284c7",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            📥 Export CSV
          </button>
          <button
            onClick={() => window.print()}
            style={{
              background: "#475569",
              color: "#fff",
              border: "none",
              padding: "9px 16px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* REPORT VIEW TOGGLE */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => setReportView("summary")}
          style={{ ...viewButtonStyle, background: reportView === "summary" ? "#2563eb" : "#e2e8f0", color: reportView === "summary" ? "#fff" : "#334155" }}
        >
          Invoice Summary Report
        </button>
        <button
          onClick={() => setReportView("items")}
          style={{ ...viewButtonStyle, background: reportView === "items" ? "#2563eb" : "#e2e8f0", color: reportView === "items" ? "#fff" : "#334155" }}
        >
          Item-wise Sales Report
        </button>
      </div>

      {/* SUMMARY CARDS */}
      <div
        style={{
          display: reportView === "summary" ? "grid" : "none",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <SummaryCard
          title="Total Bill"
          value={`₹ ${totals.totalBill.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          background="#eff6ff"
          textColor="#1e40af"
        />
        <SummaryCard
          title="Total Cost"
          value={`₹ ${totals.totalCost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          background="#fff7ed"
          textColor="#c2410c"
        />
        <SummaryCard
          title="Total Profit"
          value={`₹ ${totals.totalProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          background="#f0fdf4"
          textColor="#15803d"
        />
        <SummaryCard
          title="Received"
          value={`₹ ${totals.totalReceived.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          background="#f8fafc"
          textColor="#0f172a"
        />
        <SummaryCard
          title="Pending Due"
          value={`₹ ${totals.totalPending.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          background="#fef2f2"
          textColor="#b91c1c"
        />
      </div>

      {/* FILTER TOOLBAR */}
      <div
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <input
          type="text"
          placeholder="Search Invoice, Job No, Customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            minWidth: 260,
            outline: "none",
          }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.business_name || c.customer_name}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={filterInputStyle}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={filterInputStyle}
            />
          </div>

          {(fromDate || toDate || search || selectedCustomer !== "All") && (
            <button
              onClick={() => {
                setSearch("");
                setFromDate("");
                setToDate("");
                setSelectedCustomer("All");
              }}
              style={{
                background: "#f1f5f9",
                color: "#475569",
                border: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          display: reportView === "summary" ? "block" : "none",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <SortTh label="Invoice No" active={invSort.key === "invoice_no"} dir={invSort.dir} onToggle={() => invSort.toggle("invoice_no")} style={thStyle} />
                <SortTh label="Job No" active={invSort.key === "job_no"} dir={invSort.dir} onToggle={() => invSort.toggle("job_no")} style={thStyle} />
                <SortTh label="Customer" active={invSort.key === "customer"} dir={invSort.dir} onToggle={() => invSort.toggle("customer")} style={thStyle} />
                <SortTh label="Total Bill" active={invSort.key === "bill"} dir={invSort.dir} onToggle={() => invSort.toggle("bill")} style={thStyle} align="right" />
                <SortTh label="Total Cost" active={invSort.key === "cost"} dir={invSort.dir} onToggle={() => invSort.toggle("cost")} style={thStyle} align="right" />
                <SortTh label="Profit" active={invSort.key === "profit"} dir={invSort.dir} onToggle={() => invSort.toggle("profit")} style={thStyle} align="right" />
                <SortTh label="Received" active={invSort.key === "received"} dir={invSort.dir} onToggle={() => invSort.toggle("received")} style={thStyle} align="right" />
                <SortTh label="Deduction" active={invSort.key === "deduction"} dir={invSort.dir} onToggle={() => invSort.toggle("deduction")} style={thStyle} align="right" />
                <SortTh label="Pending" active={invSort.key === "pending"} dir={invSort.dir} onToggle={() => invSort.toggle("pending")} style={thStyle} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading sales data...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    No sales records found.
                  </td>
                </tr>
              ) : (
sortedInvoices.map((item) => {
                  const bill = Number(item.total_amount || 0);
                  const cost = Number(item.total_cost || 0);
                  const profit = bill - cost;
                  const received = Number(item.received_amount || 0);
                  const deduction = Number(item.deduction_amount || 0);
                  const pending = Number(item.pending_amount ?? (bill - received - deduction));

                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                      <td style={tdStyle}>
                        <strong style={{ color: "#2563eb" }}>{item.invoice_no || "-"}</strong>
                        <small style={{ display: "block", color: "#94a3b8", fontSize: 11 }}>
                          {item.invoice_date || "-"}
                        </small>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            background: item.job_no ? "#eff6ff" : "#f1f5f9",
                            color: item.job_no ? "#1d4ed8" : "#475569",
                            padding: "4px 8px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {item.job_no || "DIRECT-SALE"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <strong>{item.business_name || item.customer_name || "-"}</strong>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                        ₹ {bill.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>
                        ₹ {cost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 700,
                          color: profit >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        ₹ {profit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#166534" }}>
                        ₹ {received.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#c2410c" }}>
                        ₹ {deduction.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 700,
                          color: pending > 0 ? "#dc2626" : "#64748b",
                        }}
                      >
                        ₹ {pending.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ITEM-WISE SALES REPORT */}
      <div
        style={{
          display: reportView === "items" ? "block" : "none",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ color: "#0f172a", fontSize: 15 }}>Item-wise Sales Totals</strong>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: "#334155" }}>Qty: {itemTotals.qty.toLocaleString("en-IN")}</span>
            <span style={{ color: "#2563eb" }}>Total Sale: ₹ {itemTotals.sale.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span style={{ color: "#c2410c" }}>Total Cost: ₹ {itemTotals.cost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span style={{ color: itemTotals.profit >= 0 ? "#15803d" : "#dc2626" }}>Profit: ₹ {itemTotals.profit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <SortTh label="Invoice No" active={itemSort.key === "invoice_no"} dir={itemSort.dir} onToggle={() => itemSort.toggle("invoice_no")} style={thStyle} />
                <SortTh label="Date" active={itemSort.key === "invoice_date"} dir={itemSort.dir} onToggle={() => itemSort.toggle("invoice_date")} style={thStyle} />
                <SortTh label="Customer Name" active={itemSort.key === "customer_name"} dir={itemSort.dir} onToggle={() => itemSort.toggle("customer_name")} style={thStyle} />
                <SortTh label="Item Name" active={itemSort.key === "item_name"} dir={itemSort.dir} onToggle={() => itemSort.toggle("item_name")} style={thStyle} />
                <SortTh label="Inward No." active={itemSort.key === "inward_no"} dir={itemSort.dir} onToggle={() => itemSort.toggle("inward_no")} style={thStyle} />
                <SortTh label="Qty" active={itemSort.key === "quantity"} dir={itemSort.dir} onToggle={() => itemSort.toggle("quantity")} style={thStyle} align="right" />
                <SortTh label="Sale Price" active={itemSort.key === "sale_price"} dir={itemSort.dir} onToggle={() => itemSort.toggle("sale_price")} style={thStyle} align="right" />
                <SortTh label="Total Sale" active={itemSort.key === "total_sale"} dir={itemSort.dir} onToggle={() => itemSort.toggle("total_sale")} style={thStyle} align="right" />
                <SortTh label="Purchase Price" active={itemSort.key === "purchase_price"} dir={itemSort.dir} onToggle={() => itemSort.toggle("purchase_price")} style={thStyle} align="right" />
                <SortTh label="Total Cost" active={itemSort.key === "total_cost"} dir={itemSort.dir} onToggle={() => itemSort.toggle("total_cost")} style={thStyle} align="right" />
                <SortTh label="Profit" active={itemSort.key === "profit"} dir={itemSort.dir} onToggle={() => itemSort.toggle("profit")} style={thStyle} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading sales items...</td></tr>
              ) : filteredItemSales.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No item sales records found.</td></tr>
              ) : (
                sortedItemSales.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={tdStyle}><strong style={{ color: "#2563eb" }}>{item.invoice_no}</strong></td>
                    <td style={tdStyle}>{fmtDate(item.invoice_date)}</td>
                    <td style={tdStyle}>{item.customer_name}</td>
                    <td style={tdStyle}>{item.item_name}</td>
                    <td style={tdStyle}>{item.inward_no}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{item.quantity}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>₹ {item.sale_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>₹ {item.total_sale.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>₹ {item.purchase_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>₹ {item.total_cost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: item.profit >= 0 ? "#16a34a" : "#dc2626" }}>₹ {item.profit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
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

function SummaryCard({
  title,
  value,
  background,
  textColor,
}: {
  title: string;
  value: string;
  background: string;
  textColor: string;
}) {
  return (
    <div
      style={{
        background,
        padding: "16px 18px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{title}</span>
      <strong
        style={{
          display: "block",
          fontSize: 18,
          color: textColor,
          marginTop: 4,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "13px 14px",
  color: "#334155",
  whiteSpace: "nowrap",
};

const viewButtonStyle: React.CSSProperties = {
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const filterInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

export default SalesReport;
