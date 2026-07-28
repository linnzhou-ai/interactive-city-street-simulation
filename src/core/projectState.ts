import type {
  ExpansionRoad,
  ExpansionStreetObject,
  FeatureDesign,
  PlacedBuilding,
  ScenarioSettings,
  WeatherMode,
} from "../models/types";

export const PROJECT_STATE_VERSION = 1;

export interface EditorSnapshot {
  designs: Array<[string, FeatureDesign]>;
  buildings: PlacedBuilding[];
  expansionRoads: ExpansionRoad[];
  expansionStreetObjects: ExpansionStreetObject[];
  nextBuildingId: number;
  nextExpansionRoadId: number;
  nextExpansionStreetObjectId: number;
}

export interface ProjectSnapshot extends EditorSnapshot {
  version: typeof PROJECT_STATE_VERSION;
  savedAt: string;
  settings: ScenarioSettings;
  timeOfDayHours: number;
  weather: WeatherMode;
}

export class EditHistory {
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(snapshot: EditorSnapshot): void {
    this.undoStack.push(cloneEditorSnapshot(snapshot));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: EditorSnapshot): EditorSnapshot | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(cloneEditorSnapshot(current));
    return cloneEditorSnapshot(previous);
  }

  redo(current: EditorSnapshot): EditorSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneEditorSnapshot(current));
    return cloneEditorSnapshot(next);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    designs: snapshot.designs.map(([id, design]) => [id, { ...design }]),
    buildings: snapshot.buildings.map((building) => ({ ...building })),
    expansionRoads: snapshot.expansionRoads.map((road) => ({ ...road })),
    expansionStreetObjects: snapshot.expansionStreetObjects.map((object) => ({
      ...object,
    })),
    nextBuildingId: snapshot.nextBuildingId,
    nextExpansionRoadId: snapshot.nextExpansionRoadId,
    nextExpansionStreetObjectId: snapshot.nextExpansionStreetObjectId,
  };
}

export function parseProjectSnapshot(raw: string): ProjectSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== PROJECT_STATE_VERSION) {
    throw new Error("This design file uses an unsupported version.");
  }
  if (
    !Array.isArray(value.designs) ||
    !Array.isArray(value.buildings) ||
    !isScenarioSettings(value.settings) ||
    !isWeather(value.weather) ||
    typeof value.timeOfDayHours !== "number" ||
    !Number.isFinite(value.timeOfDayHours) ||
    typeof value.nextBuildingId !== "number" ||
    !Number.isFinite(value.nextBuildingId)
  ) {
    throw new Error("This design file is missing required project data.");
  }

  const designs: Array<[string, FeatureDesign]> = [];
  for (const entry of value.designs) {
    if (
      !Array.isArray(entry) ||
      typeof entry[0] !== "string" ||
      !isFeatureDesign(entry[1])
    ) {
      throw new Error("This design file contains an invalid street edit.");
    }
    designs.push([entry[0], { ...entry[1] }]);
  }

  const buildings: PlacedBuilding[] = [];
  for (const building of value.buildings) {
    if (!isPlacedBuilding(building)) {
      throw new Error("This design file contains an invalid building.");
    }
    buildings.push({ ...building });
  }

  const expansionRoads: ExpansionRoad[] = [];
  for (const road of Array.isArray(value.expansionRoads) ? value.expansionRoads : []) {
    if (!isExpansionRoad(road)) {
      throw new Error("This design file contains an invalid expansion road.");
    }
    expansionRoads.push({ ...road });
  }

  const expansionStreetObjects: ExpansionStreetObject[] = [];
  for (const object of Array.isArray(value.expansionStreetObjects)
    ? value.expansionStreetObjects
    : []) {
    if (!isExpansionStreetObject(object)) {
      throw new Error("This design file contains an invalid expansion street object.");
    }
    expansionStreetObjects.push({ ...object });
  }

  return {
    version: PROJECT_STATE_VERSION,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    designs,
    buildings,
    expansionRoads,
    expansionStreetObjects,
    nextBuildingId: Math.max(1, Math.trunc(value.nextBuildingId)),
    nextExpansionRoadId:
      typeof value.nextExpansionRoadId === "number" &&
      Number.isFinite(value.nextExpansionRoadId)
        ? Math.max(1, Math.trunc(value.nextExpansionRoadId))
        : expansionRoads.length + 1,
    nextExpansionStreetObjectId:
      typeof value.nextExpansionStreetObjectId === "number" &&
      Number.isFinite(value.nextExpansionStreetObjectId)
        ? Math.max(1, Math.trunc(value.nextExpansionStreetObjectId))
        : expansionStreetObjects.length + 1,
    settings: { ...value.settings },
    timeOfDayHours: normalizeHour(value.timeOfDayHours),
    weather: value.weather,
  };
}

function isExpansionStreetObject(value: unknown): value is ExpansionStreetObject {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "crosswalk" || value.kind === "traffic-signal") &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.z === "number" &&
    Number.isFinite(value.z) &&
    typeof value.rotation === "number" &&
    Number.isFinite(value.rotation)
  );
}

function isExpansionRoad(value: unknown): value is ExpansionRoad {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Number.isFinite(value.startX) &&
    Number.isFinite(value.startZ) &&
    Number.isFinite(value.endX) &&
    Number.isFinite(value.endZ) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width >= 6 &&
    value.width <= 30
  );
}

function isScenarioSettings(value: unknown): value is ScenarioSettings {
  return (
    isRecord(value) &&
    Number.isFinite(value.simulationSpeed) &&
    Number.isFinite(value.speedLimitMph) &&
    Number.isFinite(value.signalCycleSeconds) &&
    Number.isFinite(value.vehicleVolume) &&
    Number.isFinite(value.pedestrianVolume) &&
    Number.isFinite(value.simulationSeed)
  );
}

function isFeatureDesign(value: unknown): value is FeatureDesign {
  return (
    isRecord(value) &&
    (value.laneDelta === -1 || value.laneDelta === 0 || value.laneDelta === 1) &&
    typeof value.bikeLane === "boolean" &&
    typeof value.widenedSidewalk === "boolean" &&
    typeof value.crosswalk === "boolean" &&
    typeof value.pedestrianIsland === "boolean" &&
    (value.laneDirection === "two-way" ||
      value.laneDirection === "forward" ||
      value.laneDirection === "reverse") &&
    Number.isFinite(value.signalCycleSeconds)
  );
}

function isPlacedBuilding(value: unknown): value is PlacedBuilding {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "residential" ||
      value.kind === "commercial" ||
      value.kind === "industrial" ||
      value.kind === "civic") &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.z) &&
    Number.isFinite(value.rotation) &&
    Number.isFinite(value.floors) &&
    typeof value.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.color)
  );
}

function isWeather(value: unknown): value is WeatherMode {
  return value === "clear" || value === "rain" || value === "fog";
}

function normalizeHour(value: number): number {
  return ((value % 24) + 24) % 24;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
