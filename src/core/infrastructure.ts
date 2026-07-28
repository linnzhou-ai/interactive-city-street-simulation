import type {
  Building,
  InfrastructureState,
  TransitLine,
  TransitStop,
  UtilityKind,
  UtilityNetworkState,
} from "../models/types";

const UTILITY_KINDS: UtilityKind[] = ["power", "water", "waste"];

export interface UtilityConnection {
  buildingId: string;
  maxThroughput: number;
  priority: number;
}

export interface UtilityNetwork {
  kind: UtilityKind;
  sourceName: string;
  baseCapacity: number;
  capacityScale: number;
  capacity: number;
  lossRate: number;
  unitPrice: number;
  variableCost: number;
  fixedCostPerCapacity: number;
  connections: UtilityConnection[];
}

export interface InfrastructureModel {
  state: InfrastructureState;
  networks: Record<UtilityKind, UtilityNetwork>;
}

export interface InfrastructureOptions {
  capacities?: Partial<Record<UtilityKind, number>>;
  lossRates?: Partial<Record<UtilityKind, number>>;
  capacityScale?: number;
  elapsedDays?: number;
  roadCapacity?: number;
  roadVolume?: number;
  roadCondition?: number;
  roadMaintenance?: number;
  parkingCapacity?: number;
  parkingUsed?: number;
  transitHeadwayMinutes?: number;
}

export interface InfrastructureUpdate {
  infrastructure: InfrastructureModel;
  buildings: Building[];
}

const UTILITY_PROVIDERS: Record<UtilityKind, {
  sourceName: string;
  capacity: number;
  unitPrice: number;
  variableCost: number;
  fixedCostPerCapacity: number;
}> = {
  power: {
    sourceName: "Regional electric grid",
    capacity: 500,
    unitPrice: 0.18,
    variableCost: 0.11,
    fixedCostPerCapacity: 0.015,
  },
  water: {
    sourceName: "Municipal water treatment",
    capacity: 450,
    unitPrice: 0.12,
    variableCost: 0.07,
    fixedCostPerCapacity: 0.012,
  },
  waste: {
    sourceName: "Municipal sanitation service",
    capacity: 300,
    unitPrice: 0.16,
    variableCost: 0.1,
    fixedCostPerCapacity: 0.018,
  },
};

export const UTILITY_CUSTOMER_RATES: Record<UtilityKind, number> = {
  power: UTILITY_PROVIDERS.power.unitPrice,
  water: UTILITY_PROVIDERS.water.unitPrice,
  waste: UTILITY_PROVIDERS.waste.unitPrice,
};

export function buildingUtilityDemand(building: Building, kind: UtilityKind): number {
  const activityRatio = building.buildingUse === "housing"
    ? building.residentCapacity > 0
      ? building.residentIds.length / building.residentCapacity
      : 0
    : building.jobCapacity > 0
      ? building.employeeIds.length / building.jobCapacity
      : building.buildingUse === "park"
        ? 0.35
        : 0;
  const loadRatio = 0.15 + clamp01(activityRatio) * 0.85;
  return nonNegative(building.utilityDemand[kind]) * loadRatio;
}

const DEFAULT_LOSS_RATES: Record<UtilityKind, number> = {
  power: 0.06,
  water: 0.08,
  waste: 0.04,
};

export function createInitialInfrastructure(
  buildings: readonly Building[],
  options: InfrastructureOptions = {},
): InfrastructureModel {
  const capacityScale = bounded(options.capacityScale, 1, 0, 4);
  const networks = Object.fromEntries(
    UTILITY_KINDS.map((kind) => {
      const lossRate = bounded(
        options.lossRates?.[kind],
        DEFAULT_LOSS_RATES[kind],
        0,
        0.5,
      );
      const dailyDemand = sum(buildings.map((building) =>
        buildingUtilityDemand(building, kind)
      ));
      const reserveCapacity = dailyDemand > 0
        ? dailyDemand * 1.2 / (1 - lossRate)
        : UTILITY_PROVIDERS[kind].capacity;
      const capacity = nonNegative(options.capacities?.[kind] ?? reserveCapacity);
      return [kind, createNetwork(kind, capacity, capacityScale, lossRate, buildings)];
    }),
  ) as Record<UtilityKind, UtilityNetwork>;
  const roadCapacity = nonNegative(options.roadCapacity ?? 900);
  const roadVolume = clamp(nonNegative(options.roadVolume ?? 360), 0, roadCapacity * 2);
  const parkingCapacity = nonNegative(options.parkingCapacity ?? 96);
  const parkingUsed = clamp(nonNegative(options.parkingUsed ?? 38), 0, parkingCapacity);
  const [transitStops, transitLines] = createTransitSeed(options.transitHeadwayMinutes);

  return {
    networks,
    state: {
      utilities: Object.fromEntries(
        UTILITY_KINDS.map((kind) => [kind, initialUtilityState(networks[kind], buildings)]),
      ) as Record<UtilityKind, UtilityNetworkState>,
      transitStops,
      transitLines,
      roadCapacity,
      roadVolume,
      roadCondition: bounded(options.roadCondition, 92, 0, 100),
      parkingCapacity,
      parkingUsed,
      wasteGenerated: 0,
      wasteCollected: 0,
      wasteCollectionPercent: 100,
    },
  };
}

