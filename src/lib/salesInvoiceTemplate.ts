import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";
import { SIGNATURE_DATA_URL } from "./signatureData";
import { fmtDate } from "./formatDate";

export { fmtDate };

/**
 * Sales Invoice printing + WhatsApp sharing ka shared logic.
 *
 * Pehle ye poora format sirf Print Center ke andar tha. Ab Invoices (Sales)
 * screen bhi isi "print center" wale format ka istemal karta hai, isliye
 * template yahan markaz me rakha gaya hai — dono jagah ek hi output.
 */

export type InvoicePrintCompany = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  state_code: string;
  udyam_number: string;
  bank_name: string;
  bank_account_holder: string;
  bank_account_number: string;
  bank_ifsc: string;
  upi_id: string;
  signature_name: string;
  website: string;
  po_terms: string;
  sales_terms: string;
};

export type WhatsAppShare = { mobile: unknown; message: string };

export const makeDefaultCompany = (): InvoicePrintCompany => ({
  name: "MARUTI MODULE SERVICE",
  tagline: "Electronic Jacquard Module Service & Repairing Specialist",
  address: "Surat, Gujarat, India",
  phone: "",
  email: "",
  gstin: "",
  pan: "",
  state_code: "24",
  udyam_number: "UDYAM-GJ-22-0603419",
  bank_name: "",
  bank_account_holder: "",
  bank_account_number: "",
  bank_ifsc: "",
  upi_id: "",
  signature_name: "Authorised Signatory",
  website: "",
  po_terms: "",
  sales_terms: "",
});

export const COMPANY_PHONE = "8849104719";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const money = (v: unknown): string =>
  `₹ ${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dueDateFromTerm = (invoiceDate: string, term: string): string => {
  const d = new Date(invoiceDate + "T00:00:00");
  if (isNaN(d.getTime())) return invoiceDate;
  const days = String(term || "").match(/(\d+)\s*Days/i);
  if (days) {
    d.setDate(d.getDate() + Number(days[1]));
  } else if (/10\s*(th|st)?\s*(of)?\s*(every\s+)?next\s*month/i.test(String(term || ""))) {
    d.setMonth(d.getMonth() + 1, 10);
  }
  return d.toISOString().slice(0, 10);
};

export const numToWords = (num: number): string => {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (num === 0) return "Zero";
  const two = (n: number): string => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : ""));
  const three = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  let str = "";
  const cr = Math.floor(num / 10000000);
  const lk = Math.floor((num % 10000000) / 100000);
  const th = Math.floor((num % 100000) / 1000);
  const re = Math.floor(num % 1000);
  if (cr) str += three(cr) + " Crore ";
  if (lk) str += three(lk) + " Lakh ";
  if (th) str += three(th) + " Thousand ";
  if (re) str += three(re);
  return str.trim();
};

/** Mobile number ko wa.me ke liye country-code (91) ke saath normalize karo. */
export const normalizeWhatsAppNumber = (raw: unknown): string => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return digits;
};

export const whatsappHref = (mobile: unknown, message: string): string => {
  const num = normalizeWhatsAppNumber(mobile);
  if (!num) return "";
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
};

/** Device mobile hai ya nahi (mobile app vs desktop app decide karne ke liye). */
const isMobileDevice = (): boolean =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Mobile/i.test(navigator.userAgent || "");

/**
 * WhatsApp chat kholo. Mobile par https://wa.me (seedha app khulti hai) aur
 * desktop par installed WhatsApp Desktop app (whatsapp://) kholne ki koshish.
 * Desktop app na mile to wa.me web par fallback ho jaata hai.
 */
const openWhatsAppChat = (num: string, message: string): void => {
  const text = encodeURIComponent(message);

  if (isMobileDevice()) {
    window.open(`https://wa.me/${num}?text=${text}`, "_blank", "noopener");
    return;
  }

  const appHref = `whatsapp://send?phone=${num}&text=${text}`;
  const webHref = `https://wa.me/${num}?text=${text}`;

  let handled = false;
  const onBlur = () => {
    handled = true;
  };

  window.addEventListener("blur", onBlur, { once: true });

  const link = document.createElement("a");
  link.href = appHref;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.removeEventListener("blur", onBlur);

    // App handle nahi hua (installed nahi) to web par bhej do.
    if (!handled) {
      window.open(webHref, "_blank", "noopener");
    }
  }, 1500);
};

