import { describe, expect, it } from "vitest";
import {
  expansionBuildingFootprint,
  isBuildingRoadAdjacent,
  resolveRoadsideBuilding,
  roadCorridorsOverlap,
  roadIntersectsBuilding,
  roadJunctions,
  snapRoadPoint,
} from "../src/core/expansionLayout";
import type { ExpansionRoad, PlacedBuilding } from "../src/models/types";

const horizontalRoad: ExpansionRoad = {
  id: "road-horizontal",
  startX: 0,
  startZ: 0,
  endX: 200,
  endZ: 0,
  width: 16,
  laneDelta: 0,
  bikeLane: false,
  widenedSidewalk: false,
  laneDirection: "two-way",
};

function building(id: string, x: number, z: number): PlacedBuilding {
  return {
    id,
    kind: "residential",
    x,
    z,
    rotation: 0,
    floors: 3,
    color: "#ffffff",
  };
}

function overlaps(
  left: ReturnType<typeof expansionBuildingFootprint>,
  right: ReturnType<typeof expansionBuildingFootprint>,
): boolean {
  return left.minX < right.maxX
    && left.maxX > right.minX
    && left.minZ < right.maxZ
    && left.maxZ > right.minZ;
}

describe("expansion layout", () => {
  it("snaps buildings onto a gridded parcel beside the nearest road", () => {
    const resolved = resolveRoadsideBuilding(
      building("home-1", 83, 7),
      [horizontalRoad],
      () => true,
    );

    expect(resolved).not.toBeNull();
    expect(resolved).toMatchObject({ x: 80, z: 30, rotation: 0 });
    expect(isBuildingRoadAdjacent(resolved!, [horizontalRoad])).toBe(true);
  });

  it("uses the next open roadside parcel when the preferred parcel is occupied", () => {
    const first = resolveRoadsideBuilding(
      building("home-1", 80, 5),
      [horizontalRoad],
      () => true,
    )!;
    const second = resolveRoadsideBuilding(
      building("home-2", 80, 5),
      [horizontalRoad],
      (candidate) => !overlaps(
        expansionBuildingFootprint(candidate),
        expansionBuildingFootprint(first),
      ),
    );

    expect(second).not.toBeNull();
    expect({ x: second?.x, z: second?.z }).not.toEqual({ x: first.x, z: first.z });
    expect(isBuildingRoadAdjacent(second!, [horizontalRoad])).toBe(true);
  });

  it("does not move a building beyond the end of a short road", () => {
    const shortRoad = { ...horizontalRoad, endX: 40 };
    const occupiedParcels = [
      building("north-1", 0, 30),
      building("south-1", 0, -30),
      building("north-2", 20, 30),
      building("south-2", 20, -30),
      building("north-3", 40, 30),
      building("south-3", 40, -30),
    ];

    const resolved = resolveRoadsideBuilding(
      building("blocked", 20, 0),
      [shortRoad],
      (candidate) => occupiedParcels.every((occupied) => !overlaps(
        expansionBuildingFootprint(candidate),
        expansionBuildingFootprint(occupied),
      )),
    );

    expect(resolved).toBeNull();
  });

  it("rejects placement too far from the road network", () => {
    expect(resolveRoadsideBuilding(
      building("home-1", 80, 150),
      [horizontalRoad],
      () => true,
    )).toBeNull();
  });

  it("snaps road drawing to endpoints and centerlines", () => {
    expect(snapRoadPoint(205, 7, [horizontalRoad])).toEqual({ x: 200, z: 0 });
    expect(snapRoadPoint(94, 18, [horizontalRoad])).toEqual({ x: 100, z: 0 });
  });

  it("creates junction surfaces only where roads connect or cross", () => {
    const crossingRoad: ExpansionRoad = {
      ...horizontalRoad,
      id: "road-vertical",
      startX: 100,
      startZ: -100,
      endX: 100,
      endZ: 100,
    };

    expect(roadJunctions([horizontalRoad])).toEqual([]);
    expect(roadJunctions([horizontalRoad, crossingRoad])).toEqual([
      { x: 100, z: 0, radius: 8, connections: 2 },
    ]);
  });

  it("rejects duplicate road corridors but permits clean crossings and extensions", () => {
    expect(roadCorridorsOverlap(horizontalRoad, {
      ...horizontalRoad,
      startX: 80,
      endX: 240,
    })).toBe(true);
    expect(roadCorridorsOverlap(horizontalRoad, {
      ...horizontalRoad,
      startX: 200,
      endX: 320,
    })).toBe(false);
    expect(roadCorridorsOverlap(horizontalRoad, {
      ...horizontalRoad,
      startX: 100,
      startZ: -100,
      endX: 100,
      endZ: 100,
    })).toBe(false);
  });

  it("keeps roads out of standing buildings after allowing a demolished footprint", () => {
    const footprint = {
      x: 100,
      z: 0,
      width: 30,
      depth: 24,
      rotation: Math.PI / 8,
    };
    expect(roadIntersectsBuilding(horizontalRoad, footprint)).toBe(true);
    expect(roadIntersectsBuilding(
      { ...horizontalRoad, startZ: 60, endZ: 60 },
      footprint,
    )).toBe(false);
  });
});
