import { useEffect, useState } from "react";
import { sc, getCompanyId } from "../lib/company";
import { supabase } from "../lib/supabase";

type CompanyData = Record<string, any>;

const SECTIONS: { key: string; icon: string; title: string; fields: { key: string; label: string; type: string; hint?: string; options?: string[] }[] }[] = [
  {
    key: "business",
    icon: "🏢",
    title: "Business Information",
    fields: [
      { key: "business_name", label: "Business Name", type: "text", hint: "Print documents par sabse upar dikhega" },
      { key: "tagline", label: "Tagline", type: "text", hint: "e.g. Electronic Jacquard Module Service Specialist" },
      { key: "business_address", label: "Full Address", type: "textarea", hint: "Shop, building, area, city, PIN" },
      { key: "state", label: "State", type: "text" },
      { key: "state_code", label: "State Code", type: "text", hint: "Gujarat = 24" },
      { key: "phone", label: "Phone / Mobile", type: "text" },
      { key: "email", label: "Email Address", type: "text" },
      { key: "website", label: "Website", type: "text" },
    ],
  },
  {
    key: "tax",
    icon: "🧾",
    title: "Tax & Registration",
    fields: [
      { key: "tax_mode", label: "Tax Mode", type: "select", options: ["Non-GST", "Regular GST", "Composition GST"], hint: "Regular GST -> CGST/SGST/IGST + HSN, Non-GST -> simple bill" },
      { key: "gstin", label: "GSTIN Number", type: "text", hint: "15 digit GST number (Non-GST me khali rakhein)" },
      { key: "pan", label: "PAN Card Number", type: "text" },
      { key: "udyam_number", label: "Udyam (MSME) Number", type: "text" },
    ],
  },
  {
    key: "bank",
    icon: "🏦",
    title: "Bank Details",
    fields: [
      { key: "bank_account_holder", label: "Account Holder Name", type: "text" },
      { key: "bank_account_number", label: "Account Number", type: "text" },
      { key: "bank_name", label: "Bank Name", type: "text" },
      { key: "bank_ifsc", label: "IFSC Code", type: "text" },
      { key: "bank_branch", label: "Branch", type: "text" },
      { key: "upi_id", label: "UPI ID", type: "text", hint: "For QR / online payment" },
    ],
  },
  {
    key: "invoice",
    icon: "📄",
    title: "Invoicing Preferences",
    fields: [
      { key: "invoice_prefix", label: "Invoice Prefix", type: "text", hint: "Prefix jo invoice numbers me lagega" },
      { key: "invoice_start_number", label: "Invoice Start Number", type: "number" },
      { key: "financial_year_start", label: "Financial Year Starts From", type: "select", options: ["January", "April", "July", "October"] },
      { key: "signature_name", label: "Authorised Signature Name", type: "text", hint: "Name jo signature ke neeche print hoga" },
    ],
  },
  {
    key: "terms",
    icon: "📜",
    title: "PO / Sales Terms & Condition",
    fields: [
      { key: "po_terms", label: "Purchase PO — Terms & Conditions", type: "textarea", hint: "Har line ek point banegi. PO print me Amount in words ke neeche dikhega." },
      { key: "sales_terms", label: "Sales Invoice — Terms & Conditions", type: "textarea", hint: "Har line ek point banegi. Invoice print me Terms & Conditions box me dikhega." },
    ],
  },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  background: "#fff",
  color: "#0f172a",
  transition: "border-color .15s, box-shadow .15s",
  boxSizing: "border-box",
};

