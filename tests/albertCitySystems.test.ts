import { describe, expect, it } from "vitest";
import { AlbertCitySystems } from "../src/core/albertCitySystems";
import { deriveBuildingIssues } from "../src/core/buildingIssues";
import { createCitySectionState, createDemoCitySectionDefinition } from "../src/core/cityModel";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";
import type { DesignImpact, PlacedBuilding, ScenarioSettings } from "../src/models/types";

const SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  speedLimitMph: 25,
  signalCycleSeconds: 83,
  vehicleVolume: 2,
  pedestrianVolume: 2,
  simulationSeed: 20260728,
};

const IMPACT: DesignImpact = {
  laneCapacityDelta: 0,
  bikeLanes: 0,
  sidewalkUpgrades: 0,
  crosswalks: 0,
  pedestrianIslands: 0,
};

describe("Albert city systems on the chanyoung app", () => {
  it("initializes Albert's city economy, people, households, and functional buildings", () => {
    const systems = new AlbertCitySystems();
    const snapshot = systems.getSnapshot();

    expect(snapshot.city.districts).toHaveLength(12);
    expect(snapshot.city.metrics.population).toBeGreaterThan(80_000);
    expect(snapshot.entities.buildings).toHaveLength(PENN_BUILDINGS.length);
    expect(snapshot.entities.people.length).toBeGreaterThan(300);
    expect(snapshot.entities.households.length).toBeGreaterThan(100);
    expect(snapshot.entities.connections.some((connection) => connection.kind === "work")).toBe(true);
    expect(snapshot.entities.connections.some((connection) => connection.kind === "visit")).toBe(true);
    expect(snapshot.entities.connections.some((connection) => connection.kind === "delivery")).toBe(true);
    expect(deriveBuildingIssues(snapshot.entities, snapshot.city).length).toBeGreaterThan(0);
  });

  it("gives player-placed buildings an Albert accounting function without changing placement data", () => {
    const systems = new AlbertCitySystems();
    const building: PlacedBuilding = {
      id: "building-99",
      kind: "commercial",
      x: 18,
      z: -24,
      rotation: Math.PI / 2,
      floors: 7,
      color: "#bf765f",
    };

    systems.setPlacedBuildings([building]);
    const detailed = systems.getBuilding(building.id);

    expect(detailed).toMatchObject({
      id: building.id,
      function: "retail",
      x: building.x,
      z: building.z,
      floors: building.floors,
      rotation: building.rotation,
    });
    expect(detailed?.accounting.requiredWorkers).toBeGreaterThan(0);
    expect(Number.isFinite(detailed?.accounting.profit)).toBe(true);
  });

  it("advances the imported economy and entity histories on Albert's year scale", () => {
    const systems = new AlbertCitySystems();
    systems.setTimeHorizon("year");
    systems.update(1, true, 1, SETTINGS, IMPACT);
    const snapshot = systems.getSnapshot();

    expect(snapshot.city.elapsedDays).toBe(7);
    expect(snapshot.entities.lastUpdatedDay).toBe(7);
    expect(snapshot.entities.buildings.some((building) => building.history.length > 1)).toBe(true);
    expect(snapshot.dateLabel).toContain("2026");
  });

  it("keeps Albert's city model deterministic and separate from the original traffic engine", () => {
    const definition = createDemoCitySectionDefinition();
    const first = createCitySectionState(definition);
    const second = createCitySectionState(createDemoCitySectionDefinition());

    expect(first).toEqual(second);
    expect(first.metrics.businessRevenueDaily).toBeGreaterThan(0);
    expect(first.metrics.housingOccupancyPercent).toBeGreaterThan(0);
  });
});
