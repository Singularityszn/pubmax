// PubMap reads and writes the first-run overlay's dismissal in sessionStorage.
// The shell restores it before PubMap mounts and mirrors it to localStorage
// after user interactions, so dismissal persists across visits when storage works.
export const ONBOARDING_DISMISSED_KEY = "pubmax_onboarding_dismissed";
