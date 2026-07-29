import type {
  DesignImpact,
  PlacedBuilding,
  ScenarioSettings,
} from "../models/types";
import type {
  CitySectionState,
  CitySystemEvent,
  TimeHorizon,
} from "../models/cityTypes";
import type {
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

  reset(): void {
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
    const roadCapacityScale = clamp(
      0.82 +
        settings.vehicleVolume * 0.08 +
        impact.laneCapacityDelta * 0.04,
      0.6,
      1.4,
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
          externalJobCapacityScale: clamp(1.08 - settings.vehicleVolume * 0.06, 0.65, 1.1),
          externalSupplyScale: clamp(0.9 + roadCapacityScale * 0.1, 0.65, 1.15),
        },
      );
      this.issues = deriveBuildingIssues(this.entities, this.city);
    }
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
