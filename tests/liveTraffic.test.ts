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
      pedestrianSeconds: 21,
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

    expect(traffic.getVehicles().length).toBeLessThanOrEqual(40);
    expect(traffic.getPedestrians().length).toBeLessThanOrEqual(55);
    expect(traffic.getMetrics()).toMatchObject({
      activeVehicles: traffic.getVehicles().length,
      activePedestrians: traffic.getPedestrians().length,
      potentialConflicts: 0,
    });
  });

  it("remains bounded under sustained high demand", () => {
    const traffic = new LiveTrafficSystem(2026);

    traffic.update(300, {
      vehicleVolume: 3,
      pedestrianVolume: 3,
      speedLimitMph: 25,
    });

    expect(traffic.getVehicles().length).toBeLessThanOrEqual(170);
    expect(traffic.getPedestrians().length).toBeLessThanOrEqual(260);
    expect(traffic.getMetrics().congestion).toBeGreaterThan(0);
    expect(traffic.getMetrics().potentialConflicts).toBe(0);
  });

  it("sends freight vehicles toward placed industrial buildings", () => {
    const traffic = new LiveTrafficSystem(20260728);
    traffic.setBuildingDestinations([
      {
        id: "industry",
        kind: "industrial",
        floors: 8,
        x: 0,
        z: 0,
        rotation: 0,
        color: "#a66b4e",
      },
    ]);

    traffic.update(90, settings);

    expect(
      traffic.getVehicles().some((vehicle) => vehicle.kind === "truck"),
    ).toBe(true);
  });

  it("exposes active rule violations for renderer feedback", () => {
    const traffic = new LiveTrafficSystem(20260728);
    let sawActiveViolation = false;
    for (let step = 0; step < 60; step += 1) {
      traffic.update(0.5, {
        vehicleVolume: 3,
        pedestrianVolume: 2,
        speedLimitMph: 25,
      });
      sawActiveViolation ||= [
        ...traffic.getVehicles(),
        ...traffic.getPedestrians(),
      ].some((agent) => agent.violating);
    }

    expect(traffic.getMetrics().trafficViolations).toBeGreaterThan(0);
    expect(sawActiveViolation).toBe(true);
  });
});
