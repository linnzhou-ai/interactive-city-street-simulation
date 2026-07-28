import type {
  ActivityType,
  AgeGroup,
  Building,
  Household,
  IncomeBand,
  Person,
  ResidentNeed,
  ResidentNeeds,
  ScheduledActivity,
  TravelMode,
  TripRequest,
} from "../models/types";
import { OUTSIDE_COMMUTER_BUILDING_ID } from "./network";

export interface PopulationState {
  households: Household[];
  people: Person[];
  buildings: Building[];
}

export interface MobilityConditions {
  busAvailable: boolean;
  parkingPressure: number;
  congestion: number;
  startYear?: number;
}

export interface ModeChoiceExplanation {
  mode: TravelMode;
  reason: string;
  costs: Record<"walk" | "car" | "bus", number>;
}

export interface PopulationUpdate {
  people: Person[];
  tripRequests: TripRequest[];
}

const HOUSEHOLD_ARCHETYPES: ReadonlyArray<{
  ages: readonly number[];
  incomeBand: IncomeBand;
}> = [
  { ages: [37, 35, 9], incomeBand: "middle" },
  { ages: [72], incomeBand: "low" },
  { ages: [45, 42, 15, 11], incomeBand: "high" },
  { ages: [30, 6], incomeBand: "low" },
  { ages: [68, 65], incomeBand: "middle" },
  { ages: [28], incomeBand: "high" },
];

const STARTING_MONEY: Record<IncomeBand, number> = {
  low: 180,
  middle: 420,
  high: 900,
};

const FIRST_NAMES = [
  "Avery", "Jordan", "Maya", "Theo", "Sofia", "Miles", "Nora", "Eli", "Zoe",
  "Amara", "Caleb", "Leah", "Noah", "Priya", "Mateo", "Iris", "Owen", "Layla",
];
const LAST_NAMES = [
  "Chen", "Patel", "Rivera", "Kim", "Johnson", "Nguyen", "Martinez", "Singh",
  "Brown", "Garcia", "Wilson", "Davis", "Clark", "Lopez", "Hall", "Young",
];

const NEED_GROWTH: Record<ResidentNeed, number> = {
  education: 0.03,
  goods: 0.2,
  health: 0.07,
  community: 0.12,
  recreation: 0.15,
};

const NEED_RELIEF: Record<ResidentNeed, number> = {
  education: 0.85,
  goods: 0.75,
  health: 0.9,
  community: 0.8,
  recreation: 0.75,
};

export function createPopulation(inputBuildings: readonly Building[], startYear = 2026): PopulationState {
  const buildings = inputBuildings.map(cloneBuilding);
  const homes = buildings
    .filter((building) => building.zone === "residential" && building.residentCapacity > 0)
    .sort(compareIds);
  const households: Household[] = [];
  const people: Person[] = [];
  let archetypeIndex = 0;

  for (const home of homes) {
    while (home.residentIds.length < home.residentCapacity) {
      const archetype = HOUSEHOLD_ARCHETYPES[archetypeIndex % HOUSEHOLD_ARCHETYPES.length]!;
      const remainingCapacity = home.residentCapacity - home.residentIds.length;
      const ages = archetype.ages.slice(0, remainingCapacity);
      const householdId = `household-${households.length + 1}`;
      const memberIds: string[] = [];

      for (const age of ages) {
        const personId = `person-${people.length + 1}`;
        memberIds.push(personId);
        home.residentIds.push(personId);
        people.push(createPerson(personId, householdId, home.id, age, archetype.incomeBand));
      }

      const consumptionNeed = ages.length * 1.25;
      households.push({
        id: householdId,
        memberIds,
        homeBuildingId: home.id,
        incomeBand: archetype.incomeBand,
        familySize: ages.length,
        money: STARTING_MONEY[archetype.incomeBand] * ages.length,
        goods: consumptionNeed,
        consumptionNeed,
        rentPerDay: home.rent,
        rentArrears: 0,
        unaffordableDays: 0,
        happiness: 72,
        dailyExpenses: emptyExpenseLedger(),
      });
      archetypeIndex += 1;
    }
  }

  assignDestinations(people, buildings, startYear);
  return { households, people, buildings };
}

