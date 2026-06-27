"use client";

import type { ReactNode, Key } from "react";
import { Panel } from "./ui";

/* Shared async/empty/error state text. Callers override per page. */
type StateText = {
  loadingText?: ReactNode;
  errorText?: ReactNode;
  emptyText?: ReactNode;
};

/**
 * AsyncBoundary — single source of truth for the 装载 / 错误 / 空 triad that
 * every console list page was hand-rolling. Renders `children` only in the
 * loaded-with-data state.
 *
 * variant:
 *  - "panel" (default): standalone — error/empty wrapped in a Panel.
 *  - "bare": embedded inside a Panel/grid — states render as a plain full-width row.
 */
export function AsyncBoundary({
  loading,
  error,
  empty,
  variant = "panel",
  loadingText = "装载中…",
  errorText = "加载失败。",
  emptyText = "暂无数据。",
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  variant?: "panel" | "bare";
  children: ReactNode;
} & StateText) {
  if (loading) {
    return variant === "bare" ? (
      <div className="px-6 py-8 text-center cs-label">{loadingText}</div>
    ) : (
      <div className="cs-label">{loadingText}</div>
    );
  }
  if (error) {
    return variant === "bare" ? (
      <div className="px-6 py-8 text-center text-sm" style={{ color: "var(--cs-red)" }}>
        {errorText}
      </div>
    ) : (
      <Panel className="p-5 text-sm" style={{ color: "var(--cs-red)" }}>
        {errorText}
      </Panel>
    );
  }
  if (empty) {
    return variant === "bare" ? (
      <div className="px-6 py-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
        {emptyText}
      </div>
    ) : (
      <Panel className="p-8 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
        {emptyText}
      </Panel>
    );
  }
  return <>{children}</>;
}

/**
 * ResourceList — card-row list (the catalog / contracts shape). Owns the row
 * Panel shell + the state triad; the page only supplies `renderItem`, which
 * returns the inner content of one row.
 */
export function ResourceList<T>({
  items,
  rowKey,
  renderItem,
  rowClassName = "px-6 py-4 flex items-center gap-4",
  className = "p-8 space-y-3",
  loading,
  error,
  loadingText,
  errorText,
  emptyText,
}: {
  items: T[] | undefined;
  rowKey: (item: T, i: number) => Key;
  renderItem: (item: T) => ReactNode;
  rowClassName?: string;
  className?: string;
  loading?: boolean;
  error?: unknown;
} & StateText) {
  return (
    <div className={className}>
      <AsyncBoundary
        loading={loading}
        error={error}
        empty={!!items && items.length === 0}
        loadingText={loadingText}
        errorText={errorText}
        emptyText={emptyText}
      >
        {items?.map((item, i) => (
          <Panel key={rowKey(item, i)} className={rowClassName}>
            {renderItem(item)}
          </Panel>
        ))}
      </AsyncBoundary>
    </div>
  );
}

/** A column definition: header + cell share one `className` so they stay aligned. */
export type GridColumn<T> = {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** col-span + alignment, e.g. "col-span-3" or "col-span-2 text-right". */
  className?: string;
};

/**
 * DataGrid — 12-column instrument table (the connectors / settlements shape).
 * Renders the `Panel ticks` shell + header row + `cs-row` body rows from a
 * column model, embedding the state triad inside the panel.
 */
export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  loadingText,
  errorText,
  emptyText,
}: {
  columns: GridColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T, i: number) => Key;
  loading?: boolean;
  error?: unknown;
} & StateText) {
  return (
    <Panel ticks>
      <div
        className="grid grid-cols-12 px-6 py-3 cs-label border-b"
        style={{ borderColor: "var(--cs-line)" }}
      >
        {columns.map((c, i) => (
          <div key={i} className={c.className}>
            {c.header}
          </div>
        ))}
      </div>
      <AsyncBoundary
        variant="bare"
        loading={loading}
        error={error}
        empty={!!rows && rows.length === 0}
        loadingText={loadingText}
        errorText={errorText}
        emptyText={emptyText}
      >
        {rows?.map((row, i) => (
          <div key={rowKey(row, i)} className="cs-row grid grid-cols-12 px-6 py-4 items-center">
            {columns.map((c, ci) => (
              <div key={ci} className={c.className}>
                {c.cell(row)}
              </div>
            ))}
          </div>
        ))}
      </AsyncBoundary>
    </Panel>
  );
}
