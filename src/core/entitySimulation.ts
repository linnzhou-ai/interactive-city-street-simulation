import type { CitySectionState } from "../models/cityTypes";
import type {
  BuildingAccessibility,
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
const MAX_HISTORY_POINTS = 24;

export interface EntityPolicy {
  roadCapacityScale: number;
  transitServiceScale: number;
  zoningStrictness: number;
  congestionPercent: number;
  accessibilityByBuilding?: ReadonlyMap<string, BuildingAccessibility>;
  externalJobCapacityScale?: number;
  externalSupplyScale?: number;
}

interface ScheduledDemand {
  visits: ReadonlyMap<string, number>;
  retailUnits: ReadonlyMap<string, number>;
  paidServiceVisits: ReadonlyMap<string, number>;
  activeWorkers: ReadonlyMap<string, number>;
}

export function createDetailedEntityState(
  definitions: readonly EntityBuildingDefinition[],
  city: Readonly<CitySectionState>,
): DetailedEntityState {
  const buildings = definitions.map(createBuilding);
  const population = createPopulation(buildings, city.metrics.congestionPercent);
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
    if (building.accounting.externalCustomers > 0) {
      add("customer", OUTSIDE_MARKET, building.id, undefined, building.accounting.externalCustomers);
    }
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
    ? clamp(Math.round(floorArea / 2_300), 10, 32)
    : 0;
  const jobCapacity = jobCapacityFor(definition.function, floorArea, definition.source);
  const landValue = clamp(
    180 + (760 - Math.min(760, Math.hypot(definition.x, definition.z))) * 0.18
      + hashUnit(definition.id) * 95,
    120,
    430,
  );
  const requiredWorkers = requiredWorkersFor({ id: definition.id, jobCapacity, function: definition.function }, 0);
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
    accessibility: defaultAccessibility(),
    accounting: emptyAccounting(requiredWorkers),
    history: [],
  };
}

function createPopulation(buildings: DetailedBuilding[], congestionPercent: number): {
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
  const initialPolicy = { ...defaultPolicy(), congestionPercent };

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
          history: [],
        };
        person.schedule = createSchedule(
          person,
          home,
          work,
          school,
          services,
          0,
          initialPolicy,
        );
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
        lastMovedDay: -30,
        moveReason: "This household began the simulation in this residence.",
        history: [],
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
    accessibility: policy.accessibilityByBuilding?.get(building.id)
      ?? building.accessibility
      ?? defaultAccessibility(),
    accounting: { ...building.accounting },
  }));

  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  relocateHouseholds(households, people, buildings, buildingById, day, events, recordEvents);
  allocateLabor(people, buildings, buildingById, policy, day, events, recordEvents);
  const services = serviceBuildings(buildings);
  for (const person of people) {
    const home = buildingById.get(person.homeBuildingId);
    if (!home) continue;
    const work = person.workBuildingId ? buildingById.get(person.workBuildingId) : undefined;
    const school = person.schoolBuildingId ? buildingById.get(person.schoolBuildingId) : undefined;
    person.schedule = createSchedule(
      person,
      home,
      work,
      school,
      services,
      day,
      policy,
    );
  }
  const demand = countScheduledDemand(people);
  const householdCounts = new Map<string, number>();
  const rentChargedByHousehold = new Map<string, number>();
  for (const household of households) {
    householdCounts.set(
      household.homeBuildingId,
      (householdCounts.get(household.homeBuildingId) ?? 0) + 1,
    );
    rentChargedByHousehold.set(
      household.id,
      buildingById.get(household.homeBuildingId)?.rentDaily ?? 0,
    );
  }
  buildings = buildings.map((building) => advanceBuilding(
    building,
    demand.visits.get(building.id) ?? 0,
    demand.retailUnits.get(building.id) ?? 0,
    demand.paidServiceVisits.get(building.id) ?? 0,
    demand.activeWorkers.get(building.id) ?? 0,
    householdCounts.get(building.id) ?? 0,
    city,
    policy,
    day,
    events,
    recordEvents,
  ));
  const updatedBuildingById = new Map(buildings.map((building) => [building.id, building]));
  const householdById = new Map(households.map((household) => [household.id, household]));
  const goodsCostByPerson = new Map<string, number>();
  const serviceCostByPerson = new Map<string, number>();

  for (const person of people) {
    const workplace = person.workBuildingId ? updatedBuildingById.get(person.workBuildingId) : undefined;
    if (person.employment === "local" && workplace && workplace.accounting.status !== "closed") {
      person.dailyWage = person.schedule.some(
        (item) => item.activity === "work" && item.buildingId === workplace.id,
      ) ? workplace.accounting.averageWage : 0;
      person.unemployedDays = 0;
    } else if (person.employment === "external") {
      person.dailyWage = person.schedule.some(
        (item) => item.activity === "work" && item.buildingId === OUTSIDE_WORK,
      ) ? externalDailyWage(policy) : 0;
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
      ? (rentChargedByHousehold.get(household.id) ?? 0) / Math.max(1, household.memberIds.length)
      : 0;
    const goods = dailyGoodsCost(person, updatedBuildingById, demand);
    const services = dailyServiceCost(person, updatedBuildingById, demand);
    goodsCostByPerson.set(person.id, goods);
    serviceCostByPerson.set(person.id, services);
    person.commuteCost = commuteCost(person, updatedBuildingById, policy);
    person.dailySpending = round(perPersonHousing + goods + services + person.commuteCost);
    person.money = round(person.money + person.dailyWage - person.dailySpending);
    updateNeedsAndMigration(person, city, day, events, recordEvents);
  }

  for (const household of households) {
    const members = household.memberIds.map((id) => people.find((person) => person.id === id)).filter(Boolean) as DetailedPerson[];
    const housing = rentChargedByHousehold.get(household.id) ?? 0;
    const income = sum(members.map((person) => person.dailyWage));
    const goods = sum(members.map((person) => goodsCostByPerson.get(person.id) ?? 0));
    const transport = sum(members.map((person) => person.commuteCost));
    const services = sum(members.map((person) => serviceCostByPerson.get(person.id) ?? 0));
    household.dailyIncome = round(income);
    household.dailyExpenses = {
      housing: round(housing),
      goods: round(goods),
      transport: round(transport),
      services: round(Math.max(0, services)),
      total: round(housing + goods + transport + Math.max(0, services)),
    };
    household.money = round(household.money + income - household.dailyExpenses.total);
    household.rentArrears = household.money < 0
      ? round(household.rentArrears + Math.min(housing, Math.abs(household.money)))
      : Math.max(0, round(household.rentArrears - housing * 0.15));
  }

  const connections = rebuildEntityConnections(people, buildings);
  buildings = buildings.map((building) => ({
    ...building,
    history: appendHistory(building.history, buildingHistoryPoint(building, connections, day)),
  }));
  const peopleWithHistory = people.map((person) => ({
    ...person,
    history: appendHistory(person.history, {
      day,
      dailyWage: person.dailyWage,
      dailySpending: person.dailySpending,
      commuteCost: person.commuteCost,
      money: person.money,
      happiness: person.happiness,
      goodsNeed: person.needs.goods,
      healthNeed: person.needs.health,
      educationNeed: person.needs.education,
      communityNeed: person.needs.community,
      recreationNeed: person.needs.recreation,
      travelMinutes: sum(person.schedule.map((item) => item.travelMinutes)),
    }),
  }));
  const householdsWithHistory = households.map((household) => ({
    ...household,
    history: appendHistory(household.history, {
      day,
      dailyIncome: household.dailyIncome,
      housing: household.dailyExpenses.housing,
      goods: household.dailyExpenses.goods,
      transport: household.dailyExpenses.transport,
      services: household.dailyExpenses.services,
      totalExpenses: household.dailyExpenses.total,
      money: household.money,
      rentArrears: household.rentArrears,
    }),
  }));
  return {
    buildings,
    people: peopleWithHistory,
    households: householdsWithHistory,
    connections,
    events: [...events, ...state.events].slice(0, MAX_EVENTS),
    lastUpdatedDay: day,
  };
}

