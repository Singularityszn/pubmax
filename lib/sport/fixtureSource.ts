export function sportFixtureSource(rowId: string) {
  if (rowId.startsWith("sport-fixture-of-")) {
    return { label: "OpenFootball", url: "https://github.com/openfootball/football.json" };
  }
  if (rowId.startsWith("sport-fixture-fd-")) {
    return { label: "football-data.org", url: "https://www.football-data.org/" };
  }
  return null;
}
