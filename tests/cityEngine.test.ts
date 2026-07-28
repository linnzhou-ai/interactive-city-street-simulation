import { describe, expect, it } from "vitest";
import { advanceCitySection } from "../src/core/cityEngine";
import { resolveProductionCapacity } from "../src/core/cityEconomy";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
  validateCitySectionDefinition,
} from "../src/core/cityModel";
import { calendarFromElapsedDays, cityMinutesPerSecond, formatClockTime, formatLongDate } from "../src/core/timeScale";
import type { CitySectionDefinition } from "../src/models/cityTypes";

describe("city section model", () => {
  it("creates a deterministic multi-district city section", () => {
    const first = createCitySectionState(createDemoCitySectionDefinition());
    const second = createCitySectionState(createDemoCitySectionDefinition());

    expect(first).toEqual(second);
    expect(first.districts).toHaveLength(12);
    expect(first.links).toHaveLength(17);
    expect(first.metrics.population).toBeGreaterThan(80_000);
    expect(new Set(first.districts.map((district) => district.primaryZone))).toEqual(
      new Set(["residential", "commercial", "industrial", "civic", "park"]),
    );
  });

  it("rejects duplicate or disconnected model input", () => {
    const definition = createDemoCitySectionDefinition();
    definition.links[0] = { ...definition.links[0]!, toDistrictId: "missing" };
    expect(() => validateCitySectionDefinition(definition)).toThrow(/Unknown district/);

    const duplicate = createDemoCitySectionDefinition();
    duplicate.districts[1] = { ...duplicate.districts[1]!, id: duplicate.districts[0]!.id };
    expect(() => validateCitySectionDefinition(duplicate)).toThrow(/Duplicate district/);
  });

  it("accepts a partner-provided city definition without engine changes", () => {
    const definition = customDefinition();
    const initial = createCitySectionState(definition);
    const result = advanceCitySection(initial, 30);

    expect(result.state.name).toBe("Partner Section");
    expect(result.state.districts.map((district) => district.id)).toEqual(["homes", "jobs"]);
    expect(result.state.elapsedDays).toBe(30);
    expect(result.state.metrics.population).toBeGreaterThan(0);
    expect(result.state.metrics.grossCityProductDaily).toBeGreaterThan(0);
  });

  it("produces the same annual state in one batch or daily steps", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const batch = advanceCitySection(initial, 365).state;
    let stepped = initial;
    for (let day = 0; day < 365; day += 1) stepped = advanceCitySection(stepped, 1).state;

    expect(batch).toEqual(stepped);
    expect(batch.year).toBe(2027);
    expect(batch.timeline.length).toBeGreaterThan(50);
    expect(batch.metrics.population).not.toBe(initial.metrics.population);
    expect(batch.metrics.averageLandValue).not.toBe(initial.metrics.averageLandValue);
  });

  it("propagates transport differences over a year", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const constrained = advanceCitySection(initial, 365, {
      roadCapacityScale: 0.55,
      transitServiceScale: 0.6,
    }).state;
    const supported = advanceCitySection(initial, 365, {
      roadCapacityScale: 1.35,
      transitServiceScale: 1.4,
    }).state;

    expect(constrained.metrics.congestionPercent).toBeGreaterThan(supported.metrics.congestionPercent);
    expect(constrained.metrics.averageTrafficDelayMinutes).toBeGreaterThan(supported.metrics.averageTrafficDelayMinutes);
    expect(constrained.metrics.congestionCostDaily).toBeGreaterThan(supported.metrics.congestionCostDaily);
    expect(constrained.metrics.happiness).toBeLessThan(supported.metrics.happiness);
    expect(constrained.metrics.population).toBeLessThan(supported.metrics.population);
  });

  it("turns household and business activity into market demand and trips", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const state = advanceCitySection(initial, 1).state;

    expect(state.market.demandDaily.food).toBeGreaterThan(0);
    expect(state.market.localSupplyDaily.consumerGoods).toBeGreaterThan(0);
    expect(state.metrics.householdIncomeDaily).toBeGreaterThan(0);
    expect(state.metrics.householdSpendingDaily).toBeGreaterThan(0);
    expect(state.metrics.householdSpendingDaily / state.metrics.households).toBeGreaterThan(50);
    expect(state.metrics.householdExpensesDaily.total).toBeCloseTo(state.metrics.householdSpendingDaily, 2);
    expect(state.metrics.householdExpensesDaily.goods).toBeGreaterThan(0);
    expect(state.metrics.householdExpensesDaily.transport).toBeGreaterThan(0);
    expect(state.metrics.businessRevenueDaily).toBeGreaterThan(0);
    expect(state.metrics.commuteTripsDaily).toBeGreaterThan(0);
    expect(state.metrics.shoppingTripsDaily).toBeGreaterThan(0);
    expect(state.metrics.freightTripsDaily).toBeGreaterThan(0);
    expect(state.districts.every((district) => district.householdWealth >= 0)).toBe(true);
  });

  it("does not classify housing, civic buildings, or parks as goods producers", () => {
    const definition = createDemoCitySectionDefinition();
    for (const district of definition.districts) {
      const capacity = resolveProductionCapacity(district);
      if (district.primaryZone === "commercial" || district.primaryZone === "industrial") {
        expect(Object.values(capacity).some((value) => value > 0)).toBe(true);
      } else {
        expect(capacity).toEqual({ food: 0, consumerGoods: 0, industrialMaterials: 0 });
      }
    }
  });

  it("stops city production, sales, and civic delivery without workers", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    initial.districts = initial.districts.map((district) => ({
      ...district,
      population: 0,
      households: 0,
      children: 0,
      adults: 0,
      seniors: 0,
      laborForce: 0,
      employedResidents: 0,
      householdWealth: 0,
    }));
    initial.externalMarkets = initial.externalMarkets.map((market) => ({
      ...market,
      commuterCapacityDaily: 0,
      externalJobs: 0,
    }));
    const state = advanceCitySection(initial, 1).state;

    expect(state.metrics.goodsProducedDaily).toBe(0);
    expect(state.metrics.goodsConsumedDaily).toBe(0);
    expect(state.metrics.businessRevenueDaily).toBe(0);
    expect(state.metrics.businessProfitDaily).toBeLessThan(0);
    expect(state.metrics.civicServiceCoveragePercent).toBe(0);
    expect(state.districts.every((district) => district.civicServiceDelivered === 0)).toBe(true);
  });

  it("reconciles city rent, civic-service, and municipal accounts", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const state = advanceCitySection(initial, 1).state;
    const rentIncome = state.districts.reduce(
      (total, district) => total + district.propertyRentIncomeDaily,
      0,
    );
    const civicCost = state.districts.reduce(
      (total, district) => total + district.civicOperatingCostDaily,
      0,
    );

    expect(state.metrics.propertyRentIncomeDaily).toBeCloseTo(rentIncome, 2);
    expect(state.metrics.civicOperatingCostDaily).toBeCloseTo(civicCost, 2);
    expect(state.metrics.civicServiceCoveragePercent).toBeGreaterThan(0);
    expect(state.metrics.civicServiceCoveragePercent).toBeLessThanOrEqual(100);
    expect(state.municipalBudget).toBeCloseTo(
      initial.municipalBudget + state.metrics.taxRevenueDaily
        - state.metrics.maintenanceCostDaily,
      2,
    );
  });

  it("keeps demand-gated civic staffing fiscally stable over two years", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const state = advanceCitySection(initial, 730).state;

    expect(state.metrics.civicOperatingCostDaily).toBeLessThan(
      state.metrics.taxRevenueDaily,
    );
    expect(state.municipalBudget).toBeGreaterThan(0);
    expect(state.municipalBudget).toBeLessThan(500_000_000);
    expect(state.metrics.civicServiceCoveragePercent).toBeGreaterThan(50);
  });

  it("turns constrained road capacity into delay and economic cost", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const constrained = advanceCitySection(initial, 2, { roadCapacityScale: 0.5 }).state;
    const expanded = advanceCitySection(initial, 2, { roadCapacityScale: 1.5 }).state;

    expect(constrained.metrics.congestionPercent).toBeGreaterThan(expanded.metrics.congestionPercent);
    expect(constrained.metrics.averageTrafficDelayMinutes).toBeGreaterThan(expanded.metrics.averageTrafficDelayMinutes);
    expect(constrained.metrics.congestionCostDaily).toBeGreaterThan(expanded.metrics.congestionCostDaily);
    expect(constrained.metrics.householdExpensesDaily.transport).toBeGreaterThan(
      expanded.metrics.householdExpensesDaily.transport,
    );
  });

  it("reports migration in, migration out, and net migration separately", () => {
    const state = advanceCitySection(createCitySectionState(createDemoCitySectionDefinition()), 30).state;

    expect(state.metrics.annualizedMigrationIn).toBeGreaterThanOrEqual(0);
    expect(state.metrics.annualizedMigrationOut).toBeGreaterThanOrEqual(0);
    expect(state.metrics.annualizedNetMigration).toBeCloseTo(
      state.metrics.annualizedMigrationIn - state.metrics.annualizedMigrationOut,
      2,
    );
    expect(state.metrics.annualizedMigrationIn + state.metrics.annualizedMigrationOut).toBeGreaterThan(0);
  });

  it("limits outside goods to each market's physical freight capacity", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    for (const district of initial.districts) {
      district.productionCapacity = { food: 0, consumerGoods: 0, industrialMaterials: 0 };
      district.goodsInventory = { food: 0, consumerGoods: 0, industrialMaterials: 0 };
    }
    for (const market of initial.externalMarkets) {
      market.freightCapacityDaily = 100;
      market.goodsSupplyDaily = { food: 1_000_000, consumerGoods: 1_000_000, industrialMaterials: 1_000_000 };
    }

    const state = advanceCitySection(initial, 1).state;
    for (const market of state.externalMarkets) {
      const freightUsed = market.importsDaily.food +
        market.importsDaily.consumerGoods * 0.7 +
        market.importsDaily.industrialMaterials * 1.6;
      expect(freightUsed).toBeLessThanOrEqual(market.freightCapacityDaily + 0.01);
    }
    expect(Object.values(state.market.unmetDemandDaily).some((amount) => amount > 0)).toBe(true);
  });

  it("charges more to supply the city from a more distant market", () => {
    const nearDefinition = createDemoCitySectionDefinition();
    const farDefinition = createDemoCitySectionDefinition();
    nearDefinition.externalMarkets![0]!.distanceKm = 10;
    farDefinition.externalMarkets![0]!.distanceKm = 150;
    nearDefinition.externalMarkets![1]!.freightCapacityDaily = 0;
    farDefinition.externalMarkets![1]!.freightCapacityDaily = 0;

    const near = advanceCitySection(createCitySectionState(nearDefinition), 1).state;
    const far = advanceCitySection(createCitySectionState(farDefinition), 1).state;

    expect(far.market.transportCostDaily).toBeGreaterThan(near.market.transportCostDaily);
    expect(far.market.consumerPriceIndex).toBeGreaterThan(near.market.consumerPriceIndex);
  });

  it("does not create unconfigured outside supplies", () => {
    const initial = createCitySectionState(customDefinition());
    for (const district of initial.districts) {
      district.productionCapacity = { food: 0, consumerGoods: 0, industrialMaterials: 0 };
      district.goodsInventory = { food: 0, consumerGoods: 0, industrialMaterials: 0 };
    }
    const state = advanceCitySection(initial, 1).state;

    expect(state.externalMarkets).toEqual([]);
    expect(state.market.importsDaily).toEqual({ food: 0, consumerGoods: 0, industrialMaterials: 0 });
    expect(Object.values(state.market.unmetDemandDaily).some((amount) => amount > 0)).toBe(true);
  });

  it("maps horizon presets and calendar dates", () => {
    expect(cityMinutesPerSecond("day")).toBe(60);
    expect(cityMinutesPerSecond("week")).toBe(360);
    expect(cityMinutesPerSecond("month")).toBe(1440);
    expect(cityMinutesPerSecond("year")).toBe(10080);
    expect(calendarFromElapsedDays(2026, 365)).toMatchObject({ year: 2027, month: 1, dayOfMonth: 1 });
    expect(formatLongDate(2026, 59)).toBe("Mar 1, 2026");
    expect(formatClockTime(7 * 60 + 5)).toBe("07:05");
    expect(formatClockTime(1500)).toBe("01:00");
  });
});

