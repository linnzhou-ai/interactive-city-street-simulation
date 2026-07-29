import { describe, expect, it } from "vitest";
import {
  IntersectionSignalController,
  LiveTrafficSystem,
} from "../src/core/liveTraffic";
import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_STREETS,
} from "../src/data/pennRoadGraph";

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

  it("routes economic trips over connected expansion roads", () => {
    const traffic = new LiveTrafficSystem(20260729);
    const road = {
      id: "expansion-road-1",
      startX: 700,
      startZ: -390,
      endX: 900,
      endZ: -390,
      width: 18,
      laneDelta: 0 as const,
      bikeLane: true,
      widenedSidewalk: true,
      laneDirection: "two-way" as const,
    };
    traffic.setExpansionNetwork(
      [road],
      [{ id: "crosswalk-1", kind: "crosswalk", x: 800, z: -390, rotation: 0 }],
      [{
        id: "placed-building-1",
        kind: "commercial",
        function: "retail",
        floors: 5,
        x: 860,
        z: -350,
        rotation: 0,
        color: "#ffffff",
      }],
    );

    const route = traffic.getRouteSegmentIds(
      { x: 860, z: -350 },
      "outside-market",
    );
    expect(route).toContain(road.id);
    expect(traffic.getEndpointMobilitySupport({ x: 860, z: -350 })).toMatchObject({
      connected: true,
      walkingBonus: 13,
      cyclingBonus: 7,
    });

    traffic.setEconomicRoadLoad(new Map([[road.id, 150]]));
    const snapshot = traffic.getRoadTraffic().find((candidate) => candidate.segmentId === road.id);
    expect(snapshot?.activeVehicles).toBeGreaterThan(0);
    expect(snapshot?.congestionPercent).toBeGreaterThan(0);
    expect(snapshot?.averageDelaySeconds).toBeGreaterThan(0);
  });

  it("routes visible pedestrians and drivers along user-built roads", () => {
    const traffic = new LiveTrafficSystem(20260729);
    const road = {
      id: "expansion-road-visible-route",
      startX: 1_800,
      startZ: 1_600,
      endX: 2_000,
      endZ: 1_600,
      width: 18,
      laneDirection: "forward" as const,
    };
    traffic.setExpansionNetwork([road], [], []);

    const walkingRoute = traffic.getRoutePath(
      { x: 1_990, z: 1_630 },
      { x: 1_810, z: 1_630 },
      "walk",
    );
    const drivingRoute = traffic.getRoutePath(
      { x: 1_810, z: 1_630 },
      { x: 1_990, z: 1_630 },
      "car",
    );

    expect(walkingRoute.segmentIds).toContain(road.id);
    expect(drivingRoute.segmentIds).toContain(road.id);
    expect(walkingRoute.points.some((point) =>
      Math.abs(point.z - road.startZ) < 0.01
      && point.x >= road.startX
      && point.x <= road.endX)).toBe(true);
    expect(drivingRoute.points.some((point) =>
      Math.abs(point.z - road.startZ) < 0.01
      && point.x >= road.startX
      && point.x <= road.endX)).toBe(true);
  });

  it("splices a new street into the middle of an existing city block", () => {
    const traffic = new LiveTrafficSystem(20260729);
    const metersPerLongitude = 111_320
      * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
    const avenue = PENN_AVENUES.find((candidate) => candidate.short === "34")!;
    const walnut = PENN_STREETS.find((candidate) => candidate.slug === "walnut")!;
    const sansom = PENN_STREETS.find((candidate) => candidate.slug === "sansom")!;
    const junctionX = (avenue.longitude - PENN_CENTER.longitude)
      * metersPerLongitude;
    const walnutZ = -(walnut.latitude - PENN_CENTER.latitude) * 111_320;
    const junctionZ = -(
      (walnut.latitude + sansom.latitude) / 2
      - PENN_CENTER.latitude
    ) * 111_320;
    const road = {
      id: "expansion-road-mid-block",
      startX: junctionX + 60,
      startZ: junctionZ,
      endX: junctionX,
      endZ: junctionZ,
      width: 16,
      laneDirection: "two-way" as const,
    };
    traffic.setExpansionNetwork([road], [], []);

    const drivingRoute = traffic.getRoutePath(
      { x: road.startX - 5, z: road.startZ },
      { x: junctionX, z: walnutZ },
      "car",
    );
    const walkingRoute = traffic.getRoutePath(
      { x: junctionX, z: walnutZ },
      { x: road.startX - 5, z: road.startZ },
      "walk",
    );

    expect(drivingRoute.segmentIds).toContain(road.id);
    expect(walkingRoute.segmentIds).toContain(road.id);
    expect(drivingRoute.points).toContainEqual({
      x: junctionX,
      z: junctionZ,
    });
  });

  it("marks isolated expansion parcels as disconnected", () => {
    const traffic = new LiveTrafficSystem(20260729);
    traffic.setExpansionNetwork(
      [{
        id: "isolated-road",
        startX: 1_900,
        startZ: 1_700,
        endX: 2_100,
        endZ: 1_700,
        width: 16,
      }],
      [],
      [],
    );

    expect(traffic.getRouteSegmentIds({ x: 2_000, z: 1_730 }, "outside-work")).toEqual([]);
    expect(traffic.getEndpointMobilitySupport({ x: 2_000, z: 1_730 }).connected).toBe(false);
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
