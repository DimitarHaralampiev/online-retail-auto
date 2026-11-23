"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useAccount } from "./account-provider";
import { emptyFeatures, type CustomerFeatures } from "../lib/customer-rules";
import {
  readGuestFavorites,
  FAVORITES_STORAGE_KEY,
} from "../lib/guest-favorites";

const isWellFormedSku = (sku: string) =>
  sku.trim().length > 0 && sku.length <= 50 && !/[\u0000-\u001f]/.test(sku);
// Format only: the server checks SKUs when importing favourites, and pages
// show only favourites that exist in the catalog.
const guestFavoritesFrom = (raw: string | null) =>
  readGuestFavorites(raw, isWellFormedSku);

// Guest favourites live in localStorage (shared with other tabs). When the
// browser refuses storage they are kept in memory for this page instead.
const favoritesStore = (() => {
  const listeners = new Set<() => void>();
  let memory: string | null = null;
  let inMemory = false;
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === FAVORITES_STORAGE_KEY) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    read(): string | null {
      if (inMemory) return memory;
      try {
        return localStorage.getItem(FAVORITES_STORAGE_KEY);
      } catch {
        return memory;
      }
    },
    /** Saves the list; false when the browser keeps it only in memory. */
    write(favorites: string[]): boolean {
      const raw = JSON.stringify(favorites);
      let stored = true;
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, raw);
      } catch {
        stored = false;
        inMemory = true;
        memory = raw;
      }
      notify();
      return stored;
    },
    clear() {
      memory = null;
      inMemory = false;
      try {
        localStorage.removeItem(FAVORITES_STORAGE_KEY);
      } catch {}
      notify();
    },
  };
})();

const EMPTY = emptyFeatures();

const Context = createContext<{
  data: CustomerFeatures;
  ready: boolean;
  busy: boolean;
  error: string;
  mutate: (value: unknown) => Promise<void>;
}>({
  data: EMPTY,
  ready: false,
  busy: false,
  error: "",
  mutate: async () => {},
});
export const useCustomerFeatures = () => useContext(Context);

type Loaded = { owner: string; data: CustomerFeatures; error: string };

export default function CustomerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { customer, ready: accountReady } = useAccount();
  // Whose data the page shows: a signed-in customer's id, or null for a
  // guest. Answers for anyone else are never shown (switching accounts).
  const owner = customer?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<{
    owner: string | null;
    message: string;
  } | null>(null);
  const guestRaw = useSyncExternalStore(
    favoritesStore.subscribe,
    favoritesStore.read,
    () => null,
  );
  const guestData = useMemo(
    () => ({ ...EMPTY, favorites: guestFavoritesFrom(guestRaw) }),
    [guestRaw],
  );
  const current = owner && loaded?.owner === owner ? loaded : null;
  const data = !accountReady
    ? EMPTY
    : owner
      ? (current?.data ?? EMPTY)
      : guestData;
  const ready = accountReady && (!owner || !!current);
  const error =
    (mutationError?.owner === owner ? mutationError.message : "") ||
    (current?.error ?? "");

  useEffect(() => {
    if (!accountReady || !owner) return;
    const controller = new AbortController();
    const guest = guestFavoritesFrom(favoritesStore.read());
    const plainLoad = () =>
      fetch("/api/customer", { signal: controller.signal, cache: "no-store" });
    (async () => {
      let r = guest.length
        ? await fetch("/api/customer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "import-favorites", skus: guest }),
            signal: controller.signal,
          })
        : await plainLoad();
      // A failed import must not hide the account: load it anyway and keep
      // the guest favourites for the next attempt.
      const imported = guest.length > 0 && r.ok;
      if (guest.length && !r.ok) r = await plainLoad();
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      if (controller.signal.aborted) return;
      setLoaded({ owner, data: result, error: "" });
      if (imported) favoritesStore.clear();
    })().catch((e) => {
      if (!controller.signal.aborted)
        setLoaded({ owner, data: EMPTY, error: (e as Error).message });
    });
    return () => controller.abort();
  }, [owner, accountReady]);

  async function mutate(value: unknown) {
    const id = owner;
    setMutationError(null);
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
        const previous = guestFavoritesFrom(favoritesStore.read());
        const favorites = action.enabled
          ? [...new Set([...previous, action.sku])]
          : previous.filter((sku) => sku !== action.sku);
        if (!favoritesStore.write(favorites))
          setMutationError({
            owner: null,
            message:
              "Любимите работят, но браузърът не позволява запазването им.",
          });
        return;
      }
      const r = await fetch("/api/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      // Only if that customer's data is still the one loaded.
      setLoaded((previous) =>
        previous?.owner === id
          ? { ...previous, data: result, error: "" }
          : previous,
      );
    } catch (e) {
      setMutationError({ owner: id, message: (e as Error).message });
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
