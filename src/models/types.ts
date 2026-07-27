import type { CitySectionState, TimeHorizon } from "./cityTypes";

export type SignalPhase = "vehicles" | "pedestrians";
export type TravelDirection = "eastbound" | "westbound" | "northbound" | "southbound";
export type TravelMode = "walk" | "car" | "bus" | "freight" | "service";
export type VehicleType = "car" | "bus" | "truck" | "service";
export type ZoneType = "residential" | "commercial" | "industrial" | "civic" | "park";
export type AgeGroup = "child" | "adult" | "senior";
export type IncomeBand = "low" | "middle" | "high";
export type ActivityType = "home" | "work" | "school" | "shopping" | "leisure";
export type UtilityKind = "power" | "water" | "waste";
export type NetworkKind = "road" | "sidewalk" | "crosswalk" | "bus-stop" | "access";

export interface RoutePoint {
  nodeId: string;
  x: number;
  z: number;
}

export interface MovingAgent {
  id: string;
  progress: number;
  completed: boolean;
  elapsedSeconds: number;
  route: RoutePoint[];
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
}

export interface Person {
  id: string;
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

export interface Building {
  id: string;
  name: string;
  zone: ZoneType;
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
  goodsInventory: number;
  productionRate: number;
  customerDemand: number;
  utilityDemand: UtilityDemand;
  utilityService: UtilityService;
  efficiency: number;
  pollution: number;
  wasteStored: number;
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
  availableJobs: number;
  employedWorkers: number;
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
  capacity: number;
  demand: number;
  delivered: number;
  coveragePercent: number;
  lossPercent: number;
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
  vehicleVolume: number;
  pedestrianVolume: number;
  freightVolume: number;
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
  network: StreetNetwork;
  economy: EconomyState;
  landUse: LandUseState;
  infrastructure: InfrastructureState;
  city: CitySectionState;
  metrics: SimulationMetrics;
  events: SimulationEvent[];
}
