import type { Metadata } from "next";
import PasswordRecoveryPage from "@/components/auth/PasswordRecoveryPage";
import SiteNav from "@/components/nav/SiteNav";

export const metadata: Metadata = {
  title: "Forgot password", robots: { index: false, follow: false }, referrer: "no-referrer",
};

export default function ForgotPasswordRoute() { return <><SiteNav /><PasswordRecoveryPage /></>; }
