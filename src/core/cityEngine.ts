import type {
  CityAggregateMetrics,
  CityDistrictState,
  CityPolicySettings,
  CitySectionState,
  CityStepResult,
  CitySystemEvent,
  CityTimelinePoint,
} from "../models/cityTypes";
import type { UtilityKind } from "../models/types";
import { advanceCityEconomy } from "./cityEconomy";
import { calendarFromElapsedDays } from "./timeScale";

const UTILITY_KINDS: UtilityKind[] = ["power", "water", "waste"];
const UTILITY_LOSS_RATE: Record<UtilityKind, number> = { power: 0.06, water: 0.08, waste: 0.04 };
const MAX_TIMELINE_POINTS = 520;

export const DEFAULT_CITY_POLICY: CityPolicySettings = {
  roadCapacityScale: 1,
  utilityCapacityScale: 1,
  zoningStrictness: 1,
  transitServiceScale: 1,
};

export function advanceCitySection(
  input: Readonly<CitySectionState>,
  elapsedDays: number,
  policy: Partial<CityPolicySettings> = {},
): CityStepResult {
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0) {
    throw new Error("City elapsed days must be a non-negative finite number");
  }
  const settings = sanitizePolicy({ ...DEFAULT_CITY_POLICY, ...policy });
  const state = cloneCityState(input);
  const events: CitySystemEvent[] = [];
  let remaining = elapsedDays;
  while (remaining > 1e-9) {
    const step = Math.min(1, remaining);
    advanceCityDay(state, step, settings, events);
    remaining -= step;
  }
  return { state, events };
}

