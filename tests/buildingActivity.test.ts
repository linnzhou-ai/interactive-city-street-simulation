import { describe, expect, it } from "vitest";
import {
  deriveBuildingRole,
  summarizeBuildingActivity,
} from "../src/core/buildingActivity";
import type { PlacedBuilding } from "../src/models/types";

function building(
  kind: PlacedBuilding["kind"],
  floors: number,
): PlacedBuilding {
  return {
    id: `${kind}-${floors}`,
    kind,
    floors,
    x: 0,
    z: 0,
    rotation: 0,
    color: "#ffffff",
  };
}

describe("building activity", () => {
  it("gives each land use a distinct operational role", () => {
    expect(deriveBuildingRole(building("residential", 5))).toMatchObject({
      residents: 70,
      jobs: 5,
    });
    expect(deriveBuildingRole(building("commercial", 5))).toMatchObject({
      jobs: 90,
      dailyVisitors: 450,
    });
    expect(deriveBuildingRole(building("industrial", 5))).toMatchObject({
      dailyFreightTrips: 80,
    });
    expect(deriveBuildingRole(building("civic", 5))).toMatchObject({
      jobs: 60,
      dailyVisitors: 325,
    });
  });

  it("reports capacity without inventing traffic demand", () => {
    const summary = summarizeBuildingActivity([
      building("residential", 5),
      building("commercial", 5),
      building("industrial", 3),
      building("civic", 4),
    ]);

    expect(summary.residents).toBe(70);
    expect(summary.jobs).toBe(173);
    expect(summary.dailyVisitors).toBe(732);
    expect(summary.dailyFreightTrips).toBe(69);
    expect(summary.vehicleDemandBoost).toBe(0);
    expect(summary.pedestrianDemandBoost).toBe(0);
  });
});
