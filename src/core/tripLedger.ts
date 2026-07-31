import type {
  BuildingTripSummary,
  DetailedBuilding,
  DetailedHousehold,
  DetailedPerson,
  IntegrityStatus,
  SimulationIntegrityCheck,
  TripEndpoint,
  TripLedgerDailyAggregate,
  TripLedgerSnapshot,
  TripPurpose,
  TripRecord,
  TravelMode,
} from "../models/entityTypes";
import type {
  PedestrianSnapshot,
  SimulationMetrics,
  VehicleSnapshot,
} from "../models/types";
import type { CitySectionState } from "../models/cityTypes";

const RETAINED_SIMULATED_DAYS = 2;

export const EMPTY_TRIP_LEDGER: TripLedgerSnapshot = {
  records: [],
  dailyAggregates: [],
  buildingSummaries: [],
  summary: {
    activeTrips: 0,
    completedTrips: 0,
    localTrips: 0,
    externalTrips: 0,
    byMode: { walk: 0, car: 0, transit: 0 },
    byPurpose: {
      work: 0,
      shopping: 0,
      service: 0,
      recreation: 0,
      delivery: 0,
      through: 0,
    },
  },
  integrity: {
    status: "verified",
    checks: [],
  },
};

export interface TripLedgerUpdate {
  minute: number;
  people: readonly DetailedPerson[];
  buildings: readonly DetailedBuilding[];
  households: readonly DetailedHousehold[];
  vehicles: readonly VehicleSnapshot[];
  pedestrians: readonly PedestrianSnapshot[];
  trafficMetrics: Readonly<SimulationMetrics>;
  city: Readonly<CitySectionState>;
}

export class TripLedgerSystem {
  private records = new Map<string, TripRecord>();
  private completedExternalBuildingArrivals = 0;
  private removedRoadIds = new Set<string>();
  private dailyAggregates = new Map<number, TripLedgerDailyAggregate>();

  reset(): void {
    this.records.clear();
    this.completedExternalBuildingArrivals = 0;
    this.removedRoadIds.clear();
    this.dailyAggregates.clear();
  }

  markRoadsRemoved(roadIds: readonly string[]): void {
    for (const roadId of roadIds) this.removedRoadIds.add(roadId);
  }

  update(input: Readonly<TripLedgerUpdate>): TripLedgerSnapshot {
    const active = this.activeRecords(input);
    for (const [id, record] of active) {
      const previous = this.records.get(id);
      const rerouted = previous &&
        previous.actualRouteSegmentIds.some((segmentId) =>
          this.removedRoadIds.has(segmentId)
        );
      this.records.set(
        id,
        previous
          ? {
              ...mergeActiveTrip(previous, record),
              status: rerouted ? "rerouting" : "active",
            }
          : record,
      );
    }
    for (const [id, previous] of this.records) {
      if (previous.status !== "active" && previous.status !== "rerouting") continue;
      if (active.has(id)) continue;
      const cancelled = previous.actualRouteSegmentIds.some((segmentId) =>
        this.removedRoadIds.has(segmentId)
      );
      const completed = {
        ...previous,
        status: cancelled ? "cancelled" as const : "completed" as const,
        arrivalMinute: input.minute,
        travelMinutes: Math.max(
          0,
          (input.minute - previous.actualDepartureMinute) / 60,
        ),
      };
      this.records.set(id, completed);
      this.recordDailyCompletion(completed);
      if (
        !cancelled &&
        completed.source === "recorded-external"
        && completed.destination.kind === "building"
      ) {
        this.completedExternalBuildingArrivals += 1;
      }
    }

    const minimumMinute =
      input.minute - RETAINED_SIMULATED_DAYS * 24 * 60;
    for (const [id, record] of this.records) {
      if (
        record.status !== "active"
        && record.status !== "rerouting"
        && (record.arrivalMinute ?? record.actualDepartureMinute) < minimumMinute
      ) {
        this.records.delete(id);
      }
    }

    const records = [...this.records.values()].sort(
      (left, right) => right.actualDepartureMinute - left.actualDepartureMinute,
    );
    const buildingSummaries = summarizeBuildings(records);
    const summary = summarizeTrips(records);
    const checks = integrityChecks(
      records,
      input,
      this.completedExternalBuildingArrivals,
    );
    this.removedRoadIds.clear();
    return {
      records,
      dailyAggregates: [...this.dailyAggregates.values()].sort(
        (left, right) => right.day - left.day,
      ),
      buildingSummaries,
      summary,
      integrity: {
        status: overallStatus(checks),
        checks,
      },
    };
  }

