/**
 * Stock valuation ke liye shared logic.
 *
 * Ye wahi algorithm hai jo Stock Report page use karta hai, taaki Dashboard ka
 * "Stock Value" aur Stock Report ka "Total Stock Value" hamesha ek jaisa aaye.
 *
 * Rule: har inward batch ko alag track kiya jaata hai. Sale (outward) batch ke
 * qty aur value dono ko proportionally kam karta hai. Jo qty batch se nahi kat
 * paati wo opening stock se kati jaati hai.
 */

export type StockValuationItem = {
  id: number;
  item_name: string | null;
  item_code?: string | null;
  purchase_price?: number | null;
  cost_price?: number | null;
  opening_stock?: number | null;
};

export type StockValuationPurchase = {
  inward_no?: string | null;
  purchase_no?: string | null;
  item_name?: string | null;
  item_code?: string | null;
  quantity?: number | null;
  rate?: number | null;
};

export type StockValuationLine = {
  inward_no?: string | null;
  item_name?: string | null;
  item_code?: string | null;
  quantity?: number | null;
};

export type StockValuationJob = {
  repairing_qty?: number | null;
  repair_qty?: number | null;
  repairing_quantity?: number | null;
  warranty_qty?: number | null;
  warranty_quantity?: number | null;
  reject_qty?: number | null;
  reject_quantity?: number | null;
};

export type StockValuationRow = {
  itemId: number;
  itemName: string;
  openingQty: number;
  inwardQty: number;
  outwardQty: number;
  currentStock: number;
  stockValue: number;
};

const SERVICE_ITEM_NAMES = ["module service", "warranty service", "reject module"];

const isServiceItem = (name?: string | null) => {
  const lower = String(name || "").toLowerCase();
  return SERVICE_ITEM_NAMES.some((service) => lower.includes(service));
};

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function computeStockValuation(data: {
  items: StockValuationItem[];
  purchases: StockValuationPurchase[];
  lines: StockValuationLine[];
  jobs: StockValuationJob[];
}): StockValuationRow[] {
  const { items, purchases, lines, jobs } = data;

  const findItem = (name?: string | null, code?: string | null) => {
    const cleanName = String(name || "").trim().toLowerCase();
    const cleanCode = String(code || "").trim().toLowerCase();
    return items.find((item) => {
      const itemName = String(item.item_name || "").trim().toLowerCase();
      const itemCode = String(item.item_code || "").trim().toLowerCase();
      if (cleanCode && itemCode && cleanCode === itemCode) return true;
      if (cleanName && itemName && cleanName === itemName) return true;
      return false;
    });
  };

  interface InwardEntry { qty: number; rate: number; value: number }
  const inwardMap: Record<string, InwardEntry> = {};
  const inwardByItemId: Record<number, number> = {};
  const outwardByItemId: Record<number, number> = {};
  const inwardKey = (inwardNo: string, itemId: number) => `${String(inwardNo).trim().toLowerCase()}|${itemId}`;

  // Purchases = INWARD
  purchases.forEach((purchase) => {
    const qty = num(purchase.quantity);
    const rate = num(purchase.rate);
    const matched = findItem(purchase.item_name, purchase.item_code);
    const inwardNo = String(purchase.inward_no || purchase.purchase_no || "").trim();
    if (!matched || !inwardNo) return;
    const key = inwardKey(inwardNo, matched.id);
    const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
    inwardMap[key] = {
      qty: prev.qty + qty,
      rate: rate > 0 ? rate : prev.rate,
      value: prev.value + qty * rate,
    };
    inwardByItemId[matched.id] = (inwardByItemId[matched.id] || 0) + qty;
  });

  // Job Card se module/warranty/reject INWARD hota hai (service items, value me nahi ginte)
  const moduleServiceItem = findItem("Module Service");
  const warrantyServiceItem = findItem("Warranty Service");
  const rejectModuleItem = findItem("Reject Module");

  jobs.forEach((job) => {
    const serviceRows = [
      [moduleServiceItem, job.repairing_qty ?? job.repair_qty ?? job.repairing_quantity, "JOB-REP", 50],
      [warrantyServiceItem, job.warranty_qty ?? job.warranty_quantity, "JOB-WAR", 0],
      [rejectModuleItem, job.reject_qty ?? job.reject_quantity, "JOB-REJ", 0],
    ] as const;

    serviceRows.forEach(([item, quantity, jobInward, hardFallback]) => {
      const qty = num(quantity);
      if (!item || qty <= 0) return;
      const key = inwardKey(jobInward, item.id);
      const prev = inwardMap[key] || { qty: 0, rate: 0, value: 0 };
      const rate = prev.rate || num(item.purchase_price) || hardFallback;
      inwardMap[key] = { qty: prev.qty + qty, rate, value: prev.value + qty * rate };
      inwardByItemId[item.id] = (inwardByItemId[item.id] || 0) + qty;
    });
  });

  // Sales = OUTWARD. Batch ka qty aur value dono proportionally kam hota hai.
  lines.forEach((line) => {
    const qty = num(line.quantity);
    const matched = findItem(line.item_name, line.item_code);
    const inwardNo = String(line.inward_no || "").trim();
    if (!matched) return;
    outwardByItemId[matched.id] = (outwardByItemId[matched.id] || 0) + qty;
    if (inwardNo && !inwardNo.startsWith("JOB-")) {
      const key = inwardKey(inwardNo, matched.id);
      if (inwardMap[key]) {
        const entry = inwardMap[key];
        const before = entry.qty;
        const sold = Math.min(qty, before);
        entry.qty = Math.max(0, before - sold);
        entry.value = before > 0 ? entry.value * (entry.qty / before) : 0;
      }
    }
  });

  return items.map((item) => {
    const opening = num(item.opening_stock);
    const inward = inwardByItemId[item.id] || 0;
    const outward = outwardByItemId[item.id] || 0;
    const currentStock = opening + inward - outward;

    let stockValue = 0;
    if (!isServiceItem(item.item_name)) {
      const entries = Object.entries(inwardMap).filter(([key]) => key.endsWith(`|${item.id}`));
      let batchQtyLeft = 0;
      for (const [, entry] of entries) {
        batchQtyLeft += Math.max(0, num(entry.qty));
        stockValue += Math.max(0, num(entry.value));
      }
      // Jo qty batch se nahi kat payi, wo opening stock se kati.
      const remainingOpening = Math.max(0, currentStock - batchQtyLeft);
      const openingRate = num(item.purchase_price) || num(item.cost_price);
      stockValue += remainingOpening * openingRate;
    }

    return {
      itemId: item.id,
      itemName: String(item.item_name || ""),
      openingQty: opening,
      inwardQty: inward,
      outwardQty: outward,
      currentStock,
      stockValue,
    };
  });
}

/** Poore stock ka total value nikalta hai. */
export function computeStockValue(data: {
  items: StockValuationItem[];
  purchases: StockValuationPurchase[];
  lines: StockValuationLine[];
  jobs: StockValuationJob[];
}): number {
  return computeStockValuation(data).reduce((sum, row) => sum + row.stockValue, 0);
}