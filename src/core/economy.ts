import type {
  Building,
  EconomyState,
  Household,
  IncomeBand,
  Person,
  TripRequest,
} from "../models/types";

export interface EconomyStepInput {
  households: readonly Household[];
  people: readonly Person[];
  buildings: readonly Building[];
  cityMinute: number;
  freightEntryBuildingId?: string;
}

export interface EconomyStepResult {
  households: Household[];
  people: Person[];
  buildings: Building[];
  tripRequests: TripRequest[];
  economy: EconomyState;
}

const DAILY_WAGE: Record<IncomeBand, number> = {
  low: 90,
  middle: 150,
  high: 240,
};
const RETAIL_PRICE = 10;
const EXPORT_PRICE = 6;

export function advanceEconomy(input: EconomyStepInput): EconomyStepResult {
  const people = input.people.map(clonePerson).sort(compareIds);
  const households = input.households.map((household) => ({ ...household, memberIds: [...household.memberIds] }));
  const buildings = input.buildings.map(cloneBuilding);
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));
  const householdsById = new Map(households.map((household) => [household.id, household]));
  const freightEntry = input.freightEntryBuildingId ?? "regional-freight-entry";
  const createdMinute = Math.floor(input.cityMinute);
  const tripRequests: TripRequest[] = [];

  assignEmployment(people, buildings, buildingsById);
  const dailyHouseholdIncome = payHouseholds(people, householdsById);

  let goodsProduced = 0;
  for (const building of buildings) {
    if (building.zone !== "industrial") continue;
    const produced = round(Math.max(0, building.productionRate * clamp(building.efficiency, 0, 1.5)));
    building.goodsInventory = round(building.goodsInventory + produced);
    goodsProduced = round(goodsProduced + produced);
  }

  const shops = buildings.filter((building) => building.zone === "commercial").sort(compareIds);
  for (const shop of shops) shop.customerDemand = 0;
  for (const household of households) {
    const home = buildingsById.get(household.homeBuildingId);
    const shop = home === undefined ? undefined : nearestBuilding(home, shops);
    if (shop !== undefined) shop.customerDemand = round(shop.customerDemand + household.consumptionNeed);
  }

  const supply = supplyRetailers(
    buildings,
    shops,
    freightEntry,
    createdMinute,
    tripRequests,
  );
  const retail = serveHouseholds(households, shops, buildingsById, dailyHouseholdIncome);
  const employment = calculateEmployment(people, buildings);
  const averageRent = average(
    buildings.filter((building) => building.zone === "residential").map((building) => building.rent),
  );
  const householdIncome = [...dailyHouseholdIncome.values()];
  const averageDailyIncome = average(householdIncome);
  const residentialCapacity = buildings.reduce(
    (total, building) => total + (building.zone === "residential" ? building.residentCapacity : 0),
    0,
  );
  const housingOccupancy = residentialCapacity === 0 ? 0 : people.length / residentialCapacity;
  const employmentRate = employment.workers === 0 ? 0 : employment.employed / employment.workers;
  const rentBurden = averageRent / Math.max(1, averageDailyIncome);
  const economy: EconomyState = {
    goodsProduced,
    goodsConsumed: retail.goodsConsumed,
    goodsImported: supply.imported,
    goodsExported: supply.exported,
    deliveriesCompleted: supply.deliveries,
    retailSales: retail.unitsSold,
    householdSpending: retail.spending,
    businessRevenue: round(retail.spending + supply.exported * EXPORT_PRICE),
    availableJobs: employment.availableJobs,
    employedWorkers: employment.employed,
    unemploymentPercent: round(employment.workers === 0 ? 0 : ((employment.workers - employment.employed) / employment.workers) * 100),
    averageRent: round(averageRent),
    zoneDemand: {
      residential: round(clamp(20 + employmentRate * 50 + housingOccupancy * 20 - rentBurden * 25, 0, 100)),
      commercial: round(clamp(20 + retail.unitsSold * 4 + (supply.imported > 0 ? 10 : 0), 0, 100)),
      industrial: round(clamp(25 + supply.imported * 4 + supply.exported * 2 - employment.availableJobs * 0.5, 0, 100)),
    },
  };

  return { households, people, buildings, tripRequests, economy };
}

function assignEmployment(
  people: Person[],
  buildings: Building[],
  buildingsById: ReadonlyMap<string, Building>,
): void {
  const workplaces = buildings
    .filter(
      (building) =>
        building.jobCapacity > 0 &&
        (building.zone === "commercial" || building.zone === "industrial" || building.zone === "civic"),
    )
    .sort(compareIds);
  for (const workplace of workplaces) workplace.employeeIds = [];

  for (const person of people) {
    if (person.ageGroup !== "adult") continue;
    const home = buildingsById.get(person.homeBuildingId);
    const available = workplaces.filter(
      (workplace) => workplace.employeeIds.length < workplace.jobCapacity,
    );
    const workplace = home === undefined ? available[0] : nearestBuilding(home, available);
    if (workplace === undefined) {
      person.workBuildingId = undefined;
      continue;
    }
    person.workBuildingId = workplace.id;
    workplace.employeeIds.push(person.id);
    person.schedule = person.schedule.map((activity) =>
      activity.activity === "work" ? { ...activity, buildingId: workplace.id } : activity,
    );
  }
}

function payHouseholds(
  people: Person[],
  householdsById: ReadonlyMap<string, Household>,
): Map<string, number> {
  const incomeByHousehold = new Map<string, number>();
  for (const person of people) {
    const income =
      person.ageGroup === "adult" && person.workBuildingId !== undefined
        ? DAILY_WAGE[person.incomeBand]
        : person.ageGroup === "senior"
          ? 45
          : 0;
    person.money = round(person.money + income);
    incomeByHousehold.set(person.householdId, round((incomeByHousehold.get(person.householdId) ?? 0) + income));
  }
  for (const [householdId, income] of incomeByHousehold) {
    const household = householdsById.get(householdId);
    if (household !== undefined) household.money = round(household.money + income);
  }
  return incomeByHousehold;
}

