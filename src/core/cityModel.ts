import type {
  CityAggregateMetrics,
  CityDistrictDefinition,
  CityDistrictState,
  CitySectionDefinition,
  CitySectionState,
  CityTimelinePoint,
} from "../models/cityTypes";

export function createCitySectionState(definition: CitySectionDefinition): CitySectionState {
  validateCitySectionDefinition(definition);
  const districts = definition.districts.map(createDistrictState);
  const metrics = summarizeInitialCity(districts, definition.startingBudget);
  const timeline: CityTimelinePoint[] = [{
    day: 0,
    year: definition.startYear,
    month: 1,
    population: metrics.population,
    grossCityProductDaily: metrics.grossCityProductDaily,
    averageLandValue: metrics.averageLandValue,
    congestionPercent: metrics.congestionPercent,
    utilityCoveragePercent: metrics.utilityCoveragePercent,
    housingOccupancyPercent: metrics.housingOccupancyPercent,
    municipalBalance: metrics.municipalBalance,
    happiness: metrics.happiness,
  }];

  return {
    id: definition.id,
    name: definition.name,
    startYear: definition.startYear,
    elapsedDays: 0,
    year: definition.startYear,
    month: 1,
    taxRate: definition.taxRate,
    utilityCapacity: { ...definition.utilityCapacity },
    municipalBudget: definition.startingBudget,
    districts,
    links: definition.links.map((link) => ({ ...link })),
    metrics,
    timeline,
  };
}