function buildingHistoryPoint(
  building: Readonly<DetailedBuilding>,
  connections: readonly EntityConnection[],
  day: number,
) {
  const accounting = building.accounting;
  const connectedTrips = sum(connections
    .filter((connection) => connection.fromBuildingId === building.id || connection.toBuildingId === building.id)
    .map((connection) => connection.volume));
  return {
    day,
    employees: building.employeeIds.length,
    requiredWorkers: accounting.requiredWorkers,
    activeWorkers: accounting.activeWorkers,
    operatingScale: accounting.operatingScale,
    buildingCondition: accounting.buildingCondition,
    maintenanceDeferred: accounting.maintenanceDeferred,
    targetMargin: accounting.targetMargin,
    averageWage: accounting.averageWage,
    unitPrice: accounting.unitPrice,
    operatingRevenue: accounting.operatingRevenue,
    operatingCost: accounting.operatingCost,
    profit: accounting.profit,
    dailyWages: accounting.dailyWages,
    municipalFunding: accounting.municipalFunding,
    salesRevenue: accounting.salesRevenue,
    localSalesRevenue: accounting.localSalesRevenue,
    externalSalesRevenue: accounting.externalSalesRevenue,
    supplyCost: accounting.supplyCost,
    transportCost: accounting.transportCost,
    maintenanceCost: accounting.maintenanceCost,
    customers: accounting.customers,
    externalCustomers: accounting.externalCustomers,
    goodsDemanded: accounting.goodsDemanded,
    goodsSold: accounting.goodsSold,
    serviceDemand: accounting.serviceDemand,
    serviceDelivered: accounting.serviceDelivered,
    serviceQuality: accounting.serviceQuality,
    landValue: building.landValue,
    rentDaily: building.rentDaily,
    goodsInventory: building.goodsInventory,
    cashReserve: building.cashReserve,
    connectedTrips,
  };
}

function appendHistory<T>(history: readonly T[], point: T): T[] {
  return [...history, point].slice(-MAX_HISTORY_POINTS);
}

function relocateHouseholds(
  households: DetailedHousehold[],
  people: DetailedPerson[],
  buildings: DetailedBuilding[],
  buildingById: ReadonlyMap<string, DetailedBuilding>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): void {
  if (day <= 0) return;
  const homes = buildings.filter((building) => building.function === "housing");
  const services = buildings.filter((building) =>
    ["retail", "library", "clinic", "culture", "recreation"].includes(building.function));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  let movesToday = 0;

  for (const household of households) {
    if (movesToday >= 6 || day - household.lastMovedDay < 30) continue;
    const urgent = household.rentArrears > 0 || household.money < -300;
    const evaluationDay = Math.floor(hashUnit(`${household.id}:move-day`) * 7);
    if (!urgent && day % 7 !== evaluationDay) continue;
    const current = buildingById.get(household.homeBuildingId);
    if (!current) continue;
    const members = household.memberIds
      .map((id) => peopleById.get(id))
      .filter((person): person is DetailedPerson => Boolean(person));
    const currentScore = residencePreferenceScore(household, members, current, services, buildingById);
    let preferred: DetailedBuilding | undefined;
    let preferredScore = currentScore;
    for (const candidate of homes) {
      if (candidate.id === current.id) continue;
      if (candidate.residentCapacity - candidate.residentIds.length < household.memberIds.length) continue;
      const score = residencePreferenceScore(household, members, candidate, services, buildingById);
      if (score > preferredScore) {
        preferred = candidate;
        preferredScore = score;
      }
    }
    if (!preferred || preferredScore - currentScore < (urgent ? 2 : 7)) continue;

    const oldCommute = householdCommuteDistance(members, current, buildingById);
    const newCommute = householdCommuteDistance(members, preferred, buildingById);
    current.residentIds = current.residentIds.filter((id) => !household.memberIds.includes(id));
    preferred.residentIds.push(...household.memberIds);
    household.homeBuildingId = preferred.id;
    household.lastMovedDay = day;
    household.moveReason = residenceMoveReason(current, preferred, oldCommute, newCommute);
    for (const member of members) {
      member.homeBuildingId = preferred.id;
      if (member.currentBuildingId === current.id) member.currentBuildingId = preferred.id;
    }
    movesToday += 1;
    if (recordEvents) {
      events.push(event(
        day,
        "migration",
        "info",
        `${household.id.replace("household-", "Household ")} moved from ${current.name} to ${preferred.name}: ${household.moveReason}`,
        preferred.id,
      ));
    }
  }
}

function residencePreferenceScore(
  household: Readonly<DetailedHousehold>,
  members: readonly DetailedPerson[],
  home: Readonly<DetailedBuilding>,
  services: readonly DetailedBuilding[],
  buildingById: ReadonlyMap<string, DetailedBuilding>,
): number {
  const income = Math.max(80, household.dailyIncome || sum(members.map((person) => person.dailyWage)));
  const rentBurden = home.rentDaily / income;
  const commuteDistance = householdCommuteDistance(members, home, buildingById);
  const serviceDistance = nearestBuilding(home, services);
  return 100
    - home.rentDaily * 0.35
    - rentBurden * 40
    - commuteDistance / 80
    - (serviceDistance ? distance(home, serviceDistance) / 180 : 0)
    + home.accessibility.workers * 0.08
    + home.accessibility.services * 0.12
    + home.landValue * 0.02
    + hashUnit(`${household.id}:${home.id}:home-preference`) * 4;
}

