type Last<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : T[number];

/**
 * The last element of a non-empty tuple, typed as that element. The tuple
 * type guarantees the element exists, so the index read cannot miss.
 */
export function lastOf<const T extends readonly [unknown, ...unknown[]]>(tuple: T): Last<T> {
  return tuple[tuple.length - 1] as Last<T>;
}
