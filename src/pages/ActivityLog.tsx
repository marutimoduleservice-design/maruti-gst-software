// Activity Log — Audit Trail ki poori list.
// Har save / edit / delete DB trigger se audit_log me aata hai; yahan sirf
// padhna + filter karna hai. Sirf Admin (Owner) aur Auditor ke liye.
import { useEffect, useMemo, useState } from "react";
import {
  ACTION_LABELS,
  AUDIT_ENTITIES,
  entryChanges,
  entrySummaryValues,
  fetchAuditEntries,
  formatAuditTime,
  type AuditEntry,
} from "../lib/auditLog";

const ACTION_STYLES: Record<AuditEntry["action"], { color: string; bg: string }> = {
  create: { color: "#15803d", bg: "#dcfce7" },
  update: { color: "#1d4ed8", bg: "#dbeafe" },
  delete: { color: "#b91c1c", bg: "#fee2e2" },
};

function ActivityLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("All");
  const [actionFilter, setActionFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const { rows: found, error: err } = await fetchAuditEntries({ limit: 300 });
    setRows(found);
    setError(err);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((entry) => {
      if (entityFilter !== "All" && entry.entity !== entityFilter) return false;
      if (actionFilter !== "All" && entry.action !== actionFilter.toLowerCase()) return false;
      if (!term) return true;
      const haystack = [
        entry.entity,
        entry.entity_label || "",
        entry.user_name || "",
        entry.user_email || "",
        ...(entry.changed_fields || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [rows, entityFilter, actionFilter, search]);

  const hasFilters = entityFilter !== "All" || actionFilter !== "All" || search.trim() !== "";

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Activity Log</h1>
          <p>
            Audit trail — kaun, kab, kya badla. {rows.length > 0 ? `Recent ${rows.length} changes.` : ""}
          </p>
        </div>
        <button className="primary-button" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#92400e",
            padding: "12px 16px",
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

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
          placeholder="Search record, user, field..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 13,
            minWidth: 260,
            outline: "none",
            background: "#fff",
          }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="All">All Screens</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="All">All Actions</option>
            <option value="create">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Deleted</option>
          </select>

          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setEntityFilter("All");
                setActionFilter("All");
              }}
              style={{
                background: "#e2e8f0",
                color: "#334155",
                border: "none",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
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
                <th style={thStyle}>When</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Screen</th>
                <th style={thStyle}>Record</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>What changed</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td style={tdStyle} colSpan={6}>
                    Loading...
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, color: "#64748b" }} colSpan={6}>
                    {rows.length === 0
                      ? "Abhi tak koi activity record nahi hui. Invoice / customer / purchase save karte hi entries yahan aayengi."
                      : "Is filter me kuch nahi mila."}
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((entry) => {
                  const changes = entryChanges(entry);
                  const summary = entrySummaryValues(entry);
                  const style = ACTION_STYLES[entry.action];
                  const expanded = expandedId === entry.id;
                  return (
                    <RowGroup key={entry.id}>
                      <tr
                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                        style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                      >
                        <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 12.5 }}>
                          {formatAuditTime(entry.created_at)}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12.5 }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>
                            {entry.user_name || entry.user_email || "system"}
                          </div>
                          {entry.user_email && entry.user_name && (
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{entry.user_email}</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12.5, whiteSpace: "nowrap" }}>{entry.entity}</td>
                        <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: 600, color: "#0f172a" }}>
                          {entry.entity_label || (entry.entity_id ? `#${entry.entity_id}` : "—")}
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: style.color,
                              background: style.bg,
                              padding: "2px 8px",
                              borderRadius: 999,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ACTION_LABELS[entry.action]}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12.5, minWidth: 240 }}>
                          {changes.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {changes.slice(0, 3).map((change) => (
                                <div key={change.key}>
                                  <strong>{change.label}:</strong>{" "}
                                  <span style={{ color: "#94a3b8", textDecoration: "line-through" }}>
                                    {change.from}
                                  </span>{" "}
                                  <span style={{ fontWeight: 600 }}>{change.to}</span>
                                </div>
                              ))}
                              {changes.length > 3 && (
                                <div style={{ color: "#64748b", fontSize: 11.5 }}>+{changes.length - 3} aur</div>
                              )}
                            </div>
                          ) : entry.action === "create" ? (
                            <span style={{ color: "#64748b" }}>
                              {summary.length > 0
                                ? summary.map((s) => `${s.label}: ${s.to}`).join(", ")
                                : "Naya record banaya"}
                            </span>
                          ) : entry.action === "delete" ? (
                            <span style={{ color: "#b91c1c" }}>
                              {summary.length > 0
                                ? summary.map((s) => `${s.label}: ${s.to}`).join(", ")
                                : "Record delete hua — purani values ▼"}
                            </span>
                          ) : (
                            <span style={{ color: "#64748b" }}>—</span>
                          )}
                          <div style={{ marginTop: 4, fontSize: 11, color: "#2563eb", fontWeight: 600 }}>
                            {expanded ? "Details band ▲" : "Poori values ▼"}
                          </div>
                        </td>
                      </tr>

                      {expanded && (
                        <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                          <td colSpan={6} style={{ ...tdStyle, padding: "14px 18px" }}>
                            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                              {entry.old_values && (
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: "#b91c1c", marginBottom: 4 }}>
                                    {entry.action === "delete" ? "Purani VALUE (delete se pehle)" : "Purani value"}
                                  </div>
                                  <pre style={jsonStyle}>{JSON.stringify(entry.old_values, null, 2)}</pre>
                                </div>
                              )}
                              {entry.new_values && (
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", marginBottom: 4 }}>
                                    {entry.action === "create" ? "Nayi value (banate waqt)" : "Nayi value"}
                                  </div>
                                  <pre style={jsonStyle}>{JSON.stringify(entry.new_values, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </RowGroup>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
        Records DB trigger se aate hain (koi screen bhool jaye bhi log nahi tootega). Sirf recent 300
        changes dikhte hain. RLS: sirf Admin aur Auditor padh sakte hain.
      </p>
    </>
  );
}

// Fragment chahiye kyunke expanded row bhi same tbody me honi chahiye.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
  verticalAlign: "top",
};

const filterSelectStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const jsonStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  lineHeight: 1.5,
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#334155",
  overflowX: "auto",
  maxHeight: 240,
  overflowY: "auto",
};

export default ActivityLog;
