import type {
  ScenarioSettings,
  SimulationMetrics,
  SimulationState,
} from "../models/types";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  speedLimitMph: 25,
  signalCycleSeconds: 12,
  vehicleVolume: 1,
  pedestrianVolume: 1,
};

export function createInitialState(): SimulationState {
  return {
    running: false,
    elapsedSeconds: 0,
    signalPhase: "vehicles",
    vehicle: {
      id: "vehicle-1",
      kind: "vehicle",
      progress: 0,
      completed: false,
      elapsedSeconds: 0,
    },
    pedestrian: {
      id: "pedestrian-1",
      kind: "pedestrian",
      progress: 0,
      completed: false,
      elapsedSeconds: 0,
      waitSeconds: 0,
    },
    metrics: createInitialMetrics(),
  };
}

function createInitialMetrics(): SimulationMetrics {
  return {
    vehicleTravelSeconds: 0,
    congestion: 0,
    pedestrianWaitSeconds: 0,
    potentialConflicts: 0,
  };
}

export class Simulation {
  private state: SimulationState = createInitialState();
  private settings: ScenarioSettings = { ...DEFAULT_SETTINGS };

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    this.state = createInitialState();
  }

  setSimulationSpeed(speed: number): void {
    this.settings = {
      ...this.settings,
      simulationSpeed: Math.min(2, Math.max(0.5, speed)),
    };
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || deltaSeconds <= 0) {
      return;
    }

    const step = Math.min(deltaSeconds, 0.1) * this.settings.simulationSpeed;
    this.state.elapsedSeconds += step;
    this.state.signalPhase = this.getSignalPhase();

    this.updateVehicle(step);
    this.updatePedestrian(step);
    this.updateMetrics();
  }

  private getSignalPhase(): SimulationState["signalPhase"] {
    const halfCycle = this.settings.signalCycleSeconds / 2;
    const cyclePosition = this.state.elapsedSeconds % this.settings.signalCycleSeconds;
    return cyclePosition < halfCycle ? "vehicles" : "pedestrians";
  }

  private updateVehicle(step: number): void {
    const vehicle = this.state.vehicle;
    if (vehicle.completed) {
      return;
    }

    vehicle.elapsedSeconds += step;
    if (this.state.signalPhase === "vehicles" || vehicle.progress < 0.42 || vehicle.progress > 0.58) {
      vehicle.progress = Math.min(1, vehicle.progress + step / 10);
    }
    vehicle.completed = vehicle.progress >= 1;
  }

  private updatePedestrian(step: number): void {
    const pedestrian = this.state.pedestrian;
    if (pedestrian.completed) {
      return;
    }

    pedestrian.elapsedSeconds += step;
    const atCrossing = pedestrian.progress >= 0.32 && pedestrian.progress <= 0.68;
    if (atCrossing && this.state.signalPhase !== "pedestrians") {
      pedestrian.waitSeconds += step;
      return;
    }

    pedestrian.progress = Math.min(1, pedestrian.progress + step / 14);
    pedestrian.completed = pedestrian.progress >= 1;
  }

  private updateMetrics(): void {
    const { vehicle, pedestrian } = this.state;
    this.state.metrics = {
      vehicleTravelSeconds: vehicle.elapsedSeconds,
      congestion: vehicle.completed ? 0 : 1,
      pedestrianWaitSeconds: pedestrian.waitSeconds,
      potentialConflicts: 0,
    };
  }
}
