import type {
  CityActivitySnapshot,
  DesignImpact,
  ManualSignalTarget,
  MobilityDetailMode,
  ScenarioSettings,
  SignalControlMode,
  SignalSnapshot,
  SignalTiming,
  SimulationState,
  FeatureDesign,
  ExpansionRoad,
  ExpansionStreetObject,
  PlacedBuilding,
  WeatherMode,
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
  PersonMobilityOutcome,
  TravelMode,
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
import {
  EMPTY_BUILDING_ACTIVITY,
  summarizeBuildingActivity,
  type BuildingActivitySummary,
} from "./buildingActivity";
import { getPhillyCrashRiskProfile } from "../data/phillyCrashProfile";
import { calculateBuildingTrafficAttribution } from "./trafficAttribution";
import {
  advanceDetailedTime,
  createDetailedEntityState,
  syncDetailedEntityBuildings,
} from "./entitySimulation";
import { placedBuildingToDefinition } from "./expansionEconomy";
import {
  cityMinutesPerSecond,
  formatClockTime,
  formatLongDate,
} from "./timeScale";
import { SampledMobilitySystem } from "./sampledMobility";

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
const SLOW_STREET_ANIMATION_SCALE = 0.65;

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
    mobilityDetailMode: mobilityDetailModeForHorizon(DEFAULT_SETTINGS.timeHorizon),
    timeOfDayHours: START_MINUTE / 60,
    weather: "clear",
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
  private readonly sampledMobility = new SampledMobilitySystem();
  private state: SimulationState;
  private mobilityOutcomes: ReadonlyMap<string, PersonMobilityOutcome> = new Map();
  private designImpact: DesignImpact = { ...EMPTY_DESIGN_IMPACT };
  private buildingActivity: BuildingActivitySummary = {
    ...EMPTY_BUILDING_ACTIVITY,
  };
  private lastDetailedTimeSlot = 0;
  private expansionBuildings: PlacedBuilding[] = [];
  private expansionRoads: ExpansionRoad[] = [];
  private expansionStreetObjects: ExpansionStreetObject[] = [];
  private demolishedBuildingIds = new Set<string>();
  private municipalProjectSpending = 0;

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
    this.traffic.setBuildingDestinations(this.trafficBuildingDestinations());
  }

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  getMunicipalProjectSpending(): number {
    return this.municipalProjectSpending;
  }

  fundMunicipalProject(cost: number): boolean {
    if (
      !Number.isFinite(cost)
      || cost <= 0
      || this.state.city.municipalBudget < cost
    ) return false;
    this.state.city.municipalBudget -= cost;
    this.municipalProjectSpending += cost;
    this.state.city.metrics = {
      ...this.state.city.metrics,
      municipalBalance: this.state.city.municipalBudget,
    };
    return true;
  }

  getBuildingActivity(): Readonly<BuildingActivitySummary> {
    return this.buildingActivity;
  }

  getExpansionBuildingAccess(buildingId: string): {
    connected: boolean;
    walkingBonus: number;
    cyclingBonus: number;
  } | null {
    const building = this.expansionBuildings.find((candidate) => candidate.id === buildingId);
    return building ? this.traffic.getEndpointMobilitySupport(building) : null;
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
      (segmentId) => this.traffic.getRoadDescription(segmentId),
    );
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    this.municipalProjectSpending = 0;
    const city = createCitySectionState(this.cityDefinition);
    const activity = calculateCityActivity(city, 0);
    this.traffic.reset(
      this.settings.simulationSeed,
      activity.vehicleDemandLevel,
      activity.pedestrianDemandLevel,
    );
    const definitions = this.activeBuildingDefinitions();
    this.state = createInitialState(this.traffic, city, definitions);
    this.traffic.setExpansionNetwork(
      this.expansionRoads,
      this.expansionStreetObjects,
      this.trafficBuildingDestinations(),
    );
    this.state.timeHorizon = this.settings.timeHorizon;
    this.state.mobilityDetailMode = mobilityDetailModeForHorizon(
      this.settings.timeHorizon,
    );
    this.lastDetailedTimeSlot = 0;
    this.mobilityOutcomes = new Map();
    this.syncDemandFromCity();
    this.sampledMobility.invalidateRoutes();
  }

  setSimulationSpeed(speed: number): void {
    this.settings = {
      ...this.settings,
      simulationSpeed: Math.min(2, Math.max(1 / 3_600, speed)),
    };
  }

  setTimeOfDay(hours: number): void {
    const day = Math.floor(this.state.cityElapsedMinutes / 1440);
    this.state.cityElapsedMinutes =
      day * 1440 +
      normalizeHour(hours - START_MINUTE / 60) * 60;
    this.state.timeOfDayHours = normalizeHour(hours);
    this.syncDemandFromCity();
    this.refreshSampledMobility();
    this.syncTrafficState();
  }

  setWeather(weather: WeatherMode): void {
    this.state.weather = weather;
  }

  setTimeHorizon(timeHorizon: TimeHorizon): void {
    if (!(timeHorizon in { day: true, week: true, month: true, year: true })) {
      return;
    }
    this.settings = { ...this.settings, timeHorizon };
    this.state.timeHorizon = timeHorizon;
    this.state.mobilityDetailMode = mobilityDetailModeForHorizon(timeHorizon);
    this.refreshSampledMobility();
    this.syncTrafficState();
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
    this.sampledMobility.invalidateRoutes();
    this.refreshSampledMobility();
    this.syncTrafficState();
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    this.setExpansionDesign(
      buildings,
      this.expansionRoads,
      this.expansionStreetObjects,
    );
  }

  setDemolishedBuildings(ids: readonly string[]): void {
    const next = new Set(ids);
    if (
      next.size === this.demolishedBuildingIds.size
      && [...next].every((id) => this.demolishedBuildingIds.has(id))
    ) return;
    this.demolishedBuildingIds = next;
    this.state.entities = syncDetailedEntityBuildings(
      this.state.entities,
      this.activeBuildingDefinitions(),
    );
    this.traffic.setBuildingDestinations(this.trafficBuildingDestinations());
    this.refreshSampledMobility();
    this.syncEconomicRoadLoad();
    this.updateMetrics();
  }

  setExpansionDesign(
    buildings: readonly PlacedBuilding[],
    roads: readonly ExpansionRoad[],
    streetObjects: readonly ExpansionStreetObject[],
  ): void {
    this.expansionBuildings = buildings.map((building) => ({ ...building }));
    this.expansionRoads = roads.map((road) => ({ ...road }));
    this.expansionStreetObjects = streetObjects.map((object) => ({ ...object }));
    this.buildingActivity = summarizeBuildingActivity(buildings);
    const definitions = this.activeBuildingDefinitions();
    this.state.entities = syncDetailedEntityBuildings(
      this.state.entities,
      definitions,
    );
    this.traffic.setExpansionNetwork(
      roads,
      streetObjects,
      this.trafficBuildingDestinations(),
    );
    this.sampledMobility.invalidateRoutes();
    this.refreshSampledMobility();
    this.syncEconomicRoadLoad();
    this.syncTrafficState();
    this.updateMetrics();
  }

  private activeBuildingDefinitions(): EntityBuildingDefinition[] {
    return [
      ...this.buildingDefinitions.filter(
        (building) => !this.demolishedBuildingIds.has(building.id),
      ),
      ...this.expansionBuildings.map(placedBuildingToDefinition),
    ];
  }

  private trafficBuildingDestinations(): Array<{
    kind: PlacedBuilding["kind"];
    x: number;
    z: number;
  }> {
    return this.activeBuildingDefinitions().map((building) => ({
      kind: building.zone === "park" ? "civic" : building.zone,
      x: building.x,
      z: building.z,
    }));
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
    this.state.timeOfDayHours = normalizeHour(
      (START_MINUTE + this.state.cityElapsedMinutes) / 60,
    );
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
      this.refreshSampledMobility();
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
          mobilityOutcomesByPerson: this.mobilityOutcomes,
        },
      );
      this.syncEconomicRoadLoad();
    }
    this.refreshSampledMobility();
    this.syncDemandFromCity();
    const timeDemand = getTimeDemandAdjustment(this.state.timeOfDayHours);
    const crashRisk = getPhillyCrashRiskProfile(this.state.timeOfDayHours);
    const weatherDemand =
      this.state.weather === "rain"
        ? { vehicle: 0.15, pedestrian: -0.65, speed: 0.78 }
        : this.state.weather === "fog"
          ? { vehicle: -0.1, pedestrian: -0.25, speed: 0.86 }
          : { vehicle: 0, pedestrian: 0, speed: 1 };
    const expansionDemand = this.expansionDemand();
    const showBackground = this.state.mobilityDetailMode !== "outcome";
    this.traffic.setBackgroundTrafficVisible(showBackground);
    const trafficDelta = showBackground
      ? this.settings.simulationSpeed < 0.5
        ? deltaSeconds * SLOW_STREET_ANIMATION_SCALE
        : simulationDelta
      : Math.min(simulationDelta, 0.1);
    this.traffic.update(trafficDelta, {
      ...this.settings,
      speedLimitMph: this.settings.speedLimitMph * weatherDemand.speed,
      vehicleVolume: showBackground ? clamp(
        this.settings.vehicleVolume +
          timeDemand.vehicle +
          weatherDemand.vehicle +
          expansionDemand.vehicle,
        0,
        3,
      ) : 0,
      pedestrianVolume: showBackground ? clamp(
        this.settings.pedestrianVolume +
          timeDemand.pedestrian +
          weatherDemand.pedestrian +
          expansionDemand.pedestrian,
        0,
        3,
      ) : 0,
      violationRiskMultiplier: crashRisk.trafficMultiplier,
      pedestrianViolationRiskMultiplier: crashRisk.pedestrianMultiplier,
    });
    this.syncTrafficState();
  }

  private routeForConnection(connection: Readonly<EntityConnection>): string[] {
    return this.traffic.getRouteSegmentIds(
      this.trafficEndpoint(connection.fromBuildingId),
      this.trafficEndpoint(connection.toBuildingId),
    );
  }

  private trafficEndpoint(buildingId: string): TrafficRouteEndpoint {
    const building = this.state.entities.buildings.find(
      (candidate) => candidate.id === buildingId,
    );
    if (building) return { x: building.x, z: building.z };
    return buildingId === "outside-market" ? "outside-market" : "outside-work";
  }

  private refreshSampledMobility(): void {
    const result = this.sampledMobility.update(
      this.state.entities.people,
      this.state.entities.buildings,
      START_MINUTE + this.state.cityElapsedMinutes,
      this.state.mobilityDetailMode,
      this.state.roadTraffic,
      this.state.city.metrics.averageTrafficDelayMinutes,
      (fromBuildingId, toBuildingId, mode: TravelMode) =>
        this.traffic.getRoutePath(
          this.trafficEndpoint(fromBuildingId),
          this.trafficEndpoint(toBuildingId),
          mode,
        ),
    );
    this.traffic.setSampledMobility(result.vehicles, result.pedestrians);
    const alignedVehicleByPerson = new Map(
      this.traffic.getVehicles()
        .filter((vehicle) => vehicle.source === "sampled-resident")
        .flatMap((vehicle) =>
          (vehicle.occupantPersonIds ?? []).map((personId) => [
            personId,
            vehicle,
          ] as const)
        ),
    );
    this.state.entities = {
      ...this.state.entities,
      people: result.people.map((person) => {
        const vehicle = alignedVehicleByPerson.get(person.id);
        if (!vehicle) return person;
        return {
          ...person,
          mobility: {
            ...person.mobility,
            x: vehicle.x,
            z: vehicle.z,
            heading: vehicle.heading,
            segmentId: vehicle.segmentId,
          },
        };
      }),
    };
    this.mobilityOutcomes = result.outcomes;
    this.traffic.setBackgroundTrafficVisible(
      this.state.mobilityDetailMode !== "outcome",
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
      const mobility = this.traffic.getEndpointMobilitySupport(building);
      if (building.source === "expansion" && !mobility.connected) {
        profiles.set(building.id, {
          overall: 8,
          workers: 6,
          customers: 5,
          freight: 3,
          services: 12,
          averageTravelMinutes: 60,
          congestionPenalty: 70,
          transitBonus: 0,
        });
        continue;
      }
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
      const activeTravelBonus = mobility.walkingBonus + mobility.cyclingBonus;
      const workers = clamp(82 + transitBonus + centralityBonus * 0.35 + activeTravelBonus * 0.45 - congestionPenalty, 18, 100);
      const customers = clamp(80 + transitBonus * 0.55 + centralityBonus + mobility.walkingBonus * 0.75 + mobility.cyclingBonus * 0.25 - congestionPenalty * 0.82, 18, 100);
      const freight = clamp(78 + roadCapacityBonus - congestionPenalty * 1.08, 15, 100);
      const services = clamp(82 + transitBonus * 0.72 + centralityBonus * 0.65 + mobility.walkingBonus * 0.8 - congestionPenalty * 0.68, 20, 100);
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
    const expansionCapacity = this.traffic.getExpansionCapacityScale();
    const laneScale =
      (this.settings.roadCapacity / 100) *
      (1 + this.designImpact.laneCapacityDelta * 0.025) *
      expansionCapacity;
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

  private syncEconomicRoadLoad(): void {
    const load = new Map<string, number>();
    for (const connection of this.state.entities.connections) {
      const trips = connection.kind === "delivery"
        ? Math.max(0.25, connection.volume / 18) * 2
        : connection.volume * 0.42;
      for (const segmentId of this.routeForConnection(connection)) {
        load.set(segmentId, (load.get(segmentId) ?? 0) + trips);
      }
    }
    this.traffic.setEconomicRoadLoad(load);
  }

  private expansionDemand(): { vehicle: number; pedestrian: number } {
    const ids = new Set(this.expansionBuildings.map((building) => building.id));
    let vehicleTrips = 0;
    let walkingTrips = 0;
    for (const connection of this.state.entities.connections) {
      if (!ids.has(connection.fromBuildingId) && !ids.has(connection.toBuildingId)) {
        continue;
      }
      if (connection.kind === "delivery") {
        vehicleTrips += Math.max(0.25, connection.volume / 18) * 2;
      } else {
        vehicleTrips += connection.volume * 0.35;
        walkingTrips += connection.volume * 0.45;
      }
    }
    return {
      vehicle: clamp(vehicleTrips / 260, 0, 0.8),
      pedestrian: clamp(walkingTrips / 320, 0, 0.8),
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

export function mobilityDetailModeForHorizon(
  horizon: TimeHorizon,
): MobilityDetailMode {
  if (horizon === "day") return "continuous";
  if (horizon === "week") return "interpolated";
  return "outcome";
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

export function getTimeDemandAdjustment(
  hour: number,
): { vehicle: number; pedestrian: number } {
  const normalized = normalizeHour(hour);
  if (
    (normalized >= 7 && normalized < 9.5) ||
    (normalized >= 16 && normalized < 19)
  ) {
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

export function getTimeViolationRiskMultiplier(hour: number): number {
  return getPhillyCrashRiskProfile(hour).trafficMultiplier;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeHour(value: number): number {
  return ((value % 24) + 24) % 24;
}
