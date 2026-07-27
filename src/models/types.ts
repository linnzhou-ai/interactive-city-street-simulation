export type SignalPhase = "vehicles" | "pedestrians";

export interface MovingAgent {
  id: string;
  progress: number;
  completed: boolean;
  elapsedSeconds: number;
}

export interface Vehicle extends MovingAgent {
  kind: "vehicle";
  direction: "eastbound" | "westbound";
  waitingSeconds: number;
  currentSpeedMph: number;
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
  averageVehicleTravelSeconds: number;
  congestionPercent: number;
  pedestrianWaitSeconds: number;
  potentialConflicts: number;
  completedVehicles: number;
  trafficFlowPerMinute: number;
}

export interface SimulationState {
  running: boolean;
  elapsedSeconds: number;
  signalPhase: SignalPhase;
  signalPhaseRemainingSeconds: number;
  vehicles: Vehicle[];
  pedestrian: Pedestrian;
  metrics: SimulationMetrics;
}
