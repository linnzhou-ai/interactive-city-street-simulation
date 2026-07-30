import type { ExpansionRoad } from "../models/types";

export function defaultExpansionRoadName(id: string): string {
  const sequence = id.match(/\d+$/)?.[0] ?? "1";
  return id.startsWith("municipal-road-")
    ? `Civic Way ${sequence}`
    : `New Street ${sequence}`;
}

export function expansionRoadDisplayName(
  road: Pick<ExpansionRoad, "id" | "name">,
): string {
  return road.name?.trim() || defaultExpansionRoadName(road.id);
}
