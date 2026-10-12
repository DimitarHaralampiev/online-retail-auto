"use client";
import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "../lib/i18n/locale";
import { translate } from "../lib/i18n/translate";
const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string) => string;
}>({ locale: "bg", setLocale: () => {}, t: (text) => text });
export const useLocale = () => useContext(Context);
export default function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setValue] = useState(initialLocale);
  const router = useRouter();
  function setLocale(value: Locale) {
    setValue(value);
    document.documentElement.lang = value;
    document.cookie = `${LOCALE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    router.refresh();
  }
  return (
    <Context.Provider
      value={{ locale, setLocale, t: (text) => translate(text, locale) }}
    >
      {children}
    </Context.Provider>
  );
}
