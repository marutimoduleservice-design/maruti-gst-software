import { useState, useEffect } from "react";
import { sc } from "../lib/company";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Technician = {
  id: number;
  name: string;
  mobile: string | null;
  salary: number | null;
  status: string | null;
  share_percent?: number | null;
};

type FormState = {
  name: string;
  mobile: string;
  salary: string;
  share_percent: string;
  status: string;
};

const initialForm = (): FormState => ({
  name: "",
  mobile: "",
  salary: "",
  share_percent: "0",
  status: "Active",
});

function TechnicianMaster() {
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [form, setForm] = useState<FormState>(initialForm());

  const techCols = {
    name: (t: Technician) => String(t.name || ""),
    mobile: (t: Technician) => String(t.mobile || ""),
    salary: (t: Technician) => Number(t.salary || 0),
    share_percent: (t: Technician) => Number(t.share_percent || 0),
    status: (t: Technician) => String(t.status || "Active"),
  } as const;
  const { sort, sorted: sortedTechs } = useSortedRows(techs, techCols, "name");

  useEffect(() => {
    fetchTechs();
  }, []);

  const fetchTechs = async () => {
    setLoading(true);
    const { data, error } = await sc("technicians")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
    } else {
      setTechs(data || []);
    }
    setLoading(false);
  };

  const updateForm = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openNew = () => {
    setEditing(null);
    setForm(initialForm());
    setShowModal(true);
  };

  const openEdit = (tech: Technician) => {
    setEditing(tech);
    setForm({
      name: tech.name || "",
      mobile: tech.mobile || "",
      salary: tech.salary ? String(tech.salary) : "",
      share_percent: Number(tech.share_percent || 0) ? String(tech.share_percent) : "0",
      status: tech.status || "Active",
    });
    setShowModal(true);
  };

  const saveTechnician = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      alert("कृपया टेक्निशियन का नाम दर्ज करें।");
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      mobile: form.mobile.trim() || null,
      salary: form.salary ? Number(form.salary) : 0,
      share_percent: form.share_percent ? Number(form.share_percent) : 0,
      status: form.status,
    };

    let result;
    if (editing) {
      result = await sc("technicians")
        .update(payload)
        .eq("id", editing.id);
    } else {
      result = await sc("technicians").insert([payload]);
    }

    setSaving(false);

    if (result.error) {
      alert(`सेव नहीं हो पाया: ${result.error.message}`);
      return;
    }

    setShowModal(false);
    setEditing(null);
    setForm(initialForm());
    fetchTechs();
    alert(editing ? "Technician updated successfully." : "Technician added successfully.");
  };

  const deleteTechnician = async (tech: Technician) => {
    if (!window.confirm(`क्या आप ${tech.name} को डिलीट करना चाहते हैं?`)) return;

    const { error } = await sc("technicians")
      .delete()
      .eq("id", tech.id);

    if (error) {
      alert(`डिलिट नहीं हो पाया: ${error.message}`);
      return;
    }

    fetchTechs();
  };

  return (
    <div style={{ width: "100%" }}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "linear-gradient(135deg,#2563eb,#4f46e5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 23,
              boxShadow: "0 8px 20px rgba(37,99,235,.20)",
            }}
          >
            👨‍🔧
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#0f172a" }}>
              Technician Master
            </h1>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 14 }}>
              Manage your workforce, salaries, and performance.
            </p>
          </div>
        </div>

        <button className="customer-primary-button" onClick={openNew}>
          ＋ Add New Technician
        </button>
      </div>

      {/* TABLE SECTION */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 4px 18px rgba(15,23,42,.04)",
        }}
      >
        {loading ? (
          <div style={{ padding: 70, textAlign: "center", color: "#64748b" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            Loading Technicians...
          </div>
        ) : techs.length === 0 ? (
          <div style={{ padding: 70, textAlign: "center" }}>
            <div style={{ fontSize: 42 }}>👨‍🔧</div>
            <h3 style={{ margin: "12px 0 5px" }}>No Technicians Found</h3>
            <p style={{ color: "#64748b", marginBottom: 20 }}>Add your first technician.</p>
            <button className="customer-primary-button" onClick={openNew}>
              ＋ Add New Technician
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
<SortTh label="Technician Name" active={sort.key === "name"} dir={sort.dir} onToggle={() => sort.toggle("name")} style={thStyle} />
                <SortTh label="Mobile Number" active={sort.key === "mobile"} dir={sort.dir} onToggle={() => sort.toggle("mobile")} style={thStyle} />
                <SortTh label="Base Salary" active={sort.key === "salary"} dir={sort.dir} onToggle={() => sort.toggle("salary")} style={thStyle} align="right" />
                <SortTh label="Module Share %" active={sort.key === "share_percent"} dir={sort.dir} onToggle={() => sort.toggle("share_percent")} style={thStyle} align="right" />
                <SortTh label="Status" active={sort.key === "status"} dir={sort.dir} onToggle={() => sort.toggle("status")} style={thStyle} />
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTechs.map((tech) => (
                  <tr key={tech.id}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: "#eff6ff",
                            color: "#2563eb",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 14,
                          }}
                        >
                          {tech.name ? tech.name.charAt(0).toUpperCase() : "T"}
                        </div>
                        <strong>{tech.name}</strong>
                      </div>
                    </td>
                    <td style={tdStyle}>{tech.mobile || "-"}</td>
                    <td style={tdStyle}>
                      <strong>₹{(tech.salary || 0).toLocaleString("en-IN")}</strong>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {Number(tech.share_percent || 0) > 0 ? (
                        <span
                          style={{
                            background: "#ecfdf5", color: "#047857", padding: "3px 10px",
                            borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                          }}
                        >
                          {Number(tech.share_percent)}%
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          ...(tech.status === "Inactive"
                            ? { background: "#fee2e2", color: "#991b1b" }
                            : { background: "#dcfce7", color: "#166534" }),
                          display: "inline-flex",
                          padding: "5px 10px",
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {tech.status || "Active"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => openEdit(tech)}
                          title="Edit"
                          style={actionButton}
                        >
                          ✏
                        </button>
                        <button
                          onClick={() => deleteTechnician(tech)}
                          title="Delete"
                          style={{ ...actionButton, color: "#dc2626" }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL (ADD / EDIT) */}
      {showModal && (
        <div
          style={overlayStyle}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            {/* MODAL HEADER */}
            <div
              style={{
                padding: "22px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 21, color: "#0f172a" }}>
                {editing ? "Edit Technician" : "Add New Technician"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  width: 36,
                  height: 36,
                  border: "none",
                  borderRadius: 9,
                  background: "#f1f5f9",
                  fontSize: 23,
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                ×
              </button>
            </div>

            {/* MODAL FORM */}
            <form onSubmit={saveTechnician}>
              <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                <label style={labelStyle}>
                  <span>Full Name <span style={{ color: "#dc2626" }}>*</span></span>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => updateForm("name", e.target.value)}
                    placeholder="Enter technician name"
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  <span>Mobile Number</span>
                  <input
                    type="text"
                    value={form.mobile}
                    onChange={(e) => updateForm("mobile", e.target.value)}
                    placeholder="Enter mobile number"
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  <span>Base Salary</span>
                  <input
                    type="number"
                    min="0"
                    value={form.salary}
                    onChange={(e) => updateForm("salary", e.target.value)}
                    placeholder="Enter base salary"
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  <span>Module Service Share %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.share_percent}
                    onChange={(e) => updateForm("share_percent", e.target.value)}
                    placeholder="0"
                    style={inputStyle}
                  />
                  <small style={{ color: "#94a3b8", fontSize: 11, marginTop: 4, display: "block", lineHeight: 1.5 }}>
                    Salary report me is worker ko Module Service charge ka yahi % milta hai.
                    Total sab workers ka 100% hona chahiye.
                  </small>
                </label>

                <label style={labelStyle}>
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => updateForm("status", e.target.value)}
                    style={inputStyle}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
              </div>

              {/* MODAL FOOTER */}
              <div
                style={{
                  padding: "16px 24px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  background: "#fafafa",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: "10px 18px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    borderRadius: 9,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="customer-primary-button"
                  disabled={saving}
                >
                  {saving ? "Saving..." : editing ? "Update Technician" : "Save Technician"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// STYLES
const thStyle: React.CSSProperties = {
  padding: "13px 16px",
  textAlign: "left",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderTop: "1px solid #eef2f7",
  color: "#334155",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const actionButton: React.CSSProperties = {
  width: 31,
  height: 31,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  borderRadius: 8,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 500,
  background: "#ffffff",
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 25px 70px rgba(15,23,42,.25)",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  fontSize: 13,
  fontWeight: 700,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  outline: "none",
};

export default TechnicianMaster;