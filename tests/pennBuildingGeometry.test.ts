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
  METERS_PER_DEGREE_LATITUDE *
  Math.cos((PENN_CENTER.latitude * Math.PI) / 180);

describe("Lynn and Albert building geometry", () => {
  it("keeps every generated building inside a road-bounded block", () => {
    const avenuePositions = PENN_AVENUES.map(
      (avenue) =>
        (avenue.longitude - PENN_CENTER.longitude) *
        METERS_PER_DEGREE_LONGITUDE,
    );
    const streetPositions = PENN_STREETS.map(
      (street) =>
        -(street.latitude - PENN_CENTER.latitude) *
        METERS_PER_DEGREE_LATITUDE,
    );
    const violations = PENN_BUILDINGS.filter((building) => {
      const xBounds = containingBounds(building.x, avenuePositions);
      const zBounds = containingBounds(building.z, streetPositions);
      if (!xBounds || !zBounds) return true;
      const cosine = Math.abs(Math.cos(building.rotation));
      const sine = Math.abs(Math.sin(building.rotation));
      const halfX =
        (building.width * cosine + building.depth * sine) / 2;
      const halfZ =
        (building.width * sine + building.depth * cosine) / 2;
      return (
        building.x - halfX < xBounds.min + 18 ||
        building.x + halfX > xBounds.max - 18 ||
        building.z - halfZ < zBounds.min + 18 ||
        building.z + halfZ > zBounds.max - 18
      );
    });

    expect(violations.map((building) => building.id)).toEqual([]);
  });

  it("creates a pitched roof within the requested footprint", () => {
    const roof = createGabledRoofGeometry(38, 24, 5);
    roof.computeBoundingBox();
    expect(roof.boundingBox?.min.x).toBe(-19);
    expect(roof.boundingBox?.max.x).toBe(19);
    expect(roof.boundingBox?.min.z).toBe(-12);
    expect(roof.boundingBox?.max.z).toBe(12);
  });

  it("shrinks and centers an oversized landmark mesh", () => {
    const landmark = new THREE.Group();
    const stadium = new THREE.Mesh(new THREE.TorusGeometry(51, 12, 10, 64));
    stadium.rotation.x = Math.PI / 2;
    stadium.scale.x = 1.55;
    landmark.add(stadium);

    fitObjectToFootprint(landmark, 100, 72);

    const bounds = new THREE.Box3().setFromObject(landmark);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(100.001);
    expect(size.z).toBeLessThanOrEqual(72.001);
  });
});

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
