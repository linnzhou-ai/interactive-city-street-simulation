import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ExpansionBuilder,
  ROAD_ASPHALT_COLOR,
} from "../src/rendering/expansionBuilder";
import type { ExpansionRoad } from "../src/models/types";

const horizontalRoad: ExpansionRoad = {
  id: "horizontal",
  startX: 0,
  startZ: 0,
  endX: 200,
  endZ: 0,
  width: 16,
};
const verticalRoad: ExpansionRoad = {
  id: "vertical",
  startX: 100,
  startZ: -100,
  endX: 100,
  endZ: 100,
  width: 16,
};
const wideNativeRoad: ExpansionRoad = {
  id: "existing-road:native-wide",
  startX: 200,
  startZ: -100,
  endX: 200,
  endZ: 100,
  width: 22,
};

function builder(
  scene: THREE.Scene,
  existingRoads: readonly ExpansionRoad[] = [],
): ExpansionBuilder {
  return new ExpansionBuilder(
    scene,
    new THREE.PerspectiveCamera(),
    {} as HTMLCanvasElement,
    { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    existingRoads,
  );
}

describe("ExpansionBuilder crosswalk sets", () => {
  it("renders added roads with opaque black asphalt", () => {
    const scene = new THREE.Scene();
    const expansion = builder(scene);
    expansion.setRoads([horizontalRoad]);

    const expectBlackAsphalt = () => {
      let roadGroup: THREE.Object3D | undefined;
      scene.traverse((object) => {
        if (
          object.userData.expansionType === "road"
          && object.userData.expansionId === horizontalRoad.id
        ) roadGroup = object;
      });
      const surface = roadGroup?.children[0] as THREE.Mesh;
      const material = surface.material as THREE.MeshStandardMaterial;
      expect(`#${material.color.getHexString()}`).toBe(ROAD_ASPHALT_COLOR);
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
      expect(
        surface.position.y
          + (surface.geometry as THREE.BoxGeometry).parameters.height / 2,
      ).toBeGreaterThan(0.23);
    };

    expectBlackAsphalt();
    expansion.setRoadAnalysis("congestion", [{
      segmentId: horizontalRoad.id,
      activeVehicles: 20,
      queuedVehicles: 12,
      averageSpeedMph: 4,
      congestionPercent: 95,
      averageDelaySeconds: 80,
    }]);
    expectBlackAsphalt();
    expansion.setHighlightedRoads([horizontalRoad.id]);
    expectBlackAsphalt();
  });

  it("visually highlights a selected added road without changing its asphalt", () => {
    const scene = new THREE.Scene();
    const expansion = builder(scene);
    expansion.setRoads([horizontalRoad]);
    expansion.setSelectedRoad(horizontalRoad.id);

    let surface: THREE.Mesh | undefined;
    scene.traverse((object) => {
      if (
        object.parent?.userData.expansionId === horizontalRoad.id
        && object instanceof THREE.Mesh
      ) surface ??= object;
    });
    const material = surface?.material as THREE.MeshStandardMaterial;
    expect(`#${material.color.getHexString()}`).toBe(ROAD_ASPHALT_COLOR);
    expect(`#${material.emissive.getHexString()}`).toBe("#1f6a5b");
    expect(material.emissiveIntensity).toBe(0.6);
  });

  it("matches a connected expansion network to the native road width", () => {
    const expansion = builder(new THREE.Scene(), [wideNativeRoad]);
    const connector = { ...horizontalRoad, endX: 200 };
    const branch = {
      ...verticalRoad,
      startX: 0,
      endX: 0,
    };

    expect(expansion.matchRoadWidths([connector, branch])).toEqual([
      { ...connector, width: 22 },
      { ...branch, width: 22 },
    ]);
  });

  it("releases a dragged street-tool interaction without placing anything", () => {
    const expansion = builder(new THREE.Scene());
    expansion.setEnabled(true);
    expansion.setRoadDrawEnabled(true);

    expect(expansion.pointerDown(100, 100)).toBe(true);
    expect(expansion.pointerUp(120, 120, false)).toBe(true);
  });

  it("snaps one placement to a junction and renders all four crosswalks", () => {
    const scene = new THREE.Scene();
    const expansion = builder(scene);
    expansion.setRoads([horizontalRoad, verticalRoad]);

    const placement = expansion.resolveStreetObjectPlacement(
      100,
      12,
      "crosswalk",
    );
    expect(placement).toEqual({
      kind: "crosswalk",
      x: 100,
      z: 0,
      rotation: 0,
    });

    expansion.setStreetObjects([{ id: "crosswalk-set", ...placement! }]);
    let stripeCount = 0;
    let lowestStripeTop = Number.POSITIVE_INFINITY;
    scene.traverse((object) => {
      if (
        object.parent?.userData.expansionId === "crosswalk-set"
        && object instanceof THREE.Mesh
      ) {
        stripeCount += 1;
        const position = object.getWorldPosition(new THREE.Vector3());
        lowestStripeTop = Math.min(
          lowestStripeTop,
          position.y
            + (object.geometry as THREE.BoxGeometry).parameters.height / 2,
        );
      }
    });
    expect(stripeCount).toBe(28);
    expect(lowestStripeTop).toBeGreaterThan(0.32);
  });

  it("sizes crosswalk bands to the connected sidewalk width", () => {
    const scene = new THREE.Scene();
    const expansion = builder(scene, [wideNativeRoad]);
    const wideHorizontal = { ...horizontalRoad, width: 22 };
    expansion.setRoads([wideHorizontal]);
    expansion.setStreetObjects([{
      id: "wide-crosswalk-set",
      kind: "crosswalk",
      x: 200,
      z: 0,
      rotation: 0,
    }]);

    const stripeDepths: number[] = [];
    scene.traverse((object) => {
      if (
        object.parent?.userData.expansionId === "wide-crosswalk-set"
        && object instanceof THREE.Mesh
      ) {
        const geometry = object.geometry as THREE.BoxGeometry;
        stripeDepths.push(Math.min(
          geometry.parameters.width,
          geometry.parameters.depth,
        ));
      }
    });
    expect(stripeDepths).not.toHaveLength(0);
    expect(stripeDepths.every((depth) => depth === 1.35)).toBe(true);
    const bands: number[] = [];
    scene.traverse((object) => {
      if (
        object.parent?.userData.expansionId === "wide-crosswalk-set"
        && object instanceof THREE.Mesh
      ) {
        const geometry = object.geometry as THREE.BoxGeometry;
        bands.push(Math.max(
          geometry.parameters.width,
          geometry.parameters.depth,
        ));
      }
    });
    expect(new Set(bands)).toEqual(new Set([3.5, 6]));

    let junctionSurface: THREE.Mesh | undefined;
    scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh
        && Math.abs(object.position.x - 200) < 0.01
        && Math.abs(object.position.z) < 0.01
        && object.position.y > 0.25
        && !object.parent?.userData.expansionId
      ) junctionSurface = object;
    });
    const junctionGeometry =
      junctionSurface?.geometry as THREE.BoxGeometry | undefined;
    expect(junctionGeometry?.parameters.width).toBe(22);
    expect(junctionGeometry?.parameters.depth).toBe(22);
  });

  it("does not place an isolated one-sided crosswalk away from a junction", () => {
    const expansion = builder(new THREE.Scene());
    expansion.setRoads([horizontalRoad]);

    expect(
      expansion.resolveStreetObjectPlacement(100, 0, "crosswalk"),
    ).toBeNull();
  });

  it("automatically equips a new road junction with crosswalks and signals", () => {
    const expansion = builder(new THREE.Scene());
    expansion.setRoads([horizontalRoad, verticalRoad]);

    expect(expansion.resolveAutomaticStreetObjects(verticalRoad.id)).toEqual([
      {
        kind: "crosswalk",
        x: 100,
        z: 0,
        rotation: 0,
      },
      {
        kind: "traffic-signal",
        x: 100,
        z: 0,
        rotation: 0,
      },
    ]);
  });

  it("does not duplicate automatic junction equipment", () => {
    const expansion = builder(new THREE.Scene());
    expansion.setRoads([horizontalRoad, verticalRoad]);
    expansion.setStreetObjects([
      {
        id: "crosswalk-set",
        kind: "crosswalk",
        x: 100,
        z: 0,
        rotation: 0,
      },
      {
        id: "signal-set",
        kind: "traffic-signal",
        x: 100,
        z: 0,
        rotation: 0,
      },
    ]);

    expect(expansion.resolveAutomaticStreetObjects(verticalRoad.id)).toEqual([]);
  });
});