export function advancePopulation(
  inputPeople: readonly Person[],
  cityMinute: number,
  inputBuildings: readonly Building[],
  conditions: MobilityConditions,
): PopulationUpdate {
  const buildingsById = new Map(inputBuildings.map((building) => [building.id, building]));
  const minuteOfDay = normalizeMinute(cityMinute);
  const day = Math.floor(Math.max(0, cityMinute) / 1440);
  const requests = new Map<string, TripRequest>();
  const people = inputPeople.map((inputPerson) => {
    const person = clonePerson(inputPerson);
    const home = buildingsById.get(person.homeBuildingId);
    if (home !== undefined && person.scheduleDay !== day) {
      accrueNeeds(person, Math.max(0, day - person.scheduleDay));
      person.schedule = createSchedule(person, home, inputBuildings, day, conditions.startYear ?? 2026);
      person.scheduleDay = day;
    }
    const activity = person.schedule.find(
      (entry) => minuteOfDay >= entry.startMinute && minuteOfDay < entry.endMinute,
    );

    if (
      activity === undefined ||
      (activity.activity === person.currentActivity && activity.buildingId === person.currentBuildingId)
    ) {
      updateNeedHappiness(person);
      return person;
    }

    const origin = resolveTravelLocation(person.currentBuildingId, buildingsById);
    const destination = resolveTravelLocation(activity.buildingId, buildingsById);
    if (origin !== undefined && destination !== undefined && origin.id !== destination.id) {
      const id = `trip-${person.id}-${day}-${activity.activity}-${destination.id}`;
      requests.set(id, {
        id,
        personId: person.id,
        travelerAgeGroup: person.ageGroup,
        originBuildingId: origin.id,
        destinationBuildingId: destination.id,
        mode: chooseMode(person, origin, destination, conditions),
        purpose: activity.activity,
        createdMinute: Math.floor(cityMinute),
        cargoUnits: 0,
      });
    }

    person.currentActivity = activity.activity;
    person.currentBuildingId = activity.buildingId;
    person.destinationBuildingId = undefined;
    if (activity.need !== undefined) satisfyNeed(person, activity.need);
    updateNeedHappiness(person);
    return person;
  });

  return { people, tripRequests: [...requests.values()] };
}

function createPerson(
  id: string,
  householdId: string,
  homeBuildingId: string,
  age: number,
  incomeBand: IncomeBand,
): Person {
  const ageGroup = getAgeGroup(age);
  const needs = initialNeeds(id, ageGroup);
  return {
    id,
    name: personName(id),
    householdId,
    age,
    ageGroup,
    incomeBand,
    homeBuildingId,
    currentActivity: "home",
    currentBuildingId: homeBuildingId,
    preferredMode: preferredMode(ageGroup, incomeBand),
    schedule: [],
    scheduleDay: 0,
    needs,
    employmentStatus: ageGroup === "adult" ? "unemployed" : "not-in-labor-force",
    dailyWage: 0,
    commuteCostDaily: 0,
    commuteDistanceKm: 0,
    commuteMinutesOneWay: 0,
    unemployedDays: 0,
    happiness: needHappinessScore(needs),
    money: STARTING_MONEY[incomeBand],
    tripsCompleted: 0,
  };
}

