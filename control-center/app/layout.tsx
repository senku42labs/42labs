import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "RIMURU CONTROL CORE", description: "Owner control centre for RIMURU TEMPEST MD" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}