export function summarizeCitySection(
  districts: readonly CityDistrictState[],
  municipalBalance: number,
  taxRate: number,
  links: Readonly<CitySectionState["links"]>,
  utilityCapacity: Readonly<CitySectionState["utilityCapacity"]>,
): CityAggregateMetrics {
  const population = sum(districts.map((district) => district.population));
  const households = sum(districts.map((district) => district.households));
  const jobs = sum(districts.map((district) => district.jobs));
  const laborForce = sum(districts.map((district) => district.laborForce));
  const employedResidents = sum(districts.map((district) => district.employedResidents));
  const housingCapacity = sum(districts.map((district) => district.housingUnits * 2.45));
  const householdIncomeDaily = sum(districts.map((district) => district.householdIncomeDaily));
  const disposableIncomeDaily = sum(districts.map((district) => district.disposableIncomeDaily));
  const householdSpendingDaily = sum(districts.map((district) => district.householdSpendingDaily));
  const businessRevenueDaily = sum(districts.map((district) => district.businessRevenueDaily));
  const businessCostsDaily = sum(districts.map((district) => district.businessCostsDaily));
  const businessProfitDaily = sum(districts.map((district) => district.businessProfitDaily));
  const propertyRentIncomeDaily = sum(districts.map((district) => district.propertyRentIncomeDaily));
  const propertyOperatingCostDaily = sum(districts.map((district) => district.propertyOperatingCostDaily));
  const utilityCostDaily = sum(districts.map((district) => district.utilityCostDaily));
  const civicOperatingCostDaily = sum(districts.map((district) => district.civicOperatingCostDaily));
  const goodsProducedDaily = sum(districts.map((district) => district.goodsProducedDaily));
  const goodsConsumedDaily = sum(districts.map((district) => district.goodsConsumedDaily));
  const grossCityProductDaily = businessRevenueDaily;
  const taxRevenueDaily = householdIncomeDaily * taxRate * 0.16 + Math.max(0, businessProfitDaily) * taxRate;
  const developedFloorArea = sum(districts.map((district) => district.developedFloorArea));
  const networkCapacity = sum(links.map((link) => link.roadCapacityDaily + link.transitCapacityDaily));
  const totalUtilityCapacity = sum(Object.values(utilityCapacity));
  const utilityOperatingCostDaily = utilityCostDaily * 0.62 + totalUtilityCapacity * 0.012;
  const maintenanceCostDaily = developedFloorArea * 0.008 + networkCapacity * 0.011
    + utilityOperatingCostDaily + civicOperatingCostDaily;
  const annualizedMigrationIn = sum(districts.map((district) => Math.max(0, district.annualizedMigration)));
  const annualizedMigrationOut = sum(districts.map((district) => Math.max(0, -district.annualizedMigration)));

  return {
    population: round(population),
    households: round(households),
    jobs: round(jobs),
    employedResidents: round(employedResidents),
    unemploymentPercent: round(laborForce > 0 ? ((laborForce - employedResidents) / laborForce) * 100 : 0),
    housingOccupancyPercent: round(clamp((population / Math.max(1, housingCapacity)) * 100, 0, 140)),
    grossCityProductDaily: round(grossCityProductDaily),
    householdIncomeDaily: round(householdIncomeDaily),
    disposableIncomeDaily: round(disposableIncomeDaily),
    householdSpendingDaily: round(householdSpendingDaily),
    businessRevenueDaily: round(businessRevenueDaily),
    businessCostsDaily: round(businessCostsDaily),
    businessProfitDaily: round(businessProfitDaily),
    propertyRentIncomeDaily: round(propertyRentIncomeDaily),
    propertyOperatingCostDaily: round(propertyOperatingCostDaily),
    utilityCostDaily: round(utilityCostDaily),
    civicServiceCoveragePercent: round(weightedAverage(districts, "civicServiceQualityPercent")),
    civicOperatingCostDaily: round(civicOperatingCostDaily),
    goodsProducedDaily: round(goodsProducedDaily),
    goodsConsumedDaily: round(goodsConsumedDaily),
    goodsImportedDaily: round(sum(districts.map((district) => district.goodsImportedDaily))),
    goodsExportedDaily: round(sum(districts.map((district) => district.goodsExportedDaily))),
    averageLandValue: round(weightedAverage(districts, "landValue")),
    averageRentIndex: round(weightedAverage(districts, "rentIndex")),
    utilityCoveragePercent: round(average(UTILITY_KINDS.map((kind) => weightedUtilityCoverage(districts, kind)))),
    wasteCollectionPercent: round(weightedUtilityCoverage(districts, "waste")),
    commuteTripsDaily: round(sum(districts.map((district) => district.commuteTripsDaily))),
    shoppingTripsDaily: round(sum(districts.map((district) => district.shoppingTripsDaily))),
    vehicleTripsDaily: round(sum(districts.map((district) => {
      const personTrips = Math.max(0, district.commuteTripsDaily + district.shoppingTripsDaily - district.pedestrianTripsDaily);
      return personTrips * (1 - district.transitSharePercent / 100) + district.freightTripsDaily;
    }))),
    pedestrianTripsDaily: round(sum(districts.map((district) => district.pedestrianTripsDaily))),
    freightTripsDaily: round(sum(districts.map((district) => district.freightTripsDaily))),
    externalCommutersDaily: round(sum(districts.map((district) => district.externalCommutersDaily))),
    annualizedMigrationIn: round(annualizedMigrationIn),
    annualizedMigrationOut: round(annualizedMigrationOut),
    annualizedNetMigration: round(annualizedMigrationIn - annualizedMigrationOut),
    dailyTrips: round(sum(districts.map((district) => district.dailyTrips))),
    congestionPercent: round(weightedAverage(districts, "congestionPercent")),
    transitSharePercent: round(weightedAverage(districts, "transitSharePercent")),
    taxRevenueDaily: round(taxRevenueDaily),
    maintenanceCostDaily: round(maintenanceCostDaily),
    municipalBalance: round(municipalBalance),
    happiness: round(weightedAverage(districts, "happiness")),
  };
}

