export const offlineFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Pal eval deterministic mode is offline; refused ${url}.`);
};
