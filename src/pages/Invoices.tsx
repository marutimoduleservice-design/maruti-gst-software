import { sc, getCompanyId } from "../lib/company";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import HistoryPanel from "../components/HistoryPanel";
import { enqueueOffline, isOffline } from "../lib/offlineQueue";

type Invoice = {
  id: number;
  invoice_no: string;
  invoice_date: string;
  customer_id: number;
  job_card_id: number | null;
  invoice_type: string;
  total_amount: number;
  customers: { customer_name: string; business_name?: string; mobile: string; address?: string };
  job_cards?: { id: number; job_no: string };
};

type ItemMaster = {
  id: number;
  item_code: string;
  item_name: string;
  sale_price: number;
  purchase_price: number;
  cost_price?: number;
  opening_stock: number;
  hsn_code?: string | null;
  gst_percent?: number | null;
};

type PurchaseItem = {
  id: number;
  inward_no: string;
  item_id: number;
  item_name: string;
  item_code?: string;
  quantity: number;
  purchase_rate: number;
  item_master?: ItemMaster;
};

type Customer = {
  id: number;
  customer_name: string;
  business_name?: string;
  mobile: string;
  customer_code: number;
  address?: string;
  business_address?: string;
  gst_number?: string;
};

type JobCard = {
  id: number;
  job_no: string;
  customer_id: number;
  repairing_quantity: number;
  warranty_quantity: number;
  reject_quantity: number;
  status: string;
  customers: { customer_name: string; business_name?: string; mobile: string; address?: string };
};

type LineItem = {
  id: string;
  source: string;
  inward_no: string;
  item_id: string;
  item_code?: string;
  item_name: string;
  quantity: number | string;
  rate: number | string;
  total: number;
  cost_rate: number;
  max_stock: number;
  purchase_line_id?: number;
  editable: boolean;
  hsn_code?: string;
  gst_percent?: number | string;
  // Edit mode me ye line DB me kitni saved hai. Available stock nikalte waqt
  // is invoice ki apni billed qty wapas minus karni padti hai.
  saved_quantity?: number;
};

