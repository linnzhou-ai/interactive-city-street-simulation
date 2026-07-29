import type { ZoneType } from "./cityEconomyTypes";

export type BuildingFunction =
  | "housing"
  | "retail"
  | "office"
  | "university"
  | "library"
  | "school"
  | "clinic"
  | "culture"
  | "recreation"
  | "parking"
  | "industrial";

export type BuildingConnectionKind = "work" | "visit" | "delivery";
export type PersonNeed = "goods" | "health" | "education" | "community" | "recreation";
export type PersonActivity = "home" | "work" | "school" | "shop" | "library" | "healthcare" | "leisure";
export type TravelMode = "walk" | "car" | "transit";
export type HouseholdFinancialStatus = "stable" | "strained" | "distressed" | "crisis";

export interface HappinessComponents {
  needs: number;
  financialSecurity: number;
  employment: number;
  housing: number;
  travel: number;
}

export interface BuildingAccessibility {
  overall: number;
  workers: number;
  customers: number;
  freight: number;
  services: number;
  averageTravelMinutes: number;
  congestionPenalty: number;
  transitBonus: number;
}

export interface EntityBuildingDefinition {
  id: string;
  name: string;
  address: string;
  source: "block" | "landmark";
  landmarkKind?: string;
  function: BuildingFunction;
  zone: ZoneType;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  floors: number;
  archetype: number;
  rotation: number;
  visualSeed: number;
}

export interface BuildingAccounting {
  status: "operating" | "understaffed" | "closed" | "occupied" | "funded";
  requiredWorkers: number;
  activeWorkers: number;
  staffingRatio: number;
  operatingScale: number;
  buildingCondition: number;
  maintenanceDeferred: number;
  targetMargin: number;
  averageWage: number;
  unitPrice: number;
  dailyWages: number;
  rentIncome: number;
  municipalFunding: number;
  salesRevenue: number;
  localSalesRevenue: number;
  externalSalesRevenue: number;
  operatingRevenue: number;
  supplyCost: number;
  localSupplyCost: number;
  importedSupplyCost: number;
  transportCost: number;
  maintenanceCost: number;
  operatingCost: number;
  profit: number;
  customers: number;
  externalCustomers: number;
  serviceDemand: number;
  serviceDelivered: number;
  serviceQuality: number;
  goodsReceived: number;
  localSupplies: number;
  importedSupplies: number;
  goodsDemanded: number;
  goodsSold: number;
  workforceChange: number;
  lossStreak: number;
  diagnosis: string;
}

export interface BuildingHistoryPoint {
  day: number;
  employees: number;
  requiredWorkers: number;
  activeWorkers: number;
  operatingScale: number;
  buildingCondition: number;
  maintenanceDeferred: number;
  targetMargin: number;
  averageWage: number;
  unitPrice: number;
  operatingRevenue: number;
  operatingCost: number;
  profit: number;
  dailyWages: number;
  municipalFunding: number;
  salesRevenue: number;
  localSalesRevenue: number;
  externalSalesRevenue: number;
  supplyCost: number;
  localSupplyCost: number;
  importedSupplyCost: number;
  transportCost: number;
  maintenanceCost: number;
  customers: number;
  externalCustomers: number;
  goodsDemanded: number;
  goodsSold: number;
  serviceDemand: number;
  serviceDelivered: number;
  serviceQuality: number;
  goodsReceived: number;
  localSupplies: number;
  importedSupplies: number;
  landValue: number;
  rentDaily: number;
  goodsInventory: number;
  cashReserve: number;
  workLegs: number;
  visitLegs: number;
  deliveryUnits: number;
}

export interface DetailedBuilding extends EntityBuildingDefinition {
  residentCapacity: number;
  residentIds: string[];
  jobCapacity: number;
  employeeIds: string[];
  landValue: number;
  rentDaily: number;
  goodsInventory: number;
  cashReserve: number;
  closedDaysRemaining: number;
  accessibility: BuildingAccessibility;
  accounting: BuildingAccounting;
  history: BuildingHistoryPoint[];
}

