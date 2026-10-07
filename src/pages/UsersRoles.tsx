import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { sc } from "../lib/company";
import { ROLE_OPTIONS, roleLabel, type AppUser, type StaffRole } from "../lib/roles";

type Technician = { id: number; name: string };

type LoginEvent = {
  id: number;
  auth_user_id: string | null;
  email: string | null;
  full_name: string | null;
  role: string | null;
  user_agent: string | null;
  logged_in_at: string;
};

// Sirf label ke liye — naya Supabase auth session IS page ka admin
// session kabhi replace na kare, isliye alag (non-persistent) client.
function signUpClient() {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
}

function shortBrowser(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} • ${os}` : browser;
}

const ROLE_INFO: { role: StaffRole; info: string }[] = [
  { role: "admin", info: "Sab kuch — users, salary, masters, settings." },
  { role: "accountant", info: "Invoice, payment, purchase, expense, reports. Masters/Item/Salary nahi." },
  { role: "store", info: "Purchase, Item Master, stock reports, label print." },
  { role: "technician", info: "Sirf Module Repair — sirf apne assign kiye job cards." },
  { role: "auditor", info: "Sirf reports dekhne ke liye (read only). Salary report nahi." },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  boxSizing: "border-box",
  fontSize: 14,
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  display: "block",
  marginBottom: 4,
  color: "#334155",
};

const btnStyle = (background: string): React.CSSProperties => ({
  background,
  color: "#fff",
  border: "none",
  padding: "9px 16px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
});

function UsersRoles({ currentUid }: { currentUid: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("accountant");
  const [techId, setTechId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [formErr, setFormErr] = useState("");

  const load = async () => {
    setLoading(true);
    const [usersRes, techRes, eventsRes] = await Promise.all([
      sc("app_users").select("*").order("id", { ascending: true }),
      sc("technicians").select("id, name").order("name", { ascending: true }),
      sc("login_events").select("*").order("logged_in_at", { ascending: false }).limit(50),
    ]);
    if (usersRes.error) console.warn("app_users load nahi hua (migration chahiye?):", usersRes.error.message);
    if (techRes.error) console.warn("technicians load nahi hua:", techRes.error.message);
    if (eventsRes.error) console.warn("login_events load nahi hua (migration chahiye?):", eventsRes.error.message);
    setUsers((usersRes.data || []) as AppUser[]);
    setTechnicians((techRes.data || []) as Technician[]);
    setEvents((eventsRes.data || []) as LoginEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("accountant");
    setTechId("");
    setFormMsg("");
    setFormErr("");
  };

  const validateForm = () => {
    const mail = email.trim().toLowerCase();
    if (!mail || !mail.includes("@")) {
      setFormErr("Sahi email enter karein.");
      return null;
    }
    if (mode === "new" && password.length < 6) {
      setFormErr("Password kam se kam 6 characters ka hona chahiye.");
      return null;
    }
    if (users.some((u) => u.email.toLowerCase() === mail)) {
      setFormErr("Is email ka profile pehle se hai — table me uska role badal dein.");
      return null;
    }
    return mail;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    setFormErr("");
    const mail = validateForm();
    if (!mail) return;

    setSaving(true);
    try {
      let authUserId: string | null = null;

      if (mode === "new") {
        const { data, error: signupErr } = await signUpClient().auth.signUp({
          email: mail,
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (signupErr) {
          const m = signupErr.message.toLowerCase();
          if (m.includes("already") || m.includes("exist")) {
            setFormErr("Ye email pehle se registered hai. 'Existing email' mode me jakar usse role dein.");
          } else if (m.includes("signup") || m.includes("sign up")) {
            setFormErr("Supabase me signups band hain. Dashboard > Authentication > Providers > Email me 'Enable signups' on karein, ya 'Existing email' mode use karein.");
          } else {
            setFormErr(signupErr.message);
          }
          return;
        }
        authUserId = data.user?.id ?? null;
      }

      const { error: insertErr } = await sc("app_users").insert({
        auth_user_id: authUserId,
        email: mail,
        full_name: fullName.trim() || mail.split("@")[0],
        role,
        technician_id: role === "technician" && techId !== "" ? Number(techId) : null,
      });

      if (insertErr) {
        if (String(insertErr.code) === "23505") {
          setFormErr("Is email ka profile pehle se hai — table me uska role badal dein.");
        } else {
          setFormErr(
            mode === "new"
              ? `Login ban gaya, par profile save nahi hua: ${insertErr.message}. 'Existing email' mode se ye email assign karein.`
              : insertErr.message
          );
        }
        return;
      }

      setFormMsg(
        mode === "new"
          ? `${mail} ka login aur role dono ban gaye. Wo isi email/password se login kar sakta hai.`
          : `${mail} ko role "${roleLabel(role)}" de diya. (Login isi email ke existing password se hoga.)`
      );
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const updateRow = async (id: number, patch: Partial<AppUser>, okMsg?: string) => {
    const { error } = await sc("app_users").update(patch).eq("id", id);
    if (error) {
      alert("Update fail: " + error.message);
      return;
    }
    if (okMsg) alert(okMsg);
    await load();
  };

  const deleteRow = async (u: AppUser) => {
    if (!window.confirm(`${u.email} ka profile delete karein? (Login access alag se bhi band karna ho to Active OFF karein.)`)) return;
    const { error } = await sc("app_users").delete().eq("id", u.id);
    if (error) {
      alert("Delete fail: " + error.message);
      return;
    }
    await load();
  };

  const selfId = users.find((u) => u.auth_user_id && u.auth_user_id === currentUid)?.id;

  return (
    <div className="customers-page" style={{ width: "100%" }}>
      <div className="customers-page-header" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: 0 }}>Users & Roles</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Users banayein, role assign karein aur login history dekhein.</p>
        </div>
        <button className="primary-button" onClick={load}>⟳ Refresh</button>
      </div>

      {loading ? (
        <div className="empty-state"><div>⏳</div><h3>Loading...</h3></div>
      ) : (
        <>
          {/* CREATE USER */}
          <div style={{ background: "#fff", padding: 20, marginBottom: 20, borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ fontSize: 16, margin: 0, color: "#0f172a" }}>Add User</h2>
              <div style={{ display: "flex", gap: 6, background: "#f1f5f9", padding: 4, borderRadius: 8 }}>
                <button type="button" onClick={() => { setMode("new"); resetForm(); }} style={{ ...btnStyle(mode === "new" ? "#0B5ED7" : "transparent"), color: mode === "new" ? "#fff" : "#475569", padding: "6px 12px" }}>
                  Naya user banayein
                </button>
                <button type="button" onClick={() => { setMode("existing"); resetForm(); }} style={{ ...btnStyle(mode === "existing" ? "#0B5ED7" : "transparent"), color: mode === "existing" ? "#fff" : "#475569", padding: "6px 12px" }}>
                  Existing email ko role dein
                </button>
              </div>
            </div>

            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>
              {mode === "new"
                ? "Naya login banta hai (email + password) aur saath me role assign hota hai. Password user ko baad me khud change kar sakta hai."
                : "Agar email ka login pehle se exist karta hai (jaise pehle se koi login kar chuka hai), to sirf role assign karein — password badlega nahi."}
            </p>

            <form onSubmit={handleCreate}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Rahul Sharma" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" style={inputStyle} />
                </div>
                {mode === "new" && (
                  <div>
                    <label style={labelStyle}>Password * (min 6)</label>
                    <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Role *</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} style={inputStyle}>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {role === "technician" && (
                  <div>
                    <label style={labelStyle}>Technician Link</label>
                    <select value={techId} onChange={(e) => setTechId(e.target.value ? Number(e.target.value) : "")} style={inputStyle}>
                      <option value="">— Select technician —</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {formErr && <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 10px" }}>{formErr}</p>}
              {formMsg && <p style={{ color: "#16a34a", fontSize: 13, margin: "0 0 10px" }}>{formMsg}</p>}

              <button type="submit" disabled={saving} style={btnStyle(saving ? "#94a3b8" : "#16a34a")}>
                {saving ? "Saving..." : mode === "new" ? "+ Create User" : "Assign Role"}
              </button>
            </form>
          </div>

          {/* USERS TABLE */}
          <div style={{ background: "#fff", padding: 20, marginBottom: 20, borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
            <h2 style={{ fontSize: 16, margin: "0 0 6px", color: "#0f172a" }}>Users ({users.length})</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>
              Role badalne par user ko next login/app refresh par naya menu dikhega. Active OFF = user app me blocked ho jayega.
            </p>
            {users.length === 0 ? (
              <div className="empty-state"><div>👥</div><h3>Koi user nahi mila</h3><p>Migration chala hai to ye list khali nahi honi chahiye.</p></div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Technician Link</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.id === selfId;
                      return (
                        <tr key={u.id}>
                          <td><strong>{u.full_name || "—"}</strong>{isSelf && <small style={{ display: "block", color: "#2563eb" }}>Aap</small>}</td>
                          <td>{u.email}</td>
                          <td>
                            <select
                              value={u.role}
                              disabled={isSelf}
                              title={isSelf ? "Apni khud ki role change nahi kar sakte (lockout protection)." : ""}
                              onChange={(e) => updateRow(u.id, { role: e.target.value as StaffRole })}
                              style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, width: 170, opacity: isSelf ? 0.6 : 1 }}
                            >
                              {ROLE_OPTIONS.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {u.role === "technician" ? (
                              <select
                                value={u.technician_id ?? ""}
                                onChange={(e) => updateRow(u.id, { technician_id: e.target.value ? Number(e.target.value) : null })}
                                style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, width: 150 }}
                              >
                                <option value="">— None —</option>
                                {technicians.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span style={{ color: "#cbd5e1" }}>—</span>
                            )}
                          </td>
                          <td>
                            <span className="dash-badge" style={{ background: u.active ? "#dcfce7" : "#fee2e2", color: u.active ? "#166534" : "#991b1b" }}>
                              {u.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: "#64748b" }}>{u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN") : "—"}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              disabled={isSelf}
                              title={isSelf ? "Apni account deactivate/delete nahi kar sakte." : ""}
                              onClick={() => updateRow(u.id, { active: !u.active }, u.active ? "User deactivate ho gaya (app me blocked)." : "User active ho gaya.")}
                              style={{ ...btnStyle(u.active ? "#d97706" : "#16a34a"), padding: "5px 10px", fontSize: 11, marginRight: 6, opacity: isSelf ? 0.5 : 1, cursor: isSelf ? "not-allowed" : "pointer" }}
                            >
                              {u.active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              title={isSelf ? "Apni account delete nahi kar sakte." : ""}
                              onClick={() => deleteRow(u)}
                              style={{ ...btnStyle("#dc2626"), padding: "5px 10px", fontSize: 11, opacity: isSelf ? 0.5 : 1, cursor: isSelf ? "not-allowed" : "pointer" }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ROLE GUIDE */}
          <div style={{ background: "#fff", padding: 20, marginBottom: 20, borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
            <h2 style={{ fontSize: 16, margin: "0 0 14px", color: "#0f172a" }}>Role Guide</h2>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr><th>Role</th><th>Kya kar sakta hai</th></tr></thead>
                <tbody>
                  {ROLE_INFO.map((r) => (
                    <tr key={r.role}>
                      <td><strong>{roleLabel(r.role)}</strong></td>
                      <td style={{ color: "#475569" }}>{r.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* LOGIN HISTORY */}
          <div style={{ background: "#fff", padding: 20, borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
            <h2 style={{ fontSize: 16, margin: "0 0 6px", color: "#0f172a" }}>Login History (last 50)</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>Har successful login ka record — kaun kab, kis browser se aaya.</p>
            {events.length === 0 ? (
              <div className="empty-state"><div>🕘</div><h3>Abhi tak koi login record nahi</h3><p>Migration ke baad ke logins yahan dikhenge.</p></div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Time</th><th>Name</th><th>Email</th><th>Role</th><th>Browser</th></tr></thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{ev.logged_in_at ? new Date(ev.logged_in_at).toLocaleString("en-IN") : "—"}</td>
                        <td>{ev.full_name || "—"}</td>
                        <td>{ev.email || "—"}</td>
                        <td>{roleLabel(ev.role)}</td>
                        <td style={{ fontSize: 12, color: "#64748b" }}>{shortBrowser(ev.user_agent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default UsersRoles;
