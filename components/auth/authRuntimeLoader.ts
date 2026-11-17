export function loadAuthRuntime() {
  return import("@/components/auth/AuthProvider").then((module) => module.AuthProvider);
}
