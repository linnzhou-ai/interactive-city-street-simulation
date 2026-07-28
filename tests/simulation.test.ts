import { describe, expect, it } from "vitest";
import { Simulation, createInitialState } from "../src/core/simulation";

describe("Simulation", () => {
  it("does not advance while paused", () => {
    const simulation = new Simulation();

    simulation.update(1);

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("advances district time after starting", () => {
    const simulation = new Simulation();
    simulation.start();

    simulation.update(0.1);

    expect(simulation.getState().elapsedSeconds).toBeGreaterThan(0);
    expect(simulation.getState().metrics.congestion).toBeGreaterThan(0);
  });

  it("cycles east-west, north-south, and pedestrian signal phases", () => {
    const simulation = new Simulation();
    simulation.setSignalCycle(10);
    simulation.start();

    simulation.update(4.3);
    expect(simulation.getState().signalPhase).toBe("north-south");

    simulation.update(4.2);
    expect(simulation.getState().signalPhase).toBe("pedestrians");

    simulation.update(1.6);
    expect(simulation.getState().signalPhase).toBe("east-west");
  });

  it("restores deterministic starting conditions", () => {
    const simulation = new Simulation();
    simulation.start();
    simulation.update(0.1);
    simulation.reset();

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("clamps all scenario controls", () => {
    const simulation = new Simulation();

    simulation.setSimulationSpeed(10);
    simulation.setVehicleVolume(10);
    simulation.setPedestrianVolume(0);
    simulation.setSpeedLimit(100);
    simulation.setSignalCycle(1);

    expect(simulation.getSettings()).toMatchObject({
      simulationSpeed: 2,
      vehicleVolume: 3,
      pedestrianVolume: 1,
      speedLimitMph: 45,
      signalCycleSeconds: 10,
    });
  });

  it("reflects street upgrades in live district metrics", () => {
    const simulation = new Simulation();
    const baseline = { ...simulation.getState().metrics };

    simulation.setDesignImpact({
      laneCapacityDelta: 2,
      bikeLanes: 3,
      sidewalkUpgrades: 2,
      crosswalks: 3,
      pedestrianIslands: 2,
    });

    const upgraded = simulation.getState().metrics;
    expect(upgraded.vehicleTravelSeconds).toBeLessThan(baseline.vehicleTravelSeconds);
    expect(upgraded.pedestrianWaitSeconds).toBeLessThan(baseline.pedestrianWaitSeconds);
    expect(upgraded.potentialConflicts).toBeLessThan(baseline.potentialConflicts);
    expect(upgraded.throughputPerHour).toBeGreaterThan(baseline.throughputPerHour);
  });

  it("keeps baseline comparison independent from the modified design", () => {
    const simulation = new Simulation();
    const baseline = simulation.getBaselineMetrics();

    simulation.setDesignImpact({
      laneCapacityDelta: 2,
      bikeLanes: 3,
      sidewalkUpgrades: 2,
      crosswalks: 3,
      pedestrianIslands: 2,
    });

    expect(simulation.getBaselineMetrics()).toEqual(baseline);
    expect(simulation.getState().metrics).not.toEqual(baseline);
  });
});
