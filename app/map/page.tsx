import PubMaxingShell from "@/components/PubMaxingShell";

// /map stays London for back-compat bookmarks. Other cities live at /map/[city].
export default function MapPage() {
  return <PubMaxingShell cityId="london" />;
}