function advanceCityDay(
  state: CitySectionState,
  elapsedDays: number,
  policy: CityPolicySettings,
  events: CitySystemEvent[],
): void {
  const previousCalendar = calendarFromElapsedDays(state.startYear, state.elapsedDays);
  const connectedCapacity = districtCapacity(state);
  const demandByDistrict = state.districts.map(calculateUtilityDemand);
  const effectiveUtilityCapacity = mapRecord(
    state.utilityCapacity,
    (capacity) => capacity * policy.utilityCapacityScale,
  );
  const utilityAllocations = Object.fromEntries(UTILITY_KINDS.map((kind) => [
    kind,
    allocateDistrictUtility(state.districts, demandByDistrict, kind, effectiveUtilityCapacity[kind]),
  ])) as Record<UtilityKind, Map<string, number>>;

  state.districts = state.districts.map((district, index) => {
    const utilityDemand = demandByDistrict[index]!;
    const utilityCoverage = Object.fromEntries(UTILITY_KINDS.map((kind) => [
      kind,
      clamp01((utilityAllocations[kind].get(district.id) ?? 0) / Math.max(1e-9, utilityDemand[kind])),
    ])) as Record<UtilityKind, number>;
    return {
      ...district,
      utilityDemand: mapRecord(utilityDemand, round),
      utilityCoverage: mapRecord(utilityCoverage, clamp01),
    };
  });

  const economy = advanceCityEconomy({
    districts: state.districts,
    externalMarkets: state.externalMarkets,
    previousMarket: state.market,
    transportCapacity: connectedCapacity,
    elapsedDays,
  });
  state.externalMarkets = economy.externalMarkets;
  state.market = economy.market;

  state.districts = economy.districts.map((district) => {
    const utilityReliability = average(Object.values(district.utilityCoverage));
    const capacity = connectedCapacity.get(district.id) ?? { road: 1, transit: 0, freight: 0 };
    const transitCapacity = capacity.transit * policy.transitServiceScale;
    const transitSharePercent = clamp(
      8 + 62 * transitCapacity / Math.max(1, district.commuteTripsDaily + transitCapacity),
      8,
      68,
    );
    const motorizedPersonTrips = Math.max(
      0,
      district.commuteTripsDaily + district.shoppingTripsDaily - district.pedestrianTripsDaily,
    );
    const privateTrips = motorizedPersonTrips * (1 - transitSharePercent / 100) + district.freightTripsDaily;
    const congestionPercent = clamp(
      100 * (privateTrips / Math.max(1, capacity.road * policy.roadCapacityScale)) ** 1.35,
      0,
      100,
    );
    const unemploymentPercent = district.laborForce > 0
      ? ((district.laborForce - district.employedResidents) / district.laborForce) * 100
      : 0;
    const goodsCoverage = district.goodsConsumedDaily / Math.max(1, sum(Object.values(district.goodsDemandByType)));
    const housingCapacity = Math.max(1, district.housingUnits * 2.45);
    const housingOccupancyPercent = clamp((district.population / housingCapacity) * 100, 0, 140);
    const rentBurden = clamp01(
      district.households * district.rentIndex * 52 / Math.max(1, district.householdIncomeDaily),
    );
    const spendingRoom = clamp01(district.disposableIncomeDaily / Math.max(1, district.householdIncomeDaily));
    const happiness = clamp(
      29 + utilityReliability * 22 + (1 - unemploymentPercent / 100) * 18 + goodsCoverage * 12 +
      (1 - congestionPercent / 100) * 7 + (1 - rentBurden) * 5 + spendingRoom * 6 +
      district.civicServiceQualityPercent / 100 * 5,
      0,
      100,
    );
    const housingRoom = clamp01(1 - housingOccupancyPercent / 118);
    const jobSignal = clamp((district.jobs - district.laborForce) / Math.max(1, district.laborForce), -0.5, 0.5);
    const annualMigrationRate = clamp(
      jobSignal * 0.035 + (happiness - 65) / 1_100 + housingRoom * 0.025 + (utilityReliability - 0.9) * 0.03 - congestionPercent / 5_000,
      -0.045,
      0.065,
    );
    const annualizedMigration = district.population * annualMigrationRate;
    const naturalAnnualGrowth = district.population * (0.0065 - district.seniors / Math.max(1, district.population) * 0.014);
    const populationDelta = (annualizedMigration + naturalAnnualGrowth) * elapsedDays / 365;
    const population = Math.max(0, district.population + populationDelta);
    const demographicScale = district.population > 0 ? population / district.population : 1;

    const terrainPenalty = clamp01(district.terrainSlope / 0.3);
    const floorRoom = Math.max(0, district.maxFloorArea - district.developedFloorArea);
    const growthPermission = clamp(1.6 - policy.zoningStrictness - terrainPenalty * 0.6, 0, 1);
    const housingGrowth = Math.min(
      floorRoom / 88,
      Math.max(0, housingOccupancyPercent - 82) * district.housingUnits * 0.000035 * growthPermission * utilityReliability * elapsedDays,
    );
    const commercialGrowth = Math.min(
      Math.max(0, floorRoom - housingGrowth * 88),
      district.commercialFloorArea * clamp(
        district.businessProfitDaily / Math.max(1, district.businessRevenueDaily) * 0.0012,
        0,
        0.00045,
      ) * growthPermission * elapsedDays,
    );
    const industrialGrowth = Math.min(
      Math.max(0, floorRoom - housingGrowth * 88 - commercialGrowth),
      district.industrialFloorArea * clamp(
        state.market.importDependencePercent / 100 * 0.00055 +
        Math.max(0, district.businessProfitDaily) / Math.max(1, district.businessRevenueDaily) * 0.00035,
        0,
        0.0004,
      ) * growthPermission * elapsedDays,
    );
    const developedFloorArea = district.developedFloorArea + housingGrowth * 88 + commercialGrowth + industrialGrowth;
    const profitMargin = district.businessProfitDaily / Math.max(1, district.businessRevenueDaily);
    const privateJobs = district.jobs * privateJobShare(district);
    const jobs = Math.max(0, district.jobs + (
      commercialGrowth / 34 + industrialGrowth / 48 + privateJobs * clamp(profitMargin, -0.2, 0.2) * 0.00012 * elapsedDays
    ));
    const dailyTrips = district.commuteTripsDaily + district.shoppingTripsDaily + district.freightTripsDaily;
    const accessScore = clamp01(
      (capacity.road * policy.roadCapacityScale + transitCapacity) / Math.max(1, dailyTrips * 1.4),
    );
    const targetLandValue = clamp(
      55 + district.averageWageDaily * 0.42 + accessScore * 145 + utilityReliability * 105 +
      happiness * 1.05 + clamp(profitMargin, -0.3, 0.3) * 80 - congestionPercent * 1.2,
      35,
      720,
    );
    const landValue = district.landValue + (targetLandValue - district.landValue) * 0.0035 * elapsedDays;
    const rentIndex = Math.max(0.25, district.rentIndex + ((landValue / 200) * (0.7 + housingOccupancyPercent / 220) - district.rentIndex) * 0.006 * elapsedDays);
    const capacityGrowth = 1 + (
      industrialGrowth / Math.max(1, district.industrialFloorArea) * 0.7 +
      commercialGrowth / Math.max(1, district.commercialFloorArea) * 0.25
    );

    return {
      ...district,
      population: round(population),
      households: round(population / 2.42),
      children: round(district.children * demographicScale),
      adults: round(district.adults * demographicScale),
      seniors: round(district.seniors * demographicScale),
      laborForce: round(district.adults * demographicScale * 0.74),
      employedResidents: round(district.employedResidents * demographicScale),
      housingUnits: round(district.housingUnits + housingGrowth),
      commercialFloorArea: round(district.commercialFloorArea + commercialGrowth),
      industrialFloorArea: round(district.industrialFloorArea + industrialGrowth),
      developedFloorArea: round(developedFloorArea),
      jobs: round(jobs),
      landValue: round(landValue),
      rentIndex: round(rentIndex),
      productionCapacity: {
        food: round(district.productionCapacity.food * capacityGrowth),
        consumerGoods: round(district.productionCapacity.consumerGoods * capacityGrowth),
        industrialMaterials: round(district.productionCapacity.industrialMaterials * capacityGrowth),
      },
      dailyTrips: round(dailyTrips),
      congestionPercent: round(congestionPercent),
      transitSharePercent: round(transitSharePercent),
      unemploymentPercent: round(unemploymentPercent),
      housingOccupancyPercent: round(housingOccupancyPercent),
      happiness: round(happiness),
      annualizedMigration: round(annualizedMigration),
    };
  });

  const preliminary = summarizeCitySection(state.districts, state.municipalBudget, state.taxRate, state.links, effectiveUtilityCapacity);
  state.municipalBudget = round(state.municipalBudget + (
    preliminary.taxRevenueDaily + preliminary.utilityCostDaily - preliminary.maintenanceCostDaily
  ) * elapsedDays);
  state.elapsedDays = round(state.elapsedDays + elapsedDays);
  const calendar = calendarFromElapsedDays(state.startYear, state.elapsedDays);
  state.year = calendar.year;
  state.month = calendar.month;
  state.metrics = summarizeCitySection(state.districts, state.municipalBudget, state.taxRate, state.links, effectiveUtilityCapacity);
  maybeRecordTimeline(state, previousCalendar.month !== calendar.month || previousCalendar.year !== calendar.year);
  addEvents(state, previousCalendar, calendar, events);
}

