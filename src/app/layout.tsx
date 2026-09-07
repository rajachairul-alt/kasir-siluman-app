import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kasir Siluman",
  description: "Copilot finansial otomatis untuk pedagang gerobak & UMKM mikro",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#1F3A56",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-cream text-[#231F1A] antialiased">{children}</body>
    </html>
  );
}
