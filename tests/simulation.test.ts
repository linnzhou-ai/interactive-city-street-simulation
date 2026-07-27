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
});
