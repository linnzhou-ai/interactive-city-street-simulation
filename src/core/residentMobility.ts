import type { ExpansionRoad } from "../models/types";
import type {
  DetailedBuilding,
  DetailedPerson,
  PersonActivity,
  PersonMobilityState,
  PersonScheduleItem,
  TravelMode,
} from "../models/entityTypes";

interface RoutePoint {
  x: number;
  z: number;
}

interface ResidentRoute {
  points: RoutePoint[];
  distanceMeters: number;
}

interface ActiveTrip {
  item: PersonScheduleItem;
  previous: PersonScheduleItem;
  departureMinute: number;
  expectedArrivalMinute: number;
  delayMinutes: number;
  route: ResidentRoute;
}

interface RoadGraphEdge {
  to: string;
  distance: number;
}

interface RoadGraph {
  points: Map<string, RoutePoint>;
  edges: Map<string, RoadGraphEdge[]>;
}

const OUTSIDE_DISTANCE = 720;
const ROAD_CONNECTION_DISTANCE = 150;

/**
 * Albert's sampled-resident movement adapted to the existing Chanyoung
 * expansion-road format. Active trips are cached for the day so changing
 * traffic or rebuilding the network cannot teleport a resident mid-trip.
 */
export class ResidentMobilitySystem {
  private readonly activeTrips = new Map<string, ActiveTrip>();
  private readonly routeCache = new Map<string, ResidentRoute>();
  private routeSignature = "";
  private activeDay = Number.NaN;

  reset(): void {
    this.activeTrips.clear();
    this.routeCache.clear();
    this.routeSignature = "";
    this.activeDay = Number.NaN;
  }

  update(
    people: readonly DetailedPerson[],
    buildings: readonly DetailedBuilding[],
    absoluteMinute: number,
    roads: readonly ExpansionRoad[],
  ): DetailedPerson[] {
    const day = Math.floor(absoluteMinute / 1440);
    const signature = roads
      .map(
        (road) =>
          `${road.id}:${road.startX}:${road.startZ}:${road.endX}:${road.endZ}`,
      )
      .join("|");
    if (day !== this.activeDay || signature !== this.routeSignature) {
      this.activeDay = day;
      this.routeSignature = signature;
      this.activeTrips.clear();
      this.routeCache.clear();
    }

    const minute = normalizeMinute(absoluteMinute);
    const buildingById = new Map(
      buildings.map((building) => [building.id, building]),
    );
    const roadGraph = createRoadGraph(roads);
    return people.map((person) => {
      const mobility = this.mobilityAt(
        person,
        buildingById,
        minute,
        day,
        roads,
        roadGraph,
      );
      return {
        ...person,
        currentActivity: mobility.activity,
        currentBuildingId:
          mobility.phase === "inside" || mobility.phase === "outside"
            ? mobility.destinationBuildingId
            : mobility.fromBuildingId,
        dailyTravelDelayMinutes: mobility.delayMinutes,
        mobility,
      };
    });
  }

  private mobilityAt(
    person: Readonly<DetailedPerson>,
    buildings: ReadonlyMap<string, DetailedBuilding>,
    minute: number,
    day: number,
    roads: readonly ExpansionRoad[],
    roadGraph: Readonly<RoadGraph>,
  ): PersonMobilityState {
    let current = person.schedule[0];
    if (!current) {
      return insideMobility(
        person.homeBuildingId,
        "home",
        buildingPoint(person.homeBuildingId, buildings, undefined),
      );
    }

    for (let index = 1; index < person.schedule.length; index += 1) {
      const destination = person.schedule[index];
      const cacheKey = `${day}:${person.id}:${index}:${current.buildingId}:${destination.buildingId}`;
      const calculated = this.createTrip(
        current,
        destination,
        buildings,
        roads,
        roadGraph,
      );
      const trip =
        minute >= calculated.departureMinute
          ? this.stableTrip(cacheKey, calculated)
          : calculated;
      if (minute < trip.departureMinute) {
        return this.insideAt(current, buildings, trip.route.points[0]);
      }
      if (
        destination.travelMinutes > 0 &&
        minute < trip.expectedArrivalMinute
      ) {
        return travelMobility(trip, minute);
      }
      current = destination;
    }
    return this.insideAt(current, buildings);
  }

  private stableTrip(key: string, trip: ActiveTrip): ActiveTrip {
    const cached = this.activeTrips.get(key);
    if (cached) return cached;
    this.activeTrips.set(key, trip);
    return trip;
  }

