import type { CitySectionState, TimeHorizon } from "./cityTypes";

export type SignalPhase = "vehicles" | "pedestrians";
export type TravelDirection = "eastbound" | "westbound" | "northbound" | "southbound";
export type TravelMode = "walk" | "car" | "bus" | "freight" | "service";
export type VehicleType = "car" | "bus" | "truck" | "service";
export type ZoneType = "residential" | "commercial" | "industrial" | "civic" | "park";
export type AgeGroup = "child" | "adult" | "senior";
export type IncomeBand = "low" | "middle" | "high";
export type EmploymentStatus = "local" | "external" | "unemployed" | "not-in-labor-force";
export type ActivityType = "home" | "work" | "school" | "shopping" | "library" | "healthcare" | "leisure";
export type ResidentNeed = "education" | "goods" | "health" | "community" | "recreation";
export type ResidentNeeds = Record<ResidentNeed, number>;
export type UtilityKind = "power" | "water" | "waste";
export type NetworkKind = "road" | "sidewalk" | "crosswalk" | "bus-stop" | "access";
export type BuildingConnectionKind = "commute" | "customer" | "supply";

export interface RoutePoint {
  nodeId: string;
  x: number;
  z: number;
}

export interface AgentPosition {
  x: number;
  z: number;
  headingRadians: number;
  segmentId: string;
}

export interface MovingAgent {
  id: string;
  progress: number;
  completed: boolean;
  elapsedSeconds: number;
  route: RoutePoint[];
  position: AgentPosition;
}

export interface Vehicle extends MovingAgent {
  kind: "vehicle";
  vehicleType: VehicleType;
  direction: TravelDirection;
  waitingSeconds: number;
  currentSpeedMph: number;
  occupancy: number;
  capacity: number;
  tripPurpose: ActivityType | "delivery" | "service";
  ownerPersonId?: string;
  destinationBuildingId?: string;
  cargoUnits: number;
}

export interface Pedestrian extends MovingAgent {
  kind: "pedestrian";
  waitSeconds: number;
  ageGroup: AgeGroup;
  activity: ActivityType;
  personId?: string;
  destinationBuildingId?: string;
}

export interface ScheduledActivity {
  activity: ActivityType;
  startMinute: number;
  endMinute: number;
  buildingId: string;
  need?: ResidentNeed;
}

export interface Person {
  id: string;
  name: string;
  householdId: string;
  age: number;
  ageGroup: AgeGroup;
  incomeBand: IncomeBand;
  homeBuildingId: string;
  workBuildingId?: string;
  schoolBuildingId?: string;
  currentActivity: ActivityType;
  currentBuildingId: string;
  destinationBuildingId?: string;
  preferredMode: TravelMode;
  schedule: ScheduledActivity[];
  scheduleDay: number;
  needs: ResidentNeeds;
  employmentStatus: EmploymentStatus;
  dailyWage: number;
  commuteCostDaily: number;
  unemployedDays: number;
  externalWorkplaceName?: string;
  happiness: number;
  money: number;
  tripsCompleted: number;
}

export interface Household {
  id: string;
  memberIds: string[];
  homeBuildingId: string;
  incomeBand: IncomeBand;
  familySize: number;
  money: number;
  goods: number;
  consumptionNeed: number;
  rentPerDay: number;
  rentArrears: number;
  unaffordableDays: number;
  happiness: number;
}

export interface UtilityDemand {
  power: number;
  water: number;
  waste: number;
}

export interface UtilityService {
  power: number;
  water: number;
  waste: number;
}

export type BuildingOperatingModel = "business" | "housing" | "civic" | "amenity";
export type BuildingOperatingStatus = "operating" | "understaffed" | "closed" | "occupied" | "funded";
export type CivicServiceKind = "education" | "health" | "library" | "recreation" | "none";
export type BuildingUse = "housing" | "retail" | "industrial" | "school" | "library" | "clinic" | "park";

export interface BuildingAccounting {
  operatingModel: BuildingOperatingModel;
  operatingStatus: BuildingOperatingStatus;
  serviceKind: CivicServiceKind;
  requiredWorkers: number;
  staffingRatio: number;
  averageWage: number;
  unitPrice: number;
  cashReserve: number;
  workforceChange: number;
  lossStreak: number;
  dailyWages: number;
  rentIncome: number;
  occupancyCost: number;
  maintenanceCost: number;
  utilityCost: number;
  goodsReceived: number;
  localSupplies: number;
  importedSupplies: number;
  supplyCost: number;
  transportCost: number;
  goodsSold: number;
  revenue: number;
  operatingCost: number;
  profit: number;
  customers: number;
  municipalFunding: number;
  serviceDemand: number;
  serviceDelivered: number;
  serviceQuality: number;
}

export interface Building {
  id: string;
  name: string;
  zone: ZoneType;
  buildingUse: BuildingUse;
  x: number;
  z: number;
  floors: number;
  maxFloors: number;
  terrainSlope: number;
  landValue: number;
  rent: number;
  residentCapacity: number;
  residentIds: string[];
  jobCapacity: number;
  employeeIds: string[];
  maximumJobCapacity?: number;
  wageOffer?: number;
  retailPrice?: number;
  cashReserve?: number;
  unprofitableDays?: number;
  closedDaysRemaining?: number;
  goodsInventory: number;
  productionRate: number;
  customerDemand: number;
  utilityDemand: UtilityDemand;
  utilityService: UtilityService;
  efficiency: number;
  pollution: number;
  wasteStored: number;
  accounting?: BuildingAccounting;
}

