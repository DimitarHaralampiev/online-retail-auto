"use client";
// Core Web Vitals of real visits (#117), reported to the shop itself. Rendered
// only inside <ConsentGate category="analytics">.
import { useReportWebVitals } from "next/web-vitals";
import { sendReport } from "../lib/client-reports";

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

const NAMES = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;

// Stable identity, so no metric is reported twice.
function report(metric: Metric) {
  const name = NAMES.find((known) => known === metric.name);
  if (!name) return;
  sendReport({
    type: "vital",
    name,
    value: metric.value,
    rating: metric.rating,
    path: location.pathname,
  });
}

export default function FieldVitals() {
  useReportWebVitals(report);
  return null;
}
