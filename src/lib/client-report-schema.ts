// Server-side validation of browser reports (#117); see client-reports.ts.
import { z } from "zod";
import { reportPath, reportStack, type ClientReport } from "./client-reports";

// Control characters, except the line breaks of a stack.
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) =>
      value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim(),
    );
const path = z
  .string()
  .max(2000)
  .refine((value) => value.startsWith("/"))
  .transform(reportPath);

export const clientReportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("error"),
      name: text(100),
      message: text(1000),
      stack: text(5000).transform(reportStack).default(""),
      path,
    })
    .strict(),
  z
    .object({
      type: z.literal("vital"),
      name: z.enum(["LCP", "CLS", "INP", "FCP", "TTFB"]),
      value: z.number().min(0).max(600_000),
      rating: z.enum(["good", "needs-improvement", "poor"]),
      path,
    })
    .strict(),
]);

// The browser's type and the server's schema describe the same thing.
export const isClientReport = (report: ClientReport): boolean =>
  clientReportSchema.safeParse(report).success;
