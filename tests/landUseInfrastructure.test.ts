import { describe, expect, it } from "vitest";
import {
  calculateLandValue,
  createInitialLandUse,
  updateLandUse,
} from "../src/core/landUse";
import {
  createInitialInfrastructure,
  updateInfrastructure,
} from "../src/core/infrastructure";
import type { Building } from "../src/models/types";

describe("land use", () => {
  it("creates a deterministic mixed-use intersection with terrain and zoning boundaries", () => {
    const first = createInitialLandUse();
    const second = createInitialLandUse();
    const zones = new Set(first.landUse.parcels.map((parcel) => parcel.zone));

    expect(first).toEqual(second);
    expect(zones).toEqual(
      new Set(["residential", "commercial", "industrial", "civic", "park"]),
    );
    expect(new Set(first.buildings.map((building) => building.zone))).toEqual(zones);
    expect(first.landUse.parcels.some((parcel) => parcel.terrainSlope > 0.3)).toBe(true);
    expect(first.landUse.parcels.some((parcel) => parcel.x < 0)).toBe(true);
    expect(first.landUse.parcels.some((parcel) => parcel.x > 0)).toBe(true);
    expect(first.landUse.parcels.some((parcel) => parcel.z < 0)).toBe(true);
    expect(first.landUse.parcels.some((parcel) => parcel.z > 0)).toBe(true);
  });

  it("grows suitable buildings but respects steep terrain and height limits", () => {
    const initial = createInitialLandUse();
    const maxedBuildingId = "building-corner-shops";
    const buildings = initial.buildings.map((building) =>
      building.id === maxedBuildingId
        ? { ...building, floors: building.maxFloors }
        : building,
    );
    const updated = updateLandUse(initial.landUse, buildings, {
      accessibility: 1,
      utilityReliability: 1,
      pollution: 0,
      noise: 0,
      congestion: 0,
      zoneDemand: { residential: 1, commercial: 1, industrial: 1 },
      zoningStrictness: 0,
    });

    expect(building(updated.buildings, "building-market-hall").floors).toBe(4);
    expect(building(updated.buildings, "building-hill-homes").floors).toBe(1);
    expect(building(updated.buildings, maxedBuildingId).floors).toBe(4);
    expect(building(updated.buildings, "building-park-pavilion").floors).toBe(1);
    expect(updated.landUse.growthEvents).toBeGreaterThan(0);
    expect(updated.landUse.developedFloorArea).toBeLessThanOrEqual(
      updated.landUse.permittedFloorArea,
    );
  });

  it("raises land value near access and amenities and lowers it under externalities", () => {
    const target = building(createInitialLandUse().buildings, "building-market-hall");
    const attractive = calculateLandValue(target, {
      accessibility: 1,
      transitProximity: 1,
      jobsProximity: 1,
      retailProximity: 1,
      parkProximity: 1,
      utilityReliability: 1,
      congestion: 0,
      pollution: 0,
      rentPressure: 0.9,
      zoneDemand: { commercial: 1 },
    });
    const distressed = calculateLandValue(target, {
      accessibility: 0,
      transitProximity: 0,
      jobsProximity: 0,
      retailProximity: 0,
      parkProximity: 0,
      utilityReliability: 0.2,
      congestion: 1,
      pollution: 1,
      rentPressure: 0,
      zoneDemand: { commercial: 0 },
    });

    expect(attractive).toBeGreaterThan(target.landValue);
    expect(distressed).toBeLessThan(target.landValue);
    expect(attractive).toBeGreaterThan(distressed);
  });
});

