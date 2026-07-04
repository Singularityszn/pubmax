import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pubmaxx.vercel.app"),
  title: {
    default: "PubMaxing",
    template: "%s | PubMaxing",
  },
  description:
    "A price-aware, story-led London pub crawl planner with real pint prices, heritage pubs, and community Pint Drops.",
  openGraph: {
    title: "PubMaxing",
    description:
      "Plan London pub crawls by price, story, setting, and community Pint Drops.",
    url: "https://pubmaxx.vercel.app",
    siteName: "PubMaxing",
    type: "website",
    images: [
      {
        url: "/favicon.svg",
        width: 512,
        height: 512,
        alt: "PubMaxing",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "PubMaxing",
    description:
      "Plan London pub crawls by price, story, setting, and community Pint Drops.",
    images: ["/favicon.svg"],
  },
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme before paint to avoid a flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pubmax-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
