import Link from "next/link";
import type { LandingDrinkLink } from "@/lib/landingDiscovery.server";

export default function LandingDiscoveryLinks({ drinks }: { drinks: readonly LandingDrinkLink[] }) {
  return (
    <nav className="lpDiscovery" aria-labelledby="lp-discovery-title">
      <h2 id="lp-discovery-title">Find your next pub</h2>
      <ul className="lpDiscoveryLinks" role="list">
        <li><Link prefetch={false} className="lpDiscoveryLink" href="/borough">Pubs by borough</Link></li>
        <li><Link prefetch={false} className="lpDiscoveryLink" href="/guides">Pub of the week</Link></li>
        <li><Link prefetch={false} className="lpDiscoveryLink" href="/historic">Historic pubs</Link></li>
        <li><Link prefetch={false} className="lpDiscoveryLink" href="/crawls">Pub crawl routes</Link></li>
      </ul>
      {drinks.length > 0 ? (
        <>
          <p>Listed pint prices by drink</p>
          <ul className="lpDiscoveryLinks" role="list">
            {drinks.map(({ href, label }) => (
              <li key={href}><Link prefetch={false} className="lpDiscoveryLink" href={href}>{label}</Link></li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
