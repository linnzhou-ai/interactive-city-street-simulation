import type {
  Building,
  EconomyState,
  LandUseState,
  ZoneParcel,
  ZoneType,
} from "../models/types";

const MAX_GROWTH_SLOPE = 0.2;
const MIN_LAND_VALUE = 25;
const MAX_LAND_VALUE = 500;

const DEFAULT_ZONE_DEMAND: EconomyState["zoneDemand"] = {
  residential: 0.62,
  commercial: 0.58,
  industrial: 0.5,
};

export interface LandUseFactors {
  accessibility: number;
  transitProximity: number;
  jobsProximity: number;
  retailProximity: number;
  parkProximity: number;
  utilityReliability: number;
  congestion: number;
  pollution: number;
  noise: number;
  rentPressure: number;
}

export interface LandUseUpdateContext extends Partial<LandUseFactors> {
  zoneDemand?: Partial<EconomyState["zoneDemand"]>;
  zoningStrictness?: number;
  buildingFactors?: Record<string, Partial<LandUseFactors>>;
}

export interface LandUseSnapshot {
  landUse: LandUseState;
  buildings: Building[];
}

const DEFAULT_FACTORS: LandUseFactors = {
  accessibility: 0.7,
  transitProximity: 0.55,
  jobsProximity: 0.6,
  retailProximity: 0.6,
  parkProximity: 0.5,
  utilityReliability: 1,
  congestion: 0.25,
  pollution: 0.15,
  noise: 0.2,
  rentPressure: 0.5,
};

export function createInitialLandUse(): LandUseSnapshot {
  const parcels = createParcels();
  const buildings = createBuildings();
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const initializedParcels = parcels.map((parcel) => ({
    ...parcel,
    suitability: calculateZoningSuitability(
      parcel,
      parcel.buildingId ? buildingById.get(parcel.buildingId) : undefined,
    ),
  }));

  return {
    buildings,
    landUse: summarizeLandUse(initializedParcels, buildings, 0),
  };
}

export function calculateZoningSuitability(
  parcel: ZoneParcel,
  building: Building | undefined,
  context: LandUseUpdateContext = {},
): number {
  if (building && (building.zone !== parcel.zone || building.id !== parcel.buildingId)) {
    return 0;
  }

  const factors = resolveFactors(context, building?.id);
  const demand = zoneDemand(parcel.zone, context.zoneDemand);
  const terrainFitness = 1 - clamp01(parcel.terrainSlope / 0.3);
  const environment = 1 - clamp01((factors.pollution + factors.noise) / 2);
  const valueSignal = building ? clamp01(building.landValue / 260) : 0.5;
  const utilityService = building
    ? average([
        building.utilityService.power,
        building.utilityService.water,
        building.utilityService.waste,
        factors.utilityReliability,
      ])
    : factors.utilityReliability;
  const floorLimit = building
    ? building.floors < Math.min(building.maxFloors, parcel.maxFloors)
      ? 1
      : 0.35
    : 1;
  const strictnessPenalty = clamp01(context.zoningStrictness ?? 0.5) * 0.08;

  return clamp01(
    demand * 0.25 +
      clamp01(factors.accessibility) * 0.17 +
      clamp01(utilityService) * 0.18 +
      environment * 0.14 +
      terrainFitness * 0.12 +
      valueSignal * 0.09 +
      floorLimit * 0.05 -
      strictnessPenalty,
  );
}

export function calculateLandValue(
  building: Building,
  context: LandUseUpdateContext = {},
): number {
  const factors = resolveFactors(context, building.id);
  const demand = zoneDemand(building.zone, context.zoneDemand);
  const amenityScore =
    clamp01(factors.accessibility) * 0.2 +
    clamp01(factors.transitProximity) * 0.12 +
    clamp01(factors.jobsProximity) * 0.12 +
    clamp01(factors.retailProximity) * 0.1 +
    clamp01(factors.parkProximity) * 0.12 +
    clamp01(factors.utilityReliability) * 0.14 +
    demand * 0.1 +
    clamp01(factors.rentPressure) * 0.1;
  const externalityPenalty =
    clamp01(factors.congestion) * 0.12 +
    clamp01(Math.max(factors.pollution, building.pollution / 100)) * 0.18;
  const targetValue = clamp(
    40 + 300 * amenityScore - 220 * externalityPenalty,
    MIN_LAND_VALUE,
    MAX_LAND_VALUE,
  );

  return clamp(
    building.landValue + (targetValue - building.landValue) * 0.2,
    MIN_LAND_VALUE,
    MAX_LAND_VALUE,
  );
}

