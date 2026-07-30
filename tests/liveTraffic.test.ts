import { describe, expect, it } from "vitest";
import {
  IntersectionSignalController,
  LiveTrafficSystem,
  vehicleStopCenterDistance,
} from "../src/core/liveTraffic";
import { vehicleLengthMeters } from "../src/core/vehicleDimensions";
import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_ROAD_GRAPH,
  PENN_STREETS,
} from "../src/data/pennRoadGraph";

describe("IntersectionSignalController", () => {
  it("runs the configured deterministic phase sequence", () => {
    const controller = new IntersectionSignalController("34-walnut");
    controller.setTiming({
      northSouthGreenSeconds: 30,
      eastWestGreenSeconds: 30,
    });

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ns-green",
      pedestrianState: "walk",
      pedestrianAxis: "z",
    });

    controller.update(7);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ns-green",
      pedestrianState: "flashing-dont-walk",
      pedestrianAxis: "z",
    });

    controller.update(8);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ns-green",
      pedestrianState: "dont-walk",
      pedestrianAxis: "z",
    });

    controller.update(15);
    expect(controller.getSnapshot().phase).toBe("ns-yellow");

    controller.update(3);
    expect(controller.getSnapshot().phase).toBe("all-red");

    controller.update(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ew-green",
      pedestrianState: "walk",
      pedestrianAxis: "x",
    });
  });

  it("holds vehicle green manually without leaving WALK active forever", () => {
    const controller = new IntersectionSignalController("34-walnut");

    controller.requestManualPhase("ns-green");
    controller.update(15);

    expect(controller.getSnapshot()).toMatchObject({
      mode: "manual",
      phase: "ns-green",
      pedestrianState: "dont-walk",
      timeRemainingSeconds: null,
    });
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
    for (const vehicle of vehicles) {
      const feature = PENN_ROAD_GRAPH.find((candidate) =>
        candidate.kind === "street" && candidate.id === vehicle.segmentId
      );
      const lane = traffic.getRoadSegment(vehicle.segmentId)?.lanes.find(
        (candidate) => candidate.id === vehicle.laneId,
      );
      expect(feature).toBeDefined();
      expect(lane).toBeDefined();
      if (!feature || !lane) continue;
      const [start, end] = feature.path.map((point) => ({
        x: (point.longitude - PENN_CENTER.longitude) *
          111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180),
        z: -(point.latitude - PENN_CENTER.latitude) * 111_320,
      }));
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const distanceFromCenterline = Math.abs(
        dx * (start.z - vehicle.z) - (start.x - vehicle.x) * dz,
      ) / Math.hypot(dx, dz);
      expect(distanceFromCenterline).toBeCloseTo(
        Math.abs(lane.offsetMeters),
        5,
      );
    }
  });

  it("snaps sampled resident vehicles to a real lane center", () => {
    const traffic = new LiveTrafficSystem(3402);
    const feature = PENN_ROAD_GRAPH.find((candidate) =>
      candidate.kind === "street" && candidate.id === "spruce-34-36"
    )!;
    const [start, end] = feature.path.map((point) => ({
      x: (point.longitude - PENN_CENTER.longitude) *
        111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180),
      z: -(point.latitude - PENN_CENTER.latitude) * 111_320,
    }));
    traffic.setSampledMobility([{
      id: 8_001,
      segmentId: feature.id,
      laneId: `${feature.id}:sampled`,
      x: (start.x + end.x) / 2,
      z: (start.z + end.z) / 2,
      heading: Math.atan2(end.x - start.x, end.z - start.z),
      speedMetersPerSecond: 8.5,
      queued: false,
      kind: "compact",
      color: "#ffffff",
      complianceProbability: 1,
      violating: false,
      source: "sampled-resident",
      driverPersonId: "person-1",
      occupantPersonIds: ["person-1"],
    }], []);

    const vehicle = traffic.getVehicles()[0];
    const lane = traffic.getRoadSegment(feature.id)?.lanes.find(
      (candidate) => candidate.id === vehicle.laneId,
    );
    expect(lane).toBeDefined();
    expect(vehicle.laneId).not.toContain(":sampled");
    expect(Math.abs(vehicle.z - start.z)).toBeCloseTo(
      Math.abs(lane?.offsetMeters ?? 0),
      5,
    );
  });

  it("snaps sampled pedestrians to the sidewalk and waits at a red crossing", () => {
    const traffic = new LiveTrafficSystem(3404);
    const feature = PENN_ROAD_GRAPH.find((candidate) =>
      candidate.kind === "street" && candidate.id === "spruce-34-36"
    )!;
    const [start, end] = feature.path.map((point) => ({
      x: (point.longitude - PENN_CENTER.longitude) *
        111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180),
      z: -(point.latitude - PENN_CENTER.latitude) * 111_320,
    }));
    const sampledPedestrian = {
      id: 2_008_001,
      segmentId: feature.id,
      x: end.x - 5,
      z: end.z,
      heading: Math.atan2(end.x - start.x, end.z - start.z),
      waiting: false,
      color: "#ffffff",
      variant: 0,
      complianceProbability: 1,
      violating: false,
      source: "sampled-resident" as const,
      personId: "person-1",
    };
    traffic.setSampledMobility([], [sampledPedestrian]);

    const pedestrian = traffic.getPedestrians()[0];
    const road = traffic.getRoadSegment(feature.id)!;
    expect(Math.abs(pedestrian.z - start.z)).toBeCloseTo(
      road.totalWidthMeters / 2 + 3.65,
      5,
    );
    expect(pedestrian.waiting).toBe(true);

    traffic.setSampledMobility([], [{
      ...sampledPedestrian,
      id: sampledPedestrian.id + 1,
      violating: true,
    }]);
    expect(traffic.getPedestrians()[0].waiting).toBe(false);
  });

  it("spawns background vehicles inside roads instead of at intersections", () => {
    const traffic = new LiveTrafficSystem(3405);
    let vehicles = traffic.getVehicles();
    for (let step = 0; step < 100 && vehicles.length === 0; step += 1) {
      traffic.update(0.25, {
        vehicleVolume: 1,
        pedestrianVolume: 1,
        speedLimitMph: 25,
      });
      vehicles = traffic.getVehicles();
    }
    expect(vehicles.length).toBeGreaterThan(0);
    const intersections = PENN_AVENUES.flatMap((avenue) =>
      PENN_STREETS.map((street) => ({
        x: (avenue.longitude - PENN_CENTER.longitude) *
          111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180),
        z: -(street.latitude - PENN_CENTER.latitude) * 111_320,
      }))
    );
    for (const vehicle of vehicles) {
      expect(Math.min(...intersections.map((intersection) =>
        Math.hypot(vehicle.x - intersection.x, vehicle.z - intersection.z)
      ))).toBeGreaterThan(12);
    }
  });

  it("only removes background vehicles after they reach a city boundary", () => {
    const traffic = new LiveTrafficSystem(3403);
    const xValues = PENN_AVENUES.map((avenue) =>
      (avenue.longitude - PENN_CENTER.longitude) *
      111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180)
    );
    const zValues = PENN_STREETS.map((street) =>
      -(street.latitude - PENN_CENTER.latitude) * 111_320
    );
    const minimumX = Math.min(...xValues);
    const maximumX = Math.max(...xValues);
    const minimumZ = Math.min(...zValues);
    const maximumZ = Math.max(...zValues);
    let previous = new Map<number, { x: number; z: number }>();
    let completedExits = 0;
    for (let step = 0; step < 900; step += 1) {
      traffic.update(0.5, {
        vehicleVolume: 3,
        pedestrianVolume: 1,
        speedLimitMph: 25,
      });
      const currentVehicles = traffic.getVehicles();
      const current = new Map(
        currentVehicles.map((vehicle) => [
          vehicle.id,
          { x: vehicle.x, z: vehicle.z },
        ]),
      );
      for (const [id, position] of previous) {
        if (current.has(id)) continue;
        const reachedBoundary =
          Math.abs(position.x - minimumX) < 15 ||
          Math.abs(position.x - maximumX) < 15 ||
          Math.abs(position.z - minimumZ) < 15 ||
          Math.abs(position.z - maximumZ) < 15;
        expect(reachedBoundary).toBe(true);
        completedExits += 1;
      }
      previous = current;
    }
    expect(completedExits).toBeGreaterThan(0);
  });

  it("keeps active cars visible when a lane-direction edit invalidates their route", () => {
    const traffic = new LiveTrafficSystem(3404);
    traffic.update(45, {
      vehicleVolume: 3,
      pedestrianVolume: 1,
      speedLimitMph: 25,
    });
    const reverseVehicle = traffic.getVehicles().find((vehicle) =>
      vehicle.laneId.includes(":reverse:")
    );
    expect(reverseVehicle).toBeDefined();
    if (!reverseVehicle) return;
    const activeIds = new Set(traffic.getVehicles().map((vehicle) => vehicle.id));

    traffic.setRoadDesign(reverseVehicle.segmentId, {
      laneDirection: "forward",
    });

    const revisedVehicles = traffic.getVehicles();
    expect(revisedVehicles).toHaveLength(activeIds.size);
    expect(revisedVehicles.every((vehicle) => activeIds.has(vehicle.id))).toBe(true);
    expect(
      revisedVehicles.find((vehicle) => vehicle.id === reverseVehicle.id)
        ?.laneId.includes(":forward:"),
    ).toBe(true);
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

  it("keeps visible trips on streets instead of drawing diagonal building connectors", () => {
    const traffic = new LiveTrafficSystem(20260730);
    const origin = { x: -73, z: 41 };
    const destination = { x: 428, z: -317 };

    for (const mode of ["car", "walk"] as const) {
      const route = traffic.getRoutePath(origin, destination, mode);
      expect(route.points).not.toContainEqual(origin);
      expect(route.points).not.toContainEqual(destination);
      expect(route.points.length).toBeGreaterThan(1);
      expect(route.points.slice(1).every((point, index) => {
        const previous = route.points[index];
        return Math.abs(point.x - previous.x) < 0.01
          || Math.abs(point.z - previous.z) < 0.01;
      })).toBe(true);
      expect(route.segmentIds).toHaveLength(route.points.length - 1);
      route.segmentIds.forEach((segmentId, index) => {
        const feature = PENN_ROAD_GRAPH.find((candidate) =>
          candidate.kind === "street" && candidate.id === segmentId
        );
        expect(feature).toBeDefined();
        if (!feature) return;
        const endpoints = feature.path.map((point) => ({
          x: (point.longitude - PENN_CENTER.longitude)
            * 111_320 * Math.cos((PENN_CENTER.latitude * Math.PI) / 180),
          z: -(point.latitude - PENN_CENTER.latitude) * 111_320,
        }));
        for (const point of route.points.slice(index, index + 2)) {
          expect(Math.min(...endpoints.map((endpoint) =>
            Math.hypot(point.x - endpoint.x, point.z - endpoint.z)
          ))).toBeLessThan(0.01);
        }
      });
    }
  });

  it("keeps front bumpers behind the intersection stop line", () => {
    expect(vehicleStopCenterDistance(vehicleLengthMeters("sedan"))).toBe(16.2);
    expect(vehicleStopCenterDistance(vehicleLengthMeters("bus"))).toBe(17.6);
  });

  it("keeps passenger vehicles within realistic urban lengths", () => {
    expect(vehicleLengthMeters("compact")).toBeGreaterThanOrEqual(3.5);
    expect(vehicleLengthMeters("sedan")).toBeLessThanOrEqual(4.6);
    expect(vehicleLengthMeters("suv")).toBeLessThanOrEqual(4.8);
    expect(vehicleLengthMeters("van")).toBeLessThanOrEqual(5.1);
  });

  it("keeps buses and delivery trucks compact enough for city streets", () => {
    expect(vehicleLengthMeters("bus")).toBe(7.2);
    expect(vehicleLengthMeters("truck")).toBe(6.4);
    expect(vehicleLengthMeters("truck")).toBeGreaterThan(
      vehicleLengthMeters("van"),
    );
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

  it("naturally populates connected user-built roads with ambient agents", () => {
    const traffic = new LiveTrafficSystem(20260730);
    const metersPerLongitude = 111_320
      * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
    const avenue = PENN_AVENUES.find((candidate) => candidate.short === "34")!;
    const walnut = PENN_STREETS.find((candidate) => candidate.slug === "walnut")!;
    const sansom = PENN_STREETS.find((candidate) => candidate.slug === "sansom")!;
    const junctionX = (avenue.longitude - PENN_CENTER.longitude)
      * metersPerLongitude;
    const junctionZ = -(
      (walnut.latitude + sansom.latitude) / 2
      - PENN_CENTER.latitude
    ) * 111_320;
    const road = {
      id: "ambient-expansion-road",
      startX: junctionX,
      startZ: junctionZ,
      endX: junctionX + 90,
      endZ: junctionZ,
      width: 18,
      laneDirection: "two-way" as const,
    };
    traffic.setExpansionNetwork([road], [], []);

    let sawVehicle = false;
    let sawNamedDriver = false;
    let sawPedestrian = false;
    let sawNamedPedestrian = false;
    let sawLiveRoadMetrics = false;
    for (let step = 0; step < 80; step += 1) {
      traffic.update(0.5, {
        vehicleVolume: 3,
        pedestrianVolume: 3,
        speedLimitMph: 25,
      });
      const roadVehicles = traffic.getVehicles().filter((vehicle) =>
        vehicle.source === "background" && vehicle.segmentId === road.id
      );
      sawVehicle ||= roadVehicles.length > 0;
      sawNamedDriver ||= roadVehicles.some((vehicle) =>
        vehicle.driverPersonId?.startsWith("ambient-driver-") &&
        /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(vehicle.displayName ?? "")
      );
      const roadPedestrians = traffic.getPedestrians().filter((pedestrian) =>
        pedestrian.source === "background" && pedestrian.segmentId === road.id
      );
      sawPedestrian ||= roadPedestrians.length > 0;
      sawNamedPedestrian ||= roadPedestrians.some((pedestrian) =>
        pedestrian.personId?.startsWith("ambient-person-") &&
        /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(pedestrian.displayName ?? "")
      );
      if (roadVehicles.length > 0) {
        const roadMetrics = traffic.getRoadTraffic().find(
          (candidate) => candidate.segmentId === road.id,
        );
        sawLiveRoadMetrics ||= roadMetrics?.activeVehicles ===
          roadVehicles.length;
      }
    }

    expect(sawVehicle).toBe(true);
    expect(sawNamedDriver).toBe(true);
    expect(sawPedestrian).toBe(true);
    expect(sawNamedPedestrian).toBe(true);
    expect(sawLiveRoadMetrics).toBe(true);
  });

  it("moves active agents to surviving roads when an expansion road is deleted", () => {
    const traffic = new LiveTrafficSystem(20260730);
    const metersPerLongitude = 111_320
      * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
    const avenue = PENN_AVENUES.find((candidate) => candidate.short === "34")!;
    const walnut = PENN_STREETS.find((candidate) => candidate.slug === "walnut")!;
    const sansom = PENN_STREETS.find((candidate) => candidate.slug === "sansom")!;
    const junctionX = (avenue.longitude - PENN_CENTER.longitude)
      * metersPerLongitude;
    const junctionZ = -(
      (walnut.latitude + sansom.latitude) / 2
      - PENN_CENTER.latitude
    ) * 111_320;
    const road = {
      id: "deleted-expansion-road",
      startX: junctionX,
      startZ: junctionZ,
      endX: junctionX + 90,
      endZ: junctionZ,
      width: 18,
      laneDirection: "two-way" as const,
    };
    traffic.setExpansionNetwork([road], [], []);

    let roadVehicleIds: number[] = [];
    let roadPedestrianIds: number[] = [];
    for (let step = 0; step < 240; step += 1) {
      traffic.update(0.25, {
        vehicleVolume: 3,
        pedestrianVolume: 3,
        speedLimitMph: 25,
      });
      roadVehicleIds = traffic.getVehicles()
        .filter((vehicle) =>
          vehicle.source === "background" && vehicle.segmentId === road.id
        )
        .map((vehicle) => vehicle.id);
      roadPedestrianIds = traffic.getPedestrians()
        .filter((pedestrian) =>
          pedestrian.source === "background" && pedestrian.segmentId === road.id
        )
        .map((pedestrian) => pedestrian.id);
      if (roadVehicleIds.length > 0 && roadPedestrianIds.length > 0) break;
    }
    expect(roadVehicleIds.length).toBeGreaterThan(0);
    expect(roadPedestrianIds.length).toBeGreaterThan(0);

    traffic.setExpansionNetwork([], [], []);

    const relocatedVehicles = traffic.getVehicles().filter((vehicle) =>
      roadVehicleIds.includes(vehicle.id)
    );
    const relocatedPedestrians = traffic.getPedestrians().filter((pedestrian) =>
      roadPedestrianIds.includes(pedestrian.id)
    );
    expect(relocatedVehicles).toHaveLength(roadVehicleIds.length);
    expect(relocatedPedestrians).toHaveLength(roadPedestrianIds.length);
    for (const agent of [...relocatedVehicles, ...relocatedPedestrians]) {
      expect(agent.segmentId).not.toBe(road.id);
      expect(traffic.getRoadSegment(agent.segmentId)).toBeDefined();
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.z)).toBe(true);
    }
  });

  it("applies one four-sided crosswalk set to both roads at its junction", () => {
    const traffic = new LiveTrafficSystem(20260729);
    const horizontal = {
      id: "crosswalk-horizontal",
      startX: 700,
      startZ: -390,
      endX: 900,
      endZ: -390,
      width: 16,
    };
    const vertical = {
      id: "crosswalk-vertical",
      startX: 800,
      startZ: -490,
      endX: 800,
      endZ: -290,
      width: 16,
    };
    traffic.setExpansionNetwork(
      [horizontal, vertical],
      [{
        id: "crosswalk-set",
        kind: "crosswalk",
        x: 800,
        z: -390,
        rotation: 0,
      }],
      [],
    );
    traffic.setEconomicRoadLoad(new Map([
      [horizontal.id, 100],
      [vertical.id, 100],
    ]));

    expect(traffic.getEndpointMobilitySupport({ x: 880, z: -390 }).walkingBonus)
      .toBe(5);
    expect(traffic.getEndpointMobilitySupport({ x: 800, z: -310 }).walkingBonus)
      .toBe(5);
    expect(
      traffic.getRoadTraffic()
        .filter((snapshot) =>
          snapshot.segmentId === horizontal.id
          || snapshot.segmentId === vertical.id
        )
        .every((snapshot) => snapshot.averageDelaySeconds > 3),
    ).toBe(true);
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
    const road = {
      id: "isolated-road",
      startX: 1_900,
      startZ: 1_700,
      endX: 2_100,
      endZ: 1_700,
      width: 16,
    };
    traffic.setExpansionNetwork(
      [road],
      [],
      [],
    );
    traffic.update(20, {
      vehicleVolume: 3,
      pedestrianVolume: 3,
      speedLimitMph: 25,
    });

    expect(traffic.getRouteSegmentIds({ x: 2_000, z: 1_730 }, "outside-work")).toEqual([]);
    expect(traffic.getEndpointMobilitySupport({ x: 2_000, z: 1_730 }).connected).toBe(false);
    expect(traffic.getVehicles().some((vehicle) => vehicle.segmentId === road.id)).toBe(false);
    expect(traffic.getPedestrians().some((pedestrian) => pedestrian.segmentId === road.id)).toBe(false);
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