function emptyExpenseLedger(): Household["dailyExpenses"] {
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

function personName(id: string): string {
  const index = Math.max(0, Number.parseInt(id.replace("person-", ""), 10) - 1);
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

function assignDestinations(people: Person[], buildings: Building[], startYear: number): void {
  const jobBuildings = buildings
    .filter(
      (building) =>
        building.jobCapacity > 0 &&
        (building.zone === "commercial" ||
          building.zone === "industrial" ||
          building.zone === "civic"),
    )
    .sort(compareIds);
  const schools = buildings.filter((building) => building.buildingUse === "school").sort(compareIds);
  const jobCounts = new Map(jobBuildings.map((building) => [building.id, 0]));
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));

  for (const person of people) {
    const home = buildingsById.get(person.homeBuildingId)!;
    if (person.ageGroup === "child") {
      person.schoolBuildingId = nearestBuilding(home, schools)?.id;
    } else if (person.ageGroup === "adult") {
      const workplace = nearestBuilding(
        home,
        jobBuildings.filter(
          (building) => (jobCounts.get(building.id) ?? 0) < building.jobCapacity,
        ),
      );
      if (workplace !== undefined) {
        person.workBuildingId = workplace.id;
        person.employmentStatus = "local";
        workplace.employeeIds.push(person.id);
        jobCounts.set(workplace.id, (jobCounts.get(workplace.id) ?? 0) + 1);
      }
    }
    person.schedule = createSchedule(person, home, buildings, 0, startYear);
  }
}

function createSchedule(
  person: Person,
  home: Building,
  buildings: readonly Building[],
  day: number,
  startYear: number,
): ScheduledActivity[] {
  const shop = nearestBuilding(
    home,
    buildings.filter((building) => building.buildingUse === "retail"),
  );
  const library = nearestBuilding(home, buildings.filter((building) => building.buildingUse === "library"));
  const clinic = nearestBuilding(home, buildings.filter((building) => building.buildingUse === "clinic"));
  const park = nearestBuilding(home, buildings.filter((building) => building.buildingUse === "park"));
  const weekday = isWeekday(day, startYear);
  const needs = selectNeedActivities(person, day, !weekday, { shop, library, clinic, park });

  if (person.ageGroup === "child" && weekday) {
    return appendNeedActivities([
      scheduled("home", 0, 450, home.id),
      scheduled("school", 450, 900, person.schoolBuildingId ?? home.id, "education"),
    ], needs, 900, 1, home.id);
  }

  if (person.ageGroup === "senior") {
    return appendNeedActivities([
      scheduled("home", 0, 600, home.id),
    ], needs, 600, weekday ? 2 : 3, home.id);
  }

  if (person.ageGroup === "adult" && weekday && person.workBuildingId !== undefined) {
    return appendNeedActivities([
      scheduled("home", 0, 480, home.id),
      scheduled("work", 480, 990, person.workBuildingId),
    ], needs, 990, 2, home.id);
  }

  return appendNeedActivities([
    scheduled("home", 0, 600, home.id),
  ], needs, 600, 3, home.id);
}

interface NeedDestinations {
  shop?: Building;
  library?: Building;
  clinic?: Building;
  park?: Building;
}

interface NeedActivity {
  activity: ActivityType;
  need: ResidentNeed;
  buildingId: string;
  score: number;
}

function selectNeedActivities(
  person: Person,
  day: number,
  weekend: boolean,
  destinations: NeedDestinations,
): NeedActivity[] {
  const index = personNumber(person);
  const candidates: Array<NeedActivity | undefined> = [
    destinations.shop === undefined ? undefined : {
      activity: "shopping",
      need: "goods",
      buildingId: destinations.shop.id,
      score: person.needs.goods + (isDue(index, day, 3) ? 0.8 : 0),
    },
    destinations.library === undefined ? undefined : {
      activity: "library",
      need: "community",
      buildingId: destinations.library.id,
      score: person.needs.community + (isDue(index, day, 4) ? 0.9 : 0),
    },
    destinations.clinic === undefined ? undefined : {
      activity: "healthcare",
      need: "health",
      buildingId: destinations.clinic.id,
      score: person.needs.health + (
        person.ageGroup === "senior" && isDue(index, day, 5)
          ? 1
          : isDue(index, day, 14) ? 0.75 : 0
      ),
    },
    destinations.park === undefined ? undefined : {
      activity: "leisure",
      need: "recreation",
      buildingId: destinations.park.id,
      score: person.needs.recreation + (weekend || isDue(index, day, 3) ? 0.65 : 0),
    },
  ];
  return candidates
    .filter((candidate): candidate is NeedActivity => candidate !== undefined)
    .sort((left, right) => right.score - left.score || left.activity.localeCompare(right.activity));
}

