import { describe, expect, it } from "vitest";
import {
  IntersectionSignalController,
  LiveTrafficSystem,
} from "../src/core/liveTraffic";

describe("IntersectionSignalController", () => {
  it("runs the configured deterministic phase sequence", () => {
    const controller = new IntersectionSignalController("34-walnut");

    controller.update(30);
    expect(controller.getSnapshot().phase).toBe("ns-yellow");

    controller.update(3);
    expect(controller.getSnapshot().phase).toBe("all-red");

    controller.update(1);
    expect(controller.getSnapshot().phase).toBe("ew-green");
  });

  it("uses yellow and all-red before an opposing manual green", () => {
    const controller = new IntersectionSignalController("34-walnut");

    controller.requestManualPhase("ew-green");
    expect(controller.getSnapshot()).toMatchObject({
      mode: "manual",
      phase: "ns-yellow",
      nextPhase: "all-red",
    });

    controller.update(3);
    expect(controller.getSnapshot().phase).toBe("all-red");

    controller.update(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ew-green",
      nextPhase: "ew-green",
      timeRemainingSeconds: null,
    });
  });

  it("clamps unsafe or unrealistic timing inputs", () => {
    const controller = new IntersectionSignalController("34-walnut");

    controller.setTiming({
      northSouthGreenSeconds: 1,
      eastWestGreenSeconds: 900,
      yellowSeconds: 0,
      allRedSeconds: 20,
      pedestrianSeconds: 1,
    });

    expect(controller.getSnapshot().timing).toEqual({
      northSouthGreenSeconds: 10,
      eastWestGreenSeconds: 120,
      yellowSeconds: 2,
      allRedSeconds: 5,
      pedestrianSeconds: 5,
    });
  });
});

describe("LiveTrafficSystem", () => {
  const settings = {
    vehicleVolume: 2,
    pedestrianVolume: 2,
    speedLimitMph: 25,
  };

  it("uses a seed to reproduce stochastic agent arrivals and routes", () => {
    const first = new LiveTrafficSystem(4815);
    const second = new LiveTrafficSystem(4815);

    first.update(24, settings);
    second.update(24, settings);

    expect(first.getVehicles()).toEqual(second.getVehicles());
    expect(first.getPedestrians()).toEqual(second.getPedestrians());
    expect(first.getVehicles().length).toBeGreaterThan(0);
    expect(first.getPedestrians().length).toBeGreaterThan(0);
  });

  it("keeps dynamically spawned populations within demand targets", () => {
    const traffic = new LiveTrafficSystem(77);

    traffic.update(180, {
      vehicleVolume: 1,
      pedestrianVolume: 1,
      speedLimitMph: 25,
    });

    expect(traffic.getVehicles().length).toBeLessThanOrEqual(110);
    expect(traffic.getPedestrians().length).toBeLessThanOrEqual(150);
    expect(traffic.getMetrics()).toMatchObject({
      activeVehicles: traffic.getVehicles().length,
      activePedestrians: traffic.getPedestrians().length,
    });
    expect(traffic.getMetrics().potentialConflicts).toBeGreaterThanOrEqual(0);
  });

  it("remains bounded under sustained high demand", () => {
    const traffic = new LiveTrafficSystem(2026);

    traffic.update(60, {
      vehicleVolume: 3,
      pedestrianVolume: 3,
      speedLimitMph: 25,
    });

    expect(traffic.getVehicles().length).toBeLessThanOrEqual(560);
    expect(traffic.getPedestrians().length).toBeLessThanOrEqual(750);
    expect(traffic.getMetrics().congestion).toBeGreaterThan(0);
    expect(traffic.getMetrics().potentialConflicts).toBeGreaterThanOrEqual(0);
  });

  it("reports measured traffic conditions for each road segment", () => {
    const traffic = new LiveTrafficSystem(2027);

    traffic.update(60, {
      vehicleVolume: 3,
      pedestrianVolume: 2,
      speedLimitMph: 25,
    });

    const roads = traffic.getRoadTraffic();
    expect(roads.length).toBeGreaterThan(70);
    expect(roads.reduce((total, road) => total + road.activeVehicles, 0)).toBe(
      traffic.getVehicles().length,
    );
    expect(roads.some((road) => road.activeVehicles > 0)).toBe(true);
    expect(roads.some((road) => road.congestionPercent > 0)).toBe(true);
    expect(roads.every((road) => road.congestionPercent >= 0 && road.congestionPercent <= 100)).toBe(true);
  });

  it("distributes lane-assigned agents throughout the district", () => {
    const traffic = new LiveTrafficSystem(3401);

    traffic.update(45, {
      vehicleVolume: 3,
      pedestrianVolume: 3,
      speedLimitMph: 25,
    });

    const vehicles = traffic.getVehicles();
    const coverage = traffic.getCoverage();
    expect(vehicles.length).toBeGreaterThanOrEqual(350);
    expect(traffic.getPedestrians().length).toBeGreaterThanOrEqual(500);
    expect(vehicles.every((vehicle) => vehicle.laneId.includes(vehicle.segmentId))).toBe(
      true,
    );
    expect(coverage.vehicleSegments.size).toBeGreaterThan(70);
    expect(coverage.pedestrianSegments.size).toBeGreaterThan(90);
  });
});
