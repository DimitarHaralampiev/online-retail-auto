import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";

export const metadata: Metadata = {
  title: "Авто магазин — в разработка",
  description:
    "Подготвяме онлайн магазин за автоаксесоари и части за България.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
