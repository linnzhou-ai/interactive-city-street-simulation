import type {
  HouseholdExpenseLedger,
  ZoneType,
} from "./cityEconomyTypes";

export type TimeHorizon = "day" | "week" | "month" | "year";
export type GoodType = "food" | "consumerGoods" | "industrialMaterials";
export type GoodsBasket = Record<GoodType, number>;

export interface CityDistrictDefinition {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  primaryZone: ZoneType;
  terrainSlope: number;
  maxFloorArea: number;
  housingUnits: number;
  commercialFloorArea: number;
  industrialFloorArea: number;
  civicFloorArea: number;
  population: number;
  jobs: number;
  averageIncome: number;
  landValue: number;
  goodsProductionCapacity: number;
  productionProfile?: Partial<GoodsBasket>;
}

export interface ExternalMarketDefinition {
  id: string;
  name: string;
  kind: "regional" | "outside-city";
  distanceKm: number;
  freightCapacityDaily: number;
  commuterCapacityDaily: number;
  externalJobs: number;
  goodsPrices: GoodsBasket;
  goodsSupplyDaily: GoodsBasket;
  goodsDemandDaily: GoodsBasket;
}

export interface ExternalMarketState extends ExternalMarketDefinition {
  importsDaily: GoodsBasket;
  exportsDaily: GoodsBasket;
  transportCostDaily: number;
  freightTripsDaily: number;
  inboundCommutersDaily: number;
  outboundCommutersDaily: number;
}

export interface CityGoodsMarketState {
  prices: GoodsBasket;
  demandDaily: GoodsBasket;
  localSupplyDaily: GoodsBasket;
  fulfilledDaily: GoodsBasket;
  importsDaily: GoodsBasket;
  exportsDaily: GoodsBasket;
  unmetDemandDaily: GoodsBasket;
  consumerPriceIndex: number;
  localSupplyPercent: number;
  importDependencePercent: number;
  transportCostDaily: number;
}

export interface CityLinkDefinition {
  id: string;
  fromDistrictId: string;
  toDistrictId: string;
  distanceKm: number;
  roadCapacityDaily: number;
  transitCapacityDaily: number;
  freightCapacityDaily: number;
}

export interface CitySectionDefinition {
  id: string;
  name: string;
  startYear: number;
  startingBudget: number;
  taxRate: number;
  districts: CityDistrictDefinition[];
  links: CityLinkDefinition[];
  externalMarkets?: ExternalMarketDefinition[];
}

export interface CityDistrictState extends CityDistrictDefinition {
  households: number;
  children: number;
  adults: number;
  seniors: number;
  laborForce: number;
  employedResidents: number;
  developedFloorArea: number;
  rentIndex: number;
  productionCapacity: GoodsBasket;
  goodsInventory: GoodsBasket;
  goodsDemandByType: GoodsBasket;
  goodsProducedByType: GoodsBasket;
  goodsConsumedByType: GoodsBasket;
  goodsImportedByType: GoodsBasket;
  goodsExportedByType: GoodsBasket;
  goodsProducedDaily: number;
  goodsConsumedDaily: number;
  goodsImportedDaily: number;
  goodsExportedDaily: number;
  averageWageDaily: number;
  householdWealth: number;
  householdIncomeDaily: number;
  householdSpendingDaily: number;
  householdExpensesDaily: HouseholdExpenseLedger;
  disposableIncomeDaily: number;
  businessRevenueDaily: number;
  businessCostsDaily: number;
  businessProfitDaily: number;
  propertyRentIncomeDaily: number;
  propertyOperatingCostDaily: number;
  civicServiceDemand: number;
  civicServiceDelivered: number;
  civicServiceQualityPercent: number;
  civicOperatingCostDaily: number;
  commuteTripsDaily: number;
  shoppingTripsDaily: number;
  pedestrianTripsDaily: number;
  freightTripsDaily: number;
  externalCommutersDaily: number;
  dailyTrips: number;
  congestionPercent: number;
  averageTrafficDelayMinutes: number;
  congestionCostDaily: number;
  transitSharePercent: number;
  unemploymentPercent: number;
  housingOccupancyPercent: number;
  happiness: number;
  annualizedMigration: number;
}

export interface CityAggregateMetrics {
  population: number;
  households: number;
  jobs: number;
  employedResidents: number;
  unemploymentPercent: number;
  housingOccupancyPercent: number;
  grossCityProductDaily: number;
  householdIncomeDaily: number;
  disposableIncomeDaily: number;
  householdSpendingDaily: number;
  householdExpensesDaily: HouseholdExpenseLedger;
  businessRevenueDaily: number;
  businessCostsDaily: number;
  businessProfitDaily: number;
  propertyRentIncomeDaily: number;
  propertyOperatingCostDaily: number;
  civicServiceCoveragePercent: number;
  civicOperatingCostDaily: number;
  goodsProducedDaily: number;
  goodsConsumedDaily: number;
  goodsImportedDaily: number;
  goodsExportedDaily: number;
  averageLandValue: number;
  averageRentIndex: number;
  commuteTripsDaily: number;
  shoppingTripsDaily: number;
  vehicleTripsDaily: number;
  pedestrianTripsDaily: number;
  freightTripsDaily: number;
  externalCommutersDaily: number;
  annualizedMigrationIn: number;
  annualizedMigrationOut: number;
  annualizedNetMigration: number;
  dailyTrips: number;
  congestionPercent: number;
  averageTrafficDelayMinutes: number;
  congestionCostDaily: number;
  transitSharePercent: number;
  taxRevenueDaily: number;
  maintenanceCostDaily: number;
  municipalBalance: number;
  happiness: number;
}

export interface CityTimelinePoint {
  day: number;
  year: number;
  month: number;
  population: number;
  grossCityProductDaily: number;
  averageLandValue: number;
  congestionPercent: number;
  congestionCostDaily: number;
  housingOccupancyPercent: number;
  municipalBalance: number;
  happiness: number;
}

export interface CitySectionState {
  id: string;
  name: string;
  startYear: number;
  elapsedDays: number;
  year: number;
  month: number;
  taxRate: number;
  municipalBudget: number;
  districts: CityDistrictState[];
  links: CityLinkDefinition[];
  externalMarkets: ExternalMarketState[];
  market: CityGoodsMarketState;
  metrics: CityAggregateMetrics;
  timeline: CityTimelinePoint[];
}

export interface CityPolicySettings {
  roadCapacityScale: number;
  zoningStrictness: number;
  transitServiceScale: number;
}

export interface CitySystemEvent {
  category: "population" | "economy" | "land-use" | "mobility" | "finance";
  message: string;
  severity: "info" | "warning";
}

export interface CityStepResult {
  state: CitySectionState;
  events: CitySystemEvent[];
}
