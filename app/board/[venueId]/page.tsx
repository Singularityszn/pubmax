import { permanentRedirect } from "next/navigation";

export default async function LegacyBoard({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  permanentRedirect(`/pubs/${encodeURIComponent(venueId)}#board`);
}
