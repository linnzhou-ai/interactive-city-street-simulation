import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cameraClipPlanes,
  validateBuildingGeometry,
} from "../src/rendering/renderDiagnostics";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";

describe("render diagnostics", () => {
  it("uses tighter clipping for walking and raises the near plane at altitude", () => {
    expect(cameraClipPlanes("walk", 2)).toEqual({ near: 0.08, far: 3_200 });
    expect(cameraClipPlanes("fly", 20)).toEqual({ near: 0.15, far: 4_500 });
    expect(cameraClipPlanes("fly", 100)).toEqual({ near: 0.25, far: 5_500 });
    expect(cameraClipPlanes("fly", 1_000)).toEqual({ near: 0.75, far: 6_500 });
    expect(cameraClipPlanes("orbit", 1_000)).toEqual({ near: 0.5, far: 6_500 });
  });

  it("accepts finite building geometry with local-scale triangles", () => {
    const geometry = new THREE.BoxGeometry(30, 45, 24);
    const transform = new THREE.Matrix4().makeTranslation(1_200, 22.5, -800);

    expect(validateBuildingGeometry(geometry, transform, 60)).toEqual([]);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it("rejects non-finite transforms before rendering", () => {
    const transform = new THREE.Matrix4();
    transform.elements[12] = Number.NaN;

    expect(
      validateBuildingGeometry(new THREE.BoxGeometry(20, 30, 20), transform, 50),
    ).toEqual([
      {
        kind: "matrix",
        message: "Instance transform contains a non-finite value.",
      },
    ]);
  });

  it("flags a giant triangle relative to its building envelope", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 20, 0, 0, 0, 0, 600],
        3,
      ),
    );

    const issues = validateBuildingGeometry(
      geometry,
      new THREE.Matrix4(),
      40,
    );

    expect(issues.some((issue) => issue.kind === "bounds")).toBe(true);
    expect(issues.some((issue) => issue.kind === "triangle")).toBe(true);
  });

  it("keeps the generated Penn district in finite local meter coordinates", () => {
    expect(PENN_BUILDINGS.length).toBeGreaterThan(100);
    expect(
      PENN_BUILDINGS.every((building) =>
        [
          building.x,
          building.z,
          building.width,
          building.depth,
          building.height,
          building.rotation,
        ].every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      Math.max(
        ...PENN_BUILDINGS.map((building) =>
          Math.hypot(building.x, building.z),
        ),
      ),
    ).toBeLessThan(2_500);
  });
});
