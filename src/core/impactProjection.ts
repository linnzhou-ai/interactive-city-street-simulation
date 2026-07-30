import { PENN_BUILDINGS } from "../data/pennBuildings";
import type {
  BuildingAccessibility,
  BuildingFunction,
  BuildingTrafficAttribution,
  DetailedBuilding,
  DetailedEntityState,
  EntityBuildingDefinition,
  EntityConnection,
} from "../models/entityTypes";
import type {
  BuildingImpactHorizon,
  BuildingImpactMetrics,
  BuildingImpactProjection,
  CityEditImpact,
  CityImpactHorizon,
  CityImpactMetrics,
  ImpactDriver,
  ImpactHorizon,
  ImpactMetricPair,
  ImpactProjectionRequest,
} from "../models/impactTypes";
import { IMPACT_HORIZONS } from "../models/impactTypes";
import type {
  CityPolicySettings,
  CitySectionState,
} from "../models/cityTypes";
import type {
  ExpansionRoad,
  ExpansionStreetObject,
  FeatureDesign,
  PlacedBuilding,
  ScenarioSettings,
} from "../models/types";
import { advanceCitySection } from "./cityEngine";
import {
  advanceDetailedTime,
  syncDetailedEntityBuildings,
} from "./entitySimulation";
import { placedBuildingToDefinition } from "./expansionEconomy";
import type { EditorSnapshot } from "./projectState";
import { calculateBuildingTrafficAttribution } from "./trafficAttribution";
import { LiveTrafficSystem } from "./liveTraffic";

const ROAD_MAINTENANCE_PER_METER_DAILY = 0.15;
const SIGNAL_MAINTENANCE_DAILY = 35;
const CROSSWALK_MAINTENANCE_DAILY = 8;

interface ProjectionBranch {
  city: CitySectionState;
  entities: DetailedEntityState;
  traffic: LiveTrafficSystem;
  designs: Map<string, FeatureDesign>;
  roads: ExpansionRoad[];
  streetObjects: ExpansionStreetObject[];
  definitions: EntityBuildingDefinition[];
  definitionById: Map<string, EntityBuildingDefinition>;
  municipalProjectSpending: number;
  settings: ScenarioSettings;
  sampleScale: number;
  baselineDetail: DetailTotals;
  publicMaintenanceDaily: number;
}

interface DetailTotals {
  operatingRevenue: number;
  profit: number;
  wages: number;
  transportCost: number;
  activeWorkers: number;
  jobs: number;
  housingCapacity: number;
  serviceDelivered: number;
}

export function projectCityEditImpact(
  request: Readonly<ImpactProjectionRequest>,
): CityEditImpact {
  const control = createBranch(request, request.beforeDesign, 0);
  const intervention = createBranch(
    request,
    request.afterDesign,
    request.interventionCapitalCost,
  );
  const cityHorizons = {} as Record<ImpactHorizon, CityImpactHorizon>;
  const buildingHorizons = new Map<
    string,
    Partial<Record<ImpactHorizon, BuildingImpactHorizon>>
  >();
  const buildingIdentity = new Map<
    string,
    {
      name: string;
      buildingFunction: BuildingFunction;
      status: BuildingImpactProjection["status"];
    }
  >();

  for (let day = 1; day <= IMPACT_HORIZONS.at(-1)!; day += 1) {
    advanceBranchDay(control, day <= 30);
    advanceBranchDay(intervention, day <= 30);
    if (!isImpactHorizon(day)) continue;

    cityHorizons[day] = compareCityBranches(control, intervention, day);
    for (const buildingId of request.trackedBuildingIds) {
      const beforeBuilding = control.entities.buildings.find(
        (building) => building.id === buildingId,
      );
      const afterBuilding = intervention.entities.buildings.find(
        (building) => building.id === buildingId,
      );
      if (!beforeBuilding && !afterBuilding) continue;
      const identityBuilding = afterBuilding ?? beforeBuilding!;
      buildingIdentity.set(buildingId, {
        name: identityBuilding.name,
        buildingFunction: identityBuilding.function,
        status: beforeBuilding
          ? afterBuilding
            ? "active"
            : "removed"
          : "added",
      });
      const horizons = buildingHorizons.get(buildingId) ?? {};
      horizons[day] = compareBuildingBranches(
        control,
        intervention,
        buildingId,
        day,
      );
      buildingHorizons.set(buildingId, horizons);
    }
  }

  const buildings = [...buildingHorizons]
    .map(([buildingId, horizons]): BuildingImpactProjection => {
      const identity = buildingIdentity.get(buildingId)!;
      return {
        buildingId,
        buildingName: identity.name,
        buildingFunction: identity.buildingFunction,
        status: identity.status,
        primaryMetricLabel: primaryMetric(identity.buildingFunction).label,
        horizons: horizons as Record<ImpactHorizon, BuildingImpactHorizon>,
      };
    })
    .sort((left, right) =>
      Math.abs(
        right.horizons[90].metrics.primaryOutput.delta,
      ) -
      Math.abs(
        left.horizons[90].metrics.primaryOutput.delta,
      )
    );

  return {
    requestId: request.requestId,
    editLabel: request.editLabel,
    createdAtDay: request.checkpoint.city.elapsedDays,
    horizons: cityHorizons,
    buildings,
  };
}

