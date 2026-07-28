export type AppMode = "build" | "simulate";
export type CameraMode = "orbit" | "fly" | "walk";
export type EnvironmentMode = "loading" | "rendered";
export type WeatherMode = "clear" | "rain" | "fog";
export type MapOverlayMode = "none" | "congestion" | "pedestrians" | "conflicts";
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
export type VehicleKind = "sedan" | "compact" | "suv" | "van" | "bus" | "truck";
export type BuildingKind = "residential" | "commercial" | "industrial" | "civic";

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  rotation: number;
  floors: number;
  color: string;
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
  speedLimitMph: number;
  signalCycleSeconds: number;
  vehicleVolume: number;
  pedestrianVolume: number;
  simulationSeed: number;
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
  x: number;
  z: number;
  heading: number;
  speedMetersPerSecond: number;
  queued: boolean;
  kind: VehicleKind;
  color: string;
}

export interface PedestrianSnapshot {
  id: number;
  x: number;
  z: number;
  heading: number;
  waiting: boolean;
  color: string;
  variant: number;
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
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  timeOfDayHours: number;
  weather: WeatherMode;
  signalPhase: SignalPhase;
  signals: readonly SignalSnapshot[];
  vehicles: readonly VehicleSnapshot[];
  pedestrians: readonly PedestrianSnapshot[];
  metrics: SimulationMetrics;
}
