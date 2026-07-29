import type {
  DetailedBuilding,
  DetailedPerson,
  PersonMobilityOutcome,
  PersonMobilityState,
  PersonScheduleItem,
  TravelMode,
} from "../models/entityTypes";
import type {
  MobilityDetailMode,
  PedestrianSnapshot,
  RoadTrafficSnapshot,
  VehicleSnapshot,
} from "../models/types";
import type { TrafficRoutePath } from "./liveTraffic";

const OUTSIDE_WORK = "outside-work";
const OUTSIDE_MARKET = "outside-market";
const CAR_ID_OFFSET = 1_000_000;
const PEDESTRIAN_ID_OFFSET = 2_000_000;
const TRANSIT_ID_OFFSET = 3_000_000;

export interface SampledMobilityResult {
  people: DetailedPerson[];
  vehicles: VehicleSnapshot[];
  pedestrians: PedestrianSnapshot[];
  outcomes: ReadonlyMap<string, PersonMobilityOutcome>;
}

export type SampledRouteProvider = (
  fromBuildingId: string,
  toBuildingId: string,
  mode: TravelMode,
) => TrafficRoutePath;

interface ActiveTrip {
  item: PersonScheduleItem;
  previous: PersonScheduleItem;
  departureMinute: number;
  expectedArrivalMinute: number;
  delayMinutes: number;
  route: TrafficRoutePath;
}

export class SampledMobilitySystem {
  private readonly routeCache = new Map<string, TrafficRoutePath>();
  private readonly activeTripCache = new Map<string, ActiveTrip>();
  private activeTripDay = Number.NaN;

  invalidateRoutes(): void {
    this.routeCache.clear();
    this.activeTripCache.clear();
  }

  update(
    people: readonly DetailedPerson[],
    buildings: readonly DetailedBuilding[],
    minuteOfDay: number,
    detailMode: MobilityDetailMode,
    roadTraffic: readonly RoadTrafficSnapshot[],
    fallbackRouteDelayMinutes: number,
    routeProvider: SampledRouteProvider,
  ): SampledMobilityResult {
    const day = Math.floor(minuteOfDay / 1440);
    if (day !== this.activeTripDay) {
      this.activeTripDay = day;
      this.activeTripCache.clear();
    }
    const normalizedMinute = normalizeMinute(minuteOfDay);
    const buildingById = new Map(buildings.map((building) => [building.id, building]));
    const trafficBySegment = new Map(roadTraffic.map((road) => [road.segmentId, road]));
    const pedestrians: PedestrianSnapshot[] = [];
    const vehiclesById = new Map<number, VehicleSnapshot>();
    const outcomes = new Map<string, PersonMobilityOutcome>();
    const nextPeople = people.map((person) => {
      outcomes.set(
        person.id,
        this.dailyOutcome(
          person,
          trafficBySegment,
          fallbackRouteDelayMinutes,
          routeProvider,
        ),
      );
      const mobility = this.mobilityAt(
        person,
        buildingById,
        normalizedMinute,
        trafficBySegment,
        fallbackRouteDelayMinutes,
        routeProvider,
        day,
      );
      if (mobility.phase === "walking") {
        pedestrians.push(this.pedestrianSnapshot(person, mobility, detailMode));
      } else if (mobility.phase === "driving" || mobility.phase === "transit") {
        const vehicleId = mobility.vehicleId as number;
        const existing = vehiclesById.get(vehicleId);
        if (existing) {
          existing.occupantPersonIds = [
            ...(existing.occupantPersonIds ?? []),
            person.id,
          ];
        } else {
          vehiclesById.set(
            vehicleId,
            this.vehicleSnapshot(person, mobility, detailMode),
          );
        }
      }
      return {
        ...person,
        currentActivity: mobility.activity,
        currentBuildingId: mobility.phase === "inside" || mobility.phase === "outside"
          ? mobility.destinationBuildingId
          : mobility.fromBuildingId,
        mobility,
      };
    });
    return {
      people: nextPeople,
      vehicles: [...vehiclesById.values()],
      pedestrians,
      outcomes,
    };
  }

