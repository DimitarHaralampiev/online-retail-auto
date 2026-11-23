"use client";
// The last resort, when the layout itself fails (e.g. the database is down):
// it replaces the whole page, so it uses no provider and says everything in
// both languages (#134).
import { useEffect } from "react";
import "./globals.css";
import { errorCode, reportCaughtError } from "../lib/caught-error";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => reportCaughtError(error), [error]);
  const code = errorCode(error);
  return (
    <html lang="bg">
      <body>
        <title>AUTO/SHOP</title>
        <main className="site-width error-page">
          <p className="eyebrow">AUTO/SHOP</p>
          <div role="alert">
            <h1>Магазинът временно не е достъпен.</h1>
            <p>Опитай отново след малко.</p>
            <p lang="en">
              The shop is temporarily unavailable. Please try again in a moment.
            </p>
            {code && (
              <p className="note">
                Код на грешката / <span lang="en">Error code</span>:{" "}
                <code>{code}</code>
              </p>
            )}
          </div>
          <p className="error-page-actions">
            <button type="button" className="button" onClick={() => retry()}>
              <span>
                Опитай отново / <span lang="en">Try again</span>
              </span>
            </button>
          </p>
        </main>
      </body>
    </html>
  );
}
