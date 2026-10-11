"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAccount } from "./account-provider";
import { emptyFeatures, type CustomerFeatures } from "../lib/customer-rules";
import {
  readGuestFavorites,
  FAVORITES_STORAGE_KEY,
} from "../lib/guest-favorites";
const Context = createContext<{
  data: CustomerFeatures;
  ready: boolean;
  busy: boolean;
  error: string;
  mutate: (value: unknown) => Promise<void>;
}>({
  data: emptyFeatures(),
  ready: false,
  busy: false,
  error: "",
  mutate: async () => {},
});
export const useCustomerFeatures = () => useContext(Context);
export default function CustomerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { customer, ready: accountReady } = useAccount();
  const [data, setData] = useState(emptyFeatures);
  const latestData = useRef(data);
  latestData.current = data;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = useRef<string | null>(null);
  owner.current = customer?.id ?? null;
  useEffect(() => {
    if (!accountReady) return;
    const controller = new AbortController();
    setReady(false);
    setError("");
    setData(emptyFeatures());
    let guest: string[] = [];
    try {
      guest = readGuestFavorites(localStorage.getItem(FAVORITES_STORAGE_KEY));
    } catch {}
    if (!customer) {
      setData({ ...emptyFeatures(), favorites: guest });
      setReady(true);
      return;
    }
    const id = customer.id;
    async function load() {
      try {
        const r = guest.length
          ? await fetch("/api/customer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "import-favorites", skus: guest }),
              signal: controller.signal,
            })
          : await fetch("/api/customer", {
              signal: controller.signal,
              cache: "no-store",
            });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        if (owner.current !== id || controller.signal.aborted) return;
        setData(result);
        if (guest.length)
          try {
            localStorage.removeItem(FAVORITES_STORAGE_KEY);
          } catch {}
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setReady(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [customer?.id, accountReady]);
  async function mutate(value: unknown) {
    const id = owner.current;
    setError("");
    setBusy(true);
    try {
      if (!id) {
        const action = value as {
          action: string;
          sku: string;
          enabled: boolean;
        };
        if (action.action !== "favorite")
          throw new Error("Влез в профила си, за да активираш услугата.");
        const previous = latestData.current;
        const favorites = action.enabled
          ? [...new Set([...previous.favorites, action.sku])]
          : previous.favorites.filter((sku) => sku !== action.sku);
        const next = { ...previous, favorites };
        latestData.current = next;
        setData(next);
        try {
          localStorage.setItem(
            FAVORITES_STORAGE_KEY,
            JSON.stringify(favorites),
          );
        } catch {
          setError(
            "Любимите работят, но браузърът не позволява запазването им.",
          );
        }
        return;
      }
      const r = await fetch("/api/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      if (owner.current === id) setData(result);
    } catch (e) {
      if (owner.current === id) setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ data, ready, busy, error, mutate }}>
      {children}
    </Context.Provider>
  );
}
