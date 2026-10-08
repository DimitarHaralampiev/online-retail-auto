"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Customer } from "../lib/account-schema";
const Context = createContext<{
  customer: Customer | null;
  ready: boolean;
  setCustomer: (value: Customer | null) => void;
}>({ customer: null, ready: false, setCustomer: () => {} });
export const useAccount = () => useContext(Context);
export default function AccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (active) setCustomer(data.customer ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Context.Provider value={{ customer, ready, setCustomer }}>
      {children}
    </Context.Provider>
  );
}
