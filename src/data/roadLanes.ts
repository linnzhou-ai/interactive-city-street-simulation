import {
  PENN_AVENUES,
  PENN_ROAD_GRAPH,
  PENN_STREETS,
} from "./pennRoadGraph";
import type {
  DistrictFeature,
  LaneDirection,
  VehicleKind,
} from "../models/types";

export type RoadClass =
  | "major-arterial"
  | "collector"
  | "local"
  | "pedestrian-heavy";
export type RoadLaneType =
  | "general"
  | "turn"
  | "parking"
  | "bike"
  | "bus";
export type LaneTravelDirection = "forward" | "reverse";
export type LaneMovement = "left" | "straight" | "right";

export interface RoadLane {
  id: string;
  parentSegmentId: string;
  type: RoadLaneType;
  direction: LaneTravelDirection;
  widthMeters: number;
  indexFromCurb: number;
  offsetMeters: number;
  allowedMovements: readonly LaneMovement[];
  spawnAllowed: boolean;
  parkingAllowed: boolean;
  bikeAllowed: boolean;
}

export interface RoadSegmentModel {
  id: string;
  streetName: string;
  roadClass: RoadClass;
  directionality: LaneDirection;
  totalWidthMeters: number;
  speedLimitMph: number;
  allowedTurnsAtStart: readonly LaneMovement[];
  allowedTurnsAtEnd: readonly LaneMovement[];
  lanes: readonly RoadLane[];
  travelLaneCount: number;
  demandWeight: number;
}

export interface LaneModelOverrides {
  laneDelta?: -1 | 0 | 1;
  bikeLane?: boolean;
  laneDirection?: LaneDirection;
}

const MAJOR_NAMES = new Set([
  "Market Street",
  "South Street",
  "38th Street",
  "40th Street",
]);
const COLLECTOR_NAMES = new Set([
  "Chestnut Street",
  "Walnut Street",
  "Spruce Street",
  "Baltimore Avenue",
  "34th Street",
  "36th Street",
  "42nd Street",
]);
const PEDESTRIAN_HEAVY_NAMES = new Set(["Sansom Street", "Spruce Street"]);
const BASE_BIKE_NAMES = new Set(["Spruce Street", "Baltimore Avenue"]);
const ONE_WAY_DIRECTIONS = new Map<string, LaneTravelDirection>([
  ["Chestnut Street", "forward"],
  ["Walnut Street", "reverse"],
  ["Sansom Street", "forward"],
]);

export const ROAD_SEGMENTS: readonly RoadSegmentModel[] = PENN_ROAD_GRAPH.filter(
  (feature) => feature.kind === "street",
).map((feature) => createRoadSegmentModel(feature));

export const ROAD_SEGMENT_BY_ID = new Map(
  ROAD_SEGMENTS.map((segment) => [segment.id, segment]),
);

export function createRoadSegmentModel(
  feature: DistrictFeature,
  overrides: Readonly<LaneModelOverrides> = {},
): RoadSegmentModel {
  if (feature.kind !== "street") {
    throw new Error(`Lane data requires a street segment: ${feature.id}`);
  }
  const roadClass = classifyRoad(feature.name);
  const configuredOneWay = ONE_WAY_DIRECTIONS.get(feature.name);
  const directionality =
    overrides.laneDirection ??
    (configuredOneWay ?? "two-way");
  const laneDelta = overrides.laneDelta ?? 0;
  const hasBikeLane =
    overrides.bikeLane ?? BASE_BIKE_NAMES.has(feature.name);
  const lanes =
    directionality === "two-way"
      ? createTwoWayLanes(
          feature.id,
          roadClass,
          laneDelta,
          hasBikeLane,
          feature.name,
        )
      : createOneWayLanes(
          feature.id,
          directionality,
          roadClass,
          laneDelta,
          hasBikeLane,
        );
  const widestOffset = lanes.reduce(
    (maximum, lane) =>
      Math.max(maximum, Math.abs(lane.offsetMeters) + lane.widthMeters / 2),
    0,
  );
  const baseWidth = roadClass === "major-arterial" ? 22 : 15;
  return {
    id: feature.id,
    streetName: feature.name,
    roadClass,
    directionality,
    totalWidthMeters: Math.max(baseWidth, widestOffset * 2 + 0.8),
    speedLimitMph:
      roadClass === "major-arterial"
        ? 30
        : roadClass === "collector"
          ? 25
          : roadClass === "pedestrian-heavy"
            ? 15
            : 20,
    allowedTurnsAtStart: ["left", "straight", "right"],
    allowedTurnsAtEnd: ["left", "straight", "right"],
    lanes,
    travelLaneCount: lanes.filter(isDrivableLane).length,
    demandWeight:
      roadClass === "major-arterial"
        ? 3
        : roadClass === "collector"
          ? 1.9
          : roadClass === "pedestrian-heavy"
            ? 1.25
            : 0.85,
  };
}