function isWeekday(day: number, startYear: number): boolean {
  const sundayBasedDay = new Date(Date.UTC(startYear, 0, day + 1)).getUTCDay();
  return sundayBasedDay !== 0 && sundayBasedDay !== 6;
}

function appendNeedActivities(
  schedule: ScheduledActivity[],
  activities: readonly NeedActivity[],
  startMinute: number,
  maximum: number,
  homeBuildingId: string,
): ScheduledActivity[] {
  let nextStart = startMinute;
  for (const activity of activities.slice(0, maximum)) {
    schedule.push(scheduled(activity.activity, nextStart, nextStart + 90, activity.buildingId, activity.need));
    nextStart += 90;
  }
  schedule.push(scheduled("home", nextStart, 1440, homeBuildingId));
  return compactSchedule(schedule);
}

function initialNeeds(id: string, ageGroup: AgeGroup): ResidentNeeds {
  const variation = (personNumberFromId(id) % 5) * 0.04;
  return {
    education: ageGroup === "child" ? 0.82 : 0.08,
    goods: 0.42 + variation,
    health: ageGroup === "senior" ? 0.62 : ageGroup === "child" ? 0.28 : 0.22,
    community: 0.34 + variation,
    recreation: 0.4 + variation,
  };
}

function accrueNeeds(person: Person, elapsedDays: number): void {
  for (const need of Object.keys(person.needs) as ResidentNeed[]) {
    const ageGrowth = need === "education" && person.ageGroup === "child"
      ? 0.3
      : need === "health" && person.ageGroup === "senior"
        ? 0.12
        : NEED_GROWTH[need];
    person.needs[need] = clamp(person.needs[need] + ageGrowth * elapsedDays, 0, 1);
  }
}

function satisfyNeed(person: Person, need: ResidentNeed): void {
  person.needs[need] = clamp(person.needs[need] - NEED_RELIEF[need], 0, 1);
}

function updateNeedHappiness(person: Person): void {
  person.happiness = needHappinessScore(person.needs);
}

export function needHappinessScore(needs: Readonly<ResidentNeeds>): number {
  const unmet = Object.values(needs).reduce((total, value) => total + value, 0) / 5;
  return Math.round(clamp(100 - unmet * 50, 0, 100) * 10) / 10;
}

function isDue(personIndex: number, day: number, cadence: number): boolean {
  return (personIndex + day) % cadence === 0;
}

function personNumber(person: Person): number {
  return personNumberFromId(person.id);
}

function personNumberFromId(id: string): number {
  return Math.max(1, Number.parseInt(id.replace("person-", ""), 10) || 1);
}

function chooseMode(
  person: Person,
  origin: TravelLocation,
  destination: TravelLocation,
  conditions: MobilityConditions,
): TravelMode {
  return explainModeChoice(person, origin, destination, conditions).mode;
}