export interface BuildingConnection {
  id: string;
  kind: BuildingConnectionKind;
  fromBuildingId: string;
  toBuildingId: string;
  volume: number;
  personIds: string[];
}

export interface ZoneParcel {
  id: string;
  zone: ZoneType;
  x: number;
  z: number;
  width: number;
  depth: number;
  terrainSlope: number;
  maxFloors: number;
  buildingId?: string;
  suitability: number;
}

export interface NetworkNode {
  id: string;
  kind: NetworkKind;
  x: number;
  z: number;
  buildingId?: string;
}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  modes: TravelMode[];
  length: number;
  capacity: number;
  freeFlowSpeed: number;
  occupancy: number;
  congestion: number;
}

export interface StreetNetwork {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface TransitStop {
  id: string;
  name: string;
  nodeId: string;
  waitingPassengerIds: string[];
}

export interface TransitLine {
  id: string;
  name: string;
  stopIds: string[];
  headwayMinutes: number;
  fare: number;
  vehicleIds: string[];
  passengersTransported: number;
  averageWaitMinutes: number;
  active: boolean;
}

export interface EconomyState {
  goodsProduced: number;
  goodsConsumed: number;
  goodsImported: number;
  goodsExported: number;
  deliveriesCompleted: number;
  retailSales: number;
  householdSpending: number;
  businessRevenue: number;
  propertyRentIncome: number;
  utilityPayments: number;
  civicServiceCost: number;
  civicServiceCoveragePercent: number;
  availableJobs: number;
  employedWorkers: number;
  externalWorkers: number;
  averageWage: number;
  averageRetailPrice: number;
  hires: number;
  layoffs: number;
  businessClosures: number;
  residentsMovedOut: number;
  householdsMovedOut: number;
  rentArrears: number;
  unemploymentPercent: number;
  averageRent: number;
  zoneDemand: Record<"residential" | "commercial" | "industrial", number>;
}

export interface LandUseState {
  parcels: ZoneParcel[];
  averageLandValue: number;
  growthEvents: number;
  developedFloorArea: number;
  permittedFloorArea: number;
}

export interface UtilityNetworkState {
  kind: UtilityKind;
  sourceName: string;
  capacity: number;
  demand: number;
  delivered: number;
  coveragePercent: number;
  lossPercent: number;
  unitPrice: number;
  revenueDaily: number;
  operatingCostDaily: number;
  netRevenueDaily: number;
}

export interface InfrastructureState {
  utilities: Record<UtilityKind, UtilityNetworkState>;
  transitStops: TransitStop[];
  transitLines: TransitLine[];
  roadCapacity: number;
  roadVolume: number;
  roadCondition: number;
  parkingCapacity: number;
  parkingUsed: number;
  wasteCollected: number;
}

export interface SimulationEvent {
  id: string;
  minute: number;
  category: "mobility" | "economy" | "land-use" | "utilities" | "population";
  message: string;
  severity: "info" | "warning";
}

export interface TripRequest {
  id: string;
  personId?: string;
  travelerAgeGroup?: AgeGroup;
  originBuildingId: string;
  destinationBuildingId: string;
  mode: TravelMode;
  purpose: ActivityType | "delivery" | "service";
  createdMinute: number;
  vehicleType?: VehicleType;
  cargoUnits: number;
}

export interface ScenarioSettings {
  simulationSpeed: number;
  timeHorizon: TimeHorizon;
  speedLimitMph: number;
  signalCycleSeconds: number;
  transitHeadwayMinutes: number;
  roadCapacity: number;
  utilityCapacityScale: number;
  zoningStrictness: number;
}

export interface SimulationMetrics {
  averageVehicleTravelSeconds: number;
  congestionPercent: number;
  pedestrianWaitSeconds: number;
  potentialConflicts: number;
  completedVehicles: number;
  trafficFlowPerMinute: number;
  population: number;
  activeTrips: number;
  transitRidership: number;
  averageTransitWaitMinutes: number;
  goodsAvailabilityPercent: number;
  jobFillPercent: number;
  averageLandValue: number;
  utilityCoveragePercent: number;
  wasteCollectionPercent: number;
  householdHappiness: number;
  cityPopulation: number;
  districtCount: number;
  grossCityProductDaily: number;
  municipalBalance: number;
  cityUnemploymentPercent: number;
  cityHousingOccupancyPercent: number;
  cityTransitSharePercent: number;
  simulatedDays: number;
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  day: number;
  calendarYear: number;
  calendarMonth: number;
  calendarDay: number;
  timeOfDayMinutes: number;
  timeHorizon: TimeHorizon;
  signalPhase: SignalPhase;
  signalPhaseRemainingSeconds: number;
  vehicles: Vehicle[];
  pedestrians: Pedestrian[];
  people: Person[];
  households: Household[];
  buildings: Building[];
  buildingConnections: BuildingConnection[];
  network: StreetNetwork;
  economy: EconomyState;
  landUse: LandUseState;
  infrastructure: InfrastructureState;
  city: CitySectionState;
  metrics: SimulationMetrics;
  events: SimulationEvent[];
}