  private recordDailyCompletion(record: Readonly<TripRecord>): void {
    const day = Math.floor(
      (record.arrivalMinute ?? record.actualDepartureMinute) / 1440,
    );
    const aggregate = this.dailyAggregates.get(day) ?? {
      day,
      completedTrips: 0,
      cancelledTrips: 0,
      localTrips: 0,
      externalTrips: 0,
      byMode: { walk: 0, car: 0, transit: 0 },
      byPurpose: {
        work: 0,
        shopping: 0,
        service: 0,
        recreation: 0,
        delivery: 0,
        through: 0,
      },
    };
    if (record.status === "cancelled") aggregate.cancelledTrips += 1;
    else aggregate.completedTrips += 1;
    if (record.travelerCategory === "resident") aggregate.localTrips += 1;
    else aggregate.externalTrips += 1;
    aggregate.byMode[record.mode] += 1;
    aggregate.byPurpose[record.purpose] += 1;
    this.dailyAggregates.set(day, aggregate);
  }

  private activeRecords(
    input: Readonly<TripLedgerUpdate>,
  ): Map<string, TripRecord> {
    const buildingById = new Map(
      input.buildings.map((building) => [building.id, building]),
    );
    const records = new Map<string, TripRecord>();
    for (const person of input.people) {
      const mobility = person.mobility;
      if (
        mobility.phase !== "walking"
        && mobility.phase !== "driving"
        && mobility.phase !== "transit"
      ) continue;
      const id = mobility.tripId ??
        `resident:${person.id}:${Math.floor(input.minute / 1440)}:${mobility.departureMinute}:${mobility.destinationBuildingId}`;
      records.set(id, {
        id,
        travelerId: person.id,
        travelerName: person.name,
        travelerCategory: "resident",
        purpose: purposeForActivity(mobility.activity),
        mode: mobility.mode,
        origin: endpoint(
          mobility.fromBuildingId,
          buildingById,
          "Outside University City",
        ),
        destination: endpoint(
          mobility.destinationBuildingId,
          buildingById,
          "Outside University City",
        ),
        plannedRouteSegmentIds:
          mobility.plannedRouteSegmentIds ?? currentSegment(mobility.segmentId),
        actualRouteSegmentIds: currentSegment(mobility.segmentId),
        scheduledDepartureMinute: mobility.departureMinute,
        actualDepartureMinute:
          Math.floor(input.minute / 1440) * 1440 + mobility.departureMinute,
        arrivalMinute: null,
        travelMinutes: Math.max(
          0,
          mobility.expectedArrivalMinute - mobility.departureMinute,
        ),
        delayMinutes: mobility.delayMinutes,
        status: "active",
        vehicleId: mobility.vehicleId,
        occupancy: 1,
        cost: tripCost(mobility.mode, mobility.delayMinutes, false),
        source: "scheduled-resident",
        economicEffect: economicEffect(
          purposeForActivity(mobility.activity),
          mobility.destinationBuildingId,
          buildingById.has(mobility.destinationBuildingId),
          false,
        ),
      });
    }
    for (const vehicle of input.vehicles) {
      if (vehicle.source === "sampled-resident") continue;
      const record = recordForVehicle(vehicle, input.minute, buildingById);
      records.set(record.id, record);
    }
    for (const pedestrian of input.pedestrians) {
      if (pedestrian.source === "sampled-resident") continue;
      const record = recordForPedestrian(
        pedestrian,
        input.minute,
        buildingById,
      );
      records.set(record.id, record);
    }
    return records;
  }
}