  private insideAt(
    item: Readonly<PersonScheduleItem>,
    buildings: ReadonlyMap<string, DetailedBuilding>,
    fallback?: RoutePoint,
  ): PersonMobilityState {
    const building = buildings.get(item.buildingId);
    const point =
      building ??
      fallback ??
      outsidePoint(item.buildingId, { x: 0, z: 0 });
    return {
      ...insideMobility(item.buildingId, item.activity, point),
      phase: building ? "inside" : "outside",
    };
  }

  private createTrip(
    previous: Readonly<PersonScheduleItem>,
    item: Readonly<PersonScheduleItem>,
    buildings: ReadonlyMap<string, DetailedBuilding>,
    roads: readonly ExpansionRoad[],
    graph: Readonly<RoadGraph>,
  ): ActiveTrip {
    const start = buildingPoint(previous.buildingId, buildings, undefined);
    const end = buildingPoint(item.buildingId, buildings, start);
    const routeKey = `${previous.buildingId}>${item.buildingId}:${item.mode}`;
    const route =
      this.routeCache.get(routeKey) ??
      routeBetween(start, end, roads, graph);
    this.routeCache.set(routeKey, route);
    const routedTravelMinutes =
      route.distanceMeters / travelSpeedMetersPerMinute(item.mode);
    const destination = buildings.get(item.buildingId);
    const accessDelay = destination
      ? Math.max(0, destination.accessibility.averageTravelMinutes - item.travelMinutes) *
        0.35
      : 2.5;
    const delayMinutes = round(
      clamp(
        Math.max(0, routedTravelMinutes - item.travelMinutes) + accessDelay,
        0,
        45,
      ),
    );
    return {
      item: { ...item },
      previous: { ...previous },
      departureMinute: Math.max(
        previous.startMinute,
        item.startMinute - item.travelMinutes,
      ),
      expectedArrivalMinute: item.startMinute + delayMinutes,
      delayMinutes,
      route,
    };
  }
}

function insideMobility(
  buildingId: string,
  activity: PersonActivity,
  point: Readonly<RoutePoint>,
): PersonMobilityState {
  return {
    phase: "inside",
    mode: "walk",
    activity,
    fromBuildingId: buildingId,
    destinationBuildingId: buildingId,
    routeProgress: 1,
    departureMinute: 0,
    scheduledArrivalMinute: 0,
    expectedArrivalMinute: 0,
    delayMinutes: 0,
    routePoints: [{ x: point.x, z: point.z }],
    x: point.x,
    z: point.z,
    heading: 0,
  };
}

function travelMobility(
  trip: Readonly<ActiveTrip>,
  minute: number,
): PersonMobilityState {
  const duration = Math.max(
    0.25,
    trip.expectedArrivalMinute - trip.departureMinute,
  );
  const progress = clamp((minute - trip.departureMinute) / duration, 0, 1);
  const position = positionAlongRoute(trip.route, progress);
  return {
    phase:
      trip.item.mode === "walk"
        ? "walking"
        : trip.item.mode === "car"
          ? "driving"
          : "transit",
    mode: trip.item.mode,
    activity: trip.item.activity,
    fromBuildingId: trip.previous.buildingId,
    destinationBuildingId: trip.item.buildingId,
    routeProgress: progress,
    departureMinute: trip.departureMinute,
    scheduledArrivalMinute: trip.item.startMinute,
    expectedArrivalMinute: trip.expectedArrivalMinute,
    delayMinutes: trip.delayMinutes,
    routePoints: trip.route.points.map((point) => ({ ...point })),
    ...position,
  };
}

function routeBetween(
  start: Readonly<RoutePoint>,
  end: Readonly<RoutePoint>,
  roads: readonly ExpansionRoad[],
  graph: Readonly<RoadGraph>,
): ResidentRoute {
  const startRoad = nearestRoadEndpoint(start, roads);
  const endRoad = nearestRoadEndpoint(end, roads);
  if (
    startRoad &&
    endRoad &&
    startRoad.distance <= ROAD_CONNECTION_DISTANCE &&
    endRoad.distance <= ROAD_CONNECTION_DISTANCE
  ) {
    const path = shortestPath(startRoad.key, endRoad.key, graph);
    if (path.length > 0) {
      return routeFromPoints([
        { ...start },
        ...path.map((key) => graph.points.get(key)).filter(isRoutePoint),
        { ...end },
      ]);
    }
  }

  const horizontalFirst =
    stableHash(`${Math.round(start.x)}:${Math.round(end.z)}`) % 2 === 0;
  const corner = horizontalFirst
    ? { x: end.x, z: start.z }
    : { x: start.x, z: end.z };
  return routeFromPoints([{ ...start }, corner, { ...end }]);
}

