import { describe, expect, it } from "vitest";
import type { Building, TravelMode, TripRequest } from "../src/models/types";
import { MobilitySystem } from "../src/core/mobility";
import {
  OUTSIDE_FREIGHT_BUILDING_ID,
  buildStreetNetwork,
  calculateEdgeCost,
  planRoute,
} from "../src/core/network";

const buildings: Pick<Building, "id" | "x" | "z">[] = [
  { id: "west-home", x: -20, z: -20 },
  { id: "east-shop", x: 20, z: -20 },
  { id: "south-office", x: 20, z: 35 },
];

function trip(
  id: string,
  mode: TravelMode,
  originBuildingId = "west-home",
  destinationBuildingId = "east-shop",
): TripRequest {
  return {
    id,
    personId: `person-${id}`,
    originBuildingId,
    destinationBuildingId,
    mode,
    purpose: mode === "freight" ? "delivery" : "work",
    createdMinute: 0,
    vehicleType: mode === "freight" ? "truck" : undefined,
    cargoUnits: mode === "freight" ? 8 : 0,
  };
}

describe("street network routing", () => {
  it("builds mode-valid global routes across roads, sidewalks, transit, and freight access", () => {
    const network = buildStreetNetwork(buildings);
    const requests = [
      trip("car-route", "car"),
      trip("walk-route", "walk"),
      trip("bus-route", "bus"),
      trip("freight-route", "freight", OUTSIDE_FREIGHT_BUILDING_ID, "east-shop"),
    ];

    for (const request of requests) {
      const route = planRoute(
        network,
        request.originBuildingId,
        request.destinationBuildingId,
        request.mode,
      );
      expect(route.points.length).toBeGreaterThan(2);
      expect(route.edges.length).toBe(route.points.length - 1);
      expect(route.edges.every((edge) => edge.modes.includes(request.mode))).toBe(true);
      expect(route.cost.totalSeconds).toBeGreaterThan(0);
      expect(route.cost.totalSeconds).toBeCloseTo(
        route.cost.travelTimeSeconds
          + route.cost.monetaryCostSeconds
          + route.cost.comfortPenaltySeconds
          + route.cost.turnPenaltySeconds,
        8,
      );
    }

    expect(network.nodes.some((node) => node.kind === "crosswalk")).toBe(true);
    expect(network.nodes.some((node) => node.kind === "bus-stop")).toBe(true);
    expect(
      network.nodes.some((node) => node.buildingId === OUTSIDE_FREIGHT_BUILDING_ID),
    ).toBe(true);
    for (const building of buildings) {
      expect(network.nodes.some((node) => node.buildingId === building.id)).toBe(true);
    }
  });

  it("raises deterministic travel cost when demand exceeds road capacity", () => {
    const network = buildStreetNetwork(buildings, { roadCapacity: 2 });
    const road = network.edges.find((edge) => edge.id === "road-west-approach")!;
    const freeFlowCost = calculateEdgeCost(road, "car");

    road.occupancy = 5;
    road.congestion = road.occupancy / road.capacity;
    const congestedCost = calculateEdgeCost(road, "car");

    expect(road.capacity).toBe(2);
    expect(congestedCost.congestionDelaySeconds).toBeGreaterThan(0);
    expect(congestedCost.travelTimeSeconds).toBeGreaterThan(freeFlowCost.travelTimeSeconds);
    expect(calculateEdgeCost(road, "walk").totalSeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("MobilitySystem", () => {
  it("applies live speed, bus-headway, and road-capacity controls without reset", () => {
    const mobility = new MobilitySystem(buildings, {
      busHeadwayMinutes: 10,
      roadCapacity: 8,
      speedLimitMph: 5,
    });
    expect(mobility.submitTrip(trip("controlled-car", "car"))).toBe(true);
    mobility.update(1, "vehicles");
    const slowProgress = mobility
      .getSnapshot()
      .vehicles.find((vehicle) => vehicle.id === "controlled-car")!.progress;

    mobility.setSpeedLimitMph(45);
    mobility.setRoadCapacity(3);
    mobility.update(1, "vehicles");
    const fastProgress = mobility
      .getSnapshot()
      .vehicles.find((vehicle) => vehicle.id === "controlled-car")!.progress;
    expect(fastProgress - slowProgress).toBeGreaterThan(slowProgress);
    expect(
      mobility
        .getNetwork()
        .edges.filter((edge) => edge.id.startsWith("road-") || edge.id.startsWith("movement-"))
        .every((edge) => edge.capacity === 3),
    ).toBe(true);

    mobility.setBusHeadwayMinutes(0.05);
    mobility.update(3.1, "vehicles");
    expect(
      mobility.getSnapshot().vehicles.filter((vehicle) => vehicle.vehicleType === "bus"),
    ).toHaveLength(2);
  });

  it("forms a red-light vehicle queue and releases it on green", () => {
    const mobility = new MobilitySystem(buildings, {
      busHeadwayMinutes: 20,
      roadCapacity: 6,
    });
    expect(mobility.submitTrip(trip("car-1", "car"))).toBe(true);
    expect(mobility.submitTrip(trip("car-2", "car"))).toBe(true);

    mobility.update(25, "pedestrians");
    const redSnapshot = mobility.getSnapshot();
    expect(redSnapshot.redLightQueue).toBeGreaterThan(0);
    expect(redSnapshot.vehicles.some((vehicle) => vehicle.waitingSeconds > 0)).toBe(true);
    const redProgress = redSnapshot.vehicles.find((vehicle) => vehicle.id === "car-1")!.progress;

    mobility.update(8, "vehicles");
    const greenVehicle = mobility
      .getSnapshot()
      .vehicles.find((vehicle) => vehicle.id === "car-1");
    expect(greenVehicle === undefined || greenVehicle.progress > redProgress).toBe(true);
  });

  it("holds pedestrians outside crosswalks until their signal phase", () => {
    const mobility = new MobilitySystem(buildings, { busHeadwayMinutes: 20 });
    expect(mobility.submitTrip(trip("walker-1", "walk"))).toBe(true);

    mobility.update(20, "vehicles");
    const waiting = mobility.getSnapshot();
    expect(waiting.pedestrianSignalWaiters).toBe(1);
    expect(waiting.pedestrians[0]?.waitSeconds).toBeGreaterThan(0);
    const waitingProgress = waiting.pedestrians[0]!.progress;

    mobility.update(20, "pedestrians");
    const released = mobility.getSnapshot();
    expect(
      released.pedestrians.length === 0
        || released.pedestrians[0]!.progress > waitingProgress,
    ).toBe(true);
  });

  it("consumes outside freight trips as trucks and retains bounded completion totals", () => {
    const mobility = new MobilitySystem(buildings, { busHeadwayMinutes: 20 });
    const freight = trip(
      "freight-1",
      "freight",
      OUTSIDE_FREIGHT_BUILDING_ID,
      "east-shop",
    );
    expect(mobility.submitTrip(freight)).toBe(true);

    const activeTruck = mobility
      .getSnapshot()
      .vehicles.find((vehicle) => vehicle.id === freight.id);
    expect(activeTruck?.vehicleType).toBe("truck");
    expect(activeTruck?.cargoUnits).toBe(8);

    mobility.update(90, "vehicles");
    const completed = mobility.getSnapshot();
    expect(completed.vehicles.some((vehicle) => vehicle.id === freight.id)).toBe(false);
    expect(completed.counters.completedFreight).toBe(1);
    expect(completed.counters.completedVehicles).toBeGreaterThanOrEqual(1);
    expect(completed.counters.averageVehicleTravelSeconds).toBeGreaterThan(0);
  });

  it("boards a capacity-limited bus queue and records ridership and completed trips", () => {
    const mobility = new MobilitySystem(buildings, {
      busCapacity: 1,
      busDwellSeconds: 0,
      busHeadwayMinutes: 10,
      roadCapacity: 8,
    });
    expect(mobility.consumeTrips([
      trip("rider-1", "bus"),
      trip("rider-2", "bus"),
    ])).toEqual({ accepted: 2, rejected: [] });

    mobility.update(0.1, "vehicles");
    const boarded = mobility.getSnapshot();
    expect(boarded.busPassengersOnBoard).toBe(1);
    expect(boarded.busQueueLength).toBe(1);
    expect(boarded.counters.transitRidership).toBe(1);

    mobility.update(5, "vehicles");
    expect(mobility.getSnapshot().roadVolume).toBeGreaterThan(0);

    mobility.update(75, "vehicles");
    const arrived = mobility.getSnapshot();
    expect(arrived.counters.completedTransitTrips).toBeGreaterThanOrEqual(1);
    expect(arrived.counters.averageTransitWaitMinutes).toBeGreaterThanOrEqual(0);
  });
});