export interface PersonScheduleItem {
  activity: PersonActivity;
  startMinute: number;
  endMinute: number;
  buildingId: string;
  mode: TravelMode;
  travelMinutes: number;
}

export interface DetailedPerson {
  id: string;
  name: string;
  householdId: string;
  age: number;
  homeBuildingId: string;
  workBuildingId?: string;
  schoolBuildingId?: string;
  employment: "local" | "external" | "unemployed" | "student" | "retired";
  currentActivity: PersonActivity;
  currentBuildingId: string;
  schedule: PersonScheduleItem[];
  needs: Record<PersonNeed, number>;
  happiness: number;
  happinessComponents: HappinessComponents;
  dailyWage: number;
  dailySpending: number;
  commuteCost: number;
  money: number;
  migrationStatus: "staying" | "considering-leaving" | "moving-out";
  migrationReason: string;
  unemployedDays: number;
  history: PersonHistoryPoint[];
}

export interface PersonHistoryPoint {
  day: number;
  dailyWage: number;
  dailySpending: number;
  commuteCost: number;
  money: number;
  happiness: number;
  goodsNeed: number;
  healthNeed: number;
  educationNeed: number;
  communityNeed: number;
  recreationNeed: number;
  travelMinutes: number;
  needsScore: number;
  financialSecurityScore: number;
  employmentScore: number;
  housingScore: number;
  travelScore: number;
}

export interface DetailedHousehold {
  id: string;
  homeBuildingId: string;
  memberIds: string[];
  money: number;
  dailyIncome: number;
  dailyExpenses: {
    housing: number;
    goods: number;
    transport: number;
    services: number;
    total: number;
  };
  rentArrears: number;
  debt: number;
  financialStatus: HouseholdFinancialStatus;
  assistanceReceived: number;
  unmetEssentials: number;
  lastMovedDay: number;
  moveReason: string;
  history: HouseholdHistoryPoint[];
}

export interface HouseholdHistoryPoint {
  day: number;
  dailyIncome: number;
  housing: number;
  goods: number;
  transport: number;
  services: number;
  totalExpenses: number;
  money: number;
  rentArrears: number;
  debt: number;
  assistanceReceived: number;
  unmetEssentials: number;
}

export interface EntityConnection {
  id: string;
  kind: BuildingConnectionKind;
  fromBuildingId: string;
  toBuildingId: string;
  volume: number;
  personIds: string[];
}

export interface BuildingRoadTrafficImpact {
  segmentId: string;
  roadName: string;
  description: string;
  kinds: BuildingConnectionKind[];
  roadTripsDaily: number;
  congestionPercent: number;
  averageDelaySeconds: number;
  averageSpeedMph: number;
  queuedVehicles: number;
  attributedCongestionCost: number;
}

export interface BuildingTrafficAttribution {
  buildingId: string;
  workVehicleTripsDaily: number;
  visitVehicleTripsDaily: number;
  deliveryVehicleTripsDaily: number;
  roadTripsDaily: number;
  deliveryTransportCost: number;
  residentCommuteCost: number;
  totalTransportCost: number;
  baseTransportCost: number;
  congestionSurcharge: number;
  averageRouteDelayMinutes: number;
  roads: BuildingRoadTrafficImpact[];
}

export interface EntityEvent {
  id: string;
  day: number;
  category: "business" | "labor" | "services" | "migration";
  severity: "info" | "warning";
  message: string;
  buildingId?: string;
  personId?: string;
}

export interface DetailedEntityState {
  buildings: DetailedBuilding[];
  people: DetailedPerson[];
  households: DetailedHousehold[];
  connections: EntityConnection[];
  events: EntityEvent[];
  lastUpdatedDay: number;
}

export interface EntitySelection {
  kind: "building" | "person";
  id: string;
}