export function updateInfrastructure(
  buildings: readonly Building[],
  infrastructure: InfrastructureModel,
  options: InfrastructureOptions = {},
): InfrastructureUpdate {
  const elapsedDays = bounded(options.elapsedDays, 1, 0, 30);
  const networks = updateNetworks(infrastructure.networks, buildings, options);
  const powerAllocation = allocateUtility(buildings, networks.power, (building) =>
    buildingUtilityDemand(building, "power"),
  );
  const waterAllocation = allocateUtility(buildings, networks.water, (building) =>
    buildingUtilityDemand(building, "water"),
  );
  const wasteServiceAllocation = allocateUtility(
    buildings,
    networks.waste,
    (building) => buildingUtilityDemand(building, "waste"),
  );
  const pendingWaste = new Map(
    buildings.map((building) => [
      building.id,
      nonNegative(building.wasteStored) +
        buildingUtilityDemand(building, "waste") * elapsedDays,
    ]),
  );
  const generatedThisUpdate = sum(buildings.map((building) =>
    buildingUtilityDemand(building, "waste") * elapsedDays
  ));
  const wasteCollectionAllocation = allocateUtility(
    buildings,
    networks.waste,
    (building) => pendingWaste.get(building.id) ?? 0,
    networks.waste.capacity * elapsedDays,
  );
  let collectedThisUpdate = 0;

  const updatedBuildings = buildings.map((building) => {
    const power = serviceFor(building.id, buildingUtilityDemand(building, "power"), powerAllocation);
    const water = serviceFor(building.id, buildingUtilityDemand(building, "water"), waterAllocation);
    const wastePending = pendingWaste.get(building.id) ?? 0;
    const wasteCollected = Math.min(
      wastePending,
      wasteCollectionAllocation.deliveredByBuilding.get(building.id) ?? 0,
    );
    const waste = serviceFor(
      building.id,
      buildingUtilityDemand(building, "waste"),
      wasteServiceAllocation,
    );
    const wasteStored = round(Math.max(0, wastePending - wasteCollected));
    const storagePressure = clamp01(
      wasteStored / Math.max(1, buildingUtilityDemand(building, "waste") * 5),
    );
    const efficiency = buildingEfficiency(building, power, water, waste, storagePressure);
    collectedThisUpdate += wasteCollected;

    return {
      ...building,
      utilityService: {
        power: round(power),
        water: round(water),
        waste: round(waste),
      },
      wasteStored,
      efficiency: round(efficiency),
    };
  });

  const roadCapacity = nonNegative(
    options.roadCapacity ?? infrastructure.state.roadCapacity,
  );
  const roadVolume = clamp(
    nonNegative(options.roadVolume ?? infrastructure.state.roadVolume),
    0,
    roadCapacity * 2,
  );
  const roadLoad = roadCapacity > 0 ? roadVolume / roadCapacity : roadVolume > 0 ? 2 : 0;
  const roadCondition = clamp(
    bounded(options.roadCondition, infrastructure.state.roadCondition, 0, 100) +
      bounded(options.roadMaintenance, 0.1, 0, 5) * elapsedDays -
      clamp(roadLoad, 0, 2) * 0.4 * elapsedDays,
    0,
    100,
  );
  const parkingCapacity = nonNegative(
    options.parkingCapacity ?? infrastructure.state.parkingCapacity,
  );
  const parkingUsed = clamp(
    nonNegative(options.parkingUsed ?? infrastructure.state.parkingUsed),
    0,
    parkingCapacity,
  );
  const state: InfrastructureState = {
    ...infrastructure.state,
    utilities: {
      power: utilityState(networks.power, powerAllocation),
      water: utilityState(networks.water, waterAllocation),
      waste: utilityState(networks.waste, wasteServiceAllocation),
    },
    transitLines: infrastructure.state.transitLines.map((line) => ({
      ...line,
      headwayMinutes: bounded(
        options.transitHeadwayMinutes,
        line.headwayMinutes,
        2,
        60,
      ),
    })),
    roadCapacity: round(roadCapacity),
    roadVolume: round(roadVolume),
    roadCondition: round(roadCondition),
    parkingCapacity: round(parkingCapacity),
    parkingUsed: round(parkingUsed),
    wasteGenerated: round(infrastructure.state.wasteGenerated + generatedThisUpdate),
    wasteCollected: round(infrastructure.state.wasteCollected + collectedThisUpdate),
    wasteCollectionPercent: elapsedDays > 0 && generatedThisUpdate > 0
      ? round(clamp(collectedThisUpdate / generatedThisUpdate, 0, 1) * 100)
      : infrastructure.state.wasteCollectionPercent,
  };

  return {
    buildings: updatedBuildings,
    infrastructure: { networks, state },
  };
}