describe("infrastructure", () => {
  it("seeds explicit utility, road, parking, and public transit infrastructure", () => {
    const { buildings } = createInitialLandUse();
    const infrastructure = createInitialInfrastructure(buildings);

    expect(Object.keys(infrastructure.networks).sort()).toEqual([
      "power",
      "waste",
      "water",
    ]);
    expect(infrastructure.networks.power.connections).toHaveLength(buildings.length);
    expect(infrastructure.state.roadCapacity).toBeGreaterThan(0);
    expect(infrastructure.state.parkingCapacity).toBeGreaterThan(0);
    expect(infrastructure.state.transitStops).toHaveLength(2);
    expect(infrastructure.state.transitLines[0]?.stopIds).toEqual([
      "transit-stop-west",
      "transit-stop-east",
    ]);
  });

  it("reduces utility coverage and building efficiency during shortages", () => {
    const { buildings } = createInitialLandUse();
    const abundant = updateInfrastructure(
      buildings,
      createInitialInfrastructure(buildings),
      { capacities: { power: 1000, water: 1000, waste: 1000 } },
    );
    const shortage = updateInfrastructure(
      buildings,
      createInitialInfrastructure(buildings),
      { capacities: { power: 35, water: 30, waste: 20 } },
    );

    expect(shortage.infrastructure.state.utilities.power.coveragePercent).toBeLessThan(
      abundant.infrastructure.state.utilities.power.coveragePercent,
    );
    expect(shortage.infrastructure.state.utilities.water.coveragePercent).toBeLessThan(
      abundant.infrastructure.state.utilities.water.coveragePercent,
    );
    expect(averageEfficiency(shortage.buildings)).toBeLessThan(
      averageEfficiency(abundant.buildings),
    );
    expect(shortage.buildings.every((item) => item.efficiency >= 0.05)).toBe(true);
  });

  it("keeps repeated updates at a constant capacity scale stable", () => {
    const { buildings } = createInitialLandUse();
    const initial = createInitialInfrastructure(buildings);
    const first = updateInfrastructure(buildings, initial, {
      capacityScale: 0.5,
      elapsedDays: 0,
    });
    const second = updateInfrastructure(first.buildings, first.infrastructure, {
      capacityScale: 0.5,
      elapsedDays: 0,
    });

    for (const kind of ["power", "water", "waste"] as const) {
      expect(second.infrastructure.networks[kind].capacity).toBe(
        first.infrastructure.networks[kind].capacity,
      );
      expect(second.infrastructure.state.utilities[kind]).toEqual(
        first.infrastructure.state.utilities[kind],
      );
    }
  });

  it("accumulates uncollected waste and removes it when collection recovers", () => {
    const initial = createInitialLandUse();
    const loadedBuildings = initial.buildings.map((item) => ({
      ...item,
      wasteStored: item.wasteStored + 20,
    }));
    const baseInfrastructure = createInitialInfrastructure(loadedBuildings);
    const missedCollection = updateInfrastructure(loadedBuildings, baseInfrastructure, {
      capacities: { waste: 0 },
      elapsedDays: 1,
    });
    const recovered = updateInfrastructure(
      missedCollection.buildings,
      missedCollection.infrastructure,
      { capacities: { waste: 2000 }, elapsedDays: 0 },
    );

    expect(totalWaste(missedCollection.buildings)).toBeGreaterThan(
      totalWaste(loadedBuildings),
    );
    expect(missedCollection.infrastructure.state.wasteCollected).toBe(0);
    expect(totalWaste(recovered.buildings)).toBeLessThan(
      totalWaste(missedCollection.buildings),
    );
    expect(recovered.infrastructure.state.wasteCollected).toBeGreaterThan(0);
    expect(recovered.infrastructure.state.utilities.waste.coveragePercent).toBe(100);
  });
});

function building(buildings: readonly Building[], id: string): Building {
  const match = buildings.find((item) => item.id === id);
  if (!match) {
    throw new Error(`Missing building ${id}`);
  }
  return match;
}

function averageEfficiency(buildings: readonly Building[]): number {
  return (
    buildings.reduce((total, item) => total + item.efficiency, 0) /
    buildings.length
  );
}

function totalWaste(buildings: readonly Building[]): number {
  return buildings.reduce((total, item) => total + item.wasteStored, 0);
}
