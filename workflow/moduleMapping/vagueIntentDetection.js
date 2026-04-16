/**
 * Under-specified “track / manage” phrasing without domain or entity anchors → ask, don’t assume.
 * See docs/system/MODULE_DISCOVERY_WORKING.md §9 (ambiguous input).
 */

const TRACK_VERBS = /\b(track|tracking|monitor|monitors|monitored|manage|managing)\b/;

const VAGUE_OBJECTS =
  /\b(things?|stuff|something|everything|anything|items?|it all|all of it|whatever|somewhere)\b/;

/** Hints that the user named a concrete subject — vague rule should not fire. */
const SPECIFIC_ANCHORS =
  /\b(client|customer|patient|member|user|users|person|people|order|orders|product|products|inventory|employee|employees|student|students|tenant|tenants|lead|leads|account|accounts|case|cases|athlete|athletes|vendor|vendors|buyer|sellers?|task|tasks|fitness|workout|workouts|gym|visit|visits|session|sessions|photo|photos|document|documents)\b/;

/**
 * @param {string} normalizedText
 * @param {string[]} knownModuleIds — detected ∪ user-affirmed (e.g. guided)
 * @param {string[]} matchedDomainIds
 * @returns {boolean}
 */
export function isVagueAmbiguousIntent(normalizedText, knownModuleIds, matchedDomainIds) {
  const text = String(normalizedText ?? "").trim().toLowerCase();
  if (!text) return false;
  if (matchedDomainIds.length > 0) return false;
  if (knownModuleIds.includes("entity_tracking")) return false;
  if (!TRACK_VERBS.test(text)) return false;
  if (VAGUE_OBJECTS.test(text)) return true;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && !SPECIFIC_ANCHORS.test(text)) return true;
  return false;
}