function supplyRetailers(
  buildings: Building[],
  shops: Building[],
  freightEntry: string,
  createdMinute: number,
  requests: TripRequest[],
): { imported: number; exported: number; deliveries: number } {
  const industries = buildings.filter((building) => building.zone === "industrial").sort(compareIds);
  let imported = 0;
  let exported = 0;
  let deliveries = 0;
  let sequence = 1;

  for (const shop of shops) {
    let needed = round(Math.max(0, shop.customerDemand * 1.5 - shop.goodsInventory));
    for (const industry of industries) {
      const cargo = round(Math.min(needed, industry.goodsInventory));
      if (cargo <= 0) continue;
      industry.goodsInventory = round(industry.goodsInventory - cargo);
      shop.goodsInventory = round(shop.goodsInventory + cargo);
      requests.push(freightRequest(sequence, industry.id, shop.id, cargo, createdMinute));
      sequence += 1;
      deliveries += 1;
      needed = round(needed - cargo);
      if (needed <= 0) break;
    }

    if (needed > 0) {
      shop.goodsInventory = round(shop.goodsInventory + needed);
      imported = round(imported + needed);
      requests.push(freightRequest(sequence, freightEntry, shop.id, needed, createdMinute));
      sequence += 1;
      deliveries += 1;
    }
  }

  for (const industry of industries) {
    const reserve = Math.max(0, industry.productionRate * 0.25);
    const surplus = round(Math.max(0, industry.goodsInventory - reserve));
    if (surplus <= 0) continue;
    industry.goodsInventory = round(industry.goodsInventory - surplus);
    exported = round(exported + surplus);
    requests.push(freightRequest(sequence, industry.id, freightEntry, surplus, createdMinute));
    sequence += 1;
    deliveries += 1;
  }

  return { imported, exported, deliveries };
}

function serveHouseholds(
  households: Household[],
  shops: readonly Building[],
  buildingsById: ReadonlyMap<string, Building>,
  dailyIncome: ReadonlyMap<string, number>,
): { goodsConsumed: number; unitsSold: number; spending: number } {
  let goodsConsumed = 0;
  let unitsSold = 0;
  let spending = 0;

  for (const household of households.sort(compareIds)) {
    const home = buildingsById.get(household.homeBuildingId);
    const homeRent = home?.rent ?? household.rentPerDay;
    household.rentPerDay = homeRent;
    const rentPaid = Math.min(household.money, homeRent);
    household.money = round(household.money - rentPaid);
    const consumed = round(Math.min(household.goods, household.consumptionNeed));
    household.goods = round(household.goods - consumed);
    goodsConsumed = round(goodsConsumed + consumed);

    const shop = home === undefined ? undefined : nearestBuilding(home, shops);
    if (shop !== undefined) {
      const purchased = round(
        Math.min(household.consumptionNeed, shop.goodsInventory, household.money / RETAIL_PRICE),
      );
      shop.goodsInventory = round(shop.goodsInventory - purchased);
      household.goods = round(household.goods + purchased);
      const cost = round(purchased * RETAIL_PRICE);
      household.money = round(household.money - cost);
      unitsSold = round(unitsSold + purchased);
      spending = round(spending + cost);
    }

    const consumptionRatio = household.consumptionNeed === 0 ? 1 : consumed / household.consumptionNeed;
    const rentRatio = homeRent / Math.max(1, dailyIncome.get(household.id) ?? 0);
    household.happiness = round(clamp(45 + consumptionRatio * 35 + (1 - clamp(rentRatio, 0, 1)) * 20, 0, 100));
  }

  return { goodsConsumed, unitsSold, spending };
}

function calculateEmployment(
  people: readonly Person[],
  buildings: readonly Building[],
): { workers: number; employed: number; availableJobs: number } {
  const workers = people.filter((person) => person.ageGroup === "adult").length;
  const employed = people.filter(
    (person) => person.ageGroup === "adult" && person.workBuildingId !== undefined,
  ).length;
  const totalJobs = buildings.reduce((total, building) => total + Math.max(0, building.jobCapacity), 0);
  return { workers, employed, availableJobs: Math.max(0, totalJobs - employed) };
}

function freightRequest(
  sequence: number,
  originBuildingId: string,
  destinationBuildingId: string,
  cargoUnits: number,
  createdMinute: number,
): TripRequest {
  return {
    id: `freight-${createdMinute}-${sequence}-${originBuildingId}-${destinationBuildingId}`,
    originBuildingId,
    destinationBuildingId,
    mode: "freight",
    purpose: "delivery",
    createdMinute,
    vehicleType: "truck",
    cargoUnits,
  };
}

function nearestBuilding(origin: Building, candidates: readonly Building[]): Building | undefined {
  return [...candidates].sort((left, right) => {
    const leftDistance = Math.hypot(left.x - origin.x, left.z - origin.z);
    const rightDistance = Math.hypot(right.x - origin.x, right.z - origin.z);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
}

function cloneBuilding(building: Building): Building {
  return {
    ...building,
    residentIds: [...building.residentIds],
    employeeIds: [...building.employeeIds],
    utilityDemand: { ...building.utilityDemand },
    utilityService: { ...building.utilityService },
  };
}

function clonePerson(person: Person): Person {
  return { ...person, schedule: person.schedule.map((activity) => ({ ...activity })) };
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