function recordForVehicle(
  vehicle: Readonly<VehicleSnapshot>,
  minute: number,
  buildings: ReadonlyMap<string, DetailedBuilding>,
): TripRecord {
  const freight = vehicle.kind === "truck";
  const purpose = vehicle.tripPurpose ??
    (freight ? "delivery" : vehicle.destinationBuildingId ? "work" : "through");
  const category = vehicle.travelerCategory ??
    (freight
      ? "freight"
      : vehicle.destinationBuildingId
        ? "commuter"
        : "through-traffic");
  const travelerId = vehicle.driverPersonId ?? `external-driver-${vehicle.id}`;
  const destination = vehicle.destinationBuildingId
    ? endpoint(vehicle.destinationBuildingId, buildings, "City destination")
    : boundaryEndpoint(
        `boundary:destination:${vehicle.id}`,
        vehicle.destinationName ?? "District boundary",
      );
  return {
    id: vehicle.tripId ?? `external:vehicle:${vehicle.id}`,
    travelerId,
    travelerName: vehicle.displayName ?? generatedTravelerName(vehicle.id),
    travelerCategory: category,
    purpose,
    mode: vehicle.kind === "bus" ? "transit" : "car",
    origin: vehicle.originBuildingId
      ? endpoint(vehicle.originBuildingId, buildings, "City origin")
      : boundaryEndpoint(
          `boundary:origin:${vehicle.id}`,
          vehicle.originName ?? "District boundary",
        ),
    destination,
    plannedRouteSegmentIds:
      vehicle.plannedRouteSegmentIds ?? currentSegment(vehicle.segmentId),
    actualRouteSegmentIds: currentSegment(vehicle.segmentId),
    scheduledDepartureMinute: null,
    actualDepartureMinute: minute,
    arrivalMinute: null,
    travelMinutes: 0,
    delayMinutes: (vehicle.delaySeconds ?? 0) / 60,
    status: "active",
    vehicleId: vehicle.id,
    occupancy: Math.max(1, vehicle.occupantPersonIds?.length ?? 1),
    cost: tripCost(
      vehicle.kind === "bus" ? "transit" : "car",
      (vehicle.delaySeconds ?? 0) / 60,
      freight,
    ),
    source: "recorded-external",
    economicEffect: economicEffect(
      purpose,
      destination.id,
      destination.kind === "building",
      category === "through-traffic",
    ),
  };
}

function recordForPedestrian(
  pedestrian: Readonly<PedestrianSnapshot>,
  minute: number,
  buildings: ReadonlyMap<string, DetailedBuilding>,
): TripRecord {
  const purpose = pedestrian.tripPurpose ??
    (pedestrian.destinationBuildingId ? "service" : "through");
  const category = pedestrian.travelerCategory ??
    (pedestrian.destinationBuildingId ? "visitor" : "through-traffic");
  const travelerId =
    pedestrian.personId ?? `external-pedestrian-${pedestrian.id}`;
  const destination = pedestrian.destinationBuildingId
    ? endpoint(
        pedestrian.destinationBuildingId,
        buildings,
        "City destination",
      )
    : boundaryEndpoint(
        `boundary:destination:${pedestrian.id}`,
        pedestrian.destinationName ?? "District boundary",
      );
  return {
    id: pedestrian.tripId ?? `external:pedestrian:${pedestrian.id}`,
    travelerId,
    travelerName:
      pedestrian.displayName ?? generatedTravelerName(pedestrian.id),
    travelerCategory: category,
    purpose,
    mode: "walk",
    origin: pedestrian.originBuildingId
      ? endpoint(pedestrian.originBuildingId, buildings, "City origin")
      : boundaryEndpoint(
          `boundary:origin:${pedestrian.id}`,
          pedestrian.originName ?? "District boundary",
        ),
    destination,
    plannedRouteSegmentIds:
      pedestrian.plannedRouteSegmentIds ??
      currentSegment(pedestrian.segmentId),
    actualRouteSegmentIds: currentSegment(pedestrian.segmentId),
    scheduledDepartureMinute: null,
    actualDepartureMinute: minute,
    arrivalMinute: null,
    travelMinutes: 0,
    delayMinutes: (pedestrian.delaySeconds ?? 0) / 60,
    status: "active",
    occupancy: 1,
    cost: 0,
    source: "recorded-external",
    economicEffect: economicEffect(
      purpose,
      destination.id,
      destination.kind === "building",
      category === "through-traffic",
    ),
  };
}

function mergeActiveTrip(
  previous: Readonly<TripRecord>,
  current: Readonly<TripRecord>,
): TripRecord {
  const actual = [...previous.actualRouteSegmentIds];
  for (const segmentId of current.actualRouteSegmentIds) {
    if (actual.at(-1) !== segmentId) actual.push(segmentId);
  }
  return {
    ...current,
    actualDepartureMinute: previous.actualDepartureMinute,
    actualRouteSegmentIds: actual,
    travelMinutes: Math.max(
      0,
      (current.actualDepartureMinute - previous.actualDepartureMinute) / 60,
    ),
    delayMinutes: Math.max(previous.delayMinutes, current.delayMinutes),
  };
}

