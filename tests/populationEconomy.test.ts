import { describe, expect, it } from "vitest";
import { advanceEconomy } from "../src/core/economy";
import { advancePopulation, createPopulation } from "../src/core/population";
import type { Building } from "../src/models/types";

describe("population", () => {
  it("creates deterministic demographic households with assigned destinations", () => {
    const first = createPopulation(createBuildings());
    const second = createPopulation(createBuildings());

    expect(first).toEqual(second);
    expect(new Set(first.people.map((person) => person.ageGroup))).toEqual(
      new Set(["child", "adult", "senior"]),
    );
    expect(new Set(first.households.map((household) => household.incomeBand))).toEqual(
      new Set(["low", "middle", "high"]),
    );
    expect(first.households.some((household) => household.familySize > 1)).toBe(true);
    expect(first.people.every((person) => person.homeBuildingId.startsWith("home-"))).toBe(true);
    expect(first.people.filter((person) => person.ageGroup === "child").every((person) => person.schoolBuildingId === "school"))
      .toBe(true);
    expect(first.people.filter((person) => person.ageGroup === "adult").some((person) => person.workBuildingId !== undefined))
      .toBe(true);
  });

  it("uses different daily schedules for children, adults, and seniors", () => {
    const { people } = createPopulation(createBuildings());
    const child = people.find((person) => person.ageGroup === "child")!;
    const adult = people.find((person) => person.ageGroup === "adult")!;
    const senior = people.find((person) => person.ageGroup === "senior")!;

    expect(child.schedule.map((entry) => entry.activity)).toContain("school");
    expect(child.schedule.map((entry) => entry.activity)).not.toContain("work");
    expect(adult.schedule.map((entry) => entry.activity)).toContain("work");
    expect(adult.schedule.find((entry) => entry.activity === "work")?.startMinute).toBe(480);
    expect(senior.schedule.map((entry) => entry.activity)).toEqual([
      "home",
      "shopping",
      "leisure",
      "home",
    ]);
  });

  it("changes mode choice when congestion, transit, and parking conditions change", () => {
    const population = createPopulation(createBuildings());
    const adult = population.people.find(
      (person) => person.ageGroup === "adult" && person.workBuildingId === "factory",
    )!;

    const driving = advancePopulation(
      [adult],
      480,
      population.buildings,
      { busAvailable: false, congestion: 0, parkingPressure: 0 },
    );
    const transit = advancePopulation(
      [adult],
      480,
      population.buildings,
      { busAvailable: true, congestion: 1, parkingPressure: 1 },
    );

    expect(driving.tripRequests).toHaveLength(1);
    expect(driving.tripRequests[0]?.mode).toBe("car");
    expect(transit.tripRequests[0]?.mode).toBe("bus");
    expect(advancePopulation(driving.people, 480, population.buildings, {
      busAvailable: false,
      congestion: 0,
      parkingPressure: 0,
    }).tripRequests).toEqual([]);
  });
});

describe("economy", () => {
  it("produces and consumes goods while recording retail and freight flows", () => {
    const population = createPopulation(createBuildings());
    const result = advanceEconomy({
      ...population,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });

    expect(result.economy.goodsProduced).toBeGreaterThan(0);
    expect(result.economy.goodsConsumed).toBeGreaterThan(0);
    expect(result.economy.retailSales).toBeGreaterThan(0);
    expect(result.economy.householdSpending).toBeGreaterThan(0);
    expect(result.tripRequests.some((trip) => trip.originBuildingId === "factory" && trip.destinationBuildingId === "shop"))
      .toBe(true);
    expect(result.tripRequests.every((trip) => trip.mode === "freight" && trip.cargoUnits > 0)).toBe(true);
    expect(result.economy.deliveriesCompleted).toBe(result.tripRequests.length);
  });

  it("imports deficits and exports industrial surplus deterministically", () => {
    const deficitBuildings = createBuildings().map((building) =>
      building.id === "factory" ? { ...building, productionRate: 0, goodsInventory: 0 } : building,
    );
    const deficitPopulation = createPopulation(deficitBuildings);
    const deficit = advanceEconomy({
      ...deficitPopulation,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });

    expect(deficit.economy.goodsImported).toBeGreaterThan(0);
    expect(deficit.tripRequests.some((trip) => trip.originBuildingId === "regional-entry" && trip.destinationBuildingId === "shop"))
      .toBe(true);

    const surplusBuildings = createBuildings().map((building) =>
      building.id === "factory" ? { ...building, productionRate: 40, goodsInventory: 20 } : building,
    );
    const surplusPopulation = createPopulation(surplusBuildings);
    const first = advanceEconomy({
      ...surplusPopulation,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });
    const second = advanceEconomy({
      ...surplusPopulation,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });

    expect(first).toEqual(second);
    expect(first.economy.goodsExported).toBeGreaterThan(0);
    expect(first.tripRequests.some((trip) => trip.destinationBuildingId === "regional-entry"))
      .toBe(true);
  });

  it("fills available jobs and lowers residential demand as rent burden rises", () => {
    const affordable = createPopulation(createBuildings(20));
    const expensive = createPopulation(createBuildings(900));
    const affordableResult = advanceEconomy({ ...affordable, cityMinute: 1440 });
    const expensiveResult = advanceEconomy({ ...expensive, cityMinute: 1440 });

    expect(affordableResult.economy.employedWorkers).toBeGreaterThan(0);
    expect(affordableResult.economy.availableJobs).toBeGreaterThanOrEqual(0);
    expect(affordableResult.economy.unemploymentPercent).toBeGreaterThanOrEqual(0);
    expect(expensiveResult.economy.averageRent).toBeGreaterThan(affordableResult.economy.averageRent);
    expect(expensiveResult.economy.zoneDemand.residential).toBeLessThan(
      affordableResult.economy.zoneDemand.residential,
    );
    expect(averageHappiness(expensiveResult.households)).toBeLessThan(
      averageHappiness(affordableResult.households),
    );
  });
});

function createBuildings(homeRent = 20): Building[] {
  return [
    building("home-a", "residential", 0, 0, { residentCapacity: 7, rent: homeRent }),
    building("home-b", "residential", 5, 0, { residentCapacity: 5, rent: homeRent }),
    building("shop", "commercial", 25, 0, { jobCapacity: 2, goodsInventory: 0 }),
    building("factory", "industrial", 40, 0, { jobCapacity: 3, productionRate: 18 }),
    building("school", "civic", 12, 10, { jobCapacity: 1 }),
    building("park", "park", 8, 8),
  ];
}

function building(
  id: string,
  zone: Building["zone"],
  x: number,
  z: number,
  overrides: Partial<Building> = {},
): Building {
  return {
    id,
    name: id,
    zone,
    x,
    z,
    floors: 1,
    maxFloors: 4,
    terrainSlope: 0,
    landValue: 100,
    rent: 0,
    residentCapacity: 0,
    residentIds: [],
    jobCapacity: 0,
    employeeIds: [],
    goodsInventory: 0,
    productionRate: 0,
    customerDemand: 0,
    utilityDemand: { power: 1, water: 1, waste: 1 },
    utilityService: { power: 1, water: 1, waste: 1 },
    efficiency: 1,
    pollution: 0,
    wasteStored: 0,
    ...overrides,
  };
}

function averageHappiness(households: ReadonlyArray<{ happiness: number }>): number {
  return households.reduce((total, household) => total + household.happiness, 0) / households.length;
}
