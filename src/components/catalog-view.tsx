"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

type View = "grid" | "list";
const ViewContext = createContext<{
  view: View;
  setView: (view: View) => void;
} | null>(null);

function useView() {
  const value = useContext(ViewContext);
  if (!value) throw new Error("Wrap the catalog in CatalogViewProvider");
  return value;
}

/**
 * The catalog's grid/list choice (#141). It lives here rather than in the
 * catalog so that switching re-renders only the switch and the grid frame:
 * the product cards come in as unchanged children, which React skips.
 */
export function CatalogViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("grid");
  return (
    <ViewContext.Provider value={{ view, setView }}>
      {children}
    </ViewContext.Provider>
  );
}

export function CatalogViewSwitch() {
  const { view, setView } = useView();
  const { locale } = useLocale();
  const en = locale === "en";
  return (
    <div
      className="catalog-view-switch"
      role="group"
      aria-label={en ? "View" : "Изглед"}
    >
      <button
        type="button"
        aria-pressed={view === "grid"}
        onClick={() => setView("grid")}
        aria-label={en ? "Grid" : "Мрежа"}
      >
        ▦
      </button>
      <button
        type="button"
        aria-pressed={view === "list"}
        onClick={() => setView("list")}
        aria-label={en ? "List" : "Списък"}
      >
        ☷
      </button>
    </div>
  );
}

export function CatalogViewFrame({ children }: { children: ReactNode }) {
  const { view } = useView();
  return (
    <div
      className={`product-grid ${view === "list" ? "catalog-list-view" : ""}`}
    >
      {children}
    </div>
  );
}
