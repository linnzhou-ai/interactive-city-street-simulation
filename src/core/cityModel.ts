import type {
  CityAggregateMetrics,
  CityDistrictDefinition,
  CityDistrictState,
  CitySectionDefinition,
  CitySectionState,
  CityTimelinePoint,
  ExternalMarketDefinition,
  GoodsBasket,
} from "../models/cityTypes";
import {
  advanceCityEconomy,
  createExternalMarketState,
  createInitialGoodsMarket,
  emptyGoodsBasket,
  resolveProductionCapacity,
} from "./cityEconomy";

export function createCitySectionState(definition: CitySectionDefinition): CitySectionState {
  validateCitySectionDefinition(definition);
  const districts = definition.districts.map(createDistrictState);
  const market = createInitialGoodsMarket();
  const externalMarkets = (definition.externalMarkets ?? []).map(createExternalMarketState);
  const seededEconomy = advanceCityEconomy({
    districts,
    externalMarkets,
    previousMarket: market,
    transportCapacity: initialDistrictTransportCapacity(districts, definition.links),
    elapsedDays: 1,
  });
  const seededDistricts = seededEconomy.districts.map(initializeDistrictIndicators);
  const metrics = summarizeInitialCity(seededDistricts, definition.startingBudget);
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
    districts: seededDistricts,
    links: definition.links.map((link) => ({ ...link })),
    externalMarkets: seededEconomy.externalMarkets,
    market: seededEconomy.market,
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
  const externalIds = new Set<string>();
  for (const market of definition.externalMarkets ?? []) {
    validateExternalMarket(market, externalIds);
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
      waste: total.waste + districtDefinition.population * 0.13
        + districtDefinition.commercialFloorArea * 0.018
        + districtDefinition.industrialFloorArea * 0.026
        + districtDefinition.civicFloorArea * 0.012,
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
    externalMarkets: [
      {
        id: "metro-region",
        name: "Surrounding Metro",
        kind: "regional",
        distanceKm: 18,
        freightCapacityDaily: 34_000,
        commuterCapacityDaily: 18_000,
        externalJobs: 12_000,
        goodsPrices: { food: 8.4, consumerGoods: 22.5, industrialMaterials: 14.2 },
        goodsSupplyDaily: { food: 24_000, consumerGoods: 11_000, industrialMaterials: 9_000 },
        goodsDemandDaily: { food: 3_500, consumerGoods: 5_500, industrialMaterials: 11_000 },
      },
      {
        id: "national-network",
        name: "Wider Economy",
        kind: "outside-city",
        distanceKm: 145,
        freightCapacityDaily: 24_000,
        commuterCapacityDaily: 1_200,
        externalJobs: 800,
        goodsPrices: { food: 7.6, consumerGoods: 20.5, industrialMaterials: 12.8 },
        goodsSupplyDaily: { food: 28_000, consumerGoods: 20_000, industrialMaterials: 22_000 },
        goodsDemandDaily: { food: 9_000, consumerGoods: 14_000, industrialMaterials: 18_000 },
      },
    ],
  };
}

