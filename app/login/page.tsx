import type { Metadata } from "next";

import LoginPage from "@/components/auth/LoginPage";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to PUBMAXXING with email or a social account. Save prices, claim a handle, keep your nights.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default function LoginRoute(): React.JSX.Element {
  return <LoginPage />;
}
