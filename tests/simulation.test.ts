import { describe, expect, it } from "vitest";
import {
  calculateCityActivity,
  Simulation,
  createInitialState,
} from "../src/core/simulation";

describe("Simulation", () => {
  it("does not advance while paused", () => {
    const simulation = new Simulation();

    simulation.update(1);

    expect(simulation.getState()).toEqual(createInitialState());
  });

  it("deducts funded municipal projects from government funds", () => {
    const simulation = new Simulation();
    const before = simulation.getState().city.municipalBudget;

    expect(simulation.fundMunicipalProject(250_000)).toBe(true);
    expect(simulation.getState().city.municipalBudget).toBe(before - 250_000);
    expect(simulation.getState().city.metrics.municipalBalance).toBe(
      before - 250_000,
    );
    expect(simulation.getMunicipalProjectSpending()).toBe(250_000);
    expect(simulation.fundMunicipalProject(before)).toBe(false);
    expect(simulation.getMunicipalProjectSpending()).toBe(250_000);
  });

  it("advances district time after starting", () => {
    const simulation = new Simulation();
    simulation.start();

    simulation.update(8);

    expect(simulation.getState().elapsedSeconds).toBeGreaterThan(0);
    expect(simulation.getState().metrics.activeVehicles).toBeGreaterThan(0);
    expect(simulation.getState().metrics.activePedestrians).toBeGreaterThan(0);
  });

  it("counts arrivals at existing city buildings", () => {
    const simulation = new Simulation();
    simulation.start();

    simulation.update(240);

    expect(simulation.getState().metrics.buildingArrivals).toBeGreaterThan(0);
  });

  it("uses the 758 detailed residents as authoritative visible travelers", () => {
    const simulation = new Simulation();
    simulation.setTimeOfDay(7.9);
    const state = simulation.getState();
    const travelingPeople = state.entities.people.filter((person) =>
      person.mobility.phase === "walking"
      || person.mobility.phase === "driving"
      || person.mobility.phase === "transit"
    );

    expect(state.entities.people).toHaveLength(758);
    expect(travelingPeople.length).toBeGreaterThan(0);
    for (const pedestrian of state.pedestrians.filter((agent) =>
      agent.source === "sampled-resident"
    )) {
      const person = state.entities.people.find(
        (candidate) => candidate.id === pedestrian.personId,
      );
      expect(person?.mobility.phase).toBe("walking");
      expect(person?.mobility.x).toBeCloseTo(pedestrian.x, 5);
      expect(person?.mobility.z).toBeCloseTo(pedestrian.z, 5);
    }
    for (const vehicle of state.vehicles.filter((agent) =>
      agent.source === "sampled-resident"
    )) {
      expect(vehicle.occupantPersonIds?.length).toBeGreaterThan(0);
      for (const personId of vehicle.occupantPersonIds ?? []) {
        const person = state.entities.people.find((candidate) => candidate.id === personId);
        expect(["driving", "transit"]).toContain(person?.mobility.phase);
        expect(person?.mobility.vehicleId).toBe(vehicle.id);
        expect(person?.mobility.x).toBeCloseTo(vehicle.x, 5);
        expect(person?.mobility.z).toBeCloseTo(vehicle.z, 5);
      }
    }
  });

  it("keeps residents traveling off peak while preserving a larger rush hour", () => {
    const activeTravelersAt = (hour: number): number => {
      const simulation = new Simulation();
      simulation.setTimeOfDay(hour);
      return simulation.getState().entities.people.filter((person) =>
        person.mobility.phase === "walking"
        || person.mobility.phase === "driving"
        || person.mobility.phase === "transit"
      ).length;
    };
    const morningRush = activeTravelersAt(8);
    const afternoonOffPeak = activeTravelersAt(14);

    expect(afternoonOffPeak).toBeGreaterThan(0);
    expect(morningRush).toBeGreaterThan(afternoonOffPeak);
  });

  it("assigns persistent law-violation events to about 15% of active trips", () => {
    const simulation = new Simulation();
    simulation.setTimeOfDay(8);
    const eligible = simulation.getState().entities.people.filter((person) =>
      person.mobility.phase === "walking"
      || person.mobility.phase === "driving"
    );
    const violating = eligible.filter(
      (person) => person.mobility.violationEventId !== undefined,
    );
    const ratio = violating.length / Math.max(1, eligible.length);

    expect(violating.length).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0.08);
    expect(ratio).toBeLessThan(0.22);
  });

  it("derives movement from city time instead of real-time agent stepping", () => {
    const first = new Simulation();
    const second = new Simulation();
    first.setTimeOfDay(7.75);
    second.setTimeOfDay(7.75);
    first.start();
    second.start();

    first.update(0.1);
    second.update(0.1);

    const firstTraveler = first.getState().entities.people.find((person) =>
      person.mobility.phase !== "inside" && person.mobility.phase !== "outside"
    );
    const secondTraveler = second.getState().entities.people.find(
      (person) => person.id === firstTraveler?.id,
    );
    expect(firstTraveler).toBeDefined();
    expect(secondTraveler?.mobility).toEqual(firstTraveler?.mobility);
  });

  it("supports a readable 10x clock for observing resident movement", () => {
    const simulation = new Simulation();
    simulation.setTimeOfDay(7.9);
    simulation.setSimulationSpeed(1 / 360);
    const beforeMinutes = simulation.getState().cityElapsedMinutes;
    const traveler = simulation.getState().entities.people.find((person) =>
      person.mobility.phase !== "inside"
      && person.mobility.phase !== "outside"
      && person.mobility.routeProgress > 0.1
      && person.mobility.routeProgress < 0.9
    );
    simulation.start();

    simulation.update(1);

    const after = simulation.getState();
    const movedTraveler = after.entities.people.find(
      (person) => person.id === traveler?.id,
    );
    expect(traveler).toBeDefined();
    expect(after.cityElapsedMinutes - beforeMinutes).toBeCloseTo(1 / 6, 5);
    expect(movedTraveler?.mobility.routeProgress).toBeGreaterThan(
      traveler?.mobility.routeProgress ?? 0,
    );
    expect(
      (movedTraveler?.mobility.routeProgress ?? 0)
        - (traveler?.mobility.routeProgress ?? 0),
    ).toBeLessThan(0.05);
  });

  it("keeps sampled pedestrians continuous while they follow their routes", () => {
    const simulation = new Simulation();
    simulation.setTimeOfDay(7.75);
    simulation.setSimulationSpeed(1 / 360);
    simulation.start();
    let previousPositions = new Map<string, {
      x: number;
      z: number;
      destination: string;
      progress: number;
    }>();
    let largestStep = 0;
    let largestProgressStep = 0;
    let largestStepDetail = "";
    const observedPeople = new Set<string>();

    for (let step = 0; step < 900; step += 1) {
      simulation.update(0.1);
      const state = simulation.getState();
      const peopleById = new Map(state.entities.people.map((person) => [person.id, person]));
      const currentPositions = new Map<string, {
        x: number;
        z: number;
        destination: string;
        progress: number;
      }>();
      for (const pedestrian of state.pedestrians) {
        if (pedestrian.source !== "sampled-resident" || !pedestrian.personId) continue;
        observedPeople.add(pedestrian.personId);
        const previous = previousPositions.get(pedestrian.personId);
        if (previous) {
          const distance = Math.hypot(
            pedestrian.x - previous.x,
            pedestrian.z - previous.z,
          );
          if (distance > largestStep) {
            const mobility = peopleById.get(pedestrian.personId)?.mobility;
            largestStep = distance;
            largestStepDetail = `${pedestrian.personId} at step ${step}: ${previous.destination} ${previous.progress.toFixed(3)} -> ${mobility?.destinationBuildingId} ${mobility?.routeProgress.toFixed(3)}`;
          }
          const mobility = peopleById.get(pedestrian.personId)?.mobility;
          if (mobility?.destinationBuildingId === previous.destination) {
            largestProgressStep = Math.max(
              largestProgressStep,
              Math.abs(mobility.routeProgress - previous.progress),
            );
          }
        }
        const mobility = peopleById.get(pedestrian.personId)?.mobility;
        currentPositions.set(pedestrian.personId, {
          x: pedestrian.x,
          z: pedestrian.z,
          destination: mobility?.destinationBuildingId ?? "unknown",
          progress: mobility?.routeProgress ?? 0,
        });
      }
      previousPositions = currentPositions;
    }

    expect(observedPeople.size).toBeGreaterThan(0);
    expect(largestStep, largestStepDetail).toBeLessThan(4);
    expect(largestProgressStep).toBeLessThan(0.03);
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
    simulation.setSpeedLimit(100);
    simulation.setSignalCycle(1);

    expect(simulation.getSettings()).toMatchObject({
      simulationSpeed: 2,
      speedLimitMph: 45,
      signalCycleSeconds: 30,
    });
    expect(simulation.getSettings().vehicleVolume).toBeGreaterThanOrEqual(1);
    expect(simulation.getSettings().vehicleVolume).toBeLessThanOrEqual(3);
    expect(simulation.getSettings().pedestrianVolume).toBeGreaterThanOrEqual(1);
    expect(simulation.getSettings().pedestrianVolume).toBeLessThanOrEqual(3);
  });

  it("derives visible demand from city trips and the time of day", () => {
    const city = new Simulation().getState().city;
    const morning = calculateCityActivity(city, 0);
    const night = calculateCityActivity(city, 16 * 60);

    expect(morning.vehicleDemandLevel).toBeGreaterThan(night.vehicleDemandLevel);
    expect(morning.commuteSharePercent).toBeGreaterThan(0);
    expect(morning.shoppingSharePercent).toBeGreaterThan(0);
    expect(morning.freightSharePercent).toBeGreaterThan(0);
  });

  it("advances the city economy over long time horizons", () => {
    const simulation = new Simulation();
    const initial = simulation.getState().city;
    simulation.setTimeHorizon("year");
    simulation.start();

    simulation.update(1);

    expect(simulation.getState().city.elapsedDays).toBe(7);
    expect(simulation.getState().city.metrics.population).not.toBe(
      initial.metrics.population,
    );
    expect(simulation.getState().timeHorizon).toBe("year");
    expect(simulation.getState().mobilityDetailMode).toBe("outcome");
    expect(simulation.getState().vehicles.every((vehicle) =>
      vehicle.source === "sampled-resident"
    )).toBe(true);
    expect(simulation.getState().pedestrians.every((pedestrian) =>
      pedestrian.source === "sampled-resident"
    )).toBe(true);
    expect(simulation.getState().entities.people.some((person) =>
      person.dailyTravelDelayMinutes > 0
    )).toBe(true);
  });

  it("switches acceleration tiers without losing resident identity", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.setTimeOfDay(7.9);
    const accelerated = simulation.getState();
    const sampledPersonIds = new Set(accelerated.entities.people.map((person) => person.id));

    expect(accelerated.mobilityDetailMode).toBe("outcome");
    expect(accelerated.vehicles.flatMap((vehicle) => vehicle.occupantPersonIds ?? [])
      .every((personId) => sampledPersonIds.has(personId))).toBe(true);

    simulation.setTimeHorizon("day");
    expect(simulation.getState().mobilityDetailMode).toBe("continuous");
    expect(simulation.getState().entities.people).toHaveLength(758);
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

  it("removes demolished city buildings from the live entity model", () => {
    const simulation = new Simulation();
    const buildingId = simulation.getState().entities.buildings[0].id;

    simulation.setDemolishedBuildings([buildingId]);

    expect(
      simulation.getState().entities.buildings.some(
        (building) => building.id === buildingId,
      ),
    ).toBe(false);
    simulation.setDemolishedBuildings([]);
    expect(
      simulation.getState().entities.buildings.some(
        (building) => building.id === buildingId,
      ),
    ).toBe(true);
  });

  it("traces a building's transport costs to roads on its active routes", () => {
    const simulation = new Simulation();
    simulation.start();
    simulation.update(8);
    const state = simulation.getState();
    const building = state.entities.buildings.find((candidate) =>
      candidate.accounting.transportCost > 0
      && state.entities.connections.some((connection) =>
        connection.fromBuildingId === candidate.id
        || connection.toBuildingId === candidate.id
      )
    );

    expect(building).toBeDefined();
    const traffic = simulation.getBuildingTrafficAttribution(building!.id);
    expect(traffic).not.toBeNull();
    expect(traffic!.roads.length).toBeGreaterThan(0);
    expect(traffic!.totalTransportCost).toBeCloseTo(
      traffic!.baseTransportCost + traffic!.congestionSurcharge,
      1,
    );

    const liveRoadIds = new Set(state.roadTraffic.map((road) => road.segmentId));
    expect(traffic!.roads.every((road) => liveRoadIds.has(road.segmentId))).toBe(true);
    const attributedCost = traffic!.roads.reduce(
      (total, road) => total + road.attributedCongestionCost,
      0,
    );
    expect(Math.abs(attributedCost - traffic!.congestionSurcharge)).toBeLessThan(0.2);
  });
});
