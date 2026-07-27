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
import { calendarFromElapsedDays } from "./timeScale";

const UTILITY_KINDS: UtilityKind[] = ["power", "water", "waste"];
const MAX_TIMELINE_POINTS = 520;

export const DEFAULT_CITY_POLICY: CityPolicySettings = {
  roadCapacityScale: 1,
  utilityCapacityScale: 1,
  zoningStrictness: 1,
  transitServiceScale: 1,
  travelDemandScale: 1,
  freightDemandScale: 1,
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
  const goodsProducedDaily = sum(districts.map((district) => district.goodsProducedDaily));
  const goodsConsumedDaily = sum(districts.map((district) => district.goodsConsumedDaily));
  const grossCityProductDaily = sum(districts.map((district) =>
    district.employedResidents * (district.averageIncome / 260) * 0.72 +
    district.goodsProducedDaily * 38 +
    district.commercialFloorArea * 1.2,
  ));
  const householdSpendingDaily = sum(districts.map((district) =>
    district.population * (24 + district.averageIncome / 4_000),
  ));
  const taxRevenueDaily = grossCityProductDaily * taxRate * 0.06;
  const developedFloorArea = sum(districts.map((district) => district.developedFloorArea));
  const networkCapacity = sum(links.map((link) => link.roadCapacityDaily + link.transitCapacityDaily));
  const totalUtilityCapacity = sum(Object.values(utilityCapacity));
  const maintenanceCostDaily = developedFloorArea * 0.022 + networkCapacity * 0.011 + totalUtilityCapacity * 0.09;

  return {
    population: round(population),
    households: round(households),
    jobs: round(jobs),
    employedResidents: round(employedResidents),
    unemploymentPercent: round(laborForce > 0 ? ((laborForce - employedResidents) / laborForce) * 100 : 0),
    housingOccupancyPercent: round(clamp((population / Math.max(1, housingCapacity)) * 100, 0, 140)),
    grossCityProductDaily: round(grossCityProductDaily),
    householdSpendingDaily: round(householdSpendingDaily),
    goodsProducedDaily: round(goodsProducedDaily),
    goodsConsumedDaily: round(goodsConsumedDaily),
    goodsImportedDaily: round(sum(districts.map((district) => district.goodsImportedDaily))),
    goodsExportedDaily: round(sum(districts.map((district) => district.goodsExportedDaily))),
    averageLandValue: round(weightedAverage(districts, "landValue")),
    averageRentIndex: round(weightedAverage(districts, "rentIndex")),
    utilityCoveragePercent: round(average(UTILITY_KINDS.map((kind) => weightedUtilityCoverage(districts, kind)))),
    wasteCollectionPercent: round(weightedUtilityCoverage(districts, "waste")),
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
  const totalLabor = sum(state.districts.map((district) => district.laborForce));
  const totalJobs = sum(state.districts.map((district) => district.jobs));
  const cityEmploymentRatio = totalLabor > 0 ? clamp01(totalJobs / totalLabor) : 1;
  const connectedCapacity = districtCapacity(state);
  const demandByDistrict = state.districts.map(calculateUtilityDemand);
  const totalUtilityDemand = Object.fromEntries(UTILITY_KINDS.map((kind) => [
    kind,
    sum(demandByDistrict.map((demand) => demand[kind])),
  ])) as Record<UtilityKind, number>;
  const baseUtilityCoverage = Object.fromEntries(UTILITY_KINDS.map((kind) => [
    kind,
    clamp01((state.utilityCapacity[kind] * policy.utilityCapacityScale) / Math.max(1, totalUtilityDemand[kind])),
  ])) as Record<UtilityKind, number>;

  state.districts = state.districts.map((district, index) => {
    const utilityDemand = demandByDistrict[index]!;
    const priority = district.primaryZone === "civic" ? 1.08 : district.primaryZone === "residential" ? 1.04 : district.primaryZone === "park" ? 0.9 : 1;
    const utilityCoverage = Object.fromEntries(UTILITY_KINDS.map((kind) => [
      kind,
      clamp01(baseUtilityCoverage[kind] * priority),
    ])) as Record<UtilityKind, number>;
    const utilityReliability = average(Object.values(utilityCoverage));
    const capacity = connectedCapacity.get(district.id) ?? { road: 1, transit: 0, freight: 0 };
    const dailyTrips = district.population * (1.75 + cityEmploymentRatio * 0.62) * policy.travelDemandScale;
    const transitCapacity = capacity.transit * policy.transitServiceScale;
    const transitSharePercent = clamp(10 + 48 * (transitCapacity / Math.max(1, dailyTrips)), 8, 68);
    const privateTrips = dailyTrips * Math.max(0.1, 0.84 - transitSharePercent / 100);
    const congestionPercent = clamp(100 * (privateTrips / Math.max(1, capacity.road * policy.roadCapacityScale)) ** 1.35, 0, 100);
    const freightPressure = policy.freightDemandScale * district.goodsProductionCapacity / Math.max(1, capacity.freight);
    const employedResidents = district.laborForce * cityEmploymentRatio * clamp(1.04 - congestionPercent / 360, 0.72, 1);
    const unemploymentPercent = district.laborForce > 0 ? ((district.laborForce - employedResidents) / district.laborForce) * 100 : 0;
    const productionUtilization = clamp01((employedResidents / Math.max(1, district.laborForce)) * utilityReliability * (1 - freightPressure * 0.04));
    const goodsProducedDaily = district.goodsProductionCapacity * productionUtilization;
    const goodsConsumedDaily = district.population * (0.38 + district.averageIncome / 240_000);
    const availableGoods = district.goodsInventory + goodsProducedDaily;
    const locallyConsumed = Math.min(availableGoods, goodsConsumedDaily);
    const goodsImportedDaily = Math.max(0, goodsConsumedDaily - availableGoods);
    const reserve = district.goodsProductionCapacity * 1.5;
    const goodsExportedDaily = Math.max(0, availableGoods - locallyConsumed - reserve) * 0.35;
    const goodsInventory = Math.max(0, availableGoods - locallyConsumed - goodsExportedDaily);
    const housingCapacity = Math.max(1, district.housingUnits * 2.45);
    const housingOccupancyPercent = clamp((district.population / housingCapacity) * 100, 0, 140);
    const goodsCoverage = goodsConsumedDaily > 0 ? clamp01(locallyConsumed / goodsConsumedDaily) : 1;
    const rentBurden = clamp01((district.rentIndex * 1_250) / Math.max(1, district.averageIncome));
    const happiness = clamp(
      34 + utilityReliability * 22 + (1 - unemploymentPercent / 100) * 18 + goodsCoverage * 12 +
      (1 - congestionPercent / 100) * 9 + (1 - rentBurden) * 9,
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
      district.commercialFloorArea * clamp((goodsCoverage - 0.8) * 0.0012, 0, 0.0005) * growthPermission * elapsedDays,
    );
    const industrialGrowth = Math.min(
      Math.max(0, floorRoom - housingGrowth * 88 - commercialGrowth),
      district.industrialFloorArea * clamp((goodsImportedDaily / Math.max(1, goodsConsumedDaily)) * 0.0008, 0, 0.0004) * growthPermission * elapsedDays,
    );
    const developedFloorArea = district.developedFloorArea + housingGrowth * 88 + commercialGrowth + industrialGrowth;
    const jobs = district.jobs + commercialGrowth / 34 + industrialGrowth / 48;
    const accessScore = clamp01((capacity.road * policy.roadCapacityScale + transitCapacity) / Math.max(1, dailyTrips * 1.4));
    const targetLandValue = clamp(
      70 + district.averageIncome / 520 + accessScore * 145 + utilityReliability * 110 + happiness * 1.1 - congestionPercent * 1.35,
      35,
      720,
    );
    const landValue = district.landValue + (targetLandValue - district.landValue) * 0.0035 * elapsedDays;
    const rentIndex = Math.max(0.25, district.rentIndex + ((landValue / 200) * (0.7 + housingOccupancyPercent / 220) - district.rentIndex) * 0.006 * elapsedDays);

    return {
      ...district,
      population: round(population),
      households: round(population / 2.42),
      children: round(district.children * demographicScale),
      adults: round(district.adults * demographicScale),
      seniors: round(district.seniors * demographicScale),
      laborForce: round(district.adults * demographicScale * 0.74),
      employedResidents: round(employedResidents),
      housingUnits: round(district.housingUnits + housingGrowth),
      commercialFloorArea: round(district.commercialFloorArea + commercialGrowth),
      industrialFloorArea: round(district.industrialFloorArea + industrialGrowth),
      developedFloorArea: round(developedFloorArea),
      jobs: round(jobs),
      landValue: round(landValue),
      rentIndex: round(rentIndex),
      goodsInventory: round(goodsInventory),
      goodsProducedDaily: round(goodsProducedDaily),
      goodsConsumedDaily: round(goodsConsumedDaily),
      goodsImportedDaily: round(goodsImportedDaily),
      goodsExportedDaily: round(goodsExportedDaily),
      utilityDemand: mapRecord(utilityDemand, round),
      utilityCoverage: mapRecord(utilityCoverage, (value) => round(value)),
      dailyTrips: round(dailyTrips),
      congestionPercent: round(congestionPercent),
      transitSharePercent: round(transitSharePercent),
      unemploymentPercent: round(unemploymentPercent),
      housingOccupancyPercent: round(housingOccupancyPercent),
      happiness: round(happiness),
      annualizedMigration: round(annualizedMigration),
    };
  });

  const preliminary = summarizeCitySection(state.districts, state.municipalBudget, state.taxRate, state.links, state.utilityCapacity);
  state.municipalBudget = round(state.municipalBudget + (preliminary.taxRevenueDaily - preliminary.maintenanceCostDaily) * elapsedDays);
  state.elapsedDays = round(state.elapsedDays + elapsedDays);
  const calendar = calendarFromElapsedDays(state.startYear, state.elapsedDays);
  state.year = calendar.year;
  state.month = calendar.month;
  state.metrics = summarizeCitySection(state.districts, state.municipalBudget, state.taxRate, state.links, state.utilityCapacity);
  maybeRecordTimeline(state, previousCalendar.month !== calendar.month || previousCalendar.year !== calendar.year);
  addEvents(state, previousCalendar, calendar, events);
}

function calculateUtilityDemand(district: CityDistrictState): Record<UtilityKind, number> {
  return {
    power: district.population * 0.48 + district.developedFloorArea * 0.012,
    water: district.population * 0.39 + district.developedFloorArea * 0.008,
    waste: district.population * 0.13 + district.commercialFloorArea * 0.018 + district.industrialFloorArea * 0.026,
  };
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
      utilityDemand: { ...district.utilityDemand },
      utilityCoverage: { ...district.utilityCoverage },
    })),
    links: state.links.map((link) => ({ ...link })),
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
    travelDemandScale: finiteClamp(policy.travelDemandScale, 0.25, 3, 1),
    freightDemandScale: finiteClamp(policy.freightDemandScale, 0.25, 3, 1),
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
