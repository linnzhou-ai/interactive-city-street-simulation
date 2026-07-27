import type {
  ScenarioSettings,
  SimulationMetrics,
  SimulationState,
  Vehicle,
} from "../models/types";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  speedLimitMph: 25,
  signalCycleSeconds: 12,
  vehicleVolume: 12,
  pedestrianVolume: 1,
};

const MAX_SUBSTEP_SECONDS = 0.05;
const ROUTE_LENGTH_FEET = 400;
const MILES_PER_HOUR_TO_FEET_PER_SECOND = 5280 / 3600;
const STOP_LINE_PROGRESS = 0.45;
const SAFE_FOLLOWING_GAP = 0.08;
const STOPPED_SPEED_MPH = 0.5;
const EPSILON = 1e-9;

export function createInitialState(
  settings: ScenarioSettings = DEFAULT_SETTINGS,
): SimulationState {
  return {
    running: false,
    elapsedSeconds: 0,
    signalPhase: "vehicles",
    signalPhaseRemainingSeconds: settings.signalCycleSeconds / 2,
    vehicles: [],
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
    averageVehicleTravelSeconds: 0,
    congestionPercent: 0,
    pedestrianWaitSeconds: 0,
    potentialConflicts: 0,
    completedVehicles: 0,
    trafficFlowPerMinute: 0,
  };
}