function householdCommuteDistance(
  members: readonly DetailedPerson[],
  home: Pick<DetailedBuilding, "x" | "z">,
  buildingById: ReadonlyMap<string, DetailedBuilding>,
): number {
  const distances = members
    .map((person) => person.workBuildingId ? buildingById.get(person.workBuildingId) : undefined)
    .filter((building): building is DetailedBuilding => Boolean(building))
    .map((building) => distance(home, building));
  return distances.length > 0 ? sum(distances) / distances.length : 0;
}

function residenceMoveReason(
  current: Readonly<DetailedBuilding>,
  preferred: Readonly<DetailedBuilding>,
  oldCommute: number,
  newCommute: number,
): string {
  const reasons: string[] = [];
  if (preferred.rentDaily < current.rentDaily - 1) {
    reasons.push(`daily rent is ${round(current.rentDaily - preferred.rentDaily)} lower`);
  }
  if (newCommute < oldCommute - 120) {
    reasons.push(`the average commute is ${Math.round(oldCommute - newCommute)} meters shorter`);
  }
  if (reasons.length === 0) reasons.push("it offers better access and residential value");
  return `${reasons.join(" and ")}.`;
}

function allocateLabor(
  people: DetailedPerson[],
  buildings: DetailedBuilding[],
  buildingById: Map<string, DetailedBuilding>,
  policy: Readonly<EntityPolicy>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): void {
  const eligible = people.filter((person) => person.age >= 18 && person.age < 68 && person.employment !== "student");
  const requiredWorkers = new Map(buildings.map((building) => [building.id, requiredWorkersFor(building, day)]));
  const externalJobSlots = Math.round(
    eligible.length * 0.16 * clamp(policy.externalJobCapacityScale ?? 1, 0.45, 1.4),
  );
  let externalWorkers = eligible.filter((person) => person.employment === "external").length;
  for (const person of eligible) {
    const current = person.workBuildingId ? buildingById.get(person.workBuildingId) : undefined;
    const currentHasRoom = current
      && current.closedDaysRemaining === 0
      && current.employeeIds.length < (requiredWorkers.get(current.id) ?? 0);
    const evaluationDay = Math.floor(hashUnit(`${person.id}:job-day`) * 7);
    if (person.employment === "external" && day % 7 !== evaluationDay) continue;
    if (currentHasRoom && day % 7 !== evaluationDay) {
      current.employeeIds.push(person.id);
      person.employment = "local";
      continue;
    }
    const home = buildingById.get(person.homeBuildingId);
    const vacancies = buildings.filter((building) =>
      building.closedDaysRemaining === 0
      && building.employeeIds.length < (requiredWorkers.get(building.id) ?? 0));
    const preferred = preferredJob(person, home, vacancies, current?.id);
    const currentScore = currentHasRoom ? jobPreferenceScore(person, home, current, current.id) : Number.NEGATIVE_INFINITY;
    const preferredScore = preferred ? jobPreferenceScore(person, home, preferred, current?.id) : Number.NEGATIVE_INFINITY;
    const outsideAvailable = person.employment === "external" || externalWorkers < externalJobSlots;
    const outsideWage = externalDailyWage(policy);
    const outsideCost = externalCommuteCost(policy);
    const outsideScore = outsideAvailable
      ? outsideWage - outsideCost * 1.5 + 5
      : Number.NEGATIVE_INFINITY;
    const chosen = preferred && preferredScore >= Math.max(currentScore, outsideScore) ? preferred : currentHasRoom ? current : undefined;
    if (chosen) {
      const previousWorkplaceId = person.workBuildingId;
      const wasUnemployed = person.employment === "unemployed";
      if (person.employment === "external") externalWorkers = Math.max(0, externalWorkers - 1);
      chosen.employeeIds.push(person.id);
      person.workBuildingId = chosen.id;
      person.employment = "local";
      if (recordEvents && wasUnemployed && day % 3 === 0) {
        events.push(event(day, "labor", "info", `${person.name} was hired by ${chosen.name}.`, chosen.id, person.id));
      } else if (recordEvents && previousWorkplaceId && previousWorkplaceId !== chosen.id) {
        events.push(event(day, "labor", "info", `${person.name} changed jobs for a better wage and commute at ${chosen.name}.`, chosen.id, person.id));
      }
    } else if (outsideAvailable) {
      if (person.employment !== "external") externalWorkers += 1;
      person.workBuildingId = undefined;
      person.employment = "external";
      person.dailyWage = outsideWage;
    } else {
      person.workBuildingId = undefined;
      person.employment = "unemployed";
    }
  }
}

function preferredJob(
  person: Readonly<DetailedPerson>,
  home: DetailedBuilding | undefined,
  vacancies: readonly DetailedBuilding[],
  currentWorkplaceId: string | undefined,
): DetailedBuilding | undefined {
  let preferred: DetailedBuilding | undefined;
  let preferredScore = Number.NEGATIVE_INFINITY;
  for (const vacancy of vacancies) {
    const score = jobPreferenceScore(person, home, vacancy, currentWorkplaceId);
    if (score > preferredScore) {
      preferred = vacancy;
      preferredScore = score;
    }
  }
  return preferred;
}

function jobPreferenceScore(
  person: Readonly<DetailedPerson>,
  home: DetailedBuilding | undefined,
  workplace: Readonly<DetailedBuilding>,
  currentWorkplaceId: string | undefined,
): number {
  const wage = workplace.accounting.averageWage || baseWage(workplace.function);
  const commutePenalty = home ? distance(home, workplace) / 35 : 0;
  const accessPenalty = (100 - workplace.accessibility.workers) * 0.42;
  const retentionBonus = workplace.id === currentWorkplaceId ? 9 : 0;
  return wage - commutePenalty - accessPenalty + retentionBonus
    + hashUnit(`${person.id}:${workplace.id}:job-preference`) * 6;
}

