import PubMaxingShell from "@/components/PubMaxingShell";
import ThemeToggle from "@/components/ThemeToggle";
import LegacyToggle from "@/components/LegacyToggle";

// The working planner lives at /map. The landing page owns / and links here.
export default function MapPage() {
  return (
    <>
      <PubMaxingShell />
      <ThemeToggle floating />
      <LegacyToggle floating />
    </>
  );
}
