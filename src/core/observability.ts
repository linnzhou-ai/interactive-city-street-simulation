import type { BuildingConnection, Person, TripRequest } from "../models/types";

interface MutableConnection {
  kind: BuildingConnection["kind"];
  fromBuildingId: string;
  toBuildingId: string;
  volume: number;
  personIds: Set<string>;
}

export function deriveBuildingConnections(
  people: readonly Person[],
  freightRequests: readonly TripRequest[],
): BuildingConnection[] {
  const connections = new Map<string, MutableConnection>();

  for (const person of people) {
    if (person.workBuildingId !== undefined) {
      addConnection(connections, "commute", person.homeBuildingId, person.workBuildingId, 1, person.id);
    }
    const visitBuildingIds = new Set(person.schedule
      .filter((activity) =>
        activity.activity === "shopping"
        || activity.activity === "school"
        || activity.activity === "library"
        || activity.activity === "healthcare"
        || activity.activity === "leisure"
      )
      .map((activity) => activity.buildingId));
    for (const buildingId of visitBuildingIds) {
      addConnection(connections, "customer", person.homeBuildingId, buildingId, 1, person.id);
    }
  }

  for (const request of freightRequests) {
    if (request.mode !== "freight" || request.cargoUnits <= 0) continue;
    addConnection(
      connections,
      "supply",
      request.originBuildingId,
      request.destinationBuildingId,
      request.cargoUnits,
    );
  }

  return [...connections.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, connection]) => ({
      id,
      kind: connection.kind,
      fromBuildingId: connection.fromBuildingId,
      toBuildingId: connection.toBuildingId,
      volume: round(connection.volume),
      personIds: [...connection.personIds].sort(),
    }));
}

function addConnection(
  connections: Map<string, MutableConnection>,
  kind: BuildingConnection["kind"],
  fromBuildingId: string,
  toBuildingId: string,
  volume: number,
  personId?: string,
): void {
  if (fromBuildingId === toBuildingId) return;
  const id = `${kind}:${fromBuildingId}:${toBuildingId}`;
  const connection = connections.get(id) ?? {
    kind,
    fromBuildingId,
    toBuildingId,
    volume: 0,
    personIds: new Set<string>(),
  };
  connection.volume += volume;
  if (personId !== undefined) connection.personIds.add(personId);
  connections.set(id, connection);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
