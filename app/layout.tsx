import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import MobileTabBar from "@/components/nav/MobileTabBar";
import { AuthProvider } from "@/components/auth/AuthProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://pubmaxx.vercel.app"),
  title: {
    default: "PUBMAXXING — Every pint has a story",
    template: "%s | PUBMAXXING",
  },
  description:
    "Every pint has a story. PUBMAXXING is a price-aware, story-led London pub-crawl planner — real pint prices, heritage pubs, and community Pint Drops.",
  openGraph: {
    title: "PUBMAXXING — Every pint has a story",
    description:
      "Cheap pints, chaotic nights, and the crawl stories worth passing down. Plan London pub crawls by price, story, and community Pint Drops.",
    url: "https://pubmaxx.vercel.app",
    siteName: "PUBMAXXING",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PUBMAXXING — London pub crawl planner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PUBMAXXING — Every pint has a story",
    description:
      "Cheap pints, chaotic nights, and the crawl stories worth passing down. Plan London pub crawls by price, story, and community Pint Drops.",
    images: ["/og.png"],
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
      <body>
        {/* AuthProvider is additive: it establishes identity for signed-in users
            but never gates a route — anonymous browsing stays fully public. The
            session loads async client-side, so children render immediately. */}
        <AuthProvider>
          {children}
          {/* App-wide bottom tab bar — visible only on ≤640px (see mobileNav.css);
              display:none on desktop so the existing navs are untouched. */}
          <MobileTabBar />
        </AuthProvider>
      </body>
    </html>
  );
}
