import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ExpansionBuilder } from "../src/rendering/expansionBuilder";
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

function builder(scene: THREE.Scene): ExpansionBuilder {
  return new ExpansionBuilder(
    scene,
    new THREE.PerspectiveCamera(),
    {} as HTMLCanvasElement,
    { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
  );
}

describe("ExpansionBuilder crosswalk sets", () => {
  it("renders added roads with opaque black asphalt", () => {
    const scene = new THREE.Scene();
    const expansion = builder(scene);
    expansion.setRoads([horizontalRoad]);

    let roadGroup: THREE.Object3D | undefined;
    scene.traverse((object) => {
      if (
        object.userData.expansionType === "road"
        && object.userData.expansionId === horizontalRoad.id
      ) roadGroup = object;
    });
    const surface = roadGroup?.children[0] as THREE.Mesh;
    const material = surface.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe("071417");
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
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
    scene.traverse((object) => {
      if (
        object.parent?.userData.expansionId === "crosswalk-set"
        && object instanceof THREE.Mesh
      ) {
        stripeCount += 1;
      }
    });
    expect(stripeCount).toBe(28);
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