function createBranch(
  request: Readonly<ImpactProjectionRequest>,
  design: Readonly<EditorSnapshot>,
  capitalCost: number,
): ProjectionBranch {
  const city = structuredClone(request.checkpoint.city);
  city.municipalBudget = Math.max(0, city.municipalBudget - capitalCost);
  city.metrics = {
    ...city.metrics,
    municipalBalance: city.municipalBudget,
  };
  const definitions = activeDefinitions(design);
  const entities = syncDetailedEntityBuildings(
    structuredClone(request.checkpoint.entities),
    definitions,
  );
  const traffic = new LiveTrafficSystem(
    request.checkpoint.settings.simulationSeed,
  );
  const designs = new Map(
    design.designs.map(([id, roadDesign]) => [id, { ...roadDesign }]),
  );
  const roads = design.expansionRoads.map((road) => ({ ...road }));
  const streetObjects = design.expansionStreetObjects.map((object) => ({
    ...object,
  }));
  const destinations = definitions.map((building) => ({
    id: building.id,
    kind: buildingKind(building),
    x: building.x,
    z: building.z,
    floors: building.floors,
    rotation: building.rotation,
    color: "#8b8f8a",
  }));
  traffic.setRoadDesigns(designs);
  traffic.setExpansionNetwork(roads, streetObjects, destinations);
  const baselineDetail = detailTotals(request.checkpoint.entities);
  const representedResidents = Math.max(
    1,
    request.checkpoint.entities.people.length,
  );
  const sampleScale = clamp(
    request.checkpoint.city.metrics.population / representedResidents,
    1,
    500,
  );
  const branch: ProjectionBranch = {
    city,
    entities,
    traffic,
    designs,
    roads,
    streetObjects,
    definitions,
    definitionById: new Map(
      definitions.map((building) => [building.id, building]),
    ),
    municipalProjectSpending:
      request.checkpoint.municipalProjectSpending + capitalCost,
    settings: { ...request.checkpoint.settings },
    sampleScale,
    baselineDetail,
    publicMaintenanceDaily: infrastructureMaintenance(
      roads,
      streetObjects,
    ),
  };
  syncBranchTraffic(branch);
  return branch;
}