function summarizeTrips(
  records: readonly TripRecord[],
): TripLedgerSnapshot["summary"] {
  const byMode = { walk: 0, car: 0, transit: 0 };
  const byPurpose = {
    work: 0,
    shopping: 0,
    service: 0,
    recreation: 0,
    delivery: 0,
    through: 0,
  };
  let activeTrips = 0;
  let completedTrips = 0;
  let localTrips = 0;
  let externalTrips = 0;
  for (const record of records) {
    if (record.status === "active" || record.status === "rerouting") {
      activeTrips += 1;
    } else if (record.status === "completed") {
      completedTrips += 1;
    }
    byMode[record.mode] += 1;
    byPurpose[record.purpose] += 1;
    if (record.travelerCategory === "resident") localTrips += 1;
    else externalTrips += 1;
  }
  return {
    activeTrips,
    completedTrips,
    localTrips,
    externalTrips,
    byMode,
    byPurpose,
  };
}

function summarizeBuildings(
  records: readonly TripRecord[],
): BuildingTripSummary[] {
  const summaries = new Map<string, BuildingTripSummary>();
  for (const record of records) {
    const buildingId = record.economicEffect.buildingId;
    if (!buildingId) continue;
    const summary = summaries.get(buildingId) ?? {
      buildingId,
      workerArrivals: 0,
      customerVisits: 0,
      deliveries: 0,
      missedTrips: 0,
      activeTrips: 0,
      attributedRevenue: 0,
    };
    if (record.status === "active" || record.status === "rerouting") {
      summary.activeTrips += 1;
    } else if (record.status === "cancelled") {
      summary.missedTrips += 1;
    } else if (record.status === "completed") {
      summary.workerArrivals += record.economicEffect.workerArrival;
      summary.customerVisits += record.economicEffect.customerVisit;
      summary.deliveries += record.economicEffect.deliveryUnits;
      summary.attributedRevenue += record.economicEffect.localSpending;
    }
    summaries.set(buildingId, summary);
  }
  return [...summaries.values()].sort((left, right) =>
    left.buildingId.localeCompare(right.buildingId)
  );
}

function integrityChecks(
  records: readonly TripRecord[],
  input: Readonly<TripLedgerUpdate>,
  completedExternalBuildingArrivals: number,
): SimulationIntegrityCheck[] {
  const active = records.filter(
    (record) => record.status === "active" || record.status === "rerouting",
  );
  const recordedVehicles = new Set(
    active
      .map((record) => record.vehicleId)
      .filter((id): id is number => id !== undefined),
  ).size;
  const recordedPedestrians = active.filter(
    (record) => record.mode === "walk",
  ).length;
  const businessProfitExpected = input.buildings.reduce(
    (total, building) =>
      total +
      building.accounting.operatingRevenue -
      building.accounting.operatingCost,
    0,
  );
  const businessProfitObserved = input.buildings.reduce(
    (total, building) => total + building.accounting.profit,
    0,
  );
  const householdPurchases = input.households.reduce(
    (total, household) =>
      total +
      household.dailyExpenses.goods +
      household.dailyExpenses.services,
    0,
  );
  const localBusinessReceipts = input.buildings.reduce(
    (total, building) => total + building.accounting.localSalesRevenue,
    0,
  );
  const householdRent = input.households.reduce(
    (total, household) => total + household.dailyExpenses.housing,
    0,
  );
  const buildingRent = input.buildings.reduce(
    (total, building) => total + building.accounting.rentIncome,
    0,
  );
  return [
    check(
      "active-vehicles",
      "Active vehicle records",
      "traffic",
      recordedVehicles,
      input.trafficMetrics.activeVehicles,
      0,
      "Unique vehicle IDs in active trip records must equal visible vehicles.",
    ),
    check(
      "active-pedestrians",
      "Active pedestrian records",
      "traffic",
      recordedPedestrians,
      input.trafficMetrics.activePedestrians,
      0,
      "Every visible pedestrian must have one active trip.",
    ),
    check(
      "building-arrivals",
      "Recorded building arrivals",
      "buildings",
      completedExternalBuildingArrivals,
      input.trafficMetrics.buildingArrivals,
      2,
      "A short tolerance covers agents completing between render updates.",
    ),
    check(
      "building-finance",
      "Building profit reconciliation",
      "finance",
      businessProfitExpected,
      businessProfitObserved,
      Math.max(1, input.buildings.length),
      "Operating revenue minus operating cost should reconcile with profit.",
    ),
    check(
      "household-purchases",
      "Household purchase reconciliation",
      "finance",
      householdPurchases,
      localBusinessReceipts,
      10,
      "Household goods and service spending should match local business receipts.",
    ),
    check(
      "housing-rent",
      "Housing rent reconciliation",
      "finance",
      householdRent,
      buildingRent,
      0.1,
      "Household housing payments should match building rent receipts.",
    ),
    check(
      "government-funds",
      "Government fund reconciliation",
      "government",
      input.city.municipalBudget,
      input.city.metrics.municipalBalance,
      0.01,
      "The live municipal balance must match the government ledger.",
    ),
  ];
}