  private mobilityAt(
    person: Readonly<DetailedPerson>,
    buildings: ReadonlyMap<string, DetailedBuilding>,
    minute: number,
    traffic: ReadonlyMap<string, RoadTrafficSnapshot>,
    fallbackRouteDelayMinutes: number,
    routeProvider: SampledRouteProvider,
    day: number,
  ): PersonMobilityState {
    const schedule = person.schedule;
    let current = schedule[0];
    if (!current) {
      const home = buildings.get(person.homeBuildingId);
      return insideMobility(person.homeBuildingId, "home", home?.x ?? 0, home?.z ?? 0);
    }
    for (let index = 1; index < schedule.length; index += 1) {
      const destination = schedule[index];
      const calculatedTrip = this.tripFor(
        current,
        destination,
        traffic,
        fallbackRouteDelayMinutes,
        routeProvider,
      );
      const trip = minute >= calculatedTrip.departureMinute
        ? this.stableTrip(person.id, day, index, calculatedTrip)
        : calculatedTrip;
      if (minute < trip.departureMinute) {
        return this.insideAt(current, person, buildings, routeProvider);
      }
      if (
        destination.travelMinutes > 0
        && minute < trip.expectedArrivalMinute
      ) {
        return this.travelMobility(person, trip, minute);
      }
      current = destination;
    }
    return this.insideAt(current, person, buildings, routeProvider);
  }

  private stableTrip(
    personId: string,
    day: number,
    scheduleIndex: number,
    trip: Readonly<ActiveTrip>,
  ): ActiveTrip {
    const key = `${day}:${personId}:${scheduleIndex}:${trip.previous.buildingId}:${trip.item.buildingId}`;
    const cached = this.activeTripCache.get(key);
    if (cached) return cached;
    const stable = { ...trip };
    this.activeTripCache.set(key, stable);
    return stable;
  }

  private insideAt(
    item: Readonly<PersonScheduleItem>,
    person: Readonly<DetailedPerson>,
    buildings: ReadonlyMap<string, DetailedBuilding>,
    routeProvider: SampledRouteProvider,
  ): PersonMobilityState {
    const building = buildings.get(item.buildingId);
    if (building) {
      return insideMobility(item.buildingId, item.activity, building.x, building.z);
    }
    const previous = [...person.schedule]
      .reverse()
      .find((candidate) => candidate.buildingId !== item.buildingId);
    const route = previous
      ? this.route(previous.buildingId, item.buildingId, item.mode, routeProvider)
      : { points: [{ x: 0, z: 0 }], segmentIds: [], distanceMeters: 0 };
    const point = route.points.at(-1) ?? { x: 0, z: 0 };
    return {
      ...insideMobility(item.buildingId, item.activity, point.x, point.z),
      phase: item.buildingId === OUTSIDE_WORK || item.buildingId === OUTSIDE_MARKET
        ? "outside"
        : "inside",
    };
  }

