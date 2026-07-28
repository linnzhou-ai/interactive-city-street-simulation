export type AppMode = "build" | "simulate";
export type CameraMode = "orbit" | "fly";
export type EnvironmentMode = "loading" | "rendered";
export type MapOverlayMode = "none" | "congestion" | "pedestrians" | "conflicts";
export type SignalPhase = "east-west" | "north-south" | "pedestrians";
export type FeatureKind = "street" | "intersection";
export type FeatureAxis = "x" | "z";
export type LaneDirection = "two-way" | "forward" | "reverse";

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
}

export interface SimulationMetrics {
  vehicleTravelSeconds: number;
  averageSpeedMph: number;
  congestion: number;
  intersectionDelaySeconds: number;
  pedestrianWaitSeconds: number;
  potentialConflicts: number;
  throughputPerHour: number;
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  signalPhase: SignalPhase;
  metrics: SimulationMetrics;
}