export function segmentIdBetween(
  startColumn: number,
  startRow: number,
  endColumn: number,
  endRow: number,
): string {
  if (startRow === endRow && Math.abs(startColumn - endColumn) === 1) {
    const minimumColumn = Math.min(startColumn, endColumn);
    return `${PENN_STREETS[startRow].slug}-${PENN_AVENUES[minimumColumn].short}-${PENN_AVENUES[minimumColumn + 1].short}`;
  }
  if (startColumn === endColumn && Math.abs(startRow - endRow) === 1) {
    const minimumRow = Math.min(startRow, endRow);
    return `${PENN_AVENUES[startColumn].short}-${PENN_STREETS[minimumRow].slug}-${PENN_STREETS[minimumRow + 1].slug}`;
  }
  throw new Error(
    `Road nodes are not adjacent: ${startColumn},${startRow} → ${endColumn},${endRow}`,
  );
}

export function travelDirectionBetween(
  startColumn: number,
  startRow: number,
  endColumn: number,
  endRow: number,
): LaneTravelDirection {
  return endColumn > startColumn || endRow > startRow
    ? "forward"
    : "reverse";
}

export function chooseLane(
  segment: Readonly<RoadSegmentModel>,
  direction: LaneTravelDirection,
  movement: LaneMovement,
  vehicleKind: VehicleKind,
  choice: number,
): RoadLane | undefined {
  let candidates = segment.lanes.filter(
    (lane) =>
      isDrivableLane(lane) &&
      lane.direction === direction &&
      lane.allowedMovements.includes(movement) &&
      lane.spawnAllowed,
  );
  if (vehicleKind === "bus") {
    const busLanes = candidates.filter((lane) => lane.type === "bus");
    if (busLanes.length > 0) candidates = busLanes;
  } else {
    const generalLanes = candidates.filter((lane) => lane.type !== "bus");
    if (generalLanes.length > 0) candidates = generalLanes;
  }
  if (candidates.length === 0) {
    candidates = segment.lanes.filter(
      (lane) =>
        isDrivableLane(lane) &&
        lane.direction === direction &&
        lane.spawnAllowed,
    );
  }
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(choice * candidates.length) % candidates.length];
}

export function isDrivableLane(lane: Readonly<RoadLane>): boolean {
  return lane.type === "general" || lane.type === "turn" || lane.type === "bus";
}

function classifyRoad(name: string): RoadClass {
  if (MAJOR_NAMES.has(name)) return "major-arterial";
  if (PEDESTRIAN_HEAVY_NAMES.has(name)) return "pedestrian-heavy";
  if (COLLECTOR_NAMES.has(name)) return "collector";
  return "local";
}

