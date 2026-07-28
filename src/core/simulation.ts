import type {
  DesignImpact,
  ManualSignalTarget,
  PlacedBuilding,
  ScenarioSettings,
  SignalControlMode,
  SignalSnapshot,
  SignalTiming,
  SimulationMetrics,
  SimulationState,
  WeatherMode,
} from "../models/types";
import {
  EMPTY_BUILDING_ACTIVITY,
  summarizeBuildingActivity,
  type BuildingActivitySummary,
} from "./buildingActivity";
import { LiveTrafficSystem } from "./liveTraffic";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  speedLimitMph: 25,
  signalCycleSeconds: 83,
  vehicleVolume: 2,
  pedestrianVolume: 2,
  simulationSeed: 20260728,
};

const EMPTY_DESIGN_IMPACT: DesignImpact = {
  laneCapacityDelta: 0,
  bikeLanes: 0,
  sidewalkUpgrades: 0,
  crosswalks: 0,
  pedestrianIslands: 0,
};

type TrafficSnapshotSource = Readonly<
  Pick<
    LiveTrafficSystem,
    "getSignals" | "getVehicles" | "getPedestrians" | "getMetrics"
  >
>;

export function createInitialState(
  traffic: TrafficSnapshotSource = new LiveTrafficSystem(
    DEFAULT_SETTINGS.simulationSeed,
  ),
  timeOfDayHours = 8,
  weather: WeatherMode = "clear",
): SimulationState {
  const signals = traffic.getSignals();
  return {
    running: false,
    elapsedSeconds: 0,
    timeOfDayHours,
    weather,
    signalPhase: signals[0]?.phase ?? "ns-green",
    signals,
    vehicles: traffic.getVehicles(),
    pedestrians: traffic.getPedestrians(),
    metrics: traffic.getMetrics(),
  };
}

export class Simulation {
  private settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  private readonly traffic = new LiveTrafficSystem(this.settings.simulationSeed);
  private state: SimulationState = createInitialState(this.traffic);
  private designImpact: DesignImpact = { ...EMPTY_DESIGN_IMPACT };
  private buildingActivity: BuildingActivitySummary = {
    ...EMPTY_BUILDING_ACTIVITY,
  };

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  getBaselineMetrics(): SimulationMetrics {
    return calculateMetrics(this.settings, EMPTY_DESIGN_IMPACT);
  }

  getBuildingActivity(): Readonly<BuildingActivitySummary> {
    return this.buildingActivity;
  }

  getSignal(intersectionId: string): SignalSnapshot | undefined {
    return this.traffic.getSignal(intersectionId);
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    this.traffic.reset(
      this.settings.simulationSeed,
      this.settings.vehicleVolume,
      this.settings.pedestrianVolume,
    );
    this.state = createInitialState(this.traffic);
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
    const sanitized = Math.min(180, Math.max(30, signalCycleSeconds));
    this.settings = {
      ...this.settings,
      signalCycleSeconds: sanitized,
    };
    this.traffic.setAllSignalCycles(sanitized);
    this.syncTrafficState();
  }

  setSimulationSeed(seed: number): void {
    const simulationSeed = Math.max(
      1,
      Math.min(2_147_483_647, Math.trunc(seed)),
    );
    this.settings = { ...this.settings, simulationSeed };
    this.reset();
  }

  setTimeOfDay(hours: number): void {
    this.state.timeOfDayHours = normalizeHour(hours);
  }

  setWeather(weather: WeatherMode): void {
    this.state.weather = weather;
  }

  setSignalTiming(
    intersectionId: string,
    timing: Partial<SignalTiming>,
  ): void {
    this.traffic.setSignalTiming(intersectionId, timing);
    this.syncTrafficState();
  }

  setSignalMode(intersectionId: string, mode: SignalControlMode): void {
    this.traffic.setSignalMode(intersectionId, mode);
    this.syncTrafficState();
  }

  requestManualSignal(
    intersectionId: string,
    target: ManualSignalTarget,
  ): void {
    this.traffic.requestManualPhase(intersectionId, target);
    this.syncTrafficState();
  }

  setDesignImpact(impact: DesignImpact): void {
    this.designImpact = { ...impact };
    this.updateMetrics();
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    this.buildingActivity = summarizeBuildingActivity(buildings);
    this.traffic.setBuildingDestinations(buildings);
    this.updateMetrics();
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || deltaSeconds <= 0) return;
    const simulationDelta = deltaSeconds * this.settings.simulationSpeed;
    this.state.elapsedSeconds += simulationDelta;
    this.state.timeOfDayHours = normalizeHour(
      this.state.timeOfDayHours + simulationDelta / 60,
    );
    const timeDemand = getTimeDemandAdjustment(this.state.timeOfDayHours);
    const weatherDemand =
      this.state.weather === "rain"
        ? { vehicle: 0.15, pedestrian: -0.65, speed: 0.78 }
        : this.state.weather === "fog"
          ? { vehicle: -0.1, pedestrian: -0.25, speed: 0.86 }
          : { vehicle: 0, pedestrian: 0, speed: 1 };
    this.traffic.update(simulationDelta, {
      ...this.settings,
      speedLimitMph: this.settings.speedLimitMph * weatherDemand.speed,
      vehicleVolume: clamp(
        this.settings.vehicleVolume +
          timeDemand.vehicle +
          weatherDemand.vehicle +
          this.buildingActivity.vehicleDemandBoost,
        0,
        3,
      ),
      pedestrianVolume: clamp(
        this.settings.pedestrianVolume +
          timeDemand.pedestrian +
          weatherDemand.pedestrian +
          this.buildingActivity.pedestrianDemandBoost,
        0,
        3,
      ),
    });
    this.syncTrafficState();
  }

  private syncTrafficState(): void {
    this.state.signals = this.traffic.getSignals();
    this.state.signalPhase = this.state.signals[0]?.phase ?? "all-red";
    this.state.vehicles = this.traffic.getVehicles();
    this.state.pedestrians = this.traffic.getPedestrians();
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const metrics = this.traffic.getMetrics();
    this.state.metrics = {
      ...metrics,
      congestion: Math.max(
        0,
        metrics.congestion - this.designImpact.laneCapacityDelta * 2,
      ),
      averageSpeedMph: Math.max(
        0,
        metrics.averageSpeedMph + this.designImpact.laneCapacityDelta * 0.7,
      ),
      pedestrianWaitSeconds: Math.max(
        0,
        metrics.pedestrianWaitSeconds -
          this.designImpact.crosswalks * 0.15 -
          this.designImpact.pedestrianIslands * 0.2,
      ),
    };
  }
}

export function getTimeDemandAdjustment(
  hour: number,
): { vehicle: number; pedestrian: number } {
  const normalized = normalizeHour(hour);
  if ((normalized >= 7 && normalized < 9.5) || (normalized >= 16 && normalized < 19)) {
    return { vehicle: 0.65, pedestrian: 0.35 };
  }
  if (normalized >= 11 && normalized < 14) {
    return { vehicle: 0.15, pedestrian: 0.55 };
  }
  if (normalized >= 22 || normalized < 6) {
    return { vehicle: -0.85, pedestrian: -1.1 };
  }
  return { vehicle: 0, pedestrian: 0 };
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
    activeVehicles: 0,
    activePedestrians: 0,
    crossingsCompleted: 0,
    buildingArrivals: 0,
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeHour(value: number): number {
  return ((value % 24) + 24) % 24;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
