/** Minutes after midnight for an "HH:MM" clock, or NaN when it is not one. */
export function clockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour === undefined || minute === undefined ? Number.NaN : hour * 60 + minute;
}
