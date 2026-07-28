import type {
  Building,
  BuildingAccounting,
  BuildingOperatingModel,
  CivicServiceKind,
  EconomyState,
  Household,
  HouseholdExpenseLedger,
  IncomeBand,
  Person,
  TravelMode,
  TripRequest,
} from "../models/types";
import { buildingUtilityDemand, UTILITY_CUSTOMER_RATES } from "./infrastructure";
import { OUTSIDE_COMMUTER_BUILDING_ID } from "./network";

export interface ExternalLaborMarket {
  name: string;
  jobCapacity: number;
  dailyWage: number;
  commuteCostDaily: number;
  distanceKm?: number;
  commuteMinutesOneWay?: number;
}

export interface DetailedLaborTargets {
  unemploymentPercent: number;
  externalWorkerSharePercent: number;
}

export interface EconomyStepInput {
  households: readonly Household[];
  people: readonly Person[];
  buildings: readonly Building[];
  cityMinute: number;
  freightEntryBuildingId?: string;
  consumerPriceIndex?: number;
  externalLaborMarket?: ExternalLaborMarket;
  laborTargets?: DetailedLaborTargets;
  taxRate?: number;
}

export interface EconomyStepResult {
  households: Household[];
  people: Person[];
  buildings: Building[];
  tripRequests: TripRequest[];
  economy: EconomyState;
  events: string[];
}

const DAILY_WAGE: Record<IncomeBand, number> = {
  low: 90,
  middle: 150,
  high: 240,
};
export const RETAIL_PRICE = 18;
const LOCAL_WHOLESALE_PRICE = 9.5;
const IMPORT_WHOLESALE_PRICE = 12.5;
const EXPORT_PRICE = 10.5;
const TRANSPORT_COST_PER_UNIT_DISTANCE = 0.015;
const FREIGHT_ENTRY = { x: -85, z: 4 };
const MIN_RETAIL_PRICE = 7;
const MAX_RETAIL_PRICE = 36;
const BUSINESS_CLOSURE_DAYS = 30;
const LOSS_DAYS_BEFORE_CLOSURE = 14;
const RENT_ARREARS_DAYS_BEFORE_MOVE = 30;
const UNEMPLOYED_DAYS_BEFORE_MOVE = 60;
const SERVICE_UNITS_PER_WORKER: Record<Exclude<CivicServiceKind, "none">, number> = {
  education: 18,
  health: 12,
  library: 35,
  recreation: 45,
};

export function dailyWageForIncome(incomeBand: IncomeBand): number {
  return DAILY_WAGE[incomeBand];
}

export function advanceEconomy(input: EconomyStepInput): EconomyStepResult {
  const people = input.people.map(clonePerson).sort(compareIds);
  const households = input.households.map((household) => ({
    ...household,
    memberIds: [...household.memberIds],
    dailyExpenses: { ...(household.dailyExpenses ?? emptyExpenseLedger()) },
  }));
  const buildings = input.buildings.map(cloneBuilding);
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));
  const householdsById = new Map(households.map((household) => [household.id, household]));
  const freightEntry = input.freightEntryBuildingId ?? "regional-freight-entry";
  const createdMinute = Math.floor(input.cityMinute);
  const tripRequests: TripRequest[] = [];
  const events: string[] = [];
  const consumerPriceScale = clamp((input.consumerPriceIndex ?? 100) / 100, 0.65, 1.8);
  for (const household of households) household.dailyExpenses = emptyExpenseLedger();

  initializeMarketState(buildings, consumerPriceScale);
  const closedToday = advanceBusinessClosures(buildings, events);
  adjustRents(households, buildings);

  const allShops = buildings.filter((building) => building.zone === "commercial").sort(compareIds);
  const shops = allShops.filter((building) => !closedToday.has(building.id));
  for (const shop of allShops) shop.customerDemand = 0;
  for (const household of households) {
    const home = buildingsById.get(household.homeBuildingId);
    const shop = home === undefined ? undefined : nearestBuilding(home, shops);
    if (shop !== undefined) shop.customerDemand = round(shop.customerDemand + household.consumptionNeed);
  }

  const externalLaborMarket = calibratedExternalLaborMarket(
    input.externalLaborMarket,
    input.laborTargets,
    people.filter((person) => person.ageGroup === "adult").length,
  );
  updateLaborDemand(
    people,
    buildings,
    closedToday,
    consumerPriceScale,
    externalLaborMarket,
    input.laborTargets,
  );
  const labor = assignEmployment(
    people,
    buildings,
    buildingsById,
    externalLaborMarket,
  );

  buildings.forEach((building) => {
    building.accounting = emptyBuildingAccounting(building);
    building.accounting.workforceChange = labor.workforceChange.get(building.id) ?? 0;
  });
  const dailyHouseholdIncome = payHouseholds(people, householdsById, input.taxRate ?? 0.082);
  recordBuildingWages(people, buildings);
  recordBuildingFixedCosts(buildings);
  const civicServices = operateCivicServices(people, buildings);

  let goodsProduced = 0;
  for (const building of buildings) {
    if (building.zone !== "industrial") continue;
    const produced = round(Math.max(
      0,
      building.productionRate
        * businessOperatingRatio(building),
    ));
    building.goodsInventory = round(building.goodsInventory + produced);
    goodsProduced = round(goodsProduced + produced);
  }

  const supply = supplyRetailers(
    buildings,
    shops.filter(isOperationalBusiness),
    freightEntry,
    createdMinute,
    tripRequests,
    consumerPriceScale,
  );
  const retail = serveHouseholds(
    households,
    shops.filter(isOperationalBusiness),
    buildingsById,
    dailyHouseholdIncome,
    civicServices.coverage,
    people,
  );
  synchronizePersonalCash(people, householdsById);
  finalizeBuildingAccounting(buildings);
  const closures = updateBusinessHealth(buildings, events);
  const migration = removeDepartingHouseholds(households, people, buildings, events);
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
  const businessRevenue = sumAccounting(buildings, "business", (accounting) => accounting.revenue);
  const propertyRentIncome = sumAccounting(buildings, "housing", (accounting) => accounting.rentIncome);
  const utilityPayments = buildings.reduce(
    (total, building) => total + requireAccounting(building).utilityCost,
    0,
  );
  const economy: EconomyState = {
    goodsProduced,
    goodsConsumed: retail.goodsConsumed,
    goodsImported: supply.imported,
    goodsExported: supply.exported,
    deliveriesCompleted: supply.deliveries,
    retailSales: retail.unitsSold,
    householdSpending: round(sum(households.map((household) => household.dailyExpenses.total))),
    businessRevenue: round(businessRevenue),
    propertyRentIncome: round(propertyRentIncome),
    utilityPayments: round(utilityPayments),
    civicServiceCost: round(civicServices.cost),
    civicServiceCoveragePercent: round(civicServices.coverage * 100),
    availableJobs: employment.availableJobs,
    employedWorkers: employment.employed,
    externalWorkers: employment.external,
    averageWage: round(average(people
      .filter((person) => person.employmentStatus === "local" || person.employmentStatus === "external")
      .map((person) => person.dailyWage))),
    averageRetailPrice: round(average(allShops.map((shop) => shop.retailPrice ?? RETAIL_PRICE))),
    hires: labor.hires,
    layoffs: labor.layoffs,
    businessClosures: closures,
    residentsMovedOut: migration.residents,
    householdsMovedOut: migration.households,
    rentArrears: round(sum(households.map((household) => household.rentArrears))),
    unemploymentPercent: round(employment.workers === 0 ? 0 : ((employment.workers - employment.employed) / employment.workers) * 100),
    averageRent: round(averageRent),
    zoneDemand: {
      residential: round(clamp(20 + employmentRate * 50 + housingOccupancy * 20 - rentBurden * 25, 0, 100)),
      commercial: round(clamp(20 + retail.unitsSold * 4 + (supply.imported > 0 ? 10 : 0), 0, 100)),
      industrial: round(clamp(25 + supply.imported * 4 + supply.exported * 2 - employment.availableJobs * 0.5, 0, 100)),
    },
  };

  if (labor.layoffs > 0) events.push(`${labor.layoffs} detailed workers were laid off as employers reduced positions.`);
  if (labor.hires > 0) events.push(`${labor.hires} detailed workers found new jobs.`);

  return { households, people, buildings, tripRequests, economy, events };
}

