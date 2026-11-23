"use client";
// An unexpected error on a page, with the shop's header still around it
// (#134). Nothing about the error is shown except the code under which the
// server logged it, for support.
import { useEffect } from "react";
import Link from "next/link";
import { useLocale } from "../components/locale-provider";
import SiteHeader from "../components/site-header";
import { errorCode, reportCaughtError } from "../lib/caught-error";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  useEffect(() => reportCaughtError(error), [error]);
  const code = errorCode(error);
  return (
    <>
      {/* The page's own title failed with it. */}
      <title>
        {text("Нещо се обърка — AUTO/SHOP", "Something went wrong — AUTO/SHOP")}
      </title>
      <SiteHeader />
      <main id="main-content" className="site-width error-page">
        <div role="alert">
          <h1>{text("Нещо се обърка.", "Something went wrong.")}</h1>
          <p>
            {text(
              "Страницата не се зареди. Опитай отново след малко.",
              "The page did not load. Try again in a moment.",
            )}
          </p>
          {code && (
            <p className="note">
              {text("Код на грешката", "Error code")}: <code>{code}</code>
            </p>
          )}
        </div>
        <p className="error-page-actions">
          <button type="button" className="button" onClick={() => retry()}>
            {text("Опитай отново", "Try again")}
          </button>
          <Link className="text-link" href="/">
            {text("Към началото", "To the home page")}
          </Link>
        </p>
      </main>
    </>
  );
}