function calculateUtilityDemand(district: CityDistrictState): Record<UtilityKind, number> {
  return {
    power: district.population * 0.48 + district.developedFloorArea * 0.012,
    water: district.population * 0.39 + district.developedFloorArea * 0.008,
    waste: district.population * 0.13 + district.commercialFloorArea * 0.018
      + district.industrialFloorArea * 0.026 + district.civicFloorArea * 0.012,
  };
}

function allocateDistrictUtility(
  districts: readonly CityDistrictState[],
  demandByDistrict: readonly Record<UtilityKind, number>[],
  kind: UtilityKind,
  capacity: number,
): Map<string, number> {
  const demandById = new Map(districts.map((district, index) => [
    district.id,
    Math.max(0, demandByDistrict[index]?.[kind] ?? 0),
  ]));
  const delivered = new Map<string, number>();
  let remaining = Math.min(
    sum([...demandById.values()]),
    Math.max(0, capacity) * (1 - UTILITY_LOSS_RATE[kind]),
  );
  let active = districts.map((district) => district.id);

  while (remaining > 1e-9 && active.length > 0) {
    const totalWeight = sum(active.map((id) => {
      const district = districts.find((candidate) => candidate.id === id);
      const unmet = Math.max(0, (demandById.get(id) ?? 0) - (delivered.get(id) ?? 0));
      return unmet * utilityPriority(district, kind);
    }));
    if (totalWeight <= 0) break;
    const available = remaining;
    let deliveredThisPass = 0;
    for (const id of active) {
      const district = districts.find((candidate) => candidate.id === id);
      const unmet = Math.max(0, (demandById.get(id) ?? 0) - (delivered.get(id) ?? 0));
      const allocation = Math.min(
        unmet,
        available * unmet * utilityPriority(district, kind) / totalWeight,
      );
      delivered.set(id, (delivered.get(id) ?? 0) + allocation);
      deliveredThisPass += allocation;
    }
    remaining = Math.max(0, remaining - deliveredThisPass);
    active = active.filter((id) => (delivered.get(id) ?? 0) < (demandById.get(id) ?? 0) - 1e-9);
    if (deliveredThisPass <= 1e-9) break;
  }
  return delivered;
}

