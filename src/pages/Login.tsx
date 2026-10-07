import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchCompanies, getCompanyId, setCompanyId } from "../lib/company";
import type { Company } from "../lib/company";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(() => getCompanyId());
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    fetchCompanies()
      .then((list) => {
        if (!active) return;
        setCompanies(list);
        const match = list.find((c) => c.id === selectedCompanyId) || list[0] || null;
        if (match) {
          setSelectedCompanyId(match.id);
          setCompanyId(match.id);
        }
      })
      .catch(() => {
        if (active) setCompanies([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(error.message);
    }

    setSubmitting(false);
  };

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setResetSent(false);
    setSubmitting(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });

    if (error) {
      setErrorMessage(error.message);
    } else {
      setResetSent(true);
    }

    setSubmitting(false);
  };

  const switchMode = (nextMode: boolean) => {
    setForgotMode(nextMode);
    setErrorMessage("");
    setResetSent(false);
    setPassword("");
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f5f7fb",
      }}
    >
      <div
        style={{
          width: "400px",
          background: "#fff",
          padding: "30px",
          borderRadius: "12px",
          boxShadow: "0 0 20px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 14px",
              borderRadius: 18,
              background: "linear-gradient(145deg, #f97316, #c2410c)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 42,
              fontWeight: 900,
              boxShadow: "0 10px 22px rgba(194, 65, 12, 0.24)",
            }}
            aria-label="Maruti Module Service logo"
          >
            M
          </div>
          <h1 style={{ margin: 0, color: "#0f172a", fontSize: 25 }}>
            Maruti Module Service
          </h1>
          <p style={{ margin: "7px 0 0", color: "#64748b", fontSize: 13 }}>
            M5 Repair Management Software
          </p>
        </div>

        {forgotMode ? (
          <form onSubmit={handlePasswordReset}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <KeyRound size={17} color="#0B5ED7" />
              <strong style={{ color: "#0f172a", fontSize: 16 }}>Reset your password</strong>
            </div>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.5, margin: "0 0 16px" }}>
              Registered email par password reset link bhejenge.
            </p>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <Mail size={17} color="#64748b" style={{ position: "absolute", left: 12, top: 13 }} />
              <input
                type="email"
                placeholder="Registered email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={{ ...fieldStyle, paddingLeft: 38 }}
              />
            </div>

            {resetSent && (
              <p style={successMessageStyle}>
                Reset link email par bhej diya gaya hai. Inbox aur spam folder check karein.
              </p>
            )}
            {errorMessage && <p style={errorMessageStyle}>{errorMessage}</p>}

            <button type="submit" disabled={submitting} style={submitButtonStyle(submitting)}>
              {submitting ? "Sending link..." : "Send Reset Link"}
            </button>
            <button type="button" onClick={() => switchMode(false)} style={linkButtonStyle}>
              Back to Login
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit}>
          {companies.length > 0 && (
            <div style={{ marginTop: 20, marginBottom: 15 }}>
              <label
                htmlFor="company-select"
                style={{
                  display: "block",
                  color: "#334155",
                  fontSize: 12,
                  fontWeight: 700,
                  marginBottom: 5,
                }}
              >
                Company
              </label>
              <select
                id="company-select"
                value={selectedCompanyId}
                onChange={(event) => {
                  const id = Number(event.target.value);
                  setSelectedCompanyId(id);
                  setCompanyId(id);
                }}
                style={fieldStyle}
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} ({company.tax_mode})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ position: "relative", marginTop: 20, marginBottom: 15 }}>
            <Mail size={17} color="#64748b" style={{ position: "absolute", left: 12, top: 13 }} />
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ ...fieldStyle, paddingLeft: 38 }}
          />
          </div>

          <div style={{ position: "relative", marginBottom: 8 }}>
            <ShieldCheck size={17} color="#64748b" style={{ position: "absolute", left: 12, top: 13 }} />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ ...fieldStyle, paddingLeft: 38, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
              style={eyeButtonStyle}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div style={{ textAlign: "right", marginBottom: 18 }}>
            <button type="button" onClick={() => switchMode(true)} style={linkButtonStyle}>
              Forgot password?
            </button>
          </div>

          {errorMessage && (
            <p style={errorMessageStyle}>{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={submitButtonStyle(submitting)}
          >
            {submitting ? "Signing in..." : "Login"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  boxSizing: "border-box",
  fontSize: 14,
  outline: "none",
};

const eyeButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: 6,
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
};

const submitButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: "100%",
  padding: "12px",
  background: disabled ? "#94a3b8" : "#0B5ED7",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 700,
  fontSize: 14,
});

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#0B5ED7",
  padding: "8px 0",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const errorMessageStyle: React.CSSProperties = {
  color: "#b91c1c",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 7,
  padding: "9px 10px",
  fontSize: 13,
  margin: "0 0 15px",
};

const successMessageStyle: React.CSSProperties = {
  color: "#166534",
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 7,
  padding: "9px 10px",
  fontSize: 13,
  margin: "0 0 15px",
};

export default Login;