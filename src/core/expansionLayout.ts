import type {
  BuildingKind,
  ExpansionRoad,
  PlacedBuilding,
} from "../models/types";

export const EXPANSION_GRID_SIZE = 20;
export const EXPANSION_WORLD_LIMIT = 2_400;
const ROAD_SNAP_DISTANCE = 28;
const MAX_PARCEL_DISTANCE = 110;

export interface LayoutPoint {
  x: number;
  z: number;
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadProjection extends LayoutPoint {
  road: ExpansionRoad;
  distance: number;
  progress: number;
}

export interface RoadJunction extends LayoutPoint {
  radius: number;
  connections: number;
}

export interface RoadGeometry {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  width: number;
}

export interface RoadInterval {
  start: number;
  end: number;
}

export interface BuildingGeometry {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

export function expansionBuildingSize(
  kind: BuildingKind,
): { width: number; depth: number } {
  if (kind === "industrial") return { width: 34, depth: 26 };
  if (kind === "commercial") return { width: 24, depth: 24 };
  if (kind === "civic") return { width: 30, depth: 24 };
  return { width: 22, depth: 20 };
}

export function expansionBuildingFootprint(
  building: Readonly<PlacedBuilding>,
  padding = 3,
): LayoutBounds {
  const size = expansionBuildingSize(building.kind);
  const quarterTurn = Math.abs(Math.sin(building.rotation))
    > Math.abs(Math.cos(building.rotation));
  const width = quarterTurn ? size.depth : size.width;
  const depth = quarterTurn ? size.width : size.depth;
  return {
    minX: building.x - width / 2 - padding,
    maxX: building.x + width / 2 + padding,
    minZ: building.z - depth / 2 - padding,
    maxZ: building.z + depth / 2 + padding,
  };
}

export function resolveRoadsideBuilding(
  building: Readonly<PlacedBuilding>,
  roads: readonly ExpansionRoad[],
  isValid: (candidate: Readonly<PlacedBuilding>) => boolean,
): PlacedBuilding | null {
  const nearbyRoads = roads
    .map((road) => projectPointToRoad(road, building.x, building.z))
    .filter((projection) => projection.distance <= MAX_PARCEL_DISTANCE)
    .sort((left, right) => left.distance - right.distance);
  for (const nearest of nearbyRoads) {
    const horizontal = Math.abs(nearest.road.endX - nearest.road.startX)
      >= Math.abs(nearest.road.endZ - nearest.road.startZ);
    const rotation = horizontal ? 0 : Math.PI / 2;
    const size = expansionBuildingSize(building.kind);
    const normalHalfSize = size.depth / 2;
    const sidewalkWidth = nearest.road.widenedSidewalk ? 5.5 : 3.5;
    const parcelOffset = snapUp(
      nearest.road.width / 2 + sidewalkWidth + normalHalfSize + 5,
      EXPANSION_GRID_SIZE / 2,
    );
    const normalX = horizontal ? 0 : 1;
    const normalZ = horizontal ? 1 : 0;
    const sideSignal = (building.x - nearest.x) * normalX
      + (building.z - nearest.z) * normalZ;
    const preferredSide = sideSignal < 0 ? -1 : 1;
    const alongX = horizontal ? 1 : 0;
    const alongZ = horizontal ? 0 : 1;
    const snappedAlong = horizontal ? snap(nearest.x) : snap(nearest.z);
    const roadCenter = horizontal
      ? { x: snappedAlong, z: nearest.z }
      : { x: nearest.x, z: snappedAlong };
    const roadLength = Math.hypot(
      nearest.road.endX - nearest.road.startX,
      nearest.road.endZ - nearest.road.startZ,
    );
    const alongOffsets = [0];
    for (let step = 1; step <= Math.ceil(roadLength / EXPANSION_GRID_SIZE); step += 1) {
      alongOffsets.push(step, -step);
    }
    for (const offset of alongOffsets) {
      for (const side of [preferredSide, -preferredSide]) {
        const candidate: PlacedBuilding = {
          ...building,
          rotation,
          x: roadCenter.x
            + normalX * parcelOffset * side
            + alongX * offset * EXPANSION_GRID_SIZE,
          z: roadCenter.z
            + normalZ * parcelOffset * side
            + alongZ * offset * EXPANSION_GRID_SIZE,
        };
        if (
          isBuildingRoadAdjacent(candidate, [nearest.road])
          && isValid(candidate)
        ) return candidate;
      }
    }
  }
  return null;
}

export function isBuildingRoadAdjacent(
  building: Readonly<PlacedBuilding>,
  roads: readonly ExpansionRoad[],
): boolean {
  const nearest = roads
    .map((road) => projectPointToRoad(road, building.x, building.z))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest) return false;
  const horizontal = Math.abs(nearest.road.endX - nearest.road.startX)
    >= Math.abs(nearest.road.endZ - nearest.road.startZ);
  const size = expansionBuildingSize(building.kind);
  const normalHalf = horizontal
    ? Math.abs(Math.sin(building.rotation)) > Math.abs(Math.cos(building.rotation))
      ? size.width / 2 : size.depth / 2
    : Math.abs(Math.sin(building.rotation)) > Math.abs(Math.cos(building.rotation))
      ? size.depth / 2 : size.width / 2;
  const sidewalkWidth = nearest.road.widenedSidewalk ? 5.5 : 3.5;
  const minimum = nearest.road.width / 2 + sidewalkWidth + normalHalf + 2;
  const maximum = minimum + EXPANSION_GRID_SIZE * 0.85;
  return nearest.distance >= minimum && nearest.distance <= maximum;
}

export function snapRoadPoint(
  x: number,
  z: number,
  roads: readonly RoadGeometry[],
): LayoutPoint {
  const gridPoint = { x: snap(x), z: snap(z) };
  const endpoints = roads.flatMap((road) => [
    { x: road.startX, z: road.startZ },
    { x: road.endX, z: road.endZ },
  ]).sort((left, right) =>
    Math.hypot(left.x - x, left.z - z) - Math.hypot(right.x - x, right.z - z)
  );
  const endpoint = endpoints[0];
  if (endpoint && Math.hypot(endpoint.x - x, endpoint.z - z) <= ROAD_SNAP_DISTANCE) {
    return endpoint;
  }
  const projection = roads
    .map((road) => projectPointToRoadGeometry(road, x, z))
    .sort((left, right) => left.distance - right.distance)[0];
  if (projection && projection.distance <= ROAD_SNAP_DISTANCE) {
    const horizontal = Math.abs(projection.road.endX - projection.road.startX)
      >= Math.abs(projection.road.endZ - projection.road.startZ);
    return horizontal
      ? { x: snap(projection.x), z: projection.z }
      : { x: projection.x, z: snap(projection.z) };
  }
  return gridPoint;
}

export function roadCorridorsOverlap(
  left: Readonly<RoadGeometry>,
  right: Readonly<RoadGeometry>,
): boolean {
  const leftHorizontal = isHorizontalRoad(left);
  const rightHorizontal = isHorizontalRoad(right);
  if (leftHorizontal !== rightHorizontal) return false;
  const normalDistance = leftHorizontal
    ? Math.abs(left.startZ - right.startZ)
    : Math.abs(left.startX - right.startX);
  if (normalDistance >= (left.width + right.width) / 2 - 0.1) return false;
  const [leftStart, leftEnd] = roadInterval(left, leftHorizontal);
  const [rightStart, rightEnd] = roadInterval(right, rightHorizontal);
  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0.5;
}

export function roadIntersectsBuilding(
  road: Readonly<RoadGeometry>,
  building: Readonly<BuildingGeometry>,
  padding = 2,
): boolean {
  const cosine = Math.cos(building.rotation);
  const sine = Math.sin(building.rotation);
  const halfX =
    Math.abs(cosine) * building.width / 2
    + Math.abs(sine) * building.depth / 2
    + padding;
  const halfZ =
    Math.abs(sine) * building.width / 2
    + Math.abs(cosine) * building.depth / 2
    + padding;
  const roadPadding = road.width / 2;
  const roadMinX = Math.min(road.startX, road.endX) - roadPadding;
  const roadMaxX = Math.max(road.startX, road.endX) + roadPadding;
  const roadMinZ = Math.min(road.startZ, road.endZ) - roadPadding;
  const roadMaxZ = Math.max(road.startZ, road.endZ) + roadPadding;
  return roadMinX < building.x + halfX
    && roadMaxX > building.x - halfX
    && roadMinZ < building.z + halfZ
    && roadMaxZ > building.z - halfZ;
}

export function projectPointToRoad(
  road: Readonly<ExpansionRoad>,
  x: number,
  z: number,
): RoadProjection {
  const dx = road.endX - road.startX;
  const dz = road.endZ - road.startZ;
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0
    ? 0
    : clamp(((x - road.startX) * dx + (z - road.startZ) * dz) / lengthSquared, 0, 1);
  const projectedX = road.startX + dx * progress;
  const projectedZ = road.startZ + dz * progress;
  return {
    road: { ...road },
    x: projectedX,
    z: projectedZ,
    progress,
    distance: Math.hypot(x - projectedX, z - projectedZ),
  };
}

export function roadJunctions(roads: readonly ExpansionRoad[]): RoadJunction[] {
  const candidates: RoadJunction[] = [];
  const add = (
    x: number,
    z: number,
    radius: number,
    connections = 1,
  ): void => {
    const existing = candidates.find((candidate) =>
      Math.hypot(candidate.x - x, candidate.z - z) < 2
    );
    if (existing) {
      existing.radius = Math.max(existing.radius, radius);
      existing.connections += connections;
      return;
    }
    candidates.push({ x, z, radius, connections });
  };
  for (const road of roads) {
    add(road.startX, road.startZ, road.width / 2);
    add(road.endX, road.endZ, road.width / 2);
  }
  for (let leftIndex = 0; leftIndex < roads.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < roads.length; rightIndex += 1) {
      const intersection = roadIntersection(roads[leftIndex], roads[rightIndex]);
      if (intersection) {
        add(
          intersection.x,
          intersection.z,
          Math.max(roads[leftIndex].width, roads[rightIndex].width) / 2,
          2,
        );
      }
    }
  }
  return candidates.filter((candidate) => candidate.connections >= 2);
}

