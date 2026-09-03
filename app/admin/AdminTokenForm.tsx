"use client";

import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import AdminSessionEntry from "./AdminSessionEntry";

import "./admin.css";

/**
 * The only surface an anonymous GET /admin may show. It spends the existing
 * session POST, proves the cookie landed, and only then reloads so the document
 * guard can admit the console. A silent reload onto this same form would read
 * as a correct token being ignored.
 */
export default function AdminTokenForm(): React.JSX.Element {
  return (
    <main id="main" className="admin">
      <SiteNav />

      <h1>Moderator sign-in</h1>
      <p className="admin-sub">Enter the admin token to open the console.</p>
      <Link className="adminMapCallout" href="/map">
        Back to the map
      </Link>
      <AdminSessionEntry onOpened={() => window.location.assign("/admin")} />
    </main>
  );
}
