import type {
  DesignImpact,
  ScenarioSettings,
  SimulationMetrics,
  SimulationState,
} from "../models/types";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  speedLimitMph: 25,
  signalCycleSeconds: 70,
  vehicleVolume: 2,
  pedestrianVolume: 2,
};

const EMPTY_DESIGN_IMPACT: DesignImpact = {
  laneCapacityDelta: 0,
  bikeLanes: 0,
  sidewalkUpgrades: 0,
  crosswalks: 0,
  pedestrianIslands: 0,
};

export function createInitialState(): SimulationState {
  return {
    running: false,
    elapsedSeconds: 0,
    signalPhase: "east-west",
    metrics: calculateMetrics(DEFAULT_SETTINGS, EMPTY_DESIGN_IMPACT),
  };
}

export class Simulation {
  private state: SimulationState = createInitialState();
  private settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  private designImpact: DesignImpact = { ...EMPTY_DESIGN_IMPACT };

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  getBaselineMetrics(): SimulationMetrics {
    return calculateMetrics(this.settings, EMPTY_DESIGN_IMPACT);
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    this.state = createInitialState();
    this.updateMetrics();
  }

  setSimulationSpeed(speed: number): void {
    this.settings = {
      ...this.settings,
      simulationSpeed: Math.min(2, Math.max(0.5, speed)),
    };
  }

  setVehicleVolume(volume: number): void {
    this.settings = {
      ...this.settings,
      vehicleVolume: Math.round(Math.min(3, Math.max(1, volume))),
    };
    this.updateMetrics();
  }

  setPedestrianVolume(volume: number): void {
    this.settings = {
      ...this.settings,
      pedestrianVolume: Math.round(Math.min(3, Math.max(1, volume))),
    };
    this.updateMetrics();
  }

  setSpeedLimit(speedLimitMph: number): void {
    this.settings = {
      ...this.settings,
      speedLimitMph: Math.min(45, Math.max(10, speedLimitMph)),
    };
    this.updateMetrics();
  }

  setSignalCycle(signalCycleSeconds: number): void {
    this.settings = {
      ...this.settings,
      signalCycleSeconds: Math.min(180, Math.max(10, signalCycleSeconds)),
    };
    this.updateMetrics();
  }

  setDesignImpact(impact: DesignImpact): void {
    this.designImpact = { ...impact };
    this.updateMetrics();
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || deltaSeconds <= 0) return;

    this.state.elapsedSeconds += deltaSeconds * this.settings.simulationSpeed;
    this.state.signalPhase = this.getSignalPhase();
    this.updateMetrics();
  }

  private getSignalPhase(): SimulationState["signalPhase"] {
    const cycleProgress =
      (this.state.elapsedSeconds % this.settings.signalCycleSeconds) /
      this.settings.signalCycleSeconds;
    if (cycleProgress < 0.42) return "east-west";
    if (cycleProgress < 0.84) return "north-south";
    return "pedestrians";
  }

  private updateMetrics(): void {
    this.state.metrics = calculateMetrics(this.settings, this.designImpact);
  }
}

export function calculateMetrics(
  settings: Readonly<ScenarioSettings>,
  impact: Readonly<DesignImpact>,
): SimulationMetrics {
  const signalPenalty = Math.abs(settings.signalCycleSeconds - 70) * 0.12;
  const lowSpeedPenalty = settings.speedLimitMph < 20 ? 4 : 0;
  const vehicleTravelSeconds = Math.max(
    24,
    49 +
      settings.vehicleVolume * 8 +
      signalPenalty +
      lowSpeedPenalty -
      impact.laneCapacityDelta * 4.5,
  );
  const congestion = Math.max(
    1,
    Math.round(settings.vehicleVolume * 11 - impact.laneCapacityDelta * 4),
  );
  const averageSpeedMph = Math.max(
    4,
    settings.speedLimitMph -
      congestion * 0.34 +
      impact.laneCapacityDelta * 1.2,
  );
  const intersectionDelaySeconds = Math.max(
    3,
    7 +
      settings.vehicleVolume * 4.2 +
      Math.abs(settings.signalCycleSeconds - 65) * 0.1 -
      impact.laneCapacityDelta * 1.1 -
      impact.crosswalks * 0.25,
  );
  const pedestrianWaitSeconds = Math.max(
    2,
    17 +
      settings.pedestrianVolume * 5 +
      settings.signalCycleSeconds * 0.08 -
      impact.sidewalkUpgrades * 1.2 -
      impact.crosswalks * 0.85 -
      impact.pedestrianIslands * 1.15,
  );
  const potentialConflicts = Math.max(
    0,
    Math.round(
      settings.vehicleVolume * 4 +
        settings.pedestrianVolume * 3 -
        impact.bikeLanes * 0.8 -
        impact.crosswalks * 0.65 -
        impact.pedestrianIslands * 1.2,
    ),
  );
  const throughputPerHour = Math.max(
    120,
    Math.round(
      420 +
        settings.vehicleVolume * 90 +
        impact.laneCapacityDelta * 55 -
        congestion * 5,
    ),
  );

  return {
    vehicleTravelSeconds: roundOneDecimal(vehicleTravelSeconds),
    averageSpeedMph: roundOneDecimal(averageSpeedMph),
    congestion,
    intersectionDelaySeconds: roundOneDecimal(intersectionDelaySeconds),
    pedestrianWaitSeconds: roundOneDecimal(pedestrianWaitSeconds),
    potentialConflicts,
    throughputPerHour,
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
