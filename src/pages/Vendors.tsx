import { sc } from "../lib/company";
import { useEffect, useState, useMemo, useRef } from "react";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Vendor = {
  id: number;
  vendor_code: string;
  business_name: string;
  contact_person: string;
  mobile: string;
  address: string;
  gst_status: string;
  payment_term: string;
};

// CSV Line Parser (Handles commas inside quotes like in addresses)
const parseCSVLine = (text: string): string[] => {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ""));
  return result;
};

function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Form States
  const [vendorCode, setVendorCode] = useState("VEN-0001");
  const [businessName, setBusinessName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [gstStatus, setGstStatus] = useState("No GST");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  // Bulk CSV File State & Ref
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadVendors = async () => {
    setLoading(true);
    const { data, error } = await sc("vendors")
      .select("*")
      .order("business_name", { ascending: true });

    if (error) {
      console.error("Error loading vendors:", error);
    } else {
      const vList = (data || []) as Vendor[];
      setVendors(vList);

      if (!editingId) {
        let maxNum = 0;
        vList.forEach((v) => {
          if (v.vendor_code && v.vendor_code.startsWith("VEN-")) {
            const num = parseInt(v.vendor_code.replace("VEN-", ""), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
        setVendorCode(`VEN-${String(maxNum + 1).padStart(4, "0")}`);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      alert("Business Name is required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vendor_code: vendorCode,
        business_name: businessName.trim(),
        contact_person: contactPerson.trim() || null,
        mobile: mobile.trim() || null,
        address: address.trim() || null,
        gst_status: gstStatus,
        payment_term: paymentTerm.trim() || null,
      };

      if (editingId) {
        const { error } = await sc("vendors")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        alert("Vendor updated successfully!");
      } else {
        const { error } = await sc("vendors").insert([payload]);
        if (error) throw error;
        alert("Vendor saved successfully!");
      }

      resetForm();
      loadVendors();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setBusinessName("");
    setContactPerson("");
    setMobile("");
    setAddress("");
    setGstStatus("No GST");
    setPaymentTerm("");
    setEditingId(null);
  };

  const handleEdit = (v: Vendor) => {
    setEditingId(v.id);
    setVendorCode(v.vendor_code);
    setBusinessName(v.business_name || "");
    setContactPerson(v.contact_person || "");
    setMobile(v.mobile || "");
    setAddress(v.address || "");
    setGstStatus(v.gst_status || "No GST");
    setPaymentTerm(v.payment_term || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this vendor?")) return;
    const { error } = await sc("vendors").delete().eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message);
    } else {
      loadVendors();
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("WARNING: Delete ALL vendors?")) return;
    const { error } = await sc("vendors").delete().neq("id", 0);
    if (error) alert("Error: " + error.message);
    else loadVendors();
  };

  // Bulk Import CSV Logic
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) {
      alert("कृपया पहले एक .CSV फाइल सेलेक्ट करें।");
      return;
    }

    setSaving(true);
    const reader = new FileReader();

    reader.onerror = () => {
      alert("फाइल पढ़ने में समस्या आई!");
      setSaving(false);
    };

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          throw new Error("फाइल खाली है!");
        }

        const rows = text
          .split(/\r?\n/)
          .map((r) => r.trim())
          .filter((r) => r.length > 0);

        if (rows.length <= 1) {
          throw new Error("फाइल में हेडर के अलावा कोई डेटा नहीं मिला।");
        }

        let maxNum = 0;
        vendors.forEach((v) => {
          if (v.vendor_code && v.vendor_code.startsWith("VEN-")) {
            const num = parseInt(v.vendor_code.replace("VEN-", ""), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });

        const newVendors = rows.slice(1).map((row, idx) => {
          const cols = parseCSVLine(row);
          const nextCode = `VEN-${String(maxNum + idx + 1).padStart(4, "0")}`;
          const bName = cols[0]?.trim() || "Unknown Vendor";

          return {
            vendor_code: nextCode,
            business_name: bName,
            contact_person: cols[1]?.trim() || null,
            mobile: cols[2]?.trim() || null,
            address: cols[3]?.trim() || null,
            gst_status: cols[4]?.trim() || "No GST",
            payment_term: cols[5]?.trim() || "Cash",
          };
        });

        const { error } = await sc("vendors").insert(newVendors);
        if (error) throw error;

        alert(`सफलतापूर्वक ${newVendors.length} Vendors इम्पोर्ट हो गए!`);
        setCsvFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        await loadVendors();
      } catch (err: any) {
        alert("Import error: " + err.message);
      } finally {
        setSaving(false);
      }
    };

    reader.readAsText(csvFile);
  };

  const filteredVendors = useMemo(() => {
    const q = search.toLowerCase();
    return vendors.filter(
      (v) =>
        (v.business_name || "").toLowerCase().includes(q) ||
        (v.mobile || "").toLowerCase().includes(q) ||
        (v.contact_person || "").toLowerCase().includes(q)
    );
  }, [vendors, search]);

  const vendorCols = {
    vendor_code: (v: any) => String(v.vendor_code || ""),
    business_name: (v: any) => String(v.business_name || ""),
    contact_person: (v: any) => String(v.contact_person || ""),
    mobile: (v: any) => String(v.mobile || ""),
    gst_status: (v: any) => String(v.gst_status || ""),
    payment_term: (v: any) => String(v.payment_term || ""),
  } as const;
  const { sort, sorted: sortedVendors } = useSortedRows(filteredVendors, vendorCols, "vendor_code");

  return (
    <div className="customers-page" style={{ width: "100%" }}>
      <div className="customers-page-header" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>Vendor Master</h1>
      </div>

      {/* ADD / EDIT VENDOR BOX */}
      <div
        className="customers-table-card"
        style={{
          background: "#fff",
          padding: 20,
          marginBottom: 20,
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
          <h2 style={{ fontSize: 16, margin: 0, color: editingId ? "#d97706" : "#0f172a" }}>
            {editingId ? `Edit Vendor (${vendorCode})` : "Add Vendor"}
          </h2>
          <div style={{ display: "flex", gap: 10 }}>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{
                  background: "#64748b",
                  color: "#fff",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: "bold",
                }}
              >
                Cancel Edit
              </button>
            )}
            <button
              onClick={handleDeleteAll}
              style={{
                background: "#dc2626",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: "bold",
              }}
            >
              🗑 Delete All Vendors
            </button>
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Vendor Code</label>
              <input
                type="text"
                value={vendorCode}
                readOnly
                style={{
                  width: "100%",
                  padding: 8,
                  background: "#f1f5f9",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontWeight: "bold",
                  color: "#2563eb",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Business Name *</label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Business Name"
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Contact Person</label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="Owner / Manager"
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Mobile Number</label>
              <input
                type="text"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="Mobile No."
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>GST Status</label>
              <select
                value={gstStatus}
                onChange={(e) => setGstStatus(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              >
                <option value="No GST">No GST</option>
                <option value="GST Registered">GST Registered</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 15 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop/Office Address"
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: "bold", display: "block", marginBottom: 4 }}>Payment Term</label>
              <input
                type="text"
                value={paymentTerm}
                onChange={(e) => setPaymentTerm(e.target.value)}
                placeholder="e.g. 15 Days, Cash, 30 Days"
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", boxSizing: "border-box" }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="customer-primary-button"
            style={{
              width: "100%",
              background: editingId ? "#d97706" : "#2563eb",
              justifyContent: "center",
              padding: 10,
              fontWeight: "bold",
              borderRadius: 6,
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : editingId ? "Update Vendor Details" : "＋ Save Vendor"}
          </button>
        </form>
      </div>

      {/* BULK IMPORT CSV CARD */}
      <div
        className="customers-table-card"
        style={{
          background: "#f8fafc",
          padding: 20,
          marginBottom: 20,
          borderRadius: 14,
          border: "2px dashed #94a3b8",
        }}
      >
        <h3 style={{ fontSize: 15, margin: "0 0 6px", color: "#1e293b" }}>📂 Bulk Import Vendors via (.CSV File)</h3>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
          CSV Format: <code>Business Name, Contact Person, Mobile, Address, GST Status, Payment Term</code>
        </p>
        <form onSubmit={handleBulkImport} style={{ display: "flex", gap: 15, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            style={{ fontSize: 13, padding: "6px", background: "#fff", borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
          <button
            type="submit"
            className="customer-primary-button"
            style={{
              background: "#0284c7",
              padding: "9px 16px",
              borderRadius: 6,
              color: "#fff",
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
            }}
            disabled={saving || !csvFile}
          >
            {saving ? "Importing..." : "Upload & Import Excel Vendors"}
          </button>
        </form>
      </div>

      {/* VENDOR LIST TABLE */}
      <div
        className="customers-table-card"
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: 17, margin: 0 }}>Vendor List ({vendors.length})</h2>
          <input
            type="text"
            placeholder="Search Vendors by Name, Mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 12px", width: 280, borderRadius: 6, border: "1px solid #cbd5e1" }}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
                <SortTh label="Code" active={sort.key === "vendor_code"} dir={sort.dir} onToggle={() => sort.toggle("vendor_code")} style={{ padding: 12 }} />
                <SortTh label="Business Details" active={sort.key === "business_name"} dir={sort.dir} onToggle={() => sort.toggle("business_name")} style={{ padding: 12 }} />
                <SortTh label="Contact" active={sort.key === "contact_person"} dir={sort.dir} onToggle={() => sort.toggle("contact_person")} style={{ padding: 12 }} />
                <SortTh label="Mobile" active={sort.key === "mobile"} dir={sort.dir} onToggle={() => sort.toggle("mobile")} style={{ padding: 12 }} />
                <SortTh label="GST" active={sort.key === "gst_status"} dir={sort.dir} onToggle={() => sort.toggle("gst_status")} style={{ padding: 12 }} />
                <SortTh label="Pay Term" active={sort.key === "payment_term"} dir={sort.dir} onToggle={() => sort.toggle("payment_term")} style={{ padding: 12 }} />
                <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
                    Loading vendors...
                  </td>
                </tr>
              ) : filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>
                    No vendors found.
                  </td>
                </tr>
              ) : (
                sortedVendors.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                    <td style={{ padding: 12 }}>
                      <strong style={{ color: "#2563eb" }}>{v.vendor_code}</strong>
                    </td>
                    <td style={{ padding: 12 }}>
                      <strong>{v.business_name}</strong>
                      <br />
                      <small style={{ color: "#64748b" }}>{v.address || "—"}</small>
                    </td>
                    <td style={{ padding: 12 }}>{v.contact_person || "—"}</td>
                    <td style={{ padding: 12 }}>{v.mobile || "—"}</td>
                    <td style={{ padding: 12 }}>
                      <span
                        style={{
                          background: v.gst_status === "No GST" ? "#fef2f2" : "#ecfdf5",
                          color: v.gst_status === "No GST" ? "#dc2626" : "#166534",
                          padding: "4px 8px",
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: "bold",
                        }}
                      >
                        {v.gst_status}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>{v.payment_term || "—"}</td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          onClick={() => handleEdit(v)}
                          style={{
                            background: "#f97316",
                            color: "#fff",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          style={{
                            background: "#dc2626",
                            color: "#fff",
                            border: "none",
                            padding: "5px 10px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Delete
                        </button>
                      </div>
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

export default Vendors;