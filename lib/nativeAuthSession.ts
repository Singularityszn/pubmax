export type NativeAuthSessionPlugin = {
  authenticate: (input: { url: string; attemptId: string }) => Promise<{ url: string }>;
  cancel: (input: { attemptId: string }) => Promise<void>;
};

export async function nativeAuthSessionAvailable(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isPluginAvailable("NativeAuthSession");
  } catch { return false; }
}

async function loadPlugin(): Promise<NativeAuthSessionPlugin> {
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<NativeAuthSessionPlugin>("NativeAuthSession");
  // Never return a Capacitor Proxy from an async loader: it has a native `then` method.
  return { authenticate: (input) => plugin.authenticate(input), cancel: (input) => plugin.cancel(input) };
}

export async function authenticateNativeSession(input: { url: string; attemptId: string }): Promise<{ url: string }> {
  return (await loadPlugin()).authenticate(input);
}

export async function cancelNativeAuthSession(attemptId: string): Promise<void> {
  try { await (await loadPlugin()).cancel({ attemptId }); } catch { /* A missing bridge has no session to cancel. */ }
}

/** Invalidations stop pending exchanges. Account actions wait for an already-started install. */
export function createNativeAuthLifetime() {
  let generation = 0;
  let installation: Promise<unknown> | null = null;
  return {
    begin() {
      const ticket = ++generation;
      return {
        current: () => ticket === generation,
        async install<T>(operation: () => Promise<T>): Promise<T | null> {
          if (ticket !== generation) return null;
          const pending = operation();
          installation = pending;
          try { return await pending; }
          finally { if (installation === pending) installation = null; }
        },
      };
    },
    invalidate() {
      generation += 1;
      return installation?.then(() => {}, () => {}) ?? Promise.resolve();
    },
  };
}