function calibratedExternalLaborMarket(
  market: ExternalLaborMarket | undefined,
  targets: DetailedLaborTargets | undefined,
  adults: number,
): ExternalLaborMarket | undefined {
  if (market === undefined || targets === undefined) return market;
  const targetEmployed = Math.round(adults * (1 - clamp(targets.unemploymentPercent, 0, 100) / 100));
  return {
    ...market,
    jobCapacity: Math.min(
      market.jobCapacity,
      Math.round(targetEmployed * clamp(targets.externalWorkerSharePercent, 0, 100) / 100),
    ),
  };
}

function initializeMarketState(buildings: Building[], priceScale: number): void {
  for (const building of buildings) {
    building.maximumJobCapacity ??= Math.max(0, building.jobCapacity);
    building.wageOffer ??= round(baseWageFor(building) * (0.85 + priceScale * 0.15));
    building.retailPrice ??= round(clamp(RETAIL_PRICE * priceScale, MIN_RETAIL_PRICE, MAX_RETAIL_PRICE));
    building.cashReserve ??= round(Math.max(
      4_000,
      (building.maximumJobCapacity ?? 0) * Math.max(60, building.wageOffer) * 18,
    ));
    building.unprofitableDays ??= 0;
    building.closedDaysRemaining ??= 0;
  }
}

function advanceBusinessClosures(buildings: readonly Building[], events: string[]): Set<string> {
  const closed = new Set<string>();
  for (const building of buildings) {
    if (operatingModelFor(building) !== "business" || (building.closedDaysRemaining ?? 0) <= 0) continue;
    closed.add(building.id);
    building.closedDaysRemaining = Math.max(0, (building.closedDaysRemaining ?? 0) - 1);
    building.jobCapacity = 0;
    if (building.closedDaysRemaining === 0) {
      building.unprofitableDays = 0;
      building.cashReserve = Math.max(building.cashReserve ?? 0, initialBusinessReserve(building) * 0.2);
      events.push(`${building.name} completed restructuring and can reopen on the next business day.`);
    }
  }
  return closed;
}

function adjustRents(households: readonly Household[], buildings: readonly Building[]): void {
  const householdsByHome = new Map<string, Household[]>();
  for (const household of households) {
    const residents = householdsByHome.get(household.homeBuildingId) ?? [];
    residents.push(household);
    householdsByHome.set(household.homeBuildingId, residents);
  }
  for (const home of buildings.filter((building) => building.buildingUse === "housing")) {
    const occupancy = home.residentCapacity > 0 ? home.residentIds.length / home.residentCapacity : 0;
    const residentHouseholds = householdsByHome.get(home.id) ?? [];
    const arrearsRatio = sum(residentHouseholds.map((household) => household.rentArrears))
      / Math.max(1, residentHouseholds.length * Math.max(1, home.rent));
    const vacancyPressure = (occupancy - 0.9) * 0.018;
    const affordabilityPressure = -Math.min(0.025, arrearsRatio * 0.012);
    const dailyChange = clamp(vacancyPressure + affordabilityPressure, -0.025, 0.018);
    home.rent = round(clamp(home.rent * (1 + dailyChange), 4, Math.max(12, home.landValue * 0.4)));
  }
}

