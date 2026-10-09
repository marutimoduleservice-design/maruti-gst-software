import { sc, getCompanyId } from "../lib/company";
import { useEffect, useState, useMemo } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";
import { supabase } from "../lib/supabase";
import {
  GST_RATES,
  round2,
  stateCodeFromGstin,
  taxSplit,
} from "../lib/gst";

type PurchaseRecord = {
  id: number;
  inward_no: string;
  purchase_no?: string;
  purchase_date: string;
  vendor_id?: number | null;
  vendor_name: string;
  vendor_code?: string;
  item_name: string;
  item_code?: string;
  quantity: number;
  rate: number;
  total_amount: number;
  payment_mode?: string;
  remarks?: string;
  vendor_gstin?: string | null;
  hsn_code?: string | null;
  gst_percent?: number | null;
  taxable_value?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  supply_type?: string | null;
};

type ItemOption = {
  id: number;
  item_code: string | null;
  item_name: string | null;
  purchase_price?: number | null;
  cost_price?: number | null;
  rate?: number | null;
  hsn_code?: string | null;
  gst_percent?: number | null;
};

type VendorOption = {
  id: number;
  vendor_code: string | null;
  business_name: string | null;
  contact_person?: string | null;
  phone?: string | null;
  gstin?: string | null;
  state_code?: string | null;
  state_name?: string | null;
};

type PurchaseItemRow = {
  id?: number;
  inward_no: string;
  item_name: string;
  item_code: string;
  quantity: number;
  rate: number;
  total_amount: number;
  hsn_code?: string;
  gst_percent?: number;
};

