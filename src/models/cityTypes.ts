import type { UtilityKind, ZoneType } from "./types";

export type TimeHorizon = "day" | "week" | "month" | "year";

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
  utilityCapacity: Record<UtilityKind, number>;
  districts: CityDistrictDefinition[];
  links: CityLinkDefinition[];
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
  goodsInventory: number;
  goodsProducedDaily: number;
  goodsConsumedDaily: number;
  goodsImportedDaily: number;
  goodsExportedDaily: number;
  utilityDemand: Record<UtilityKind, number>;
  utilityCoverage: Record<UtilityKind, number>;
  dailyTrips: number;
  congestionPercent: number;
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
  householdSpendingDaily: number;
  goodsProducedDaily: number;
  goodsConsumedDaily: number;
  goodsImportedDaily: number;
  goodsExportedDaily: number;
  averageLandValue: number;
  averageRentIndex: number;
  utilityCoveragePercent: number;
  wasteCollectionPercent: number;
  dailyTrips: number;
  congestionPercent: number;
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
  utilityCoveragePercent: number;
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
  utilityCapacity: Record<UtilityKind, number>;
  municipalBudget: number;
  districts: CityDistrictState[];
  links: CityLinkDefinition[];
  metrics: CityAggregateMetrics;
  timeline: CityTimelinePoint[];
}

export interface CityPolicySettings {
  roadCapacityScale: number;
  utilityCapacityScale: number;
  zoningStrictness: number;
  transitServiceScale: number;
  travelDemandScale: number;
  freightDemandScale: number;
}

export interface CitySystemEvent {
  category: "population" | "economy" | "land-use" | "utilities" | "mobility" | "finance";
  message: string;
  severity: "info" | "warning";
}

export interface CityStepResult {
  state: CitySectionState;
  events: CitySystemEvent[];
}