  private travelMobility(
    person: Readonly<DetailedPerson>,
    trip: Readonly<ActiveTrip>,
    minute: number,
  ): PersonMobilityState {
    const duration = Math.max(0.25, trip.expectedArrivalMinute - trip.departureMinute);
    const progress = clamp((minute - trip.departureMinute) / duration, 0, 1);
    const personNumber = numericPersonId(person.id);
    const vehicleId = trip.item.mode === "car"
      ? CAR_ID_OFFSET + hashInteger(
          `${person.householdId}:${trip.previous.buildingId}:${trip.item.buildingId}:${Math.floor(trip.departureMinute / 5)}`,
        ) % 900_000
      : trip.item.mode === "transit"
        ? TRANSIT_ID_OFFSET + hashInteger(
            `${trip.previous.buildingId}:${trip.item.buildingId}:${Math.floor(trip.departureMinute / 10)}`,
          ) % 800_000
        : undefined;
    const spacingOffset = vehicleId === undefined
      ? ((personNumber % 5) - 2) * 0.9
      : ((vehicleId % 7) - 3) * 4.5;
    const visualProgress = clamp(
      progress + spacingOffset / Math.max(20, trip.route.distanceMeters),
      0,
      1,
    );
    const routePosition = positionAlongRoute(
      trip.route,
      visualProgress,
      trip.item.mode,
    );
    return {
      phase: trip.item.mode === "walk"
        ? "walking"
        : trip.item.mode === "car" ? "driving" : "transit",
      mode: trip.item.mode,
      activity: trip.item.activity,
      fromBuildingId: trip.previous.buildingId,
      destinationBuildingId: trip.item.buildingId,
      routeProgress: progress,
      departureMinute: trip.departureMinute,
      scheduledArrivalMinute: trip.item.startMinute,
      expectedArrivalMinute: trip.expectedArrivalMinute,
      delayMinutes: trip.delayMinutes,
      segmentId: routePosition.segmentId,
      vehicleId,
      x: routePosition.x,
      z: routePosition.z,
      heading: routePosition.heading,
    };
  }

  private tripFor(
    previous: Readonly<PersonScheduleItem>,
    item: Readonly<PersonScheduleItem>,
    traffic: ReadonlyMap<string, RoadTrafficSnapshot>,
    fallbackRouteDelayMinutes: number,
    routeProvider: SampledRouteProvider,
  ): ActiveTrip {
    const route = this.route(previous.buildingId, item.buildingId, item.mode, routeProvider);
    const trafficDelayMinutes = routeDelayMinutes(
      route,
      item.mode,
      traffic,
      fallbackRouteDelayMinutes,
    );
    const routedTravelMinutes = route.distanceMeters / travelSpeedMetersPerMinute(item.mode);
    const routeLengthDelayMinutes = Math.max(
      0,
      routedTravelMinutes - item.travelMinutes,
    );
    const delayMinutes = round(clamp(
      trafficDelayMinutes + routeLengthDelayMinutes,
      0,
      60,
    ));
    return {
      item,
      previous,
      departureMinute: Math.max(previous.startMinute, item.startMinute - item.travelMinutes),
      expectedArrivalMinute: item.startMinute + delayMinutes,
      delayMinutes,
      route,
    };
  }

  private dailyOutcome(
    person: Readonly<DetailedPerson>,
    traffic: ReadonlyMap<string, RoadTrafficSnapshot>,
    fallbackRouteDelayMinutes: number,
    routeProvider: SampledRouteProvider,
  ): PersonMobilityOutcome {
    let workAttendance = 1;
    let completedVisits = 0;
    let scheduledVisits = 0;
    let totalDelay = 0;
    let extraTransportCost = 0;
    for (let index = 1; index < person.schedule.length; index += 1) {
      const previous = person.schedule[index - 1];
      const item = person.schedule[index];
      const trip = this.tripFor(
        previous,
        item,
        traffic,
        fallbackRouteDelayMinutes,
        routeProvider,
      );
      totalDelay += trip.delayMinutes;
      if (item.mode === "car") extraTransportCost += trip.delayMinutes * 0.22;
      if (item.mode === "transit") extraTransportCost += trip.delayMinutes * 0.09;
      const availableMinutes = Math.max(1, item.endMinute - item.startMinute);
      const completion = clamp(1 - trip.delayMinutes / availableMinutes, 0, 1);
      if (item.activity === "work") workAttendance = Math.min(workAttendance, completion);
      if (["shop", "library", "healthcare", "leisure", "school"].includes(item.activity)) {
        scheduledVisits += 1;
        completedVisits += completion;
      }
    }
    return {
      attendanceRatio: round(workAttendance),
      visitCompletionRatio: round(
        scheduledVisits === 0 ? 1 : completedVisits / scheduledVisits,
      ),
      delayMinutes: round(totalDelay),
      extraTransportCost: round(extraTransportCost),
    };
  }