function utilityPriority(district: CityDistrictState | undefined, kind: UtilityKind): number {
  if (district?.primaryZone === "civic") return 1.35;
  if (district?.primaryZone === "residential") return kind === "waste" ? 1.15 : 1.25;
  if (district?.primaryZone === "park") return 0.75;
  return 1;
}

function privateJobShare(district: CityDistrictState): number {
  const privateWeight = district.commercialFloorArea / 34 + district.industrialFloorArea / 48;
  const civicWeight = district.civicFloorArea / 42;
  return privateWeight + civicWeight > 0 ? privateWeight / (privateWeight + civicWeight) : 0;
}

function districtCapacity(state: CitySectionState): Map<string, { road: number; transit: number; freight: number }> {
  const capacity = new Map(state.districts.map((district) => [district.id, { road: 0, transit: 0, freight: 0 }]));
  for (const link of state.links) {
    for (const id of [link.fromDistrictId, link.toDistrictId]) {
      const district = capacity.get(id);
      if (!district) continue;
      district.road += link.roadCapacityDaily / 2;
      district.transit += link.transitCapacityDaily / 2;
      district.freight += link.freightCapacityDaily / 2;
    }
  }
  return capacity;
}

function maybeRecordTimeline(state: CitySectionState, calendarBoundary: boolean): void {
  const completedDay = Math.floor(state.elapsedDays);
  if (completedDay <= 0 || (!calendarBoundary && completedDay % 7 !== 0)) return;
  if (state.timeline.at(-1)?.day === completedDay) return;
  const point: CityTimelinePoint = {
    day: completedDay,
    year: state.year,
    month: state.month,
    population: state.metrics.population,
    grossCityProductDaily: state.metrics.grossCityProductDaily,
    averageLandValue: state.metrics.averageLandValue,
    congestionPercent: state.metrics.congestionPercent,
    utilityCoveragePercent: state.metrics.utilityCoveragePercent,
    housingOccupancyPercent: state.metrics.housingOccupancyPercent,
    municipalBalance: state.metrics.municipalBalance,
    happiness: state.metrics.happiness,
  };
  state.timeline = [...state.timeline, point].slice(-MAX_TIMELINE_POINTS);
}

