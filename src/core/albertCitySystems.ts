import type {
  DesignImpact,
  ExpansionRoad,
  PlacedBuilding,
  ScenarioSettings,
} from "../models/types";
import type {
  CitySectionState,
  CitySystemEvent,
  TimeHorizon,
} from "../models/cityTypes";
import type {
  BuildingAccessibility,
  DetailedBuilding,
  DetailedEntityState,
  EntityBuildingDefinition,
} from "../models/entityTypes";
import { PENN_BUILDINGS } from "../data/pennBuildings";
import { deriveBuildingIssues, type BuildingIssue } from "./buildingIssues";
import { advanceCitySection } from "./cityEngine";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
} from "./cityModel";
import {
  advanceDetailedTime,
  createDetailedEntityState,
} from "./entitySimulation";
import {
  cityMinutesPerSecond,
  formatClockTime,
  formatLongDate,
} from "./timeScale";
import { ResidentMobilitySystem } from "./residentMobility";

const START_MINUTE = 7 * 60;
const MAX_EVENTS = 8;

export interface AlbertCitySnapshot {
  dateLabel: string;
  clockLabel: string;
  timeHorizon: TimeHorizon;
  city: Readonly<CitySectionState>;
  entities: Readonly<DetailedEntityState>;
  issues: readonly BuildingIssue[];
  events: readonly CitySystemEvent[];
}

export class AlbertCitySystems {
  private readonly residentMobility = new ResidentMobilitySystem();
  private readonly definition = createDemoCitySectionDefinition();
  private city = createCitySectionState(this.definition);
  private buildingDefinitions: EntityBuildingDefinition[] = [...PENN_BUILDINGS];
  private entities = createDetailedEntityState(
    this.buildingDefinitions,
    this.city,
  );
  private issues = deriveBuildingIssues(this.entities, this.city);
  private events: CitySystemEvent[] = [];
  private elapsedMinutes = 0;
  private lastDetailedTimeSlot = 0;
  private timeHorizon: TimeHorizon = "day";
  private expansionRoads: ExpansionRoad[] = [];
  private placedBuildingIds = new Set<string>();

  reset(): void {
    this.residentMobility.reset();
    this.city = createCitySectionState(this.definition);
    this.entities = createDetailedEntityState(
      this.buildingDefinitions,
      this.city,
    );
    this.issues = deriveBuildingIssues(this.entities, this.city);
    this.events = [];
    this.elapsedMinutes = 0;
    this.lastDetailedTimeSlot = 0;
  }

  setTimeHorizon(horizon: TimeHorizon): void {
    this.timeHorizon = horizon;
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    this.residentMobility.reset();
    this.placedBuildingIds = new Set(buildings.map((building) => building.id));
    this.buildingDefinitions = [
      ...PENN_BUILDINGS,
      ...buildings.map(toEntityBuildingDefinition),
    ];
    this.entities = createDetailedEntityState(
      this.buildingDefinitions,
      this.city,
    );
    this.issues = deriveBuildingIssues(this.entities, this.city);
  }

  setExpansionRoads(roads: readonly ExpansionRoad[]): void {
    this.expansionRoads = roads.map((road) => ({ ...road }));
  }

  update(
    deltaSeconds: number,
    running: boolean,
    simulationSpeed: number,
    settings: Readonly<ScenarioSettings>,
    impact: Readonly<DesignImpact>,
  ): void {
    if (!running || deltaSeconds <= 0) return;
    const cityMinutes =
      deltaSeconds *
      simulationSpeed *
      cityMinutesPerSecond(this.timeHorizon);
    const previousDay = Math.floor(this.elapsedMinutes / 1440);
    this.elapsedMinutes += cityMinutes;
    const completedDay = Math.floor(this.elapsedMinutes / 1440);
    const networkBonus = this.expansionNetworkBonus();
    const roadCapacityScale = clamp(
      0.82 +
        settings.vehicleVolume * 0.08 +
        impact.laneCapacityDelta * 0.04 +
        networkBonus,
      0.6,
      1.55,
    );

    if (completedDay > previousDay) {
      const update = advanceCitySection(
        this.city,
        completedDay - previousDay,
        {
          roadCapacityScale,
          transitServiceScale: 1,
          zoningStrictness: 1,
        },
      );
      this.city = update.state;
      this.events = [...update.events, ...this.events].slice(0, MAX_EVENTS);
    }

    const detailedTimeSlot = Math.floor(this.elapsedMinutes / 5);
    if (detailedTimeSlot !== this.lastDetailedTimeSlot) {
      this.lastDetailedTimeSlot = detailedTimeSlot;
      this.entities = advanceDetailedTime(
        this.entities,
        this.city,
        completedDay,
        START_MINUTE + this.elapsedMinutes,
        {
          roadCapacityScale,
          transitServiceScale: 1,
          zoningStrictness: 1,
          congestionPercent: this.city.metrics.congestionPercent,
          accessibilityByBuilding: this.calculateAccessibilityProfiles(
            roadCapacityScale,
          ),
          externalJobCapacityScale: clamp(1.08 - settings.vehicleVolume * 0.06, 0.65, 1.1),
          externalSupplyScale: clamp(
            0.86 + roadCapacityScale * 0.12 + networkBonus * 0.35,
            0.65,
            1.25,
          ),
        },
      );
      this.issues = deriveBuildingIssues(this.entities, this.city);
    }
    this.entities = {
      ...this.entities,
      people: this.residentMobility.update(
        this.entities.people,
        this.entities.buildings,
        START_MINUTE + this.elapsedMinutes,
        this.expansionRoads,
      ),
    };
  }