function updateLaborDemand(
  people: readonly Person[],
  buildings: readonly Building[],
  closedToday: ReadonlySet<string>,
  priceScale: number,
  externalMarket: ExternalLaborMarket | undefined,
  laborTargets: DetailedLaborTargets | undefined,
): void {
  const adults = people.filter((person) => person.ageGroup === "adult").length;
  const serviceDemand: Record<Exclude<CivicServiceKind, "none">, number> = {
    education: people.filter((person) => hasScheduledActivity(person, "school")).length,
    health: people.filter((person) => hasScheduledActivity(person, "healthcare")).length,
    library: people.filter((person) => hasScheduledActivity(person, "library")).length,
    recreation: people.filter((person) => hasScheduledActivity(person, "leisure")).length,
  };
  const providersByKind = new Map<Exclude<CivicServiceKind, "none">, Building[]>();
  for (const kind of Object.keys(serviceDemand) as Array<Exclude<CivicServiceKind, "none">>) {
    providersByKind.set(kind, buildings.filter((building) => serviceKindFor(building) === kind));
  }

  const desiredByBuilding = new Map<string, number>();
  for (const building of buildings) {
    const maximum = Math.max(0, building.maximumJobCapacity ?? building.jobCapacity);
    if (maximum <= 0 || closedToday.has(building.id)) {
      desiredByBuilding.set(building.id, 0);
      continue;
    }
    let desired = 0;
    if (building.buildingUse === "retail") {
      desired = Math.ceil(building.customerDemand / 28);
    } else if (building.buildingUse === "industrial") {
      const inventoryDays = building.goodsInventory / Math.max(1, building.productionRate);
      desired = Math.ceil(building.productionRate / 20 * (inventoryDays > 4 ? 0.65 : 1));
    } else {
      const serviceKind = serviceKindFor(building);
      if (serviceKind !== "none") {
        const providers = providersByKind.get(serviceKind) ?? [];
        const share = maximum / Math.max(1, sum(providers.map((provider) => provider.maximumJobCapacity ?? provider.jobCapacity)));
        desired = Math.ceil(serviceDemand[serviceKind] * share / SERVICE_UNITS_PER_WORKER[serviceKind]);
      }
    }

    const previous = building.accounting;
    if (previous !== undefined && previous.operatingModel === "business") {
      const margin = previous.profit / Math.max(1, previous.revenue);
      if (margin < -0.12) desired = Math.floor(desired * 0.88);
      if (
        building.buildingUse === "retail"
        && margin > 0.12
        && previous.goodsSold >= building.customerDemand * 0.75
      ) desired = Math.ceil(desired * 1.08);
    }
    desiredByBuilding.set(building.id, clamp(Math.max(operatingModelFor(building) === "business" ? 1 : 0, desired), 0, maximum));
  }

  if (laborTargets !== undefined) {
    const targetEmployed = Math.round(adults * (1 - clamp(laborTargets.unemploymentPercent, 0, 100) / 100));
    const targetExternal = Math.min(
      externalMarket?.jobCapacity ?? 0,
      Math.round(targetEmployed * clamp(laborTargets.externalWorkerSharePercent, 0, 100) / 100),
    );
    scaleLaborDemand(desiredByBuilding, buildings, Math.max(0, targetEmployed - targetExternal), closedToday);
  }

  const laborTightness = sum([...desiredByBuilding.values()]) / Math.max(1, adults);
  for (const building of buildings) {
    const desired = desiredByBuilding.get(building.id) ?? 0;
    const maximum = Math.max(0, building.maximumJobCapacity ?? building.jobCapacity);
    if (closedToday.has(building.id)) {
      building.jobCapacity = 0;
      continue;
    }
    const previousAccounting = building.accounting;
    const firstMarketDay = previousAccounting === undefined;
    const stepLimit = Math.max(1, Math.ceil(maximum * 0.1));
    building.jobCapacity = firstMarketDay
      ? desired
      : clamp(desired, Math.max(0, building.jobCapacity - stepLimit), Math.min(maximum, building.jobCapacity + stepLimit));

    if (maximum > 0) {
      const vacancy = previousAccounting === undefined ? 0 : 1 - previousAccounting.staffingRatio;
      const margin = previousAccounting === undefined
        ? 0
        : previousAccounting.profit / Math.max(1, previousAccounting.revenue);
      const targetWage = baseWageFor(building)
        * (0.86 + clamp(laborTightness, 0, 1.8) * 0.12 + vacancy * 0.14 + clamp(margin, -0.3, 0.3) * 0.08)
        * (0.75 + priceScale * 0.25);
      building.wageOffer = round(clamp(
        (building.wageOffer ?? targetWage) * 0.88 + targetWage * 0.12,
        55,
        360,
      ));
    }

    if (building.buildingUse === "retail") {
      const previousSales = previousAccounting?.goodsSold ?? building.customerDemand;
      const demandPressure = building.customerDemand / Math.max(1, previousSales);
      const shortage = clamp(1 - building.goodsInventory / Math.max(1, building.customerDemand * 1.2), 0, 1);
      const importShare = previousAccounting === undefined
        ? 0
        : previousAccounting.importedSupplies / Math.max(1, previousAccounting.goodsReceived);
      const targetPrice = RETAIL_PRICE * priceScale * clamp(
        0.86 + shortage * 0.28 + clamp(demandPressure - 1, -0.5, 1.5) * 0.12 + importShare * 0.1,
        0.7,
        1.8,
      );
      building.retailPrice = round(clamp(
        (building.retailPrice ?? targetPrice) * 0.82 + targetPrice * 0.18,
        MIN_RETAIL_PRICE,
        MAX_RETAIL_PRICE,
      ));
    }
  }
}

function scaleLaborDemand(
  desiredByBuilding: Map<string, number>,
  buildings: readonly Building[],
  targetPositions: number,
  closedToday: ReadonlySet<string>,
): void {
  const candidates = buildings
    .filter((building) =>
      !closedToday.has(building.id)
      && (building.maximumJobCapacity ?? building.jobCapacity) > 0
      && (desiredByBuilding.get(building.id) ?? 0) > 0
    )
    .map((building) => ({
      building,
      weight: desiredByBuilding.get(building.id) ?? 0,
      maximum: Math.max(0, building.maximumJobCapacity ?? building.jobCapacity),
      assigned: 0,
      remainder: 0,
    }));
  const totalWeight = sum(candidates.map((candidate) => candidate.weight));
  if (totalWeight <= 0) return;

  for (const candidate of candidates) {
    const exact = targetPositions * candidate.weight / totalWeight;
    candidate.assigned = Math.min(candidate.maximum, Math.floor(exact));
    candidate.remainder = exact - Math.floor(exact);
  }
  let remaining = Math.max(0, targetPositions - sum(candidates.map((candidate) => candidate.assigned)));
  const allocationOrder = [...candidates].sort(
    (left, right) => right.remainder - left.remainder || left.building.id.localeCompare(right.building.id),
  );
  while (remaining > 0) {
    const available = allocationOrder.find((candidate) => candidate.assigned < candidate.maximum);
    if (available === undefined) break;
    available.assigned += 1;
    remaining -= 1;
    allocationOrder.sort(
      (left, right) => (left.assigned / Math.max(1, left.maximum)) - (right.assigned / Math.max(1, right.maximum))
        || right.remainder - left.remainder
        || left.building.id.localeCompare(right.building.id),
    );
  }
  for (const candidate of candidates) desiredByBuilding.set(candidate.building.id, candidate.assigned);
}

interface LaborMarketResult {
  hires: number;
  layoffs: number;
  workforceChange: Map<string, number>;
}

