export function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

export function authStores() {
  const persistent = memoryStorage();
  const tab = memoryStorage();
  return {
    persistentStorage: persistent.storage,
    persistentValues: persistent.values,
    tabStorage: tab.storage,
    tabValues: tab.values,
  };
}