export function updateLandUse(
  landUse: LandUseState,
  buildings: readonly Building[],
  context: LandUseUpdateContext = {},
): LandUseSnapshot {
  const parcelsByBuilding = new Map(
    landUse.parcels
      .filter((parcel): parcel is ZoneParcel & { buildingId: string } =>
        Boolean(parcel.buildingId),
      )
      .map((parcel) => [parcel.buildingId, parcel]),
  );
  let growthEvents = 0;

  const updatedBuildings = buildings.map((building) => {
    const parcel = parcelsByBuilding.get(building.id);
    const valuedBuilding = {
      ...building,
      landValue: calculateLandValue(building, context),
    };

    if (!parcel) {
      return valuedBuilding;
    }

    const suitability = calculateZoningSuitability(parcel, valuedBuilding, context);
    if (!canAddFloor(parcel, valuedBuilding, suitability, context)) {
      return valuedBuilding;
    }

    growthEvents += 1;
    return addFloor(valuedBuilding);
  });
  const buildingById = new Map(
    updatedBuildings.map((building) => [building.id, building]),
  );
  const updatedParcels = landUse.parcels.map((parcel) => ({
    ...parcel,
    suitability: calculateZoningSuitability(
      parcel,
      parcel.buildingId ? buildingById.get(parcel.buildingId) : undefined,
      context,
    ),
  }));

  return {
    buildings: updatedBuildings,
    landUse: summarizeLandUse(
      updatedParcels,
      updatedBuildings,
      landUse.growthEvents + growthEvents,
    ),
  };
}

function canAddFloor(
  parcel: ZoneParcel,
  building: Building,
  suitability: number,
  context: LandUseUpdateContext,
): boolean {
  const floorLimit = Math.min(parcel.maxFloors, building.maxFloors);
  const threshold = 0.58 + clamp01(context.zoningStrictness ?? 0.5) * 0.12;

  return (
    parcel.zone === building.zone &&
    parcel.buildingId === building.id &&
    parcel.zone !== "park" &&
    parcel.terrainSlope <= MAX_GROWTH_SLOPE &&
    building.terrainSlope <= MAX_GROWTH_SLOPE &&
    building.floors < floorLimit &&
    zoneDemand(parcel.zone, context.zoneDemand) >= 0.6 &&
    average([
      building.utilityService.power,
      building.utilityService.water,
      building.utilityService.waste,
    ]) >= 0.7 &&
    suitability >= threshold
  );
}

function addFloor(building: Building): Building {
  const multiplier = (building.floors + 1) / building.floors;

  return {
    ...building,
    floors: building.floors + 1,
    rent: round(building.rent * 1.04),
    residentCapacity: Math.round(building.residentCapacity * multiplier),
    jobCapacity: Math.round(building.jobCapacity * multiplier),
    maximumJobCapacity: Math.round(
      (building.maximumJobCapacity ?? building.jobCapacity) * multiplier,
    ),
    productionRate: round(building.productionRate * multiplier),
    customerDemand: round(building.customerDemand * multiplier),
    utilityDemand: {
      power: round(building.utilityDemand.power * multiplier),
      water: round(building.utilityDemand.water * multiplier),
      waste: round(building.utilityDemand.waste * multiplier),
    },
  };
}

function summarizeLandUse(
  parcels: ZoneParcel[],
  buildings: readonly Building[],
  growthEvents: number,
): LandUseState {
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const developedFloorArea = parcels.reduce((total, parcel) => {
    const building = parcel.buildingId ? buildingById.get(parcel.buildingId) : undefined;
    return total + (building ? parcel.width * parcel.depth * building.floors : 0);
  }, 0);
  const permittedFloorArea = parcels.reduce(
    (total, parcel) => total + parcel.width * parcel.depth * parcel.maxFloors,
    0,
  );

  return {
    parcels,
    averageLandValue: round(average(buildings.map((building) => building.landValue))),
    growthEvents,
    developedFloorArea: round(developedFloorArea),
    permittedFloorArea: round(permittedFloorArea),
  };
}

function resolveFactors(
  context: LandUseUpdateContext,
  buildingId?: string,
): LandUseFactors {
  const local = buildingId ? context.buildingFactors?.[buildingId] : undefined;

  return {
    accessibility: normalized(local?.accessibility ?? context.accessibility, DEFAULT_FACTORS.accessibility),
    transitProximity: normalized(local?.transitProximity ?? context.transitProximity, DEFAULT_FACTORS.transitProximity),
    jobsProximity: normalized(local?.jobsProximity ?? context.jobsProximity, DEFAULT_FACTORS.jobsProximity),
    retailProximity: normalized(local?.retailProximity ?? context.retailProximity, DEFAULT_FACTORS.retailProximity),
    parkProximity: normalized(local?.parkProximity ?? context.parkProximity, DEFAULT_FACTORS.parkProximity),
    utilityReliability: normalized(local?.utilityReliability ?? context.utilityReliability, DEFAULT_FACTORS.utilityReliability),
    congestion: normalized(local?.congestion ?? context.congestion, DEFAULT_FACTORS.congestion),
    pollution: normalized(local?.pollution ?? context.pollution, DEFAULT_FACTORS.pollution),
    noise: normalized(local?.noise ?? context.noise, DEFAULT_FACTORS.noise),
    rentPressure: normalized(local?.rentPressure ?? context.rentPressure, DEFAULT_FACTORS.rentPressure),
  };
}