  private route(
    fromBuildingId: string,
    toBuildingId: string,
    mode: TravelMode,
    provider: SampledRouteProvider,
  ): TrafficRoutePath {
    const key = `${fromBuildingId}>${toBuildingId}:${mode}`;
    const cached = this.routeCache.get(key);
    if (cached) return cached;
    const route = provider(fromBuildingId, toBuildingId, mode);
    this.routeCache.set(key, route);
    return route;
  }

  private vehicleSnapshot(
    person: Readonly<DetailedPerson>,
    mobility: Readonly<PersonMobilityState>,
    detailMode: MobilityDetailMode,
  ): VehicleSnapshot {
    const transit = mobility.phase === "transit";
    return {
      id: mobility.vehicleId as number,
      segmentId: mobility.segmentId ?? "off-network",
      laneId: `${mobility.segmentId ?? "off-network"}:sampled`,
      x: mobility.x,
      z: mobility.z,
      heading: mobility.heading,
      speedMetersPerSecond: detailMode === "outcome"
        ? 0
        : transit ? 8.5 : 10.5,
      queued: mobility.delayMinutes > 2 && mobility.routeProgress > 0.35,
      kind: transit ? "bus" : "compact",
      color: transit ? "#d6b34b" : personColor(person.id),
      complianceProbability: 1,
      violating: false,
      source: "sampled-resident",
      driverPersonId: transit ? undefined : person.id,
      occupantPersonIds: [person.id],
      destinationBuildingId: mobility.destinationBuildingId,
      purpose: mobility.activity,
      delaySeconds: mobility.delayMinutes * 60,
    };
  }

  private pedestrianSnapshot(
    person: Readonly<DetailedPerson>,
    mobility: Readonly<PersonMobilityState>,
    detailMode: MobilityDetailMode,
  ): PedestrianSnapshot {
    const number = numericPersonId(person.id);
    return {
      id: PEDESTRIAN_ID_OFFSET + number,
      segmentId: mobility.segmentId ?? "off-network",
      x: mobility.x,
      z: mobility.z,
      heading: mobility.heading,
      waiting: detailMode === "outcome" || mobility.delayMinutes > 1.5,
      color: personColor(person.id),
      variant: number % 4,
      complianceProbability: 1,
      violating: false,
      source: "sampled-resident",
      personId: person.id,
      destinationBuildingId: mobility.destinationBuildingId,
      purpose: mobility.activity,
      delaySeconds: mobility.delayMinutes * 60,
    };
  }
}

function insideMobility(
  buildingId: string,
  activity: PersonMobilityState["activity"],
  x: number,
  z: number,
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
    x,
    z,
    heading: 0,
  };
}

function routeDelayMinutes(
  route: Readonly<TrafficRoutePath>,
  mode: TravelMode,
  traffic: ReadonlyMap<string, RoadTrafficSnapshot>,
  fallbackRouteDelayMinutes: number,
): number {
  const multiplier = mode === "walk" ? 0.12 : mode === "transit" ? 0.72 : 1;
  const measuredDelay = route.segmentIds.reduce(
    (total, segmentId) => total + (traffic.get(segmentId)?.averageDelaySeconds ?? 0),
    0,
  ) / 60;
  const delay = (measuredDelay > 0 ? measuredDelay : fallbackRouteDelayMinutes)
    * multiplier;
  return round(clamp(delay, 0, 35));
}

function travelSpeedMetersPerMinute(mode: TravelMode): number {
  if (mode === "walk") return 78;
  if (mode === "transit") return 280;
  return 420;
}

