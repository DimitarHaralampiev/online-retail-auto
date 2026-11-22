"use client";
// Show/hide switch for a make or model in the vehicle reference.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";

export default function VehicleVisibility({
  kind,
  id,
  name,
  active,
}: {
  kind: "make" | "model";
  id: string;
  name: string;
  active: boolean;
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/vehicles/${kind}/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? text("Неуспешно.", "Failed."));
        return;
      }
      router.refresh();
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-link"
        disabled={busy}
        onClick={toggle}
        aria-label={
          (active ? text("Скрий ", "Hide ") : text("Покажи ", "Show ")) + name
        }
      >
        {active ? text("Скрий", "Hide") : text("Покажи", "Show")}
      </button>
      {error && (
        <span className="error" role="alert">
          {" "}
          {error}
        </span>
      )}
    </>
  );
}