export class Simulation {
  private state: SimulationState = createInitialState();
  private settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  private nextVehicleId = 1;
  private nextDirection: Vehicle["direction"] = "eastbound";
  private spawnCredit = 1;

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
    this.state = createInitialState(this.settings);
    this.nextVehicleId = 1;
    this.nextDirection = "eastbound";
    this.spawnCredit = 1;
  }

  setSimulationSpeed(speed: number): void {
    if (!Number.isFinite(speed)) {
      return;
    }

    this.settings = {
      ...this.settings,
      simulationSpeed: clamp(speed, 0.5, 2),
    };
  }

  setSpeedLimitMph(speedLimitMph: number): void {
    if (!Number.isFinite(speedLimitMph)) {
      return;
    }

    this.settings = {
      ...this.settings,
      speedLimitMph: clamp(speedLimitMph, 10, 45),
    };
  }

  setSignalCycleSeconds(signalCycleSeconds: number): void {
    if (!Number.isFinite(signalCycleSeconds)) {
      return;
    }

    this.settings = {
      ...this.settings,
      signalCycleSeconds: clamp(signalCycleSeconds, 6, 40),
    };
    this.updateSignalState();
  }

  setVehicleVolume(vehicleVolume: number): void {
    if (!Number.isFinite(vehicleVolume)) {
      return;
    }

    this.settings = {
      ...this.settings,
      vehicleVolume: clamp(vehicleVolume, 4, 30),
    };
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || deltaSeconds <= 0) {
      return;
    }

    let remainingSeconds = deltaSeconds * this.settings.simulationSpeed;
    while (remainingSeconds > EPSILON) {
      const step = Math.min(remainingSeconds, MAX_SUBSTEP_SECONDS);
      this.advance(step);
      remainingSeconds -= step;
    }
  }

  private advance(step: number): void {
    this.spawnCredit += (step * this.settings.vehicleVolume) / 60;
    this.spawnVehicles();
    this.updateVehicles(step);
    this.updatePedestrian(step);

    this.state.elapsedSeconds += step;
    this.updateSignalState();
    this.updateMetrics();
  }

  private updateSignalState(): void {
    const halfCycle = this.settings.signalCycleSeconds / 2;
    const cyclePosition = this.state.elapsedSeconds % this.settings.signalCycleSeconds;
    this.state.signalPhase = cyclePosition < halfCycle ? "vehicles" : "pedestrians";
    this.state.signalPhaseRemainingSeconds =
      this.state.signalPhase === "vehicles"
        ? halfCycle - cyclePosition
        : this.settings.signalCycleSeconds - cyclePosition;
  }

  private spawnVehicles(): void {
    while (
      this.spawnCredit >= 1 - EPSILON &&
      this.canSpawn(this.nextDirection)
    ) {
      this.state.vehicles.push({
        id: `vehicle-${this.nextVehicleId}`,
        kind: "vehicle",
        direction: this.nextDirection,
        progress: 0,
        completed: false,
        elapsedSeconds: 0,
        waitingSeconds: 0,
        currentSpeedMph: 0,
      });
      this.nextVehicleId += 1;
      this.nextDirection =
        this.nextDirection === "eastbound" ? "westbound" : "eastbound";
      this.spawnCredit = Math.max(0, this.spawnCredit - 1);
    }
  }

  private canSpawn(direction: Vehicle["direction"]): boolean {
    return !this.state.vehicles.some(
      (vehicle) =>
        !vehicle.completed &&
        vehicle.direction === direction &&
        vehicle.progress < SAFE_FOLLOWING_GAP,
    );
  }

  private updateVehicles(step: number): void {
    this.updateDirection("eastbound", step);
    this.updateDirection("westbound", step);
  }

  private updateDirection(direction: Vehicle["direction"], step: number): void {
    const vehicles = this.state.vehicles
      .filter((vehicle) => !vehicle.completed && vehicle.direction === direction)
      .sort((a, b) => b.progress - a.progress);
    const freeFlowProgress =
      (this.settings.speedLimitMph * MILES_PER_HOUR_TO_FEET_PER_SECOND * step) /
      ROUTE_LENGTH_FEET;

    let leader: Vehicle | undefined;
    for (const vehicle of vehicles) {
      vehicle.elapsedSeconds += step;

      let maximumProgress = 1;
      if (
        this.state.signalPhase !== "vehicles" &&
        vehicle.progress <= STOP_LINE_PROGRESS
      ) {
        maximumProgress = STOP_LINE_PROGRESS;
      }
      if (leader) {
        maximumProgress = Math.min(
          maximumProgress,
          leader.progress - SAFE_FOLLOWING_GAP,
        );
      }

      const previousProgress = vehicle.progress;
      vehicle.progress = Math.max(
        previousProgress,
        Math.min(1, previousProgress + freeFlowProgress, maximumProgress),
      );

      const traveledProgress = vehicle.progress - previousProgress;
      vehicle.currentSpeedMph =
        freeFlowProgress > 0
          ? this.settings.speedLimitMph * (traveledProgress / freeFlowProgress)
          : 0;
      if (vehicle.currentSpeedMph < STOPPED_SPEED_MPH) {
        vehicle.waitingSeconds += step;
      }

      if (vehicle.progress >= 1) {
        vehicle.progress = 1;
        vehicle.completed = true;
        vehicle.currentSpeedMph = 0;
      }

      leader = vehicle;
    }
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
    const completedVehicles = this.state.vehicles.filter(
      (vehicle) => vehicle.completed,
    );
    const activeVehicles = this.state.vehicles.filter(
      (vehicle) => !vehicle.completed,
    );
    const congestedVehicles = activeVehicles.filter(
      (vehicle) => vehicle.currentSpeedMph < this.settings.speedLimitMph / 2,
    );
    const totalTravelSeconds = completedVehicles.reduce(
      (total, vehicle) => total + vehicle.elapsedSeconds,
      0,
    );

    this.state.metrics = {
      averageVehicleTravelSeconds:
        completedVehicles.length > 0
          ? totalTravelSeconds / completedVehicles.length
          : 0,
      congestionPercent:
        activeVehicles.length > 0
          ? (congestedVehicles.length / activeVehicles.length) * 100
          : 0,
      pedestrianWaitSeconds: this.state.pedestrian.waitSeconds,
      potentialConflicts: 0,
      completedVehicles: completedVehicles.length,
      trafficFlowPerMinute:
        this.state.elapsedSeconds > 0
          ? (completedVehicles.length * 60) / this.state.elapsedSeconds
          : 0,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
