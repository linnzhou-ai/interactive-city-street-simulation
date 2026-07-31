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
export type TripTravelerCategory =
  | "resident"
  | "commuter"
  | "visitor"
  | "freight"
  | "through-traffic";
export type TripPurpose =
  | "work"
  | "shopping"
  | "service"
  | "recreation"
  | "delivery"
  | "through";
export type TripStatus = "active" | "completed" | "cancelled" | "rerouting";
export type HouseholdFinancialStatus = "stable" | "strained" | "distressed" | "crisis";
export type PersonMobilityPhase =
  | "inside"
  | "walking"
  | "driving"
  | "transit"
  | "outside";

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
  source: "block" | "landmark" | "expansion";
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
  status: "operating" | "understaffed" | "closed" | "occupied" | "funded" | "construction";
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
  goodsProduced: number;
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
  goodsProduced: number;
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
  developmentStage: "established" | "construction" | "open";
  constructionDaysRemaining: number;
  constructionDaysTotal: number;
  constructionCost: number;
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

export interface PersonMobilityState {
  phase: PersonMobilityPhase;
  mode: TravelMode;
  activity: PersonActivity;
  fromBuildingId: string;
  destinationBuildingId: string;
  routeProgress: number;
  departureMinute: number;
  scheduledArrivalMinute: number;
  expectedArrivalMinute: number;
  delayMinutes: number;
  segmentId?: string;
  vehicleId?: number;
  violationEventId?: string;
  tripId?: string;
  plannedRouteSegmentIds?: readonly string[];
  x: number;
  z: number;
  heading: number;
}

export interface TripEndpoint {
  kind: "building" | "boundary";
  id: string;
  name: string;
}

export interface TripEconomicEffect {
  buildingId?: string;
  workerArrival: number;
  customerVisit: number;
  deliveryUnits: number;
  localSpending: number;
  congestionOnly: boolean;
}

export interface TripRecord {
  id: string;
  travelerId: string;
  travelerName: string;
  travelerCategory: TripTravelerCategory;
  purpose: TripPurpose;
  mode: TravelMode;
  origin: TripEndpoint;
  destination: TripEndpoint;
  plannedRouteSegmentIds: readonly string[];
  actualRouteSegmentIds: readonly string[];
  scheduledDepartureMinute: number | null;
  actualDepartureMinute: number;
  arrivalMinute: number | null;
  travelMinutes: number;
  delayMinutes: number;
  status: TripStatus;
  vehicleId?: number;
  occupancy: number;
  cost: number;
  source: "scheduled-resident" | "recorded-external";
  economicEffect: TripEconomicEffect;
}

export interface BuildingTripSummary {
  buildingId: string;
  workerArrivals: number;
  customerVisits: number;
  deliveries: number;
  missedTrips: number;
  activeTrips: number;
  attributedRevenue: number;
}

export type IntegrityStatus = "verified" | "warning" | "mismatch";

export interface SimulationIntegrityCheck {
  id: string;
  label: string;
  subsystem: "traffic" | "buildings" | "finance" | "government";
  expected: number;
  observed: number;
  difference: number;
  tolerance: number;
  status: IntegrityStatus;
  detail: string;
}

export interface TripLedgerSummary {
  activeTrips: number;
  completedTrips: number;
  localTrips: number;
  externalTrips: number;
  byMode: Record<TravelMode, number>;
  byPurpose: Record<TripPurpose, number>;
}

export interface TripLedgerDailyAggregate {
  day: number;
  completedTrips: number;
  cancelledTrips: number;
  localTrips: number;
  externalTrips: number;
  byMode: Record<TravelMode, number>;
  byPurpose: Record<TripPurpose, number>;
}

export interface TripLedgerSnapshot {
  records: readonly TripRecord[];
  dailyAggregates: readonly TripLedgerDailyAggregate[];
  buildingSummaries: readonly BuildingTripSummary[];
  summary: TripLedgerSummary;
  integrity: {
    status: IntegrityStatus;
    checks: readonly SimulationIntegrityCheck[];
  };
}

export interface PersonMobilityOutcome {
  attendanceRatio: number;
  visitCompletionRatio: number;
  delayMinutes: number;
  extraTransportCost: number;
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
  dailyTravelDelayMinutes: number;
  money: number;
  mobility: PersonMobilityState;
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