function customDefinition(): CitySectionDefinition {
  return {
    id: "partner-section",
    name: "Partner Section",
    startYear: 2030,
    startingBudget: 2_000_000,
    taxRate: 0.08,
    districts: [
      {
        id: "homes",
        name: "Homes",
        x: -20,
        z: 0,
        width: 30,
        depth: 30,
        primaryZone: "residential",
        terrainSlope: 0.04,
        maxFloorArea: 42_000,
        housingUnits: 900,
        commercialFloorArea: 3_000,
        industrialFloorArea: 0,
        civicFloorArea: 2_000,
        population: 2_000,
        jobs: 300,
        averageIncome: 52_000,
        landValue: 180,
        goodsProductionCapacity: 80,
      },
      {
        id: "jobs",
        name: "Jobs",
        x: 20,
        z: 0,
        width: 30,
        depth: 30,
        primaryZone: "commercial",
        terrainSlope: 0.03,
        maxFloorArea: 48_000,
        housingUnits: 150,
        commercialFloorArea: 22_000,
        industrialFloorArea: 8_000,
        civicFloorArea: 1_000,
        population: 400,
        jobs: 1_400,
        averageIncome: 66_000,
        landValue: 240,
        goodsProductionCapacity: 420,
      },
    ],
    links: [{
      id: "connector",
      fromDistrictId: "homes",
      toDistrictId: "jobs",
      distanceKm: 1.4,
      roadCapacityDaily: 8_000,
      transitCapacityDaily: 4_000,
      freightCapacityDaily: 1_200,
    }],
  };
}
