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

    simulation.update(8);

    expect(simulation.getState().elapsedSeconds).toBeGreaterThan(0);
    expect(simulation.getState().metrics.activeVehicles).toBeGreaterThan(0);
    expect(simulation.getState().metrics.activePedestrians).toBeGreaterThan(0);
  });

  it("cycles green, yellow, all-red, and pedestrian signal phases", () => {
    const simulation = new Simulation();
    simulation.setSignalTiming("30-market", {
      northSouthGreenSeconds: 10,
      eastWestGreenSeconds: 10,
      yellowSeconds: 2,
      allRedSeconds: 0.5,
      pedestrianSeconds: 5,
    });
    simulation.start();

    simulation.update(10);
    expect(simulation.getState().signalPhase).toBe("ns-yellow");

    simulation.update(2);
    expect(simulation.getState().signalPhase).toBe("all-red");

    simulation.update(0.5);
    expect(simulation.getState().signalPhase).toBe("ew-green");

    simulation.update(12.5);
    expect(simulation.getState().signalPhase).toBe("pedestrian-walk");
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
      signalCycleSeconds: 30,
    });
  });

  it("reflects street upgrades in live district metrics", () => {
    const simulation = new Simulation();
    simulation.start();
    simulation.update(180);
    const baseline = { ...simulation.getState().metrics };

    simulation.setDesignImpact({
      laneCapacityDelta: 2,
      bikeLanes: 3,
      sidewalkUpgrades: 2,
      crosswalks: 3,
      pedestrianIslands: 2,
    });

    const upgraded = simulation.getState().metrics;
    expect(upgraded.congestion).toBeLessThanOrEqual(baseline.congestion);
    expect(upgraded.averageSpeedMph).toBeGreaterThan(baseline.averageSpeedMph);
    expect(upgraded.pedestrianWaitSeconds).toBeLessThan(baseline.pedestrianWaitSeconds);
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

  it("connects placed building roles to district activity", () => {
    const simulation = new Simulation();
    simulation.setPlacedBuildings([
      {
        id: "industry",
        kind: "industrial",
        floors: 6,
        x: 10,
        z: 20,
        rotation: 0,
        color: "#a66b4e",
      },
    ]);

    expect(simulation.getBuildingActivity()).toMatchObject({
      jobs: 60,
      dailyVisitors: 24,
      dailyFreightTrips: 96,
    });
    expect(simulation.getBuildingActivity().vehicleDemandBoost).toBeGreaterThan(
      0,
    );
  });
});
