import { permanentRedirect } from "next/navigation";

export const dynamic = "force-static";
export const revalidate = 3600;

export default async function LegacyLedger({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/pubs/${encodeURIComponent(id)}#ledger`);
}
