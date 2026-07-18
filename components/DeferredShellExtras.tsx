"use client";

// Lazy shell extras (perf lane). Everything here renders NOTHING on first
// paint (each is gated on client-side state: an active plan, a first-run
// flag, a prompt budget, a saved Pub Pal), so none of it belongs in the
// critical first-load bundle of every route. next/dynamic with ssr:false
// moves each component and its import graph (NightModeCard alone pulls the
// plan/TfL/recap stack) into lazily fetched chunks that load after hydration.
//
// Behaviour is unchanged: the same components mount with the same props and
// the same client-side gates; they just arrive a beat after the page is
// interactive instead of blocking it.

import nextDynamic from "next/dynamic";

const NightModeCard = nextDynamic(() => import("@/components/night/NightModeCard"), {
  ssr: false,
});
const PubPalSummon = nextDynamic(() => import("@/components/pubpal/PubPalSummon"), {
  ssr: false,
});
const FirstRunTour = nextDynamic(() => import("@/components/onboarding/FirstRunTour"), {
  ssr: false,
});
const A2HSInstallPrompt = nextDynamic(() => import("@/components/pwa/A2HSInstallPrompt"), {
  ssr: false,
});
const NativePushPrompt = nextDynamic(() => import("@/components/native/NativePushPrompt"), {
  ssr: false,
});

export default function DeferredShellExtras() {
  return (
    <>
      <NightModeCard />
      <PubPalSummon />
      <FirstRunTour />
      <A2HSInstallPrompt />
      <NativePushPrompt />
    </>
  );
}