function addEvents(
  state: CitySectionState,
  previous: ReturnType<typeof calendarFromElapsedDays>,
  current: ReturnType<typeof calendarFromElapsedDays>,
  events: CitySystemEvent[],
): void {
  if (previous.year !== current.year) {
    addUnique(events, { category: "population", message: `${current.year} begins with ${Math.round(state.metrics.population).toLocaleString()} residents.`, severity: "info" });
  } else if (previous.month !== current.month) {
    addUnique(events, { category: "finance", message: `Month ${current.month}: municipal balance is $${Math.round(state.municipalBudget).toLocaleString()}.`, severity: state.municipalBudget < 0 ? "warning" : "info" });
  }
  if (state.metrics.utilityCoveragePercent < 88) {
    addUnique(events, { category: "utilities", message: `City utility coverage fell to ${Math.round(state.metrics.utilityCoveragePercent)}%.`, severity: "warning" });
  }
  if (state.metrics.congestionPercent > 72) {
    addUnique(events, { category: "mobility", message: `Network congestion reached ${Math.round(state.metrics.congestionPercent)}%.`, severity: "warning" });
  }
  if (state.metrics.housingOccupancyPercent > 105) {
    addUnique(events, { category: "land-use", message: "Housing demand exceeds the section's current zoned capacity.", severity: "warning" });
  }
  const unmetDemand = sum(Object.values(state.market.unmetDemandDaily));
  const totalDemand = sum(Object.values(state.market.demandDaily));
  if (unmetDemand / Math.max(1, totalDemand) > 0.08) {
    addUnique(events, {
      category: "economy",
      message: `${Math.round(unmetDemand).toLocaleString()} units of daily goods demand could not be supplied.`,
      severity: "warning",
    });
  }
  if (state.market.importDependencePercent > 55) {
    addUnique(events, {
      category: "economy",
      message: `External markets supply ${Math.round(state.market.importDependencePercent)}% of purchased goods.`,
      severity: "info",
    });
  }
}