export function explainModeChoice(
  person: Person,
  origin: TravelLocation,
  destination: TravelLocation,
  conditions: MobilityConditions,
): ModeChoiceExplanation {
  const distance = Math.max(0.25, Math.hypot(destination.x - origin.x, destination.z - origin.z));
  const crossesBoundary = origin.id === OUTSIDE_COMMUTER_BUILDING_ID
    || destination.id === OUTSIDE_COMMUTER_BUILDING_ID;
  const congestion = clamp(conditions.congestion, 0, 1);
  const parking = clamp(conditions.parkingPressure, 0, 1);
  const walkAgeCost = person.ageGroup === "senior" ? distance * 1.4 : 0;
  const carEligibilityCost = person.ageGroup === "child" ? 1000 : person.ageGroup === "senior" ? 4 : 0;
  const incomeCarCost = person.incomeBand === "low" ? 6 : person.incomeBand === "high" ? -2 : 0;
  const incomeBusCost = person.incomeBand === "low" ? -2 : person.incomeBand === "high" ? 2 : 0;
  const costs: Array<["walk" | "car" | "bus", number]> = [
    ["walk", crossesBoundary ? Number.POSITIVE_INFINITY : distance * 3 + walkAgeCost],
    ["car", distance * (1 + congestion * 2) + parking * 8 + carEligibilityCost + incomeCarCost],
    [
      "bus",
      conditions.busAvailable && !crossesBoundary
        ? distance * (1.3 + congestion * 0.2) + 5 + incomeBusCost - (person.ageGroup === "senior" ? 1 : 0)
        : Number.POSITIVE_INFINITY,
    ],
  ];
  const ranked = costs.sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  const mode = ranked[0]![0];
  const reason = crossesBoundary
    ? "This job is outside the modeled section, so the commute uses the regional road gateway."
    : mode === "walk"
    ? "Walking has the lowest distance and access cost."
    : mode === "bus"
      ? person.ageGroup === "senior" || person.incomeBand === "low"
        ? "Transit access and household cost make the bus the lowest-cost option."
        : "Congestion and parking make transit cheaper than driving."
      : conditions.congestion > 0.65 || conditions.parkingPressure > 0.65
        ? "Driving remains fastest despite congestion and parking pressure."
        : "Driving has the lowest combined travel and access cost.";
  return {
    mode,
    reason,
    costs: Object.fromEntries(costs) as ModeChoiceExplanation["costs"],
  };
}

function scheduled(
  activity: ActivityType,
  startMinute: number,
  endMinute: number,
  buildingId: string,
  need?: ResidentNeed,
): ScheduledActivity {
  return { activity, startMinute, endMinute, buildingId, need };
}

function compactSchedule(schedule: ScheduledActivity[]): ScheduledActivity[] {
  const compacted: ScheduledActivity[] = [];
  for (const entry of schedule) {
    const previous = compacted.at(-1);
    if (previous?.activity === entry.activity && previous.buildingId === entry.buildingId) {
      previous.endMinute = entry.endMinute;
    } else {
      compacted.push(entry);
    }
  }
  return compacted;
}

function getAgeGroup(age: number): AgeGroup {
  if (age < 18) return "child";
  if (age >= 65) return "senior";
  return "adult";
}

function preferredMode(ageGroup: AgeGroup, incomeBand: IncomeBand): TravelMode {
  if (ageGroup === "child") return "walk";
  if (ageGroup === "senior" || incomeBand === "low") return "bus";
  return "car";
}

function nearestBuilding(origin: Building, candidates: readonly Building[]): Building | undefined {
  return [...candidates].sort((left, right) => {
    const leftDistance = Math.hypot(left.x - origin.x, left.z - origin.z);
    const rightDistance = Math.hypot(right.x - origin.x, right.z - origin.z);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
}

type TravelLocation = Pick<Building, "id" | "x" | "z">;

function resolveTravelLocation(
  id: string,
  buildings: ReadonlyMap<string, Building>,
): TravelLocation | undefined {
  const building = buildings.get(id);
  if (building !== undefined) return building;
  return id === OUTSIDE_COMMUTER_BUILDING_ID
    ? { id, x: 85, z: -4 }
    : undefined;
}

function normalizeMinute(cityMinute: number): number {
  const wholeMinute = Math.floor(cityMinute);
  return ((wholeMinute % 1440) + 1440) % 1440;
}

function cloneBuilding(building: Building): Building {
  return {
    ...building,
    residentIds: [],
    employeeIds: [],
    utilityDemand: { ...building.utilityDemand },
    utilityService: { ...building.utilityService },
  };
}

function clonePerson(person: Person): Person {
  return {
    ...person,
    needs: { ...person.needs },
    schedule: person.schedule.map((entry) => ({ ...entry })),
  };
}

function compareIds(left: Building, right: Building): number {
  return left.id.localeCompare(right.id);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
