import { describe, expect, it } from "vitest";
import { advanceCitySection } from "../src/core/cityEngine";
import { BASE_GOODS_PRICES, GOODS } from "../src/core/cityEconomy";
import {
  captureBaseline,
  compareWithBaseline,
  deriveCongestionTripBreakdown,
  deriveBuildingFinancialFlow,
  deriveBuildingTrafficInsight,
  deriveBuildingUtilityInsight,
  deriveHappinessBreakdown,
  deriveMigrationBreakdown,
  derivePersonDailyInsight,
  derivePersonHappinessInsight,
  derivePriceBreakdowns,
  deriveRepresentationSummary,
} from "../src/core/insights";
import { advanceEconomy } from "../src/core/economy";
import { createInitialLandUse } from "../src/core/landUse";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
} from "../src/core/cityModel";
import { createPopulation } from "../src/core/population";
import type { BuildingConnection, NetworkEdge, Vehicle } from "../src/models/types";

function createFixture() {
  const city = advanceCitySection(
    createCitySectionState(createDemoCitySectionDefinition()),
    1,
  ).state;
  const population = createPopulation(createInitialLandUse().buildings);
  return { city, ...population };
}

describe("city insight projections", () => {
  it("makes representative detail and aggregate scale explicit", () => {
    const { city, people, buildings } = createFixture();
    const summary = deriveRepresentationSummary(city, people, buildings);

    expect(summary.citywideResidents).toBe(city.metrics.population);
    expect(summary.representativePeople).toBe(people.length);
    expect(summary.residentsPerVisiblePerson).toBeCloseTo(city.metrics.population / people.length);
    expect(summary.detailedBuildings).toBe(buildings.length);
    expect(summary.aggregateDistricts).toBe(city.districts.length);
    expect(summary.peopleLabel).toMatch(/1 visible person represents approximately/);
  });

  it("reconciles migration causes to saved net migration", () => {
    const { city } = createFixture();
    const breakdown = deriveMigrationBreakdown(city);

    expect(breakdown.contributions.map((row) => row.key)).toEqual([
      "jobs",
      "happiness",
      "housing",
      "utilities",
      "congestion",
      "rateLimit",
      "reconciliation",
    ]);
    expect(breakdown.contributions.reduce((total, row) => total + row.value, 0))
      .toBeCloseTo(city.metrics.annualizedNetMigration, 8);
    expect(breakdown.contributions.find((row) => row.key === "congestion")!.value)
      .toBeLessThanOrEqual(0);
  });

  it("turns overlapping movement metrics into non-overlapping trip shares", () => {
    const { city } = createFixture();
    const breakdown = deriveCongestionTripBreakdown(city);

    expect(new Set(breakdown.rows.map((row) => row.category))).toEqual(
      new Set(["commute", "shopping", "freight", "pedestrian", "transit"]),
    );
    expect(breakdown.rows.reduce((total, row) => total + row.sharePercent, 0)).toBeCloseTo(100, 8);
    expect(breakdown.rows.reduce((total, row) => total + row.tripsDaily, 0))
      .toBeCloseTo(breakdown.totalTripsDaily, 8);
    expect(breakdown.roadTripsDaily).toBeCloseTo(city.metrics.vehicleTripsDaily, 1);
  });

  it("explains each saved goods price with state-derived causes", () => {
    const { city } = createFixture();
    const prices = derivePriceBreakdowns(city);

    for (const good of GOODS) {
      const price = prices[good];
      expect(price.basePrice).toBe(BASE_GOODS_PRICES[good]);
      expect(price.demandDaily).toBe(city.market.demandDaily[good]);
      expect(price.importsDaily).toBe(city.market.importsDaily[good]);
      expect(price.unmetDemandDaily).toBe(city.market.unmetDemandDaily[good]);
      expect(price.contributions.reduce((total, row) => total + row.value, 0))
        .toBeCloseTo(price.currentPrice, 8);
    }
  });

  it("reconciles happiness components to the city score", () => {
    const { city } = createFixture();
    const breakdown = deriveHappinessBreakdown(city);

    expect(breakdown.contributions.find((row) => row.key === "startingScore")?.value).toBe(29);
    expect(breakdown.contributions.find((row) => row.key === "civicServices")?.value).toBeGreaterThan(0);
    expect(breakdown.contributions.reduce((total, row) => total + row.value, 0))
      .toBeCloseTo(city.metrics.happiness, 8);
  });

  it("captures an immutable baseline and returns current differences", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const baseline = captureBaseline(initial);
    const current = advanceCitySection(initial, 30).state;
    const rows = compareWithBaseline(current, baseline);
    const population = rows.find((row) => row.key === "population")!;

    expect(baseline.elapsedDays).toBe(0);
    expect(population.baseline).toBe(initial.metrics.population);
    expect(population.current).toBe(current.metrics.population);
    expect(population.difference).toBe(population.current - population.baseline);
    expect(rows).toHaveLength(11);
  });

  it("builds a deterministic person timeline, accounting, and migration diagnosis", () => {
    const { city, people, households, buildings } = createFixture();
    const person = people.find((candidate) => candidate.ageGroup === "adult" && candidate.workBuildingId !== undefined)!;
    const household = households.find((candidate) => candidate.id === person.householdId)!;
    const first = derivePersonDailyInsight(person, household, city, buildings);
    const second = derivePersonDailyInsight(person, household, city, buildings);

    expect(first).toEqual(second);
    expect(first.timeline.map((entry) => entry.activity)).toEqual(person.schedule.map((entry) => entry.activity));
    expect(first.timeline.every((entry) => entry.buildingName.length > 0)).toBe(true);
    expect(first.accounting.dailyIncome).toBeGreaterThan(0);
    expect(first.accounting.netDailyCash).toBeCloseTo(
      first.accounting.dailyIncome - first.accounting.personalSpending,
      8,
    );
    expect(first.accounting.personalSpending).toBeCloseTo(
      Object.entries(first.accounting.expenses)
        .filter(([key]) => key !== "total")
        .reduce((total, [, value]) => total + value, 0),
      8,
    );
    expect(first.householdMemberIds).toEqual(household.memberIds);
    expect(first.diagnosis).toContain(person.name);
    expect(["staying", "leaving"]).toContain(first.migrationStatus);
  });

  it("projects business ledgers into a reconciled revenue, cost, and profit flow", () => {
    const { people, households, buildings } = createFixture();
    const economy = advanceEconomy({ people, households, buildings, cityMinute: 1_440 });
    const business = economy.buildings.find((building) => building.buildingUse === "retail")!;
    const flow = deriveBuildingFinancialFlow(business)!;

    expect(flow.revenue - flow.costs).toBeCloseTo(flow.profit, 8);
    expect(flow.costSegments.reduce((total, segment) => total + segment.sharePercent, 0)).toBeCloseTo(100, 8);
    expect(flow.costSegments.reduce((total, segment) => total + segment.value, 0)).toBeCloseTo(flow.costs, 8);
    expect(flow.resultLabel).toBe("Profit");

    const civicBuilding = economy.buildings.find((building) => building.buildingUse === "school")!;
    expect(deriveBuildingFinancialFlow(civicBuilding)).toBeNull();
  });

  it("exposes utility bottlenecks and need-based happiness as visual drivers", () => {
    const { people, buildings } = createFixture();
    const utility = deriveBuildingUtilityInsight(buildings[0]!);
    const personHappiness = derivePersonHappinessInsight(people[0]!);

    expect(utility.coverage.map((row) => row.key)).toEqual(["power", "water", "waste"]);
    expect(utility.bottleneck.coveragePercent).toBe(Math.min(...utility.coverage.map((row) => row.coveragePercent)));
    expect(personHappiness.drivers).toHaveLength(5);
    expect(personHappiness.startingScore - personHappiness.drivers.reduce(
      (total, driver) => total + driver.penaltyPoints,
      0,
    )).toBeCloseTo(personHappiness.score, 8);
    expect(personHappiness.score).toBe(people[0]!.happiness);
  });

  it("separates destination activity from actual access-road load", () => {
    const { buildings } = createFixture();
    const target = buildings[0]!;
    const vehicles = [
      vehicle("commute", target.id, "car", "work", 20),
      vehicle("freight", target.id, "truck", "delivery", 0),
    ];
    const connections = [
      connection("commute", target.id, 3),
      connection("customer", target.id, 4),
      connection("supply", target.id, 5),
    ];
    const edges: NetworkEdge[] = [{
      id: `access-${target.id}-road-in`,
      from: "road",
      to: "building",
      modes: ["car"],
      length: 1,
      capacity: 10,
      freeFlowSpeed: 25,
      occupancy: 5,
      congestion: 0.5,
    }];
    const insight = deriveBuildingTrafficInsight(target, vehicles, connections, edges);

    expect(insight.activeArrivals).toBe(2);
    expect(insight.queuedArrivals).toBe(1);
    expect(insight.averageWaitSeconds).toBe(10);
    expect(insight.accessLoadPercent).toBe(50);
    expect(insight.connectedCommutes).toBe(3);
    expect(insight.connectedVisitors).toBe(4);
    expect(insight.connectedSupplyUnits).toBe(5);
    expect(insight.rows.find((row) => row.category === "commute")?.activeArrivals).toBe(1);
    expect(insight.rows.find((row) => row.category === "freight")?.activeArrivals).toBe(1);
  });
});

function vehicle(
  id: string,
  destinationBuildingId: string,
  vehicleType: Vehicle["vehicleType"],
  tripPurpose: Vehicle["tripPurpose"],
  waitingSeconds: number,
): Vehicle {
  return {
    id,
    kind: "vehicle",
    progress: 0,
    completed: false,
    elapsedSeconds: 0,
    route: [],
    position: { x: 0, z: 0, headingRadians: 0, segmentId: "road-west-approach" },
    vehicleType,
    direction: "eastbound",
    waitingSeconds,
    currentSpeedMph: waitingSeconds > 0 ? 0 : 20,
    occupancy: 1,
    capacity: 4,
    tripPurpose,
    destinationBuildingId,
    cargoUnits: vehicleType === "truck" ? 10 : 0,
  };
}

function connection(
  kind: BuildingConnection["kind"],
  destinationBuildingId: string,
  volume: number,
): BuildingConnection {
  return {
    id: `${kind}-${destinationBuildingId}`,
    kind,
    fromBuildingId: `origin-${kind}`,
    toBuildingId: destinationBuildingId,
    volume,
    personIds: [],
  };
}
