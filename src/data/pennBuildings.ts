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
const BLOCK_EDGE_CLEARANCE = 18;
const BUILDING_GAP = 4;
const LANDMARK_GAP = 6;

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

const LANDMARK_BUILDINGS = createLandmarkBuildings();

export const PENN_BUILDINGS: readonly EntityBuildingDefinition[] = [
  ...createBlockBuildings(LANDMARK_BUILDINGS),
  ...LANDMARK_BUILDINGS,
];

function createBlockBuildings(
  landmarks: readonly EntityBuildingDefinition[],
): EntityBuildingDefinition[] {
  const buildings: EntityBuildingDefinition[] = [];
  const rng = seededRandom(20260727);
  let buildingNumber = 1;
  let infillNumber = 1;
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
      if (blockWidth < 22 || blockDepth < 22) continue;

      const minX = Math.min(west, east) + BLOCK_EDGE_CLEARANCE;
      const maxX = Math.max(west, east) - BLOCK_EDGE_CLEARANCE;
      const minZ = Math.min(north, south) + BLOCK_EDGE_CLEARANCE;
      const maxZ = Math.max(north, south) - BLOCK_EDGE_CLEARANCE;

      const core = Math.hypot(blockX, blockZ) < 760;
      const fillsLandmarkGap = nearLandmark(blockX, blockZ, 80);
      const blockRng = fillsLandmarkGap
        ? seededRandom(20260727 + avenueIndex * 100 + streetIndex)
        : rng;
      const count = core
        ? 2 + Math.floor(blockRng() * 3)
        : 1 + Math.floor(blockRng() * 2);
      const blockLandmarks = landmarks.filter((landmark) =>
        landmark.x > Math.min(west, east)
        && landmark.x < Math.max(west, east)
        && landmark.z > Math.min(north, south)
        && landmark.z < Math.max(north, south));
      for (let index = 0; index < count; index += 1) {
        const cellWidth = blockWidth / count;
        const width = Math.max(18, cellWidth * (0.58 + blockRng() * 0.28));
        const depth = Math.max(20, blockDepth * (0.55 + blockRng() * 0.28));
        const rawX = blockX - blockWidth / 2 + cellWidth * (index + 0.5)
          + (blockRng() - 0.5) * cellWidth * 0.18;
        const rawZ = blockZ + (blockRng() - 0.5) * blockDepth * 0.2;
        const generatedArchetype = Math.floor(blockRng() * 12);
        const archetype = fillsLandmarkGap ? 9 : generatedArchetype;
        const rotation = (blockRng() - 0.5) * 0.06;
        const footprint = rotatedFootprint(width, depth, rotation);
        const x = clamp(
          rawX,
          minX + footprint.halfX,
          maxX - footprint.halfX,
        );
        const z = clamp(
          rawZ,
          minZ + footprint.halfZ,
          maxZ - footprint.halfZ,
        );
        const height = core ? 18 + blockRng() * 48 : 14 + blockRng() * 78;
        const buildingFunction = fillsLandmarkGap
          ? "parking"
          : FUNCTION_BY_ARCHETYPE[archetype] ?? "office";
        const street = PENN_STREETS[streetIndex];
        const avenue = PENN_AVENUES[avenueIndex];
        const suffix = functionSuffix(buildingFunction);
        const candidate: EntityBuildingDefinition = {
          id: `penn-block-${avenueIndex}-${streetIndex}-${index}`,
          name: `${avenue.short} ${street.name.replace(" Street", "")} ${suffix}`,
          address: `${3000 + (fillsLandmarkGap ? infillNumber : buildingNumber) * 7} ${street.name}`,
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
          visualSeed: fillsLandmarkGap
            ? 95_000 + infillNumber
            : 85_000 + buildingNumber,
        };
        const fittedCandidate = fillsLandmarkGap
          ? fitAroundLandmarks(candidate, blockLandmarks, minZ, maxZ)
          : candidate;
        if (fittedCandidate) {
          buildings.push(fittedCandidate);
          if (fillsLandmarkGap) infillNumber += 1;
          else buildingNumber += 1;
        }
        consumeVisualRandomness(blockRng, generatedArchetype);
      }
    }
  }
  return buildings;
}