function Invoices() {
  const [activeTab, setActiveTab] = useState<"Job Card" | "Direct">("Job Card");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchaseStock, setPurchaseStock] = useState<PurchaseItem[]>([]);
  const [masterItems, setMasterItems] = useState<ItemMaster[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [openJobCards, setOpenJobCards] = useState<JobCard[]>([]);
  const [soldByPurchaseLine, setSoldByPurchaseLine] = useState<Record<string, number>>({});
const [invoicedQtyByJob, setInvoicedQtyByJob] = useState<Record<string, number>>({});
  const [invoicedQtyByInvoice, setInvoicedQtyByInvoice] = useState<Record<string, number>>({});
  const [customerPrices, setCustomerPrices] = useState<Record<string, Record<string, number>>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);

  const [printingInvoice, setPrintingInvoice] = useState<Invoice | null>(null);
  const [printingItems, setPrintingItems] = useState<any[]>([]);
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);

  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [selectedCustomerMobile, setSelectedCustomerMobile] = useState("");
  const [selectedJobCardId, setSelectedJobCardId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobCard | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const invoiceCols = {
    invoice_no: (i: any) => String(i.invoice_no || ""),
    invoice_date: (i: any) => String(i.invoice_date || ""),
    invoice_type: (i: any) => String(i.invoice_type || ""),
    customer_name: (i: any) =>
      String(i.customers?.business_name || i.customers?.customer_name || ""),
    job_no: (i: any) => String(i.job_cards?.job_no || (i.job_card_id ? `JC-${i.job_card_id}` : "")),
    total_amount: (i: any) => Number(i.total_amount || 0),
  } as const;
  const { sort, sorted: sortedInvoices } = useSortedRows(invoices, invoiceCols, "invoice_date", "desc");

  const loadData = async () => {
    setLoading(true);

    // Offline: Promise.all reject hoga — jo data pehle se screen par hai wahi
    // rehne do, warna loading spinner hamesha ke liye atak jayega.
    let results: any[] | null = null;
    try {
      results = await Promise.all([
        sc("invoices").select("*").order("id", { ascending: false }),
        sc("purchases").select("*"),
        sc("items").select("*"),
        sc("customers").select("*").order("business_name"),
        sc("job_cards").select("id, job_no, status, customer_id, repairing_quantity, warranty_quantity, reject_quantity").order("id", { ascending: false }),
        sc("invoice_items").select("invoice_id, inward_no, item_name, quantity"),
        sc("customer_item_prices").select("*")
      ]);
    } catch {
      setLoading(false);
      return;
    }
    const [invRes, purchaseRes, itemRes, custRes, jobRes, invoiceItemsRes, priceRes] = results;

    const customerRows = (custRes.data || []) as Customer[];
    const jobRows = (jobRes.data || []) as Omit<JobCard, "customers">[];
    let masterRows = (itemRes.data || []) as ItemMaster[];
    if (masterRows.length === 0) {
      const fallbackItems = await sc("item_master").select("*");
      masterRows = (fallbackItems.data || []) as ItemMaster[];
    }
    const customerById = new Map<number, Invoice["customers"]>(
      customerRows.map((customer) => [customer.id, {
        customer_name: customer.customer_name,
        business_name: customer.business_name || "",
        mobile: customer.mobile,
        address: customer.business_address || customer.address || "",
      }]),
    );
    const jobById = new Map<number, { id: number; job_no: string }>(
      jobRows.map((job) => [job.id, { id: job.id, job_no: job.job_no }]),
    );

    if (invRes.data) {
      setInvoices((invRes.data as Omit<Invoice, "customers" | "job_cards">[]).map((invoice) => ({
        ...invoice,
        customers: customerById.get(invoice.customer_id) || { customer_name: "Unknown Customer", business_name: "", mobile: "" },
        job_cards: invoice.job_card_id ? jobById.get(invoice.job_card_id) : undefined,
      })));
    }
    if (purchaseRes.data) {
      const stockRows: PurchaseItem[] = (purchaseRes.data as any[]).map((purchase) => {
        const matchedItem = masterRows.find((item) =>
          (purchase.item_code && item.item_code && String(purchase.item_code).toLowerCase() === String(item.item_code).toLowerCase()) ||
          (purchase.item_name && item.item_name && String(purchase.item_name).trim().toLowerCase() === String(item.item_name).trim().toLowerCase())
        );
        return {
          id: Number(purchase.id),
          inward_no: String(purchase.inward_no || purchase.purchase_no || `INW-${purchase.id}`),
          item_id: Number(matchedItem?.id || purchase.item_id || 0),
          item_name: String(purchase.item_name || matchedItem?.item_name || "Spare Part"),
          item_code: purchase.item_code || matchedItem?.item_code || "",
          quantity: Number(purchase.quantity || 0),
          purchase_rate: Number(purchase.rate || purchase.purchase_rate || 0),
          item_master: matchedItem,
        };
      }).filter((stock) => stock.quantity > 0);

      // Opening stock ko bhi ek virtual stock entry ki tarah dikhao, warna ye
      // kabhi bik hi nahi sakta tha (aur cost 0 padta tha -> profit zyada dikhta).
      masterRows.forEach((item) => {
        const openingQty = Number(item.opening_stock || 0);
        if (openingQty <= 0) return;
        const itemName = String(item.item_name || "");
        const alreadyListed = stockRows.some(
          (row) =>
            (row.item_code && item.item_code && String(row.item_code).toLowerCase() === String(item.item_code).toLowerCase()) ||
            row.item_name.trim().toLowerCase() === itemName.trim().toLowerCase()
        );
        if (alreadyListed) return;
        stockRows.push({
          id: -Math.abs(Number(item.id) || 1), // negative id: real inward se kabhi collide nahi hoga
          inward_no: "OPENING",
          item_id: Number(item.id),
          item_name: itemName,
          item_code: item.item_code || "",
          quantity: openingQty,
          purchase_rate: Number(item.purchase_price || 0) || Number(item.cost_price || 0),
          item_master: item,
        });
      });

      setPurchaseStock(stockRows);
    }
    setMasterItems(masterRows);
    if (custRes.data) setCustomers(customerRows);
    if (invoiceItemsRes.data) {
      const soldTotals: Record<string, number> = {};
      (invoiceItemsRes.data as any[]).forEach((soldItem) => {
        if (!soldItem.inward_no || String(soldItem.inward_no).startsWith("JOB-")) return;
        const key = getPurchaseLineKey({
          inward_no: soldItem.inward_no,
          item_code: soldItem.item_code,
          item_name: soldItem.item_name || "",
        });
        soldTotals[key] = (soldTotals[key] || 0) + Number(soldItem.quantity || 0);
      });
      setSoldByPurchaseLine(soldTotals);

      // "JOB-REP" / "JOB-WAR" / "JOB-REJ" qty already invoiced per job card, so a part
      // invoice never lets the same module qty be billed twice.
      const byJob: Record<string, number> = {};
      const byInvoice: Record<string, number> = {};
      const invoiceJobById = new Map<number, number>(
        (invRes.data || []).map((inv: any) => [Number(inv.id), Number(inv.job_card_id || 0)])
      );
      (invoiceItemsRes.data || []).forEach((it: any) => {
        const inwardNo = String(it.inward_no || "");
        if (inwardNo !== "JOB-REP" && inwardNo !== "JOB-WAR" && inwardNo !== "JOB-REJ") return;
        const qty = Number(it.quantity || 0);
        const invId = Number(it.invoice_id);
        byInvoice[`${invId}|${inwardNo}`] = (byInvoice[`${invId}|${inwardNo}`] || 0) + qty;
        const jobId = invoiceJobById.get(invId);
        if (!jobId) return;
        byJob[`${jobId}|${inwardNo}`] = (byJob[`${jobId}|${inwardNo}`] || 0) + qty;
      });
      setInvoicedQtyByJob(byJob);
      setInvoicedQtyByInvoice(byInvoice);
    }
    if (jobRes.data) {
      const activeJobs = jobRows
        .filter(j => j.status === "Open")
        .map((job) => ({
          ...job,
          customers: customerById.get(job.customer_id) || { customer_name: "Unknown Customer", business_name: "", mobile: "" },
        }));
      setOpenJobCards(activeJobs);
    }
    if (priceRes.data) {
      const priceMap: Record<string, Record<string, number>> = {};
      (priceRes.data as any[]).forEach((row) => {
        priceMap[String(row.customer_id)] = priceMap[String(row.customer_id)] || {};
        const val = Number(row.agreed_rate);
        if (!isNaN(val) && val >= 0) {
          priceMap[String(row.customer_id)][String(row.item_id)] = val;
        }
      });
      setCustomerPrices(priceMap);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const findMasterItem = (keyword: string) =>
    masterItems.find(i => i.item_name.toLowerCase().includes(keyword.toLowerCase()));

  const getMasterItemPrice = (keyword: string, customerId?: string) => {
    const found = findMasterItem(keyword);
    if (!found) return 0;
    return getCustomerItemPrice(found, customerId) ?? found.sale_price ?? 0;
  };

  const getCustomerItemPrice = (item: ItemMaster | undefined | null, customerId?: string): number | null => {    const custId = customerId ?? selectedCustomerId;
    if (!item || !custId) return null;
    const custPrices = customerPrices[String(custId)];
    if (!custPrices) return null;
    for (const [id, p] of Object.entries(custPrices)) {
      if (String(id) === String(item.id) ||
          (item.item_code && String(id) === String(item.item_code))) {
        return p;
      }
    }
    return null;
  };

  const handleJobCardSelect = (jobId: string) => {
    setSelectedJobCardId(jobId);
    const job = openJobCards.find((j) => String(j.id) === jobId);
    
    if (job) {
      setSelectedJob(job);
      setSelectedCustomerId(String(job.customer_id));
      setSelectedCustomerName(job.customers?.business_name || job.customers?.customer_name || "");
      setSelectedCustomerMobile(job.customers?.mobile || "");

const breakdownLines: LineItem[] = [];
      const repStats = getRepairingStats(job);

if (repStats.pending > 0) {
        const rate = getMasterItemPrice("Module Service", String(job.customer_id));
        breakdownLines.push({
          id: Math.random().toString(),
          source: "Repairing",
          inward_no: "JOB-REP",
          item_id: "",
          item_name: "Module Service",
          quantity: repStats.pending,
          rate: rate,
          total: repStats.pending * rate,
          cost_rate: 0,
          max_stock: 999,
          editable: true,
        });
      }

      const warrantyLeft = getRemainingQty(Number(job.id), "JOB-WAR", job.warranty_quantity);
      if (warrantyLeft > 0) {
        const rate = getMasterItemPrice("Warranty Service", String(job.customer_id));
        breakdownLines.push({
          id: Math.random().toString(),
          source: "Warranty",
          inward_no: "JOB-WAR",
          item_id: "",
          item_name: "Warranty Service",
          quantity: warrantyLeft,
          rate: rate,
          total: warrantyLeft * rate,
          cost_rate: 0,
          max_stock: 999,
          editable: false,
        });
      }

      const rejectLeft = getRemainingQty(Number(job.id), "JOB-REJ", job.reject_quantity);
      if (rejectLeft > 0) {
        const rate = getMasterItemPrice("Reject Module", String(job.customer_id));
        breakdownLines.push({
          id: Math.random().toString(),
          source: "Reject",
          inward_no: "JOB-REJ",
          item_id: "",
          item_name: "Reject Module",
          quantity: rejectLeft,
          rate: rate,
          total: rejectLeft * rate,
          cost_rate: 0,
          max_stock: 999,
          editable: false,
        });
      }

      setLineItems(breakdownLines);
    } else {
      setSelectedJob(null);
      setSelectedCustomerId("");
      setSelectedCustomerName("");
      setSelectedCustomerMobile("");
      setLineItems([]);
    }
  };

  const handleCustomerSelect = (custId: string) => {
    setSelectedCustomerId(custId);
    const cust = customers.find(c => String(c.id) === custId);
    if (cust) {
      setSelectedCustomerName(cust.business_name || cust.customer_name);
      setSelectedCustomerMobile(cust.mobile || "");
    }
  };

  const getPurchaseLineKey = (purchase: Pick<PurchaseItem, "inward_no" | "item_code" | "item_name">) =>
    `${String(purchase.inward_no || "").trim().toLowerCase()}|${String(purchase.item_name || "").trim().toLowerCase()}`;

  // Ek inward line par kitna stock already gaya — DOOSRON ka saved sold +
  // is invoice ki DOOSRI lines ki current qty. Apni saved qty (edit se pehle
  // ki billed qty) minus hoti hai, warna apni hi qty stock me count hoke
  // available kam dikhata tha (jaise 10 me se 4 khud ke bill par the aur
  // system 6 bata raha tha, jabki asli available poora 10 tha).
  const getSoldByOthers = (
    purchase: Pick<PurchaseItem, "inward_no" | "item_code" | "item_name">,
    excludeLineId?: string,
    lines: LineItem[] = lineItems,
  ) => {
    const key = getPurchaseLineKey(purchase);
    let ownSaved = 0;
    let ownOthersCurrent = 0;
    lines.forEach((line) => {
      if (line.source !== "Spare Part" || !line.inward_no) return;
      if (getPurchaseLineKey(line) !== key) return;
      ownSaved += Number(line.saved_quantity || 0);
      if (line.id !== excludeLineId) ownOthersCurrent += Number(line.quantity || 0);
    });
    const soldByOthers = Math.max(0, Number(soldByPurchaseLine[key] || 0) - ownSaved);
    return soldByOthers + ownOthersCurrent;
  };

  const getAvailablePurchaseQty = (
    purchase: PurchaseItem,
    excludeLineId?: string,
    lines: LineItem[] = lineItems,
  ) => Math.max(0, Number(purchase.quantity || 0) - getSoldByOthers(purchase, excludeLineId, lines));

  const getPurchaseOptionValue = (purchase: Pick<PurchaseItem, "id" | "inward_no" | "item_code" | "item_name">) =>
    `${String(purchase.inward_no || "").trim().toLowerCase()}|${String(purchase.item_name || "").trim().toLowerCase()}`;

  // Qty of a "JOB-*" module type already invoiced on a job card.
// While editing, that invoice's own qty is excluded because its lines get replaced.
  const getInvoicedQty = (jobId: number, inwardNo: string, excludeInvoiceId?: number | null) => {
    const base = invoicedQtyByJob[`${jobId}|${inwardNo}`] || 0;
    const own = excludeInvoiceId ? invoicedQtyByInvoice[`${excludeInvoiceId}|${inwardNo}`] || 0 : 0;
    return Math.max(0, base - own);
  };

  const getRemainingQty = (jobId: number, inwardNo: string, total: number) => {
    const t = Number(total || 0);
    if (t <= 0) return 0;
    return Math.max(0, t - getInvoicedQty(jobId, inwardNo, editingInvoiceId));
  };

  // How much Module Service qty can still be billed on the selected job card.
  const repairingCap = (() => {
    if (!selectedJob) return 0;
    return getRemainingQty(Number(selectedJob.id), "JOB-REP", selectedJob.repairing_quantity);
  })();

  const getRepairingStats = (job: JobCard | null) => {
    const total = Number(job?.repairing_quantity || 0);
    const invoiced = job ? getInvoicedQty(Number(job.id), "JOB-REP", editingInvoiceId) : 0;
    return { total, invoiced, pending: Math.max(0, total - invoiced) };
  };

  const addModuleServiceLine = () => {
    const jobCap = repairingCap;
    const used = lineItems
      .filter((l) => l.source === "Repairing")
      .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

    if (jobCap > 0 && used >= jobCap) {
      alert(`Is Job Card ke liye total repairing qty (${jobCap}) already add ho chuki hain. Zyada qty nahi daal sakte.`);
      return;
    }

    const remaining = jobCap > 0 ? Math.max(0, jobCap - used) : 1;
    const qty = Math.min(1, remaining) || 1;
    const rate = 50;

    setLineItems([
      ...lineItems,
      {
        id: Math.random().toString(),
        source: "Repairing",
        inward_no: "JOB-REP",
        item_id: "",
        item_name: "Module Service",
        quantity: qty,
        rate: rate,
        total: qty * rate,
        cost_rate: 0,
        max_stock: 999,
        editable: true,
      },
    ]);
  };

  const addSparePartLine = () => {
    setLineItems([
      ...lineItems,
      {
        id: Math.random().toString(),
        source: "Spare Part",
        inward_no: "",
        item_id: "",
        item_name: "",
        quantity: "",
        rate: 0,
        total: 0,
        cost_rate: 0,
        max_stock: 999,
        editable: true,
      },
    ]);
  };

  const removeLineItem = (id: string) => {
    setLineItems(lineItems.filter((item) => item.id !== id));
  };

  const updateLineItem = (id: string, field: string, value: any) => {
    setLineItems((prev) =>
      prev.map((line) => {
        if (line.id === id) {
          const updatedLine = { ...line, [field]: value };

          if (field === "inward_no") {
            if (value === "") {
              updatedLine.inward_no = "";
              updatedLine.purchase_line_id = undefined;
              updatedLine.item_id = "";
              updatedLine.item_code = "";
              updatedLine.item_name = "";
              updatedLine.rate = 0;
              updatedLine.cost_rate = 0;
              updatedLine.quantity = "";
              updatedLine.total = 0;
            } else {
              const foundStock = purchaseStock.find((ps) =>
                String(ps.id) === String(value) || getPurchaseOptionValue(ps) === String(value) || String(ps.inward_no) === String(value)
              );
              if (foundStock) {
                const availableQty = getAvailablePurchaseQty(foundStock, id);
                updatedLine.inward_no = foundStock.inward_no;
                updatedLine.purchase_line_id = foundStock.id;
                updatedLine.item_id = String(foundStock.item_id || "");
                updatedLine.item_code = foundStock.item_code || "";
                updatedLine.item_name = foundStock.item_name || foundStock.item_master?.item_name || "Spare Part";

                const matchedMasterItem = masterItems.find(mi =>
                  (foundStock.item_code && mi.item_code && String(mi.item_code).toLowerCase() === String(foundStock.item_code).toLowerCase()) ||
                  String(mi.id) === String(foundStock.item_id)
                );
                const customerRate = getCustomerItemPrice(matchedMasterItem);
                updatedLine.rate = customerRate ?? matchedMasterItem?.sale_price ?? foundStock.item_master?.sale_price ?? 0;
                updatedLine.cost_rate = foundStock.purchase_rate || 0;
                updatedLine.max_stock = availableQty;

                if (availableQty <= 0) {
                  alert(`Inward ${foundStock.inward_no} mein is item ka stock available nahi hai.`);
                  updatedLine.quantity = "";
                } else if (updatedLine.quantity === "" || Number(updatedLine.quantity) === 0 || Number(updatedLine.quantity) > availableQty) {
                  updatedLine.quantity = 1;
                }
              }
            }
          }

          if (field === "quantity") {
            if (value === "") {
              updatedLine.quantity = "";
              updatedLine.total = 0;
              return updatedLine;
            }
            const qty = Number(value);
            if (!Number.isFinite(qty) || qty < 1) {
              updatedLine.quantity = 1;
            } else if (updatedLine.source === "Spare Part") {
              // Har keystroke par live available dobara nikalo — editing me
              // apni purani billed qty minus hoti hai, warna limit kam dikhti.
              const stockRow = purchaseStock.find((ps) => String(ps.id) === String(updatedLine.purchase_line_id));
              const liveAvailable = stockRow
                ? getAvailablePurchaseQty(stockRow, id, prev)
                : Number(updatedLine.max_stock || 0);
              updatedLine.max_stock = liveAvailable;
              if (qty > liveAvailable) {
                alert(`Stock limit exceeded! Available stock is only ${liveAvailable}.`);
                updatedLine.quantity = liveAvailable;
              } else {
                updatedLine.quantity = qty;
              }
            } else if (updatedLine.source === "Repairing") {
              const jobCap = repairingCap;
              const otherRepairing = prev
                .filter((l) => l.id !== id && l.source === "Repairing")
                .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
              if (jobCap > 0 && otherRepairing + qty > jobCap) {
                alert(`Total Module Service qty ${jobCap} se zyada nahi ho sakti (pehle se ${getInvoicedQty(Number(selectedJob?.id || 0), "JOB-REP", editingInvoiceId)} qty invoice ho chuki hai).`);
                updatedLine.quantity = Math.max(1, jobCap - otherRepairing);
              } else {
                updatedLine.quantity = qty;
              }
            } else {
              updatedLine.quantity = qty;
            }
          }

          const currentQty = Number(updatedLine.quantity) || 0;
          const currentRate = Number(updatedLine.rate) || 0;
          updatedLine.total = currentQty * currentRate;
          return updatedLine;
        }
        return line;
      })
    );
  };

  const baseTotal = lineItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const totalPurchaseCost = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.cost_rate)), 0);
  const grandTotal = baseTotal;

  const handleEditInvoice = async (inv: Invoice) => {
    try {
      const targetInvNo = inv.invoice_no;
      const { data: paymentCheck, error: payError } = await sc("bank_transactions")
        .select("*")
        .or(`particulars.ilike.%${targetInvNo}%,notes.ilike.%${targetInvNo}%`);

      // Bounced/returned receipt customer ka payment nahi — invoice phir se
      // edit honi chahiye.
      const livePayments = (paymentCheck || []).filter((r: any) => !r.bounced_at);
      if (!payError && livePayments.length > 0) {
        alert("❌ Error: Is invoice ka payment/receipt pehle hi ho chuka hai, isliye ab yeh invoice edit nahi kiya ja sakta!");
        return;
      }
    } catch (err) {
      console.error("Invoice payment validation error:", err);
    }

    try {
      setEditingInvoiceId(inv.id);
      setActiveTab(inv.invoice_type === "Direct" ? "Direct" : "Job Card");
      setInvoiceDate(inv.invoice_date);
      setSelectedCustomerId(String(inv.customer_id));
      setSelectedJobCardId(inv.job_card_id ? String(inv.job_card_id) : "");
      setLineItems([]);

      const cust = customers.find(c => c.id === inv.customer_id);
      setSelectedCustomerName(cust?.business_name || cust?.customer_name || inv.customers?.business_name || inv.customers?.customer_name || "");
      setSelectedCustomerMobile(cust?.mobile || inv.customers?.mobile || "");

      const { data: itemsData, error: itemsError } = await sc("invoice_items")
        .select("*")
        .eq("invoice_id", inv.id);
      if (itemsError) throw itemsError;

      if (itemsData) {
        // Is invoice ki per-inward saved qty — dusre invoices ka sold alag se
        // already `soldByPurchaseLine` me hai, isliye apni qty minus karni hai.
        const ownSavedByKey: Record<string, number> = {};
        itemsData.forEach((it: any) => {
          if (!it.inward_no || String(it.inward_no).startsWith("JOB-")) return;
          const lineKey = getPurchaseLineKey({
            inward_no: it.inward_no,
            item_code: it.item_code || "",
            item_name: it.item_name || "",
          });
          ownSavedByKey[lineKey] = (ownSavedByKey[lineKey] || 0) + Number(it.quantity || 0);
        });

        const loadedLines: LineItem[] = itemsData.map((it: any) => {
          const isJobLine = Boolean(it.inward_no?.startsWith("JOB"));
          const lineKey = getPurchaseLineKey({
            inward_no: it.inward_no || "",
            item_code: it.item_code || "",
            item_name: it.item_name || "",
          });
          const matchedStock = purchaseStock.find((purchase) =>
            String(purchase.inward_no || "") === String(it.inward_no || "") &&
            String(purchase.item_code || purchase.item_name || "").trim().toLowerCase() === String(it.item_code || it.item_name || "").trim().toLowerCase()
          );
          const lineQty = Number(it.quantity || 0);
          // Available = inward stock − doosron ka sold − is invoice ki baaki lines.
          const soldByOthers = Math.max(0, Number(soldByPurchaseLine[lineKey] || 0) - Number(ownSavedByKey[lineKey] || 0));
          const ownOtherLines = Math.max(0, Number(ownSavedByKey[lineKey] || 0) - lineQty);
          const computedMax = matchedStock
            ? Math.max(0, Number(matchedStock.quantity || 0) - soldByOthers - ownOtherLines)
            : 0;
          return {
            id: Math.random().toString(),
            source: isJobLine ? (it.inward_no === "JOB-REP" ? "Repairing" : it.inward_no === "JOB-WAR" ? "Warranty" : "Reject") : "Spare Part",
            inward_no: it.inward_no || "",
            item_id: it.item_id ? String(it.item_id) : "",
            item_code: it.item_code || "",
            item_name: it.item_name,
            quantity: it.quantity,
            rate: it.rate,
            total: it.total,
            cost_rate: it.cost_rate || 0,
            saved_quantity: lineQty,
            max_stock: isJobLine ? 999 : Math.max(computedMax, lineQty),
            purchase_line_id: matchedStock?.id,
            editable: !it.inward_no?.startsWith("JOB") || it.inward_no === "JOB-REP"
          };
        });
        setLineItems(loadedLines);
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error: any) {
      setEditingInvoiceId(null);
      window.alert(`Invoice edit load nahi hua: ${error.message}`);
    }
  };

  const handlePrintInvoice = async (inv: Invoice) => {
    setPrintingInvoice(inv);
    const { data: itemsData } = await sc("invoice_items").select("*").eq("invoice_id", inv.id);
    if (itemsData) setPrintingItems(itemsData);
  };

const handleDeleteInvoice = async (inv: Invoice) => {
    if (!window.confirm(`Are you sure you want to delete Invoice ${inv.invoice_no}? This will reopen the linked Job Card and restore stock.`)) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc("delete_invoice_atomic", {
        p_invoice_id: inv.id,
        p_company_id: getCompanyId(),
      });
      if (error) throw error;
      alert(`Invoice ${data} deleted successfully and Job Card reopened!`);
      loadData();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const validateLiveSpareStock = async () => {
    const [{ data: purchaseRows, error: purchaseError }, { data: soldRows, error: soldError }] = await Promise.all([
      sc("purchases").select("inward_no, purchase_no, item_name, item_code, quantity"),
      sc("invoice_items").select("invoice_id, inward_no, item_name, quantity")
    ]);
    if (purchaseError) throw purchaseError;
    if (soldError) throw soldError;

    const purchasedByKey: Record<string, number> = {};
    (purchaseRows || []).forEach((purchase: any) => {
      const key = getPurchaseLineKey({
        inward_no: String(purchase.inward_no || purchase.purchase_no || ""),
        item_code: purchase.item_code,
        item_name: purchase.item_name || "",
      });
      purchasedByKey[key] = (purchasedByKey[key] || 0) + Number(purchase.quantity || 0);
    });

    const soldByKey: Record<string, number> = {};
    (soldRows || []).forEach((sold: any) => {
      if (editingInvoiceId && Number(sold.invoice_id) === editingInvoiceId) return;
      const key = getPurchaseLineKey({
        inward_no: sold.inward_no || "",
        item_code: sold.item_code,
        item_name: sold.item_name || "",
      });
      if (!sold.inward_no || String(sold.inward_no).startsWith("JOB-")) return;
      soldByKey[key] = (soldByKey[key] || 0) + Number(sold.quantity || 0);
    });

    const requestedByKey: Record<string, number> = {};
    lineItems.forEach((line) => {
      if (line.source !== "Spare Part") return;
      const key = getPurchaseLineKey(line);
      requestedByKey[key] = (requestedByKey[key] || 0) + Number(line.quantity || 0);
    });

    const exceeded = Object.entries(requestedByKey).find(([key, requestedQty]) => {
      const availableQty = (purchasedByKey[key] || 0) - (soldByKey[key] || 0);
      return requestedQty > availableQty;
    });
    if (exceeded) {
      const availableQty = Math.max(0, (purchasedByKey[exceeded[0]] || 0) - (soldByKey[exceeded[0]] || 0));
      throw new Error(`Stock available sirf ${availableQty} hai. Isse zyada spare quantity ka invoice nahi ban sakta.`);
    }
  };

  const handleSaveInvoice = async () => {
    if (!selectedCustomerId) {
      alert("Please select a customer or job card.");
      return;
    }
    if (lineItems.length === 0) {
      alert("Please add valid items.");
      return;
    }

    const invalidStockLine = lineItems.find((line) =>
      line.source === "Spare Part" && (!line.inward_no || Number(line.quantity) < 1 || Number(line.quantity) > Number(line.max_stock))
    );
    if (invalidStockLine) {
      alert(`Spare part stock limit exceeded. Available stock is only ${invalidStockLine.max_stock}.`);
      return;
    }

    if (activeTab === "Job Card" && selectedJob) {
      const jobCap = repairingCap;
      const repairingTotal = lineItems
        .filter((l) => l.source === "Repairing")
        .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
      if (jobCap > 0 && repairingTotal > jobCap) {
        alert(`Module Service ki total qty (${repairingTotal}) is Job Card ki bachi hui qty (${jobCap}) se zyada nahi ho sakti.`);
        return;
      }
    }

    const basePayload = {
      p_mode: editingInvoiceId ? "edit" : "create",
      p_editing_invoice_id: editingInvoiceId,
      p_invoice_date: invoiceDate,
      p_customer_id: Number(selectedCustomerId),
      p_job_card_id: activeTab === "Job Card" ? Number(selectedJobCardId) : null,
      p_invoice_type: activeTab,
      p_total_amount: Number(grandTotal) || 0,
      p_lines: lineItems.map((item) => ({
        inward_no: item.inward_no || "",
        item_id: item.item_id ? Number(item.item_id) : null,
        item_name: item.item_name || "",
        quantity: Number(item.quantity) || 1,
        rate: Number(item.rate) || 0,
        total: Number(item.total) || 0,
        cost_rate: Number(item.cost_rate) || 0,
        source: item.source || "Spare Part",
      })),
      p_company_id: getCompanyId(),
    };

    // 📴 Offline: naya invoice queue me save hota hai aur internet aate hi app
    // apne aap server par bhej deta hai (niche "pending sync" banner dikhta hai).
    // Edit offline me allow nahi — purani invoice par live payment/stock check
    // lagta hai jo offline verify nahi ho sakta.
    if (isOffline()) {
      if (editingInvoiceId) {
        alert("📴 Offline mode — invoice edit save nahi ho sakta. Internet connect karke dobara try karein.");
        return;
      }
      enqueueOffline({
        label: `Invoice ${activeTab} — ₹${Number(grandTotal || 0).toLocaleString("en-IN")}`,
        kind: "invoice",
        payload: { ...basePayload, p_old_items: [] },
      });
      alert("📴 Offline — invoice queue me save ho gaya hai. Internet aate hi app apne aap save kar dega (niche 'pending sync' banner dikhega).");
      setEditingInvoiceId(null);
      setSelectedJobCardId("");
      setSelectedCustomerId("");
      setSelectedCustomerName("");
      setSelectedCustomerMobile("");
      setLineItems([]);
      return;
    }

    try {
      await validateLiveSpareStock();
    } catch (stockError: any) {
      alert(stockError.message || "Live stock validation failed.");
      return;
    }

    setSaving(true);
    try {
      if (editingInvoiceId) {
        const currentInv = invoices.find(i => i.id === editingInvoiceId);
        if (currentInv) {
          const { data: finalCheck } = await sc("bank_transactions")
            .select("id, bounced_at")
            .or(`particulars.ilike.%${currentInv.invoice_no}%,notes.ilike.%${currentInv.invoice_no}%`)
            .limit(5);

          // Bounced receipt asli payment nahi — edit block mat karo.
          const liveCheck = (finalCheck || []).filter((r: any) => !r.bounced_at);
          if (liveCheck.length > 0) {
            setSaving(false);
            alert("❌ Error: Is invoice ka payment ho chuka hai, update karna allowed nahi hai!");
            return;
          }
        }
      }

      const oldItems = editingInvoiceId
        ? await (async () => {
            const { data: oldRows } = await sc("invoice_items")
              .select("item_id, quantity")
              .eq("invoice_id", editingInvoiceId);
            return (oldRows || []).map((row: any) => ({
              item_id: row.item_id ? Number(row.item_id) : null,
              quantity: Number(row.quantity) || 0,
            }));
          })()
        : [];

      const payload = { ...basePayload, p_old_items: oldItems };

      const { data: result, error } = await supabase.rpc("save_invoice_atomic", payload);

      if (error) throw error;

      const invoiceNo = (result as any)?.invoice_no || "";
      const rep = (result as any)?.repairing_pending;
      const closed = (result as any)?.job_card_closed;
      let saveMsg = `Invoice ${editingInvoiceId ? "Updated" : "Generated"} Successfully!\nInvoice No: ${invoiceNo}`;
      if (activeTab === "Job Card" && rep !== undefined && rep !== null) {
        const pendingNum = Number(rep);
        if (!closed && pendingNum > 0.00001) {
          saveMsg += `\n\nPart Invoice saved. Job Card Open hai. Baki ${pendingNum} Module Service qty baad me invoice kar sakte hain.`;
        } else {
          saveMsg += `\n\nPoori repairing qty invoice ho gayi - Job Card Closed.`;
        }
      }
      alert(saveMsg);
      setEditingInvoiceId(null);
      setSelectedJobCardId("");
      setSelectedCustomerId("");
      setSelectedCustomerName("");
      setSelectedCustomerMobile("");
      setLineItems([]);
      loadData();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ width: "100%", padding: 10 }}>
      {printingInvoice && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "white", width: "700px", padding: "30px", borderRadius: "8px", position: "relative", maxHeight: "90vh", overflowY: "auto" }}>
            <button onClick={() => setPrintingInvoice(null)} style={{ position: "absolute", top: 15, right: 15, background: "#dc2626", color: "white", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}>Close ✕</button>
            
            <div style={{ textAlign: "center", borderBottom: "2px solid #333", paddingBottom: "15px", marginBottom: "20px" }}>
              <h2 style={{ margin: 0, color: "#1e3a8a" }}>MARUTI MODULE SERVICE</h2>
              <p style={{ margin: "5px 0", fontSize: 13, color: "#555" }}>Electronic Jacquard Module Service & Repairing Specialist</p>
              <p style={{ margin: 0, fontSize: 12, color: "#777" }}>Surat, Gujarat</p>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px", fontSize: 14 }}>
              <div>
                <strong>Business:</strong> {printingInvoice.customers?.business_name || printingInvoice.customers?.customer_name}<br/>
                <strong>Mobile:</strong> {printingInvoice.customers?.mobile}<br/>
                <strong>Address:</strong> {printingInvoice.customers?.address || "Surat"}
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>Invoice No:</strong> {printingInvoice.invoice_no}<br/>
                <strong>Date:</strong> {fmtDate(printingInvoice.invoice_date)}<br/>
                <strong>Job Ref:</strong> {printingInvoice.job_cards?.job_no || "Direct Sale"}
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "left" }}>Item / Description</th>
                  <th style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "center", width: 60 }}>Qty</th>
                  <th style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "right", width: 100 }}>Rate (₹)</th>
                  <th style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "right", width: 100 }}>Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {printingItems.map((pi, idx) => (
                  <tr key={idx}>
                    <td style={{ border: "1px solid #cbd5e1", padding: 8 }}>{pi.item_name}</td>
                    <td style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "center" }}>{pi.quantity}</td>
                    <td style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "right" }}>₹ {pi.rate}</td>
                    <td style={{ border: "1px solid #cbd5e1", padding: 8, textAlign: "right" }}>₹ {pi.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ textAlign: "right", fontSize: 16, marginBottom: "30px" }}>
              <strong>Grand Total: ₹ {printingInvoice.total_amount}</strong>
            </div>

            <button onClick={() => window.print()} style={{ background: "#2563eb", color: "white", border: "none", padding: "10px 20px", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>🖨️ Print Invoice</button>
          </div>
        </div>
      )}

      {historyInvoice && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setHistoryInvoice(null); }}
          style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}
        >
          <div style={{ background: "white", width: "640px", maxWidth: "94vw", padding: "24px", borderRadius: "8px", position: "relative", maxHeight: "85vh", overflowY: "auto" }}>
            <button onClick={() => setHistoryInvoice(null)} style={{ position: "absolute", top: 15, right: 15, background: "#dc2626", color: "white", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}>Close ✕</button>
            <h3 style={{ margin: "0 0 4px", color: "#0f172a" }}>🕘 Invoice History — {historyInvoice.invoice_no}</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
              Kab bana, kisne edit kiya, kya badla — poora audit trail.
            </p>
            <HistoryPanel entity="Invoice" entityId={historyInvoice.id} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button 
          onClick={() => { setActiveTab("Job Card"); setLineItems([]); setSelectedJobCardId(""); setEditingInvoiceId(null); }}
          style={{ flex: 1, padding: "14px", background: activeTab === "Job Card" ? "#2563eb" : "#64748b", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", fontSize: 15, cursor: "pointer" }}
        >
          1. Invoice By Job Card
        </button>
        <button 
          onClick={() => { setActiveTab("Direct"); setLineItems([]); setSelectedJobCardId(""); setEditingInvoiceId(null); }}
          style={{ flex: 1, padding: "14px", background: activeTab === "Direct" ? "#2563eb" : "#64748b", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", fontSize: 15, cursor: "pointer" }}
        >
          2. Material Invoice (Direct Sale)
        </button>
      </div>

      <div className="customers-table-card" style={{ padding: 20, marginBottom: 20, border: editingInvoiceId ? "2px solid #f97316" : "1px solid #e2e8f0" }}>
        {editingInvoiceId && (
          <div style={{ background: "#ffedd5", color: "#c2410c", padding: "8px 12px", borderRadius: "6px", marginBottom: 15, fontWeight: "bold", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠️ Editing Mode Active for Invoice ID: {editingInvoiceId}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const inv = invoices.find((i) => i.id === editingInvoiceId);
                  if (inv) setHistoryInvoice(inv);
                }}
                style={{ background: "#475569", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
              >
                🕘 History
              </button>
              <button onClick={() => { setEditingInvoiceId(null); setLineItems([]); setSelectedJobCardId(""); }} style={{ background: "#c2410c", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}>Cancel Edit</button>
            </span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.5fr 1.5fr", gap: "15px", marginBottom: 15 }}>
          {activeTab === "Job Card" ? (
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 5 }}>Select Open Job Card</label>
              <select value={selectedJobCardId} onChange={(e) => handleJobCardSelect(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }}>
                <option value="">-- Choose Job Card --</option>
                {openJobCards.map(j => {
                  const s = getRepairingStats(j);
                  const partTag = s.total > 0 && s.pending <= 0.00001
                    ? " | Repairing fully invoiced"
                    : s.invoiced > 0
                      ? ` | Part invoiced (${s.invoiced}/${s.total})`
                      : "";
                  return (
                    <option key={j.id} value={j.id}>
                      {j.job_no || `JC-${String(j.id).padStart(5, "0")}`} | {j.customers?.business_name || j.customers?.customer_name}{partTag}
                    </option>
                  );
                })}
              </select>
              {selectedJob && repairingCap > 0 && !editingInvoiceId && (
                <div style={{ background: "#eff6ff", color: "#1d4ed8", padding: "6px 10px", borderRadius: "6px", marginTop: 8, fontSize: 12, fontWeight: "bold" }}>
                  Module Service: {getRepairingStats(selectedJob).invoiced} / {getRepairingStats(selectedJob).total} qty pehle se invoiced. Baki {repairingCap} qty abhi bill kar sakte hain - poori qty bill karne par hi Job Card Closed hoga.
                </div>
              )}
              {selectedJob && !editingInvoiceId && repairingCap <= 0 && getRepairingStats(selectedJob).total > 0 && (
                <div style={{ background: "#fef3c7", color: "#92400e", padding: "6px 10px", borderRadius: "6px", marginTop: 8, fontSize: 12, fontWeight: "bold" }}>
                  Is Job Card ki poori repairing qty invoice ho chuki hai - naya Module Service line add nahi hoga.
                </div>
              )}
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 5 }}>Select Customer</label>
              <select value={selectedCustomerId} onChange={(e) => handleCustomerSelect(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }}>
                <option value="">-- Choose Customer --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.business_name || c.customer_name} ({c.mobile})</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 5 }}>Business Name</label>
            <input type="text" value={selectedCustomerName} readOnly placeholder="Customer Name" style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "#f8fafc" }} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 5 }}>Mobile / WhatsApp Number</label>
            <input type="text" value={selectedCustomerMobile} readOnly placeholder="WhatsApp Number" style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc", background: "#f8fafc" }} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 5 }}>Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ccc" }} />
          </div>
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 10, color: "#334155", borderTop: "1px solid #e2e8f0", paddingTop: 15 }}>Modules & Extra Spare Parts Breakdown</h3>
        <div className="invoice-line-items-wrapper">
        <table className="invoice-line-items-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 15 }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left", fontSize: 13 }}>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 140 }}>Source</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd" }}>Item / Module / Spare Part Name</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 90 }}>Qty</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 120 }}>Rate (₹)</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 120 }}>Total (₹)</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 120 }}>Purchase Cost</th>
              <th style={{ padding: 10, borderBottom: "1px solid #ddd", width: 50 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: 6 }}>
                  <span style={{ 
                    background: item.source === "Repairing" ? "#e0e7ff" : item.source === "Warranty" ? "#fef3c7" : item.source === "Reject" ? "#fee2e2" : "#f1f5f9", 
                    color: item.source === "Repairing" ? "#3730a3" : item.source === "Warranty" ? "#92400e" : item.source === "Reject" ? "#991b1b" : "#334155", 
                    fontSize: 11, fontWeight: "bold", padding: "8px", borderRadius: 4, display: "block", textAlign: "center" 
                  }}>
                    {item.source}
                  </span>
                </td>
                <td style={{ padding: 6 }}>
                  {item.source === "Repairing" ? (
                    <input type="text" value={item.item_name} onChange={(e) => updateLineItem(item.id, "item_name", e.target.value)} style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 4, fontWeight: "bold" }} />
                  ) : !item.editable ? (
                    <input type="text" value={item.item_name} readOnly style={{ width: "100%", padding: 9, background: "#f1f5f9", border: "1px solid #ccc", borderRadius: 4, fontWeight: "bold" }} />
                  ) : (
                    <select
                      value={item.inward_no ? getPurchaseOptionValue({ id: item.purchase_line_id || 0, inward_no: item.inward_no, item_code: item.item_code, item_name: item.item_name }) : ""}
                      onChange={(e) => updateLineItem(item.id, "inward_no", e.target.value)}
                      style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 4 }}
                    >
                      <option value="">Select Purchase Item from Stock</option>
                      {purchaseStock
                        .map((ps) => ({ purchase: ps, availableQty: getAvailablePurchaseQty(ps, item.id) }))
                        .filter(({ availableQty }) => availableQty > 0)
                        .sort((a, b) =>
                          String(a.purchase.item_name || "").trim().toLowerCase()
                            .localeCompare(String(b.purchase.item_name || "").trim().toLowerCase())
                        )
                        .map(({ purchase: ps, availableQty }) => (
                          <option key={ps.id} value={getPurchaseOptionValue(ps)}>
                            [{ps.inward_no}] {ps.item_name || ps.item_master?.item_name} (Available: {availableQty}) (Purchase Cost : {Number(ps.purchase_rate || 0)})
                          </option>
                        ))}
                    </select>
                  )}
                </td>
                <td style={{ padding: 6 }}>
                  <input 
                    type="number" min="1" max={item.max_stock} value={item.quantity} readOnly={item.source === "Repairing" ? false : !item.editable}
                    onChange={(e) => updateLineItem(item.id, "quantity", e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 4, fontWeight: "bold", background: item.source === "Repairing" ? "#fff" : item.editable ? "#fff" : "#f1f5f9" }} 
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={item.rate} onChange={(e) => updateLineItem(item.id, "rate", e.target.value)} readOnly={item.source === "Repairing" ? false : !item.editable} style={{ width: "100%", padding: 9, border: "1px solid #ccc", borderRadius: 4, background: item.source === "Repairing" ? "#fff" : item.editable ? "#fff" : "#f1f5f9" }} />
                </td>
                <td style={{ padding: 6, fontWeight: "bold" }}>₹ {item.total.toFixed(2)}</td>
                <td style={{ padding: 6, color: "#d97706", fontWeight: "bold" }}>₹ {(Number(item.cost_rate || 0) * Number(item.quantity || 0)).toFixed(2)}</td>
                <td style={{ padding: 6, textAlign: "center" }}>
                  {item.editable && (
                    <button onClick={() => removeLineItem(item.id)} style={{ background: "#dc2626", color: "white", border: "none", padding: "6px 10px", borderRadius: 4, cursor: "pointer" }}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <button onClick={addSparePartLine} style={{ padding: "9px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>
          ＋ Add Spare Part / Material (From Purchase Stock)
        </button>

        {activeTab === "Job Card" && (
          <button onClick={addModuleServiceLine} style={{ padding: "9px 16px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold", marginLeft: 10 }}>
            ＋ Module Service Line (alag rate ke liye)
          </button>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginTop: 25, background: "#f8fafc", padding: 15, borderRadius: 8, alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: "bold", display: "block", color: "#64748b" }}>Grand Total Bill (₹)</label>
            <strong style={{ color: "#166534", fontSize: 20 }}>₹ {grandTotal.toFixed(2)}</strong>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: "bold", display: "block", color: "#64748b" }}>Total Purchase Cost (₹)</label>
            <strong style={{ color: "#d97706", fontSize: 20 }}>₹ {totalPurchaseCost.toFixed(2)}</strong>
          </div>
        </div>

        <button onClick={handleSaveInvoice} disabled={saving} className="customer-primary-button" style={{ width: "100%", marginTop: 20, background: "#f97316", justifyContent: "center", padding: 14, fontSize: 16 }}>
          {saving ? "Processing..." : editingInvoiceId ? "Update Existing Invoice" : "Save Invoice"}
        </button>
      </div>

      <div className="customers-table-card">
        <div className="customers-toolbar">
          <h2>Sales Register & Invoices</h2>
        </div>
        <div className="customer-table-wrapper">
          <table className="customer-table">
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <SortTh label="Invoice No" active={sort.key === "invoice_no"} dir={sort.dir} onToggle={() => sort.toggle("invoice_no")} />
                <SortTh label="Date" active={sort.key === "invoice_date"} dir={sort.dir} onToggle={() => sort.toggle("invoice_date")} />
                <SortTh label="Type" active={sort.key === "invoice_type"} dir={sort.dir} onToggle={() => sort.toggle("invoice_type")} />
                <SortTh label="Customer Name" active={sort.key === "customer_name"} dir={sort.dir} onToggle={() => sort.toggle("customer_name")} />
                <SortTh label="Job Ref" active={sort.key === "job_no"} dir={sort.dir} onToggle={() => sort.toggle("job_no")} />
                <SortTh label="Total Amount" active={sort.key === "total_amount"} dir={sort.dir} onToggle={() => sort.toggle("total_amount")} align="right" />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 20 }}>Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 20 }}>No invoices found.</td></tr>
              ) : (
                sortedInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><strong>{inv.invoice_no}</strong></td>
                    <td>{fmtDate(inv.invoice_date)}</td>
                    <td>{inv.invoice_type}</td>
                    <td>{inv.customers?.business_name || inv.customers?.customer_name || "—"}</td>
                    <td>{inv.job_cards?.job_no || `JC-${inv.job_card_id}` || "—"}</td>
                    <td><strong style={{ color: "#166534" }}>₹ {inv.total_amount}</strong></td>
                    <td style={{ display: "flex", gap: "6px" }}>
                      <button 
                        onClick={() => handleEditInvoice(inv)} 
                        style={{ background: "#2563eb", color: "white", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
                      >
                        ✏️ Edit
                      </button>
                      <button 
                        onClick={() => handlePrintInvoice(inv)} 
                        style={{ background: "#16a34a", color: "white", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
                      >
                        🖨️ Print
                      </button>
                      <button 
                        onClick={() => setHistoryInvoice(inv)} 
                        style={{ background: "#475569", color: "white", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
                      >
                        🕘 History
                      </button>
                      <button 
                        onClick={() => handleDeleteInvoice(inv)} 
                        style={{ background: "#dc2626", color: "white", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
                      >
                        🗑️ Delete
                      </button>
                    </td>
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

export default Invoices;
