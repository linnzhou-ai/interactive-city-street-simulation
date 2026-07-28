import * as THREE from "three";
import type { CameraMode } from "../models/types";

export interface CameraClipPlanes {
  near: number;
  far: number;
}

export interface GeometryValidationIssue {
  kind: "matrix" | "position" | "bounds" | "triangle";
  message: string;
  vertexIndices?: readonly number[];
}

export function cameraClipPlanes(
  mode: CameraMode,
  altitudeMeters: number,
): CameraClipPlanes {
  if (mode === "walk") return { near: 0.08, far: 3_200 };
  if (mode === "orbit") {
    return altitudeMeters >= 500
      ? { near: 0.5, far: 6_500 }
      : { near: 0.25, far: 5_500 };
  }
  if (altitudeMeters >= 300) return { near: 0.75, far: 6_500 };
  if (altitudeMeters >= 50) return { near: 0.25, far: 5_500 };
  return { near: 0.15, far: 4_500 };
}

export function validateBuildingGeometry(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  expectedSpanMeters: number,
): GeometryValidationIssue[] {
  const issues: GeometryValidationIssue[] = [];
  if (!matrixWorld.elements.every(Number.isFinite)) {
    return [{ kind: "matrix", message: "Instance transform contains a non-finite value." }];
  }

  const positions = geometry.getAttribute("position");
  if (!positions) {
    return [{ kind: "position", message: "Geometry has no position attribute." }];
  }
  for (let index = 0; index < positions.count; index += 1) {
    if (
      !Number.isFinite(positions.getX(index)) ||
      !Number.isFinite(positions.getY(index)) ||
      !Number.isFinite(positions.getZ(index))
    ) {
      issues.push({
        kind: "position",
        message: `Vertex ${index} contains a non-finite coordinate.`,
        vertexIndices: [index],
      });
    }
  }
  if (issues.length > 0) return issues;

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const localBounds = geometry.boundingBox;
  const localSphere = geometry.boundingSphere;
  if (
    !localBounds ||
    !localSphere ||
    !vectorIsFinite(localBounds.min) ||
    !vectorIsFinite(localBounds.max) ||
    !vectorIsFinite(localSphere.center) ||
    !Number.isFinite(localSphere.radius)
  ) {
    return [{ kind: "bounds", message: "Geometry produced invalid bounding volumes." }];
  }

  const worldBounds = localBounds.clone().applyMatrix4(matrixWorld);
  const worldSpan = worldBounds.getSize(new THREE.Vector3()).length();
  const spanLimit = Math.max(1, expectedSpanMeters) * 1.75;
  if (!Number.isFinite(worldSpan) || worldSpan > spanLimit) {
    issues.push({
      kind: "bounds",
      message: `Geometry span ${worldSpan.toFixed(1)} m exceeds the ${spanLimit.toFixed(1)} m building limit.`,
    });
  }

  const indexAttribute = geometry.getIndex();
  const vertexCount = indexAttribute?.count ?? positions.count;
  const edgeLimit = Math.max(1, expectedSpanMeters) * 1.35;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let index = 0; index + 2 < vertexCount; index += 3) {
    const indices = [
      indexAttribute?.getX(index) ?? index,
      indexAttribute?.getX(index + 1) ?? index + 1,
      indexAttribute?.getX(index + 2) ?? index + 2,
    ] as const;
    a.fromBufferAttribute(positions, indices[0]).applyMatrix4(matrixWorld);
    b.fromBufferAttribute(positions, indices[1]).applyMatrix4(matrixWorld);
    c.fromBufferAttribute(positions, indices[2]).applyMatrix4(matrixWorld);
    const longestEdge = Math.max(
      a.distanceTo(b),
      b.distanceTo(c),
      c.distanceTo(a),
    );
    if (!Number.isFinite(longestEdge) || longestEdge > edgeLimit) {
      issues.push({
        kind: "triangle",
        message: `Triangle edge ${longestEdge.toFixed(1)} m exceeds the ${edgeLimit.toFixed(1)} m building limit.`,
        vertexIndices: indices,
      });
      break;
    }
  }
  return issues;
}

function vectorIsFinite(vector: THREE.Vector3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}