export function visibleRoadIntervals(
  length: number,
  blockedIntervals: readonly RoadInterval[],
): RoadInterval[] {
  const blocked = blockedIntervals
    .map((interval) => ({
      start: clamp(Math.min(interval.start, interval.end), 0, length),
      end: clamp(Math.max(interval.start, interval.end), 0, length),
    }))
    .filter((interval) => interval.end - interval.start > 0.01)
    .sort((left, right) => left.start - right.start);
  const merged: RoadInterval[] = [];
  for (const interval of blocked) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + 0.01) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  const visible: RoadInterval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start - cursor > 0.01) {
      visible.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (length - cursor > 0.01) {
    visible.push({ start: cursor, end: length });
  }
  return visible;
}

function roadIntersection(
  left: Readonly<ExpansionRoad>,
  right: Readonly<ExpansionRoad>,
): LayoutPoint | null {
  const leftHorizontal = Math.abs(left.endX - left.startX)
    >= Math.abs(left.endZ - left.startZ);
  const rightHorizontal = Math.abs(right.endX - right.startX)
    >= Math.abs(right.endZ - right.startZ);
  if (leftHorizontal === rightHorizontal) return null;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const x = vertical.startX;
  const z = horizontal.startZ;
  return x >= Math.min(horizontal.startX, horizontal.endX) - 0.1
    && x <= Math.max(horizontal.startX, horizontal.endX) + 0.1
    && z >= Math.min(vertical.startZ, vertical.endZ) - 0.1
    && z <= Math.max(vertical.startZ, vertical.endZ) + 0.1
    ? { x, z }
    : null;
}

