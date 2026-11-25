import { expect } from "vitest";

export type BindingOwner = "A" | "B";
export type BindingVectorStore = {
  bind(owner: BindingOwner, sequence: number): Promise<boolean>;
  release(owner: BindingOwner, sequence: number): Promise<void>;
  unbind(sequence: number): Promise<void>;
  owner(): Promise<BindingOwner | null>;
};

// Oracle: the write this device issued last decides the binding, whatever order the database runs them in.
export async function exerciseBindingOrdering(store: BindingVectorStore): Promise<void> {
  expect(await store.bind("A", 1)).toBe(true);
  await store.release("A", 2);
  expect(await store.owner()).toBeNull();

  expect(await store.bind("A", 3)).toBe(true);
  expect(await store.bind("A", 5)).toBe(true);
  await store.release("A", 4);
  expect(await store.owner()).toBe("A");

  expect(await store.bind("B", 7)).toBe(true);
  expect(await store.bind("A", 6)).toBe(false);
  expect(await store.owner()).toBe("B");
  await store.unbind(6);
  expect(await store.owner()).toBe("B");
  await store.release("A", 8);
  expect(await store.owner()).toBe("B");

  expect(await store.bind("A", 9)).toBe(true);
  expect(await store.bind("B", 10)).toBe(true);
  expect(await store.owner()).toBe("B");
  expect(await store.bind("B", 10)).toBe(true);
  await store.unbind(11);
  expect(await store.owner()).toBeNull();
}
