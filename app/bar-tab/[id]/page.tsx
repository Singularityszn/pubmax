import { permanentRedirect } from "next/navigation";

export default async function LegacyBarTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/pubs/${encodeURIComponent(id)}#tab`);
}
