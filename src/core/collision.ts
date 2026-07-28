import * as THREE from "three";

export type OccupancyTest = (position: THREE.Vector3) => boolean;

export function resolveSubsteppedMovement(
  start: Readonly<THREE.Vector3>,
  displacement: Readonly<THREE.Vector3>,
  canOccupy: OccupancyTest,
  maximumStep: number,
): THREE.Vector3 {
  const resolved = new THREE.Vector3(start.x, start.y, start.z);
  const distance = displacement.length();
  if (distance === 0) return resolved;

  const steps = Math.max(1, Math.ceil(distance / maximumStep));
  const step = new THREE.Vector3(
    displacement.x / steps,
    displacement.y / steps,
    displacement.z / steps,
  );
  const candidate = new THREE.Vector3();
  for (let index = 0; index < steps; index += 1) {
    for (const axis of ["x", "y", "z"] as const) {
      candidate.copy(resolved);
      candidate[axis] += step[axis];
      if (canOccupy(candidate)) resolved[axis] = candidate[axis];
    }
  }
  return resolved;
}

export function sphereOutsideBoxes(
  position: Readonly<THREE.Vector3>,
  radius: number,
  boxes: readonly THREE.Box3[],
): boolean {
  const closest = new THREE.Vector3();
  for (const box of boxes) {
    box.clampPoint(position, closest);
    if (closest.distanceToSquared(position) < radius * radius) return false;
  }
  return true;
}