function positionAlongRoute(
  route: Readonly<TrafficRoutePath>,
  progress: number,
  mode: TravelMode,
): { x: number; z: number; heading: number; segmentId: string } {
  if (route.points.length < 2) {
    const point = route.points[0] ?? { x: 0, z: 0 };
    return { ...point, heading: 0, segmentId: route.segmentIds[0] ?? "off-network" };
  }
  const lengths = route.points.slice(1).map((point, index) => Math.hypot(
    point.x - route.points[index].x,
    point.z - route.points[index].z,
  ));
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  let remaining = totalLength * clamp(progress, 0, 1);
  let segmentIndex = 0;
  while (segmentIndex < lengths.length - 1 && remaining > lengths[segmentIndex]) {
    remaining -= lengths[segmentIndex];
    segmentIndex += 1;
  }
  const start = route.points[segmentIndex];
  const end = route.points[segmentIndex + 1];
  const length = Math.max(0.01, lengths[segmentIndex]);
  const localProgress = clamp(remaining / length, 0, 1);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const offset = mode === "walk" ? 7.2 : mode === "car" ? 2.7 : -2.7;
  const offsetStart = offsetRouteVertex(route.points, segmentIndex, offset);
  const offsetEnd = offsetRouteVertex(route.points, segmentIndex + 1, offset);
  return {
    x: offsetStart.x + (offsetEnd.x - offsetStart.x) * localProgress,
    z: offsetStart.z + (offsetEnd.z - offsetStart.z) * localProgress,
    heading: Math.atan2(dx, dz),
    segmentId: route.segmentIds[segmentIndex] ?? "off-network",
  };
}

function offsetRouteVertex(
  points: ReadonlyArray<{ x: number; z: number }>,
  index: number,
  offset: number,
): { x: number; z: number } {
  const point = points[index];
  const incoming = index > 0
    ? segmentNormal(points[index - 1], point)
    : undefined;
  const outgoing = index < points.length - 1
    ? segmentNormal(point, points[index + 1])
    : undefined;
  const normal = incoming && outgoing
    ? miterNormal(incoming, outgoing, offset)
    : incoming
      ? { x: incoming.x * offset, z: incoming.z * offset }
      : outgoing
        ? { x: outgoing.x * offset, z: outgoing.z * offset }
        : { x: 0, z: 0 };
  return { x: point.x + normal.x, z: point.z + normal.z };
}

function segmentNormal(
  start: Readonly<{ x: number; z: number }>,
  end: Readonly<{ x: number; z: number }>,
): { x: number; z: number } {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.max(0.01, Math.hypot(dx, dz));
  return { x: dz / length, z: -dx / length };
}

function miterNormal(
  incoming: Readonly<{ x: number; z: number }>,
  outgoing: Readonly<{ x: number; z: number }>,
  offset: number,
): { x: number; z: number } {
  const x = incoming.x + outgoing.x;
  const z = incoming.z + outgoing.z;
  const length = Math.hypot(x, z);
  if (length < 0.01) {
    return { x: outgoing.x * offset, z: outgoing.z * offset };
  }
  const unit = { x: x / length, z: z / length };
  const denominator = unit.x * incoming.x + unit.z * incoming.z;
  const miterLength = Math.abs(denominator) < 0.25
    ? offset
    : clamp(offset / denominator, -Math.abs(offset) * 2, Math.abs(offset) * 2);
  return { x: unit.x * miterLength, z: unit.z * miterLength };
}

function normalizeMinute(minute: number): number {
  return ((minute % 1440) + 1440) % 1440;
}

function numericPersonId(id: string): number {
  const value = Number(id.replace("person-", ""));
  return Number.isFinite(value) ? value : hashInteger(id) % 900_000;
}

function personColor(id: string): string {
  return ["#236f75", "#b65a4b", "#d4a646", "#735483", "#39684e"][
    numericPersonId(id) % 5
  ];
}

function hashInteger(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