function Purchase() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [itemsList, setItemsList] = useState<ItemOption[]>([]);
  const [vendorsList, setVendorsList] = useState<VendorOption[]>([]);
  const [availableBalance, setAvailableBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedVendorFilter, setSelectedVendorFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Modal State & Multi-Item Form State
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [originalTotal, setOriginalTotal] = useState(0);

  const [formData, setFormData] = useState({
    po_no: "",
    inward_no: "",
    purchase_date: new Date().toISOString().slice(0, 10),
    vendor_id: undefined as number | undefined,
    vendor_name: "",
    vendor_code: "",
    payment_mode: "Bank / UPI",
    remarks: "",
  });

  const [itemRows, setItemRows] = useState<PurchaseItemRow[]>([
    { inward_no: "", item_name: "", item_code: "", quantity: 1, rate: 0, total_amount: 0 },
  ]);

  // Company GST identity — vendor ke state se intra/inter decide hota hai.
  const [companyStateCode, setCompanyStateCode] = useState("");
  const [gstEnabled, setGstEnabled] = useState(false);

  // GST split is vendor ke state par depend karta hai (form vendor se link hai).
  const selectedVendor = vendorsList.find((v) => String(v.id) === String(formData.vendor_id));
  const vendorGstin = String(selectedVendor?.gstin || "").trim();
  const vendorStateCode =
    String(selectedVendor?.state_code || "").trim() || stateCodeFromGstin(vendorGstin) || "";
  const interState = Boolean(
    gstEnabled && companyStateCode && vendorStateCode && companyStateCode !== vendorStateCode,
  );
  const purchaseSupplyType = interState ? "Inter-State" : "Intra-State";

  // Row ka GST split — rate (price) GST-exclusive maana gaya hai.
  const rowTaxSplit = (row: PurchaseItemRow) =>
    gstEnabled
      ? taxSplit(
          round2((Number(row.quantity) || 0) * (Number(row.rate) || 0)),
          Number(row.gst_percent) || 0,
          interState,
        )
      : {
          taxable: round2((Number(row.quantity) || 0) * (Number(row.rate) || 0)),
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: round2((Number(row.quantity) || 0) * (Number(row.rate) || 0)),
        };

  const purchaseTaxTotals = itemRows.reduce(
    (acc, row) => {
      const s = rowTaxSplit(row);
      return {
        taxable: acc.taxable + s.taxable,
        cgst: acc.cgst + s.cgst,
        sgst: acc.sgst + s.sgst,
        igst: acc.igst + s.igst,
      };
    },
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
  );
  const purchaseGrandTotal = round2(
    purchaseTaxTotals.taxable + purchaseTaxTotals.cgst + purchaseTaxTotals.sgst + purchaseTaxTotals.igst,
  );

  // ROBUST LIVE BANK BALANCE CALCULATION
  const calculateLiveBalance = async () => {
    try {
      let totalInflow = 0;
      let totalOutflow = 0;

      const { data: bankData, error } = await sc("bank_transactions")
        .select("*");

      if (!error && bankData && Array.isArray(bankData)) {
        bankData.forEach((row: any) => {
          // Bounce/return: paisa account me hila hi nahi.
          if (row.bounced_at) return;
          const rawAmt = Number(row.amount || row.total_amount || 0);
          const pIn = Number(row.payment_in ?? row.credit_amount ?? 0);
          const pOut = Number(row.payment_out ?? row.debit_amount ?? 0);
          const typeStr = String(
            row.transaction_type || row.type || row.entry_type || ""
          ).toLowerCase();

          if (pIn > 0) {
            totalInflow += pIn;
          } else if (pOut > 0) {
            totalOutflow += pOut;
          } else if (
            typeStr.includes("+") ||
            typeStr.includes("deposit") ||
            typeStr.includes("capital") ||
            typeStr.includes("credit") ||
            typeStr.includes("income") ||
            typeStr.includes("receipt")
          ) {
            totalInflow += rawAmt;
          } else if (
            typeStr.includes("-") ||
            typeStr.includes("withdraw") ||
            typeStr.includes("expense") ||
            typeStr.includes("debit") ||
            typeStr.includes("payment")
          ) {
            totalOutflow += rawAmt;
          } else if (rawAmt > 0) {
            totalInflow += rawAmt;
          }
        });
      }

      const net = totalInflow - totalOutflow;
      setAvailableBalance(net);
      return net;
    } catch (err) {
      console.error("Live balance error in purchase:", err);
      return 0;
    }
  };

  const loadAllData = async () => {
    setLoading(true);

    try {
      await calculateLiveBalance();

      try {
        const { data: compRows } = await supabase
          .from("companies")
          .select("id, tax_mode, gst_number, state_code")
          .eq("id", getCompanyId())
          .limit(1);
        const comp: any = (compRows || [])[0];
        if (comp) {
          const taxMode = String(comp.tax_mode || "").trim().toLowerCase();
          const gstin = String(comp.gst_number || "");
          const code = String(comp.state_code || "").trim() || stateCodeFromGstin(gstin) || "";
          setCompanyStateCode(code);
          setGstEnabled(taxMode !== "non-gst" && (Boolean(gstin) || Boolean(code)));
        }
      } catch {
        // ignore
      }

      // 1. Fetch Items
      let { data: itemsData } = await sc("items")
        .select("*")
        .order("id", { ascending: true });

      if (!itemsData || itemsData.length === 0) {
        const fallbackItems = await sc("item_master")
          .select("*")
          .order("id", { ascending: true });
        if (fallbackItems.data) itemsData = fallbackItems.data;
      }

      if (itemsData) setItemsList(itemsData as ItemOption[]);

      // 2. Fetch Vendors
      const { data: vendorsData } = await sc("vendors")
        .select("*")
        .order("business_name", { ascending: true });

      if (vendorsData) setVendorsList(vendorsData as VendorOption[]);

      // 3. Fetch Purchases
      const { data: purchaseData, error } = await sc("purchases")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
        console.error("Purchases fetch error:", error);
      } else {
        const mapped = (purchaseData || []).map((p: any) => ({
          ...p,
          inward_no: p.inward_no || p.purchase_no || `INW-${p.id}`,
        }));
        setPurchases(mapped as PurchaseRecord[]);
      }
    } catch (err) {
      console.error("Error loading purchase data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleVendorChange = (vendorIdStr: string) => {
    if (!vendorIdStr) {
      setFormData((prev) => ({
        ...prev,
        vendor_id: undefined,
        vendor_name: "",
        vendor_code: "",
      }));
      return;
    }

    const matchedVendor = vendorsList.find((v) => String(v.id) === vendorIdStr);
    if (matchedVendor) {
      setFormData((prev) => ({
        ...prev,
        vendor_id: matchedVendor.id,
        vendor_name: matchedVendor.business_name || "",
        vendor_code: matchedVendor.vendor_code || "",
      }));
    }
  };

  const handleAddItemRow = () => {
    setItemRows((prev) => [
      ...prev,
      { inward_no: nextInwardNo(prev), item_name: "", item_code: "", quantity: 1, rate: 0, total_amount: 0, hsn_code: "", gst_percent: 0 },
    ]);
  };

  const handleRemoveItemRow = (index: number) => {
    if (itemRows.length === 1) {
      alert("कम से कम 1 आइटम होना ज़रूरी है!");
      return;
    }
    if (isEditing && itemRows[index].id !== undefined) {
      alert("Existing item ko edit mode me delete nahi kiya ja sakta. Sirf naye added items hataye ja sakte hain.");
      return;
    }
    setItemRows((prev) => prev.filter((_, i) => i !== index));
  };

  // Next available INW number (max tracked inward_no + 1)
  const maxInwardNumber = (rows: PurchaseItemRow[]): number => {
    let max = 1000;
    rows.forEach((r) => {
      const m = String(r.inward_no || "").match(/^INW-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max;
  };

  // Generates the next inward number after the given rows
  const nextInwardNo = (rows: PurchaseItemRow[]): string => `INW-${maxInwardNumber(rows) + 1}`;

  const handleRowItemChange = (index: number, selectedItemName: string) => {
    const matchedItem = itemsList.find(
      (it) => it.item_name === selectedItemName || it.item_code === selectedItemName
    );

    const updated = [...itemRows];
    const current = updated[index];

    if (matchedItem) {
      const itemRate = Number(
        matchedItem.purchase_price ??
          matchedItem.cost_price ??
          matchedItem.rate ??
          current.rate ??
          0
      );
      const gstPercent = Number(matchedItem.gst_percent ?? (gstEnabled ? 18 : 0)) || 0;
      const rowForTax: PurchaseItemRow = {
        ...current,
        quantity: current.quantity,
        rate: itemRate,
        gst_percent: gstPercent,
      };
      updated[index] = {
        ...current,
        item_name: matchedItem.item_name || "",
        item_code: matchedItem.item_code || "",
        rate: itemRate,
        hsn_code: matchedItem.hsn_code || "",
        gst_percent: gstPercent,
        total_amount: rowTaxSplit(rowForTax).total,
      };
    } else {
      updated[index] = {
        ...current,
        item_name: selectedItemName,
      };
    }
    setItemRows(updated);
  };

  const handleRowQtyRateChange = (index: number, qty: number, rate: number) => {
    const updated = [...itemRows];
    const row: PurchaseItemRow = { ...updated[index], quantity: qty, rate: rate };
    updated[index] = { ...row, total_amount: rowTaxSplit(row).total };
    setItemRows(updated);
  };

  const handleRowGstChange = (index: number, gstPercent: number, hsn: string) => {
    const updated = [...itemRows];
    const row: PurchaseItemRow = {
      ...updated[index],
      gst_percent: gstPercent,
      hsn_code: hsn,
    };
    updated[index] = { ...row, total_amount: rowTaxSplit(row).total };
    setItemRows(updated);
  };

  const openNewModal = () => {
    // 1. Next PO number (max purchase_no starting with PO-)
    let nextPo = 1001;
    const poNumbers: number[] = [];
    purchases.forEach((p) => {
      const m = String(p.purchase_no || "").match(/^PO-(\d+)$/i);
      if (m) poNumbers.push(parseInt(m[1], 10));
    });
    if (poNumbers.length > 0) nextPo = Math.max(...poNumbers) + 1;

    // 2. Next INW number (max inward_no currently used in DB)
    let nextInw = 1001;
    const inwNumbers: number[] = [];
    purchases.forEach((p) => {
      const m = String(p.inward_no || "").match(/^INW-(\d+)$/i);
      if (m) inwNumbers.push(parseInt(m[1], 10));
    });
    if (inwNumbers.length > 0) nextInw = Math.max(...inwNumbers) + 1;

    const firstItem = itemsList[0];
    const firstRate = Number(firstItem?.purchase_price ?? firstItem?.cost_price ?? 0);
    const firstGst = Number(firstItem?.gst_percent ?? (gstEnabled ? 18 : 0)) || 0;
    const firstRow: PurchaseItemRow = {
      inward_no: `INW-${nextInw}`,
      item_name: firstItem?.item_name || "",
      item_code: firstItem?.item_code || "",
      quantity: 1,
      rate: firstRate,
      hsn_code: firstItem?.hsn_code || "",
      gst_percent: firstGst,
      total_amount: rowTaxSplit({ quantity: 1, rate: firstRate, gst_percent: firstGst } as PurchaseItemRow).total,
    };

    setFormData({
      po_no: `PO-${nextPo}`,
      inward_no: `INW-${nextInw}`,
      purchase_date: new Date().toISOString().slice(0, 10),
      vendor_id: vendorsList[0]?.id,
      vendor_name: vendorsList[0]?.business_name || "",
      vendor_code: vendorsList[0]?.vendor_code || "",
      payment_mode: "Bank / UPI",
      remarks: "",
    });

    setItemRows([firstRow]);

    setIsEditing(false);
    setEditId(null);
    setShowModal(true);
  };

  const openEditModal = async (item: PurchaseRecord) => {
    // Load ALL items belonging to the same PO so editing keeps the whole order
    const poNo = item.purchase_no || item.inward_no || "";
    let poRows: PurchaseRecord[] = [];
    if (poNo && item.purchase_no) {
      const { data, error } = await sc("purchases")
        .select("*")
        .eq("purchase_no", poNo)
        .order("id", { ascending: true });
      if (!error && data && data.length > 0) poRows = data as unknown as PurchaseRecord[];
    }
    if (poRows.length === 0) poRows = [item];

    const firstRow = poRows[0];
    setFormData({
      po_no: firstRow.purchase_no || firstRow.inward_no || "",
      inward_no: firstRow.inward_no || firstRow.purchase_no || "",
      purchase_date: firstRow.purchase_date || new Date().toISOString().slice(0, 10),
      vendor_id: firstRow.vendor_id || undefined,
      vendor_name: firstRow.vendor_name || "",
      vendor_code: firstRow.vendor_code || "",
      payment_mode: firstRow.payment_mode || "Bank / UPI",
      remarks: firstRow.remarks || "",
    });

    setItemRows(
      poRows.map((r) => ({
        id: r.id,
        inward_no: r.inward_no || r.purchase_no || "",
        item_name: r.item_name || "",
        item_code: r.item_code || "",
        quantity: r.quantity || 1,
        rate: r.rate || 0,
        hsn_code: r.hsn_code || "",
        gst_percent: Number(r.gst_percent || 0),
        total_amount: r.total_amount || (r.quantity || 1) * (r.rate || 0),
      }))
    );
    setOriginalTotal(poRows.reduce((s, r) => s + Number(r.total_amount || 0), 0));

    setIsEditing(true);
    setEditId(item.id);
    setShowModal(true);
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const generatedPo = formData.po_no || `PO-1001`;

    try {
      if (isEditing && editId) {
        const existingRows = itemRows.filter((r) => r.id !== undefined);
        const newRows = itemRows.filter((r) => r.id === undefined);

        for (const row of existingRows) {
          const tax = rowTaxSplit(row);
          const recordToUpdate = {
            inward_no: row.inward_no || generatedPo,
            purchase_no: generatedPo,
            purchase_date: formData.purchase_date,
            vendor_id: formData.vendor_id ? Number(formData.vendor_id) : null,
            vendor_name: formData.vendor_name || "Direct Vendor",
            vendor_code: formData.vendor_code || "",
            item_name: row.item_name || "Module Part",
            item_code: row.item_code || "",
            quantity: Number(row.quantity || 1),
            rate: Number(row.rate || 0),
            total_amount: Number(row.total_amount || 0),
            payment_mode: formData.payment_mode,
            remarks: formData.remarks,
            vendor_gstin: vendorGstin || null,
            supply_type: purchaseSupplyType,
            hsn_code: row.hsn_code || "",
            gst_percent: Number(row.gst_percent || 0),
            taxable_value: tax.taxable,
            cgst_amount: tax.cgst,
            sgst_amount: tax.sgst,
            igst_amount: tax.igst,
          };

          const { error } = await sc("purchases")
            .update(recordToUpdate)
            .eq("id", row.id);
          if (error) throw error;
        }

        if (newRows.length > 0) {
          const recordsToInsert = newRows.map((row) => {
            const tax = rowTaxSplit(row);
            return {
              inward_no: row.inward_no || generatedPo,
              purchase_no: generatedPo,
              purchase_date: formData.purchase_date,
              vendor_id: formData.vendor_id ? Number(formData.vendor_id) : null,
              vendor_name: formData.vendor_name || "Direct Vendor",
              vendor_code: formData.vendor_code || "",
              item_name: row.item_name || "Module Part",
              item_code: row.item_code || "",
              quantity: Number(row.quantity || 1),
              rate: Number(row.rate || 0),
              total_amount: Number(row.total_amount || 0),
              payment_mode: formData.payment_mode,
              remarks: formData.remarks,
              vendor_gstin: vendorGstin || null,
              supply_type: purchaseSupplyType,
              hsn_code: row.hsn_code || "",
              gst_percent: Number(row.gst_percent || 0),
              taxable_value: tax.taxable,
              cgst_amount: tax.cgst,
              sgst_amount: tax.sgst,
              igst_amount: tax.igst,
            };
          });

          const { error } = await sc("purchases").insert(recordsToInsert);
          if (error) throw error;
        }

        // 🔄 DUPLICATE ENTRY FIX: Bank transaction amount ko naye total se update karo
        const newTotal = itemRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);

        if (originalTotal !== newTotal) {
          const { data: existingTx } = await sc("bank_transactions")
            .select("id, amount, payment_out")
            .or(`particulars.ilike.%${generatedPo}%,notes.ilike.%${generatedPo}%`)
            .limit(1);

          if (existingTx && existingTx.length > 0) {
            const tx = existingTx[0];
            await sc("bank_transactions")
              .update({ amount: newTotal, payment_out: newTotal })
              .eq("id", tx.id);
          }
        }
      } else {
        const recordsToInsert = itemRows.map((row) => {
          const tax = rowTaxSplit(row);
          return {
            inward_no: row.inward_no || generatedPo,
            purchase_no: generatedPo,
            purchase_date: formData.purchase_date,
            vendor_id: formData.vendor_id ? Number(formData.vendor_id) : null,
            vendor_name: formData.vendor_name || "Direct Vendor",
            vendor_code: formData.vendor_code || "",
            item_name: row.item_name || "Module Part",
            item_code: row.item_code || "",
            quantity: Number(row.quantity || 1),
            rate: Number(row.rate || 0),
            total_amount: Number(row.total_amount || 0),
            payment_mode: formData.payment_mode,
            remarks: formData.remarks,
            vendor_gstin: vendorGstin || null,
            supply_type: purchaseSupplyType,
            hsn_code: row.hsn_code || "",
            gst_percent: Number(row.gst_percent || 0),
            taxable_value: tax.taxable,
            cgst_amount: tax.cgst,
            sgst_amount: tax.sgst,
            igst_amount: tax.igst,
          };
        });

        const { error } = await sc("purchases").insert(recordsToInsert);
        if (error) throw error;
      }

      alert("✅ Purchase Inward Updated Successfully Without Duplicate Bank Entries!");
      setShowModal(false);
      await loadAllData();
    } catch (err: any) {
      console.error("Save error:", err);
      alert("❌ Database Save Error: " + (err.message || "Failed to save."));
    } finally {
      setSaving(false);
    }
  };

  const filteredData = useMemo(() => {
    return purchases.filter((item) => {
      const q = search.trim().toLowerCase();
      const inw = (item.inward_no || item.purchase_no || "").toLowerCase();
      const vName = (item.vendor_name || "").toLowerCase();
      const vCode = (item.vendor_code || "").toLowerCase();
      const iName = (item.item_name || "").toLowerCase();
      const iCode = (item.item_code || "").toLowerCase();

      const matchesSearch =
        !q ||
        inw.includes(q) ||
        vName.includes(q) ||
        vCode.includes(q) ||
        iName.includes(q) ||
        iCode.includes(q);

      const matchesVendor =
        selectedVendorFilter === "All" ||
        String(item.vendor_id) === selectedVendorFilter ||
        item.vendor_name === selectedVendorFilter;

      const itemDate = item.purchase_date || "";
      const matchesFrom = !fromDate || itemDate >= fromDate;
      const matchesTo = !toDate || itemDate <= toDate;

      return matchesSearch && matchesVendor && matchesFrom && matchesTo;
    });
  }, [purchases, search, selectedVendorFilter, fromDate, toDate]);

  const purchaseCols = {
    purchase_no: (p: any) => String(p.purchase_no || ""),
    inward_no: (p: any) => String(p.inward_no || p.purchase_no || ""),
    purchase_date: (p: any) => String(p.purchase_date || ""),
    vendor_name: (p: any) =>
      String((p.vendor_code ? `${p.vendor_code} - ` : "") + (p.vendor_name || "")),
    item_name: (p: any) => String(p.item_name || ""),
    quantity: (p: any) => Number(p.quantity || 0),
    rate: (p: any) => Number(p.rate || 0),
    total_amount: (p: any) =>
      Number(p.total_amount ?? Number(p.quantity || 0) * Number(p.rate || 0)),
  } as const;
  const { sort, sorted: sortedPurchases } = useSortedRows(filteredData, purchaseCols, "purchase_date", "desc");

  const totals = useMemo(() => {
    return filteredData.reduce(
      (acc, item) => {
        const qty = Number(item.quantity || 0);
        const bill = Number(item.total_amount ?? qty * Number(item.rate || 0));
        return {
          qty: acc.qty + qty,
          amount: acc.amount + bill,
        };
      },
      { qty: 0, amount: 0 }
    );
  }, [filteredData]);

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
            Purchase & Inward Stock
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>
            Vendor purchase management, material inward logs, and spare part rates.
          </p>
        </div>

        {/* LIVE AVAILABLE BANK BALANCE DISPLAY */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              background: availableBalance > 0 ? "#f0fdf4" : "#fef2f2",
              border: `2px solid ${availableBalance > 0 ? "#86efac" : "#fca5a5"}`,
              padding: "6px 14px",
              borderRadius: 8,
              textAlign: "right",
            }}
          >
            <span style={{ fontSize: 11, color: "#64748b", display: "block", fontWeight: 700 }}>
              🏦 Live Passbook Balance
            </span>
            <strong style={{ fontSize: 16, color: availableBalance > 0 ? "#15803d" : "#b91c1c" }}>
              ₹ {availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </strong>
          </div>

          <button
            onClick={calculateLiveBalance}
            title="पासबुक से ताज़ा बैलेंस लोड करें"
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            🔄 Refresh
          </button>

          <button
            onClick={openNewModal}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            + New Purchase Entry
          </button>
        </div>
      </div>

      {/* KPI SUMMARY CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div style={kpiBoxStyle("#eff6ff")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Inward Quantity</span>
          <strong style={{ display: "block", fontSize: 22, color: "#1e40af", marginTop: 4 }}>
            {totals.qty.toLocaleString("en-IN")} Units
          </strong>
        </div>

        <div style={kpiBoxStyle("#fff7ed")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Purchase Inward Value</span>
          <strong style={{ display: "block", fontSize: 22, color: "#c2410c", marginTop: 4 }}>
            ₹ {totals.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </strong>
        </div>

        <div style={kpiBoxStyle("#f0fdf4")}>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Total Inward Bills</span>
          <strong style={{ display: "block", fontSize: 22, color: "#15803d", marginTop: 4 }}>
            {filteredData.length} Records
          </strong>
        </div>
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
          placeholder="Search Inward No, Vendor, Item Name..."
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
            value={selectedVendorFilter}
            onChange={(e) => setSelectedVendorFilter(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Vendors</option>
            {vendorsList.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {v.vendor_code ? `${v.vendor_code} - ` : ""}
                {v.business_name}
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
        </div>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <SortTh label="PO No" active={sort.key === "purchase_no"} dir={sort.dir} onToggle={() => sort.toggle("purchase_no")} style={thStyle} />
                <SortTh label="Inward No" active={sort.key === "inward_no"} dir={sort.dir} onToggle={() => sort.toggle("inward_no")} style={thStyle} />
                <SortTh label="Date" active={sort.key === "purchase_date"} dir={sort.dir} onToggle={() => sort.toggle("purchase_date")} style={thStyle} />
                <SortTh label="Vendor" active={sort.key === "vendor_name"} dir={sort.dir} onToggle={() => sort.toggle("vendor_name")} style={thStyle} />
                <SortTh label="Item Name" active={sort.key === "item_name"} dir={sort.dir} onToggle={() => sort.toggle("item_name")} style={thStyle} />
                <SortTh label="Qty" active={sort.key === "quantity"} dir={sort.dir} onToggle={() => sort.toggle("quantity")} style={thStyle} align="right" />
                <SortTh label="Rate (₹)" active={sort.key === "rate"} dir={sort.dir} onToggle={() => sort.toggle("rate")} style={thStyle} align="right" />
                <SortTh label="Total Bill" active={sort.key === "total_amount"} dir={sort.dir} onToggle={() => sort.toggle("total_amount")} style={thStyle} align="right" />
                <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    Loading purchases...
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                    No purchase records found. Click "+ New Purchase Entry" to create one.
                  </td>
                </tr>
              ) : (
                sortedPurchases.map((item) => {
                  const qty = Number(item.quantity || 0);
                  const rate = Number(item.rate || 0);
                  const bill = Number(item.total_amount ?? qty * rate);
                  const displayNo = item.inward_no || item.purchase_no || "-";
                  const displayPo = item.purchase_no || "-";

                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                      <td style={tdStyle}>
                        <strong style={{ color: "#0f172a" }}>{displayPo}</strong>
                      </td>
                      <td style={tdStyle}>
                        <strong style={{ color: "#2563eb" }}>{displayNo}</strong>
                      </td>
                      <td style={tdStyle}>{fmtDate(item.purchase_date)}</td>
                      <td style={tdStyle}>
                        <strong>
                          {item.vendor_code ? `${item.vendor_code} - ` : ""}
                          {item.vendor_name}
                        </strong>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>{item.item_name}</span>
                        {item.item_code && (
                          <small style={{ display: "block", color: "#64748b", fontSize: 11 }}>
                            Code: {item.item_code}
                          </small>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{qty}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>₹ {rate.toFixed(2)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: "#0f172a" }}>
                        ₹ {bill.toFixed(2)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <button
                          onClick={() => openEditModal(item)}
                          style={{
                            background: "#f1f5f9",
                            border: "1px solid #cbd5e1",
                            padding: "4px 10px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          ✏ Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL FORM */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: 800,
              minWidth: 0,
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                background: "#0f172a",
                color: "#fff",
                padding: "16px 22px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                  {isEditing ? "Edit Purchase Inward" : "New Purchase Inward (Multi-Item)"}
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePurchase} style={{ padding: 22, overflowY: "auto", flex: 1 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <label style={labelStyle}>PO Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.po_no}
                    onChange={(e) => setFormData({ ...formData, po_no: e.target.value })}
                    style={modalInputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Purchase Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.purchase_date}
                    onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                    style={modalInputStyle}
                  />
                </div>
              </div>

              {/* VENDOR SELECTION */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Select Vendor *</label>
                <select
                  required
                  value={formData.vendor_id || ""}
                  onChange={(e) => handleVendorChange(e.target.value)}
                  style={{ ...modalInputStyle, background: "#fff" }}
                >
                  <option value="">-- Choose Vendor --</option>
                  {vendorsList.map((v) => (
                    <option key={v.id} value={String(v.id)}>
                      {v.vendor_code ? `${v.vendor_code} - ` : ""}
                      {v.business_name}
                    </option>
                  ))}
                </select>
                {gstEnabled && selectedVendor && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
                    GSTIN: <strong>{vendorGstin || "—"}</strong> &nbsp;•&nbsp; Supply:{" "}
                    <strong style={{ color: interState ? "#b45309" : "#15803d" }}>
                      {purchaseSupplyType}
                    </strong>
                  </div>
                )}
              </div>

              {/* MULTI-ITEM ROWS TABLE */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 800, color: "#2563eb" }}>
                    📦 Purchase Items List (एक साथ कई आइटम्स जोड़ें)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    style={{
                      background: "#10b981",
                      color: "#fff",
                      border: "none",
                      padding: "5px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    + Add Item Row
                  </button>
                </div>

                <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: gstEnabled ? 860 : 620, borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                        <th style={{ padding: 8, textAlign: "left" }}>Item Name *</th>
                        <th style={{ padding: 8, textAlign: "left", width: 110 }}>Inward No</th>
                        <th style={{ padding: 8, textAlign: "right", width: 80 }}>Qty *</th>
                        <th style={{ padding: 8, textAlign: "right", width: 100 }}>Rate (₹) *</th>
                        {gstEnabled && <th style={{ padding: 8, textAlign: "left", width: 100 }}>HSN/SAC</th>}
                        {gstEnabled && <th style={{ padding: 8, textAlign: "right", width: 80 }}>GST %</th>}
                        <th style={{ padding: 8, textAlign: "right", width: 110 }}>Total (₹)</th>
                        <th style={{ padding: 8, textAlign: "center", width: 50 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemRows.map((row, index) => (
                        <tr key={index} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: 8 }}>
                            <select
                              required
                              value={row.item_name}
                              onChange={(e) => handleRowItemChange(index, e.target.value)}
                              style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                            >
                              <option value="">-- Choose Item --</option>
                              {itemsList.map((it) => (
                                <option key={it.id} value={it.item_name || ""}>
                                  {it.item_code ? `[${it.item_code}] ` : ""}
                                  {it.item_name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: 8 }}>
                            {isEditing ? (
                              <input
                                type="text"
                                value={row.inward_no}
                                onChange={(e) => {
                                  const updated = [...itemRows];
                                  updated[index] = { ...updated[index], inward_no: e.target.value };
                                  setItemRows(updated);
                                }}
                                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }}
                              />
                            ) : (
                              <div
                                style={{ padding: "7px 6px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f1f5f9", fontSize: 12, color: "#2563eb", fontWeight: 700, textAlign: "center" }}
                              >
                                {row.inward_no || "-"}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: 8 }}>
                            <input
                              type="number"
                              min="1"
                              required
                              value={row.quantity}
                              onChange={(e) =>
                                handleRowQtyRateChange(index, Number(e.target.value), row.rate)
                              }
                              style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", textAlign: "right" }}
                            />
                          </td>
                          <td style={{ padding: 8 }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              value={row.rate}
                              onChange={(e) =>
                                handleRowQtyRateChange(index, row.quantity, Number(e.target.value))
                              }
                              style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", textAlign: "right" }}
                            />
                          </td>
                          {gstEnabled && (
                            <td style={{ padding: 8 }}>
                              <input
                                type="text"
                                value={row.hsn_code || ""}
                                onChange={(e) => handleRowGstChange(index, Number(row.gst_percent || 0), e.target.value)}
                                placeholder="HSN/SAC"
                                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }}
                              />
                            </td>
                          )}
                          {gstEnabled && (
                            <td style={{ padding: 8 }}>
                              <select
                                value={String(Number(row.gst_percent) || 0)}
                                onChange={(e) => handleRowGstChange(index, Number(e.target.value), row.hsn_code || "")}
                                style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", textAlign: "right" }}
                              >
                                {GST_RATES.map((r) => (
                                  <option key={r} value={r}>{r}%</option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td style={{ padding: 8, textAlign: "right", fontWeight: 800 }}>
                            ₹ {row.total_amount.toFixed(2)}
                          </td>
                          <td style={{ padding: 8, textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveItemRow(index)}
                              title={isEditing && row.id !== undefined ? "Existing row ko delete nahi kiya ja sakta" : "Remove"}
                              style={{ background: "#fee2e2", color: "#991b1b", border: "none", padding: "4px 8px", borderRadius: 4, cursor: isEditing && row.id !== undefined ? "not-allowed" : "pointer", fontSize: 11, opacity: isEditing && row.id !== undefined ? 0.4 : 1 }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {gstEnabled && (
                <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, marginBottom: 18, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                    <span style={{ color: "#475569" }}>Taxable Value</span>
                    <span>₹ {purchaseTaxTotals.taxable.toFixed(2)}</span>
                  </div>
                  {!interState ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span style={{ color: "#475569" }}>CGST (Input)</span>
                        <span>₹ {purchaseTaxTotals.cgst.toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span style={{ color: "#475569" }}>SGST (Input)</span>
                        <span>₹ {purchaseTaxTotals.sgst.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                      <span style={{ color: "#475569" }}>IGST (Input)</span>
                      <span>₹ {purchaseTaxTotals.igst.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 6 }}>
                    <span>Grand Total (incl. GST)</span>
                    <span>₹ {purchaseGrandTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Payment Mode</label>
                <select
                  value={formData.payment_mode}
                  onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })}
                  style={modalInputStyle}
                >
                  <option value="Bank / UPI">Bank / UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "none",
                    padding: "9px 16px",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    padding: "9px 22px",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {saving ? "Saving..." : "Save Inward Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const kpiBoxStyle = (background: string): React.CSSProperties => ({
  background,
  padding: "16px 18px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.05)",
});

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
};

const filterInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  marginTop: 4,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#334155",
};

export default Purchase;