/** Convert ISO date string (YYYY-MM-DD or full timestamp) to DD/MM/YYYY */
export const fmtDate = (v: unknown): string => {
  const s = String(v || "").slice(0, 10);
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};

/** Convert ISO date to DD/MM/YYYY or return original if invalid */
export const fmtDateSafe = (v: unknown): string => {
  const s = String(v || "").slice(0, 10);
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};