function isHorizontalRoad(road: Readonly<RoadGeometry>): boolean {
  return Math.abs(road.endX - road.startX)
    >= Math.abs(road.endZ - road.startZ);
}

function projectPointToRoadGeometry(
  road: Readonly<RoadGeometry>,
  x: number,
  z: number,
): {
  road: Readonly<RoadGeometry>;
  x: number;
  z: number;
  distance: number;
} {
  const dx = road.endX - road.startX;
  const dz = road.endZ - road.startZ;
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0
    ? 0
    : clamp(
        ((x - road.startX) * dx + (z - road.startZ) * dz) / lengthSquared,
        0,
        1,
      );
  const projectedX = road.startX + dx * progress;
  const projectedZ = road.startZ + dz * progress;
  return {
    road,
    x: projectedX,
    z: projectedZ,
    distance: Math.hypot(x - projectedX, z - projectedZ),
  };
}

function roadInterval(
  road: Readonly<RoadGeometry>,
  horizontal: boolean,
): readonly [number, number] {
  const start = horizontal ? road.startX : road.startZ;
  const end = horizontal ? road.endX : road.endZ;
  return [Math.min(start, end), Math.max(start, end)];
}

function snap(value: number): number {
  return Math.round(value / EXPANSION_GRID_SIZE) * EXPANSION_GRID_SIZE;
}

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