function MyCompanyDetails() {
  const [form, setForm] = useState<CompanyData>({});
  const [original, setOriginal] = useState<CompanyData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState("business");
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await sc("company_settings").select("*").limit(1);
      const row = data && data[0] ? data[0] : {};
      setForm(row);
      setOriginal(row);
    } catch (err: any) {
      setError("Data load nahi hua: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(original);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const payload = { ...form };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      payload.invoice_start_number = Number(payload.invoice_start_number || 1);

      if (!payload.business_name || !String(payload.business_name).trim()) {
        setError("Business Name zaroori hai — print documents me lagega.");
        setSaving(false);
        return;
      }

      const { data: existing } = await sc("company_settings").select("id").limit(1);
      if (existing && existing.length > 0) {
        const { error: upErr } = await sc("company_settings")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existing[0].id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await sc("company_settings")
          .insert({ ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        if (insErr) throw insErr;
      }

      // companies table bhi sync karo — wahi se login dropdown, invoice GST
      // calculation aur GSTIN validation padha jaata hai.
      const companySync: Record<string, any> = {
        tax_mode: payload.tax_mode,
        gstin: payload.gstin || "",
        pan: payload.pan || "",
        state_code: payload.state_code || "",
        state_name: payload.state || "",
        address: payload.business_address || "",
        phone: payload.phone || "",
        email: payload.email || "",
        website: payload.website || "",
        bank_name: payload.bank_name || "",
        bank_account_no: payload.bank_account_number || "",
        bank_ifsc: payload.bank_ifsc || "",
        upi_id: payload.upi_id || "",
        signatory: payload.signature_name || "",
      };

      const { data: companyRow } = await supabase
        .from("companies")
        .select("id")
        .eq("id", getCompanyId())
        .limit(1);

      if (companyRow && companyRow.length > 0) {
        const { error: companyErr } = await supabase
          .from("companies")
          .update(companySync)
          .eq("id", companyRow[0].id);
        if (companyErr) throw companyErr;
      }
      setOriginal(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError("Save error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const activeSectionDef = SECTIONS.find((s) => s.key === activeSection) || SECTIONS[0];

  const fieldLabel = (f: any) => f.label;
  const fieldValue = (f: any) => String(form[f.key] ?? "") ?? "";
  const fieldPlaceholder = (f: any) => f.hint || "";

  return (
    <div style={{ width: "100%" }}>
      <div className="page-title">
        <div>
          <h1>🏢 My Company Details</h1>
          <p>Company ka data jo har print document me automatically lagega</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={loadData}
            style={{
              background: "#f1f5f9",
              color: "#334155",
              border: "1px solid #cbd5e1",
              padding: "10px 18px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🔄 Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              background: saving || !hasChanges ? "#94a3b8" : "#16a34a",
              color: "#fff",
              border: "none",
              padding: "10px 22px",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 14,
              cursor: saving || !hasChanges ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {saving ? "⏳ Saving..." : saved ? "✅ Saved" : "💾 Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          ⚠️ {error}
        </div>
      )}

      {saved && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, fontWeight: 700 }}>
          ✅ Company details successfully saved! Ab ye sab print documents me use honge.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT - Section Navigation */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
          {(loading ? SECTIONS : SECTIONS).map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 18px",
                border: "none",
                borderBottom: "1px solid #f1f5f9",
                background: activeSection === s.key ? "#0f172a" : "#fff",
                color: activeSection === s.key ? "#fff" : "#334155",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 14,
                fontWeight: activeSection === s.key ? 800 : 600,
                transition: "background .15s",
              }}
            >
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <span>{s.title}</span>
              {activeSection === s.key && (
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#f59e0b" }}>●</span>
              )}
            </button>
          ))}
          <div style={{ padding: "18px 18px 6px", color: "#64748b", fontSize: 11, lineHeight: 1.6 }}>
            <strong style={{ color: "#334155" }}>💡 Note:</strong> Yeh data sab print documents me automatic lagega — Purchase PO, Sales Invoice, Payment Receipt, Payment Paid, Customer Ledger.
          </div>
        </div>

        {/* RIGHT - Form */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
          {loading ? (
            <p style={{ textAlign: "center", color: "#64748b", padding: 40 }}>Loading company details...</p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid #e2e8f0" }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                  {activeSectionDef.icon}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{activeSectionDef.title}</h2>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
                    {activeSectionDef.key === "business" && "Company ka naam, pata, contact — print header me lagega"}
                    {activeSectionDef.key === "tax" && "GST / Non-GST mode, PAN, Udyam — tax documents me lagega"}
                    {activeSectionDef.key === "bank" && "Bank account details — receipts aur vouchers me lagegi"}
                    {activeSectionDef.key === "invoice" && "Invoice numbering aur signature preferences"}
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {activeSectionDef.fields.map((f) => (
                  <div key={f.key} style={{ gridColumn: f.type === "textarea" ? "1 / -1" : undefined }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#334155", display: "block", marginBottom: 6 }}>
                      {fieldLabel(f)}
                      {f.key === "business_name" && <span style={{ color: "#dc2626" }}> *</span>}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea
                        value={fieldValue(f)}
                        onChange={(e) => updateField(f.key, e.target.value)}
                        placeholder={fieldPlaceholder(f)}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
                      />
                    ) : f.type === "select" ? (
                      <select
                        value={fieldValue(f)}
                        onChange={(e) => updateField(f.key, e.target.value)}
                        style={inputStyle}
                      >
                        {(f.options || []).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        value={fieldValue(f)}
                        onChange={(e) => updateField(f.key, e.target.value)}
                        placeholder={fieldPlaceholder(f)}
                        style={inputStyle}
                        onFocus={(e) => (e.target.style.borderColor = "#2563eb")}
                        onBlur={(e) => (e.target.style.borderColor = "#cbd5e1")}
                      />
                    )}
                    {f.hint && (
                      <span style={{ fontSize: 11, color: "#94a3b8", display: "block", marginTop: 5 }}>{f.hint}</span>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 26, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
                <button
                  onClick={() => setForm(original)}
                  disabled={!hasChanges}
                  style={{
                    background: "#fff",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    padding: "10px 20px",
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: hasChanges ? "pointer" : "not-allowed",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  style={{
                    background: saving || !hasChanges ? "#94a3b8" : "#16a34a",
                    color: "#fff",
                    border: "none",
                    padding: "10px 26px",
                    borderRadius: 10,
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: saving || !hasChanges ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {saving ? "⏳ Saving..." : "💾 Save Changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyCompanyDetails;