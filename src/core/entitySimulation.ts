import type { CitySectionState } from "../models/cityTypes";
import type {
  BuildingAccounting,
  BuildingConnectionKind,
  BuildingFunction,
  DetailedBuilding,
  DetailedEntityState,
  DetailedHousehold,
  DetailedPerson,
  EntityBuildingDefinition,
  EntityConnection,
  EntityEvent,
  PersonActivity,
  PersonNeed,
  PersonScheduleItem,
  TravelMode,
} from "../models/entityTypes";

const SAMPLE_POPULATION = 760;
const OUTSIDE_WORK = "outside-work";
const OUTSIDE_MARKET = "outside-market";
const MAX_EVENTS = 36;

export interface EntityPolicy {
  utilityCapacityScale: number;
  roadCapacityScale: number;
  transitServiceScale: number;
  zoningStrictness: number;
}

export function createDetailedEntityState(
  definitions: readonly EntityBuildingDefinition[],
  city: Readonly<CitySectionState>,
): DetailedEntityState {
  const buildings = definitions.map(createBuilding);
  const population = createPopulation(buildings);
  let state: DetailedEntityState = {
    buildings: population.buildings,
    people: population.people,
    households: population.households,
    connections: [],
    events: [],
    lastUpdatedDay: -1,
  };
  state = advanceDetailedDay(state, city, 0, defaultPolicy(), false);
  return {
    ...state,
    events: [],
    lastUpdatedDay: 0,
  };
}

export function advanceDetailedTime(
  state: Readonly<DetailedEntityState>,
  city: Readonly<CitySectionState>,
  completedDay: number,
  minuteOfDay: number,
  policy: Readonly<EntityPolicy>,
): DetailedEntityState {
  let next = state as DetailedEntityState;
  for (let day = state.lastUpdatedDay + 1; day <= completedDay; day += 1) {
    next = advanceDetailedDay(next, city, day, policy, true);
  }
  const normalizedMinute = ((minuteOfDay % 1440) + 1440) % 1440;
  return {
    ...next,
    people: next.people.map((person) => {
      const activity = activityAt(person.schedule, normalizedMinute);
      return activity
        ? {
            ...person,
            currentActivity: activity.activity,
            currentBuildingId: activity.buildingId,
          }
        : person;
    }),
  };
}

export function rebuildEntityConnections(
  people: readonly DetailedPerson[],
  buildings: readonly DetailedBuilding[],
): EntityConnection[] {
  const connections = new Map<string, EntityConnection>();
  const add = (
    kind: BuildingConnectionKind,
    from: string,
    to: string,
    personId?: string,
    volume = 1,
  ): void => {
    if (from === to) return;
    const key = `${kind}:${from}:${to}`;
    const current = connections.get(key) ?? {
      id: key,
      kind,
      fromBuildingId: from,
      toBuildingId: to,
      volume: 0,
      personIds: [],
    };
    current.volume += volume;
    if (personId && current.personIds.length < 40) current.personIds.push(personId);
    connections.set(key, current);
  };

  for (const person of people) {
    if (person.workBuildingId) add("commute", person.homeBuildingId, person.workBuildingId, person.id);
    else if (person.employment === "external") add("commute", person.homeBuildingId, OUTSIDE_WORK, person.id);
    for (const item of person.schedule) {
      if (["shop", "library", "healthcare", "leisure"].includes(item.activity)) {
        add("customer", person.homeBuildingId, item.buildingId, person.id);
      }
    }
  }

  const suppliers = buildings.filter((building) => building.function === "industrial");
  for (const building of buildings) {
    if (!requiresSupplies(building.function)) continue;
    const supplier = nearestBuilding(building, suppliers);
    if (supplier) add("supply", supplier.id, building.id, undefined, Math.max(1, building.accounting.localSupplies));
    if (building.accounting.importedSupplies > 0) {
      add("supply", OUTSIDE_MARKET, building.id, undefined, building.accounting.importedSupplies);
    }
  }
  return [...connections.values()].sort((a, b) => b.volume - a.volume);
}

function createBuilding(definition: EntityBuildingDefinition): DetailedBuilding {
  const floorArea = definition.width * definition.depth * definition.floors;
  const residentCapacity = definition.function === "housing"
    ? clamp(Math.round(floorArea / 135), 8, 42)
    : 0;
  const jobCapacity = jobCapacityFor(definition.function, floorArea, definition.source);
  const landValue = clamp(
    180 + (760 - Math.min(760, Math.hypot(definition.x, definition.z))) * 0.18
      + hashUnit(definition.id) * 95,
    120,
    430,
  );
  const requiredWorkers = Math.max(0, Math.round(jobCapacity * 0.82));
  return {
    ...definition,
    residentCapacity,
    residentIds: [],
    jobCapacity,
    employeeIds: [],
    landValue: round(landValue),
    rentDaily: definition.function === "housing" ? round(32 + landValue * 0.11) : 0,
    goodsInventory: requiresSupplies(definition.function) ? 24 + Math.round(hashUnit(`${definition.id}:stock`) * 80) : 0,
    cashReserve: 2_000 + Math.round(hashUnit(`${definition.id}:cash`) * 14_000),
    closedDaysRemaining: 0,
    utilityDemand: utilityDemandFor(definition.function, floorArea),
    utilityService: { power: 1, water: 1, waste: 1 },
    accounting: emptyAccounting(requiredWorkers),
  };
}

function createPopulation(buildings: DetailedBuilding[]): {
  buildings: DetailedBuilding[];
  people: DetailedPerson[];
  households: DetailedHousehold[];
} {
  const homes = buildings.filter((building) => building.function === "housing");
  const workplaces = buildings.filter((building) => building.jobCapacity > 0);
  const schools = buildings.filter((building) => building.function === "school" || building.function === "university");
  const services = serviceBuildings(buildings);
  const people: DetailedPerson[] = [];
  const households: DetailedHousehold[] = [];
  let personNumber = 0;
  let householdNumber = 0;

  for (const home of homes) {
    const target = Math.min(home.residentCapacity, Math.max(8, Math.round(home.residentCapacity * 0.82)));
    while (home.residentIds.length < target && people.length < SAMPLE_POPULATION) {
      const householdSize = Math.min(target - home.residentIds.length, 1 + Math.floor(hashUnit(`hh:${householdNumber}`) * 4));
      const householdId = `household-${householdNumber}`;
      const memberIds: string[] = [];
      for (let member = 0; member < householdSize; member += 1) {
        const age = ageFor(personNumber, member, householdSize);
        const personId = `person-${personNumber}`;
        const work = age >= 18 && age < 68 && hashUnit(`${personId}:external`) > 0.1
          ? assignWorkplace(workplaces, people)
          : undefined;
        const school = age < 22 ? nearestBuilding(home, schools) : undefined;
        const employment = age < 18 || (age < 23 && personNumber % 4 === 0)
          ? "student"
          : age >= 68
            ? "retired"
            : work
              ? "local"
              : hashUnit(`${personId}:job`) > 0.28
                ? "external"
                : "unemployed";
        const person: DetailedPerson = {
          id: personId,
          name: personName(personNumber),
          householdId,
          age,
          homeBuildingId: home.id,
          workBuildingId: employment === "local" ? work?.id : undefined,
          schoolBuildingId: employment === "student" ? school?.id : undefined,
          employment,
          currentActivity: "home",
          currentBuildingId: home.id,
          schedule: [],
          needs: initialNeeds(personNumber),
          happiness: 70,
          dailyWage: employment === "external" ? 185 : 0,
          dailySpending: 0,
          commuteCost: employment === "external" ? 18 : 0,
          money: 220 + hashUnit(`${personId}:money`) * 1_800,
          migrationStatus: "staying",
          migrationReason: "Employment, housing, and services are currently stable.",
          unemployedDays: employment === "unemployed" ? 1 : 0,
        };
        person.schedule = createSchedule(person, home, work, school, services, buildings, 0);
        people.push(person);
        home.residentIds.push(personId);
        memberIds.push(personId);
        personNumber += 1;
      }
      households.push({
        id: householdId,
        homeBuildingId: home.id,
        memberIds,
        money: 2_000 + hashUnit(`${householdId}:money`) * 9_000,
        dailyIncome: 0,
        dailyExpenses: emptyExpenses(),
        rentArrears: 0,
      });
      householdNumber += 1;
    }
  }
  return { buildings, people, households };
}

function advanceDetailedDay(
  state: Readonly<DetailedEntityState>,
  city: Readonly<CitySectionState>,
  day: number,
  policy: Readonly<EntityPolicy>,
  recordEvents: boolean,
): DetailedEntityState {
  const events: EntityEvent[] = [];
  const people = state.people.map((person) => ({ ...person, needs: { ...person.needs } }));
  const households = state.households.map((household) => ({
    ...household,
    memberIds: [...household.memberIds],
    dailyExpenses: { ...household.dailyExpenses },
  }));
  let buildings: DetailedBuilding[] = state.buildings.map((building) => ({
    ...building,
    residentIds: [...building.residentIds],
    employeeIds: [],
    utilityDemand: { ...building.utilityDemand },
    utilityService: { ...building.utilityService },
    accounting: { ...building.accounting },
  }));

  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  allocateUtilities(buildings, city, policy);
  allocateLabor(people, buildings, buildingById, day, events, recordEvents);
  const services = serviceBuildings(buildings);
  for (const person of people) {
    const home = buildingById.get(person.homeBuildingId);
    if (!home) continue;
    const work = person.workBuildingId ? buildingById.get(person.workBuildingId) : undefined;
    const school = person.schoolBuildingId ? buildingById.get(person.schoolBuildingId) : undefined;
    person.schedule = createSchedule(person, home, work, school, services, buildings, day);
  }
  const customerCounts = countScheduledVisits(people);
  buildings = buildings.map((building) => advanceBuilding(
    building,
    customerCounts.get(building.id) ?? 0,
    city,
    policy,
    day,
    events,
    recordEvents,
  ));
  const updatedBuildingById = new Map(buildings.map((building) => [building.id, building]));
  const householdById = new Map(households.map((household) => [household.id, household]));

  for (const person of people) {
    const workplace = person.workBuildingId ? updatedBuildingById.get(person.workBuildingId) : undefined;
    if (person.employment === "local" && workplace?.accounting.status !== "closed") {
      person.dailyWage = workplace?.accounting.averageWage ?? person.dailyWage;
      person.unemployedDays = 0;
    } else if (person.employment === "local") {
      person.employment = "unemployed";
      person.workBuildingId = undefined;
      person.dailyWage = 0;
      person.unemployedDays += 1;
    } else if (person.employment === "unemployed") {
      person.unemployedDays += 1;
    }
    const household = householdById.get(person.householdId);
    const perPersonHousing = household
      ? (updatedBuildingById.get(household.homeBuildingId)?.rentDaily ?? 0) / Math.max(1, household.memberIds.length)
      : 0;
    const goods = 11 + person.needs.goods * 0.1;
    const services = (person.needs.health + person.needs.education + person.needs.recreation) * 0.025;
    person.commuteCost = commuteCost(person, updatedBuildingById, policy);
    person.dailySpending = round(perPersonHousing + goods + services + person.commuteCost);
    person.money = round(person.money + person.dailyWage - person.dailySpending);
    updateNeedsAndMigration(person, city, day, events, recordEvents);
  }

  for (const household of households) {
    const members = household.memberIds.map((id) => people.find((person) => person.id === id)).filter(Boolean) as DetailedPerson[];
    const home = updatedBuildingById.get(household.homeBuildingId);
    const housing = home?.rentDaily ?? 0;
    const income = sum(members.map((person) => person.dailyWage));
    const goods = sum(members.map((person) => 11 + person.needs.goods * 0.1));
    const utilities = housing * (1 - averageUtility(home)) * 0.08 + housing * 0.12;
    const transport = sum(members.map((person) => person.commuteCost));
    const services = sum(members.map((person) => person.dailySpending)) - housing - goods - transport;
    household.dailyIncome = round(income);
    household.dailyExpenses = {
      housing: round(housing),
      goods: round(goods),
      utilities: round(Math.max(0, utilities)),
      transport: round(transport),
      services: round(Math.max(0, services)),
      total: round(housing + goods + utilities + transport + Math.max(0, services)),
    };
    household.money = round(household.money + income - household.dailyExpenses.total);
    household.rentArrears = household.money < 0
      ? round(household.rentArrears + Math.min(housing, Math.abs(household.money)))
      : Math.max(0, round(household.rentArrears - housing * 0.15));
  }

  const connections = rebuildEntityConnections(people, buildings);
  return {
    buildings,
    people,
    households,
    connections,
    events: [...events, ...state.events].slice(0, MAX_EVENTS),
    lastUpdatedDay: day,
  };
}

function allocateLabor(
  people: DetailedPerson[],
  buildings: DetailedBuilding[],
  buildingById: Map<string, DetailedBuilding>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): void {
  const eligible = people.filter((person) => person.age >= 18 && person.age < 68 && person.employment !== "student");
  for (const person of eligible) {
    if (person.workBuildingId) {
      const building = buildingById.get(person.workBuildingId);
      if (building && building.closedDaysRemaining === 0 && building.employeeIds.length < building.jobCapacity) {
        building.employeeIds.push(person.id);
        person.employment = "local";
        continue;
      }
    }
    if (person.employment === "external") continue;
    const vacancy = nearestBuilding(
      buildingById.get(person.homeBuildingId),
      buildings.filter((building) =>
        building.closedDaysRemaining === 0 &&
        building.jobCapacity > building.employeeIds.length &&
        building.function !== "parking"),
    );
    if (vacancy) {
      const wasUnemployed = person.employment === "unemployed";
      vacancy.employeeIds.push(person.id);
      person.workBuildingId = vacancy.id;
      person.employment = "local";
      if (recordEvents && wasUnemployed && day % 3 === 0) {
        events.push(event(day, "labor", "info", `${person.name} was hired by ${vacancy.name}.`, vacancy.id, person.id));
      }
    }
  }
}

function advanceBuilding(
  building: DetailedBuilding,
  scheduledCustomers: number,
  city: Readonly<CitySectionState>,
  policy: Readonly<EntityPolicy>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): DetailedBuilding {
  const previous = building.accounting;
  let closedDaysRemaining = Math.max(0, building.closedDaysRemaining - 1);
  const closed = closedDaysRemaining > 0;
  const requiredWorkers = Math.max(0, Math.round(building.jobCapacity * (0.68 + hashUnit(`${building.id}:${Math.floor(day / 14)}`) * 0.25)));
  const employees = closed ? 0 : building.employeeIds.length;
  const staffingRatio = requiredWorkers > 0 ? clamp(employees / requiredWorkers, 0, 1) : 1;
  const utility = averageUtility(building);
  const wagePressure = requiredWorkers > employees ? 1.012 : 0.998;
  const averageWage = round(clamp((previous.averageWage || baseWage(building.function)) * wagePressure, 78, 320));
  const dailyWages = round(employees * averageWage);
  const maintenanceCost = round(building.width * building.depth * building.floors * maintenanceRate(building.function));
  const utilityCost = round(sum(Object.values(building.utilityDemand)) * (0.12 + (1 - utility) * 0.04));
  const unitPrice = round(dynamicPrice(building, previous));
  const customers = closed ? 0 : Math.round(scheduledCustomers * (0.75 + hashUnit(`${building.id}:customers:${day}`) * 0.5));
  const laborCapacity = closed ? 0 : staffingRatio;
  const goodsReceived = requiresSupplies(building.function)
    ? round((8 + building.jobCapacity * 1.7) * laborCapacity * utility)
    : 0;
  const localShare = clamp(city.market.localSupplyPercent / 100, 0.18, 0.82);
  const localSupplies = round(goodsReceived * localShare);
  const importedSupplies = round(goodsReceived - localSupplies);
  const importedUnitCost = 6.8 * clamp(city.market.consumerPriceIndex / 20, 0.8, 1.6);
  const supplyCost = round(localSupplies * 5.2 + importedSupplies * importedUnitCost);
  const transportCost = round(importedSupplies * (1.4 + (1 / Math.max(0.55, policy.roadCapacityScale))));
  const civic = isCivic(building.function);
  const housing = building.function === "housing";
  const serviceDemand = civic ? scheduledCustomers + building.residentIds.length * 0.05 : 0;
  const serviceDelivered = civic ? round(serviceDemand * staffingRatio * utility) : 0;
  const serviceQuality = civic && serviceDemand > 0 ? clamp(serviceDelivered / serviceDemand, 0, 1) : civic ? staffingRatio * utility : 0;
  const rentIncome = housing ? round(building.residentIds.length * building.rentDaily / Math.max(1, building.residentCapacity / 2.4)) : 0;
  const municipalFunding = civic
    ? round(requiredWorkers * averageWage * (0.92 + city.metrics.civicServiceCoveragePercent / 500))
    : 0;
  let goodsSold = 0;
  let salesRevenue = 0;
  if (!closed && staffingRatio > 0) {
    if (building.function === "retail") {
      goodsSold = round(Math.min(building.goodsInventory + goodsReceived, customers * (1.4 + utility)));
      salesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "office") {
      goodsSold = round((employees * 3.8 + customers * 0.35) * utility);
      salesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "industrial") {
      goodsSold = round((employees * 9 + customers * 0.35) * utility);
      salesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "parking") {
      goodsSold = round(employees * 8 + 18);
      salesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "culture" || building.function === "recreation") {
      salesRevenue = round(customers * unitPrice * 0.35);
    }
  }
  const operatingRevenue = round(rentIncome + municipalFunding + salesRevenue);
  const operatingCost = round(dailyWages + supplyCost + transportCost + maintenanceCost + utilityCost);
  const profit = round(operatingRevenue - operatingCost);
  const cashReserve = round(building.cashReserve + profit);
  const lossStreak = profit < 0 && !civic && !housing ? previous.lossStreak + 1 : 0;
  let status: BuildingAccounting["status"] = housing ? "occupied" : civic ? "funded" : "operating";
  if (closed) status = "closed";
  else if (staffingRatio < 0.7 && requiredWorkers > 0) status = "understaffed";

  if (!closed && lossStreak >= 6 && cashReserve < 0 && !civic && !housing) {
    closedDaysRemaining = 14;
    status = "closed";
    if (recordEvents) events.push(event(day, "business", "warning", `${building.name} closed after six loss-making days.`, building.id));
  }
  const workforceChange = employees - previous.requiredWorkers * previous.staffingRatio;
  if (recordEvents && workforceChange <= -2) {
    events.push(event(day, "labor", "warning", `${building.name} reduced its workforce by ${Math.abs(Math.round(workforceChange))}.`, building.id));
  }
  if (recordEvents && civic && serviceQuality < 0.65) {
    events.push(event(day, "services", "warning", `${building.name} met only ${Math.round(serviceQuality * 100)}% of scheduled service demand.`, building.id));
  }
  const targetLandValue = 125 + utility * 110 + staffingRatio * 45
    + clamp((city.metrics.happiness - 50) / 50, 0, 1) * 65
    - city.metrics.congestionPercent * 0.8;
  const landValue = round(clamp(building.landValue + (targetLandValue - building.landValue) * 0.025, 80, 520));
  const occupancy = housing ? building.residentIds.length / Math.max(1, building.residentCapacity) : 0;
  const rentDaily = housing
    ? round(clamp(building.rentDaily * (occupancy > 0.88 ? 1.003 : occupancy < 0.65 ? 0.996 : 1), 22, 95))
    : 0;
  const diagnosis = diagnoseBuilding(building.function, status, profit, staffingRatio, utility, importedSupplies, serviceQuality);

  return {
    ...building,
    landValue,
    rentDaily,
    cashReserve,
    closedDaysRemaining,
    goodsInventory: round(Math.max(0, building.goodsInventory + goodsReceived - goodsSold)),
    accounting: {
      status,
      requiredWorkers,
      staffingRatio: round(staffingRatio),
      averageWage,
      unitPrice,
      dailyWages,
      rentIncome,
      municipalFunding,
      salesRevenue,
      operatingRevenue,
      supplyCost,
      transportCost,
      maintenanceCost,
      utilityCost,
      operatingCost,
      profit,
      customers,
      serviceDemand: round(serviceDemand),
      serviceDelivered,
      serviceQuality: round(serviceQuality),
      goodsReceived,
      localSupplies,
      importedSupplies,
      goodsSold,
      workforceChange: round(workforceChange),
      lossStreak,
      diagnosis,
    },
  };
}

function allocateUtilities(
  buildings: DetailedBuilding[],
  city: Readonly<CitySectionState>,
  policy: Readonly<EntityPolicy>,
): void {
  for (const kind of ["power", "water", "waste"] as const) {
    const demand = sum(buildings.map((building) => building.utilityDemand[kind]));
    const cityCoverage = clamp(city.metrics.utilityCoveragePercent / 100, 0.35, 1);
    const capacity = demand * cityCoverage * policy.utilityCapacityScale;
    const baseCoverage = clamp(capacity / Math.max(1, demand), 0, 1);
    for (const building of buildings) {
      const priority = isCivic(building.function) ? 1.04 : building.function === "housing" ? 1.01 : 0.98;
      building.utilityService[kind] = round(clamp(baseCoverage * priority, 0, 1));
    }
  }
}

function updateNeedsAndMigration(
  person: DetailedPerson,
  city: Readonly<CitySectionState>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): void {
  const visits = new Set(person.schedule.map((item) => item.activity));
  for (const need of Object.keys(person.needs) as PersonNeed[]) {
    const met = need === "goods" ? visits.has("shop")
      : need === "health" ? visits.has("healthcare")
        : need === "education" ? visits.has("school") || visits.has("library")
          : need === "community" ? visits.has("library") || visits.has("leisure")
            : visits.has("leisure");
    person.needs[need] = round(clamp(person.needs[need] + (met ? 7 : -3), 0, 100));
  }
  const needs = sum(Object.values(person.needs)) / 5;
  const employmentScore = person.employment === "unemployed" ? 32 : 78;
  const financialScore = clamp(55 + person.money / 80, 20, 95);
  person.happiness = round(clamp(needs * 0.48 + employmentScore * 0.27 + financialScore * 0.15 + city.metrics.happiness * 0.1, 0, 100));
  if (person.unemployedDays > 30 || person.money < -500 || person.happiness < 35) {
    person.migrationStatus = person.unemployedDays > 90 || person.money < -2_000 ? "moving-out" : "considering-leaving";
    person.migrationReason = person.unemployedDays > 30
      ? `${person.unemployedDays} days without work is the strongest reason to leave.`
      : person.money < -500
        ? "Housing and daily expenses exceed household income."
        : "Unmet services and low happiness are making relocation more attractive.";
    if (recordEvents && person.migrationStatus === "moving-out" && day % 15 === 0) {
      events.push(event(day, "migration", "warning", `${person.name} is preparing to leave the district: ${person.migrationReason}`, undefined, person.id));
    }
  } else {
    person.migrationStatus = "staying";
    person.migrationReason = person.employment === "local"
      ? "A local job, manageable expenses, and nearby services support staying."
      : "Household finances and access to services remain acceptable.";
  }
}

function createSchedule(
  person: DetailedPerson,
  home: DetailedBuilding,
  work: DetailedBuilding | undefined,
  school: DetailedBuilding | undefined,
  services: ReturnType<typeof serviceBuildings>,
  buildings: readonly DetailedBuilding[],
  day: number,
): PersonScheduleItem[] {
  const schedule: PersonScheduleItem[] = [item("home", 0, 420, home, "walk", 0)];
  const destination = person.employment === "student" ? school : work;
  if (destination) {
    const mode = chooseMode(home, destination);
    const travelMinutes = travelTime(home, destination, mode);
    schedule.push(item(person.employment === "student" ? "school" : "work", 480, 1_020, destination, mode, travelMinutes));
  } else if (person.employment === "external") {
    schedule.push({ activity: "work", startMinute: 450, endMinute: 1_030, buildingId: OUTSIDE_WORK, mode: "transit", travelMinutes: 34 });
  }
  const selector = (Number(person.id.replace("person-", "")) + day) % 7;
  const activity: PersonActivity = [
    "shop",
    "library",
    "leisure",
    "shop",
    "leisure",
    "library",
    "healthcare",
  ][selector] as PersonActivity;
  const candidates = activity === "shop" ? services.retail
    : activity === "library" ? services.library
      : activity === "healthcare" ? services.clinic
        : services.recreation;
  const service = nearestBuilding(home, candidates) ?? nearestBuilding(home, buildings);
  if (service) {
    const mode = chooseMode(destination ?? home, service);
    schedule.push(item(activity, 1_050, 1_140, service, mode, travelTime(destination ?? home, service, mode)));
  }
  schedule.push(item("home", 1_180, 1_440, home, "walk", service ? travelTime(service, home, "walk") : 0));
  return schedule;
}

function serviceBuildings(buildings: readonly DetailedBuilding[]) {
  return {
    retail: buildings.filter((building) => building.function === "retail"),
    library: buildings.filter((building) => building.function === "library" || building.function === "culture"),
    clinic: buildings.filter((building) => building.function === "clinic"),
    recreation: buildings.filter((building) => building.function === "recreation" || building.function === "culture"),
  };
}

function assignWorkplace(workplaces: DetailedBuilding[], people: readonly DetailedPerson[]): DetailedBuilding | undefined {
  const assigned = new Map<string, number>();
  for (const person of people) {
    if (person.workBuildingId) assigned.set(person.workBuildingId, (assigned.get(person.workBuildingId) ?? 0) + 1);
  }
  return workplaces
    .filter((building) => (assigned.get(building.id) ?? 0) < building.jobCapacity)
    .sort((a, b) => (assigned.get(a.id) ?? 0) / Math.max(1, a.jobCapacity) - (assigned.get(b.id) ?? 0) / Math.max(1, b.jobCapacity))[0];
}

function nearestBuilding<T extends Pick<DetailedBuilding, "x" | "z">>(
  origin: T | undefined,
  candidates: readonly DetailedBuilding[],
): DetailedBuilding | undefined {
  if (!origin || candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => distance(origin, a) - distance(origin, b))[0];
}

function activityAt(schedule: readonly PersonScheduleItem[], minute: number): PersonScheduleItem | undefined {
  return schedule.find((item) => minute >= item.startMinute && minute < item.endMinute) ?? schedule.at(-1);
}

function countScheduledVisits(people: readonly DetailedPerson[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const person of people) {
    for (const visit of person.schedule) {
      if (["shop", "library", "healthcare", "leisure", "school"].includes(visit.activity)) {
        counts.set(visit.buildingId, (counts.get(visit.buildingId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function commuteCost(
  person: DetailedPerson,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  policy: Readonly<EntityPolicy>,
): number {
  if (person.employment === "external") return round(8 + 12 / Math.max(0.6, policy.transitServiceScale));
  const home = buildings.get(person.homeBuildingId);
  const work = person.workBuildingId ? buildings.get(person.workBuildingId) : undefined;
  if (!home || !work) return 0;
  const kilometers = distance(home, work) / 1000;
  return round(kilometers < 0.8 ? 0 : kilometers * 3.6 / Math.max(0.6, policy.roadCapacityScale));
}

function dynamicPrice(building: DetailedBuilding, previous: BuildingAccounting): number {
  const base = building.function === "retail" ? 22
    : building.function === "industrial" ? 40
      : building.function === "office" ? 160
        : building.function === "parking" ? 18
          : building.function === "culture" || building.function === "recreation" ? 12
            : 0;
  if (base === 0) return 0;
  const stockPressure = building.goodsInventory < 15 ? 1.08 : building.goodsInventory > 90 ? 0.98 : 1;
  return clamp((previous.unitPrice || base) * stockPressure, base * 0.7, base * 1.8);
}

function diagnoseBuilding(
  buildingFunction: BuildingFunction,
  status: BuildingAccounting["status"],
  profit: number,
  staffing: number,
  utility: number,
  imports: number,
  serviceQuality: number,
): string {
  if (status === "closed") return "Operations are suspended after sustained losses; employees and customers are being redirected.";
  if (staffing < 0.7) return `Only ${Math.round(staffing * 100)}% of required positions are filled, limiting output and service capacity.`;
  if (utility < 0.85) return `Utility delivery is ${Math.round(utility * 100)}%, reducing usable capacity and increasing operating costs.`;
  if (isCivic(buildingFunction)) {
    return serviceQuality >= 0.9
      ? "Municipal funding and staffing are meeting most scheduled service visits."
      : `Funding covers operations, but only ${Math.round(serviceQuality * 100)}% of service demand is being met.`;
  }
  if (buildingFunction === "housing") return profit >= 0
    ? "Rent receipts cover maintenance and utility costs; occupancy is supporting stable rent."
    : "Maintenance and utility costs exceed current rent receipts.";
  if (profit < 0 && imports > 0) return "Imported supplies, transport costs, and payroll exceed current sales revenue.";
  return profit >= 0
    ? "Sales and service revenue cover payroll, supplies, utilities, and maintenance."
    : "Demand is too low to cover current operating costs.";
}

function item(
  activity: PersonActivity,
  startMinute: number,
  endMinute: number,
  building: Pick<DetailedBuilding, "id">,
  mode: TravelMode,
  travelMinutes: number,
): PersonScheduleItem {
  return { activity, startMinute, endMinute, buildingId: building.id, mode, travelMinutes };
}

function chooseMode(from: Pick<DetailedBuilding, "x" | "z">, to: Pick<DetailedBuilding, "x" | "z">): TravelMode {
  const meters = distance(from, to);
  return meters < 650 ? "walk" : meters < 1_450 ? "transit" : "car";
}

function travelTime(from: Pick<DetailedBuilding, "x" | "z">, to: Pick<DetailedBuilding, "x" | "z">, mode: TravelMode): number {
  const speed = mode === "walk" ? 78 : mode === "transit" ? 280 : 420;
  return Math.max(2, Math.round(distance(from, to) / speed + (mode === "transit" ? 6 : 1)));
}

function jobCapacityFor(buildingFunction: BuildingFunction, floorArea: number, source: "block" | "landmark"): number {
  if (buildingFunction === "housing") return 1;
  if (buildingFunction === "parking") return 2;
  const divisor = buildingFunction === "retail" ? 1_300
    : buildingFunction === "office" ? 1_100
      : buildingFunction === "industrial" ? 1_600
        : buildingFunction === "recreation" ? 2_500
          : 1_450;
  return clamp(Math.round(floorArea / divisor), source === "landmark" ? 6 : 2, source === "landmark" ? 20 : 7);
}

function utilityDemandFor(buildingFunction: BuildingFunction, floorArea: number) {
  const scale = floorArea / 1_000;
  const powerRate = buildingFunction === "industrial" ? 2.4 : buildingFunction === "clinic" ? 2 : 1.1;
  const waterRate = buildingFunction === "housing" || buildingFunction === "clinic" ? 1.8 : 0.8;
  const wasteRate = buildingFunction === "retail" || buildingFunction === "industrial" ? 1.5 : 0.65;
  return { power: round(scale * powerRate), water: round(scale * waterRate), waste: round(scale * wasteRate) };
}

function baseWage(buildingFunction: BuildingFunction): number {
  if (buildingFunction === "clinic") return 238;
  if (buildingFunction === "university" || buildingFunction === "office") return 205;
  if (buildingFunction === "school" || buildingFunction === "library") return 176;
  if (buildingFunction === "industrial") return 168;
  return 142;
}

function maintenanceRate(buildingFunction: BuildingFunction): number {
  return buildingFunction === "housing" ? 0.003
    : buildingFunction === "clinic" ? 0.006
      : buildingFunction === "parking" ? 0.0015
        : 0.0035;
}

function requiresSupplies(buildingFunction: BuildingFunction): boolean {
  return ["retail", "office", "university", "library", "school", "clinic", "culture", "industrial"].includes(buildingFunction);
}

function isCivic(buildingFunction: BuildingFunction): boolean {
  return ["university", "library", "school", "clinic", "culture", "recreation"].includes(buildingFunction);
}

function averageUtility(building: DetailedBuilding | undefined): number {
  return building ? sum(Object.values(building.utilityService)) / 3 : 1;
}

function emptyAccounting(requiredWorkers: number): BuildingAccounting {
  return {
    status: requiredWorkers > 0 ? "understaffed" : "occupied",
    requiredWorkers,
    staffingRatio: 0,
    averageWage: 0,
    unitPrice: 0,
    dailyWages: 0,
    rentIncome: 0,
    municipalFunding: 0,
    salesRevenue: 0,
    operatingRevenue: 0,
    supplyCost: 0,
    transportCost: 0,
    maintenanceCost: 0,
    utilityCost: 0,
    operatingCost: 0,
    profit: 0,
    customers: 0,
    serviceDemand: 0,
    serviceDelivered: 0,
    serviceQuality: 0,
    goodsReceived: 0,
    localSupplies: 0,
    importedSupplies: 0,
    goodsSold: 0,
    workforceChange: 0,
    lossStreak: 0,
    diagnosis: "The first operating day has not been calculated yet.",
  };
}

function emptyExpenses() {
  return { housing: 0, goods: 0, utilities: 0, transport: 0, services: 0, total: 0 };
}

function initialNeeds(index: number): DetailedPerson["needs"] {
  return {
    goods: 56 + Math.round(hashUnit(`${index}:goods`) * 34),
    health: 62 + Math.round(hashUnit(`${index}:health`) * 30),
    education: 58 + Math.round(hashUnit(`${index}:education`) * 36),
    community: 52 + Math.round(hashUnit(`${index}:community`) * 38),
    recreation: 48 + Math.round(hashUnit(`${index}:recreation`) * 40),
  };
}

function ageFor(index: number, member: number, householdSize: number): number {
  if (householdSize >= 3 && member === householdSize - 1) return 7 + (index % 11);
  if (index % 13 === 0) return 68 + (index % 18);
  return 21 + ((index * 7 + member * 11) % 46);
}

function personName(index: number): string {
  const first = ["Avery", "Jordan", "Maya", "Daniel", "Sofia", "Eli", "Nora", "Marcus", "Priya", "Leo", "Camila", "Noah"];
  const last = ["Carter", "Kim", "Patel", "Lewis", "Nguyen", "Rivera", "Brooks", "Chen", "Johnson", "Ahmed", "Martin", "Wilson"];
  return `${first[index % first.length]} ${last[Math.floor(index / first.length) % last.length]}`;
}

function event(
  day: number,
  category: EntityEvent["category"],
  severity: EntityEvent["severity"],
  message: string,
  buildingId?: string,
  personId?: string,
): EntityEvent {
  return { id: `${day}:${category}:${buildingId ?? personId ?? message}`, day, category, severity, message, buildingId, personId };
}

function defaultPolicy(): EntityPolicy {
  return { utilityCapacityScale: 1, roadCapacityScale: 1, transitServiceScale: 1, zoningStrictness: 1 };
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function hashUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