function addUnique(events: CitySystemEvent[], event: CitySystemEvent): void {
  if (!events.some((candidate) => candidate.category === event.category && candidate.message === event.message)) events.push(event);
}

function cloneCityState(state: Readonly<CitySectionState>): CitySectionState {
  return {
    ...state,
    utilityCapacity: { ...state.utilityCapacity },
    districts: state.districts.map((district) => ({
      ...district,
      productionProfile: district.productionProfile ? { ...district.productionProfile } : undefined,
      productionCapacity: { ...district.productionCapacity },
      goodsInventory: { ...district.goodsInventory },
      goodsDemandByType: { ...district.goodsDemandByType },
      goodsProducedByType: { ...district.goodsProducedByType },
      goodsConsumedByType: { ...district.goodsConsumedByType },
      goodsImportedByType: { ...district.goodsImportedByType },
      goodsExportedByType: { ...district.goodsExportedByType },
      utilityDemand: { ...district.utilityDemand },
      utilityCoverage: { ...district.utilityCoverage },
    })),
    links: state.links.map((link) => ({ ...link })),
    externalMarkets: state.externalMarkets.map((market) => ({
      ...market,
      goodsPrices: { ...market.goodsPrices },
      goodsSupplyDaily: { ...market.goodsSupplyDaily },
      goodsDemandDaily: { ...market.goodsDemandDaily },
      importsDaily: { ...market.importsDaily },
      exportsDaily: { ...market.exportsDaily },
    })),
    market: {
      ...state.market,
      prices: { ...state.market.prices },
      demandDaily: { ...state.market.demandDaily },
      localSupplyDaily: { ...state.market.localSupplyDaily },
      fulfilledDaily: { ...state.market.fulfilledDaily },
      importsDaily: { ...state.market.importsDaily },
      exportsDaily: { ...state.market.exportsDaily },
      unmetDemandDaily: { ...state.market.unmetDemandDaily },
    },
    metrics: { ...state.metrics },
    timeline: state.timeline.map((point) => ({ ...point })),
  };
}

function sanitizePolicy(policy: CityPolicySettings): CityPolicySettings {
  return {
    roadCapacityScale: finiteClamp(policy.roadCapacityScale, 0.25, 3, 1),
    utilityCapacityScale: finiteClamp(policy.utilityCapacityScale, 0.25, 3, 1),
    zoningStrictness: finiteClamp(policy.zoningStrictness, 0.25, 2, 1),
    transitServiceScale: finiteClamp(policy.transitServiceScale, 0.25, 3, 1),
  };
}

function mapRecord(record: Record<UtilityKind, number>, transform: (value: number) => number): Record<UtilityKind, number> {
  return Object.fromEntries(UTILITY_KINDS.map((kind) => [kind, transform(record[kind])])) as Record<UtilityKind, number>;
}

function weightedUtilityCoverage(districts: readonly CityDistrictState[], kind: UtilityKind): number {
  const population = sum(districts.map((district) => district.population));
  if (population <= 0) return 100;
  return sum(districts.map((district) => district.utilityCoverage[kind] * 100 * district.population)) / population;
}

function weightedAverage<K extends keyof CityDistrictState>(districts: readonly CityDistrictState[], key: K): number {
  const population = sum(districts.map((district) => district.population));
  if (population <= 0) return 0;
  return sum(districts.map((district) => Number(district[key]) * district.population)) / population;
}

function average(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function finiteClamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
