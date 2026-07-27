export type SignalPhase = "vehicles" | "pedestrians";

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