function createNetwork(
  kind: UtilityKind,
  baseCapacity: number,
  capacityScale: number,
  lossRate: number,
  buildings: readonly Building[],
): UtilityNetwork {
  const provider = UTILITY_PROVIDERS[kind];
  return {
    kind,
    sourceName: provider.sourceName,
    baseCapacity: round(baseCapacity),
    capacityScale,
    capacity: round(baseCapacity * capacityScale),
    lossRate,
    unitPrice: provider.unitPrice,
    variableCost: provider.variableCost,
    fixedCostPerCapacity: provider.fixedCostPerCapacity,
    connections: buildings.map((building) => {
      const demand = buildingUtilityDemand(building, kind);
      return {
        buildingId: building.id,
        maxThroughput: round(
          Math.max(5, kind === "waste" ? demand * 5 + 25 : demand * 1.25),
        ),
        priority: servicePriority(building, kind),
      };
    }),
  };
}

function updateNetworks(
  existing: Record<UtilityKind, UtilityNetwork>,
  buildings: readonly Building[],
  options: InfrastructureOptions,
): Record<UtilityKind, UtilityNetwork> {
  return Object.fromEntries(
    UTILITY_KINDS.map((kind) => {
      const baseCapacity = nonNegative(
        options.capacities?.[kind] ?? existing[kind].baseCapacity,
      );
      const capacityScale = bounded(
        options.capacityScale,
        options.capacities?.[kind] === undefined
          ? existing[kind].capacityScale
          : 1,
        0,
        4,
      );
      const lossRate = bounded(
        options.lossRates?.[kind],
        existing[kind].lossRate,
        0,
        0.5,
      );
      return [kind, createNetwork(kind, baseCapacity, capacityScale, lossRate, buildings)];
    }),
  ) as Record<UtilityKind, UtilityNetwork>;
}

interface UtilityAllocation {
  demand: number;
  delivered: number;
  deliveredByBuilding: Map<string, number>;
}

function allocateUtility(
  buildings: readonly Building[],
  network: UtilityNetwork,
  demandFor: (building: Building) => number,
  capacity = network.capacity,
): UtilityAllocation {
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const deliveredByBuilding = new Map<string, number>();
  const connectionById = new Map(
    network.connections.map((connection) => [connection.buildingId, connection]),
  );
  const demandById = new Map(
    buildings.map((building) => [building.id, nonNegative(demandFor(building))]),
  );
  const totalDemand = sum([...demandById.values()]);
  let remaining = Math.min(
    totalDemand,
    nonNegative(capacity) * (1 - clamp(network.lossRate, 0, 0.5)),
  );
  let activeIds = network.connections
    .filter((connection) => buildingById.has(connection.buildingId))
    .map((connection) => connection.buildingId);

  for (let pass = 0; pass < network.connections.length && remaining > 1e-9; pass += 1) {
    const totalWeight = sum(
      activeIds.map((id) => {
        const demand = demandById.get(id) ?? 0;
        const delivered = deliveredByBuilding.get(id) ?? 0;
        return Math.max(0, demand - delivered) * (connectionById.get(id)?.priority ?? 1);
      }),
    );
    if (totalWeight <= 0) {
      break;
    }

    const availableThisPass = remaining;
    let deliveredThisPass = 0;
    for (const id of activeIds) {
      const connection = connectionById.get(id);
      const demand = demandById.get(id) ?? 0;
      const delivered = deliveredByBuilding.get(id) ?? 0;
      const unmet = Math.max(0, demand - delivered);
      const connectionRoom = Math.max(0, (connection?.maxThroughput ?? 0) - delivered);
      const weight = unmet * (connection?.priority ?? 1);
      const allocation = Math.min(
        unmet,
        connectionRoom,
        availableThisPass * (weight / totalWeight),
      );
      deliveredByBuilding.set(id, delivered + allocation);
      deliveredThisPass += allocation;
    }
    remaining = Math.max(0, remaining - deliveredThisPass);
    activeIds = activeIds.filter((id) => {
      const demand = demandById.get(id) ?? 0;
      const delivered = deliveredByBuilding.get(id) ?? 0;
      const connection = connectionById.get(id);
      return (
        delivered < demand - 1e-9 &&
        delivered < (connection?.maxThroughput ?? 0) - 1e-9
      );
    });
    if (deliveredThisPass <= 1e-9) {
      break;
    }
  }

  return {
    demand: round(totalDemand),
    delivered: round(sum([...deliveredByBuilding.values()])),
    deliveredByBuilding,
  };
}

