import { PENN_ROAD_GRAPH } from "../data/pennRoadGraph";
import type {
  BuildingConnectionKind,
  BuildingRoadTrafficImpact,
  BuildingTrafficAttribution,
  DetailedEntityState,
  EntityConnection,
  TravelMode,
} from "../models/entityTypes";
import type { RoadTrafficSnapshot } from "../models/types";

type RouteResolver = (connection: Readonly<EntityConnection>) => readonly string[];
type RoadDescriptionResolver = (
  segmentId: string,
) => { name: string; description: string } | undefined;

interface MutableRoadImpact extends Omit<BuildingRoadTrafficImpact, "kinds"> {
  kinds: Set<BuildingConnectionKind>;
  burden: number;
}

export function calculateBuildingTrafficAttribution(
  buildingId: string,
  entities: Readonly<DetailedEntityState>,
  roadTraffic: readonly RoadTrafficSnapshot[],
  cityCongestionPercent: number,
  resolveRoute: RouteResolver,
  resolveRoad?: RoadDescriptionResolver,
): BuildingTrafficAttribution | null {
  const building = entities.buildings.find((candidate) => candidate.id === buildingId);
  if (!building) return null;

  const connections = entities.connections.filter((connection) =>
    connection.fromBuildingId === buildingId || connection.toBuildingId === buildingId
  );
  const trafficById = new Map(roadTraffic.map((road) => [road.segmentId, road]));
  const featureById = new Map(PENN_ROAD_GRAPH.map((feature) => [feature.id, feature]));
  const peopleById = new Map(entities.people.map((person) => [person.id, person]));
  const impacts = new Map<string, MutableRoadImpact>();
  let roadTripsDaily = 0;
  let routedVehicleTripsDaily = 0;
  let weightedRouteDelaySeconds = 0;
  let workVehicleTripsDaily = 0;
  let visitVehicleTripsDaily = 0;
  let deliveryVehicleTripsDaily = 0;

  for (const connection of connections) {
    const segments = resolveRoute(connection);
    if (segments.length === 0) continue;
    const trips = connectionRoadTrips(connection, peopleById);
    if (trips <= 0.01) continue;
    if (connection.kind === "work") workVehicleTripsDaily += trips;
    else if (connection.kind === "visit") visitVehicleTripsDaily += trips;
    else deliveryVehicleTripsDaily += trips;
    routedVehicleTripsDaily += trips;
    roadTripsDaily += trips * segments.length;
    let routeDelaySeconds = 0;
    for (const segmentId of segments) {
      const traffic = trafficById.get(segmentId);
      const feature = featureById.get(segmentId);
      const roadDescription = resolveRoad?.(segmentId);
      if (!traffic || (!feature && !roadDescription)) continue;
      routeDelaySeconds += traffic.averageDelaySeconds;
      const existing = impacts.get(segmentId) ?? {
        segmentId,
        roadName: feature?.name ?? roadDescription?.name ?? segmentId,
        description: feature?.description ?? roadDescription?.description ?? "User-built road",
        kinds: new Set<BuildingConnectionKind>(),
        roadTripsDaily: 0,
        congestionPercent: traffic.congestionPercent,
        averageDelaySeconds: traffic.averageDelaySeconds,
        averageSpeedMph: traffic.averageSpeedMph,
        queuedVehicles: traffic.queuedVehicles,
        attributedCongestionCost: 0,
        burden: 0,
      };
      existing.kinds.add(connection.kind);
      existing.roadTripsDaily += trips;
      impacts.set(segmentId, existing);
    }
    weightedRouteDelaySeconds += routeDelaySeconds * trips;
  }

  const residentIds = new Set(building.residentIds);
  const residents = entities.people.filter((person) => residentIds.has(person.id));
  const residentCommuteCost = round(residents.reduce(
    (total, person) => total + person.commuteCost,
    0,
  ));
  const deliveryTransportCost = round(building.accounting.transportCost);
  const congestionRatio = Math.max(0, cityCongestionPercent) / 100;
  const deliveryBase = deliveryTransportCost / (1 + congestionRatio * 1.5);
  const commuteBase = residents.reduce(
    (total, person) => total + (person.employment === "local"
      ? person.commuteCost / (1 + congestionRatio * 1.35)
      : person.commuteCost),
    0,
  );
  const totalTransportCost = round(deliveryTransportCost + residentCommuteCost);
  const baseTransportCost = round(deliveryBase + commuteBase);
  const congestionSurcharge = round(Math.max(0, totalTransportCost - baseTransportCost));

  for (const impact of impacts.values()) {
    const queueShare = impact.queuedVehicles / Math.max(1, trafficById.get(impact.segmentId)?.activeVehicles ?? 0);
    impact.burden = impact.roadTripsDaily * (
      0.15
      + impact.congestionPercent / 100
      + impact.averageDelaySeconds / 60
      + queueShare * 0.4
    );
  }
  const totalBurden = [...impacts.values()].reduce((total, impact) => total + impact.burden, 0);
  const roads = [...impacts.values()]
    .map((impact): BuildingRoadTrafficImpact => ({
      segmentId: impact.segmentId,
      roadName: impact.roadName,
      description: impact.description,
      kinds: [...impact.kinds],
      roadTripsDaily: round(impact.roadTripsDaily),
      congestionPercent: impact.congestionPercent,
      averageDelaySeconds: impact.averageDelaySeconds,
      averageSpeedMph: impact.averageSpeedMph,
      queuedVehicles: impact.queuedVehicles,
      attributedCongestionCost: round(
        totalBurden > 0 ? congestionSurcharge * impact.burden / totalBurden : 0,
      ),
    }))
    .sort((left, right) =>
      right.attributedCongestionCost - left.attributedCongestionCost
      || right.congestionPercent - left.congestionPercent
      || right.roadTripsDaily - left.roadTripsDaily
    );

  return {
    buildingId,
    workVehicleTripsDaily: round(workVehicleTripsDaily),
    visitVehicleTripsDaily: round(visitVehicleTripsDaily),
    deliveryVehicleTripsDaily: round(deliveryVehicleTripsDaily),
    roadTripsDaily: round(roadTripsDaily),
    deliveryTransportCost,
    residentCommuteCost,
    totalTransportCost,
    baseTransportCost,
    congestionSurcharge,
    averageRouteDelayMinutes: round(
      routedVehicleTripsDaily > 0
        ? weightedRouteDelaySeconds / routedVehicleTripsDaily / 60
        : 0,
    ),
    roads,
  };
}

function connectionRoadTrips(
  connection: Readonly<EntityConnection>,
  peopleById: ReadonlyMap<string, DetailedEntityState["people"][number]>,
): number {
  if (connection.kind === "delivery") return Math.max(0.25, connection.volume / 18) * 2;
  const modes = connection.personIds.flatMap((personId) => {
    const person = peopleById.get(personId);
    if (!person) return [];
    for (let index = 1; index < person.schedule.length; index += 1) {
      const previous = person.schedule[index - 1];
      const current = person.schedule[index];
      if (previous.buildingId === connection.fromBuildingId && current.buildingId === connection.toBuildingId) {
        return [current.mode];
      }
    }
    return [];
  });
  const carShare = modes.length > 0
    ? modes.filter((mode: TravelMode) => mode === "car").length / modes.length
    : 0.42;
  const inferredRoundTrip = connection.personIds.length === 0 ? 2 : 1;
  return connection.volume * carShare * inferredRoundTrip;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
