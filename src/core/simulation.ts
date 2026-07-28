import type {
  CityActivitySnapshot,
  DesignImpact,
  ManualSignalTarget,
  ScenarioSettings,
  SignalControlMode,
  SignalSnapshot,
  SignalTiming,
  SimulationMetrics,
  SimulationState,
  FeatureDesign,
} from "../models/types";
import type {
  CityPolicySettings,
  CitySectionDefinition,
  CitySectionState,
  TimeHorizon,
} from "../models/cityTypes";
import type {
  BuildingAccessibility,
  BuildingTrafficAttribution,
  EntityBuildingDefinition,
  EntityConnection,
} from "../models/entityTypes";
import { PENN_BUILDINGS } from "../data/pennBuildings";
import type { RoadSegmentModel } from "../data/roadLanes";
import { advanceCitySection } from "./cityEngine";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
} from "./cityModel";
import { LiveTrafficSystem } from "./liveTraffic";
import type { TrafficRouteEndpoint } from "./liveTraffic";
import { calculateBuildingTrafficAttribution } from "./trafficAttribution";
import {
  advanceDetailedTime,
  createDetailedEntityState,
} from "./entitySimulation";
import {
  cityMinutesPerSecond,
  formatClockTime,
  formatLongDate,
} from "./timeScale";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  timeHorizon: "day",
  speedLimitMph: 25,
  signalCycleSeconds: 83,
  vehicleVolume: 2,
  pedestrianVolume: 2,
  simulationSeed: 20260728,
  transitHeadwayMinutes: 12,
  roadCapacity: 100,
  zoningStrictness: 1,
};

const START_MINUTE = 7 * 60;
const MAX_CITY_EVENTS = 8;

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
    "getSignals" | "getVehicles" | "getPedestrians" | "getRoadTraffic" | "getMetrics"
  >
>;

export function createInitialState(
  traffic: TrafficSnapshotSource = new LiveTrafficSystem(
    DEFAULT_SETTINGS.simulationSeed,
  ),
  city: CitySectionState = createCitySectionState(
    createDemoCitySectionDefinition(),
  ),
  buildingDefinitions: readonly EntityBuildingDefinition[] = PENN_BUILDINGS,
): SimulationState {
  const signals = traffic.getSignals();
  return {
    running: false,
    elapsedSeconds: 0,
    cityElapsedMinutes: 0,
    timeHorizon: DEFAULT_SETTINGS.timeHorizon,
    signalPhase: signals[0]?.phase ?? "ns-green",
    signals,
    vehicles: traffic.getVehicles(),
    pedestrians: traffic.getPedestrians(),
    roadTraffic: traffic.getRoadTraffic(),
    metrics: traffic.getMetrics(),
    city,
    cityActivity: calculateCityActivity(city, 0),
    cityEvents: [],
    entities: createDetailedEntityState(buildingDefinitions, city),
  };
}

export class Simulation {
  private settings: ScenarioSettings = { ...DEFAULT_SETTINGS };
  private readonly traffic = new LiveTrafficSystem(this.settings.simulationSeed);
  private state: SimulationState;
  private designImpact: DesignImpact = { ...EMPTY_DESIGN_IMPACT };
  private lastDetailedTimeSlot = 0;

  constructor(
    private readonly cityDefinition: CitySectionDefinition =
      createDemoCitySectionDefinition(),
    private readonly buildingDefinitions: readonly EntityBuildingDefinition[] =
      PENN_BUILDINGS,
  ) {
    this.state = createInitialState(
      this.traffic,
      createCitySectionState(this.cityDefinition),
      this.buildingDefinitions,
    );
  }

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  getBaselineMetrics(): SimulationMetrics {
    return calculateMetrics(this.settings, EMPTY_DESIGN_IMPACT);
  }

  getSignal(intersectionId: string): SignalSnapshot | undefined {
    return this.traffic.getSignal(intersectionId);
  }

  getRoadSegment(segmentId: string): RoadSegmentModel | undefined {
    return this.traffic.getRoadSegment(segmentId);
  }