function zoneDemand(
  zone: ZoneType,
  demand: Partial<EconomyState["zoneDemand"]> | undefined,
): number {
  if (zone === "civic") {
    return 0.65;
  }
  if (zone === "park") {
    return 0.7;
  }
  return normalized(demand?.[zone], DEFAULT_ZONE_DEMAND[zone]);
}

function createParcels(): ZoneParcel[] {
  return [
    parcel("parcel-residential-northwest", "residential", -42, -38, 0.04, 4, "building-maple-apartments"),
    parcel("parcel-residential-west", "residential", -78, -38, 0.34, 2, "building-hill-homes"),
    parcel("parcel-residential-far-west", "residential", -114, -38, 0.09, 3, "building-river-terrace"),
    parcel("parcel-residential-northwest-inner", "residential", -42, -74, 0.05, 4, "building-cedar-court"),
    parcel("parcel-residential-northwest-outer", "residential", -78, -74, 0.08, 3, "building-juniper-homes"),
    parcel("parcel-residential-northwest-edge", "residential", -114, -74, 0.12, 3, "building-northgate-flats"),
    parcel("parcel-residential-southeast-inner", "residential", 42, 74, 0.04, 5, "building-station-lofts"),
    parcel("parcel-residential-southeast-middle", "residential", 78, 74, 0.07, 3, "building-garden-homes"),
    parcel("parcel-residential-southeast-edge", "residential", 114, 74, 0.1, 3, "building-southview-homes"),
    parcel("parcel-residential-southwest-inner", "residential", -42, 74, 0.06, 3, "building-willow-row"),
    parcel("parcel-commercial-northeast", "commercial", 42, -38, 0.03, 6, "building-market-hall"),
    parcel("parcel-commercial-east", "commercial", 78, -38, 0.11, 4, "building-corner-shops"),
    parcel("parcel-commercial-far-east", "commercial", 114, -38, 0.08, 4, "building-eastside-grocer"),
    parcel("parcel-commercial-north-inner", "commercial", 42, -74, 0.04, 5, "building-station-market"),
    parcel("parcel-commercial-north-east", "commercial", 78, -74, 0.06, 4, "building-riverfront-retail"),
    parcel("parcel-industrial-southeast", "industrial", 42, 38, 0.08, 4, "building-workshop"),
    parcel("parcel-industrial-east", "industrial", 78, 38, 0.17, 3, "building-distribution"),
    parcel("parcel-industrial-far-east", "industrial", 114, 38, 0.11, 3, "building-materials-depot"),
    parcel("parcel-industrial-north-east", "industrial", 114, -74, 0.13, 3, "building-food-works"),
    parcel("parcel-civic-southwest", "civic", -42, 38, 0.05, 5, "building-library"),
    parcel("parcel-civic-west", "civic", -78, 38, 0.06, 4, "building-community-school"),
    parcel("parcel-civic-far-west", "civic", -114, 38, 0.08, 4, "building-health-center"),
    parcel("parcel-park-southwest", "park", -42, 110, 0.12, 1, "building-park-pavilion"),
    parcel("parcel-park-west", "park", -78, 74, 0.09, 1, "building-river-park"),
  ];
}

function parcel(
  id: string,
  zone: ZoneType,
  x: number,
  z: number,
  terrainSlope: number,
  maxFloors: number,
  buildingId: string,
): ZoneParcel {
  return {
    id,
    zone,
    x,
    z,
    width: 30,
    depth: 26,
    terrainSlope,
    maxFloors,
    buildingId,
    suitability: 0,
  };
}

