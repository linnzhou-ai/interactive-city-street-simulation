import type {
  CitySectionState,
  CitySystemEvent,
  TimeHorizon,
} from "./cityTypes";
import type {
  BuildingFunction,
  DetailedEntityState,
  EntitySelection,
} from "./entityTypes";

export type AppMode = "build" | "simulate";
export type BuildWorkspace = "city-edit" | "expansion";
export type CameraMode = "orbit" | "fly" | "walk";
export type EnvironmentMode = "loading" | "rendered";
export type WeatherMode = "clear" | "rain" | "fog";
export type MobilityDetailMode = "continuous" | "interpolated" | "outcome";
export type MapOverlayMode =
  | "none"
  | "congestion"
  | "profitability"
  | "affordability"
  | "employment"
  | "wellbeing"
  | "goods";
export type SignalPhase =
  | "ns-green"
  | "ns-yellow"
  | "all-red"
  | "ew-green"
  | "ew-yellow"
  | "pedestrian-walk";
export type SignalControlMode = "automatic" | "manual";
export type ManualSignalTarget = "ns-green" | "ew-green" | "all-red";
export type FeatureKind = "street" | "intersection";
export type FeatureAxis = "x" | "z";
export type LaneDirection = "two-way" | "forward" | "reverse";
export type VehicleKind =
  | "sedan"
  | "compact"
  | "suv"
  | "van"
  | "bus"
  | "truck";
export type BuildingKind =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic";
export type SceneHoverSelection = EntitySelection | { kind: "road"; id: string };

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  function?: BuildingFunction;
  x: number;
  z: number;
  rotation: number;
  floors: number;
  color: string;
}

export interface ExpansionRoad {
  id: string;
  name?: string;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  width: number;
  laneDelta?: -1 | 0 | 1;
  bikeLane?: boolean;
  widenedSidewalk?: boolean;
  laneDirection?: LaneDirection;
}

export type ExpansionStreetObjectKind = "crosswalk" | "traffic-signal";

export interface ExpansionStreetObject {
  id: string;
  kind: ExpansionStreetObjectKind;
  x: number;
  z: number;
  rotation: number;
}

export type BuildTool =
  | "add-lane"
  | "remove-lane"
  | "bike-lane"
  | "sidewalk"
  | "crosswalk"
  | "island"
  | "direction";

export interface GeoPoint {
  longitude: number;
  latitude: number;
  altitude?: number;
}

export interface DistrictFeature {
  id: string;
  kind: FeatureKind;
  name: string;
  description: string;
  axis: FeatureAxis;
  path: readonly GeoPoint[];
}

export interface FeatureDesign {
  laneDelta: -1 | 0 | 1;
  bikeLane: boolean;
  widenedSidewalk: boolean;
  crosswalk: boolean;
  pedestrianIsland: boolean;
  laneDirection: LaneDirection;
  signalCycleSeconds: number;
}

export interface DesignImpact {
  laneCapacityDelta: number;
  bikeLanes: number;
  sidewalkUpgrades: number;
  crosswalks: number;
  pedestrianIslands: number;
}

export interface ScenarioSettings {
  simulationSpeed: number;
  timeHorizon: TimeHorizon;
  speedLimitMph: number;
  signalCycleSeconds: number;
  vehicleVolume: number;
  pedestrianVolume: number;
  simulationSeed: number;
  transitHeadwayMinutes: number;
  roadCapacity: number;
  zoningStrictness: number;
}

export interface CityActivitySnapshot {
  dateLabel: string;
  clockLabel: string;
  vehicleDemandLevel: number;
  pedestrianDemandLevel: number;
  commuteSharePercent: number;
  shoppingSharePercent: number;
  freightSharePercent: number;
}

export interface SignalTiming {
  northSouthGreenSeconds: number;
  eastWestGreenSeconds: number;
  yellowSeconds: number;
  allRedSeconds: number;
  pedestrianSeconds: number;
}

export interface SignalSnapshot {
  intersectionId: string;
  mode: SignalControlMode;
  phase: SignalPhase;
  nextPhase: SignalPhase;
  timeRemainingSeconds: number | null;
  timing: SignalTiming;
}

export interface VehicleSnapshot {
  id: number;
  segmentId: string;
  laneId: string;
  x: number;
  z: number;
  heading: number;
  speedMetersPerSecond: number;
  queued: boolean;
  kind: VehicleKind;
  color: string;
  complianceProbability: number;
  violating: boolean;
  violationEventId?: string;
  source?: "sampled-resident" | "background";
  driverPersonId?: string;
  displayName?: string;
  occupantPersonIds?: readonly string[];
  destinationBuildingId?: string;
  purpose?: string;
  delaySeconds?: number;
}

export interface PedestrianSnapshot {
  id: number;
  segmentId: string;
  x: number;
  z: number;
  heading: number;
  waiting: boolean;
  color: string;
  variant: number;
  complianceProbability: number;
  violating: boolean;
  violationEventId?: string;
  source?: "sampled-resident" | "background";
  personId?: string;
  displayName?: string;
  destinationBuildingId?: string;
  purpose?: string;
  delaySeconds?: number;
}

export interface SimulationMetrics {
  vehicleTravelSeconds: number;
  averageSpeedMph: number;
  congestion: number;
  intersectionDelaySeconds: number;
  pedestrianWaitSeconds: number;
  potentialConflicts: number;
  throughputPerHour: number;
  activeVehicles: number;
  activePedestrians: number;
  crossingsCompleted: number;
  buildingArrivals: number;
  trafficViolations: number;
  jaywalkingViolations: number;
}

export interface RoadTrafficSnapshot {
  segmentId: string;
  activeVehicles: number;
  queuedVehicles: number;
  averageSpeedMph: number;
  congestionPercent: number;
  averageDelaySeconds: number;
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  cityElapsedMinutes: number;
  timeHorizon: TimeHorizon;
  mobilityDetailMode: MobilityDetailMode;
  timeOfDayHours: number;
  weather: WeatherMode;
  signalPhase: SignalPhase;
  signals: readonly SignalSnapshot[];
  vehicles: readonly VehicleSnapshot[];
  pedestrians: readonly PedestrianSnapshot[];
  roadTraffic: readonly RoadTrafficSnapshot[];
  metrics: SimulationMetrics;
  city: CitySectionState;
  cityActivity: CityActivitySnapshot;
  cityEvents: readonly CitySystemEvent[];
  entities: DetailedEntityState;
}
