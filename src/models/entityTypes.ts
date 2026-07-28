import type { UtilityKind, ZoneType } from "./cityEconomyTypes";

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

export type BuildingConnectionKind = "commute" | "customer" | "supply";
export type PersonNeed = "goods" | "health" | "education" | "community" | "recreation";
export type PersonActivity = "home" | "work" | "school" | "shop" | "library" | "healthcare" | "leisure";
export type TravelMode = "walk" | "car" | "transit";

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
  staffingRatio: number;
  averageWage: number;
  unitPrice: number;
  dailyWages: number;
  rentIncome: number;
  municipalFunding: number;
  salesRevenue: number;
  operatingRevenue: number;
  supplyCost: number;
  transportCost: number;
  maintenanceCost: number;
  utilityCost: number;
  operatingCost: number;
  profit: number;
  customers: number;
  serviceDemand: number;
  serviceDelivered: number;
  serviceQuality: number;
  goodsReceived: number;
  localSupplies: number;
  importedSupplies: number;
  goodsSold: number;
  workforceChange: number;
  lossStreak: number;
  diagnosis: string;
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
  utilityDemand: Record<UtilityKind, number>;
  utilityService: Record<UtilityKind, number>;
  accounting: BuildingAccounting;
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
  dailyWage: number;
  dailySpending: number;
  commuteCost: number;
  money: number;
  migrationStatus: "staying" | "considering-leaving" | "moving-out";
  migrationReason: string;
  unemployedDays: number;
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
    utilities: number;
    transport: number;
    services: number;
    total: number;
  };
  rentArrears: number;
}

export interface EntityConnection {
  id: string;
  kind: BuildingConnectionKind;
  fromBuildingId: string;
  toBuildingId: string;
  volume: number;
  personIds: string[];
}

export interface EntityEvent {
  id: string;
  day: number;
  category: "business" | "labor" | "services" | "utilities" | "migration";
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
