import { describe, expect, it } from "vitest";
import { advanceDetailedTime } from "../src/core/entitySimulation";
import { Simulation } from "../src/core/simulation";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";
import type { BuildingAccessibility } from "../src/models/entityTypes";

describe("University City entities", () => {
  it("assigns a function and stable identity to Main's rendered buildings", () => {
    expect(PENN_BUILDINGS.length).toBeGreaterThan(100);
    expect(new Set(PENN_BUILDINGS.map((building) => building.id)).size).toBe(
      PENN_BUILDINGS.length,
    );
    for (const requiredFunction of [
      "housing",
      "retail",
      "office",
      "industrial",
      "school",
      "library",
      "clinic",
      "recreation",
    ]) {
      expect(PENN_BUILDINGS.some((building) => building.function === requiredFunction)).toBe(true);
    }
  });

  it("creates inspectable residents, schedules, households, and connections", () => {
    const state = new Simulation().getState();

    expect(state.entities.buildings).toHaveLength(PENN_BUILDINGS.length);
    expect(state.entities.people.length).toBeGreaterThan(300);
    expect(state.entities.households.length).toBeGreaterThan(100);
    expect(state.entities.people.every((person) => person.schedule.length >= 3)).toBe(true);
    expect(state.entities.people.some((person) => person.employment === "external")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "work")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "visit")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "delivery")).toBe(true);
  });

  it("uses distinct accounting for businesses, housing, and civic services", () => {
    const buildings = new Simulation().getState().entities.buildings;
    const business = buildings.find((building) => building.function === "retail");
    const housing = buildings.find((building) => building.function === "housing");
    const civic = buildings.find((building) => building.function === "library");

    expect(business?.accounting.salesRevenue).toBeGreaterThanOrEqual(0);
    expect(business?.accounting.requiredWorkers).toBeGreaterThan(0);
    expect(housing?.accounting.rentIncome).toBeGreaterThan(0);
    expect(housing?.accounting.salesRevenue).toBe(0);
    expect(civic?.accounting.municipalFunding).toBeGreaterThan(0);
    expect(civic?.accounting.salesRevenue).toBe(0);
    expect(civic?.accounting.operatingRevenue).toBe(civic?.accounting.municipalFunding);
    expect(civic?.accounting.serviceDemand).toBeGreaterThan(0);
    const businesses = buildings.filter((building) =>
      ["retail", "office", "industrial", "parking"].includes(building.function),
    );
    expect(businesses.some((building) => building.accounting.profit > 0)).toBe(true);
    expect(businesses.some((building) => building.accounting.profit < 0)).toBe(true);
  });

  it("separates local and imported input costs from delivery costs", () => {
    const buildings = new Simulation().getState().entities.buildings;
    const supplyUsers = buildings.filter((building) => building.accounting.goodsReceived > 0);

    expect(supplyUsers.length).toBeGreaterThan(0);
    expect(supplyUsers.some((building) => building.accounting.importedSupplies > 0)).toBe(true);
    for (const building of supplyUsers) {
      expect(building.accounting.supplyCost).toBeCloseTo(
        building.accounting.localSupplyCost + building.accounting.importedSupplyCost,
        2,
      );
      expect(building.accounting.localSupplyCost).toBeGreaterThanOrEqual(0);
      expect(building.accounting.importedSupplyCost).toBeGreaterThanOrEqual(0);
      expect(building.accounting.transportCost).toBeGreaterThanOrEqual(0);
    }
  });

  it("advances detailed labor and accounting on long time scales", () => {
    const simulation = new Simulation();
    const initial = simulation.getState().entities.buildings.map((building) => ({
      id: building.id,
      wage: building.accounting.averageWage,
      price: building.accounting.unitPrice,
    }));
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(1);

    const state = simulation.getState();
    expect(state.entities.lastUpdatedDay).toBe(7);
    expect(state.entities.buildings.every((building) => Number.isFinite(building.accounting.profit))).toBe(true);
    expect(state.entities.people.every((person) => Number.isFinite(person.money))).toBe(true);
    expect(state.entities.buildings.every((building) =>
      building.employeeIds.length <= building.accounting.requiredWorkers)).toBe(true);
    expect(state.entities.buildings.some((building) => {
      const previous = initial.find((candidate) => candidate.id === building.id);
      return previous && building.accounting.averageWage !== previous.wage;
    })).toBe(true);
    expect(state.entities.buildings.some((building) => {
      const previous = initial.find((candidate) => candidate.id === building.id);
      return previous && building.accounting.unitPrice > 0 && building.accounting.unitPrice !== previous.price;
    })).toBe(true);
  });

  it("keeps staffing within the displayed requirement on every building", () => {
    const simulation = new Simulation();
    const initial = simulation.getState();
    expect(initial.entities.buildings.every((building) =>
      building.employeeIds.length <= building.accounting.requiredWorkers)).toBe(true);

    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(8);
    expect(simulation.getState().entities.buildings.every((building) =>
      building.employeeIds.length <= building.accounting.requiredWorkers)).toBe(true);
  });

  it("settles into balanced staffing, occupancy, margins, and transport costs", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(13);

    const buildings = simulation.getState().entities.buildings;
    const homes = buildings.filter((building) => building.function === "housing");
    const occupancy = homes.reduce((total, building) => total + building.residentIds.length, 0)
      / homes.reduce((total, building) => total + building.residentCapacity, 0);
    expect(occupancy).toBeGreaterThan(0.75);
    expect(occupancy).toBeLessThan(0.9);
    expect(buildings.every((building) =>
      building.employeeIds.length <= building.accounting.requiredWorkers)).toBe(true);

    for (const buildingFunction of [
      "industrial",
      "office",
      "retail",
      "housing",
      "parking",
      "university",
      "clinic",
      "school",
      "library",
      "culture",
      "recreation",
    ] as const) {
      const group = buildings.filter((building) => building.function === buildingFunction);
      const revenue = group.reduce((total, building) => total + building.accounting.operatingRevenue, 0);
      const profit = group.reduce((total, building) => total + building.accounting.profit, 0);
      const margin = profit / Math.max(1, revenue);
      expect(
        Math.abs(margin),
        `${buildingFunction} aggregate margin ${margin.toFixed(3)} (${profit.toFixed(0)} profit on ${revenue.toFixed(0)} revenue)`,
      ).toBeLessThan(0.25);
    }

    const freightUsers = buildings.filter((building) =>
      building.accounting.goodsReceived > 0 && building.function !== "housing");
    const freightCost = freightUsers.reduce((total, building) => total + building.accounting.transportCost, 0);
    const freightOperatingCost = freightUsers.reduce((total, building) => total + building.accounting.operatingCost, 0);
    expect(freightCost / freightOperatingCost).toBeGreaterThan(0.05);
    const retailers = buildings.filter((building) => building.function === "retail");
    const retailTransport = retailers.reduce((total, building) => total + building.accounting.transportCost, 0);
    const retailCosts = retailers.reduce((total, building) => total + building.accounting.operatingCost, 0);
    expect(retailTransport / retailCosts).toBeGreaterThan(0.1);
    const averageRetailPrice = retailers.reduce(
      (total, building) => total + building.accounting.unitPrice,
      0,
    ) / retailers.length;
    expect(averageRetailPrice).toBeGreaterThan(22);
    expect(averageRetailPrice).toBeLessThan(50);
    const privateBusinesses = buildings.filter((building) =>
      ["retail", "office", "industrial", "parking"].includes(building.function),
    );
    const privateRevenue = privateBusinesses.reduce(
      (total, building) => total + building.accounting.operatingRevenue,
      0,
    );
    const privateProfit = privateBusinesses.reduce(
      (total, building) => total + building.accounting.profit,
      0,
    );
    expect(privateProfit / Math.max(1, privateRevenue)).toBeGreaterThan(-0.08);
    expect(privateProfit / Math.max(1, privateRevenue)).toBeLessThan(0.18);
  });

  it("pays wages only on scheduled workdays and reconciles payroll", () => {
    const simulation = new Simulation();
    const initial = simulation.getState();
    const policy = {
      roadCapacityScale: 1,
      transitServiceScale: 1,
      zoningStrictness: 1,
      congestionPercent: initial.city.metrics.congestionPercent,
    };
    const weekend = advanceDetailedTime(initial.entities, initial.city, 5, 0, policy);
    const weekdayOnlyFunctions = new Set(["office", "industrial", "school", "university", "library"]);
    const weekdayOnlyWorkers = weekend.people.filter((person) => {
      const workplace = weekend.buildings.find((building) => building.id === person.workBuildingId);
      return workplace && weekdayOnlyFunctions.has(workplace.function);
    });

    expect(weekdayOnlyWorkers.length).toBeGreaterThan(0);
    expect(weekdayOnlyWorkers.every((person) => person.dailyWage === 0)).toBe(true);
    for (const building of weekend.buildings) {
      const paidToWorkers = weekend.people
        .filter((person) => person.workBuildingId === building.id)
        .reduce((total, person) => total + person.dailyWage, 0);
      expect(paidToWorkers).toBeCloseTo(building.accounting.dailyWages, 2);
    }

    const nextWeekday = advanceDetailedTime(weekend, initial.city, 7, 0, policy);
    expect(nextWeekday.people.some((person) => {
      const workplace = nextWeekday.buildings.find((building) => building.id === person.workBuildingId);
      return workplace && weekdayOnlyFunctions.has(workplace.function) && person.dailyWage > 0;
    })).toBe(true);
  });

  it("reconciles household purchases and rent with building receipts", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(1);
    const state = simulation.getState().entities;
    const householdPurchases = state.households.reduce(
      (total, household) => total + household.dailyExpenses.goods + household.dailyExpenses.services,
      0,
    );
    const localBusinessReceipts = state.buildings.reduce(
      (total, building) => total + building.accounting.localSalesRevenue,
      0,
    );
    const householdGoods = state.households.reduce((total, household) => total + household.dailyExpenses.goods, 0);
    const householdServices = state.households.reduce((total, household) => total + household.dailyExpenses.services, 0);
    const retailReceipts = state.buildings
      .filter((building) => building.function === "retail")
      .reduce((total, building) => total + building.accounting.localSalesRevenue, 0);
    const serviceReceipts = localBusinessReceipts - retailReceipts;
    const householdRent = state.households.reduce(
      (total, household) => total + household.dailyExpenses.housing,
      0,
    );
    const buildingRent = state.buildings.reduce(
      (total, building) => total + building.accounting.rentIncome,
      0,
    );

    expect(
      Math.abs(householdPurchases - localBusinessReceipts),
      `${householdGoods.toFixed(2)}/${householdServices.toFixed(2)} household goods/services versus ${retailReceipts.toFixed(2)}/${serviceReceipts.toFixed(2)} local receipts`,
    ).toBeLessThan(10);
    expect(householdRent).toBeCloseTo(buildingRent, 2);
  });

  it("prevents negative cash and applies visible financial-distress consequences", () => {
    const simulation = new Simulation();
    const initial = simulation.getState();
    const entities = structuredClone(initial.entities);
    const household = entities.households.find((candidate) => candidate.memberIds.some((id) => {
      const personNumber = Number(id.replace("person-", ""));
      return [3, 5].includes((personNumber + 1) % 7);
    }));
    expect(household).toBeDefined();
    if (!household) return;
    const home = entities.buildings.find((building) => building.id === household.homeBuildingId);
    expect(home).toBeDefined();
    if (!home) return;
    household.money = -500;
    household.debt = 1_500;
    household.rentArrears = home.rentDaily * 8;
    household.financialStatus = "crisis";
    household.lastMovedDay = 1;

    const advanced = advanceDetailedTime(entities, initial.city, 1, 0, {
      roadCapacityScale: 1,
      transitServiceScale: 1,
      zoningStrictness: 1,
      congestionPercent: initial.city.metrics.congestionPercent,
    });
    const stressed = advanced.households.find((candidate) => candidate.id === household.id);
    const members = advanced.people.filter((person) => household.memberIds.includes(person.id));

    expect(stressed?.money).toBeGreaterThanOrEqual(0);
    expect(stressed?.debt).toBeGreaterThan(0);
    expect(stressed?.assistanceReceived).toBeGreaterThan(0);
    expect(["distressed", "crisis"]).toContain(stressed?.financialStatus);
    expect(members.every((person) => person.money >= 0)).toBe(true);
    expect(members.every((person) => !person.schedule.some((item) => item.activity === "leisure"))).toBe(true);
  });

  it("calculates happiness from the five displayed weighted components", () => {
    const people = new Simulation().getState().entities.people;
    for (const person of people) {
      const components = person.happinessComponents;
      const expected = components.needs * 0.35
        + components.financialSecurity * 0.25
        + components.employment * 0.15
        + components.housing * 0.15
        + components.travel * 0.1;
      expect(person.happiness).toBeCloseTo(expected, 0);
    }
  });

  it("builds visit flows from actual consecutive schedule locations", () => {
    const entities = new Simulation().getState().entities;
    const peopleById = new Map(entities.people.map((person) => [person.id, person]));
    const workToVisit = entities.connections.find((connection) =>
      connection.kind === "visit" && connection.personIds.some((personId) => {
        const schedule = peopleById.get(personId)?.schedule ?? [];
        return schedule.some((item, index) => index > 0
          && schedule[index - 1].activity === "work"
          && schedule[index - 1].buildingId === connection.fromBuildingId
          && item.buildingId === connection.toBuildingId);
      })
    );

    expect(workToVisit).toBeDefined();
    expect(workToVisit?.fromBuildingId).not.toBe(workToVisit?.toBuildingId);
  });

  it("reports work, visit, and delivery vehicle demand separately", () => {
    const simulation = new Simulation();
    const state = simulation.getState();
    const building = state.entities.buildings.find((candidate) =>
      state.entities.connections.some((connection) =>
        connection.kind === "delivery"
        && (connection.fromBuildingId === candidate.id || connection.toBuildingId === candidate.id)
      )
    );
    expect(building).toBeDefined();
    if (!building) return;
    const traffic = simulation.getBuildingTrafficAttribution(building.id);

    expect(traffic).not.toBeNull();
    expect(traffic?.workVehicleTripsDaily).toBeGreaterThanOrEqual(0);
    expect(traffic?.visitVehicleTripsDaily).toBeGreaterThanOrEqual(0);
    expect(traffic?.deliveryVehicleTripsDaily).toBeGreaterThan(0);
    expect(traffic?.roadTripsDaily).toBeGreaterThanOrEqual(
      (traffic?.workVehicleTripsDaily ?? 0)
        + (traffic?.visitVehicleTripsDaily ?? 0)
        + (traffic?.deliveryVehicleTripsDaily ?? 0),
    );
  });

  it("lets distressed private businesses cut operations and defer maintenance", () => {
    const simulation = new Simulation();
    const city = simulation.getState().city;
    const entities = structuredClone(simulation.getState().entities);
    const retailer = entities.buildings.find((building) => building.function === "retail");
    expect(retailer).toBeDefined();
    if (!retailer) return;
    retailer.cashReserve = -2_000;
    retailer.accounting.lossStreak = 5;
    retailer.accounting.profit = -800;
    retailer.accounting.operatingRevenue = 300;
    retailer.accounting.operatingScale = 1;
    retailer.accounting.buildingCondition = 1;

    const advanced = advanceDetailedTime(entities, city, 1, 0, {
      roadCapacityScale: 1,
      transitServiceScale: 1,
      zoningStrictness: 1,
      congestionPercent: city.metrics.congestionPercent,
    });
    const stressed = advanced.buildings.find((building) => building.id === retailer.id);

    expect(stressed?.accounting.operatingScale).toBeLessThan(1);
    expect(stressed?.accounting.maintenanceDeferred).toBeGreaterThan(0);
    expect(stressed?.accounting.buildingCondition).toBeLessThan(1);
    expect(stressed?.accounting.requiredWorkers).toBeLessThanOrEqual(retailer.accounting.requiredWorkers);
  });

  it("lets households relocate to preferred available housing without exceeding capacity", () => {
    const simulation = new Simulation();
    const city = simulation.getState().city;
    const entities = structuredClone(simulation.getState().entities);
    const household = entities.households[0];
    const originalHome = entities.buildings.find((building) => building.id === household.homeBuildingId);
    expect(originalHome).toBeDefined();
    if (!originalHome) return;
    originalHome.rentDaily = 95;
    originalHome.landValue = 80;
    household.money = -1_000;
    household.rentArrears = 1_000;
    household.lastMovedDay = -100;
    for (const home of entities.buildings.filter((building) => building.function === "housing" && building.id !== originalHome.id)) {
      home.rentDaily = 22;
      home.landValue = 520;
    }

    const advanced = advanceDetailedTime(entities, city, 1, 0, {
      roadCapacityScale: 1,
      transitServiceScale: 1,
      zoningStrictness: 1,
      congestionPercent: city.metrics.congestionPercent,
    });
    const moved = advanced.households.find((candidate) => candidate.id === household.id);
    expect(moved?.homeBuildingId).not.toBe(originalHome.id);
    expect(moved?.moveReason).toMatch(/rent|commute|access/);
    expect(advanced.buildings.every((building) =>
      building.residentIds.length <= building.residentCapacity)).toBe(true);
  });

  it("directs shopping visits toward businesses with preferred prices and availability", () => {
    const simulation = new Simulation();
    const city = simulation.getState().city;
    const entities = structuredClone(simulation.getState().entities);
    const retailers = entities.buildings.filter((building) => building.function === "retail");
    const preferred = retailers[0];
    expect(preferred).toBeDefined();
    if (!preferred) return;
    for (const retailer of retailers) {
      retailer.accounting.unitPrice = retailer.id === preferred.id ? 1 : 100;
      retailer.goodsInventory = 100;
      retailer.closedDaysRemaining = 0;
      retailer.accounting.status = "operating";
    }

    const advanced = advanceDetailedTime(entities, city, 1, 0, {
      roadCapacityScale: 1,
      transitServiceScale: 1,
      zoningStrictness: 1,
      congestionPercent: city.metrics.congestionPercent,
    });
    const visits = new Map<string, number>();
    for (const person of advanced.people) {
      const shop = person.schedule.find((item) => item.activity === "shop");
      if (shop) visits.set(shop.buildingId, (visits.get(shop.buildingId) ?? 0) + 1);
    }
    expect(visits.get(preferred.id) ?? 0).toBe(Math.max(...visits.values()));
  });

  it("uses accessibility to change customer reach and freight cost", () => {
    const simulation = new Simulation();
    const city = simulation.getState().city;
    const entities = structuredClone(simulation.getState().entities);
    const profile = (score: number): BuildingAccessibility => ({
      overall: score,
      workers: score,
      customers: score,
      freight: score,
      services: score,
      averageTravelMinutes: score > 50 ? 4 : 24,
      congestionPenalty: 100 - score,
      transitBonus: score > 50 ? 12 : 0,
    });
    const advanceWithAccess = (score: number) => advanceDetailedTime(
      structuredClone(entities),
      city,
      1,
      0,
      {
        roadCapacityScale: 1,
        transitServiceScale: 1,
        zoningStrictness: 1,
        congestionPercent: 35,
        accessibilityByBuilding: new Map(
          entities.buildings.map((building) => [building.id, profile(score)]),
        ),
        externalJobCapacityScale: 1,
        externalSupplyScale: 1,
      },
    );
    const accessible = advanceWithAccess(95);
    const isolated = advanceWithAccess(25);
    const privateFunctions = new Set(["retail", "culture", "recreation", "parking"]);
    const accessibleCustomers = accessible.buildings
      .filter((building) => privateFunctions.has(building.function))
      .reduce((total, building) => total + building.accounting.customers, 0);
    const isolatedCustomers = isolated.buildings
      .filter((building) => privateFunctions.has(building.function))
      .reduce((total, building) => total + building.accounting.customers, 0);
    const freightUnitCost = (buildings: typeof accessible.buildings): number => {
      const freightUsers = buildings.filter((building) => building.accounting.goodsReceived > 0);
      return freightUsers.reduce((total, building) => total + building.accounting.transportCost, 0)
        / freightUsers.reduce((total, building) => total + building.accounting.goodsReceived, 0);
    };

    expect(accessibleCustomers).toBeGreaterThan(isolatedCustomers);
    expect(freightUnitCost(accessible.buildings)).toBeLessThan(freightUnitCost(isolated.buildings));
  });

  it("publishes bounded accessibility profiles for every building", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(1);

    for (const building of simulation.getState().entities.buildings) {
      expect(building.accessibility.overall).toBeGreaterThanOrEqual(0);
      expect(building.accessibility.overall).toBeLessThanOrEqual(100);
      expect(building.accessibility.averageTravelMinutes).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps bounded daily histories for inspectable statistics", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(4);

    const state = simulation.getState();
    const building = state.entities.buildings.find((candidate) => candidate.function === "retail");
    const person = state.entities.people.find((candidate) => candidate.employment === "local");
    const household = state.entities.households[0];

    expect(building?.history).toHaveLength(24);
    expect(person?.history).toHaveLength(24);
    expect(household?.history).toHaveLength(24);
    expect(building?.history.at(-1)?.day).toBe(28);
    expect(person?.history.every((point) => Number.isFinite(point.happiness))).toBe(true);
    expect(household?.history.every((point) => Number.isFinite(point.totalExpenses))).toBe(true);
  });
});