function advanceBuilding(
  building: DetailedBuilding,
  scheduledCustomers: number,
  scheduledRetailUnits: number,
  scheduledPaidServiceVisits: number,
  scheduledActiveWorkers: number,
  residentHouseholds: number,
  city: Readonly<CitySectionState>,
  policy: Readonly<EntityPolicy>,
  day: number,
  events: EntityEvent[],
  recordEvents: boolean,
): DetailedBuilding {
  const previous = building.accounting;
  let closedDaysRemaining = Math.max(0, building.closedDaysRemaining - 1);
  const closed = closedDaysRemaining > 0;
  const reopened = building.closedDaysRemaining > 0 && !closed;
  const requiredWorkers = requiredWorkersFor(building, day);
  const employees = closed ? 0 : building.employeeIds.length;
  const activeWorkers = closed ? 0 : Math.min(employees, scheduledActiveWorkers);
  const staffingRatio = requiredWorkers > 0 ? clamp(employees / requiredWorkers, 0, 1) : 1;
  const congestionRatio = clamp(city.metrics.congestionPercent / 100, 0, 1);
  const accessibility = building.accessibility;
  const civic = isCivic(building.function);
  const housing = building.function === "housing";
  const privateBusiness = !civic && !housing;
  const rentIncome = housing ? round(residentHouseholds * building.rentDaily) : 0;
  const operatingScale = closed ? 0 : dynamicOperatingScale(previous, privateBusiness);
  const plannedMaintenance = housing
    ? Math.max(maintenanceCostFor(building), rentIncome * 0.88)
    : maintenanceCostFor(building);
  const maintenanceDeferralRate = privateBusiness && (
    previous.lossStreak >= 2 || building.cashReserve < plannedMaintenance * 8
  ) ? clamp(0.1 + previous.lossStreak * 0.04, 0, 0.55) : 0;
  const maintenanceCost = round(plannedMaintenance * (1 - maintenanceDeferralRate));
  const maintenanceRecovery = previous.profit > 0
    ? Math.min(previous.maintenanceDeferred, plannedMaintenance * 0.12)
    : 0;
  const maintenanceDeferred = round(Math.max(
    0,
    previous.maintenanceDeferred + plannedMaintenance - maintenanceCost - maintenanceRecovery,
  ));
  const buildingCondition = round(clamp(
    previous.buildingCondition
      - maintenanceDeferralRate * 0.025
      + (maintenanceDeferralRate === 0 ? 0.0025 : 0),
    0.55,
    1,
  ));
  const targetMargin = privateBusiness
    ? round(clamp(0.07 + previous.lossStreak * 0.008, 0.06, 0.15))
    : housing ? 0.05 : 0;
  const deliveryReliability = clamp(
    accessibility.freight / 100 * buildingCondition - congestionRatio * 0.18,
    0.35,
    1,
  );
  const averageWage = dynamicWage(building, previous, requiredWorkers, employees, city);
  const dailyWages = round(activeWorkers * averageWage);
  const customerReach = clamp(
    (0.65 + accessibility.customers / 280) * operatingScale * buildingCondition,
    0.35,
    1.08,
  );
  const localCustomers = closed ? 0 : Math.round(
    scheduledCustomers * customerReach * (0.82 + hashUnit(`${building.id}:customers:${day}`) * 0.36),
  );
  const priorPrice = previous.unitPrice || baseUnitPrice(building.function);
  const basePrice = baseUnitPrice(building.function);
  const externalPriceResponse = basePrice > 0
    ? clamp(Math.pow(basePrice / Math.max(basePrice * 0.55, priorPrice), 1.35), 0.35, 1.35)
    : 1;
  const externalCustomers = closed || !isConsumerDestination(building.function)
    ? 0
    : Math.round(
        building.jobCapacity
          * clamp((accessibility.customers - 48) / 42, 0, 1)
          * externalPriceResponse
          * operatingScale
          * buildingCondition
          * (0.7 + hashUnit(`${building.id}:outside-customers:${Math.floor(day / 3)}`) * 0.5),
      );
  const customers = localCustomers + externalCustomers;
  const activeStaffingRatio = requiredWorkers > 0 ? clamp(activeWorkers / requiredWorkers, 0, 1) : 1;
  const laborCapacity = closed ? 0 : activeStaffingRatio * operatingScale * buildingCondition;
  const servedLocalRatio = scheduledCustomers > 0
    ? clamp(localCustomers / scheduledCustomers, 0, 1)
    : 1;
  const retailLocalDemand = scheduledRetailUnits * servedLocalRatio;
  const retailExternalDemand = externalCustomers * 4.6;
  const projectedUnits = building.function === "retail"
    ? retailLocalDemand + retailExternalDemand
    : building.function === "office" ? activeWorkers * 1.45 * operatingScale * buildingCondition
      : building.function === "industrial" ? activeWorkers * 5.3 * operatingScale * buildingCondition
        : building.function === "parking" ? (activeWorkers * 5 + 5) * operatingScale
          : building.function === "culture" || building.function === "recreation"
            ? scheduledPaidServiceVisits * servedLocalRatio + externalCustomers
            : 0;
  const requestedSupplies = building.function === "retail"
    ? clamp(Math.max(0, projectedUnits - building.goodsInventory * 0.3), 2, 85)
    : (8 + building.jobCapacity * 1.7) * operatingScale;
  const deliverableSupplies = requiresSupplies(building.function)
    ? requestedSupplies * laborCapacity * deliveryReliability
    : 0;
  const localShare = clamp(city.market.localSupplyPercent / 100, 0.18, 0.82);
  const localSupplies = round(deliverableSupplies * localShare);
  const importedCapacity = requestedSupplies * clamp(policy.externalSupplyScale ?? 1, 0.4, 1.35);
  const importedSupplies = round(Math.min(
    deliverableSupplies - localSupplies,
    importedCapacity,
  ));
  const goodsReceived = round(localSupplies + importedSupplies);
  const importedUnitCost = 6.8 * clamp(city.market.consumerPriceIndex / 100, 0.8, 1.6);
  const supplyCost = round(localSupplies * 5.2 + importedSupplies * importedUnitCost);
  const congestionMultiplier = 1 + congestionRatio * 2.2;
  const accessCostMultiplier = 1 + (100 - accessibility.freight) / 100 * 1.35;
  const transportCost = round(
    (localSupplies * (0.75 + 0.5 / Math.max(0.55, policy.roadCapacityScale))
      + importedSupplies * (2.4 + 1.8 / Math.max(0.55, policy.roadCapacityScale)))
      * congestionMultiplier
      * accessCostMultiplier,
  );
  const serviceDemand = civic ? scheduledCustomers + building.residentIds.length * 0.05 : 0;
  const serviceDelivered = civic
    ? round(serviceDemand * laborCapacity * clamp(accessibility.services / 82, 0.55, 1.05))
    : 0;
  const serviceQuality = civic && serviceDemand > 0 ? clamp(serviceDelivered / serviceDemand, 0, 1) : civic ? staffingRatio : 0;
  const projectedOperatingCost = round(dailyWages + supplyCost + transportCost + maintenanceCost);
  const unitPrice = round(dynamicPrice(
    building,
    previous,
    projectedUnits,
    projectedOperatingCost,
    targetMargin,
    city,
  ));
  let goodsSold = 0;
  let localSalesRevenue = 0;
  let externalSalesRevenue = 0;
  if (!closed && (activeStaffingRatio > 0 || building.function === "parking")) {
    if (building.function === "retail") {
      goodsSold = round(Math.min(building.goodsInventory + goodsReceived, projectedUnits));
      const fulfillment = projectedUnits > 0 ? goodsSold / projectedUnits : 0;
      localSalesRevenue = round(retailLocalDemand * fulfillment * unitPrice);
      externalSalesRevenue = round(retailExternalDemand * fulfillment * unitPrice);
    } else if (building.function === "office") {
      goodsSold = round(projectedUnits);
      externalSalesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "industrial") {
      goodsSold = round(projectedUnits);
      externalSalesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "parking") {
      goodsSold = round(projectedUnits);
      externalSalesRevenue = round(goodsSold * unitPrice);
    } else if (building.function === "culture" || building.function === "recreation") {
      const localPaidVisits = scheduledPaidServiceVisits * servedLocalRatio;
      localSalesRevenue = round(localPaidVisits * unitPrice);
      externalSalesRevenue = round(externalCustomers * unitPrice);
    }
  }
  const salesRevenue = round(localSalesRevenue + externalSalesRevenue);
  const operatingCost = projectedOperatingCost;
  const municipalFunding = civic && !closed
    ? publicOperatingGrant(
        Math.max(
          0,
          operatingCost
            + Math.max(0, requiredWorkers - employees) * averageWage * 0.12
            - salesRevenue,
        ),
        city,
      )
    : 0;
  const operatingRevenue = round(rentIncome + municipalFunding + salesRevenue);
  const profit = round(operatingRevenue - operatingCost);
  const cashReserve = round((reopened ? Math.max(3_500, maintenanceCost * 12) : building.cashReserve) + profit);
  const operatingDay = activeWorkers > 0 || requiredWorkers === 0;
  const lossStreak = privateBusiness && operatingDay
    ? profit < 0
      ? reopened ? 1 : previous.lossStreak + 1
      : Math.max(0, previous.lossStreak - 2)
    : previous.lossStreak;
  let status: BuildingAccounting["status"] = housing ? "occupied" : civic ? "funded" : "operating";
  if (closed) status = "closed";
  else if (staffingRatio < 0.7 && requiredWorkers > 0) status = "understaffed";

  if (!closed && lossStreak >= 10 && cashReserve < 0 && privateBusiness) {
    closedDaysRemaining = 14;
    status = "closed";
    if (recordEvents) events.push(event(day, "business", "warning", `${building.name} closed after sustained losses exhausted its reserves.`, building.id));
  }
  if (recordEvents && reopened && !civic && !housing) {
    events.push(event(day, "business", "info", `${building.name} reopened under a new operator after the vacant space found sufficient demand and access.`, building.id));
  }
  const workforceChange = employees - previous.requiredWorkers * previous.staffingRatio;
  if (recordEvents && workforceChange <= -2) {
    events.push(event(day, "labor", "warning", `${building.name} reduced its workforce by ${Math.abs(Math.round(workforceChange))}.`, building.id));
  }
  if (recordEvents && civic && serviceQuality < 0.65) {
    events.push(event(day, "services", "warning", `${building.name} met only ${Math.round(serviceQuality * 100)}% of scheduled service demand.`, building.id));
  }
  const targetLandValue = 235 + staffingRatio * 45
    + clamp((city.metrics.happiness - 50) / 50, 0, 1) * 65
    + accessibility.overall * 0.62
    + buildingCondition * 35
    - city.metrics.congestionPercent * 0.8;
  const landValue = round(clamp(building.landValue + (targetLandValue - building.landValue) * 0.025, 80, 520));
  const occupancy = housing ? building.residentIds.length / Math.max(1, building.residentCapacity) : 0;
  const marketRentDaily = clamp((750 + landValue * 4.5) / 30.4, 22, 110);
  const occupancyRentMultiplier = occupancy > 0.9 ? 1.06 : occupancy < 0.65 ? 0.92 : 1;
  const rentDaily = housing
    ? round(clamp(
        building.rentDaily + (marketRentDaily * occupancyRentMultiplier - building.rentDaily) * 0.018,
        22,
        110,
      ))
    : 0;
  const diagnosis = diagnoseBuilding(
    building.function,
    status,
    profit,
    staffingRatio,
    congestionRatio,
    importedSupplies,
    serviceQuality,
    accessibility.overall,
    operatingScale,
    buildingCondition,
    maintenanceDeferred,
  );

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
      activeWorkers,
      staffingRatio: round(staffingRatio),
      operatingScale,
      buildingCondition,
      maintenanceDeferred,
      targetMargin,
      averageWage,
      unitPrice,
      dailyWages,
      rentIncome,
      municipalFunding,
      salesRevenue,
      localSalesRevenue,
      externalSalesRevenue,
      operatingRevenue,
      supplyCost,
      transportCost,
      maintenanceCost,
      operatingCost,
      profit,
      customers,
      externalCustomers,
      serviceDemand: round(serviceDemand),
      serviceDelivered,
      serviceQuality: round(serviceQuality),
      goodsReceived,
      localSupplies,
      importedSupplies,
      goodsDemanded: round(projectedUnits),
      goodsSold,
      workforceChange: round(workforceChange),
      lossStreak,
      diagnosis,
    },
  };
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
  day: number,
  policy: Readonly<EntityPolicy>,
): PersonScheduleItem[] {
  const schedule: PersonScheduleItem[] = [item("home", 0, 420, home, "walk", 0)];
  const destination = person.employment === "student" ? school : work;
  const attendsDestination = destination
    ? person.employment === "student"
      ? isWeekday(day)
      : worksToday(person, destination, day)
    : false;
  if (destination && attendsDestination) {
    const mode = chooseMode(home, destination, policy);
    const travelMinutes = travelTime(home, destination, mode, policy);
    schedule.push(item(person.employment === "student" ? "school" : "work", 480, 1_020, destination, mode, travelMinutes));
  } else if (person.employment === "external" && worksExternalToday(person, day)) {
    schedule.push({ activity: "work", startMinute: 450, endMinute: 1_030, buildingId: OUTSIDE_WORK, mode: "transit", travelMinutes: externalCommuteMinutes(policy) });
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
  const daytimeLocation = attendsDestination && destination ? destination : home;
  const service = preferredService(person, daytimeLocation, candidates, day);
  if (service) {
    const mode = chooseMode(daytimeLocation, service, policy);
    schedule.push(item(
      activity,
      1_050,
      1_140,
      service,
      mode,
      travelTime(daytimeLocation, service, mode, policy),
    ));
  }
  schedule.push(item(
    "home",
    1_180,
    1_440,
    home,
    "walk",
    service ? travelTime(service, home, "walk", policy) : 0,
  ));
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

function isWeekday(day: number): boolean {
  return ((day % 7) + 7) % 7 < 5;
}

function worksToday(
  person: Pick<DetailedPerson, "id">,
  workplace: Pick<DetailedBuilding, "function">,
  day: number,
): boolean {
  if (!["retail", "clinic", "culture", "recreation", "parking"].includes(workplace.function)) {
    return isWeekday(day);
  }
  const employeeOffset = Number(person.id.replace("person-", "")) % 7;
  return ((day + employeeOffset) % 7 + 7) % 7 < 5;
}

function worksExternalToday(person: Pick<DetailedPerson, "id">, day: number): boolean {
  const employeeOffset = Number(person.id.replace("person-", "")) % 7;
  return ((day + employeeOffset) % 7 + 7) % 7 < 5;
}

function preferredService(
  person: Readonly<DetailedPerson>,
  origin: Pick<DetailedBuilding, "x" | "z">,
  candidates: readonly DetailedBuilding[],
  day: number,
): DetailedBuilding | undefined {
  let preferred: DetailedBuilding | undefined;
  let preferredScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.closedDaysRemaining > 0 || candidate.accounting.status === "closed") continue;
    const price = candidate.accounting.unitPrice || baseUnitPrice(candidate.function);
    const pricePenalty = price > 0 ? price * 0.65 : 0;
    const quality = isCivic(candidate.function)
      ? (candidate.accounting.serviceQuality || 0.72) * 24
      : candidate.accounting.staffingRatio * 10;
    const inventory = candidate.function === "retail"
      ? clamp(candidate.goodsInventory / 60, 0, 1) * 14
      : 0;
    const crowding = candidate.accounting.customers / Math.max(4, candidate.jobCapacity * 6) * 6;
    const access = isCivic(candidate.function)
      ? candidate.accessibility.services
      : candidate.accessibility.customers;
    const score = quality + inventory + access * 0.2 - pricePenalty - crowding
      - distance(origin, candidate) / 55
      + hashUnit(`${person.id}:${candidate.id}:${Math.floor(day / 7)}`) * 8;
    if (score > preferredScore) {
      preferred = candidate;
      preferredScore = score;
    }
  }
  return preferred;
}

