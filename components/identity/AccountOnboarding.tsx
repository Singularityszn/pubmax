"use client";

// Compatibility surface. The auth shell imports the eager host directly so
// existing synchronous form exports cannot pull fields into its startup graph.
export { default, AccountOnboardingLoadError, canSubmitCheckedHandle } from "./AccountOnboardingHost";
export { AccountOnboardingForm } from "./AccountOnboardingForm";
