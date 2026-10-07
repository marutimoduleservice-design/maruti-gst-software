import { useEffect, useState } from "react";
import {
  getQueue,
  isOffline,
  removeOfflineEntry,
  runOfflineSync,
  subscribeOfflineQueue,
  type OfflineEntry,
} from "../lib/offlineQueue";

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function SyncBanner() {
  const [online, setOnline] = useState(() => !isOffline());
  const [entries, setEntries] = useState<OfflineEntry[]>(() => getQueue());
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState("");

  const refresh = () => {
    setEntries(getQueue());
    setOnline(!isOffline());
  };

  useEffect(() => {
    const unsubscribe = subscribeOfflineQueue(refresh);
    let cancelled = false;

    const trySync = async () => {
      if (isOffline() || getQueue().length === 0) return;
      setSyncing(true);
      const { synced, failed } = await runOfflineSync();
      if (cancelled) return;
      setSyncing(false);
      refresh();
      if (synced > 0) {
        setFlash(`✅ ${synced} pending entr${synced === 1 ? "y" : "ies"} sync ho gaye — list latest dekhne ke liye page refresh karein.`);
        window.setTimeout(() => setFlash(""), 7000);
      }
      if (failed > 0) {
        setFlash(`⚠️ ${failed} entr${failed === 1 ? "y" : "ies"} sync nahi hue — details me dekhein.`);
        window.setTimeout(() => setFlash(""), 9000);
      }
    };

    const onOnline = () => {
      setOnline(true);
      void trySync();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    refresh();
    void trySync();

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    const { synced, failed } = await runOfflineSync();
    setSyncing(false);
    refresh();
    if (synced > 0) setFlash(`✅ ${synced} entr${synced === 1 ? "y" : "ies"} sync ho gaye — list latest dekhne ke liye page refresh karein.`);
    if (failed > 0) setFlash(`⚠️ ${failed} entr${failed === 1 ? "y" : "ies"} sync nahi hue — details me dekhein.`);
    if (synced > 0 || failed > 0) window.setTimeout(() => setFlash(""), 8000);
  };

  if (online && entries.length === 0 && !flash) return null;

  const pillBase: React.CSSProperties = {
    position: "fixed",
    bottom: 14,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9999,
    borderRadius: 999,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
    cursor: entries.length > 0 ? "pointer" : "default",
    textAlign: "center",
    lineHeight: 1.35,
    maxWidth: "calc(100vw - 24px)",
  };

  return (
    <>
      {open && entries.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 64,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            width: "min(440px, calc(100vw - 20px))",
            maxHeight: "62vh",
            overflowY: "auto",
            background: "#111827",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: 14,
            padding: 14,
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b style={{ fontSize: 14 }}>⏳ Pending sync ({entries.length})</b>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 16, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          {!online && (
            <div style={{ background: "#7f1d1d", borderRadius: 8, padding: "7px 10px", marginBottom: 10, fontSize: 12 }}>
              📴 Offline hain — internet aate hi entries apne aap sync ho jayengi.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{ background: "#1f2937", borderRadius: 10, padding: "9px 11px", border: "1px solid #374151" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ color: "#fbbf24" }}>{entry.label}</b>
                  <span style={{ color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap" }}>{fmtTime(entry.created_at)}</span>
                </div>
                {entry.error && (
                  <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 5, wordBreak: "break-word" }}>
                    ⚠ {entry.error}
                  </div>
                )}
                <div style={{ marginTop: 7, display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void handleSyncNow()}
                    disabled={!online || syncing}
                    style={{
                      background: online ? "#2563eb" : "#374151",
                      color: online ? "#fff" : "#9ca3af",
                      border: "none",
                      borderRadius: 7,
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: online && !syncing ? "pointer" : "not-allowed",
                    }}
                  >
                    {syncing ? "Sync ho raha hai…" : "Retry sync"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOfflineEntry(entry.id)}
                    style={{
                      background: "none",
                      border: "1px solid #6b7280",
                      color: "#fca5a5",
                      borderRadius: 7,
                      padding: "5px 12px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {flash && (
        <div style={{ ...pillBase, background: "#16a34a", cursor: "default" }} role="status">
          {flash}
        </div>
      )}

      {!flash && !online && (
        <div style={{ ...pillBase, background: "#dc2626" }} title="Internet nahi hai — jo bhi entry save karenge wo queue me jayegi">
          📴 Offline — entries queue me save hongi{entries.length > 0 ? ` (${entries.length} pending)` : ""}
        </div>
      )}

      {!flash && online && entries.length > 0 && (
        <div style={{ ...pillBase, background: syncing ? "#2563eb" : "#d97706" }} onClick={() => setOpen((value) => !value)}>
          {syncing ? "⏳ Sync ho raha hai…" : `⏳ ${entries.length} entr${entries.length === 1 ? "y" : "ies"} pending sync — tap karein`}
        </div>
      )}
    </>
  );
}
