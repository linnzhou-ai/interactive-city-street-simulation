import type { ExpansionRoad } from "../models/types";

const STREET_ROOTS = [
  "Addison",
  "Aster",
  "Briar",
  "Calder",
  "Cypress",
  "Hamilton",
  "Juniper",
  "Liberty",
  "Magnolia",
  "Monroe",
  "Parkside",
  "Rittenhouse",
  "Sansom",
  "University",
  "Willow",
  "Woodland",
] as const;
const STREET_SUFFIXES = [
  "Avenue",
  "Lane",
  "Road",
  "Street",
  "Way",
] as const;
const STREET_NAMES = STREET_ROOTS.flatMap((root) =>
  STREET_SUFFIXES.map((suffix) => `${root} ${suffix}`)
);
const PLACEHOLDER_NAME = /^(?:New Street|Civic Way)\s+\d+$/i;

export function defaultExpansionRoadName(id: string): string {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return STREET_NAMES[(hash >>> 0) % STREET_NAMES.length];
}

export function randomExpansionRoadName(
  existingNames: readonly string[],
  random: () => number = Math.random,
): string {
  const used = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const available = STREET_NAMES.filter((name) => !used.has(name.toLowerCase()));
  if (available.length === 0) {
    return `Founders Avenue ${existingNames.length + 1}`;
  }
  const index = Math.min(
    available.length - 1,
    Math.floor(Math.max(0, random()) * available.length),
  );
  return available[index];
}

export function expansionRoadDisplayName(
  road: Pick<ExpansionRoad, "id" | "name">,
): string {
  const name = road.name?.trim();
  return name && !PLACEHOLDER_NAME.test(name)
    ? name
    : defaultExpansionRoadName(road.id);
}