function advanceBranchDay(
  branch: ProjectionBranch,
  advanceBuildingModel: boolean,
): void {
  const policy = branchPolicy(branch);
  branch.city = advanceCitySection(branch.city, 1, policy).state;
  if (advanceBuildingModel) {
    const completedDay = Math.floor(branch.city.elapsedDays);
    branch.entities = advanceDetailedTime(
      branch.entities,
      branch.city,
      completedDay,
      12 * 60,
      {
        ...policy,
        congestionPercent: branch.city.metrics.congestionPercent,
        accessibilityByBuilding: accessibilityProfiles(branch),
        externalJobCapacityScale: clamp(
          1.04 - branch.city.metrics.congestionPercent * 0.003,
          0.45,
          1.35,
        ),
        externalSupplyScale: clamp(
          0.72 +
            policy.roadCapacityScale * 0.34 -
            branch.city.metrics.congestionPercent * 0.0025,
          0.4,
          1.35,
        ),
      },
    );
    syncBranchTraffic(branch);
  }

  const detail = detailTotals(branch.entities);
  const detailTaxDelta =
    ((detail.wages - branch.baselineDetail.wages) *
      branch.city.taxRate *
      0.16 +
      Math.max(0, detail.profit - branch.baselineDetail.profit) *
        branch.city.taxRate) *
    branch.sampleScale;
  const civicMaintenance = branch.entities.buildings
    .filter(
      (building) =>
        building.source === "expansion" &&
        isCivicFunction(building.function),
    )
    .reduce(
      (total, building) => total + building.accounting.maintenanceCost,
      0,
    );
  const extraMaintenance =
    branch.publicMaintenanceDaily + civicMaintenance;
  branch.city.municipalBudget += detailTaxDelta - extraMaintenance;
  branch.city.metrics = {
    ...branch.city.metrics,
    taxRevenueDaily: branch.city.metrics.taxRevenueDaily + detailTaxDelta,
    maintenanceCostDaily:
      branch.city.metrics.maintenanceCostDaily + extraMaintenance,
    municipalBalance: branch.city.municipalBudget,
  };
}

function syncBranchTraffic(branch: ProjectionBranch): void {
  const load = new Map<string, number>();
  for (const connection of branch.entities.connections) {
    const trips =
      connection.kind === "delivery"
        ? Math.max(0.25, connection.volume / 18) * 2
        : connection.volume * 0.42;
    for (const segmentId of routeForConnection(branch, connection)) {
      load.set(segmentId, (load.get(segmentId) ?? 0) + trips);
    }
  }
  branch.traffic.setEconomicRoadLoad(load);
}

function branchPolicy(branch: Readonly<ProjectionBranch>): CityPolicySettings {
  const laneDelta = [...branch.designs.values()].reduce(
    (total, design) => total + design.laneDelta,
    0,
  );
  const signalScale = 1 - Math.min(
    0.18,
    Math.abs(branch.settings.signalCycleSeconds - 75) / 500,
  );
  const speedScale = 1 - Math.min(
    0.14,
    Math.abs(branch.settings.speedLimitMph - 25) / 120,
  );
  return {
    roadCapacityScale: clamp(
      (branch.settings.roadCapacity / 100) *
        (1 + laneDelta * 0.025) *
        branch.traffic.getExpansionCapacityScale() *
        signalScale *
        speedScale,
      0.5,
      1.5,
    ),
    zoningStrictness: branch.settings.zoningStrictness,
    transitServiceScale:
      12 / branch.settings.transitHeadwayMinutes,
  };
}

function accessibilityProfiles(
  branch: Readonly<ProjectionBranch>,
): Map<string, BuildingAccessibility> {
  const roadTraffic = new Map(
    branch.traffic
      .getRoadTraffic()
      .map((road) => [road.segmentId, road]),
  );
  const profiles = new Map<string, BuildingAccessibility>();
  for (const building of branch.entities.buildings) {
    const support = branch.traffic.getEndpointMobilitySupport(building);
    const relatedConnections = branch.entities.connections.filter(
      (connection) =>
        connection.fromBuildingId === building.id ||
        connection.toBuildingId === building.id,
    );
    const segments = relatedConnections.flatMap((connection) =>
      routeForConnection(branch, connection),
    );
    const routeDelay =
      segments.length > 0
        ? segments.reduce(
            (total, segmentId) =>
              total +
              (roadTraffic.get(segmentId)?.averageDelaySeconds ?? 0),
            0,
          ) /
          segments.length /
          60
        : branch.city.metrics.averageTrafficDelayMinutes;
    const routeCongestion =
      segments.length > 0
        ? segments.reduce(
            (total, segmentId) =>
              total +
              (roadTraffic.get(segmentId)?.congestionPercent ?? 0),
            0,
          ) / segments.length
        : branch.city.metrics.congestionPercent;
    const congestionPenalty = clamp(
      routeDelay * 2.8 + routeCongestion * 0.24,
      0,
      48,
    );
    const accessBase = support.connected ? 82 : 8;
    const workers = clamp(
      accessBase +
        support.walkingBonus * 0.45 -
        congestionPenalty,
      6,
      100,
    );
    const customers = clamp(
      accessBase +
        support.walkingBonus * 0.75 +
        support.cyclingBonus * 0.25 -
        congestionPenalty * 0.82,
      5,
      100,
    );
    const freight = clamp(
      accessBase - 4 - congestionPenalty * 1.08,
      3,
      100,
    );
    const services = clamp(
      accessBase +
        support.walkingBonus * 0.8 -
        congestionPenalty * 0.68,
      12,
      100,
    );
    profiles.set(building.id, {
      overall: round((workers + customers + freight + services) / 4),
      workers: round(workers),
      customers: round(customers),
      freight: round(freight),
      services: round(services),
      averageTravelMinutes: round(routeDelay),
      congestionPenalty: round(congestionPenalty),
      transitBonus: 0,
    });
  }
  return profiles;
}

