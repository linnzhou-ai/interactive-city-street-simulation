import { describe, expect, it } from "vitest";
import { advanceEconomy } from "../src/core/economy";
import { advancePopulation, createPopulation } from "../src/core/population";
import { deriveBuildingConnections } from "../src/core/observability";
import { createInitialInfrastructure, updateInfrastructure } from "../src/core/infrastructure";
import { createInitialLandUse } from "../src/core/landUse";
import { OUTSIDE_COMMUTER_BUILDING_ID } from "../src/core/network";
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
    expect(first.people.every((person) => person.name.trim().split(" ").length === 2)).toBe(true);
    expect(new Set(first.people.map((person) => person.name)).size).toBe(first.people.length);
    expect(first.people.filter((person) => person.ageGroup === "child").every((person) => person.schoolBuildingId === "school"))
      .toBe(true);
    expect(first.people.filter((person) => person.ageGroup === "adult").some((person) => person.workBuildingId !== undefined))
      .toBe(true);
    expect(first.people.every((person) => Object.values(person.needs).every((need) => need >= 0 && need <= 1)))
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
    expect(driving.tripRequests[0]?.travelerAgeGroup).toBe("adult");
    expect(transit.tripRequests[0]?.mode).toBe("bus");
    expect(advancePopulation(driving.people, 480, population.buildings, {
      busAvailable: false,
      congestion: 0,
      parkingPressure: 0,
    }).tripRequests).toEqual([]);
  });

  it("schedules school, library, health, and recreation visits from resident needs", () => {
    const population = createPopulation(createInitialLandUse().buildings);
    const scheduledActivities = new Set(population.people.flatMap((person) =>
      person.schedule.map((entry) => entry.activity)
    ));

    expect(scheduledActivities).toEqual(new Set([
      "home",
      "work",
      "school",
      "shopping",
      "library",
      "healthcare",
      "leisure",
    ]));
    expect(population.people.filter((person) => person.ageGroup === "child").every((person) =>
      person.schedule.some((entry) => entry.activity === "school")
    )).toBe(true);
    expect(population.people.filter((person) => person.ageGroup !== "child").some((person) =>
      person.schedule.some((entry) => entry.activity === "library")
    )).toBe(true);
  });

  it("uses weekend schedules without work or school obligations", () => {
    const population = createPopulation(createInitialLandUse().buildings);
    const weekend = advancePopulation(population.people, 2 * 1440 + 600, population.buildings, {
      busAvailable: true,
      congestion: 0,
      parkingPressure: 0,
    });

    expect(weekend.people.every((person) => person.scheduleDay === 2)).toBe(true);
    expect(weekend.people.every((person) =>
      person.schedule.every((entry) => entry.activity !== "work" && entry.activity !== "school")
    )).toBe(true);
    expect(weekend.people.some((person) =>
      person.schedule.some((entry) => entry.activity === "library" || entry.activity === "leisure")
    )).toBe(true);
  });

  it("reduces a need when the resident reaches the matching service", () => {
    const population = createPopulation(createInitialLandUse().buildings);
    const visitor = population.people.find((person) =>
      person.schedule.some((entry) => entry.activity === "library")
    )!;
    const libraryVisit = visitor.schedule.find((entry) => entry.activity === "library")!;
    const before = visitor.needs.community;
    const update = advancePopulation([visitor], libraryVisit.startMinute, population.buildings, {
      busAvailable: true,
      congestion: 0,
      parkingPressure: 0,
    });

    expect(update.people[0]?.currentActivity).toBe("library");
    expect(update.people[0]?.needs.community).toBeLessThan(before);
    expect(update.tripRequests[0]?.destinationBuildingId).toBe(libraryVisit.buildingId);
  });

  it("connects every occupied home to at least one scheduled civic service", () => {
    const population = createPopulation(createInitialLandUse().buildings);
    const connections = deriveBuildingConnections(population.people, []);
    const buildingById = new Map(population.buildings.map((building) => [building.id, building]));
    const civicOrigins = new Set(connections
      .filter((connection) => {
        const destination = buildingById.get(connection.toBuildingId);
        return connection.kind === "customer"
          && (destination?.zone === "civic" || destination?.zone === "park");
      })
      .map((connection) => connection.fromBuildingId));
    const occupiedHomes = population.buildings.filter((building) => building.residentIds.length > 0);

    expect(occupiedHomes.every((home) => civicOrigins.has(home.id))).toBe(true);
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

  it("reconciles each inspectable building ledger to the economy flow", () => {
    const population = createPopulation(createBuildings());
    const result = advanceEconomy({
      ...population,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });
    const shop = result.buildings.find((building) => building.id === "shop")!;
    const accounting = shop.accounting!;

    expect(accounting).toBeDefined();
    expect(accounting.goodsReceived).toBeCloseTo(
      accounting.localSupplies + accounting.importedSupplies,
      8,
    );
    expect(accounting.transportCost).toBeGreaterThan(0);
    expect(accounting.goodsSold).toBeGreaterThan(0);
    expect(accounting.revenue).toBeCloseTo(accounting.goodsSold * accounting.unitPrice, 1);
    expect(accounting.operatingCost).toBeCloseTo(
      accounting.dailyWages + accounting.supplyCost + accounting.transportCost
        + accounting.occupancyCost + accounting.maintenanceCost + accounting.utilityCost,
      2,
    );
    expect(accounting.profit).toBeCloseTo(accounting.revenue - accounting.operatingCost, 2);
    expect(accounting.customers).toBeGreaterThan(0);
  });

  it("groups schedules and freight orders into inspectable building relationships", () => {
    const population = createPopulation(createBuildings());
    const economy = advanceEconomy({
      ...population,
      cityMinute: 1440,
      freightEntryBuildingId: "regional-entry",
    });
    const connections = deriveBuildingConnections(economy.people, economy.tripRequests);

    expect(connections.some((connection) => connection.kind === "commute" && connection.personIds.length > 0))
      .toBe(true);
    expect(connections.some((connection) => connection.kind === "customer" && connection.personIds.length > 0))
      .toBe(true);
    expect(connections.some((connection) => connection.kind === "supply" && connection.volume > 0))
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

  it("stops production and sales when no workers are available", () => {
    const population = createPopulation(createBuildings());
    const people = population.people.map((person) => ({
      ...person,
      ageGroup: "senior" as const,
      workBuildingId: undefined,
    }));
    const result = advanceEconomy({ ...population, people, cityMinute: 1440 });
    const shop = result.buildings.find((building) => building.id === "shop")!;
    const factory = result.buildings.find((building) => building.id === "factory")!;

    expect(result.economy.goodsProduced).toBe(0);
    expect(result.economy.retailSales).toBe(0);
    expect(result.economy.goodsImported).toBe(0);
    expect(shop.accounting?.revenue).toBe(0);
    expect(shop.accounting?.profit).toBeLessThan(0);
    expect(factory.accounting?.revenue).toBe(0);
    expect(factory.accounting?.profit).toBeLessThan(0);
  });

  it("reconciles rent, utilities, and civic services by operating model", () => {
    const population = createPopulation(createBuildings());
    const result = advanceEconomy({ ...population, cityMinute: 1440 });
    const homes = result.buildings.filter((building) => building.buildingUse === "housing");
    const school = result.buildings.find((building) => building.buildingUse === "school")!;
    const rentIncome = homes.reduce((total, home) => total + (home.accounting?.rentIncome ?? 0), 0);
    const utilityPayments = result.buildings.reduce(
      (total, item) => total + (item.accounting?.utilityCost ?? 0),
      0,
    );

    expect(result.economy.propertyRentIncome).toBeCloseTo(rentIncome, 3);
    expect(result.economy.utilityPayments).toBeCloseTo(utilityPayments, 3);
    expect(homes.every((home) => home.accounting?.operatingModel === "housing")).toBe(true);
    expect(school.accounting?.operatingModel).toBe("civic");
    expect(school.accounting?.serviceDelivered).toBeGreaterThan(0);
    expect(school.accounting?.municipalFunding).toBe(school.accounting?.operatingCost);
    expect(school.accounting?.profit).toBe(0);
    for (const household of result.households) {
      const personalCash = result.people
        .filter((person) => person.householdId === household.id)
        .reduce((total, person) => total + person.money, 0);
      expect(personalCash).toBeCloseTo(household.money, 2);
    }
  });

  it("matches occupied building utility bills to provider revenue", () => {
    const population = createPopulation(createBuildings());
    const firstDay = advanceEconomy({ ...population, cityMinute: 1440 });
    const infrastructure = createInitialInfrastructure(firstDay.buildings);
    const serviced = updateInfrastructure(firstDay.buildings, infrastructure, { elapsedDays: 1 });
    const secondDay = advanceEconomy({
      households: firstDay.households,
      people: firstDay.people,
      buildings: serviced.buildings,
      cityMinute: 2880,
    });
    const providerRevenue = Object.values(serviced.infrastructure.state.utilities)
      .reduce((total, utility) => total + utility.revenueDaily, 0);

    expect(secondDay.economy.utilityPayments).toBeCloseTo(providerRevenue, 2);
  });

  it("derives civic service demand from scheduled visitors", () => {
    const population = createPopulation(createInitialLandUse().buildings);
    const result = advanceEconomy({ ...population, cityMinute: 1440 });
    const expected = {
      school: result.people.filter((person) => person.schedule.some((entry) => entry.activity === "school")).length,
      library: result.people.filter((person) => person.schedule.some((entry) => entry.activity === "library")).length,
      clinic: result.people.filter((person) => person.schedule.some((entry) => entry.activity === "healthcare")).length,
      park: result.people.filter((person) => person.schedule.some((entry) => entry.activity === "leisure")).length,
    };
    const demandFor = (use: Building["buildingUse"]): number => result.buildings
      .filter((building) => building.buildingUse === use)
      .reduce((total, building) => total + (building.accounting?.serviceDemand ?? 0), 0);

    expect(demandFor("school")).toBe(expected.school);
    expect(demandFor("library")).toBe(expected.library);
    expect(demandFor("clinic")).toBe(expected.clinic);
    expect(demandFor("park")).toBe(expected.park);
  });

  it("raises retail prices under scarcity and lowers them when shelves are well supplied", () => {
    const scarce = createPopulation(createBuildings().map((candidate) =>
      candidate.id === "shop" ? { ...candidate, goodsInventory: 0 } : candidate
    ));
    const abundant = createPopulation(createBuildings().map((candidate) =>
      candidate.id === "shop" ? { ...candidate, goodsInventory: 500 } : candidate
    ));
    const scarceResult = advanceEconomy({ ...scarce, cityMinute: 1440 });
    const abundantResult = advanceEconomy({ ...abundant, cityMinute: 1440 });
    const scarcePrice = scarceResult.buildings.find((candidate) => candidate.id === "shop")!.retailPrice!;
    const abundantPrice = abundantResult.buildings.find((candidate) => candidate.id === "shop")!.retailPrice!;

    expect(scarcePrice).toBeGreaterThan(abundantPrice);
    expect(scarceResult.economy.averageRetailPrice).toBe(scarcePrice);
  });

  it("raises wage offers when planned positions are scarce relative to available workers", () => {
    const population = createPopulation(createBuildings());
    const adults = population.people.filter((person) => person.ageGroup === "adult");
    const tight = advanceEconomy({
      ...population,
      people: adults.slice(0, 2),
      cityMinute: 1440,
    });
    const loose = advanceEconomy({ ...population, cityMinute: 1440 });
    const factoryOffer = (result: typeof tight): number => result.buildings
      .find((candidate) => candidate.id === "factory")!.wageOffer!;

    expect(factoryOffer(tight)).toBeGreaterThan(factoryOffer(loose));
  });

  it("reduces asking rent when tenant arrears show that the current rent is unaffordable", () => {
    const stable = createPopulation(createBuildings(20));
    const distressed = createPopulation(createBuildings(20));
    distressed.households = distressed.households.map((household) => ({
      ...household,
      rentArrears: 1_000,
      unaffordableDays: 10,
    }));
    const stableResult = advanceEconomy({ ...stable, cityMinute: 1440 });
    const distressedResult = advanceEconomy({ ...distressed, cityMinute: 1440 });
    const stableRent = stableResult.buildings.find((candidate) => candidate.id === "home-a")!.rent;
    const distressedRent = distressedResult.buildings.find((candidate) => candidate.id === "home-a")!.rent;

    expect(distressedRent).toBeLessThan(stableRent);
  });

  it("closes a business only after sustained losses deplete its reserve", () => {
    const population = createPopulation(createBuildings().map((candidate) =>
      candidate.id === "shop"
        ? { ...candidate, cashReserve: 0, unprofitableDays: 13, goodsInventory: 0 }
        : candidate
    ));
    const noWorkers = population.people.map((person) => ({
      ...person,
      ageGroup: "senior" as const,
      workBuildingId: undefined,
      employmentStatus: "not-in-labor-force" as const,
    }));
    const result = advanceEconomy({ ...population, people: noWorkers, cityMinute: 1440 });
    const shop = result.buildings.find((candidate) => candidate.id === "shop")!;

    expect(shop.closedDaysRemaining).toBe(30);
    expect(shop.accounting?.operatingStatus).toBe("closed");
    expect(result.economy.businessClosures).toBeGreaterThan(0);
    expect(result.events.some((event) => event.includes("closed after"))).toBe(true);
  });

  it("uses finite outside job capacity and records the commute cost", () => {
    const population = createPopulation(createBuildings().map((candidate) => ({
      ...candidate,
      jobCapacity: 0,
    })));
    const result = advanceEconomy({
      ...population,
      cityMinute: 1440,
      externalLaborMarket: {
        name: "Regional Employment Center",
        jobCapacity: 2,
        dailyWage: 200,
        commuteCostDaily: 8,
      },
    });
    const externalWorkers = result.people.filter((person) => person.employmentStatus === "external");

    expect(externalWorkers).toHaveLength(2);
    expect(result.economy.externalWorkers).toBe(2);
    expect(externalWorkers.every((person) => person.workBuildingId === OUTSIDE_COMMUTER_BUILDING_ID)).toBe(true);
    expect(externalWorkers.every((person) => person.commuteCostDaily === 8)).toBe(true);
    expect(result.economy.unemploymentPercent).toBeGreaterThan(0);

    const commute = advancePopulation([externalWorkers[0]!], 1440 + 480, result.buildings, {
      busAvailable: true,
      congestion: 0,
      parkingPressure: 0,
      startYear: 2026,
    });
    expect(commute.people[0]?.schedule.some((entry) =>
      entry.activity === "work" && entry.buildingId === OUTSIDE_COMMUTER_BUILDING_ID
    )).toBe(true);
    expect(commute.tripRequests[0]).toMatchObject({
      destinationBuildingId: OUTSIDE_COMMUTER_BUILDING_ID,
      mode: "car",
      purpose: "work",
    });
  });

  it("lays off workers when a business closes or cuts its open positions", () => {
    const population = createPopulation(createBuildings());
    const factoryWorkers = population.people.filter((person) => person.workBuildingId === "factory");
    const buildings = population.buildings.map((candidate) =>
      candidate.id === "factory"
        ? { ...candidate, closedDaysRemaining: 5 }
        : candidate
    );
    const result = advanceEconomy({ ...population, buildings, cityMinute: 1440 });
    const factory = result.buildings.find((candidate) => candidate.id === "factory")!;

    expect(factoryWorkers.length).toBeGreaterThan(0);
    expect(factory.employeeIds).toHaveLength(0);
    expect(result.economy.layoffs).toBeGreaterThanOrEqual(factoryWorkers.length);
    expect(result.events.some((event) => event.includes("laid off"))).toBe(true);
  });

  it("moves out households only after sustained rent hardship", () => {
    const population = createPopulation(createBuildings(100));
    const household = population.households[0]!;
    const members = population.people.filter((person) => person.householdId === household.id);
    const distressedHousehold = {
      ...household,
      money: 0,
      rentArrears: 1_000,
      unaffordableDays: 29,
    };
    const result = advanceEconomy({
      households: [distressedHousehold],
      people: members,
      buildings: population.buildings.map((candidate) => ({ ...candidate, jobCapacity: 0 })),
      cityMinute: 1440,
    });

    expect(result.households).toHaveLength(0);
    expect(result.people).toHaveLength(0);
    expect(result.economy.householdsMovedOut).toBe(1);
    expect(result.economy.residentsMovedOut).toBe(members.length);
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
    buildingUse: zone === "residential"
      ? "housing"
      : zone === "commercial"
        ? "retail"
        : zone === "industrial"
          ? "industrial"
          : zone === "park"
            ? "park"
            : id === "school"
              ? "school"
              : "library",
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
