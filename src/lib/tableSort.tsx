import { useState } from "react";

export type SortDir = "asc" | "desc";

export type TableSort<K extends string> = {
  key: K;
  dir: SortDir;
  toggle: (k: K) => void;
  sorted: <T>(rows: T[], accessor: (row: T) => unknown) => T[];
};

/**
 * Shared click-to-sort helper for report tables.
 * Numbers compare numerically, everything else as text (case-insensitive).
 */
export function useTableSort<K extends string>(initialKey: K, initialDir: SortDir = "asc"): TableSort<K> {
  const [key, setKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };

  const sorted = <T,>(rows: T[], accessor: (row: T) => unknown): T[] => {
    const copy = [...(rows || [])];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);

      const an = av === null || av === undefined || av === "" ? NaN : Number(av);
      const bn = bv === null || bv === undefined || bv === "" ? NaN : Number(bv);

      const cmp =
        !Number.isNaN(an) && !Number.isNaN(bn)
          ? an - bn
          : String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });

      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  };

  return { key, dir, toggle, sorted };
}

/**
 * Convenience wrapper: give it the rows plus one accessor per sortable column,
 * and it returns the rows already sorted by the active column.
 */
export function useSortedRows<T>(
  rows: T[],
  columns: Record<string, (row: T) => unknown>,
  initialKey: string,
  initialDir: SortDir = "asc"
) {
  const sort = useTableSort<string>(initialKey, initialDir);
  return { sort, sorted: sort.sorted(rows || [], columns[sort.key]) };
}

type SortThProps = {
  label: string;
  active: boolean;
  dir: SortDir;
  onToggle: () => void;
  style?: React.CSSProperties;
  align?: "left" | "right" | "center";
};

/** A clickable <th> that shows the current sort direction. */
export function SortTh({ label, active, dir, onToggle, style, align }: SortThProps) {
  return (
    <th
      onClick={onToggle}
      title={`${label} se sort karein`}
      style={{
        ...style,
        textAlign: align ?? "left",
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
        }}
      >
        {label}
        <span style={{ color: active ? "#2563eb" : "#94a3b8", fontSize: 10 }}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}