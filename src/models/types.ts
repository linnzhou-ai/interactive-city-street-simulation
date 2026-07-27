export type SignalPhase = "vehicles" | "pedestrians";
export const BUILD_GRID_SIZE = 12;
export const BUILD_CELL_SIZE = 4;

export type DesignElement =
  | "lane"
  | "white-lane"
  | "asphalt"
  | "sidewalk"
  | "crosswalk"
  | "signal";
export type IntersectionLayout = "four-way" | "t-junction" | "straight";
export type BuildTool = DesignElement | "erase";

export interface GridCellDesign {
  row: number;
  column: number;
  element: DesignElement;
  rotation: number;
}

export interface GridSignalDesign {
  row: number;
  column: number;
  rotation: number;
}

export interface MovingAgent {
  id: string;
  progress: number;
  completed: boolean;
  elapsedSeconds: number;
}

export interface Vehicle extends MovingAgent {
  kind: "vehicle";
}

export interface Pedestrian extends MovingAgent {
  kind: "pedestrian";
  waitSeconds: number;
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
  congestion: number;
  pedestrianWaitSeconds: number;
  potentialConflicts: number;
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  signalPhase: SignalPhase;
  vehicle: Vehicle;
  pedestrian: Pedestrian;
  metrics: SimulationMetrics;
}