function assignEmployment(
  people: Person[],
  buildings: Building[],
  buildingsById: ReadonlyMap<string, Building>,
  externalMarket: ExternalLaborMarket | undefined,
): LaborMarketResult {
  const workplaces = buildings
    .filter(
      (building) =>
        building.jobCapacity > 0 &&
        (building.closedDaysRemaining ?? 0) <= 0 &&
        (building.zone === "commercial" || building.zone === "industrial" || building.zone === "civic" || building.zone === "park"),
    )
    .sort(compareIds);
  const previousCounts = new Map(buildings.map((building) => [building.id, building.employeeIds.length]));
  for (const workplace of workplaces) workplace.employeeIds = [];
  for (const building of buildings.filter((candidate) => !workplaces.includes(candidate))) building.employeeIds = [];

  const previousWork = new Map(people.map((person) => [person.id, person.workBuildingId]));
  const externalCapacity = Math.max(0, Math.floor(externalMarket?.jobCapacity ?? 0));
  let externalWorkers = 0;
  let layoffs = 0;
  let hires = 0;

  for (const person of people) {
    if (person.ageGroup !== "adult") {
      person.workBuildingId = undefined;
      person.employmentStatus = "not-in-labor-force";
      person.dailyWage = 0;
      person.commuteCostDaily = 0;
      person.commuteDistanceKm = 0;
      person.commuteMinutesOneWay = 0;
      person.unemployedDays = 0;
      continue;
    }

    const previousId = person.workBuildingId;
    const home = buildingsById.get(person.homeBuildingId);
    const previousLocal = previousId === undefined ? undefined : buildingsById.get(previousId);
    if (
      previousLocal !== undefined
      && workplaces.includes(previousLocal)
      && previousLocal.employeeIds.length < previousLocal.jobCapacity
    ) {
      assignLocalJob(person, previousLocal, home);
      continue;
    }
    if (
      previousId === OUTSIDE_COMMUTER_BUILDING_ID
      && externalMarket !== undefined
      && externalWorkers < externalCapacity
    ) {
      assignExternalJob(person, externalMarket);
      externalWorkers += 1;
      continue;
    }
    if (previousLocal !== undefined) layoffs += 1;
    clearEmployment(person);
  }

  for (const person of people.filter((candidate) => candidate.ageGroup === "adult" && candidate.workBuildingId === undefined)) {
    const home = buildingsById.get(person.homeBuildingId);
    const localOptions = workplaces
      .filter((workplace) => workplace.employeeIds.length < workplace.jobCapacity)
      .map((workplace) => ({
        workplace,
        score: localJobScore(person, workplace, home),
      }))
      .sort((left, right) => right.score - left.score || left.workplace.id.localeCompare(right.workplace.id));
    const externalScore = externalMarket !== undefined && externalWorkers < externalCapacity
      ? externalMarket.dailyWage * skillWageMultiplier(person.incomeBand) - externalMarket.commuteCostDaily
      : Number.NEGATIVE_INFINITY;
    const local = localOptions[0];

    if (externalScore > (local?.score ?? Number.NEGATIVE_INFINITY)) {
      assignExternalJob(person, externalMarket!);
      externalWorkers += 1;
      hires += 1;
    } else if (local !== undefined) {
      assignLocalJob(person, local.workplace, home);
      hires += 1;
    } else {
      person.unemployedDays += 1;
    }
  }

  for (const person of people) {
    if (previousWork.get(person.id) !== person.workBuildingId) person.scheduleDay = -1;
  }

  return {
    hires,
    layoffs,
    workforceChange: new Map(buildings.map((building) => [
      building.id,
      building.employeeIds.length - (previousCounts.get(building.id) ?? 0),
    ])),
  };
}

function assignLocalJob(person: Person, workplace: Building, home: Building | undefined): void {
  person.workBuildingId = workplace.id;
  person.employmentStatus = "local";
  person.dailyWage = round((workplace.wageOffer ?? baseWageFor(workplace)) * skillWageMultiplier(person.incomeBand));
  const distanceKm = home === undefined
    ? 0
    : Math.hypot(workplace.x - home.x, workplace.z - home.z) * 0.012;
  person.commuteDistanceKm = round(distanceKm);
  person.commuteMinutesOneWay = round(localCommuteMinutes(distanceKm, person.preferredMode));
  person.commuteCostDaily = round(localCommuteCost(distanceKm, person.preferredMode));
  person.unemployedDays = 0;
  person.externalWorkplaceName = undefined;
  workplace.employeeIds.push(person.id);
}

function assignExternalJob(person: Person, market: ExternalLaborMarket): void {
  person.workBuildingId = OUTSIDE_COMMUTER_BUILDING_ID;
  person.employmentStatus = "external";
  person.dailyWage = round(market.dailyWage * skillWageMultiplier(person.incomeBand));
  person.commuteCostDaily = round(market.commuteCostDaily);
  person.commuteDistanceKm = round(market.distanceKm ?? 0);
  person.commuteMinutesOneWay = round(
    market.commuteMinutesOneWay ?? externalCommuteMinutes(market.distanceKm ?? 0),
  );
  person.unemployedDays = 0;
  person.externalWorkplaceName = market.name;
}

function clearEmployment(person: Person): void {
  person.workBuildingId = undefined;
  person.employmentStatus = "unemployed";
  person.dailyWage = 0;
  person.commuteCostDaily = 0;
  person.commuteDistanceKm = 0;
  person.commuteMinutesOneWay = 0;
  person.externalWorkplaceName = undefined;
}

function localJobScore(person: Person, workplace: Building, home: Building | undefined): number {
  const distanceCost = home === undefined ? 0 : Math.hypot(workplace.x - home.x, workplace.z - home.z) * 0.12;
  return (workplace.wageOffer ?? baseWageFor(workplace)) * skillWageMultiplier(person.incomeBand) - distanceCost;
}

function localCommuteMinutes(distanceKm: number, mode: TravelMode): number {
  if (distanceKm <= 0) return 0;
  const speedKph = mode === "walk" ? 4.8 : mode === "bus" ? 19 : 28;
  const accessMinutes = mode === "walk" ? 1 : mode === "bus" ? 6 : 3;
  return Math.max(3, distanceKm / speedKph * 60 + accessMinutes);
}

function localCommuteCost(distanceKm: number, mode: TravelMode): number {
  if (mode === "walk" || distanceKm <= 0) return 0;
  if (mode === "bus") return 4.5;
  return distanceKm * 2 * 0.42;
}