function createLandmarkBuildings(): EntityBuildingDefinition[] {
  return PENN_LANDMARKS.map((landmark, index) => {
    const [requestedWidth, requestedDepth, height] = LANDMARK_SIZES[landmark.kind];
    const buildingFunction = LANDMARK_FUNCTIONS[landmark.kind];
    const requestedX = longitudeToWorld(landmark.longitude);
    const requestedZ = latitudeToWorld(landmark.latitude);
    const bounds = containingBlockBounds(requestedX, requestedZ);
    const width = Math.min(
      requestedWidth,
      bounds.maxX - bounds.minX - BLOCK_EDGE_CLEARANCE * 2,
    );
    const depth = Math.min(
      requestedDepth,
      bounds.maxZ - bounds.minZ - BLOCK_EDGE_CLEARANCE * 2,
    );
    const x = clamp(
      requestedX,
      bounds.minX + BLOCK_EDGE_CLEARANCE + width / 2,
      bounds.maxX - BLOCK_EDGE_CLEARANCE - width / 2,
    );
    const z = clamp(
      requestedZ,
      bounds.minZ + BLOCK_EDGE_CLEARANCE + depth / 2,
      bounds.maxZ - BLOCK_EDGE_CLEARANCE - depth / 2,
    );
    return {
      id: `penn-landmark-${landmark.kind}`,
      name: landmark.name,
      address: "University of Pennsylvania",
      source: "landmark",
      landmarkKind: landmark.kind,
      function: buildingFunction,
      zone: zoneForFunction(buildingFunction),
      x,
      z,
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
    Math.hypot(
      longitudeToWorld(landmark.longitude) - x,
      latitudeToWorld(landmark.latitude) - z,
    ) < radius);
}

function containingBlockBounds(
  x: number,
  z: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const avenuePositions = PENN_AVENUES.map((avenue) =>
    longitudeToWorld(avenue.longitude));
  const streetPositions = PENN_STREETS.map((street) =>
    latitudeToWorld(street.latitude));
  const xBounds = containingBounds(x, avenuePositions);
  const zBounds = containingBounds(z, streetPositions);
  if (!xBounds || !zBounds) {
    throw new Error("Penn landmark is outside the generated street grid.");
  }
  return {
    minX: xBounds.min,
    maxX: xBounds.max,
    minZ: zBounds.min,
    maxZ: zBounds.max,
  };
}

function containingBounds(
  value: number,
  positions: readonly number[],
): { min: number; max: number } | null {
  for (let index = 0; index < positions.length - 1; index += 1) {
    const min = Math.min(positions[index], positions[index + 1]);
    const max = Math.max(positions[index], positions[index + 1]);
    if (value > min && value < max) return { min, max };
  }
  return null;
}

function rotatedFootprint(
  width: number,
  depth: number,
  rotation: number,
): { halfX: number; halfZ: number } {
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  return {
    halfX: (width * cosine + depth * sine) / 2,
    halfZ: (width * sine + depth * cosine) / 2,
  };
}

function footprintsOverlap(
  a: Pick<EntityBuildingDefinition, "x" | "z" | "width" | "depth" | "rotation">,
  b: Pick<EntityBuildingDefinition, "x" | "z" | "width" | "depth" | "rotation">,
  clearance: number,
): boolean {
  const aFootprint = rotatedFootprint(a.width, a.depth, a.rotation);
  const bFootprint = rotatedFootprint(b.width, b.depth, b.rotation);
  return (
    Math.abs(a.x - b.x) < aFootprint.halfX + bFootprint.halfX + clearance
    && Math.abs(a.z - b.z) < aFootprint.halfZ + bFootprint.halfZ + clearance
  );
}

function fitAroundLandmarks(
  candidate: EntityBuildingDefinition,
  landmarks: readonly EntityBuildingDefinition[],
  minZ: number,
  maxZ: number,
): EntityBuildingDefinition | null {
  const obstacle = landmarks.find((landmark) =>
    footprintsOverlap(candidate, landmark, LANDMARK_GAP));
  if (!obstacle) return candidate;

  const obstacleFootprint = rotatedFootprint(
    obstacle.width,
    obstacle.depth,
    obstacle.rotation,
  );
  const gaps = [
    {
      min: minZ,
      max: obstacle.z - obstacleFootprint.halfZ - LANDMARK_GAP,
    },
    {
      min: obstacle.z + obstacleFootprint.halfZ + LANDMARK_GAP,
      max: maxZ,
    },
  ];
  const gap = gaps[1].max - gaps[1].min > gaps[0].max - gaps[0].min
    ? gaps[1]
    : gaps[0];
  const sine = Math.abs(Math.sin(candidate.rotation));
  const cosine = Math.abs(Math.cos(candidate.rotation));
  const maxDepth = (
    gap.max - gap.min - BUILDING_GAP - candidate.width * sine
  ) / Math.max(cosine, 0.01);
  if (maxDepth < 14) return null;

  const fitted = {
    ...candidate,
    depth: Math.min(candidate.depth, maxDepth),
    z: (gap.min + gap.max) / 2,
  };
  return landmarks.some((landmark) =>
    footprintsOverlap(fitted, landmark, LANDMARK_GAP))
    ? null
    : fitted;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
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
