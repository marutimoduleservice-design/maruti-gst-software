// Financial Year helpers — India standard: 1 April to 31 March.
// FY label is "2026-27" where 2026 is the START year (1 Apr 2026 .. 31 Mar 2027).

export const FY_START_MONTH = 3; // April (0-based)

export type FinancialYear = {
  startYear: number;
  endYear: number;
  label: string;
  from: string; // YYYY-MM-DD  (1 April)
  to: string; // YYYY-MM-DD    (31 March)
};

const pad = (n: number) => String(n).padStart(2, "0");

// Which FY does a given date belong to?
export const fyOfDate = (value?: string | Date | null): FinancialYear => {
  const date =
    value instanceof Date
      ? value
      : new Date(`${String(value || "").slice(0, 10)}T00:00:00`);
  const d = Number.isNaN(date.getTime()) ? new Date() : date;
  const startYear = d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  return fyFromStartYear(startYear);
};

export const fyFromStartYear = (startYear: number): FinancialYear => {
  const endYear = startYear + 1;
  return {
    startYear,
    endYear,
    label: `${startYear}-${pad(endYear % 100)}`,
    from: `${startYear}-04-01`,
    to: `${endYear}-03-31`,
  };
};

// Current active FY (used as the default selection everywhere).
export const currentFY = (): FinancialYear => fyOfDate(new Date());

// The FY that contains today, as a label.
export const currentFYLabel = (): string => currentFY().label;

export const fyStartYear = (label: string): number => {
  const parsed = Number(String(label || "").slice(0, 4));
  return Number.isFinite(parsed) && parsed > 1900 ? parsed : currentFY().startYear;
};

// A list of FY labels for dropdowns, newest first.
export const fyOptions = (count = 6): string[] => {
  const start = currentFY().startYear;
  return Array.from({ length: count }, (_, i) => fyFromStartYear(start - i).label);
};

export const isDateInFY = (value: string | null | undefined, fy: FinancialYear) => {
  const day = String(value || "").slice(0, 10);
  return !!day && day >= fy.from && day <= fy.to;
};