function compareCityBranches(
  control: Readonly<ProjectionBranch>,
  intervention: Readonly<ProjectionBranch>,
  horizonDays: ImpactHorizon,
): CityImpactHorizon {
  const before = cityMetrics(control);
  const after = cityMetrics(intervention);
  return {
    horizonDays,
    metrics: compareMetricRecords(before, after),
    drivers: cityDrivers(before, after),
  };
}

function cityMetrics(branch: Readonly<ProjectionBranch>): CityImpactMetrics {
  const detail = detailTotals(branch.entities);
  const detailRevenueDelta =
    (detail.operatingRevenue -
      branch.baselineDetail.operatingRevenue) *
    branch.sampleScale;
  const detailProfitDelta =
    (detail.profit - branch.baselineDetail.profit) *
    branch.sampleScale;
  const detailSpendingDelta =
    (detail.wages - branch.baselineDetail.wages) *
    branch.sampleScale *
    0.58;
  const detailTransportDelta =
    (detail.transportCost -
      branch.baselineDetail.transportCost) *
    branch.sampleScale;
  const employmentDelta =
    (detail.activeWorkers -
      branch.baselineDetail.activeWorkers) *
    branch.sampleScale;
  const jobsDelta =
    (detail.jobs - branch.baselineDetail.jobs) * branch.sampleScale;
  const laborForce = Math.max(
    1,
    branch.city.metrics.employedResidents /
      Math.max(
        0.05,
        1 - branch.city.metrics.unemploymentPercent / 100,
      ),
  );
  const unemploymentPercent = clamp(
    branch.city.metrics.unemploymentPercent -
      (employmentDelta / laborForce) * 100,
    0,
    100,
  );
  const housingDelta =
    (detail.housingCapacity -
      branch.baselineDetail.housingCapacity) *
    branch.sampleScale;
  const serviceDelta =
    (detail.serviceDelivered -
      branch.baselineDetail.serviceDelivered) *
    branch.sampleScale;
  return {
    dailyOutput:
      branch.city.metrics.grossCityProductDaily + detailRevenueDelta,
    unemploymentPercent,
    trafficCostDaily: Math.max(
      0,
      branch.city.metrics.congestionCostDaily + detailTransportDelta,
    ),
    annualizedNetMigration:
      branch.city.metrics.annualizedNetMigration +
      employmentDelta * 0.08 +
      housingDelta * 0.03 +
      serviceDelta * 0.002,
    governmentFunds: branch.city.metrics.municipalBalance,
    publicConstruction: branch.municipalProjectSpending,
    jobs: branch.city.metrics.jobs + jobsDelta,
    businessProfitDaily:
      branch.city.metrics.businessProfitDaily + detailProfitDelta,
    householdSpendingDaily:
      branch.city.metrics.householdSpendingDaily + detailSpendingDelta,
    taxRevenueDaily: branch.city.metrics.taxRevenueDaily,
    maintenanceCostDaily: branch.city.metrics.maintenanceCostDaily,
    averageLandValue: branch.city.metrics.averageLandValue,
    averageRentIndex: branch.city.metrics.averageRentIndex,
    civicServiceCoveragePercent:
      branch.city.metrics.civicServiceCoveragePercent,
  };
}

