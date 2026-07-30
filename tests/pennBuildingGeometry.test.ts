import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";
import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_STREETS,
} from "../src/data/pennRoadGraph";
import {
  createGabledRoofGeometry,
  fitObjectToFootprint,
} from "../src/rendering/threeRenderer";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const ROAD_AND_SIDEWALK_CLEARANCE = 18;

describe("generated Penn building geometry", () => {
  it("keeps every building footprint inside one road-bounded block", () => {
    const violations = PENN_BUILDINGS.flatMap((building) => {
      const xBounds = containingBounds(
        building.x,
        PENN_AVENUES.map((avenue) => longitudeToWorld(avenue.longitude)),
      );
      const zBounds = containingBounds(
        building.z,
        PENN_STREETS.map((street) => latitudeToWorld(street.latitude)),
      );
      if (!xBounds || !zBounds) return [building.id];

      const cosine = Math.abs(Math.cos(building.rotation));
      const sine = Math.abs(Math.sin(building.rotation));
      const halfX = (building.width * cosine + building.depth * sine) / 2;
      const halfZ = (building.width * sine + building.depth * cosine) / 2;
      const fits =
        building.x - halfX >= xBounds.min + ROAD_AND_SIDEWALK_CLEARANCE
        && building.x + halfX <= xBounds.max - ROAD_AND_SIDEWALK_CLEARANCE
        && building.z - halfZ >= zBounds.min + ROAD_AND_SIDEWALK_CLEARANCE
        && building.z + halfZ <= zBounds.max - ROAD_AND_SIDEWALK_CLEARANCE;
      return fits ? [] : [building.id];
    });

    expect(violations).toEqual([]);
  });

  it("populates every road-bounded block", () => {
    const avenuePositions = PENN_AVENUES.map((avenue) =>
      longitudeToWorld(avenue.longitude));
    const streetPositions = PENN_STREETS.map((street) =>
      latitudeToWorld(street.latitude));
    const emptyBlocks: string[] = [];

    for (let avenueIndex = 0; avenueIndex < avenuePositions.length - 1; avenueIndex += 1) {
      for (let streetIndex = 0; streetIndex < streetPositions.length - 1; streetIndex += 1) {
        const xBounds = orderedBounds(
          avenuePositions[avenueIndex],
          avenuePositions[avenueIndex + 1],
        );
        const zBounds = orderedBounds(
          streetPositions[streetIndex],
          streetPositions[streetIndex + 1],
        );
        const populated = PENN_BUILDINGS.some((building) =>
          building.x > xBounds.min
          && building.x < xBounds.max
          && building.z > zBounds.min
          && building.z < zBounds.max);
        if (!populated) emptyBlocks.push(`${avenueIndex}:${streetIndex}`);
      }
    }

    expect(emptyBlocks).toEqual([]);
  });

  it("gives every block enough built area to avoid empty lots", () => {
    const avenuePositions = PENN_AVENUES.map((avenue) =>
      longitudeToWorld(avenue.longitude));
    const streetPositions = PENN_STREETS.map((street) =>
      latitudeToWorld(street.latitude));
    const underfilledBlocks: string[] = [];

    for (let avenueIndex = 0; avenueIndex < avenuePositions.length - 1; avenueIndex += 1) {
      for (let streetIndex = 0; streetIndex < streetPositions.length - 1; streetIndex += 1) {
        const xBounds = orderedBounds(
          avenuePositions[avenueIndex],
          avenuePositions[avenueIndex + 1],
        );
        const zBounds = orderedBounds(
          streetPositions[streetIndex],
          streetPositions[streetIndex + 1],
        );
        const usableArea = Math.max(
          1,
          (xBounds.max - xBounds.min - ROAD_AND_SIDEWALK_CLEARANCE * 2)
          * (zBounds.max - zBounds.min - ROAD_AND_SIDEWALK_CLEARANCE * 2),
        );
        const builtArea = PENN_BUILDINGS
          .filter((building) =>
            building.x > xBounds.min
            && building.x < xBounds.max
            && building.z > zBounds.min
            && building.z < zBounds.max)
          .reduce((total, building) => total + building.width * building.depth, 0);
        if (builtArea / usableArea < 0.18) {
          underfilledBlocks.push(`${avenueIndex}:${streetIndex}`);
        }
      }
    }

    expect(underfilledBlocks).toEqual([]);
  });

  it("keeps pitched roof vertices within their building footprint", () => {
    const width = 38;
    const depth = 24;
    const roof = createGabledRoofGeometry(width, depth, 5);
    roof.computeBoundingBox();

    expect(roof.boundingBox?.min.x).toBe(-width / 2);
    expect(roof.boundingBox?.max.x).toBe(width / 2);
    expect(roof.boundingBox?.min.z).toBe(-depth / 2);
    expect(roof.boundingBox?.max.z).toBe(depth / 2);
    expect(roof.boundingBox?.min.y).toBe(0);
    expect(roof.boundingBox?.max.y).toBe(5);
  });

  it("shrinks oversized landmark meshes to their road-safe footprint", () => {
    const landmark = new THREE.Group();
    const stadium = new THREE.Mesh(new THREE.TorusGeometry(51, 12, 10, 64));
    stadium.rotation.x = Math.PI / 2;
    stadium.scale.x = 1.55;
    const offCenterTower = new THREE.Mesh(new THREE.BoxGeometry(24, 48, 38));
    offCenterTower.position.set(54, 24, 31);
    landmark.add(stadium, offCenterTower);

    fitObjectToFootprint(landmark, 100, 72);

    const bounds = new THREE.Box3().setFromObject(landmark);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(100.001);
    expect(size.z).toBeLessThanOrEqual(72.001);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-50.001);
    expect(bounds.max.x).toBeLessThanOrEqual(50.001);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-36.001);
    expect(bounds.max.z).toBeLessThanOrEqual(36.001);
  });
});

function containingBounds(
  value: number,
  positions: readonly number[],
): { min: number; max: number } | null {
  for (let index = 0; index < positions.length - 1; index += 1) {
    const bounds = orderedBounds(positions[index], positions[index + 1]);
    if (value > bounds.min && value < bounds.max) return bounds;
  }
  return null;
}

function orderedBounds(a: number, b: number): { min: number; max: number } {
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function longitudeToWorld(longitude: number): number {
  return (longitude - PENN_CENTER.longitude) * METERS_PER_DEGREE_LONGITUDE;
}

function latitudeToWorld(latitude: number): number {
  return -(latitude - PENN_CENTER.latitude) * METERS_PER_DEGREE_LATITUDE;
}