  getBuildingTrafficAttribution(buildingId: string): BuildingTrafficAttribution | null {
    return calculateBuildingTrafficAttribution(
      buildingId,
      this.state.entities,
      this.state.roadTraffic,
      this.state.city.metrics.congestionPercent,
      (connection) => this.routeForConnection(connection),
    );
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    const city = createCitySectionState(this.cityDefinition);
    const activity = calculateCityActivity(city, 0);
    this.traffic.reset(
      this.settings.simulationSeed,
      activity.vehicleDemandLevel,
      activity.pedestrianDemandLevel,
    );
    this.state = createInitialState(this.traffic, city, this.buildingDefinitions);
    this.state.timeHorizon = this.settings.timeHorizon;
    this.lastDetailedTimeSlot = 0;
    this.syncDemandFromCity();
  }

  setSimulationSpeed(speed: number): void {
    this.settings = {
      ...this.settings,
      simulationSpeed: Math.min(2, Math.max(0.5, speed)),
    };
  }

  setTimeHorizon(timeHorizon: TimeHorizon): void {
    if (!(timeHorizon in { day: true, week: true, month: true, year: true })) {
      return;
    }
    this.settings = { ...this.settings, timeHorizon };
    this.state.timeHorizon = timeHorizon;
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

  setTransitHeadway(minutes: number): void {
    this.settings = {
      ...this.settings,
      transitHeadwayMinutes: Math.min(30, Math.max(4, Math.round(minutes))),
    };
  }

  setRoadCapacity(percent: number): void {
    this.settings = {
      ...this.settings,
      roadCapacity: Math.min(160, Math.max(60, Math.round(percent))),
    };
  }

  setZoningStrictness(strictness: number): void {
    this.settings = {
      ...this.settings,
      zoningStrictness: Math.min(1.5, Math.max(0.5, strictness)),
    };
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

  setRoadDesigns(
    designs: ReadonlyMap<string, Readonly<FeatureDesign>>,
  ): void {
    this.traffic.setRoadDesigns(designs);
    this.syncTrafficState();
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || deltaSeconds <= 0) return;
    const simulationDelta = deltaSeconds * this.settings.simulationSpeed;
    this.state.elapsedSeconds += simulationDelta;
    const previousCompletedDays = Math.floor(
      this.state.cityElapsedMinutes / 1440,
    );
    this.state.cityElapsedMinutes +=
      simulationDelta * cityMinutesPerSecond(this.settings.timeHorizon);
    const completedDays = Math.floor(this.state.cityElapsedMinutes / 1440);
    if (completedDays > previousCompletedDays) {
      const cityUpdate = advanceCitySection(
        this.state.city,
        completedDays - previousCompletedDays,
        this.cityPolicy(),
      );
      this.state.city = cityUpdate.state;
      this.state.cityEvents = [
        ...cityUpdate.events,
        ...this.state.cityEvents,
      ].slice(0, MAX_CITY_EVENTS);
    }
    const detailedTimeSlot = Math.floor(this.state.cityElapsedMinutes / 5);
    if (detailedTimeSlot !== this.lastDetailedTimeSlot) {
      this.lastDetailedTimeSlot = detailedTimeSlot;
      const cityPolicy = this.cityPolicy();
      this.state.entities = advanceDetailedTime(
        this.state.entities,
        this.state.city,
        completedDays,
        START_MINUTE + this.state.cityElapsedMinutes,
        {
          roadCapacityScale: cityPolicy.roadCapacityScale ?? 1,
          transitServiceScale: 12 / this.settings.transitHeadwayMinutes,
          zoningStrictness: this.settings.zoningStrictness,
          congestionPercent: this.state.city.metrics.congestionPercent,
          accessibilityByBuilding: this.calculateAccessibilityProfiles(),
          externalJobCapacityScale: clamp(
            0.82
              + 12 / this.settings.transitHeadwayMinutes * 0.18
              - this.state.city.metrics.congestionPercent * 0.003,
            0.45,
            1.35,
          ),
          externalSupplyScale: clamp(
            0.72
              + (cityPolicy.roadCapacityScale ?? 1) * 0.34
              - this.state.city.metrics.congestionPercent * 0.0025,
            0.4,
            1.35,
          ),
        },
      );
    }
    this.syncDemandFromCity();
    this.traffic.update(simulationDelta, this.settings);
    this.syncTrafficState();
  }

  private routeForConnection(connection: Readonly<EntityConnection>): string[] {
    const endpoint = (buildingId: string): TrafficRouteEndpoint => {
      const building = this.state.entities.buildings.find(
        (candidate) => candidate.id === buildingId,
      );
      if (building) return { x: building.x, z: building.z };
      return buildingId === "outside-market" ? "outside-market" : "outside-work";
    };
    return this.traffic.getRouteSegmentIds(
      endpoint(connection.fromBuildingId),
      endpoint(connection.toBuildingId),
    );
  }

  private calculateAccessibilityProfiles(): ReadonlyMap<string, BuildingAccessibility> {
    const profiles = new Map<string, BuildingAccessibility>();
    const routeAggregates = new Map<string, {
      volume: number;
      weightedDelay: number;
      weightedCongestion: number;
    }>();
    const roadTraffic = new Map(
      this.state.roadTraffic.map((road) => [road.segmentId, road]),
    );
    const buildingIds = new Set(
      this.state.entities.buildings.map((building) => building.id),
    );
    for (const connection of this.state.entities.connections.slice(0, 64)) {
      const segments = this.routeForConnection(connection);
      if (segments.length === 0) continue;
      const routeDelay = segments.reduce(
        (total, segmentId) => total + (roadTraffic.get(segmentId)?.averageDelaySeconds ?? 0),
        0,
      ) / 60;
      const routeCongestion = segments.reduce(
        (total, segmentId) => total + (roadTraffic.get(segmentId)?.congestionPercent ?? 0),
        0,
      ) / segments.length;
      for (const buildingId of [connection.fromBuildingId, connection.toBuildingId]) {
        if (!buildingIds.has(buildingId)) continue;
        const aggregate = routeAggregates.get(buildingId) ?? {
          volume: 0,
          weightedDelay: 0,
          weightedCongestion: 0,
        };
        aggregate.volume += connection.volume;
        aggregate.weightedDelay += routeDelay * connection.volume;
        aggregate.weightedCongestion += routeCongestion * connection.volume;
        routeAggregates.set(buildingId, aggregate);
      }
    }
    const congestion = clamp(this.state.city.metrics.congestionPercent, 0, 100);
    const transitBonus = clamp(
      (12 / this.settings.transitHeadwayMinutes - 0.55) * 18,
      0,
      18,
    );
    const roadCapacityBonus = clamp((this.settings.roadCapacity - 100) * 0.12, -7, 7);
    for (const building of this.state.entities.buildings) {
      const aggregate = routeAggregates.get(building.id);
      const routeDelay = aggregate && aggregate.volume > 0
        ? aggregate.weightedDelay / aggregate.volume
        : this.state.city.metrics.averageTrafficDelayMinutes;
      const routeCongestion = aggregate && aggregate.volume > 0
        ? aggregate.weightedCongestion / aggregate.volume
        : congestion;
      const congestionPenalty = clamp(
        routeDelay * 2.8 + routeCongestion * 0.24,
        0,
        48,
      );
      const centralityBonus = clamp(
        12 - Math.hypot(building.x, building.z) / 150,
        0,
        12,
      );
      const workers = clamp(82 + transitBonus + centralityBonus * 0.35 - congestionPenalty, 18, 100);
      const customers = clamp(80 + transitBonus * 0.55 + centralityBonus - congestionPenalty * 0.82, 18, 100);
      const freight = clamp(78 + roadCapacityBonus - congestionPenalty * 1.08, 15, 100);
      const services = clamp(82 + transitBonus * 0.72 + centralityBonus * 0.65 - congestionPenalty * 0.68, 20, 100);
      profiles.set(building.id, {
        overall: roundOneDecimal((workers + customers + freight + services) / 4),
        workers: roundOneDecimal(workers),
        customers: roundOneDecimal(customers),
        freight: roundOneDecimal(freight),
        services: roundOneDecimal(services),
        averageTravelMinutes: roundOneDecimal(routeDelay),
        congestionPenalty: roundOneDecimal(congestionPenalty),
        transitBonus: roundOneDecimal(transitBonus),
      });
    }
    return profiles;
  }

  private cityPolicy(): Partial<CityPolicySettings> {
    const laneScale =
      (this.settings.roadCapacity / 100) *
      (1 + this.designImpact.laneCapacityDelta * 0.025);
    const signalScale = 1 - Math.min(
      0.18,
      Math.abs(this.settings.signalCycleSeconds - 75) / 500,
    );
    const speedScale = 1 - Math.min(
      0.14,
      Math.abs(this.settings.speedLimitMph - 25) / 120,
    );
    return {
      roadCapacityScale: clamp(laneScale * signalScale * speedScale, 0.5, 1.5),
      zoningStrictness: this.settings.zoningStrictness,
      transitServiceScale: 12 / this.settings.transitHeadwayMinutes,
    };
  }

  private syncDemandFromCity(): void {
    const cityActivity = calculateCityActivity(
      this.state.city,
      this.state.cityElapsedMinutes,
    );
    this.state.cityActivity = cityActivity;
    this.settings = {
      ...this.settings,
      vehicleVolume: cityActivity.vehicleDemandLevel,
      pedestrianVolume: cityActivity.pedestrianDemandLevel,
    };
  }

  private syncTrafficState(): void {
    this.state.signals = this.traffic.getSignals();
    this.state.signalPhase = this.state.signals[0]?.phase ?? "all-red";
    this.state.vehicles = this.traffic.getVehicles();
    this.state.pedestrians = this.traffic.getPedestrians();
    this.state.roadTraffic = this.traffic.getRoadTraffic();
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

export function calculateCityActivity(
  city: Readonly<CitySectionState>,
  elapsedMinutes: number,
): CityActivitySnapshot {
  const clockMinutes = START_MINUTE + elapsedMinutes;
  const hour = ((clockMinutes / 60) % 24 + 24) % 24;
  const metrics = city.metrics;
  const commute = Math.max(0, metrics.commuteTripsDaily);
  const shopping = Math.max(0, metrics.shoppingTripsDaily);
  const freight = Math.max(0, metrics.freightTripsDaily);
  const totalTripCauses = Math.max(1, commute + shopping + freight);
  const commuteProfile = profileForHour(hour, [7, 10], [16, 19], 2.25, 0.42);
  const shoppingProfile = profileForHour(hour, [11, 14], [17, 21], 1.7, 0.3);
  const freightProfile = hour >= 6 && hour < 17 ? 1.45 : 0.28;
  const pedestrianProfile = profileForHour(hour, [8, 11], [12, 20], 1.85, 0.24);
  const activityFactor =
    commute / totalTripCauses * commuteProfile +
    shopping / totalTripCauses * shoppingProfile +
    freight / totalTripCauses * freightProfile;
  const networkPressure = clamp(metrics.congestionPercent / 100, 0, 1);
  const pedestrianIntensity =
    metrics.pedestrianTripsDaily / Math.max(1, metrics.population * 0.25);

  return {
    dateLabel: formatLongDate(
      city.startYear,
      Math.floor(clockMinutes / 1440),
    ),
    clockLabel: formatClockTime(clockMinutes),
    vehicleDemandLevel: clampDemandLevel(
      0.65 + activityFactor * 0.9 + networkPressure * 0.7,
    ),
    pedestrianDemandLevel: clampDemandLevel(
      0.65 + pedestrianProfile * 0.65 + pedestrianIntensity * 0.35,
    ),
    commuteSharePercent: roundPercent(commute / totalTripCauses),
    shoppingSharePercent: roundPercent(shopping / totalTripCauses),
    freightSharePercent: roundPercent(freight / totalTripCauses),
  };
}

function profileForHour(
  hour: number,
  firstWindow: readonly [number, number],
  secondWindow: readonly [number, number],
  peak: number,
  offPeak: number,
): number {
  const inWindow = (window: readonly [number, number]): boolean =>
    hour >= window[0] && hour < window[1];
  return inWindow(firstWindow) || inWindow(secondWindow) ? peak : offPeak;
}

function clampDemandLevel(value: number): number {
  return Math.round(clamp(value, 1, 3));
}

function roundPercent(ratio: number): number {
  return Math.round(clamp(ratio, 0, 1) * 100);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