function cityDrivers(
  before: Readonly<CityImpactMetrics>,
  after: Readonly<CityImpactMetrics>,
): ImpactDriver[] {
  return [
    driver(
      "Traffic cost",
      before.trafficCostDaily,
      after.trafficCostDaily,
      "currency-per-day",
      true,
    ),
    driver(
      "Business profit",
      before.businessProfitDaily,
      after.businessProfitDaily,
      "currency-per-day",
    ),
    driver("Jobs", before.jobs, after.jobs, "people"),
    driver(
      "Household spending",
      before.householdSpendingDaily,
      after.householdSpendingDaily,
      "currency-per-day",
    ),
    driver(
      "Tax revenue",
      before.taxRevenueDaily,
      after.taxRevenueDaily,
      "currency-per-day",
    ),
    driver(
      "Maintenance",
      before.maintenanceCostDaily,
      after.maintenanceCostDaily,
      "currency-per-day",
      true,
    ),
  ].sort(
    (left, right) =>
      normalizedDriverChange(right) - normalizedDriverChange(left),
  );
}

function compareBuildingBranches(
  control: Readonly<ProjectionBranch>,
  intervention: Readonly<ProjectionBranch>,
  buildingId: string,
  horizonDays: ImpactHorizon,
): BuildingImpactHorizon {
  const beforeBuilding = control.entities.buildings.find(
    (building) => building.id === buildingId,
  );
  const afterBuilding = intervention.entities.buildings.find(
    (building) => building.id === buildingId,
  );
  const buildingFunction = (afterBuilding ?? beforeBuilding)!.function;
  const beforeTraffic = buildingTraffic(control, buildingId);
  const afterTraffic = buildingTraffic(intervention, buildingId);
  const before = buildingMetrics(
    control.entities,
    beforeBuilding,
    beforeTraffic,
  );
  const after = buildingMetrics(
    intervention.entities,
    afterBuilding,
    afterTraffic,
  );
  return {
    horizonDays,
    metrics: compareMetricRecords(before, after),
    drivers: buildingDrivers(
      buildingFunction,
      before,
      after,
    ),
    affectedRoads: affectedRoadNames(beforeTraffic, afterTraffic),
  };
}

function buildingMetrics(
  entities: Readonly<DetailedEntityState>,
  building: Readonly<DetailedBuilding> | undefined,
  traffic: Readonly<BuildingTrafficAttribution> | null,
): BuildingImpactMetrics {
  if (!building) return zeroBuildingMetrics();
  const residents = entities.people.filter(
    (person) => person.homeBuildingId === building.id,
  );
  const residentIncome = residents.reduce(
    (total, person) => total + person.dailyWage,
    0,
  );
  const primary = primaryMetric(building.function).value(building);
  return {
    primaryOutput: primary,
    staffing: building.accounting.activeWorkers,
    operatingScale: building.accounting.operatingScale * 100,
    customers: building.accounting.customers,
    serviceQuality: building.accounting.serviceQuality * 100,
    supplies: building.accounting.goodsReceived,
    inventory: building.goodsInventory,
    transportCost: building.accounting.transportCost,
    operatingRevenue: building.accounting.operatingRevenue,
    operatingCost: building.accounting.operatingCost,
    profit: building.accounting.profit,
    accessibility: building.accessibility.overall,
    routeDelayMinutes:
      traffic?.averageRouteDelayMinutes ??
      building.accessibility.averageTravelMinutes,
    landValue: building.landValue,
    rentDaily: building.rentDaily,
    residentIncome,
    rentBurdenPercent:
      residentIncome > 0
        ? (building.rentDaily / residentIncome) * 100
        : 0,
  };
}

function zeroBuildingMetrics(): BuildingImpactMetrics {
  return {
    primaryOutput: 0,
    staffing: 0,
    operatingScale: 0,
    customers: 0,
    serviceQuality: 0,
    supplies: 0,
    inventory: 0,
    transportCost: 0,
    operatingRevenue: 0,
    operatingCost: 0,
    profit: 0,
    accessibility: 0,
    routeDelayMinutes: 0,
    landValue: 0,
    rentDaily: 0,
    residentIncome: 0,
    rentBurdenPercent: 0,
  };
}

