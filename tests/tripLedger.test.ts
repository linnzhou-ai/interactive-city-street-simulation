import { describe, expect, it } from "vitest";
import { Simulation } from "../src/core/simulation";
import { TripLedgerSystem } from "../src/core/tripLedger";
import type {
  PedestrianSnapshot,
  SimulationMetrics,
  VehicleSnapshot,
} from "../src/models/types";

function metrics(
  activeVehicles: number,
  activePedestrians: number,
  buildingArrivals = 0,
): SimulationMetrics {
  return {
    vehicleTravelSeconds: 0,
    averageSpeedMph: 0,
    congestion: 0,
    intersectionDelaySeconds: 0,
    pedestrianWaitSeconds: 0,
    potentialConflicts: 0,
    throughputPerHour: 0,
    activeVehicles,
    activePedestrians,
    crossingsCompleted: 0,
    buildingArrivals,
    trafficViolations: 0,
    jaywalkingViolations: 0,
  };
}

function vehicle(
  id: number,
  destinationBuildingId?: string,
): VehicleSnapshot {
  return {
    id,
    segmentId: "segment-a",
    laneId: "lane-a",
    x: 0,
    z: 0,
    heading: 0,
    speedMetersPerSecond: 5,
    queued: false,
    kind: "sedan",
    color: "#fff",
    complianceProbability: 1,
    violating: false,
    source: "background",
    driverPersonId: `ambient-driver-${id}`,
    displayName: "Avery Brooks",
    tripId: `external:vehicle:${id}`,
    travelerCategory: destinationBuildingId ? "commuter" : "through-traffic",
    tripPurpose: destinationBuildingId ? "work" : "through",
    destinationBuildingId,
    plannedRouteSegmentIds: ["segment-a", "segment-b"],
  };
}

function pedestrian(
  id: number,
  destinationBuildingId: string,
): PedestrianSnapshot {
  return {
    id,
    segmentId: "segment-a",
    x: 0,
    z: 0,
    heading: 0,
    waiting: false,
    color: "#fff",
    variant: 0,
    complianceProbability: 1,
    violating: false,
    source: "background",
    personId: `ambient-person-${id}`,
    displayName: "Jordan Chen",
    tripId: `external:pedestrian:${id}`,
    travelerCategory: "visitor",
    tripPurpose: "shopping",
    destinationBuildingId,
    plannedRouteSegmentIds: ["segment-a"],
  };
}

describe("TripLedgerSystem", () => {
  it("gives every visible external agent a recorded trip and reconciles counts", () => {
    const state = new Simulation().getState();
    const buildingId = state.entities.buildings[0]!.id;
    const ledger = new TripLedgerSystem();
    const snapshot = ledger.update({
      minute: 420,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [vehicle(7, buildingId)],
      pedestrians: [pedestrian(8, buildingId)],
      trafficMetrics: metrics(1, 1),
      city: state.city,
    });

    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.summary.activeTrips).toBe(2);
    expect(snapshot.summary.externalTrips).toBe(2);
    expect(snapshot.integrity.checks.find(
      (check) => check.id === "active-vehicles",
    )?.status).toBe("verified");
    expect(snapshot.integrity.checks.find(
      (check) => check.id === "active-pedestrians",
    )?.status).toBe("verified");
  });

  it("records arrivals once and keeps through-traffic out of building activity", () => {
    const state = new Simulation().getState();
    const buildingId = state.entities.buildings[0]!.id;
    const ledger = new TripLedgerSystem();
    ledger.update({
      minute: 420,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [vehicle(1, buildingId), vehicle(2)],
      pedestrians: [],
      trafficMetrics: metrics(2, 0),
      city: state.city,
    });
    const completed = ledger.update({
      minute: 425,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [],
      pedestrians: [],
      trafficMetrics: metrics(0, 0, 1),
      city: state.city,
    });

    expect(completed.summary.completedTrips).toBe(2);
    const building = completed.buildingSummaries.find(
      (summary) => summary.buildingId === buildingId,
    );
    expect(building?.workerArrivals).toBe(1);
    expect(completed.records.find(
      (record) => record.travelerCategory === "through-traffic",
    )?.economicEffect.congestionOnly).toBe(true);
  });

  it("reports a mismatch when visible agents do not reconcile", () => {
    const state = new Simulation().getState();
    const ledger = new TripLedgerSystem();
    const snapshot = ledger.update({
      minute: 420,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [vehicle(3)],
      pedestrians: [],
      trafficMetrics: metrics(4, 0),
      city: state.city,
    });

    expect(snapshot.integrity.status).toBe("mismatch");
    expect(snapshot.integrity.checks.find(
      (check) => check.id === "active-vehicles",
    )?.difference).toBe(3);
  });

  it("marks an unreachable trip cancelled when its road is removed", () => {
    const state = new Simulation().getState();
    const ledger = new TripLedgerSystem();
    ledger.update({
      minute: 420,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [vehicle(4)],
      pedestrians: [],
      trafficMetrics: metrics(1, 0),
      city: state.city,
    });
    ledger.markRoadsRemoved(["segment-a"]);
    const snapshot = ledger.update({
      minute: 425,
      people: [],
      buildings: state.entities.buildings,
      households: state.entities.households,
      vehicles: [],
      pedestrians: [],
      trafficMetrics: metrics(0, 0),
      city: state.city,
    });

    expect(snapshot.records.find(
      (record) => record.id === "external:vehicle:4",
    )?.status).toBe("cancelled");
  });
});