/** WhatsApp chat kholo (mobile app ya desktop app). Number galat ho to false. */
export const openWhatsApp = (mobile: unknown, message: string): boolean => {
  const num = normalizeWhatsAppNumber(mobile);
  if (!num) {
    alert("Customer ka valid WhatsApp mobile number nahi mila.");
    return false;
  }
  openWhatsAppChat(num, message);
  return true;
};

export const buildSalesInvoiceWhatsAppMessage = (p: {
  customerName: string;
  invoiceNo: string;
  invoiceDate: string;
  amount: number;
  dueDate: string;
  outstanding: number;
  companyName: string;
  companyPhone: string;
}): string => {
  const inr = (v: number) =>
    Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    `Dear ${p.customerName},\n` +
    `Please find attached the sales invoice ${p.invoiceNo} dated ${p.invoiceDate} for Rs. ${inr(p.amount)}\n` +
    `Due Date: ${p.dueDate}\n` +
    `Total Outstanding Amt is : ${inr(p.outstanding)}\n` +
    `Regards, ${p.companyName} ${p.companyPhone}`
  );
};

export const PRINT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 5mm 5mm; }
  html { margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #172033; margin: 0; padding: 0; background: #f1f5f9; }
  .preview-bar { position: sticky; top: 0; z-index: 100; max-width: 820px; margin: 0 auto 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; box-shadow: 0 6px 18px rgba(15,23,42,0.25); }
  .preview-bar .p-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; }
  .preview-bar .p-btns { display: flex; gap: 8px; }
  .preview-bar button { border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .preview-bar .btn-print { background: #f59e0b; color: #0f172a; }
  .preview-bar .btn-close { background: #374151; color: #e5e7eb; }
  .preview-bar .btn-wa { background: #25D366; color: #fff; text-decoration: none; display: inline-flex; align-items: center; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .paper { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 10mm 12mm; border: 1px solid #e2e8f0; box-shadow: 0 4px 24px rgba(15,23,42,0.08); display: flex; flex-direction: column; }
  .paper .signatures { margin-top: auto; }
  @media print { body { background: #fff; padding: 0; width: 200mm; } .preview-bar { display: none !important; } .paper { width: 200mm; min-height: 287mm; overflow: visible; border: none; box-shadow: none; padding: 0; margin: 0; } body { font-size: 12px; } .paper table { font-size: 11.5px; margin: 4px 0; } .paper td, .paper th { padding: 4px 6px; line-height: 1.35; } .paper table.inv-items td { padding: 8px 6px; line-height: 1.5; font-size: 12px; } .paper .company-top { padding-bottom: 6px; margin-bottom: 6px; } .paper .company-top h1 { font-size: 20px; } .paper .company-top p { font-size: 10px; margin-top: 2px; } .paper .doc-title { font-size: 16px; margin: 8px 0 2px; } .paper .doc-band { margin-bottom: 6px; } .paper .meta-grid { margin-bottom: 8px; } .paper .party-box, .paper .info-box { padding: 8px 10px; } .paper .party-box .name { font-size: 13px; } .paper .amount-words { margin: 4px 0; padding: 6px 10px; font-size: 11px; } .paper .pay-table { margin: 4px 0; } .paper .pay-table td { padding: 3px 6px; } .paper .terms-box { font-size: 10px; padding: 6px 10px; margin: 4px 0 0; line-height: 1.4; } .paper .terms-box ol li { margin-bottom: 1px; } .paper .signatures { margin-top: auto; } .paper .signature .line { width: 130px; min-height: 20px; } }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  table, table tbody { page-break-inside: auto; }
  .company-top { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
  .company-top h1 { margin: 0; font-size: 26px; letter-spacing: 2px; color: #0f172a; font-weight: 900; }
  .company-top p { margin: 4px 0 0; font-size: 12px; color: #475569; letter-spacing: 0.5px; }
  .doc-title { text-align: center; margin: 12px 0 4px; font-size: 20px; letter-spacing: 4px; font-weight: 800; color: #1e293b; }
  .doc-band { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 18px; letter-spacing: 1px; }
  .meta-grid { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
  .party-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; flex: 1; background: #fff; }
  .party-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 700; }
  .party-box .name { font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 3px; }
  .party-box div { font-size: 12px; color: #334155; margin-top: 2px; word-wrap: break-word; overflow-wrap: break-word; }
  .party-box .addr { white-space: normal; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
  .info-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; min-width: 250px; background: #fff; }
  .info-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
  .info-row b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12.5px; }
  table.inv-items td { padding: 9px 10px; line-height: 1.5; font-size: 12.5px; }
  th { background: #f8fafc; color: #334155; padding: 9px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }
  td { border: 1px solid #d8dee9; padding: 8px 10px; color: #1e293b; }
  .tot-row td { background: #f8fafc; font-weight: 800; font-size: 13px; }
  .tot-row .grand td { background: #f8fafc; color: #0f172a; font-weight: 900; font-size: 14px; }
  .amount-words { font-size: 12px; color: #334155; margin: 10px 0; padding: 10px 12px; background: #fff; border-left: 4px solid #94a3b8; border-radius: 4px; }
  .notes { font-size: 11px; color: #64748b; margin: 14px 0; }
  .signatures { display: flex; justify-content: space-between; margin-top: 42px; }
  .signature { text-align: center; font-size: 12px; color: #475569; display: flex; flex-direction: column; align-items: center; }
  .signature .line { border-top: 1.5px solid #64748b; width: 180px; margin: auto 0 0; padding-top: 6px; font-weight: 700; color: #0f172a; min-height: 26px; }
  .signature .sig-img { max-width: 130px; height: auto; display: block; margin: 0 0 10px; }
  .signature .s-label { font-size: 10px; font-weight: 500; color: #475569; margin-top: 2px; }
  .footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; letter-spacing: 1px; }
  .badge { display: inline-block; background: #f8fafc; color: #475569; font-size: 10px; font-weight: 800; padding: 2px 10px; border-radius: 99px; letter-spacing: 1px; border: 1px solid #e2e8f0; }
  .pay-table { margin: 12px 0 4px; }
  .pay-table td { border: 1px solid #d8dee9; padding: 7px 10px; font-size: 11.5px; }
  .terms-box { margin: 12px 0 0; padding: 10px 12px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #fff; font-size: 11px; color: #475569; line-height: 1.6; }
  .terms-box ol li { margin-bottom: 3px; }
  .inv-summary { display: flex; justify-content: flex-end; margin: 10px 0; font-size: 13px; }
  .inv-summary .sum-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 18px; font-weight: 800; color: #0f172a; }
  .module-summary { display: flex; gap: 12px; margin: 10px 0; flex-wrap: wrap; }
  .module-summary > div { flex: 1; min-width: 230px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; background: #f8fafc; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .module-summary .ms-lbl { font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.6px; }
  .module-summary b { font-size: 15px; color: #0f172a; }
  .module-summary .ms-note { font-size: 10px; color: #94a3b8; }
`;

export const buildDocHtml = (
  title: string,
  body: string,
  COMPANY: InvoicePrintCompany,
  previewBar = ""
): string => `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>${PRINT_CSS}</style></head><body>
${previewBar}
<div class="paper">
  <div class="company-top">
    <h1>${esc(COMPANY.name)}</h1>
    <p>${esc(COMPANY.tagline)}</p>
    <p style="margin-top:4px;font-size:11px;color:#64748b">${esc(COMPANY.address)}</p>
    <p style="margin-top:4px;font-size:11px;color:#64748b">${[COMPANY.phone ? "Ph: " + esc(COMPANY.phone) : "", COMPANY.email ? "Email: " + esc(COMPANY.email) : "", COMPANY.website ? "Web: " + esc(COMPANY.website) : "", COMPANY.gstin ? "GSTIN: " + esc(COMPANY.gstin) : "", COMPANY.pan ? "PAN: " + esc(COMPANY.pan) : ""].filter(Boolean).join(" &nbsp;|&nbsp; ")}</p>
  </div>
  ${body}
  <div class="footer">This is a computer generated document &nbsp;•&nbsp; Generated on ${esc(new Date().toLocaleString("en-IN"))} &nbsp;•&nbsp; Thank you for your business</div>
</div>
</body></html>`;

export const openPrintWindow = (
  title: string,
  body: string,
  COMPANY: InvoicePrintCompany,
  whatsapp?: WhatsAppShare
): void => {
  const waLink = whatsapp ? whatsappHref(whatsapp.mobile, whatsapp.message) : "";
  const waButton = waLink
    ? `<a class="btn-wa" href="${esc(waLink)}" target="_blank" rel="noopener">💬 WhatsApp</a>`
    : "";
  const previewBar = `<div class="preview-bar">
  <div class="p-title">📄 ${esc(title)} — Preview</div>
  <div class="p-btns">
    ${waButton}
    <button class="btn-print" onclick="window.print()">🖨️ Print Now</button>
    <button class="btn-close" onclick="window.close()">✕ Close</button>
  </div>
</div>`;
  const html = buildDocHtml(title, body, COMPANY, previewBar);

  const printWindow = window.open("", "_blank", "width=1050,height=850");
  if (!printWindow) {
    alert("Preview window block ho gaya. Browser pop-up allow karein.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
};

/** Doc HTML ko hidden iframe me render karke PNG aur/ya PDF file banata hai. */
export async function renderDocToFiles(
  title: string,
  body: string,
  COMPANY: InvoicePrintCompany,
  opts: { png?: boolean; pdf?: boolean } = {}
): Promise<{ png?: Blob; pdf?: Blob }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "820px";
  iframe.style.height = "1200px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error("render document not available");
    idoc.open();
    idoc.write(buildDocHtml(title, body, COMPANY));
    idoc.close();

    await new Promise((r) => setTimeout(r, 250));
    const paper = idoc.querySelector(".paper") as HTMLElement | null;
    if (!paper) throw new Error("render target missing");

    await Promise.all(
      Array.from(paper.querySelectorAll("img")).map(
        (img) =>
          new Promise<void>((res) => {
            if (img.complete) return res();
            img.onload = () => res();
            img.onerror = () => res();
          })
      )
    );

    const width = paper.offsetWidth;
    const height = paper.scrollHeight;
    const dataUrl = await toPng(paper, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width,
      height,
      skipFonts: true,
    });

    const result: { png?: Blob; pdf?: Blob } = {};
    if (opts.png) result.png = await (await fetch(dataUrl)).blob();

    if (opts.pdf) {
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = 210;
      const pageH = 297;
      const imgH = (height * pageW) / width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(dataUrl, "PNG", 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 1) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(dataUrl, "PNG", 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      result.pdf = pdf.output("blob");
    }
    return result;
  } finally {
    document.body.removeChild(iframe);
  }
}

export type ShareResult = "shared" | "downloaded" | "cancelled" | "no-number";

/**
 * File ko WhatsApp par bhejo. Mobile/Web-Share support ho to file directly
 * attach ho kar share sheet khulti hai; warna file download karke WhatsApp
 * chat text ke saath kholta hai (user file manually attach kare).
 */
export async function shareFileToWhatsApp(p: {
  mobile: unknown;
  message: string;
  filename: string;
  blob: Blob;
}): Promise<ShareResult> {
  const file = new File([p.blob], p.filename, { type: p.blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & {
    canShare?: (data: unknown) => boolean;
    share?: (data: unknown) => Promise<void>;
  };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: p.message, title: p.filename });
      return "shared";
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(p.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = p.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  const num = normalizeWhatsAppNumber(p.mobile);
  if (!num) return "no-number";
  openWhatsAppChat(num, p.message);
  return "downloaded";
}

export const buildOutstandingWhatsAppMessage = (p: {
  customerName: string;
  outstanding: number;
  companyName: string;
  companyPhone: string;
}): string => {
  const inr = (v: number) =>
    Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    `Dear ${p.customerName},\n` +
    `Your pending outstanding with ${p.companyName} is Rs. ${inr(p.outstanding)}.\n` +
    `Please find the attached outstanding statement for your reference.\n` +
    `Kindly clear the due amount at your earliest.\n` +
    `Regards, ${p.companyName} ${p.companyPhone}`
  );
};

export const buildSalesInvoiceBody = async (params: {
  invoice: any;
  customer: any;
  items: any[];
  receivedAmount?: number;
  COMPANY: InvoicePrintCompany;
}): Promise<string> => {
  const { invoice: inv, customer, items, COMPANY } = params;
  const total = items.length
    ? items.reduce((s, it) => s + (Number(it.total) || Number(it.quantity || 0) * Number(it.rate || 0)), 0)
    : Number(inv.total_amount) || 0;
  let qrDataUrl = "";
  if (COMPANY.upi_id) {
    const upiLink = `upi://pay?pa=${encodeURIComponent(COMPANY.upi_id)}&pn=${encodeURIComponent(COMPANY.bank_account_holder || COMPANY.name)}&am=${total.toFixed(2)}&cu=INR`;
    try {
      qrDataUrl = await QRCode.toDataURL(upiLink, { width: 216, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
    } catch {
      qrDataUrl = "";
    }
  }
  const mergedItems: { item_name: string; quantity: number; rate: number; total: number }[] = [];
  const mergeIndex = new Map<string, number>();
  items.forEach((it: any) => {
    const key = String(it.item_name || "-").trim().toLowerCase();
    const qty = Number(it.quantity) || 0;
    const amt = Number(it.total) || qty * (Number(it.rate) || 0);
    const at = mergeIndex.get(key);
    if (at === undefined) {
      mergeIndex.set(key, mergedItems.length);
      mergedItems.push({ item_name: String(it.item_name || "-"), quantity: qty, rate: 0, total: amt });
    } else {
      mergedItems[at].quantity += qty;
      mergedItems[at].total += amt;
    }
  });
  mergedItems.forEach((g) => { g.rate = g.quantity > 0 ? g.total / g.quantity : 0; });
  const itemRows = mergedItems.length
    ? mergedItems.map((it, i: number) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.item_name || "-")}</td>
        <td class="c">${it.quantity}</td>
        <td class="r">${money(it.rate)}</td>
        <td class="r">${money(it.total)}</td>
      </tr>`).join("")
    : `<tr>
        <td class="c">1</td>
        <td>Module Service & Spare Parts</td>
        <td class="c">1</td>
        <td class="r">${money(total)}</td>
        <td class="r">${money(total)}</td>
      </tr>`;
  const nameOf = (it: any) => String(it.item_name || "").toLowerCase();
  const qtyOf = (it: any) => Number(it.quantity) || 0;
  const sumQty = (match: (n: string) => boolean) =>
    items.filter((it: any) => match(nameOf(it))).reduce((s, it: any) => s + qtyOf(it), 0);
  const moduleQty = sumQty((n) => n.includes("module service"));
  const totalModules =
    moduleQty +
    sumQty((n) => n.includes("warranty service")) +
    sumQty((n) => n.includes("warranty ok")) +
    sumQty((n) => n.includes("reject module"));
  const perModule = moduleQty > 0 ? total / moduleQty : 0;
  const moduleSummary = totalModules > 0
    ? `<div class="module-summary">
    <div><span class="ms-lbl">Total Module / Card</span><b>${totalModules.toFixed(2)}</b><span class="ms-note">Module Service + Warranty Service + Reject Module</span></div>
    <div><span class="ms-lbl">Per Module / Ciel Card</span><b>${money(perModule)}</b><span class="ms-note">Grand Total / Module Service Qty</span></div>
  </div>`
    : "";
  const receivedForInv = Number(params.receivedAmount || 0);
  const invStatus = receivedForInv >= total && total > 0 ? "Paid" : "Pending";
  const payTerm = customer?.payment_term || "Cash";
  const dueDate = dueDateFromTerm(String(inv.invoice_date || ""), payTerm);
  const salesTerms = COMPANY.sales_terms ? COMPANY.sales_terms.split(/\n+/).map((t) => `<li>${esc(t.trim())}</li>`).join("") : "";
  const terms = COMPANY.sales_terms
    ? `<ol style="margin:4px 0 0 16px;padding:0">${salesTerms}</ol>`
    : `<ol style="margin:4px 0 0 16px;padding:0">
  <li>3-month standard module service warranty (labor only). Any replacement parts will incur material charges. Condition: Warranty applies only if a new upper cord is installed.</li>
  <li>Premium Service Includes 1 Year Warranty. All Upper Cords And Iron Hooks Are Replaced With New Parts During Service.</li>
  <li>Warranty Does Not Cover Physical Damage, Water Damage, Power Surges, Mishandling.</li>
  <li>This is a non-GST invoice. Goods once sold will not take back. MSME/Udyam Registration No. ${esc(COMPANY.udyam_number)}</li>
</ol>`;
  return `
  <div class="doc-title">INVOICE</div>
  <div class="doc-band">${esc(String(inv.invoice_no || ""))} &nbsp;•&nbsp; ${esc(fmtDate(inv.invoice_date))}</div>
  <div class="meta-grid">
    <div class="party-box">
      <div class="lbl">Billed To</div>
      <div class="name">${esc(customer?.business_name || customer?.customer_name || "Walk-in Customer")}</div>
      <div>${customer?.business_address || customer?.address ? esc(customer.business_address || customer.address) : ""}</div>
      <div>${customer?.mobile ? "Mobile: " + esc(customer.mobile) : ""}</div>
      <div>${esc(payTerm) !== "Cash" ? "Payment Terms: " + esc(payTerm) : ""}</div>
    </div>
    <div class="info-box">
      <div class="info-row"><span>Invoice No</span><b>${esc(inv.invoice_no || "-")}</b></div>
      <div class="info-row"><span>Invoice Date</span><b>${esc(fmtDate(inv.invoice_date))}</b></div>
      <div class="info-row"><span>Payment Status</span><b style="color:${invStatus === "Paid" ? "#15803d" : "#dc2626"}">${esc(invStatus)}</b></div>
      <div class="info-row"><span>Due Date</span><b>${/10\s*(th|st)?\s*(of)?\s*(every\s+)?next\s*month/i.test(payTerm) ? "Date 10th Of Next Month" : esc(fmtDate(dueDate))}</b></div>
      <div class="info-row"><span>Total Amount</span><b>${money(total)}</b></div>
    </div>
  </div>
  <table class="inv-items">
    <thead><tr><th class="c" style="width:44px">#</th><th>Item Description</th><th class="c" style="width:60px">Qty</th><th class="r" style="width:100px">Rate (₹)</th><th class="r" style="width:110px">Amount (₹)</th></tr></thead>
    <tbody>${itemRows}</tbody>
    <tr class="tot-row"><td colspan="4" style="text-align:right">Grand Total</td><td class="r">${money(total)}</td></tr>
  </table>
  ${moduleSummary}
  <div class="amount-words"><b>Amount In Words:</b> ${numToWords(Math.round(total))} Rupees Only</div>
  <table class="pay-table">
    <tr class="tot-row"><td class="r" style="text-align:left;background:#f8fafc" colspan="5"><b>Payment Details — For ${esc(COMPANY.bank_account_holder || COMPANY.name)}</b></td></tr>
    <tr><td>Account Name</td><td><b>${esc(COMPANY.bank_account_holder || COMPANY.name)}</b></td><td>Account No.</td><td><b>${esc(COMPANY.bank_account_number || "")}</b></td></tr>
    <tr><td>Bank Name</td><td><b>${esc(COMPANY.bank_name || "")}</b></td><td>IFSC No.</td><td><b>${esc(COMPANY.bank_ifsc || "")}</b></td></tr>
    <tr><td>G-Pay / UPI</td><td><b>${esc(COMPANY.upi_id || "")}</b></td><td></td><td></td></tr>
  </table>
  <div style="display:flex;gap:16px;align-items:stretch">
    <div style="flex:1;display:flex">
      <div class="terms-box" style="flex:1;display:flex;flex-direction:column;justify-content:center;margin:0"><b style="font-size:12px;margin-bottom:4px">Terms &amp; Conditions:</b>${terms}</div>
    </div>
    <div style="text-align:center;padding:12px 14px;border:1px solid #cbd5e1;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:140px">
      <img src="${qrDataUrl}" alt="Scan to Pay" style="width:110px;height:110px;border-radius:6px"/>
      <div style="font-size:10px;margin-top:6px;color:#475569;font-weight:700">Scan to Pay</div>
    </div>
  </div>
  <div class="signatures">
    <div class="signature"><div class="line">Receiver's Signature</div></div>
    <div class="signature"><img class="sig-img" src="${SIGNATURE_DATA_URL}" alt="s"/><div class="line">${esc(COMPANY.signature_name)}</div></div>
  </div>`;
};