function buildingDrivers(
  buildingFunction: BuildingFunction,
  before: Readonly<BuildingImpactMetrics>,
  after: Readonly<BuildingImpactMetrics>,
): ImpactDriver[] {
  const drivers = [
    driver(
      "Route delay",
      before.routeDelayMinutes,
      after.routeDelayMinutes,
      "minutes",
      true,
    ),
    driver(
      "Accessibility",
      before.accessibility,
      after.accessibility,
      "score",
    ),
    driver(
      "Staffing",
      before.staffing,
      after.staffing,
      "people",
    ),
    driver(
      "Transport cost",
      before.transportCost,
      after.transportCost,
      "currency-per-day",
      true,
    ),
    driver(
      buildingFunction === "housing"
        ? "Resident income"
        : "Supplies received",
      buildingFunction === "housing"
        ? before.residentIncome
        : before.supplies,
      buildingFunction === "housing"
        ? after.residentIncome
        : after.supplies,
      buildingFunction === "housing"
        ? "currency-per-day"
        : "units",
    ),
    driver(
      primaryMetric(buildingFunction).label,
      before.primaryOutput,
      after.primaryOutput,
      "units",
    ),
    driver(
      "Net result",
      before.profit,
      after.profit,
      "currency-per-day",
    ),
  ];
  return drivers.sort(
    (left, right) =>
      normalizedDriverChange(right) - normalizedDriverChange(left),
  );
}

function buildingTraffic(
  branch: Readonly<ProjectionBranch>,
  buildingId: string,
): BuildingTrafficAttribution | null {
  return calculateBuildingTrafficAttribution(
    buildingId,
    branch.entities,
    branch.traffic.getRoadTraffic(),
    branch.city.metrics.congestionPercent,
    (connection) => routeForConnection(branch, connection),
    (segmentId) => branch.traffic.getRoadDescription(segmentId),
  );
}

function routeForConnection(
  branch: Readonly<ProjectionBranch>,
  connection: Readonly<EntityConnection>,
): string[] {
  const from = routeEndpoint(branch, connection.fromBuildingId);
  const to = routeEndpoint(branch, connection.toBuildingId);
  if (!from || !to) return [];
  return branch.traffic.getRouteSegmentIds(from, to);
}

function routeEndpoint(
  branch: Readonly<ProjectionBranch>,
  id: string,
): Readonly<{ x: number; z: number }> | "outside-work" | "outside-market" | null {
  if (id === "outside-work" || id === "outside-market") return id;
  const building = branch.definitionById.get(id);
  return building ? { x: building.x, z: building.z } : null;
}

function activeDefinitions(
  snapshot: Readonly<EditorSnapshot>,
): EntityBuildingDefinition[] {
  const demolished = new Set(snapshot.demolishedBuildingIds);
  return [
    ...PENN_BUILDINGS.filter((building) => !demolished.has(building.id)),
    ...snapshot.buildings.map(placedBuildingToDefinition),
  ];
}

function detailTotals(
  entities: Readonly<DetailedEntityState>,
): DetailTotals {
  return entities.buildings.reduce<DetailTotals>(
    (totals, building) => {
      totals.operatingRevenue += building.accounting.operatingRevenue;
      totals.profit += building.accounting.profit;
      totals.wages += building.accounting.dailyWages;
      totals.transportCost += building.accounting.transportCost;
      totals.activeWorkers += building.accounting.activeWorkers;
      totals.jobs += building.jobCapacity;
      totals.housingCapacity += building.residentCapacity;
      totals.serviceDelivered += building.accounting.serviceDelivered;
      return totals;
    },
    {
      operatingRevenue: 0,
      profit: 0,
      wages: 0,
      transportCost: 0,
      activeWorkers: 0,
      jobs: 0,
      housingCapacity: 0,
      serviceDelivered: 0,
    },
  );
}