export function validateCitySectionDefinition(definition: CitySectionDefinition): void {
  if (!definition.id.trim() || !definition.name.trim()) {
    throw new Error("City section id and name are required");
  }
  if (definition.districts.length === 0) {
    throw new Error("A city section requires at least one district");
  }
  const districtIds = new Set<string>();
  for (const district of definition.districts) {
    if (districtIds.has(district.id)) throw new Error(`Duplicate district id: ${district.id}`);
    districtIds.add(district.id);
    validateDistrict(district);
  }
  const linkIds = new Set<string>();
  for (const link of definition.links) {
    if (linkIds.has(link.id)) throw new Error(`Duplicate city link id: ${link.id}`);
    linkIds.add(link.id);
    if (!districtIds.has(link.fromDistrictId) || !districtIds.has(link.toDistrictId)) {
      throw new Error(`Unknown district in city link: ${link.id}`);
    }
    if (link.fromDistrictId === link.toDistrictId) {
      throw new Error(`City link cannot connect a district to itself: ${link.id}`);
    }
    for (const value of [link.distanceKm, link.roadCapacityDaily, link.transitCapacityDaily, link.freightCapacityDaily]) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid capacity or distance in city link: ${link.id}`);
    }
  }
  if (!Number.isFinite(definition.startingBudget) || definition.startingBudget < 0) {
    throw new Error("Starting budget must be non-negative");
  }
  if (!Number.isFinite(definition.taxRate) || definition.taxRate < 0 || definition.taxRate > 1) {
    throw new Error("Tax rate must be between 0 and 1");
  }
  for (const capacity of Object.values(definition.utilityCapacity)) {
    if (!Number.isFinite(capacity) || capacity < 0) throw new Error("Utility capacity must be non-negative");
  }
}

export function createDemoCitySectionDefinition(): CitySectionDefinition {
  const columns = [-72, -24, 24, 72];
  const rows = [-48, 0, 48];
  const templates: Array<Omit<CityDistrictDefinition, "x" | "z" | "width" | "depth">> = [
    district("north-homes", "North Homes", "residential", 0.05, 360_000, 2_400, 18_000, 0, 4_000, 14_500, 5_200, 52_000, 210, 500),
    district("university", "University", "civic", 0.03, 280_000, 800, 22_000, 0, 42_000, 7_800, 8_900, 61_000, 280, 300),
    district("uptown-market", "Uptown Market", "commercial", 0.04, 320_000, 1_250, 68_000, 3_000, 8_000, 6_400, 12_500, 67_000, 330, 1_200),
    district("tech-works", "Tech Works", "industrial", 0.07, 260_000, 350, 11_000, 82_000, 3_000, 2_100, 11_700, 72_000, 185, 4_800),
    district("west-gardens", "West Gardens", "park", 0.09, 120_000, 720, 4_000, 0, 7_000, 3_600, 1_100, 48_000, 295, 120),
    district("central", "Central Exchange", "commercial", 0.02, 440_000, 1_500, 112_000, 6_000, 12_000, 8_600, 20_500, 75_000, 440, 1_800),
    district("civic-center", "Civic Center", "civic", 0.03, 300_000, 650, 28_000, 0, 68_000, 4_100, 9_800, 64_000, 360, 250),
    district("east-heights", "East Heights", "residential", 0.11, 330_000, 2_050, 14_000, 0, 5_000, 12_300, 3_900, 56_000, 235, 420),
    district("river-homes", "River Homes", "residential", 0.06, 300_000, 1_850, 9_000, 0, 3_000, 10_700, 2_800, 49_000, 195, 350),
    district("south-market", "South Market", "commercial", 0.05, 320_000, 1_100, 76_000, 5_000, 5_000, 5_900, 14_600, 58_000, 270, 1_450),
    district("freight-yard", "Freight Yard", "industrial", 0.08, 300_000, 240, 5_000, 112_000, 2_000, 1_400, 13_900, 69_000, 135, 6_500),
    district("south-homes", "South Homes", "residential", 0.13, 350_000, 2_200, 12_000, 0, 3_000, 13_100, 3_200, 51_000, 175, 380),
  ];
  const districts = templates.map((template, index) => ({
    ...template,
    x: columns[index % columns.length]!,
    z: rows[Math.floor(index / columns.length)]!,
    width: 42,
    depth: 38,
  }));
  const utilityDemand = districts.reduce((total, districtDefinition) => {
    const developedFloorArea = districtDefinition.housingUnits * 88 + districtDefinition.commercialFloorArea + districtDefinition.industrialFloorArea + districtDefinition.civicFloorArea;
    return {
      power: total.power + districtDefinition.population * 0.48 + developedFloorArea * 0.012,
      water: total.water + districtDefinition.population * 0.39 + developedFloorArea * 0.008,
      waste: total.waste + districtDefinition.population * 0.13 + districtDefinition.commercialFloorArea * 0.018 + districtDefinition.industrialFloorArea * 0.026,
    };
  }, { power: 0, water: 0, waste: 0 });
  const links = [
    ...rows.flatMap((_, row) => [0, 1, 2].map((column) => link(`east-${row}-${column}`, districts[row * 4 + column]!.id, districts[row * 4 + column + 1]!.id, 1.2))),
    ...columns.flatMap((_, column) => [0, 1].map((row) => link(`south-${row}-${column}`, districts[row * 4 + column]!.id, districts[(row + 1) * 4 + column]!.id, 1.4))),
  ];

  return {
    id: "market-river-section",
    name: "Market-River City Section",
    startYear: 2026,
    startingBudget: 18_000_000,
    taxRate: 0.082,
    utilityCapacity: {
      power: Math.round(utilityDemand.power * 1.2),
      water: Math.round(utilityDemand.water * 1.2),
      waste: Math.round(utilityDemand.waste * 1.2),
    },
    districts,
    links,
  };
}

function createDistrictState(definition: CityDistrictDefinition): CityDistrictState {
  const children = definition.population * (definition.primaryZone === "residential" ? 0.2 : 0.16);
  const seniors = definition.population * (definition.primaryZone === "residential" ? 0.14 : 0.1);
  const adults = definition.population - children - seniors;
  const developedFloorArea = definition.housingUnits * 88 + definition.commercialFloorArea + definition.industrialFloorArea + definition.civicFloorArea;
  const housingCapacity = Math.max(1, definition.housingUnits * 2.45);
  return {
    ...definition,
    households: definition.population / 2.42,
    children,
    adults,
    seniors,
    laborForce: adults * 0.74,
    employedResidents: 0,
    developedFloorArea,
    rentIndex: definition.landValue / 200,
    goodsInventory: definition.goodsProductionCapacity * 2.5,
    goodsProducedDaily: 0,
    goodsConsumedDaily: 0,
    goodsImportedDaily: 0,
    goodsExportedDaily: 0,
    utilityDemand: { power: 0, water: 0, waste: 0 },
    utilityCoverage: { power: 1, water: 1, waste: 1 },
    dailyTrips: definition.population * 2.15,
    congestionPercent: 0,
    transitSharePercent: 18,
    unemploymentPercent: 0,
    housingOccupancyPercent: Math.min(100, (definition.population / housingCapacity) * 100),
    happiness: 72,
    annualizedMigration: 0,
  };
}

function summarizeInitialCity(districts: readonly CityDistrictState[], budget: number): CityAggregateMetrics {
  const population = sum(districts.map((district) => district.population));
  const jobs = sum(districts.map((district) => district.jobs));
  const labor = sum(districts.map((district) => district.laborForce));
  const employedResidents = Math.min(labor, jobs);
  return {
    population,
    households: sum(districts.map((district) => district.households)),
    jobs,
    employedResidents,
    unemploymentPercent: labor > 0 ? ((labor - employedResidents) / labor) * 100 : 0,
    housingOccupancyPercent: weightedAverage(districts, "housingOccupancyPercent"),
    grossCityProductDaily: employedResidents * 185,
    householdSpendingDaily: population * 38,
    goodsProducedDaily: 0,
    goodsConsumedDaily: 0,
    goodsImportedDaily: 0,
    goodsExportedDaily: 0,
    averageLandValue: weightedAverage(districts, "landValue"),
    averageRentIndex: weightedAverage(districts, "rentIndex"),
    utilityCoveragePercent: 100,
    wasteCollectionPercent: 100,
    dailyTrips: sum(districts.map((district) => district.dailyTrips)),
    congestionPercent: 0,
    transitSharePercent: weightedAverage(districts, "transitSharePercent"),
    taxRevenueDaily: 0,
    maintenanceCostDaily: 0,
    municipalBalance: budget,
    happiness: weightedAverage(districts, "happiness"),
  };
}

function validateDistrict(district: CityDistrictDefinition): void {
  if (!district.id.trim() || !district.name.trim()) throw new Error("District id and name are required");
  const values = [district.width, district.depth, district.maxFloorArea, district.housingUnits, district.commercialFloorArea, district.industrialFloorArea, district.civicFloorArea, district.population, district.jobs, district.averageIncome, district.landValue, district.goodsProductionCapacity];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`District contains an invalid value: ${district.id}`);
  }
  if (!Number.isFinite(district.terrainSlope) || district.terrainSlope < 0 || district.terrainSlope > 1) {
    throw new Error(`District terrain slope must be between 0 and 1: ${district.id}`);
  }
}

function district(
  id: string,
  name: string,
  primaryZone: CityDistrictDefinition["primaryZone"],
  terrainSlope: number,
  maxFloorArea: number,
  housingUnits: number,
  commercialFloorArea: number,
  industrialFloorArea: number,
  civicFloorArea: number,
  population: number,
  jobs: number,
  averageIncome: number,
  landValue: number,
  goodsProductionCapacity: number,
): Omit<CityDistrictDefinition, "x" | "z" | "width" | "depth"> {
  const baselineHousingUnits = Math.max(housingUnits, Math.ceil(population / 2.32));
  const developedFloorArea = baselineHousingUnits * 88 + commercialFloorArea + industrialFloorArea + civicFloorArea;
  return {
    id,
    name,
    primaryZone,
    terrainSlope,
    maxFloorArea: Math.max(maxFloorArea, Math.round(developedFloorArea * 1.35)),
    housingUnits: baselineHousingUnits,
    commercialFloorArea,
    industrialFloorArea,
    civicFloorArea,
    population,
    jobs,
    averageIncome,
    landValue,
    goodsProductionCapacity,
  };
}

function link(id: string, fromDistrictId: string, toDistrictId: string, distanceKm: number) {
  return { id, fromDistrictId, toDistrictId, distanceKm, roadCapacityDaily: 21_000, transitCapacityDaily: 9_000, freightCapacityDaily: 3_500 };
}

function weightedAverage<K extends keyof CityDistrictState>(districts: readonly CityDistrictState[], key: K): number {
  const population = sum(districts.map((district) => district.population));
  if (population <= 0) return 0;
  return sum(districts.map((district) => Number(district[key]) * district.population)) / population;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
