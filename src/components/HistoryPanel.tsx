// Shared audit history viewer — invoice ke andar, customer ke andar, ya kahin
// bhi kisi single record ki poori history dikhane ke liye.
import { useEffect, useState, type CSSProperties } from "react";
import {
  ACTION_LABELS,
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

type HistoryPanelProps = {
  entity: string;
  entityId: number;
  limit?: number;
};

function HistoryPanel({ entity, entityId, limit = 100 }: HistoryPanelProps) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAuditEntries({ entity, entityId, limit }).then(({ rows: found, error: err }) => {
      if (!alive) return;
      setRows(found);
      setError(err);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [entity, entityId, limit]);

  if (loading) {
    return <p style={{ color: "#64748b", fontSize: 13, margin: "8px 0" }}>History load ho rahi hai...</p>;
  }

  if (error) {
    return (
      <p style={{ color: "#b45309", fontSize: 13, margin: "8px 0", background: "#fffbeb", padding: "8px 10px", borderRadius: 8 }}>
        {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="customer-history-empty">
        <span>🕘</span>
        <p>Abhi tak koi badlav record nahi hua.</p>
        <small>Aage se har save / edit / delete yahan dikhega — kaun, kab, kya badla.</small>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((entry) => {
        const changes = entryChanges(entry);
        const summary = entrySummaryValues(entry);
        const style = ACTION_STYLES[entry.action];
        const expanded = expandedId === entry.id;
        return (
          <div
            key={entry.id}
            style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "8px 10px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: style.color,
                  background: style.bg,
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {ACTION_LABELS[entry.action]}
              </span>
              <span style={{ fontSize: 12, color: "#334155", fontWeight: 600 }}>
                {entry.user_name || entry.user_email || "system"}
              </span>
              <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
                {formatAuditTime(entry.created_at)}
              </span>
            </div>

            {changes.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {changes.map((change) => (
                  <div key={change.key} style={{ fontSize: 12.5, color: "#334155" }}>
                    <strong>{change.label}:</strong>{" "}
                    <span style={{ color: "#94a3b8", textDecoration: "line-through" }}>{change.from}</span>{" "}
                    <span style={{ color: "#0f172a", fontWeight: 600 }}>{change.to}</span>
                  </div>
                ))}
              </div>
            )}

            {changes.length === 0 && summary.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {summary.map((item) => (
                  <div key={item.key} style={{ fontSize: 12.5, color: "#334155" }}>
                    <strong>{item.label}:</strong> {item.to}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : entry.id)}
              style={{
                marginTop: 6,
                border: "none",
                background: "transparent",
                color: "#2563eb",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {expanded ? "Details band karein ▲" : "Poori values dekhein ▼"}
            </button>

            {expanded && (
              <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
                {entry.old_values && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", marginBottom: 3 }}>
                      {entry.action === "delete" ? "Purani value (delete se pehle)" : "Purani value"}
                    </div>
                    <pre style={jsonStyle}>{JSON.stringify(entry.old_values, null, 2)}</pre>
                  </div>
                )}
                {entry.new_values && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#15803d", marginBottom: 3 }}>
                      Nayi value
                    </div>
                    <pre style={jsonStyle}>{JSON.stringify(entry.new_values, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const jsonStyle: CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  lineHeight: 1.5,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#334155",
  overflowX: "auto",
  maxHeight: 220,
  overflowY: "auto",
};

export default HistoryPanel;
