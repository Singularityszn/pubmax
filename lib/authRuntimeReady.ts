/** A direct SDK session write waits for the provider's subscription. */
export async function awaitAuthRuntime(
  wait?: () => Promise<boolean>, current: () => boolean = () => true,
): Promise<void> {
  if (wait && !await wait()) throw new Error("Auth runtime unavailable");
  if (!current()) throw new Error("Auth operation superseded");
}
