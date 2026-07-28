import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_LANDMARKS,
  PENN_STREETS,
} from "./pennRoadGraph";
import type {
  BuildingFunction,
  EntityBuildingDefinition,
} from "../models/entityTypes";
import type { ZoneType } from "../models/cityEconomyTypes";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);

const FUNCTION_BY_ARCHETYPE: readonly BuildingFunction[] = [
  "school",
  "university",
  "housing",
  "office",
  "industrial",
  "housing",
  "housing",
  "office",
  "clinic",
  "parking",
  "retail",
  "university",
];

const LANDMARK_FUNCTIONS: Record<string, BuildingFunction> = {
  "college-hall": "university",
  fisher: "library",
  huntsman: "university",
  "van-pelt": "library",
  museum: "culture",
  "franklin-field": "recreation",
  gutmann: "university",
  houston: "retail",
  engineering: "university",
  medicine: "clinic",
};

const LANDMARK_SIZES: Record<string, readonly [number, number, number]> = {
  "college-hall": [92, 34, 58],
  fisher: [62, 48, 56],
  huntsman: [88, 56, 45],
  "van-pelt": [96, 62, 42],
  museum: [86, 57, 47],
  "franklin-field": [145, 90, 20],
  gutmann: [66, 46, 64],
  houston: [60, 45, 48],
  engineering: [82, 48, 45],
  medicine: [112, 68, 86],
};

export const PENN_BUILDINGS: readonly EntityBuildingDefinition[] = [
  ...createBlockBuildings(),
  ...createLandmarkBuildings(),
];

function createBlockBuildings(): EntityBuildingDefinition[] {
  const buildings: EntityBuildingDefinition[] = [];
  const rng = seededRandom(20260727);
  let buildingNumber = 1;
  for (let avenueIndex = 0; avenueIndex < PENN_AVENUES.length - 1; avenueIndex += 1) {
    for (let streetIndex = 0; streetIndex < PENN_STREETS.length - 1; streetIndex += 1) {
      const west = longitudeToWorld(PENN_AVENUES[avenueIndex + 1].longitude);
      const east = longitudeToWorld(PENN_AVENUES[avenueIndex].longitude);
      const north = latitudeToWorld(PENN_STREETS[streetIndex].latitude);
      const south = latitudeToWorld(PENN_STREETS[streetIndex + 1].latitude);
      const blockX = (west + east) / 2;
      const blockZ = (north + south) / 2;
      const blockWidth = Math.abs(east - west) - 31;
      const blockDepth = Math.abs(south - north) - 31;
      if (blockWidth < 22 || blockDepth < 22 || nearLandmark(blockX, blockZ, 80)) continue;

      const core = Math.hypot(blockX, blockZ) < 760;
      const count = core ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
      for (let index = 0; index < count; index += 1) {
        const cellWidth = blockWidth / count;
        const width = Math.max(18, cellWidth * (0.58 + rng() * 0.28));
        const depth = Math.max(20, blockDepth * (0.55 + rng() * 0.28));
        const x = blockX - blockWidth / 2 + cellWidth * (index + 0.5)
          + (rng() - 0.5) * cellWidth * 0.18;
        const z = blockZ + (rng() - 0.5) * blockDepth * 0.2;
        const archetype = Math.floor(rng() * 12);
        const rotation = (rng() - 0.5) * 0.06;
        const height = core ? 18 + rng() * 48 : 14 + rng() * 78;
        const buildingFunction = FUNCTION_BY_ARCHETYPE[archetype] ?? "office";
        const street = PENN_STREETS[streetIndex];
        const avenue = PENN_AVENUES[avenueIndex];
        const suffix = functionSuffix(buildingFunction);
        buildings.push({
          id: `penn-block-${avenueIndex}-${streetIndex}-${index}`,
          name: `${avenue.short} ${street.name.replace(" Street", "")} ${suffix}`,
          address: `${3000 + buildingNumber * 7} ${street.name}`,
          source: "block",
          function: buildingFunction,
          zone: zoneForFunction(buildingFunction),
          x,
          z,
          width,
          depth,
          height: archetype === 5 ? height * 1.45 : height,
          floors: Math.max(1, Math.round(height / 3.8)),
          archetype,
          rotation,
          visualSeed: 85_000 + buildingNumber,
        });
        buildingNumber += 1;
        consumeVisualRandomness(rng, archetype);
      }
    }
  }
  return buildings;
}

function createLandmarkBuildings(): EntityBuildingDefinition[] {
  return PENN_LANDMARKS.map((landmark, index) => {
    const [width, depth, height] = LANDMARK_SIZES[landmark.kind];
    const buildingFunction = LANDMARK_FUNCTIONS[landmark.kind];
    return {
      id: `penn-landmark-${landmark.kind}`,
      name: landmark.name,
      address: "University of Pennsylvania",
      source: "landmark",
      landmarkKind: landmark.kind,
      function: buildingFunction,
      zone: zoneForFunction(buildingFunction),
      x: longitudeToWorld(landmark.longitude),
      z: latitudeToWorld(landmark.latitude),
      width,
      depth,
      height,
      floors: Math.max(1, Math.round(height / 4.2)),
      archetype: 11,
      rotation: 0,
      visualSeed: 91_000 + index,
    };
  });
}

function zoneForFunction(buildingFunction: BuildingFunction): ZoneType {
  if (buildingFunction === "housing") return "residential";
  if (buildingFunction === "retail" || buildingFunction === "office" || buildingFunction === "parking") {
    return "commercial";
  }
  if (buildingFunction === "industrial") return "industrial";
  if (buildingFunction === "recreation") return "park";
  return "civic";
}

function functionSuffix(buildingFunction: BuildingFunction): string {
  const names: Record<BuildingFunction, string> = {
    housing: "Residences",
    retail: "Market",
    office: "Center",
    university: "Hall",
    library: "Library",
    school: "School",
    clinic: "Health Center",
    culture: "Arts Center",
    recreation: "Recreation",
    parking: "Garage",
    industrial: "Works",
  };
  return names[buildingFunction];
}

function consumeVisualRandomness(rng: () => number, archetype: number): void {
  if ([3, 4, 5, 8, 11].includes(archetype)) {
    const units = 1 + Math.floor(rng() * 3);
    for (let index = 0; index < units * 5; index += 1) rng();
  } else if (archetype === 10) {
    rng();
  }
}

function nearLandmark(x: number, z: number, radius: number): boolean {
  return PENN_LANDMARKS.some((landmark) =>
    Math.hypot(longitudeToWorld(landmark.longitude) - x, latitudeToWorld(landmark.latitude) - z) < radius,
  );
}

function longitudeToWorld(longitude: number): number {
  return (longitude - PENN_CENTER.longitude) * METERS_PER_DEGREE_LONGITUDE;
}

function latitudeToWorld(latitude: number): number {
  return -(latitude - PENN_CENTER.latitude) * METERS_PER_DEGREE_LATITUDE;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}
