import { describe, expect, it } from "vitest";
import { Simulation } from "../src/core/simulation";

describe("Simulation", () => {
  it("initializes the connected street-scale systems and stays paused", () => {
    const simulation = new Simulation();
    const initial = structuredClone(simulation.getState());

    simulation.update(2);

    expect(simulation.getState()).toEqual(initial);
    expect(initial.people.length).toBeGreaterThan(0);
    expect(new Set(initial.people.map((person) => person.ageGroup))).toEqual(
      new Set(["child", "adult", "senior"]),
    );
    expect(new Set(initial.buildings.map((building) => building.zone))).toEqual(
      new Set(["residential", "commercial", "industrial", "civic", "park"]),
    );
    expect(initial.network.nodes.length).toBeGreaterThan(20);
    expect(initial.infrastructure.transitLines[0]?.active).toBe(true);
  });

  it("creates and advances road, pedestrian, freight, and transit activity", () => {
    const simulation = new Simulation();
    simulation.start();
    simulation.update(12);

    const state = simulation.getState();
    expect(state.elapsedSeconds).toBeCloseTo(12, 8);
    expect(state.metrics.activeTrips).toBeGreaterThan(0);
    expect(state.vehicles.some((vehicle) => vehicle.vehicleType === "bus")).toBe(true);
    expect(state.vehicles.some((vehicle) => vehicle.vehicleType === "car")).toBe(true);
    expect(state.pedestrians.length).toBeGreaterThan(0);
    expect(state.network.edges.some((edge) => edge.occupancy > 0)).toBe(true);
    expect(state.metrics.congestionPercent).toBeGreaterThanOrEqual(0);
    expect(state.metrics.congestionPercent).toBeLessThanOrEqual(100);
  });

  it("preserves settings across a deterministic reset", () => {
    const simulation = new Simulation();
    const initial = structuredClone(simulation.getState());
    simulation.setVehicleVolume(30);
    simulation.setSignalCycleSeconds(20);
    simulation.setUtilityCapacityScale(0.8);
    simulation.start();
    simulation.update(8);
    simulation.reset();

    const reset = structuredClone(simulation.getState());
    expect(simulation.getSettings().vehicleVolume).toBe(30);
    expect(simulation.getSettings().signalCycleSeconds).toBe(20);
    expect(simulation.getSettings().utilityCapacityScale).toBe(0.8);
    expect(reset.running).toBe(false);
    expect(reset.elapsedSeconds).toBe(0);
    expect(reset.people).toEqual(initial.people);

    const comparison = new Simulation(simulation.getSettings());
    expect(reset).toEqual(comparison.getState());
  });

  it("clamps every scenario control to its supported range", () => {
    const simulation = new Simulation();
    simulation.setSimulationSpeed(99);
    simulation.setSpeedLimitMph(99);
    simulation.setSignalCycleSeconds(99);
    simulation.setVehicleVolume(99);
    simulation.setPedestrianVolume(99);
    simulation.setFreightVolume(99);
    simulation.setTransitHeadwayMinutes(99);
    simulation.setRoadCapacity(99);
    simulation.setUtilityCapacityScale(99);
    simulation.setZoningStrictness(99);

    expect(simulation.getSettings()).toEqual({
      simulationSpeed: 4,
      speedLimitMph: 45,
      signalCycleSeconds: 40,
      vehicleVolume: 40,
      pedestrianVolume: 40,
      freightVolume: 15,
      transitHeadwayMinutes: 20,
      roadCapacity: 40,
      utilityCapacityScale: 1.5,
      zoningStrictness: 1.5,
    });
  });

  it("applies infrastructure constraints immediately", () => {
    const simulation = new Simulation();
    const fullCoverage = simulation.getState().metrics.utilityCoveragePercent;

    simulation.setUtilityCapacityScale(0.5);
    simulation.setRoadCapacity(8);
    simulation.start();
    simulation.update(1);

    const state = simulation.getState();
    expect(state.metrics.utilityCoveragePercent).toBeLessThan(fullCoverage);
    expect(state.infrastructure.roadCapacity).toBe(8);
    expect(state.buildings.some((building) => building.efficiency < 1)).toBe(true);
    expect(state.infrastructure.utilities.power.demand).toBeGreaterThan(0);
  });

  it("runs daily routines, economic flows, utilities, and constrained growth", () => {
    const simulation = new Simulation({
      simulationSpeed: 4,
      speedLimitMph: 45,
      vehicleVolume: 4,
      pedestrianVolume: 4,
      freightVolume: 1,
      roadCapacity: 40,
    });
    const initialValue = simulation.getState().landUse.averageLandValue;
    simulation.start();

    simulation.update(260);

    const state = simulation.getState();
    expect(state.day).toBe(2);
    expect(state.economy.employedWorkers).toBeGreaterThan(0);
    expect(state.economy.goodsProduced).toBeGreaterThan(0);
    expect(state.infrastructure.wasteCollected).toBeGreaterThan(0);
    expect(state.landUse.averageLandValue).not.toBe(initialValue);
    expect(state.events.some((event) => event.category === "economy")).toBe(true);
    expect(state.metrics.population).toBe(state.people.length);
    for (const value of Object.values(state.metrics)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("produces the same result for one large update and fixed small updates", () => {
    const largeStep = new Simulation();
    const smallSteps = new Simulation();
    largeStep.start();
    smallSteps.start();

    largeStep.update(10);
    for (let index = 0; index < 100; index += 1) smallSteps.update(0.1);

    const largeState = largeStep.getState();
    const smallState = smallSteps.getState();
    expect(largeState.elapsedSeconds).toBeCloseTo(smallState.elapsedSeconds, 8);
    expect(largeState.timeOfDayMinutes).toBeCloseTo(smallState.timeOfDayMinutes, 8);
    expect(largeState.vehicles.map(({ id, progress }) => ({ id, progress }))).toEqual(
      smallState.vehicles.map(({ id, progress }) => ({ id, progress })),
    );
    expect(largeState.pedestrians.map(({ id, progress }) => ({ id, progress }))).toEqual(
      smallState.pedestrians.map(({ id, progress }) => ({ id, progress })),
    );
  });
});