function externalCommuteMinutes(distanceKm: number): number {
  return distanceKm <= 0 ? 0 : 8 + distanceKm / 35 * 60;
}

function payHouseholds(
  people: Person[],
  householdsById: ReadonlyMap<string, Household>,
  taxRate: number,
): Map<string, number> {
  const incomeByHousehold = new Map<string, number>();
  for (const person of people) {
    const income =
      person.ageGroup === "adult" && person.employmentStatus !== "unemployed"
        ? person.dailyWage
        : person.ageGroup === "senior"
          ? 45
          : 0;
    incomeByHousehold.set(person.householdId, round((incomeByHousehold.get(person.householdId) ?? 0) + income));
    const household = householdsById.get(person.householdId);
    if (household !== undefined) {
      household.dailyExpenses.transport = round(household.dailyExpenses.transport + person.commuteCostDaily);
    }
  }
  for (const [householdId, income] of incomeByHousehold) {
    const household = householdsById.get(householdId);
    if (household !== undefined) {
      const taxes = round(income * clamp(taxRate, 0, 0.5) * 0.16);
      household.dailyExpenses.taxes = taxes;
      household.money = round(household.money + Math.max(0, income - taxes - household.dailyExpenses.transport));
    }
  }
  return incomeByHousehold;
}

function synchronizePersonalCash(
  people: Person[],
  householdsById: ReadonlyMap<string, Household>,
): void {
  const membersByHousehold = new Map<string, Person[]>();
  for (const person of people) {
    const members = membersByHousehold.get(person.householdId) ?? [];
    members.push(person);
    membersByHousehold.set(person.householdId, members);
  }
  for (const [householdId, members] of membersByHousehold) {
    const householdCash = householdsById.get(householdId)?.money ?? 0;
    const equalShare = round(householdCash / Math.max(1, members.length));
    let assigned = 0;
    members.forEach((person, index) => {
      person.money = index === members.length - 1
        ? round(householdCash - assigned)
        : equalShare;
      assigned = round(assigned + person.money);
    });
  }
}

