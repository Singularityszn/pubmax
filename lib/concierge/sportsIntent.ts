const SPORTS_TOPIC_RE = /\b(?:sports?|football|footy|rugby|boxing|cricket|tennis|snooker|golf|racing|nfl|super bowl|grand national|f1|grand prix|the euros|euro\s+20\d{2}|ashes|premier league|champions league|world cup|six nations|matchday|the game)\b/i;
const VIEWING_DARTS_RE = /\b(?:watch(?:ing)?|show(?:ing|s)?|screen(?:ing|s)?|catch(?:ing)?|see)\s+(?:(?:me|us|the|live|tonight['’]s|today['’]s|tomorrow['’]s)\s+){0,3}darts\b(?!\s+boards?\b)/i;
const VIEWING_MATCH_RE = /\b(?:watch(?:ing)?|show(?:ing|s)?|screen(?:ing|s)?|catch(?:ing)?|see)\s+(?:(?!(?:me|us|pubs?|bars?|venues?|places?|that|which|preferences?|taste|budget)\b)[\p{L}\p{N}'’.-]+\s+){0,6}(?:match(?:es)?|games?|fixtures?)\b(?!\s+(?:(?:on|with|for)\s+)?(?:my|our|your)\b)/iu;
const NAMED_MATCH_RE = /\b(?:the|big|live|tonight['’]s|today['’]s|tomorrow['’]s)\s+match\b/i;
const TEAM_MATCH_RE = /\b[Tt]he\s+(?:[\p{Lu}][\p{L}\p{N}'’.-]*\s+){1,3}match\b/u;

export function hasSportsIntent(text: string): boolean {
  return SPORTS_TOPIC_RE.test(text) || VIEWING_DARTS_RE.test(text) || VIEWING_MATCH_RE.test(text)
    || NAMED_MATCH_RE.test(text) || TEAM_MATCH_RE.test(text);
}