  getSnapshot(): AlbertCitySnapshot {
    return {
      dateLabel: formatLongDate(
        this.definition.startYear,
        this.elapsedMinutes / 1440,
      ),
      clockLabel: formatClockTime(START_MINUTE + this.elapsedMinutes),
      timeHorizon: this.timeHorizon,
      city: this.city,
      entities: this.entities,
      issues: this.issues,
      events: this.events,
    };
  }

  getBuilding(id: string): Readonly<DetailedBuilding> | undefined {
    return this.entities.buildings.find((building) => building.id === id);
  }

  private expansionNetworkBonus(): number {
    const totalLength = this.expansionRoads.reduce(
      (total, road) =>
        total + Math.hypot(road.endX - road.startX, road.endZ - road.startZ),
      0,
    );
    const connectedEndpoints = new Map<string, number>();
    for (const road of this.expansionRoads) {
      for (const [x, z] of [
        [road.startX, road.startZ],
        [road.endX, road.endZ],
      ] as const) {
        const key = `${Math.round(x / 2)}:${Math.round(z / 2)}`;
        connectedEndpoints.set(key, (connectedEndpoints.get(key) ?? 0) + 1);
      }
    }
    const junctions = [...connectedEndpoints.values()].filter(
      (count) => count > 1,
    ).length;
    return clamp(totalLength / 4_000 + junctions * 0.012, 0, 0.28);
  }

  private calculateAccessibilityProfiles(
    roadCapacityScale: number,
  ): ReadonlyMap<string, BuildingAccessibility> {
    const profiles = new Map<string, BuildingAccessibility>();
    const congestion = clamp(this.city.metrics.congestionPercent, 0, 100);
    for (const building of this.entities.buildings) {
      const distance = this.placedBuildingIds.has(building.id)
        ? distanceToRoadNetwork(
            building.x,
            building.z,
            this.expansionRoads,
          )
        : 0;
      const networkAccess = this.placedBuildingIds.has(building.id)
        ? clamp(100 - distance * 0.55, 20, 100)
        : 84;
      const congestionPenalty = clamp(
        congestion * 0.42 + Math.max(0, 100 - networkAccess) * 0.34,
        0,
        55,
      );
      const capacityBonus = clamp((roadCapacityScale - 1) * 18, -8, 12);
      const overall = clamp(
        networkAccess + capacityBonus - congestionPenalty,
        15,
        100,
      );
      profiles.set(building.id, {
        overall: roundOne(overall),
        workers: roundOne(clamp(overall + 3, 15, 100)),
        customers: roundOne(clamp(overall + 1, 15, 100)),
        freight: roundOne(
          clamp(overall + capacityBonus * 0.8, 12, 100),
        ),
        services: roundOne(clamp(overall + 5, 18, 100)),
        averageTravelMinutes: roundOne(
          5 + distance / 28 + congestionPenalty * 0.22,
        ),
        congestionPenalty: roundOne(congestionPenalty),
        transitBonus: 0,
      });
    }
    return profiles;
  }
}

function toEntityBuildingDefinition(
  building: Readonly<PlacedBuilding>,
): EntityBuildingDefinition {
  const size = 10 + Math.min(8, building.floors * 0.35);
  return {
    id: building.id,
    name: `${capitalize(building.kind)} building ${building.id.replace(/\D+/g, "") || "custom"}`,
    address: "Player-built expansion",
    source: "block",
    function:
      building.kind === "residential"
        ? "housing"
        : building.kind === "commercial"
          ? "retail"
          : building.kind === "industrial"
            ? "industrial"
            : "clinic",
    zone: building.kind,
    x: building.x,
    z: building.z,
    width: size,
    depth: size,
    height: building.floors * 3.4,
    floors: building.floors,
    archetype: 0,
    rotation: building.rotation,
    visualSeed: stableSeed(building.id),
  };
}

function stableSeed(value: string): number {
  let seed = 0;
  for (const character of value) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }
  return seed;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceToRoadNetwork(
  x: number,
  z: number,
  roads: readonly ExpansionRoad[],
): number {
  if (roads.length === 0) return 180;
  return roads.reduce(
    (nearest, road) =>
      Math.min(
        nearest,
        distanceToSegment(
          x,
          z,
          road.startX,
          road.startZ,
          road.endX,
          road.endZ,
        ),
      ),
    Number.POSITIVE_INFINITY,
  );
}

function distanceToSegment(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return Math.hypot(x - startX, z - startZ);
  const progress = clamp(
    ((x - startX) * dx + (z - startZ) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    x - (startX + dx * progress),
    z - (startZ + dz * progress),
  );
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
