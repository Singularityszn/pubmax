import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PubMaxing",
  description: "A price-aware London pub crawl planner.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