function assignWorkplace(workplaces: DetailedBuilding[], people: readonly DetailedPerson[]): DetailedBuilding | undefined {
  const assigned = new Map<string, number>();
  for (const person of people) {
    if (person.workBuildingId) assigned.set(person.workBuildingId, (assigned.get(person.workBuildingId) ?? 0) + 1);
  }
  return workplaces
    .filter((building) => (assigned.get(building.id) ?? 0) < requiredWorkersFor(building, 0))
    .sort((a, b) =>
      (assigned.get(a.id) ?? 0) / Math.max(1, requiredWorkersFor(a, 0))
      - (assigned.get(b.id) ?? 0) / Math.max(1, requiredWorkersFor(b, 0)))[0];
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

function countScheduledDemand(people: readonly DetailedPerson[]): ScheduledDemand {
  const visits = new Map<string, number>();
  const retailUnits = new Map<string, number>();
  const paidServiceVisits = new Map<string, number>();
  const activeWorkers = new Map<string, number>();
  const add = (map: Map<string, number>, buildingId: string, amount = 1): void => {
    map.set(buildingId, (map.get(buildingId) ?? 0) + amount);
  };
  for (const person of people) {
    for (const visit of person.schedule) {
      if (["shop", "library", "healthcare", "leisure", "school"].includes(visit.activity)) {
        add(visits, visit.buildingId);
      }
      if (visit.activity === "shop") add(retailUnits, visit.buildingId, retailPurchaseUnits(person));
      if (visit.activity === "leisure") add(paidServiceVisits, visit.buildingId);
      if (visit.activity === "work" && visit.buildingId !== OUTSIDE_WORK) add(activeWorkers, visit.buildingId);
    }
  }
  return { visits, retailUnits, paidServiceVisits, activeWorkers };
}

function commuteCost(
  person: DetailedPerson,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  policy: Readonly<EntityPolicy>,
): number {
  const workTrip = person.schedule.find((item) => item.activity === "work");
  if (!workTrip) return 0;
  if (person.employment === "external") return externalCommuteCost(policy);
  const home = buildings.get(person.homeBuildingId);
  const work = person.workBuildingId ? buildings.get(person.workBuildingId) : undefined;
  if (!home || !work) return 0;
  const kilometers = distance(home, work) / 1000;
  const congestionMultiplier = 1 + clamp(policy.congestionPercent / 100, 0, 1) * 1.35;
  return round(
    kilometers < 0.8
      ? 0
      : kilometers * 3.6 * congestionMultiplier / Math.max(0.6, policy.roadCapacityScale),
  );
}

function dailyGoodsCost(
  person: Readonly<DetailedPerson>,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  demand: Readonly<ScheduledDemand>,
): number {
  const shopping = person.schedule.find((visit) => visit.activity === "shop");
  const retailer = shopping ? buildings.get(shopping.buildingId) : undefined;
  if (!shopping || !retailer) return 0;
  const totalDemand = demand.retailUnits.get(retailer.id) ?? 0;
  if (totalDemand <= 0) return 0;
  return round(
    retailer.accounting.localSalesRevenue
      * retailPurchaseUnits(person)
      / totalDemand,
  );
}

function dailyServiceCost(
  person: Readonly<DetailedPerson>,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  demand: Readonly<ScheduledDemand>,
): number {
  const paidVisit = person.schedule.find((visit) => visit.activity === "leisure");
  const provider = paidVisit ? buildings.get(paidVisit.buildingId) : undefined;
  const paidVisits = provider ? demand.paidServiceVisits.get(provider.id) ?? 0 : 0;
  return round(provider && paidVisits > 0 ? provider.accounting.localSalesRevenue / paidVisits : 0);
}

function retailPurchaseUnits(person: Pick<DetailedPerson, "needs">): number {
  return round(3.2 + person.needs.goods / 22);
}

function dynamicPrice(
  building: DetailedBuilding,
  previous: BuildingAccounting,
  projectedUnits: number,
  projectedOperatingCost: number,
  targetMargin: number,
  city: Readonly<CitySectionState>,
): number {
  const base = baseUnitPrice(building.function);
  if (base === 0) return 0;
  if (projectedUnits <= 0) return previous.unitPrice || base;
  const consumerFacing = ["retail", "culture", "recreation"].includes(building.function);
  const expectedUnits = Math.max(4, (previous.requiredWorkers || building.jobCapacity) * (
    building.function === "industrial" ? 5.3 : building.function === "office" ? 1.45 : 5
  ));
  const demandMultiplier = consumerFacing
    ? 1 + clamp((projectedUnits - expectedUnits) / expectedUnits, -0.25, 0.4)
    : 1;
  const inventoryMultiplier = building.function === "retail"
    ? building.goodsInventory < 15 ? 1.12 : building.goodsInventory > 90 ? 0.9 : 1
    : 1;
  const cpiMultiplier = clamp(city.market.consumerPriceIndex / 100, 0.8, 1.35);
  const previousMargin = previous.operatingRevenue > 0
    ? previous.profit / previous.operatingRevenue
    : targetMargin;
  const marginCorrection = clamp((targetMargin - previousMargin) * 1.15, -0.28, 0.2);
  const marketTarget = base * demandMultiplier * inventoryMultiplier * cpiMultiplier
    * (1 + marginCorrection);
  const costBackedTarget = projectedOperatingCost / projectedUnits / Math.max(0.7, 1 - targetMargin);
  const civic = isCivic(building.function);
  if (civic) return clamp(costBackedTarget, base * 0.15, base * 1.2);
  const target = Math.max(marketTarget, costBackedTarget);
  const current = previous.unitPrice || base;
  const unconstrained = current + (target - current) * 0.22;
  const dailyLimit = current * 0.045;
  return clamp(
    clamp(unconstrained, current - dailyLimit, current + dailyLimit),
    base * (civic ? 0.15 : 0.55),
    base * 3,
  );
}

function dynamicOperatingScale(
  previous: Readonly<BuildingAccounting>,
  privateBusiness: boolean,
): number {
  if (!privateBusiness) return 1;
  const target = previous.lossStreak >= 2
    ? clamp(1 - (previous.lossStreak - 1) * 0.065, 0.52, 1)
    : previous.profit >= 0 ? 1 : 0.92;
  const current = previous.operatingScale || 1;
  return round(clamp(current + clamp(target - current, -0.08, 0.06), 0.52, 1));
}

function dynamicWage(
  building: Readonly<DetailedBuilding>,
  previous: Readonly<BuildingAccounting>,
  requiredWorkers: number,
  employees: number,
  city: Readonly<CitySectionState>,
): number {
  const base = baseWage(building.function);
  const vacancyRatio = requiredWorkers > 0 ? clamp((requiredWorkers - employees) / requiredWorkers, 0, 1) : 0;
  const laborMarketPressure = clamp((8 - city.metrics.unemploymentPercent) / 100, -0.06, 0.08);
  const previousMargin = previous.operatingRevenue > 0
    ? clamp(previous.profit / previous.operatingRevenue, -0.3, 0.3)
    : 0;
  const profitAdjustment = isCivic(building.function) || building.function === "housing"
    ? 0
    : clamp(previousMargin * 0.2 - previous.lossStreak * 0.012, -0.18, 0.08);
  const target = base * (1 + vacancyRatio * 0.22 + laborMarketPressure + profitAdjustment);
  const current = previous.averageWage || base;
  return round(clamp(current + (target - current) * 0.12, Math.max(78, base * 0.7), Math.min(320, base * 1.6)));
}

function publicOperatingGrant(
  budgetedOperatingCost: number,
  city: Readonly<CitySectionState>,
): number {
  const serviceCoverage = clamp(city.metrics.civicServiceCoveragePercent / 100, 0, 1);
  const taxSignal = city.metrics.taxRevenueDaily >= city.metrics.civicOperatingCostDaily ? 0.02 : -0.03;
  const budgetSignal = city.metrics.municipalBalance >= 0 ? 0.02 : -0.06;
  const fundingRate = clamp(0.84 + serviceCoverage * 0.12 + taxSignal + budgetSignal, 0.78, 1.04);
  return round(budgetedOperatingCost * fundingRate);
}

function baseUnitPrice(buildingFunction: BuildingFunction): number {
  return buildingFunction === "retail" ? 22
    : buildingFunction === "industrial" ? 40
      : buildingFunction === "office" ? 160
        : buildingFunction === "parking" ? 18
          : buildingFunction === "culture" || buildingFunction === "recreation" ? 12
            : 0;
}

function requiredWorkersFor(
  building: Pick<DetailedBuilding, "id" | "jobCapacity"> & Partial<Pick<DetailedBuilding, "function" | "accounting">>,
  day: number,
): number {
  const baseRequirement = Math.max(0, Math.round(
    building.jobCapacity * (0.68 + hashUnit(`${building.id}:${Math.floor(day / 14)}`) * 0.25),
  ));
  if (building.function === "retail" && day === 0) return Math.min(baseRequirement, 2);
  if (!building.accounting || !building.function || isCivic(building.function) || building.function === "housing") {
    return baseRequirement;
  }
  const scaledRequirement = Math.max(1, Math.round(
    baseRequirement * (building.accounting.operatingScale || 1),
  ));
  const demandRequirement = building.function === "retail"
    ? clamp(Math.ceil(building.accounting.customers / 12) + 1, 1, scaledRequirement)
    : scaledRequirement;
  return Math.max(1, demandRequirement - Math.floor(building.accounting.lossStreak / 3));
}

function diagnoseBuilding(
  buildingFunction: BuildingFunction,
  status: BuildingAccounting["status"],
  profit: number,
  staffing: number,
  congestionRatio: number,
  imports: number,
  serviceQuality: number,
  accessibility: number,
  operatingScale: number,
  buildingCondition: number,
  maintenanceDeferred: number,
): string {
  if (status === "closed") return "Operations are suspended after sustained losses; employees and customers are being redirected.";
  if (staffing < 0.7) return `Only ${Math.round(staffing * 100)}% of required positions are filled, limiting output and service capacity.`;
  if (accessibility < 48) return `Limited access is reducing the available workforce, customer catchment, and delivery reliability.`;
  if (congestionRatio > 0.65 && imports > 0) {
    return `Network congestion is delaying deliveries and raising transport costs by about ${Math.round(congestionRatio * 150)}%.`;
  }
  if (maintenanceDeferred > 0 && buildingCondition < 0.9) {
    return `Losses forced maintenance deferrals; condition has fallen to ${Math.round(buildingCondition * 100)}%, reducing demand and productive capacity.`;
  }
  if (operatingScale < 0.9 && !isCivic(buildingFunction) && buildingFunction !== "housing") {
    return `The business reduced hours and output to ${Math.round(operatingScale * 100)}% while it restores a sustainable margin.`;
  }
  if (isCivic(buildingFunction)) {
    return serviceQuality >= 0.9
      ? "Municipal funding and staffing are meeting most scheduled service visits."
      : `Funding covers operations, but only ${Math.round(serviceQuality * 100)}% of service demand is being met.`;
  }
  if (buildingFunction === "housing") return profit >= 0
    ? "Rent receipts cover maintenance costs; occupancy is supporting stable rent."
    : "Maintenance costs exceed current rent receipts.";
  if (profit < 0 && imports > 0) return "Imported supplies, transport costs, and payroll exceed current sales revenue.";
  return profit >= 0
    ? "Sales and service revenue cover payroll, supplies, transport, and maintenance."
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

function chooseMode(
  from: Pick<DetailedBuilding, "x" | "z">,
  to: Pick<DetailedBuilding, "x" | "z">,
  policy: Readonly<EntityPolicy>,
): TravelMode {
  const meters = distance(from, to);
  const congestionRatio = clamp(policy.congestionPercent / 100, 0, 1);
  const transitRange = (1_250 + congestionRatio * 1_050)
    * clamp(policy.transitServiceScale, 0.6, 1.6);
  return meters < 650 ? "walk" : meters < transitRange ? "transit" : "car";
}

function travelTime(
  from: Pick<DetailedBuilding, "x" | "z">,
  to: Pick<DetailedBuilding, "x" | "z"> & Partial<Pick<DetailedBuilding, "accessibility">>,
  mode: TravelMode,
  policy: Readonly<EntityPolicy>,
): number {
  const speed = mode === "walk" ? 78 : mode === "transit" ? 280 : 420;
  const baseMinutes = distance(from, to) / speed
    + (mode === "transit" ? 6 / Math.max(0.6, policy.transitServiceScale) : 1);
  const congestionRatio = clamp(policy.congestionPercent / 100, 0, 1);
  const destinationPenalty = (100 - (to.accessibility?.overall ?? 75)) / 100;
  const delayMultiplier = mode === "walk"
    ? 1
    : mode === "transit"
      ? 1 + congestionRatio * 0.35 + destinationPenalty * 0.18
      : 1 + congestionRatio * 1.4 + destinationPenalty * 0.42;
  return Math.max(2, Math.round(baseMinutes * delayMultiplier));
}

function jobCapacityFor(buildingFunction: BuildingFunction, floorArea: number, source: "block" | "landmark"): number {
  if (buildingFunction === "housing") return 0;
  if (buildingFunction === "parking") return 1;
  const divisor = buildingFunction === "retail" ? 6_000
    : buildingFunction === "office" ? 5_000
      : buildingFunction === "culture" || buildingFunction === "recreation" ? 7_000
        : 6_000;
  const maximum = source === "landmark"
    ? buildingFunction === "university" || buildingFunction === "clinic" ? 12 : 10
    : buildingFunction === "retail" ? 5 : buildingFunction === "office" ? 7 : 6;
  return clamp(Math.round(floorArea / divisor), source === "landmark" ? 4 : 2, maximum);
}

function baseWage(buildingFunction: BuildingFunction): number {
  if (buildingFunction === "clinic") return 238;
  if (buildingFunction === "university" || buildingFunction === "office") return 205;
  if (buildingFunction === "school" || buildingFunction === "library") return 176;
  if (buildingFunction === "industrial") return 168;
  return 142;
}

function maintenanceCostFor(building: Readonly<DetailedBuilding>): number {
  if (building.function === "housing") {
    return round(building.residentCapacity / 2.4 * building.rentDaily * 0.68);
  }
  const base = building.function === "industrial" ? 32
    : building.function === "parking" ? 14
      : isCivic(building.function) ? 26
        : 20;
  const laborScale = building.jobCapacity * (building.function === "industrial" ? 10 : isCivic(building.function) ? 9 : 8);
  const footprintScale = Math.min(80, Math.sqrt(building.width * building.depth) * 0.4);
  const floorScale = Math.min(50, building.floors * 2);
  return round(base + laborScale + footprintScale + floorScale);
}

function requiresSupplies(buildingFunction: BuildingFunction): boolean {
  return ["retail", "office", "university", "library", "school", "clinic", "culture", "industrial"].includes(buildingFunction);
}

function isConsumerDestination(buildingFunction: BuildingFunction): boolean {
  return ["retail", "culture", "recreation", "parking"].includes(buildingFunction);
}

function isCivic(buildingFunction: BuildingFunction): boolean {
  return ["university", "library", "school", "clinic", "culture", "recreation"].includes(buildingFunction);
}

function emptyAccounting(requiredWorkers: number): BuildingAccounting {
  return {
    status: requiredWorkers > 0 ? "understaffed" : "occupied",
    requiredWorkers,
    activeWorkers: 0,
    staffingRatio: 0,
    operatingScale: 1,
    buildingCondition: 1,
    maintenanceDeferred: 0,
    targetMargin: 0,
    averageWage: 0,
    unitPrice: 0,
    dailyWages: 0,
    rentIncome: 0,
    municipalFunding: 0,
    salesRevenue: 0,
    localSalesRevenue: 0,
    externalSalesRevenue: 0,
    operatingRevenue: 0,
    supplyCost: 0,
    transportCost: 0,
    maintenanceCost: 0,
    operatingCost: 0,
    profit: 0,
    customers: 0,
    externalCustomers: 0,
    serviceDemand: 0,
    serviceDelivered: 0,
    serviceQuality: 0,
    goodsReceived: 0,
    localSupplies: 0,
    importedSupplies: 0,
    goodsDemanded: 0,
    goodsSold: 0,
    workforceChange: 0,
    lossStreak: 0,
    diagnosis: "The first operating day has not been calculated yet.",
  };
}

function emptyExpenses() {
  return { housing: 0, goods: 0, transport: 0, services: 0, total: 0 };
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
  return {
    roadCapacityScale: 1,
    transitServiceScale: 1,
    zoningStrictness: 1,
    congestionPercent: 0,
    externalJobCapacityScale: 1,
    externalSupplyScale: 1,
  };
}

function defaultAccessibility(): BuildingAccessibility {
  return {
    overall: 76,
    workers: 76,
    customers: 76,
    freight: 72,
    services: 78,
    averageTravelMinutes: 8,
    congestionPenalty: 0,
    transitBonus: 6,
  };
}

function externalDailyWage(policy: Readonly<EntityPolicy>): number {
  const capacity = clamp(policy.externalJobCapacityScale ?? 1, 0.45, 1.4);
  return round(172 + capacity * 18 - policy.congestionPercent * 0.08);
}

function externalCommuteCost(policy: Readonly<EntityPolicy>): number {
  const congestion = clamp(policy.congestionPercent / 100, 0, 1);
  return round(
    8
      + 12 / Math.max(0.6, policy.transitServiceScale)
      + congestion * 7,
  );
}

function externalCommuteMinutes(policy: Readonly<EntityPolicy>): number {
  const congestion = clamp(policy.congestionPercent / 100, 0, 1);
  return Math.round(
    24
      + 10 / Math.max(0.6, policy.transitServiceScale)
      + congestion * 18,
  );
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