function createTwoWayLanes(
  segmentId: string,
  roadClass: RoadClass,
  laneDelta: -1 | 0 | 1,
  bikeLane: boolean,
  streetName: string,
): RoadLane[] {
  const major = roadClass === "major-arterial";
  const generalPerDirection = Math.max(1, (major ? 2 : 1) + laneDelta);
  const hasTurnLanes = major && generalPerDirection >= 2;
  const laneWidth = major ? 3.25 : 3.1;
  const lanes: RoadLane[] = [];
  for (const direction of ["forward", "reverse"] as const) {
    const side = direction === "forward" ? 1 : -1;
    if (hasTurnLanes) {
      lanes.push(
        lane(
          segmentId,
          "turn",
          direction,
          3,
          0,
          side * 1.35,
          ["left"],
        ),
      );
    }
    const centerOffset = hasTurnLanes ? 4.45 : laneWidth / 2 + 0.35;
    for (let index = 0; index < generalPerDirection; index += 1) {
      const curbIndex = generalPerDirection - index - 1;
      const type =
        streetName === "Market Street" &&
        index === generalPerDirection - 1 &&
        generalPerDirection > 1
          ? "bus"
          : "general";
      lanes.push(
        lane(
          segmentId,
          type,
          direction,
          laneWidth,
          curbIndex,
          side * (centerOffset + index * laneWidth),
          movementsForLane(index, generalPerDirection),
        ),
      );
    }
  }
  const outerOffset = lanes.reduce(
    (maximum, item) => Math.max(maximum, Math.abs(item.offsetMeters)),
    0,
  );
  if (bikeLane) {
    for (const direction of ["forward", "reverse"] as const) {
      const side = direction === "forward" ? 1 : -1;
      lanes.push(
        lane(
          segmentId,
          "bike",
          direction,
          1.8,
          0,
          side * (outerOffset + 2.6),
          ["straight"],
          false,
        ),
      );
    }
  } else if (!major) {
    for (const direction of ["forward", "reverse"] as const) {
      const side = direction === "forward" ? 1 : -1;
      lanes.push(
        lane(
          segmentId,
          "parking",
          direction,
          2.25,
          0,
          side * (outerOffset + 2.75),
          [],
          false,
        ),
      );
    }
  }
  return lanes;
}

function createOneWayLanes(
  segmentId: string,
  directionality: Exclude<LaneDirection, "two-way">,
  roadClass: RoadClass,
  laneDelta: -1 | 0 | 1,
  bikeLane: boolean,
): RoadLane[] {
  const direction: LaneTravelDirection = directionality;
  const travelLaneCount = Math.max(1, 2 + laneDelta);
  const laneWidth = roadClass === "pedestrian-heavy" ? 3 : 3.15;
  const lanes: RoadLane[] = [];
  for (let index = 0; index < travelLaneCount; index += 1) {
    const offset =
      (index - (travelLaneCount - 1) / 2) * laneWidth;
    lanes.push(
      lane(
        segmentId,
        "general",
        direction,
        laneWidth,
        travelLaneCount - index - 1,
        offset,
        movementsForLane(index, travelLaneCount),
      ),
    );
  }
  const outerOffset =
    ((travelLaneCount - 1) / 2) * laneWidth + laneWidth / 2;
  if (bikeLane) {
    lanes.push(
      lane(
        segmentId,
        "bike",
        direction,
        1.8,
        0,
        outerOffset + 1.2,
        ["straight"],
        false,
      ),
    );
  }
  for (const side of [-1, 1]) {
    lanes.push(
      lane(
        segmentId,
        "parking",
        direction,
        2.2,
        0,
        side * (outerOffset + 1.6),
        [],
        false,
      ),
    );
  }
  return lanes;
}

function lane(
  parentSegmentId: string,
  type: RoadLaneType,
  direction: LaneTravelDirection,
  widthMeters: number,
  indexFromCurb: number,
  offsetMeters: number,
  allowedMovements: readonly LaneMovement[],
  spawnAllowed = true,
): RoadLane {
  return {
    id: `${parentSegmentId}:${direction}:${type}:${indexFromCurb}:${offsetMeters.toFixed(2)}`,
    parentSegmentId,
    type,
    direction,
    widthMeters,
    indexFromCurb,
    offsetMeters,
    allowedMovements,
    spawnAllowed,
    parkingAllowed: type === "parking",
    bikeAllowed: type === "bike",
  };
}

function movementsForLane(
  indexFromCenter: number,
  laneCount: number,
): readonly LaneMovement[] {
  if (laneCount === 1) return ["left", "straight", "right"];
  if (indexFromCenter === 0) return ["left", "straight"];
  if (indexFromCenter === laneCount - 1) return ["straight", "right"];
  return ["straight"];
}
