import { describe, expect, it } from "vitest";
import { Simulation, createInitialState } from "../src/core/simulation";

describe("Simulation", () => {
  it("does not advance while paused", () => {
    const simulation = new Simulation();

    simulation.update(1);

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("advances both agents after starting", () => {
    const simulation = new Simulation();
    simulation.start();

    simulation.update(0.1);

    expect(simulation.getState().vehicle.progress).toBeGreaterThan(0);
    expect(simulation.getState().pedestrian.progress).toBeGreaterThan(0);
    expect(simulation.getState().metrics.congestion).toBe(1);
  });

  it("restores deterministic starting conditions", () => {
    const simulation = new Simulation();
    simulation.start();
    simulation.update(0.1);
    simulation.reset();

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("clamps the simulation speed to the supported range", () => {
    const simulation = new Simulation();

    simulation.setSimulationSpeed(10);
    expect(simulation.getSettings().simulationSpeed).toBe(2);

    simulation.setSimulationSpeed(0);
    expect(simulation.getSettings().simulationSpeed).toBe(0.5);
  });

  it("updates and clamps all scenario controls", () => {
    const simulation = new Simulation();

    simulation.setVehicleVolume(10);
    simulation.setPedestrianVolume(2);
    simulation.setSpeedLimit(100);
    simulation.setSignalCycle(1);

    expect(simulation.getSettings()).toMatchObject({
      vehicleVolume: 3,
      pedestrianVolume: 2,
      speedLimitMph: 100,
      signalCycleSeconds: 2,
    });
  });

  it("uses vehicle volume in the live congestion metric", () => {
    const simulation = new Simulation();
    simulation.setVehicleVolume(3);
    simulation.start();
    simulation.update(0.1);

    expect(simulation.getState().metrics.congestion).toBe(3);
  });
});