function infrastructureMaintenance(
  roads: readonly ExpansionRoad[],
  objects: readonly ExpansionStreetObject[],
): number {
  const roadCost = roads.reduce(
    (total, road) =>
      total +
      Math.hypot(
        road.endX - road.startX,
        road.endZ - road.startZ,
      ) *
        ROAD_MAINTENANCE_PER_METER_DAILY,
    0,
  );
  const objectCost = objects.reduce(
    (total, object) =>
      total +
      (object.kind === "traffic-signal"
        ? SIGNAL_MAINTENANCE_DAILY
        : CROSSWALK_MAINTENANCE_DAILY),
    0,
  );
  return roadCost + objectCost;
}

function primaryMetric(
  buildingFunction: BuildingFunction,
): {
  label: string;
  value: (building: Readonly<DetailedBuilding>) => number;
} {
  if (buildingFunction === "industrial") {
    return {
      label: "Goods produced",
      value: (building) => building.accounting.goodsProduced,
    };
  }
  if (buildingFunction === "retail") {
    return {
      label: "Goods sold",
      value: (building) => building.accounting.goodsSold,
    };
  }
  if (buildingFunction === "housing") {
    return {
      label: "Occupied homes",
      value: (building) => building.residentIds.length,
    };
  }
  if (isCivicFunction(buildingFunction)) {
    return {
      label: "Services delivered",
      value: (building) => building.accounting.serviceDelivered,
    };
  }
  return {
    label:
      buildingFunction === "parking"
        ? "Paid parking uses"
        : "Service output",
    value: (building) => building.accounting.serviceDelivered,
  };
}

function affectedRoadNames(
  before: Readonly<BuildingTrafficAttribution> | null,
  after: Readonly<BuildingTrafficAttribution> | null,
): string[] {
  const names = new Map<string, { name: string; change: number }>();
  for (const road of before?.roads ?? []) {
    names.set(road.segmentId, {
      name: road.roadName,
      change:
        -(road.roadTripsDaily + road.attributedCongestionCost),
    });
  }
  for (const road of after?.roads ?? []) {
    const current = names.get(road.segmentId);
    names.set(road.segmentId, {
      name: road.roadName,
      change:
        (current?.change ?? 0) +
        road.roadTripsDaily +
        road.attributedCongestionCost,
    });
  }
  return [...names.values()]
    .sort(
      (left, right) =>
        Math.abs(right.change) - Math.abs(left.change),
    )
    .slice(0, 5)
    .map((road) => road.name);
}

function compareMetricRecords<
  RecordType extends Record<keyof RecordType, number>,
>(
  before: Readonly<RecordType>,
  after: Readonly<RecordType>,
): { [Key in keyof RecordType]: ImpactMetricPair } {
  return Object.fromEntries(
    (Object.keys(before) as Array<keyof RecordType>).map((key) => [
      key,
      metricPair(before[key], after[key]),
    ]),
  ) as { [Key in keyof RecordType]: ImpactMetricPair };
}

function metricPair(before: number, after: number): ImpactMetricPair {
  const delta = after - before;
  return {
    before: round(before),
    after: round(after),
    delta: round(delta),
    percentDelta:
      Math.abs(before) < 1e-6
        ? null
        : round((delta / Math.abs(before)) * 100),
  };
}

function driver(
  label: string,
  before: number,
  after: number,
  unit: ImpactDriver["unit"],
  lowerIsBetter = false,
): ImpactDriver {
  return {
    label,
    before: round(before),
    after: round(after),
    delta: round(after - before),
    unit,
    lowerIsBetter,
  };
}

function normalizedDriverChange(
  value: Readonly<ImpactDriver>,
): number {
  return Math.abs(value.delta) / Math.max(1, Math.abs(value.before));
}

function buildingKind(
  definition: Readonly<EntityBuildingDefinition>,
): PlacedBuilding["kind"] {
  if (definition.zone === "residential") return "residential";
  if (definition.zone === "industrial") return "industrial";
  if (definition.zone === "commercial") return "commercial";
  return "civic";
}

function isCivicFunction(buildingFunction: BuildingFunction): boolean {
  return [
    "university",
    "library",
    "school",
    "clinic",
    "culture",
    "recreation",
  ].includes(buildingFunction);
}

function isImpactHorizon(day: number): day is ImpactHorizon {
  return IMPACT_HORIZONS.includes(day as ImpactHorizon);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
