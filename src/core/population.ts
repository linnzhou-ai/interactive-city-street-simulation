import type {
  ActivityType,
  AgeGroup,
  Building,
  Household,
  IncomeBand,
  Person,
  ScheduledActivity,
  TravelMode,
  TripRequest,
} from "../models/types";

export interface PopulationState {
  households: Household[];
  people: Person[];
  buildings: Building[];
}

export interface MobilityConditions {
  busAvailable: boolean;
  parkingPressure: number;
  congestion: number;
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

export function createPopulation(inputBuildings: readonly Building[]): PopulationState {
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
        happiness: 72,
      });
      archetypeIndex += 1;
    }
  }

  assignDestinations(people, buildings);
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
    const activity = person.schedule.find(
      (entry) => minuteOfDay >= entry.startMinute && minuteOfDay < entry.endMinute,
    );

    if (
      activity === undefined ||
      (activity.activity === person.currentActivity && activity.buildingId === person.currentBuildingId)
    ) {
      return person;
    }

    const origin = buildingsById.get(person.currentBuildingId);
    const destination = buildingsById.get(activity.buildingId);
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
    happiness: 72,
    money: STARTING_MONEY[incomeBand],
    tripsCompleted: 0,
  };
}

function personName(id: string): string {
  const index = Math.max(0, Number.parseInt(id.replace("person-", ""), 10) - 1);
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

function assignDestinations(people: Person[], buildings: Building[]): void {
  const jobBuildings = buildings
    .filter(
      (building) =>
        building.jobCapacity > 0 &&
        (building.zone === "commercial" ||
          building.zone === "industrial" ||
          building.zone === "civic"),
    )
    .sort(compareIds);
  const schools = buildings.filter((building) => building.zone === "civic").sort(compareIds);
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
        workplace.employeeIds.push(person.id);
        jobCounts.set(workplace.id, (jobCounts.get(workplace.id) ?? 0) + 1);
      }
    }
    person.schedule = createSchedule(person, home, buildings);
  }
}

function createSchedule(person: Person, home: Building, buildings: readonly Building[]): ScheduledActivity[] {
  const shop = nearestBuilding(
    home,
    buildings.filter((building) => building.zone === "commercial"),
  );
  const leisure = nearestBuilding(
    home,
    buildings.filter((building) => building.zone === "park" || building.zone === "civic"),
  );

  if (person.ageGroup === "child") {
    return compactSchedule([
      scheduled("home", 0, 450, home.id),
      scheduled("school", 450, 900, person.schoolBuildingId ?? home.id),
      scheduled("leisure", 900, 1020, leisure?.id ?? home.id),
      scheduled("home", 1020, 1440, home.id),
    ]);
  }

  if (person.ageGroup === "senior") {
    return compactSchedule([
      scheduled("home", 0, 600, home.id),
      scheduled("shopping", 600, 690, shop?.id ?? home.id),
      scheduled("leisure", 690, 900, leisure?.id ?? home.id),
      scheduled("home", 900, 1440, home.id),
    ]);
  }

  return compactSchedule([
    scheduled("home", 0, 480, home.id),
    scheduled(person.workBuildingId === undefined ? "leisure" : "work", 480, 1020, person.workBuildingId ?? leisure?.id ?? home.id),
    scheduled("shopping", 1020, 1110, shop?.id ?? home.id),
    scheduled("home", 1110, 1440, home.id),
  ]);
}

function chooseMode(
  person: Person,
  origin: Building,
  destination: Building,
  conditions: MobilityConditions,
): TravelMode {
  const distance = Math.max(0.25, Math.hypot(destination.x - origin.x, destination.z - origin.z));
  const congestion = clamp(conditions.congestion, 0, 1);
  const parking = clamp(conditions.parkingPressure, 0, 1);
  const walkAgeCost = person.ageGroup === "senior" ? distance * 1.4 : 0;
  const carEligibilityCost = person.ageGroup === "child" ? 1000 : person.ageGroup === "senior" ? 4 : 0;
  const incomeCarCost = person.incomeBand === "low" ? 6 : person.incomeBand === "high" ? -2 : 0;
  const incomeBusCost = person.incomeBand === "low" ? -2 : person.incomeBand === "high" ? 2 : 0;
  const costs: Array<[TravelMode, number]> = [
    ["walk", distance * 3 + walkAgeCost],
    ["car", distance * (1 + congestion * 2) + parking * 8 + carEligibilityCost + incomeCarCost],
    [
      "bus",
      conditions.busAvailable
        ? distance * (1.3 + congestion * 0.2) + 5 + incomeBusCost - (person.ageGroup === "senior" ? 1 : 0)
        : Number.POSITIVE_INFINITY,
    ],
  ];

  return costs.sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))[0]![0];
}

function scheduled(
  activity: ActivityType,
  startMinute: number,
  endMinute: number,
  buildingId: string,
): ScheduledActivity {
  return { activity, startMinute, endMinute, buildingId };
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
  return { ...person, schedule: person.schedule.map((entry) => ({ ...entry })) };
}

function compareIds(left: Building, right: Building): number {
  return left.id.localeCompare(right.id);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