function supplyRetailers(
  buildings: Building[],
  shops: Building[],
  freightEntry: string,
  createdMinute: number,
  requests: TripRequest[],
  priceScale: number,
): { imported: number; exported: number; deliveries: number } {
  const industries = buildings
    .filter((building) => building.zone === "industrial" && isOperationalBusiness(building))
    .sort(compareIds);
  let imported = 0;
  let exported = 0;
  let deliveries = 0;
  let sequence = 1;

  for (const shop of shops) {
    let needed = round(Math.max(0, shop.customerDemand * 1.08 - shop.goodsInventory));
    for (const industry of industries) {
      const cargo = round(Math.min(needed, industry.goodsInventory));
      if (cargo <= 0) continue;
      industry.goodsInventory = round(industry.goodsInventory - cargo);
      shop.goodsInventory = round(shop.goodsInventory + cargo);
      recordSupplyTransfer(industry, shop, cargo, false, priceScale);
      requests.push(freightRequest(sequence, industry.id, shop.id, cargo, createdMinute));
      sequence += 1;
      deliveries += 1;
      needed = round(needed - cargo);
      if (needed <= 0) break;
    }

    if (needed > 0) {
      shop.goodsInventory = round(shop.goodsInventory + needed);
      recordImportedSupply(shop, needed, priceScale);
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
    const accounting = requireAccounting(industry);
    accounting.goodsSold = round(accounting.goodsSold + surplus);
    accounting.revenue = round(accounting.revenue + surplus * EXPORT_PRICE * priceScale);
    accounting.transportCost = round(
      accounting.transportCost + freightCost(industry, FREIGHT_ENTRY, surplus),
    );
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
  civicServiceCoverage: number,
  people: readonly Person[],
): { goodsConsumed: number; unitsSold: number } {
  let goodsConsumed = 0;
  let unitsSold = 0;
  const remainingSalesCapacity = new Map(shops.map((shop) => [
    shop.id,
    Math.max(0, shop.jobCapacity * 28 * businessOperatingRatio(shop)),
  ]));
  const householdsPerHome = new Map<string, number>();
  const membersByHousehold = new Map<string, Person[]>();
  for (const household of households) {
    householdsPerHome.set(household.homeBuildingId, (householdsPerHome.get(household.homeBuildingId) ?? 0) + 1);
  }
  for (const person of people) {
    const members = membersByHousehold.get(person.householdId) ?? [];
    members.push(person);
    membersByHousehold.set(person.householdId, members);
  }

  for (const household of households.sort(compareIds)) {
    const home = buildingsById.get(household.homeBuildingId);
    const homeRent = home?.rent ?? household.rentPerDay;
    household.rentPerDay = homeRent;
    const rentPaid = Math.min(household.money, homeRent);
    household.money = round(household.money - rentPaid);
    const rentShortfall = Math.max(0, homeRent - rentPaid);
    household.rentArrears = round(Math.max(0, household.rentArrears + rentShortfall));
    const householdIncome = dailyIncome.get(household.id) ?? 0;
    const rentBurden = homeRent / Math.max(1, householdIncome);
    household.unaffordableDays = rentShortfall > 0 || (rentBurden > 0.55 && household.money < homeRent * 10)
      ? household.unaffordableDays + 1
      : Math.max(0, household.unaffordableDays - 2);
    if (home?.zone === "residential") {
      const accounting = requireAccounting(home);
      accounting.rentIncome = round(accounting.rentIncome + rentPaid);
      accounting.revenue = accounting.rentIncome;
      const utilityShare = Math.min(
        rentPaid,
        accounting.utilityCost / Math.max(1, householdsPerHome.get(home.id) ?? 1),
      );
      household.dailyExpenses.utilities = round(utilityShare);
      household.dailyExpenses.housing = round(rentPaid - utilityShare);
    } else {
      household.dailyExpenses.housing = round(rentPaid);
    }
    const consumed = round(Math.min(household.goods, household.consumptionNeed));
    household.goods = round(household.goods - consumed);
    goodsConsumed = round(goodsConsumed + consumed);

    const shop = home === undefined ? undefined : nearestBuilding(home, shops);
    if (shop !== undefined) {
      const salesCapacity = remainingSalesCapacity.get(shop.id) ?? 0;
      const purchased = round(
        Math.min(
          household.consumptionNeed,
          shop.goodsInventory,
          household.money / Math.max(MIN_RETAIL_PRICE, shop.retailPrice ?? RETAIL_PRICE),
          salesCapacity,
        ),
      );
      remainingSalesCapacity.set(shop.id, round(Math.max(0, salesCapacity - purchased)));
      shop.goodsInventory = round(shop.goodsInventory - purchased);
      household.goods = round(household.goods + purchased);
      const cost = round(purchased * (shop.retailPrice ?? RETAIL_PRICE));
      household.money = round(household.money - cost);
      household.dailyExpenses.goods = round(household.dailyExpenses.goods + cost);
      if (purchased > 0) {
        const accounting = requireAccounting(shop);
        accounting.goodsSold = round(accounting.goodsSold + purchased);
        accounting.revenue = round(accounting.revenue + cost);
        accounting.customers += 1;
      }
      unitsSold = round(unitsSold + purchased);
    }

    chargeHouseholdServices(household, membersByHousehold.get(household.id) ?? [], householdIncome);
    household.dailyExpenses = finalizeExpenseLedger(household.dailyExpenses);

    const consumptionRatio = household.consumptionNeed === 0 ? 1 : consumed / household.consumptionNeed;
    const rentRatio = homeRent / Math.max(1, householdIncome);
    household.happiness = round(clamp(
      42
        + consumptionRatio * 32
        + (1 - clamp(rentRatio, 0, 1)) * 18
        + civicServiceCoverage * 8,
      0,
      100,
    ));
  }

  return { goodsConsumed, unitsSold };
}

function chargeHouseholdServices(
  household: Household,
  members: readonly Person[],
  dailyIncome: number,
): void {
  const desired = {
    healthcare: sum(members.map((person) => person.ageGroup === "senior" ? 3.1 : person.ageGroup === "child" ? 0.85 : 1.15))
      + members.filter((person) => hasScheduledActivity(person, "healthcare")).length * 5,
    education: members.filter((person) => person.ageGroup === "child").length * 2.4
      + members.filter((person) => hasScheduledActivity(person, "library")).length * 0.75,
    recreation: household.familySize * 2.2
      + members.filter((person) => hasScheduledActivity(person, "leisure")).length * 1.2,
  };
  const desiredTotal = desired.healthcare + desired.education + desired.recreation;
  const budget = Math.min(household.money, Math.max(0, dailyIncome * 0.16));
  const scale = desiredTotal > 0 ? Math.min(1, budget / desiredTotal) : 0;
  household.dailyExpenses.healthcare = round(desired.healthcare * scale);
  household.dailyExpenses.education = round(desired.education * scale);
  household.dailyExpenses.recreation = round(desired.recreation * scale);
  household.money = round(household.money - (
    household.dailyExpenses.healthcare
    + household.dailyExpenses.education
    + household.dailyExpenses.recreation
  ));
}

function emptyExpenseLedger(): HouseholdExpenseLedger {
  return {
    housing: 0,
    goods: 0,
    utilities: 0,
    transport: 0,
    healthcare: 0,
    education: 0,
    recreation: 0,
    taxes: 0,
    total: 0,
  };
}

function finalizeExpenseLedger(expenses: HouseholdExpenseLedger): HouseholdExpenseLedger {
  return {
    ...expenses,
    total: round(expenses.housing + expenses.goods + expenses.utilities + expenses.transport
      + expenses.healthcare + expenses.education + expenses.recreation + expenses.taxes),
  };
}

function calculateEmployment(
  people: readonly Person[],
  buildings: readonly Building[],
): { workers: number; employed: number; external: number; availableJobs: number } {
  const workers = people.filter((person) => person.ageGroup === "adult").length;
  const employed = people.filter(
    (person) => person.ageGroup === "adult" && person.workBuildingId !== undefined,
  ).length;
  const external = people.filter((person) => person.employmentStatus === "external").length;
  const totalJobs = buildings.reduce((total, building) => total + Math.max(0, building.jobCapacity), 0);
  const localEmployed = Math.max(0, employed - external);
  return { workers, employed, external, availableJobs: Math.max(0, totalJobs - localEmployed) };
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
    accounting: building.accounting ? { ...building.accounting } : undefined,
  };
}

function recordBuildingWages(people: readonly Person[], buildings: readonly Building[]): void {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  for (const building of buildings) {
    const accounting = requireAccounting(building);
    accounting.dailyWages = round(building.employeeIds.reduce((total, personId) => {
      const person = peopleById.get(personId);
      return total + (person === undefined ? 0 : person.dailyWage);
    }, 0));
    accounting.averageWage = building.employeeIds.length > 0
      ? round(accounting.dailyWages / building.employeeIds.length)
      : round(building.wageOffer ?? 0);
  }
}

function recordBuildingFixedCosts(buildings: readonly Building[]): void {
  for (const building of buildings) {
    const accounting = requireAccounting(building);
    accounting.occupancyCost = accounting.operatingModel === "business" ? round(building.rent) : 0;
    accounting.maintenanceCost = round(maintenanceCost(building));
    accounting.utilityCost = round(
      buildingUtilityDemand(building, "power") * building.utilityService.power * UTILITY_CUSTOMER_RATES.power
        + buildingUtilityDemand(building, "water") * building.utilityService.water * UTILITY_CUSTOMER_RATES.water
        + buildingUtilityDemand(building, "waste") * building.utilityService.waste * UTILITY_CUSTOMER_RATES.waste,
    );
  }
}

function operateCivicServices(
  people: readonly Person[],
  buildings: readonly Building[],
): { coverage: number; cost: number } {
  const demandByKind: Record<Exclude<CivicServiceKind, "none">, number> = {
    education: people.filter((person) => hasScheduledActivity(person, "school")).length,
    health: people.filter((person) => hasScheduledActivity(person, "healthcare")).length,
    library: people.filter((person) => hasScheduledActivity(person, "library")).length,
    recreation: people.filter((person) => hasScheduledActivity(person, "leisure")).length,
  };
  let totalDemand = 0;
  let totalDelivered = 0;
  let totalCost = 0;

  for (const kind of Object.keys(demandByKind) as Array<Exclude<CivicServiceKind, "none">>) {
    const providers = buildings.filter((building) => serviceKindFor(building) === kind);
    const weightTotal = providers.reduce((total, building) => total + Math.max(1, building.jobCapacity), 0);
    const kindDemand = demandByKind[kind];
    totalDemand += kindDemand;
    for (const building of providers) {
      const accounting = requireAccounting(building);
      const demand = kindDemand * Math.max(1, building.jobCapacity) / Math.max(1, weightTotal);
      const capacity = building.employeeIds.length
        * SERVICE_UNITS_PER_WORKER[kind]
        * essentialUtilityRatio(building);
      const delivered = Math.min(demand, capacity);
      accounting.serviceDemand = round(demand);
      accounting.serviceDelivered = round(delivered);
      accounting.serviceQuality = round(demand > 0 ? delivered / demand : 1);
      accounting.municipalFunding = round(
        accounting.dailyWages + accounting.maintenanceCost + accounting.utilityCost,
      );
      totalDelivered += delivered;
      totalCost += accounting.municipalFunding;
    }
  }

  return {
    coverage: totalDemand > 0 ? clamp(totalDelivered / totalDemand, 0, 1) : 1,
    cost: round(totalCost),
  };
}

function hasScheduledActivity(person: Person, activity: Person["currentActivity"]): boolean {
  return person.schedule.some((entry) => entry.activity === activity);
}

function recordSupplyTransfer(
  origin: Building,
  destination: Building,
  units: number,
  imported: boolean,
  priceScale: number,
): void {
  const destinationAccounting = requireAccounting(destination);
  destinationAccounting.goodsReceived = round(destinationAccounting.goodsReceived + units);
  destinationAccounting.localSupplies = round(destinationAccounting.localSupplies + (imported ? 0 : units));
  destinationAccounting.importedSupplies = round(destinationAccounting.importedSupplies + (imported ? units : 0));
  destinationAccounting.supplyCost = round(
    destinationAccounting.supplyCost + units
      * (imported ? IMPORT_WHOLESALE_PRICE : LOCAL_WHOLESALE_PRICE)
      * priceScale,
  );
  destinationAccounting.transportCost = round(
    destinationAccounting.transportCost + freightCost(origin, destination, units),
  );

  if (!imported) {
    const originAccounting = requireAccounting(origin);
    originAccounting.goodsSold = round(originAccounting.goodsSold + units);
    originAccounting.revenue = round(originAccounting.revenue + units * LOCAL_WHOLESALE_PRICE * priceScale);
  }
}

function recordImportedSupply(destination: Building, units: number, priceScale: number): void {
  const proxyOrigin = { ...FREIGHT_ENTRY, id: "outside-freight" };
  const accounting = requireAccounting(destination);
  accounting.goodsReceived = round(accounting.goodsReceived + units);
  accounting.importedSupplies = round(accounting.importedSupplies + units);
  accounting.supplyCost = round(accounting.supplyCost + units * IMPORT_WHOLESALE_PRICE * priceScale);
  accounting.transportCost = round(
    accounting.transportCost + freightCost(proxyOrigin, destination, units),
  );
}

function finalizeBuildingAccounting(buildings: readonly Building[]): void {
  for (const building of buildings) {
    const accounting = requireAccounting(building);
    if (accounting.operatingModel === "housing") {
      accounting.revenue = accounting.rentIncome;
      accounting.operatingCost = round(accounting.maintenanceCost + accounting.utilityCost);
      accounting.profit = round(accounting.revenue - accounting.operatingCost);
      continue;
    }

    accounting.operatingCost = round(
      accounting.dailyWages
        + accounting.supplyCost
        + accounting.transportCost
        + accounting.occupancyCost
        + accounting.maintenanceCost
        + accounting.utilityCost,
    );
    if (accounting.operatingModel === "civic" || accounting.operatingModel === "amenity") {
      accounting.municipalFunding = accounting.operatingCost;
      accounting.revenue = accounting.municipalFunding;
      accounting.profit = 0;
    } else {
      accounting.profit = round(accounting.revenue - accounting.operatingCost);
    }
  }
}

function updateBusinessHealth(buildings: readonly Building[], events: string[]): number {
  let closures = 0;
  for (const building of buildings) {
    const accounting = requireAccounting(building);
    if (accounting.operatingModel !== "business") {
      accounting.cashReserve = round(building.cashReserve ?? 0);
      accounting.lossStreak = building.unprofitableDays ?? 0;
      continue;
    }
    if ((building.closedDaysRemaining ?? 0) > 0) {
      accounting.operatingStatus = "closed";
      accounting.cashReserve = round(building.cashReserve ?? 0);
      accounting.lossStreak = building.unprofitableDays ?? 0;
      continue;
    }

    building.cashReserve = round(Math.max(0, (building.cashReserve ?? initialBusinessReserve(building)) + accounting.profit));
    building.unprofitableDays = accounting.profit < 0
      ? (building.unprofitableDays ?? 0) + 1
      : Math.max(0, (building.unprofitableDays ?? 0) - 2);
    accounting.cashReserve = building.cashReserve;
    accounting.lossStreak = building.unprofitableDays;

    const depleted = building.cashReserve < Math.max(1_000, accounting.operatingCost * 4);
    if (
      building.unprofitableDays >= LOSS_DAYS_BEFORE_CLOSURE
      && (depleted || building.unprofitableDays >= 45)
    ) {
      building.closedDaysRemaining = BUSINESS_CLOSURE_DAYS;
      accounting.operatingStatus = "closed";
      closures += 1;
      events.push(`${building.name} closed after ${building.unprofitableDays} unprofitable days exhausted its reserve.`);
    }
  }
  return closures;
}

function removeDepartingHouseholds(
  households: Household[],
  people: Person[],
  buildings: Building[],
  events: string[],
): { households: number; residents: number } {
  const peopleByHousehold = new Map<string, Person[]>();
  for (const person of people) {
    const members = peopleByHousehold.get(person.householdId) ?? [];
    members.push(person);
    peopleByHousehold.set(person.householdId, members);
  }
  const departing = households.filter((household) => {
    const members = peopleByHousehold.get(household.id) ?? [];
    const adults = members.filter((person) => person.ageGroup === "adult");
    const prolongedUnemployment = adults.length > 0
      && adults.every((person) => person.unemployedDays >= UNEMPLOYED_DAYS_BEFORE_MOVE);
    const rentCrisis = household.unaffordableDays >= RENT_ARREARS_DAYS_BEFORE_MOVE
      && household.rentArrears >= household.rentPerDay * 10;
    return household.money < household.rentPerDay * 3 && (prolongedUnemployment || rentCrisis);
  });
  if (departing.length === 0) return { households: 0, residents: 0 };

  const departingHouseholdIds = new Set(departing.map((household) => household.id));
  const departingPeople = people.filter((person) => departingHouseholdIds.has(person.householdId));
  const departingPersonIds = new Set(departingPeople.map((person) => person.id));
  for (const building of buildings) {
    building.residentIds = building.residentIds.filter((id) => !departingPersonIds.has(id));
    building.employeeIds = building.employeeIds.filter((id) => !departingPersonIds.has(id));
  }
  for (let index = households.length - 1; index >= 0; index -= 1) {
    if (departingHouseholdIds.has(households[index]!.id)) households.splice(index, 1);
  }
  for (let index = people.length - 1; index >= 0; index -= 1) {
    if (departingPersonIds.has(people[index]!.id)) people.splice(index, 1);
  }
  events.push(`${departing.length} detailed households (${departingPeople.length} residents) left the section after sustained economic hardship.`);
  return { households: departing.length, residents: departingPeople.length };
}

function freightCost(
  origin: Pick<Building, "x" | "z">,
  destination: Pick<Building, "x" | "z">,
  units: number,
): number {
  return Math.hypot(destination.x - origin.x, destination.z - origin.z)
    * units
    * TRANSPORT_COST_PER_UNIT_DISTANCE;
}

function requireAccounting(building: Building): BuildingAccounting {
  building.accounting ??= emptyBuildingAccounting(building);
  return building.accounting;
}

function emptyBuildingAccounting(building: Building): BuildingAccounting {
  const operatingModel = operatingModelFor(building);
  const ratio = staffingRatio(building);
  return {
    operatingModel,
    operatingStatus: operatingStatusFor(building, operatingModel, ratio),
    serviceKind: serviceKindFor(building),
    requiredWorkers: operatingModel === "housing" ? 0 : building.jobCapacity,
    staffingRatio: round(ratio),
    averageWage: round(building.wageOffer ?? 0),
    unitPrice: round(building.buildingUse === "retail" ? building.retailPrice ?? RETAIL_PRICE : 0),
    cashReserve: round(building.cashReserve ?? 0),
    workforceChange: 0,
    lossStreak: building.unprofitableDays ?? 0,
    dailyWages: 0,
    rentIncome: 0,
    occupancyCost: 0,
    maintenanceCost: 0,
    utilityCost: 0,
    goodsReceived: 0,
    localSupplies: 0,
    importedSupplies: 0,
    supplyCost: 0,
    transportCost: 0,
    goodsSold: 0,
    revenue: 0,
    operatingCost: 0,
    profit: 0,
    customers: 0,
    municipalFunding: 0,
    serviceDemand: 0,
    serviceDelivered: 0,
    serviceQuality: 0,
  };
}

function operatingModelFor(building: Building): BuildingOperatingModel {
  if (building.buildingUse === "housing") return "housing";
  if (building.buildingUse === "school" || building.buildingUse === "library" || building.buildingUse === "clinic") {
    return "civic";
  }
  if (building.buildingUse === "park") return "amenity";
  return "business";
}

function serviceKindFor(building: Building): CivicServiceKind {
  if (building.buildingUse === "school") return "education";
  if (building.buildingUse === "clinic") return "health";
  if (building.buildingUse === "library") return "library";
  if (building.buildingUse === "park") return "recreation";
  return "none";
}

function staffingRatio(building: Building): number {
  if (building.buildingUse === "housing") return 1;
  if (building.jobCapacity <= 0) return 0;
  return clamp(building.employeeIds.length / building.jobCapacity, 0, 1);
}

function essentialUtilityRatio(building: Building): number {
  if (building.buildingUse === "park") {
    return Math.min(building.utilityService.water, building.utilityService.waste);
  }
  if (building.buildingUse === "library") return building.utilityService.power;
  return Math.min(building.utilityService.power, building.utilityService.water);
}

function operatingStatusFor(
  building: Building,
  model: BuildingOperatingModel,
  ratio: number,
): BuildingAccounting["operatingStatus"] {
  if (model === "housing") return building.residentIds.length > 0 ? "occupied" : "closed";
  if ((building.closedDaysRemaining ?? 0) > 0) return "closed";
  if (ratio <= 0 || essentialUtilityRatio(building) <= 0) return "closed";
  if (ratio < 0.75) return "understaffed";
  return model === "business" ? "operating" : "funded";
}

function isOperationalBusiness(building: Building): boolean {
  return operatingModelFor(building) === "business"
    && (building.closedDaysRemaining ?? 0) <= 0
    && staffingRatio(building) > 0
    && essentialUtilityRatio(building) > 0;
}

function businessOperatingRatio(building: Building): number {
  if (!isOperationalBusiness(building)) return 0;
  return clamp(
    staffingRatio(building)
      * essentialUtilityRatio(building)
      * (0.8 + building.utilityService.waste * 0.2),
    0,
    1,
  );
}

function maintenanceCost(building: Building): number {
  if (building.buildingUse === "housing") return building.floors * 5 + building.residentCapacity * 0.25;
  if (building.buildingUse === "park") return building.floors * 4 + building.landValue * 0.015;
  if (building.zone === "civic") return building.floors * 8 + building.jobCapacity * 0.8;
  return building.floors * 4 + building.jobCapacity * 0.25;
}

function baseWageFor(building: Building): number {
  if (building.buildingUse === "retail") return 108;
  if (building.buildingUse === "industrial") return 132;
  if (building.buildingUse === "school" || building.buildingUse === "clinic") return 156;
  if (building.buildingUse === "library") return 142;
  if (building.buildingUse === "park") return 104;
  return 90;
}

function skillWageMultiplier(incomeBand: IncomeBand): number {
  if (incomeBand === "low") return 0.86;
  if (incomeBand === "high") return 1.18;
  return 1;
}

function initialBusinessReserve(building: Building): number {
  return Math.max(
    4_000,
    (building.maximumJobCapacity ?? building.jobCapacity) * Math.max(60, building.wageOffer ?? baseWageFor(building)) * 18,
  );
}

function sumAccounting(
  buildings: readonly Building[],
  model: BuildingOperatingModel,
  select: (accounting: BuildingAccounting) => number,
): number {
  return buildings.reduce((total, building) => {
    const accounting = requireAccounting(building);
    return total + (accounting.operatingModel === model ? select(accounting) : 0);
  }, 0);
}

function clonePerson(person: Person): Person {
  return {
    ...person,
    needs: { ...person.needs },
    schedule: person.schedule.map((activity) => ({ ...activity })),
  };
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