function createRoadGraph(roads: readonly ExpansionRoad[]): RoadGraph {
  const graph: RoadGraph = { points: new Map(), edges: new Map() };
  for (const road of roads) {
    const start = roadNodeKey(road.startX, road.startZ);
    const end = roadNodeKey(road.endX, road.endZ);
    graph.points.set(start, { x: road.startX, z: road.startZ });
    graph.points.set(end, { x: road.endX, z: road.endZ });
    const distance = Math.hypot(
      road.endX - road.startX,
      road.endZ - road.startZ,
    );
    addGraphEdge(graph, start, end, distance);
    addGraphEdge(graph, end, start, distance);
  }
  return graph;
}

function addGraphEdge(
  graph: RoadGraph,
  from: string,
  to: string,
  distance: number,
): void {
  const edges = graph.edges.get(from) ?? [];
  edges.push({ to, distance });
  graph.edges.set(from, edges);
}

function nearestRoadEndpoint(
  point: Readonly<RoutePoint>,
  roads: readonly ExpansionRoad[],
): { key: string; distance: number } | null {
  let nearest: { key: string; distance: number } | null = null;
  for (const road of roads) {
    for (const candidate of [
      { x: road.startX, z: road.startZ },
      { x: road.endX, z: road.endZ },
    ]) {
      const distance = Math.hypot(point.x - candidate.x, point.z - candidate.z);
      if (!nearest || distance < nearest.distance) {
        nearest = { key: roadNodeKey(candidate.x, candidate.z), distance };
      }
    }
  }
  return nearest;
}

function shortestPath(
  start: string,
  end: string,
  graph: Readonly<RoadGraph>,
): string[] {
  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set(graph.points.keys());
  while (pending.size > 0) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const key of pending) {
      const distance = distances.get(key) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = key;
        currentDistance = distance;
      }
    }
    if (!current || !Number.isFinite(currentDistance)) break;
    pending.delete(current);
    if (current === end) break;
    for (const edge of graph.edges.get(current) ?? []) {
      if (!pending.has(edge.to)) continue;
      const candidate = currentDistance + edge.distance;
      if (candidate < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, current);
      }
    }
  }
  if (!distances.has(end)) return [];
  const result = [end];
  while (result[0] !== start) {
    const prior = previous.get(result[0]);
    if (!prior) return [];
    result.unshift(prior);
  }
  return result;
}

function routeFromPoints(points: RoutePoint[]): ResidentRoute {
  const compact = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point.x - points[index - 1].x,
        point.z - points[index - 1].z,
      ) > 0.1,
  );
  return {
    points: compact,
    distanceMeters: compact.slice(1).reduce(
      (total, point, index) =>
        total +
        Math.hypot(
          point.x - compact[index].x,
          point.z - compact[index].z,
        ),
      0,
    ),
  };
}

function positionAlongRoute(
  route: Readonly<ResidentRoute>,
  progress: number,
): { x: number; z: number; heading: number } {
  if (route.points.length < 2) {
    const point = route.points[0] ?? { x: 0, z: 0 };
    return { ...point, heading: 0 };
  }
  let remaining = route.distanceMeters * clamp(progress, 0, 1);
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (remaining <= length || index === route.points.length - 1) {
      const localProgress = clamp(remaining / Math.max(0.01, length), 0, 1);
      return {
        x: start.x + (end.x - start.x) * localProgress,
        z: start.z + (end.z - start.z) * localProgress,
        heading: Math.atan2(end.x - start.x, end.z - start.z),
      };
    }
    remaining -= length;
  }
  const end = route.points.at(-1) ?? { x: 0, z: 0 };
  return { ...end, heading: 0 };
}

function buildingPoint(
  id: string,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  origin: Readonly<RoutePoint> | undefined,
): RoutePoint {
  const building = buildings.get(id);
  if (building) return { x: building.x, z: building.z };
  return outsidePoint(id, origin ?? { x: 0, z: 0 });
}

function outsidePoint(
  id: string,
  origin: Readonly<RoutePoint>,
): RoutePoint {
  const angle = (stableHash(id) / 4_294_967_295) * Math.PI * 2;
  return {
    x: origin.x + Math.cos(angle) * OUTSIDE_DISTANCE,
    z: origin.z + Math.sin(angle) * OUTSIDE_DISTANCE,
  };
}

function travelSpeedMetersPerMinute(mode: TravelMode): number {
  if (mode === "walk") return 78;
  if (mode === "transit") return 280;
  return 420;
}

function roadNodeKey(x: number, z: number): string {
  return `${x.toFixed(2)}:${z.toFixed(2)}`;
}

function normalizeMinute(minute: number): number {
  return ((minute % 1440) + 1440) % 1440;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function isRoutePoint(
  point: RoutePoint | undefined,
): point is RoutePoint {
  return point !== undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