function createBuildings(): Building[] {
  return [
    building("building-maple-apartments", "Maple Apartments", "residential", -42, -38, 2, 4, 0.04, 148, 28, 36, 4, 24, 28, 12, 4),
    building("building-hill-homes", "Hill Homes", "residential", -78, -38, 1, 2, 0.34, 112, 16, 18, 2, 16, 19, 8, 3),
    building("building-river-terrace", "River Terrace", "residential", -114, -38, 2, 3, 0.09, 132, 22, 30, 2, 20, 24, 10, 3),
    building("building-cedar-court", "Cedar Court", "residential", -42, -74, 2, 4, 0.05, 154, 29, 28, 3, 22, 25, 11, 3),
    building("building-juniper-homes", "Juniper Homes", "residential", -78, -74, 1, 3, 0.08, 126, 20, 24, 2, 18, 21, 9, 2),
    building("building-northgate-flats", "Northgate Flats", "residential", -114, -74, 2, 3, 0.12, 118, 18, 26, 2, 19, 22, 9, 3),
    building("building-station-lofts", "Station Lofts", "residential", 42, 74, 3, 5, 0.04, 182, 35, 32, 4, 27, 30, 13, 3),
    building("building-garden-homes", "Garden Homes", "residential", 78, 74, 2, 3, 0.07, 142, 24, 24, 2, 19, 22, 9, 2),
    building("building-southview-homes", "Southview Homes", "residential", 114, 74, 2, 3, 0.1, 128, 21, 24, 2, 19, 22, 9, 3),
    building("building-willow-row", "Willow Row", "residential", -42, 74, 2, 3, 0.06, 146, 25, 28, 3, 21, 24, 10, 2),
    building("building-market-hall", "Market Hall", "commercial", 42, -38, 3, 6, 0.03, 196, 42, 0, 38, 46, 34, 18, 4),
    building("building-corner-shops", "Corner Shops", "commercial", 78, -38, 2, 4, 0.11, 164, 30, 0, 22, 32, 24, 12, 3),
    building("building-eastside-grocer", "Eastside Grocer", "commercial", 114, -38, 2, 4, 0.08, 158, 29, 0, 24, 34, 25, 13, 3),
    building("building-station-market", "Station Market", "commercial", 42, -74, 3, 5, 0.04, 184, 36, 0, 30, 40, 30, 15, 3),
    building("building-riverfront-retail", "Riverfront Retail", "commercial", 78, -74, 2, 4, 0.06, 172, 32, 0, 26, 36, 27, 14, 3),
    building("building-workshop", "Fabrication Workshop", "industrial", 42, 38, 2, 4, 0.08, 96, 24, 0, 32, 72, 52, 35, 58),
    building("building-distribution", "Local Distribution", "industrial", 78, 38, 1, 3, 0.17, 88, 20, 0, 24, 54, 38, 28, 45),
    building("building-materials-depot", "Materials Depot", "industrial", 114, 38, 2, 3, 0.11, 92, 22, 0, 28, 62, 45, 31, 50),
    building("building-food-works", "Food Works", "industrial", 114, -74, 2, 3, 0.13, 104, 23, 0, 26, 58, 42, 29, 38),
    building("building-library", "Neighborhood Library", "civic", -42, 38, 2, 5, 0.05, 176, 0, 0, 18, 34, 38, 15, 2),
    building("building-community-school", "Community School", "civic", -78, 38, 2, 4, 0.06, 168, 0, 0, 24, 40, 44, 18, 2),
    building("building-health-center", "Health Center", "civic", -114, 38, 2, 4, 0.08, 174, 0, 0, 20, 38, 42, 17, 3),
    building("building-park-pavilion", "Park Pavilion", "park", -42, 110, 1, 1, 0.12, 214, 0, 0, 3, 6, 8, 4, 0),
    building("building-river-park", "River Park", "park", -78, 74, 1, 1, 0.09, 224, 0, 0, 4, 7, 9, 4, 0),
  ];
}

function building(
  id: string,
  name: string,
  zone: ZoneType,
  x: number,
  z: number,
  floors: number,
  maxFloors: number,
  terrainSlope: number,
  landValue: number,
  rent: number,
  residentCapacity: number,
  jobCapacity: number,
  power: number,
  water: number,
  waste: number,
  pollution: number,
): Building {
  return {
    id,
    name,
    zone,
    buildingUse: zone === "residential"
      ? "housing"
      : zone === "commercial"
        ? "retail"
        : zone === "industrial"
          ? "industrial"
          : zone === "park"
            ? "park"
            : id.includes("school")
              ? "school"
              : id.includes("health")
                ? "clinic"
                : "library",
    x,
    z,
    floors,
    maxFloors,
    terrainSlope,
    landValue,
    rent,
    residentCapacity,
    residentIds: [],
    jobCapacity,
    employeeIds: [],
    goodsInventory: zone === "commercial" ? 70 : zone === "industrial" ? 35 : 0,
    productionRate: zone === "industrial" ? 18 : 0,
    customerDemand: zone === "commercial" ? 14 : 0,
    utilityDemand: { power, water, waste },
    utilityService: { power: 1, water: 1, waste: 1 },
    efficiency: 1,
    pollution,
    wasteStored: 0,
  };
}

function normalized(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? clamp01(value as number) : fallback;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
