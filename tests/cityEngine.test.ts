import { describe, expect, it } from "vitest";
import { advanceCitySection } from "../src/core/cityEngine";
import {
  createCitySectionState,
  createDemoCitySectionDefinition,
  validateCitySectionDefinition,
} from "../src/core/cityModel";
import { calendarFromElapsedDays, cityMinutesPerSecond, formatLongDate } from "../src/core/timeScale";
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

  it("propagates small infrastructure and transport differences over a year", () => {
    const initial = createCitySectionState(createDemoCitySectionDefinition());
    const constrained = advanceCitySection(initial, 365, {
      utilityCapacityScale: 0.65,
      roadCapacityScale: 0.55,
      transitServiceScale: 0.6,
    }).state;
    const supported = advanceCitySection(initial, 365, {
      utilityCapacityScale: 1.35,
      roadCapacityScale: 1.35,
      transitServiceScale: 1.4,
    }).state;

    expect(constrained.metrics.utilityCoveragePercent).toBeLessThan(supported.metrics.utilityCoveragePercent);
    expect(constrained.metrics.congestionPercent).toBeGreaterThan(supported.metrics.congestionPercent);
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
    expect(state.metrics.businessRevenueDaily).toBeGreaterThan(0);
    expect(state.metrics.commuteTripsDaily).toBeGreaterThan(0);
    expect(state.metrics.shoppingTripsDaily).toBeGreaterThan(0);
    expect(state.metrics.freightTripsDaily).toBeGreaterThan(0);
    expect(state.districts.every((district) => district.householdWealth >= 0)).toBe(true);
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
  });
});

function customDefinition(): CitySectionDefinition {
  return {
    id: "partner-section",
    name: "Partner Section",
    startYear: 2030,
    startingBudget: 2_000_000,
    taxRate: 0.08,
    utilityCapacity: { power: 1_800, water: 1_600, waste: 620 },
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