function createDistrictState(definition: CityDistrictDefinition): CityDistrictState {
  const children = definition.population * (definition.primaryZone === "residential" ? 0.2 : 0.16);
  const seniors = definition.population * (definition.primaryZone === "residential" ? 0.14 : 0.1);
  const adults = definition.population - children - seniors;
  const developedFloorArea = definition.housingUnits * 88 + definition.commercialFloorArea + definition.industrialFloorArea + definition.civicFloorArea;
  const housingCapacity = Math.max(1, definition.housingUnits * 2.45);
  const productionCapacity = resolveProductionCapacity(definition);
  const households = definition.population / 2.42;
  return {
    ...definition,
    households,
    children,
    adults,
    seniors,
    laborForce: adults * 0.74,
    employedResidents: 0,
    developedFloorArea,
    rentIndex: definition.landValue / 200,
    productionCapacity,
    goodsInventory: mapBasket(productionCapacity, (value) => value * 1.5),
    goodsDemandByType: emptyGoodsBasket(),
    goodsProducedByType: emptyGoodsBasket(),
    goodsConsumedByType: emptyGoodsBasket(),
    goodsImportedByType: emptyGoodsBasket(),
    goodsExportedByType: emptyGoodsBasket(),
    goodsProducedDaily: 0,
    goodsConsumedDaily: 0,
    goodsImportedDaily: 0,
    goodsExportedDaily: 0,
    averageWageDaily: definition.averageIncome / 260,
    householdWealth: households * 420,
    householdIncomeDaily: 0,
    householdSpendingDaily: 0,
    disposableIncomeDaily: 0,
    businessRevenueDaily: 0,
    businessCostsDaily: 0,
    businessProfitDaily: 0,
    propertyRentIncomeDaily: 0,
    propertyOperatingCostDaily: 0,
    utilityCostDaily: 0,
    civicServiceDemand: 0,
    civicServiceDelivered: 0,
    civicServiceQualityPercent: 100,
    civicOperatingCostDaily: 0,
    utilityDemand: {
      power: definition.population * 0.48 + developedFloorArea * 0.012,
      water: definition.population * 0.39 + developedFloorArea * 0.008,
      waste: definition.population * 0.13 + definition.commercialFloorArea * 0.018
        + definition.industrialFloorArea * 0.026 + definition.civicFloorArea * 0.012,
    },
    utilityCoverage: { power: 1, water: 1, waste: 1 },
    dailyTrips: definition.population * 2.15,
    congestionPercent: 0,
    transitSharePercent: 18,
    commuteTripsDaily: definition.population * 0.9,
    shoppingTripsDaily: households * 0.35,
    pedestrianTripsDaily: definition.population * 0.18,
    freightTripsDaily: definition.goodsProductionCapacity / 28,
    externalCommutersDaily: 0,
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
  const employedResidents = sum(districts.map((district) => district.employedResidents));
  const businessRevenueDaily = sum(districts.map((district) => district.businessRevenueDaily));
  const businessCostsDaily = sum(districts.map((district) => district.businessCostsDaily));
  const businessProfitDaily = sum(districts.map((district) => district.businessProfitDaily));
  return {
    population,
    households: sum(districts.map((district) => district.households)),
    jobs,
    employedResidents,
    unemploymentPercent: labor > 0 ? ((labor - employedResidents) / labor) * 100 : 0,
    housingOccupancyPercent: weightedAverage(districts, "housingOccupancyPercent"),
    grossCityProductDaily: businessRevenueDaily,
    householdIncomeDaily: sum(districts.map((district) => district.householdIncomeDaily)),
    disposableIncomeDaily: sum(districts.map((district) => district.disposableIncomeDaily)),
    householdSpendingDaily: sum(districts.map((district) => district.householdSpendingDaily)),
    businessRevenueDaily,
    businessCostsDaily,
    businessProfitDaily,
    propertyRentIncomeDaily: sum(districts.map((district) => district.propertyRentIncomeDaily)),
    propertyOperatingCostDaily: sum(districts.map((district) => district.propertyOperatingCostDaily)),
    utilityCostDaily: sum(districts.map((district) => district.utilityCostDaily)),
    civicServiceCoveragePercent: weightedAverage(districts, "civicServiceQualityPercent"),
    civicOperatingCostDaily: sum(districts.map((district) => district.civicOperatingCostDaily)),
    goodsProducedDaily: sum(districts.map((district) => district.goodsProducedDaily)),
    goodsConsumedDaily: sum(districts.map((district) => district.goodsConsumedDaily)),
    goodsImportedDaily: sum(districts.map((district) => district.goodsImportedDaily)),
    goodsExportedDaily: sum(districts.map((district) => district.goodsExportedDaily)),
    averageLandValue: weightedAverage(districts, "landValue"),
    averageRentIndex: weightedAverage(districts, "rentIndex"),
    utilityCoveragePercent: 100,
    wasteCollectionPercent: 100,
    commuteTripsDaily: sum(districts.map((district) => district.commuteTripsDaily)),
    shoppingTripsDaily: sum(districts.map((district) => district.shoppingTripsDaily)),
    vehicleTripsDaily: sum(districts.map((district) => district.commuteTripsDaily * 0.55 + district.freightTripsDaily)),
    pedestrianTripsDaily: sum(districts.map((district) => district.pedestrianTripsDaily)),
    freightTripsDaily: sum(districts.map((district) => district.freightTripsDaily)),
    externalCommutersDaily: sum(districts.map((district) => district.externalCommutersDaily)),
    annualizedMigrationIn: 0,
    annualizedMigrationOut: 0,
    annualizedNetMigration: 0,
    dailyTrips: sum(districts.map((district) => district.dailyTrips)),
    congestionPercent: 0,
    transitSharePercent: weightedAverage(districts, "transitSharePercent"),
    taxRevenueDaily: 0,
    maintenanceCostDaily: 0,
    municipalBalance: budget,
    happiness: weightedAverage(districts, "happiness"),
  };
}

function initializeDistrictIndicators(district: CityDistrictState): CityDistrictState {
  const utilityReliability = sum(Object.values(district.utilityCoverage)) / 3;
  const unemploymentPercent = district.laborForce > 0
    ? Math.max(0, (district.laborForce - district.employedResidents) / district.laborForce * 100)
    : 0;
  const goodsCoverage = district.goodsConsumedDaily
    / Math.max(1, sum(Object.values(district.goodsDemandByType)));
  const housingOccupancyPercent = clamp(
    district.population / Math.max(1, district.housingUnits * 2.45) * 100,
    0,
    140,
  );
  const rentBurden = clamp(
    district.households * district.rentIndex * 52 / Math.max(1, district.householdIncomeDaily),
    0,
    1,
  );
  const spendingRoom = clamp(
    district.disposableIncomeDaily / Math.max(1, district.householdIncomeDaily),
    0,
    1,
  );
  const happiness = clamp(
    29 + utilityReliability * 22 + (1 - unemploymentPercent / 100) * 18
      + goodsCoverage * 12 + (1 - district.congestionPercent / 100) * 7
      + (1 - rentBurden) * 5 + spendingRoom * 6
      + district.civicServiceQualityPercent / 100 * 5,
    0,
    100,
  );
  return {
    ...district,
    dailyTrips: district.commuteTripsDaily + district.shoppingTripsDaily + district.freightTripsDaily,
    unemploymentPercent,
    housingOccupancyPercent,
    happiness,
  };
}

function initialDistrictTransportCapacity(
  districts: readonly CityDistrictState[],
  links: Readonly<CitySectionDefinition["links"]>,
): Map<string, { road: number; transit: number; freight: number }> {
  const capacity = new Map(districts.map((district) => [
    district.id,
    { road: 0, transit: 0, freight: 0 },
  ]));
  for (const linkDefinition of links) {
    for (const districtId of [linkDefinition.fromDistrictId, linkDefinition.toDistrictId]) {
      const district = capacity.get(districtId);
      if (district === undefined) continue;
      district.road += linkDefinition.roadCapacityDaily / 2;
      district.transit += linkDefinition.transitCapacityDaily / 2;
      district.freight += linkDefinition.freightCapacityDaily / 2;
    }
  }
  return capacity;
}

function validateExternalMarket(market: ExternalMarketDefinition, ids: Set<string>): void {
  if (!market.id.trim() || !market.name.trim()) throw new Error("External market id and name are required");
  if (ids.has(market.id)) throw new Error(`Duplicate external market id: ${market.id}`);
  ids.add(market.id);
  const values = [
    market.distanceKm,
    market.freightCapacityDaily,
    market.commuterCapacityDaily,
    market.externalJobs,
    ...Object.values(market.goodsPrices),
    ...Object.values(market.goodsSupplyDaily),
    ...Object.values(market.goodsDemandDaily),
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`External market contains an invalid value: ${market.id}`);
  }
}

function mapBasket(basket: GoodsBasket, transform: (value: number) => number): GoodsBasket {
  return {
    food: transform(basket.food),
    consumerGoods: transform(basket.consumerGoods),
    industrialMaterials: transform(basket.industrialMaterials),
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
  if (district.productionProfile && Object.values(district.productionProfile).some(
    (value) => value === undefined || !Number.isFinite(value) || value < 0,
  )) {
    throw new Error(`District production profile contains an invalid value: ${district.id}`);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
