import { describe, expect, it } from "vitest";
import { advanceCitySection } from "../src/core/cityEngine";
import { BASE_GOODS_PRICES, GOODS } from "../src/core/cityEconomy";
import {
  captureBaseline,
  compareWithBaseline,
  deriveCongestionTripBreakdown,
  deriveHappinessBreakdown,
  deriveMigrationBreakdown,
  derivePersonDailyInsight,
  derivePriceBreakdowns,
  deriveRepresentationSummary,
} from "../src/core/insights";
import { createInitialLandUse } from "../src/core/landUse";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
} from "../src/core/cityModel";
import { createPopulation } from "../src/core/population";

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
      first.accounting.dailyIncome - first.accounting.commuteCost
        - first.accounting.personalRentShare - first.accounting.personalGoodsSpending,
      8,
    );
    expect(first.householdMemberIds).toEqual(household.memberIds);
    expect(first.diagnosis).toContain(person.name);
    expect(["staying", "leaving"]).toContain(first.migrationStatus);
  });
});