function check(
  id: string,
  label: string,
  subsystem: SimulationIntegrityCheck["subsystem"],
  expected: number,
  observed: number,
  tolerance: number,
  detail: string,
): SimulationIntegrityCheck {
  const difference = observed - expected;
  const magnitude = Math.abs(difference);
  const status: IntegrityStatus = magnitude <= tolerance
    ? "verified"
    : magnitude <= Math.max(1, tolerance * 3)
      ? "warning"
      : "mismatch";
  return {
    id,
    label,
    subsystem,
    expected: round(expected),
    observed: round(observed),
    difference: round(difference),
    tolerance,
    status,
    detail,
  };
}

function overallStatus(
  checks: readonly SimulationIntegrityCheck[],
): IntegrityStatus {
  if (checks.some((item) => item.status === "mismatch")) return "mismatch";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "verified";
}

function endpoint(
  id: string,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  fallback: string,
): TripEndpoint {
  const building = buildings.get(id);
  return building
    ? { kind: "building", id, name: building.name }
    : boundaryEndpoint(id, fallback);
}

function boundaryEndpoint(id: string, name: string): TripEndpoint {
  return { kind: "boundary", id, name };
}

function purposeForActivity(
  activity: DetailedPerson["currentActivity"],
): TripPurpose {
  if (activity === "work" || activity === "school") return "work";
  if (activity === "shop") return "shopping";
  if (activity === "leisure") return "recreation";
  if (activity === "healthcare" || activity === "library") return "service";
  return "service";
}

function economicEffect(
  purpose: TripPurpose,
  buildingId: string,
  localDestination: boolean,
  congestionOnly: boolean,
): TripRecord["economicEffect"] {
  if (!localDestination || congestionOnly) {
    return {
      workerArrival: 0,
      customerVisit: 0,
      deliveryUnits: 0,
      localSpending: 0,
      congestionOnly: true,
    };
  }
  return {
    buildingId,
    workerArrival: purpose === "work" ? 1 : 0,
    customerVisit:
      purpose === "shopping" ||
      purpose === "service" ||
      purpose === "recreation"
        ? 1
        : 0,
    deliveryUnits: purpose === "delivery" ? 18 : 0,
    localSpending:
      purpose === "shopping"
        ? 24
        : purpose === "service" || purpose === "recreation"
          ? 16
          : 0,
    congestionOnly: false,
  };
}

function currentSegment(segmentId: string | undefined): string[] {
  return segmentId ? [segmentId] : [];
}

function tripCost(
  mode: TravelMode,
  delayMinutes: number,
  freight: boolean,
): number {
  const delayCost = delayMinutes *
    (freight ? 0.35 : mode === "car" ? 0.22 : mode === "transit" ? 0.09 : 0);
  return round(
    delayCost +
      (freight ? 4.5 : mode === "car" ? 1.75 : mode === "transit" ? 1.25 : 0),
  );
}

function generatedTravelerName(id: number): string {
  const first = [
    "Avery",
    "Jordan",
    "Morgan",
    "Riley",
    "Casey",
    "Taylor",
    "Cameron",
    "Quinn",
  ];
  const last = [
    "Brooks",
    "Chen",
    "Davis",
    "Garcia",
    "Lee",
    "Miller",
    "Patel",
    "Wilson",
  ];
  return `${first[Math.abs(id) % first.length]} ${
    last[Math.floor(Math.abs(id) / first.length) % last.length]
  }`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
