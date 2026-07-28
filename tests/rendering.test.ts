import { describe, expect, it } from "vitest";
import { vehicleRoadPlacement } from "../src/rendering/threeRenderer";
import type { RoutePoint } from "../src/models/types";

describe("vehicle rendering", () => {
  it("keeps access travel in timing while displaying vehicles only on road lanes", () => {
    const route: RoutePoint[] = [
      { nodeId: "access-home", x: 0, z: 20 },
      { nodeId: "road-west-in", x: 0, z: 10 },
      { nodeId: "road-east-out", x: 0, z: -50 },
      { nodeId: "access-shop", x: 0, z: -60 },
    ];

    const beforeRoad = vehicleRoadPlacement(route, 0.05);
    const middle = vehicleRoadPlacement(route, 0.5);

    expect(beforeRoad.progress).toBe(0);
    expect(middle.route.map((point) => point.nodeId)).toEqual(["road-west-in", "road-east-out"]);
    expect(middle.progress).toBeCloseTo(0.5, 8);
  });
});
