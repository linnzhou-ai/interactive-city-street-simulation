import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  resolveSubsteppedMovement,
  sphereOutsideBoxes,
} from "../src/core/collision";

const wall = new THREE.Box3(
  new THREE.Vector3(2, 0, -100),
  new THREE.Vector3(3, 12, 100),
);

function canOccupy(position: THREE.Vector3): boolean {
  return (
    position.y >= 0.5 &&
    sphereOutsideBoxes(position, 0.5, [wall])
  );
}

describe("collision movement", () => {
  it("prevents high-speed tunneling through a building", () => {
    const resolved = resolveSubsteppedMovement(
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(30, 0, 0),
      canOccupy,
      0.18,
    );

    expect(resolved.x).toBeLessThanOrEqual(1.5);
  });

  it("slides along a wall instead of freezing all movement", () => {
    const resolved = resolveSubsteppedMovement(
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(5, 0, 4),
      canOccupy,
      0.18,
    );

    expect(resolved.x).toBeLessThanOrEqual(1.5);
    expect(resolved.z).toBeGreaterThan(3.8);
  });

  it("does not move a collider below the ground", () => {
    const resolved = resolveSubsteppedMovement(
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(0, -10, 0),
      canOccupy,
      0.18,
    );

    expect(resolved.y).toBeGreaterThanOrEqual(0.5);
  });
});
