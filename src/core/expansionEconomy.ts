import type {
  BuildingFunction,
  EntityBuildingDefinition,
} from "../models/entityTypes";
import type {
  BuildingKind,
  PlacedBuilding,
} from "../models/types";

const DEFAULT_FUNCTIONS: Record<BuildingKind, BuildingFunction> = {
  residential: "housing",
  commercial: "retail",
  industrial: "industrial",
  civic: "library",
};

export function functionForPlacedBuilding(
  building: Pick<PlacedBuilding, "kind" | "function">,
): BuildingFunction {
  return building.function ?? DEFAULT_FUNCTIONS[building.kind];
}

export function buildingKindForFunction(
  buildingFunction: BuildingFunction,
): BuildingKind {
  if (buildingFunction === "housing") return "residential";
  if (["retail", "office", "parking"].includes(buildingFunction)) {
    return "commercial";
  }
  if (buildingFunction === "industrial") return "industrial";
  return "civic";
}

export function defaultFunctionForKind(kind: BuildingKind): BuildingFunction {
  return DEFAULT_FUNCTIONS[kind];
}

export function placedBuildingToDefinition(
  building: Readonly<PlacedBuilding>,
): EntityBuildingDefinition {
  const buildingFunction = functionForPlacedBuilding(building);
  const size = buildingSize(building.kind);
  return {
    id: building.id,
    name: expansionBuildingName(buildingFunction, building.id),
    address: `Expansion parcel ${buildingNumber(building.id)}`,
    source: "expansion",
    function: buildingFunction,
    zone: zoneForFunction(buildingFunction),
    x: building.x,
    z: building.z,
    width: size.width,
    depth: size.depth,
    height: Math.max(4, building.floors * 3.2),
    floors: building.floors,
    archetype: archetypeForFunction(buildingFunction),
    rotation: building.rotation,
    visualSeed: stableSeed(building.id),
  };
}

function buildingSize(kind: BuildingKind): { width: number; depth: number } {
  if (kind === "industrial") return { width: 34, depth: 26 };
  if (kind === "commercial") return { width: 24, depth: 24 };
  if (kind === "civic") return { width: 30, depth: 24 };
  return { width: 22, depth: 20 };
}

function zoneForFunction(
  buildingFunction: BuildingFunction,
): EntityBuildingDefinition["zone"] {
  if (buildingFunction === "housing") return "residential";
  if (buildingFunction === "industrial") return "industrial";
  if (["retail", "office", "parking"].includes(buildingFunction)) {
    return "commercial";
  }
  return "civic";
}

function archetypeForFunction(buildingFunction: BuildingFunction): number {
  const order: BuildingFunction[] = [
    "housing",
    "retail",
    "office",
    "industrial",
    "parking",
    "school",
    "library",
    "clinic",
    "culture",
    "recreation",
    "university",
  ];
  return Math.max(0, order.indexOf(buildingFunction));
}

function expansionBuildingName(
  buildingFunction: BuildingFunction,
  id: string,
): string {
  const labels: Record<BuildingFunction, string> = {
    housing: "Expansion Apartments",
    retail: "Neighborhood Market",
    office: "Expansion Offices",
    university: "Learning Center",
    library: "Community Library",
    school: "Neighborhood School",
    clinic: "Community Clinic",
    culture: "Arts Center",
    recreation: "Recreation Center",
    parking: "Mobility Garage",
    industrial: "Local Goods Works",
  };
  return `${labels[buildingFunction]} ${buildingNumber(id)}`;
}

function buildingNumber(id: string): string {
  return id.match(/\d+$/)?.[0] ?? id.slice(-4);
}

function stableSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