function buildingEfficiency(
  building: Building,
  power: number,
  water: number,
  waste: number,
  storagePressure: number,
): number {
  const byUse: Record<Building["buildingUse"], number> = {
    housing: power * 0.38 + water * 0.42 + waste * 0.2,
    retail: power * 0.45 + water * 0.3 + waste * 0.25,
    industrial: power * 0.48 + water * 0.32 + waste * 0.2,
    school: power * 0.38 + water * 0.42 + waste * 0.2,
    library: power * 0.58 + water * 0.22 + waste * 0.2,
    clinic: power * 0.48 + water * 0.42 + waste * 0.1,
    park: power * 0.1 + water * 0.58 + waste * 0.32,
  };
  return clamp(byUse[building.buildingUse] - storagePressure * 0.25, 0, 1);
}

function serviceFor(
  buildingId: string,
  demand: number,
  allocation: UtilityAllocation,
): number {
  const normalizedDemand = nonNegative(demand);
  return normalizedDemand > 0
    ? clamp01((allocation.deliveredByBuilding.get(buildingId) ?? 0) / normalizedDemand)
    : 1;
}

function utilityState(
  network: UtilityNetwork,
  allocation: UtilityAllocation,
): UtilityNetworkState {
  const revenueDaily = allocation.delivered * network.unitPrice;
  const operatingCostDaily = allocation.delivered * network.variableCost
    + network.capacity * network.fixedCostPerCapacity;
  return {
    kind: network.kind,
    sourceName: network.sourceName,
    capacity: round(network.capacity),
    demand: allocation.demand,
    delivered: allocation.delivered,
    coveragePercent:
      allocation.demand > 0
        ? round(clamp(allocation.delivered / allocation.demand, 0, 1) * 100)
        : 100,
    lossPercent: round(network.lossRate * 100),
    unitPrice: round(network.unitPrice),
    revenueDaily: round(revenueDaily),
    operatingCostDaily: round(operatingCostDaily),
    netRevenueDaily: round(revenueDaily - operatingCostDaily),
  };
}

function initialUtilityState(
  network: UtilityNetwork,
  buildings: readonly Building[],
): UtilityNetworkState {
  const demand = sum(
    buildings.map((building) => buildingUtilityDemand(building, network.kind)),
  );
  const delivered = Math.min(demand, network.capacity * (1 - network.lossRate));
  const revenueDaily = delivered * network.unitPrice;
  const operatingCostDaily = delivered * network.variableCost
    + network.capacity * network.fixedCostPerCapacity;
  return {
    kind: network.kind,
    sourceName: network.sourceName,
    capacity: round(network.capacity),
    demand: round(demand),
    delivered: round(delivered),
    coveragePercent: demand > 0 ? round((delivered / demand) * 100) : 100,
    lossPercent: round(network.lossRate * 100),
    unitPrice: round(network.unitPrice),
    revenueDaily: round(revenueDaily),
    operatingCostDaily: round(operatingCostDaily),
    netRevenueDaily: round(revenueDaily - operatingCostDaily),
  };
}

function createTransitSeed(
  requestedHeadway: number | undefined,
): [TransitStop[], TransitLine[]] {
  const stops: TransitStop[] = [
    {
      id: "transit-stop-west",
      name: "West Intersection",
      nodeId: "bus-stop-west",
      waitingPassengerIds: [],
    },
    {
      id: "transit-stop-east",
      name: "East Intersection",
      nodeId: "bus-stop-east",
      waitingPassengerIds: [],
    },
  ];
  const lines: TransitLine[] = [
    {
      id: "transit-line-crosstown",
      name: "Crosstown Local",
      stopIds: stops.map((stop) => stop.id),
      headwayMinutes: bounded(requestedHeadway, 10, 2, 60),
      fare: 2.5,
      vehicleIds: [],
      passengersTransported: 0,
      averageWaitMinutes: 0,
      active: true,
    },
  ];

  return [stops, lines];
}

function servicePriority(building: Building, kind: UtilityKind): number {
  if (building.zone === "civic") {
    return 1.35;
  }
  if (building.zone === "residential") {
    return kind === "waste" ? 1.15 : 1.25;
  }
  if (building.zone === "park") {
    return 0.75;
  }
  return 1;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value) ? clamp(value as number, minimum, maximum) : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
