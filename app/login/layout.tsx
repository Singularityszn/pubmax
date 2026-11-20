import type { ReactNode } from "react";
import SiteNav from "@/components/nav/SiteNav";

export default function LoginLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
