import { describe, expect, it } from "vitest";
import { Simulation, createInitialState } from "../src/core/simulation";

describe("Simulation", () => {
  it("does not advance while paused", () => {
    const simulation = new Simulation();

    simulation.update(1);

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("spawns alternating traffic and advances both agent types", () => {
    const simulation = new Simulation();
    simulation.start();

    simulation.update(6);

    expect(simulation.getState().vehicles.length).toBeGreaterThanOrEqual(2);
    expect(simulation.getState().vehicles[0]?.direction).toBe("eastbound");
    expect(simulation.getState().vehicles[1]?.direction).toBe("westbound");
    expect(simulation.getState().vehicles[0]?.progress).toBeGreaterThan(0);
    expect(simulation.getState().pedestrian.progress).toBeGreaterThan(0);
  });

  it("fully resets deterministic traffic state while preserving settings", () => {
    const simulation = new Simulation();
    simulation.setVehicleVolume(30);
    simulation.setSignalCycleSeconds(20);
    simulation.start();
    simulation.update(4);
    simulation.reset();

    expect(simulation.getState()).toEqual(
      createInitialState(simulation.getSettings()),
    );
    expect(simulation.getSettings().vehicleVolume).toBe(30);

    simulation.start();
    simulation.update(0.05);
    expect(simulation.getState().vehicles[0]?.id).toBe("vehicle-1");
    expect(simulation.getState().vehicles[0]?.direction).toBe("eastbound");
  });

  it("clamps all traffic settings to their supported ranges", () => {
    const simulation = new Simulation();

    simulation.setSimulationSpeed(10);
    simulation.setSpeedLimitMph(100);
    simulation.setSignalCycleSeconds(100);
    simulation.setVehicleVolume(100);
    expect(simulation.getSettings().simulationSpeed).toBe(2);
    expect(simulation.getSettings().speedLimitMph).toBe(45);
    expect(simulation.getSettings().signalCycleSeconds).toBe(40);
    expect(simulation.getSettings().vehicleVolume).toBe(30);

    simulation.setSimulationSpeed(0);
    simulation.setSpeedLimitMph(0);
    simulation.setSignalCycleSeconds(0);
    simulation.setVehicleVolume(0);
    expect(simulation.getSettings().simulationSpeed).toBe(0.5);
    expect(simulation.getSettings().speedLimitMph).toBe(10);
    expect(simulation.getSettings().signalCycleSeconds).toBe(6);
    expect(simulation.getSettings().vehicleVolume).toBe(4);
  });

  it("stops at a red signal and resumes on green", () => {
    const simulation = new Simulation();
    simulation.setSpeedLimitMph(25);
    simulation.setSignalCycleSeconds(6);
    simulation.setVehicleVolume(4);
    simulation.start();

    simulation.update(5.5);
    const stoppedVehicle = simulation.getState().vehicles[0];
    expect(simulation.getState().signalPhase).toBe("pedestrians");
    expect(stoppedVehicle?.progress).toBeCloseTo(0.45, 5);
    expect(stoppedVehicle?.currentSpeedMph).toBe(0);
    expect(stoppedVehicle?.waitingSeconds).toBeGreaterThan(0);
    expect(simulation.getState().metrics.congestionPercent).toBeGreaterThan(0);

    simulation.update(0.6);
    expect(simulation.getState().signalPhase).toBe("vehicles");
    expect(stoppedVehicle?.progress).toBeGreaterThan(0.45);
    expect(stoppedVehicle?.currentSpeedMph).toBeGreaterThan(0);
  });

  it("moves vehicles farther when the speed limit is higher", () => {
    const slowerSimulation = new Simulation();
    const fasterSimulation = new Simulation();
    slowerSimulation.setSpeedLimitMph(10);
    fasterSimulation.setSpeedLimitMph(45);
    slowerSimulation.start();
    fasterSimulation.start();

    slowerSimulation.update(2);
    fasterSimulation.update(2);

    expect(fasterSimulation.getState().vehicles[0]?.progress).toBeGreaterThan(
      slowerSimulation.getState().vehicles[0]?.progress ?? 1,
    );
  });

  it("keeps a safe following gap under high volume", () => {
    const simulation = new Simulation();
    simulation.setSpeedLimitMph(10);
    simulation.setSignalCycleSeconds(6);
    simulation.setVehicleVolume(30);
    simulation.start();

    simulation.update(20);

    for (const direction of ["eastbound", "westbound"] as const) {
      const progress = simulation
        .getState()
        .vehicles.filter(
          (vehicle) => !vehicle.completed && vehicle.direction === direction,
        )
        .map((vehicle) => vehicle.progress)
        .sort((a, b) => b - a);

      for (let index = 1; index < progress.length; index += 1) {
        expect(progress[index - 1]! - progress[index]!).toBeGreaterThanOrEqual(
          0.08 - 1e-9,
        );
      }
    }
  });

  it("calculates completed travel, congestion, and flow metrics", () => {
    const simulation = new Simulation();
    simulation.setSpeedLimitMph(45);
    simulation.setSignalCycleSeconds(40);
    simulation.setVehicleVolume(4);
    simulation.start();

    simulation.update(20);

    const { metrics } = simulation.getState();
    expect(metrics.completedVehicles).toBeGreaterThan(0);
    expect(metrics.averageVehicleTravelSeconds).toBeGreaterThan(0);
    expect(metrics.congestionPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.congestionPercent).toBeLessThanOrEqual(100);
    expect(metrics.trafficFlowPerMinute).toBeCloseTo(
      (metrics.completedVehicles * 60) / simulation.getState().elapsedSeconds,
      8,
    );
    expect(metrics.potentialConflicts).toBe(0);
  });

  it("uses every part of a large frame delta without tunneling", () => {
    const largeDeltaSimulation = new Simulation();
    const smallDeltaSimulation = new Simulation();
    largeDeltaSimulation.setSignalCycleSeconds(6);
    smallDeltaSimulation.setSignalCycleSeconds(6);
    largeDeltaSimulation.start();
    smallDeltaSimulation.start();

    largeDeltaSimulation.update(10);
    for (let index = 0; index < 100; index += 1) {
      smallDeltaSimulation.update(0.1);
    }

    const largeState = largeDeltaSimulation.getState();
    const smallState = smallDeltaSimulation.getState();
    expect(largeState.elapsedSeconds).toBeCloseTo(10, 8);
    expect(largeState.elapsedSeconds).toBeCloseTo(smallState.elapsedSeconds, 8);
    expect(largeState.vehicles.map(({ id, direction }) => ({ id, direction }))).toEqual(
      smallState.vehicles.map(({ id, direction }) => ({ id, direction })),
    );
    largeState.vehicles.forEach((vehicle, index) => {
      expect(vehicle.progress).toBeCloseTo(
        smallState.vehicles[index]?.progress ?? -1,
        8,
      );
    });
  });
});
