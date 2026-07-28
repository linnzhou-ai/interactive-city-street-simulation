import type {
  CityDistrictState,
  CitySectionState,
  GoodType,
} from "../models/cityTypes";
import type {
  Building,
  BuildingAccounting,
  BuildingConnection,
  Household,
  HouseholdExpenseLedger,
  NetworkEdge,
  Person,
  ResidentNeed,
  TravelMode,
  Vehicle,
} from "../models/types";
import { BASE_GOODS_PRICES, GOODS } from "./cityEconomy";
import { needHappinessScore } from "./population";

export interface InsightContribution {
  key: string;
  label: string;
  value: number;
  explanation: string;
}

export interface RepresentationSummary {
  citywideResidents: number;
  representativePeople: number;
  residentsPerVisiblePerson: number | null;
  detailedBuildings: number;
  aggregateDistricts: number;
  peopleLabel: string;
  citywideLabel: string;
}

export interface MigrationBreakdown {
  annualNetMigration: number;
  contributions: InsightContribution[];
}

export type TripCategory = "commute" | "shopping" | "freight" | "pedestrian" | "transit";

export interface TripShareRow {
  category: TripCategory;
  label: string;
  tripsDaily: number;
  sharePercent: number;
  contributesToRoadCongestion: boolean;
}

export interface CongestionTripBreakdown {
  totalTripsDaily: number;
  roadTripsDaily: number;
  rows: TripShareRow[];
}

export interface PriceBreakdown {
  good: GoodType;
  basePrice: number;
  currentPrice: number;
  targetPrice: number;
  demandDaily: number;
  localSupplyDaily: number;
  importsDaily: number;
  unmetDemandDaily: number;
  transportCostDaily: number;
  contributions: InsightContribution[];
}

export interface HappinessBreakdown {
  score: number;
  contributions: InsightContribution[];
}

export type BaselineMetricKey =
  | "population"
  | "jobs"
  | "unemploymentPercent"
  | "happiness"
  | "congestionPercent"
  | "utilityCoveragePercent"
  | "grossCityProductDaily"
  | "averageLandValue"
  | "consumerPriceIndex"
  | "annualizedNetMigration"
  | "municipalBalance";

export interface BaselineSnapshot {
  cityId: string;
  elapsedDays: number;
  values: Record<BaselineMetricKey, number>;
}

export interface BaselineComparisonRow {
  key: BaselineMetricKey;
  label: string;
  unit: "count" | "percent" | "currency" | "currency-per-day" | "residents-per-year";
  baseline: number;
  current: number;
  difference: number;
  percentDifference: number | null;
}

export interface PersonTimelineEntry {
  activity: Person["currentActivity"];
  startMinute: number;
  endMinute: number;
  buildingId: string;
  buildingName: string;
  modeFromPrevious?: TravelMode;
}

export interface PersonDailyAccounting {
  dailyIncome: number;
  commuteCost: number;
  personalRentShare: number;
  personalGoodsSpending: number;
  personalSpending: number;
  expenses: HouseholdExpenseLedger;
  netDailyCash: number;
  personalCash: number;
  sharedHouseholdCash: number;
}

export interface PersonDailyInsight {
  personId: string;
  householdId: string;
  householdMemberIds: string[];
  homeDistrictId?: string;
  timeline: PersonTimelineEntry[];
  accounting: PersonDailyAccounting;
  migrationStatus: "staying" | "leaving";
  migrationRatePercent: number;
  diagnosis: string;
}

export interface BuildingFinancialCost {
  key: "wages" | "supplies" | "transport" | "occupancy" | "maintenance" | "utilities" | "other";
  label: string;
  value: number;
  sharePercent: number;
}

export interface BuildingFinancialFlow {
  revenueLabel: "Revenue" | "Rent revenue";
  revenue: number;
  costs: number;
  resultLabel: "Profit" | "Net income";
  profit: number;
  costSegments: BuildingFinancialCost[];
}

export interface UtilityCoverageRow {
  key: "power" | "water" | "waste";
  label: string;
  coveragePercent: number;
}

export interface BuildingUtilityInsight {
  efficiencyPercent: number;
  coverage: UtilityCoverageRow[];
  bottleneck: UtilityCoverageRow;
  wasteStored: number;
}

export type BuildingTrafficCategory = "commute" | "visits" | "freight" | "service";

export interface BuildingTrafficRow {
  category: BuildingTrafficCategory;
  label: string;
  activeArrivals: number;
  sharePercent: number;
}

export interface BuildingTrafficInsight {
  activeArrivals: number;
  queuedArrivals: number;
  averageWaitSeconds: number;
  accessLoadPercent: number;
  connectedCommutes: number;
  connectedVisitors: number;
  connectedSupplyUnits: number;
  rows: BuildingTrafficRow[];
}

export interface PersonHappinessDriver {
  need: ResidentNeed;
  label: string;
  unmetPercent: number;
  penaltyPoints: number;
}

export interface PersonHappinessInsight {
  startingScore: number;
  score: number;
  drivers: PersonHappinessDriver[];
}

export function deriveBuildingFinancialFlow(
  building: Readonly<Building>,
  accounting: Readonly<BuildingAccounting> | undefined = building.accounting,
): BuildingFinancialFlow | null {
  if (
    accounting === undefined
    || accounting.operatingModel === "civic"
    || accounting.operatingModel === "amenity"
  ) {
    return null;
  }

  const costs = Math.max(0, accounting.operatingCost);
  const possibleSegments: Array<Omit<BuildingFinancialCost, "sharePercent">> = [
    { key: "wages", label: "Wages", value: Math.max(0, accounting.dailyWages) },
    { key: "supplies", label: "Supplies", value: Math.max(0, accounting.supplyCost) },
    { key: "transport", label: "Transport", value: Math.max(0, accounting.transportCost) },
    { key: "occupancy", label: "Property rent", value: Math.max(0, accounting.occupancyCost) },
    { key: "maintenance", label: "Maintenance", value: Math.max(0, accounting.maintenanceCost) },
    { key: "utilities", label: "Utilities", value: Math.max(0, accounting.utilityCost) },
  ];
  const rawSegments = possibleSegments.filter((segment) => segment.value > 0);
  const explainedCosts = sum(rawSegments.map((segment) => segment.value));
  const remainder = costs - explainedCosts;
  if (remainder > 0.01) {
    rawSegments.push({ key: "other", label: "Other costs", value: remainder });
  }
  if (rawSegments.length === 0 && costs > 0) {
    rawSegments.push({ key: "other", label: "Other costs", value: costs });
  }
  const segmentTotal = sum(rawSegments.map((segment) => segment.value));
  const costSegments = rawSegments.map((segment): BuildingFinancialCost => ({
    ...segment,
    sharePercent: segmentTotal > 0 ? segment.value / segmentTotal * 100 : 0,
  }));

  const housing = accounting.operatingModel === "housing" || building.buildingUse === "housing";
  return {
    revenueLabel: housing ? "Rent revenue" : "Revenue",
    revenue: Math.max(0, housing ? accounting.rentIncome : accounting.revenue),
    costs,
    resultLabel: housing ? "Net income" : "Profit",
    profit: accounting.profit,
    costSegments,
  };
}

export function deriveBuildingUtilityInsight(building: Readonly<Building>): BuildingUtilityInsight {
  const labels: Record<UtilityCoverageRow["key"], string> = {
    power: "Power",
    water: "Water",
    waste: "Waste",
  };
  const coverage = (Object.keys(labels) as UtilityCoverageRow["key"][]).map((key) => ({
    key,
    label: labels[key],
    coveragePercent: clamp(building.utilityService[key], 0, 1) * 100,
  }));
  const bottleneck = [...coverage].sort((left, right) => left.coveragePercent - right.coveragePercent)[0]!;
  return {
    efficiencyPercent: clamp(building.efficiency, 0, 1) * 100,
    coverage,
    bottleneck,
    wasteStored: Math.max(0, building.wasteStored),
  };
}

export function deriveBuildingTrafficInsight(
  building: Readonly<Building>,
  vehicles: readonly Vehicle[],
  connections: readonly BuildingConnection[],
  networkEdges: readonly NetworkEdge[],
): BuildingTrafficInsight {
  const arrivals = vehicles.filter((vehicle) =>
    !vehicle.completed && vehicle.destinationBuildingId === building.id
  );
  const categoryFor = (vehicle: Readonly<Vehicle>): BuildingTrafficCategory => {
    if (vehicle.tripPurpose === "work") return "commute";
    if (vehicle.tripPurpose === "delivery" || vehicle.vehicleType === "truck") return "freight";
    if (vehicle.tripPurpose === "service" || vehicle.vehicleType === "service") return "service";
    return "visits";
  };
  const counts: Record<BuildingTrafficCategory, number> = {
    commute: 0,
    visits: 0,
    freight: 0,
    service: 0,
  };
  arrivals.forEach((vehicle) => { counts[categoryFor(vehicle)] += 1; });
  const labels: Record<BuildingTrafficCategory, string> = {
    commute: "Commute",
    visits: "Shopping & visits",
    freight: "Freight",
    service: "Service",
  };
  const inboundConnections = connections.filter((connection) => connection.toBuildingId === building.id);
  const accessEdges = networkEdges.filter((edge) => edge.id.startsWith(`access-${building.id}-road`));
  const averageWaitSeconds = arrivals.length > 0
    ? sum(arrivals.map((vehicle) => vehicle.waitingSeconds)) / arrivals.length
    : 0;
  return {
    activeArrivals: arrivals.length,
    queuedArrivals: arrivals.filter((vehicle) => vehicle.waitingSeconds > 0.5).length,
    averageWaitSeconds,
    accessLoadPercent: average(accessEdges.map((edge) => clamp(edge.congestion, 0, 1))) * 100,
    connectedCommutes: sum(inboundConnections.filter((connection) => connection.kind === "commute").map((connection) => connection.volume)),
    connectedVisitors: sum(inboundConnections.filter((connection) => connection.kind === "customer").map((connection) => connection.volume)),
    connectedSupplyUnits: sum(inboundConnections.filter((connection) => connection.kind === "supply").map((connection) => connection.volume)),
    rows: (Object.keys(counts) as BuildingTrafficCategory[]).map((category) => ({
      category,
      label: labels[category],
      activeArrivals: counts[category],
      sharePercent: arrivals.length > 0 ? counts[category] / arrivals.length * 100 : 0,
    })),
  };
}

export function derivePersonHappinessInsight(person: Readonly<Person>): PersonHappinessInsight {
  const labels: Record<ResidentNeed, string> = {
    education: "Education",
    goods: "Goods access",
    health: "Health care",
    community: "Community",
    recreation: "Recreation",
  };
  const drivers = (Object.keys(labels) as ResidentNeed[]).map((need): PersonHappinessDriver => ({
    need,
    label: labels[need],
    unmetPercent: clamp(person.needs[need], 0, 1) * 100,
    penaltyPoints: clamp(person.needs[need], 0, 1) * 10,
  }));
  return {
    startingScore: 100,
    score: needHappinessScore(person.needs),
    drivers,
  };
}

export function deriveRepresentationSummary(
  city: Readonly<CitySectionState>,
  people: readonly Person[],
  buildings: readonly Building[],
): RepresentationSummary {
  const residentsPerVisiblePerson = people.length > 0
    ? city.metrics.population / people.length
    : null;
  const approximateScale = residentsPerVisiblePerson === null
    ? null
    : roundForLabel(residentsPerVisiblePerson);
  return {
    citywideResidents: city.metrics.population,
    representativePeople: people.length,
    residentsPerVisiblePerson,
    detailedBuildings: buildings.length,
    aggregateDistricts: city.districts.length,
    peopleLabel: approximateScale === null
      ? "No representative people are visible."
      : `1 visible person represents approximately ${approximateScale.toLocaleString()} residents.`,
    citywideLabel: `${buildings.length.toLocaleString()} detailed buildings sit inside ${city.districts.length.toLocaleString()} aggregate districts.`,
  };
}

export function deriveMigrationBreakdown(city: Readonly<CitySectionState>): MigrationBreakdown {
  const factorKeys = ["jobs", "happiness", "housing", "utilities", "congestion"] as const;
  const totals = Object.fromEntries(factorKeys.map((key) => [key, 0])) as Record<typeof factorKeys[number], number>;
  let rateLimit = 0;

  for (const district of city.districts) {
    const rates = districtMigrationRates(district);
    for (const key of factorKeys) totals[key] += rates[key] * district.population;
    const rawRate = sum(factorKeys.map((key) => rates[key]));
    rateLimit += (clamp(rawRate, -0.045, 0.065) - rawRate) * district.population;
  }

  const contributions: InsightContribution[] = [
    contribution("jobs", "Jobs", totals.jobs, "Open jobs attract residents; too few jobs push them away."),
    contribution("happiness", "Happiness", totals.happiness, "District happiness is compared with the engine's neutral score of 65."),
    contribution("housing", "Housing room", totals.housing, "Unused housing capacity makes moving in easier."),
    contribution("utilities", "Utilities", totals.utilities, "Reliable power, water, and waste service support migration."),
    contribution("congestion", "Congestion", totals.congestion, "Congestion always reduces the migration rate."),
    contribution("rateLimit", "Rate limit", rateLimit, "The engine limits each district to between -4.5% and +6.5% migration per year."),
  ];
  const explained = sum(contributions.map((row) => row.value));
  contributions.push(contribution(
    "reconciliation",
    "Saved-state rounding",
    city.metrics.annualizedNetMigration - explained,
    "Reconciles rounded district values with the saved citywide net migration total.",
  ));
  return { annualNetMigration: city.metrics.annualizedNetMigration, contributions };
}

export function deriveCongestionTripBreakdown(
  city: Readonly<CitySectionState>,
): CongestionTripBreakdown {
  const counts: Record<TripCategory, number> = {
    commute: 0,
    shopping: 0,
    freight: 0,
    pedestrian: 0,
    transit: 0,
  };
  for (const district of city.districts) {
    const commute = Math.max(0, district.commuteTripsDaily);
    const shopping = Math.max(0, district.shoppingTripsDaily);
    const personTrips = commute + shopping;
    const pedestrian = Math.min(personTrips, Math.max(0, district.pedestrianTripsDaily));
    const motorizedPersonTrips = personTrips - pedestrian;
    const transit = motorizedPersonTrips * clamp(district.transitSharePercent / 100, 0, 1);
    const privatePersonTrips = motorizedPersonTrips - transit;
    const commuteRatio = personTrips > 0 ? commute / personTrips : 0;
    counts.commute += privatePersonTrips * commuteRatio;
    counts.shopping += privatePersonTrips * (1 - commuteRatio);
    counts.freight += Math.max(0, district.freightTripsDaily);
    counts.pedestrian += pedestrian;
    counts.transit += transit;
  }
  const totalTripsDaily = sum(Object.values(counts));
  const labels: Record<TripCategory, string> = {
    commute: "Private commute trips",
    shopping: "Private shopping trips",
    freight: "Freight trips",
    pedestrian: "Walking trips",
    transit: "Transit trips",
  };
  const rows = (Object.keys(counts) as TripCategory[]).map((category): TripShareRow => ({
    category,
    label: labels[category],
    tripsDaily: counts[category],
    sharePercent: totalTripsDaily > 0 ? counts[category] / totalTripsDaily * 100 : 0,
    contributesToRoadCongestion: category === "commute" || category === "shopping" || category === "freight",
  }));
  return {
    totalTripsDaily,
    roadTripsDaily: counts.commute + counts.shopping + counts.freight,
    rows,
  };
}

export function derivePriceBreakdowns(
  city: Readonly<CitySectionState>,
): Record<GoodType, PriceBreakdown> {
  return Object.fromEntries(GOODS.map((good) => [good, derivePriceBreakdown(city, good)])) as Record<GoodType, PriceBreakdown>;
}

export function deriveHappinessBreakdown(city: Readonly<CitySectionState>): HappinessBreakdown {
  const population = sum(city.districts.map((district) => district.population));
  const weighted = (select: (district: CityDistrictState) => number): number => population > 0
    ? sum(city.districts.map((district) => select(district) * district.population)) / population
    : 0;
  const contributions: InsightContribution[] = [
    contribution("startingScore", "Starting score", 29, "Every district starts with 29 happiness points."),
    contribution("utilities", "Utilities", weighted((district) => average(Object.values(district.utilityCoverage)) * 22), "Reliable power, water, and waste add up to 22 points."),
    contribution("employment", "Employment", weighted((district) => (1 - district.unemploymentPercent / 100) * 18), "Employment adds up to 18 points."),
    contribution("goods", "Goods", weighted((district) => district.goodsConsumedDaily / Math.max(1, sum(Object.values(district.goodsDemandByType))) * 12), "Meeting goods demand adds up to 12 points."),
    contribution("travel", "Travel", weighted((district) => (1 - district.congestionPercent / 100) * 7), "Low congestion adds up to 7 points."),
    contribution("housing", "Housing cost", weighted((district) => (1 - rentBurden(district)) * 5), "Affordable rent adds up to 5 points."),
    contribution("spendingRoom", "Money after essentials", weighted((district) => spendingRoom(district) * 6), "Disposable income adds up to 6 points."),
    contribution("civicServices", "Civic services", weighted((district) => district.civicServiceQualityPercent / 100 * 5), "Staffed schools, health care, libraries, and recreation add up to 5 points."),
  ];
  contributions.push(contribution(
    "reconciliation",
    "Score limit and rounding",
    city.metrics.happiness - sum(contributions.map((row) => row.value)),
    "The engine limits district happiness to 0-100 and rounds saved values.",
  ));
  return { score: city.metrics.happiness, contributions };
}

const BASELINE_METRICS: ReadonlyArray<{
  key: BaselineMetricKey;
  label: string;
  unit: BaselineComparisonRow["unit"];
  read: (city: Readonly<CitySectionState>) => number;
}> = [
  { key: "population", label: "Population", unit: "count", read: (city) => city.metrics.population },
  { key: "jobs", label: "Jobs", unit: "count", read: (city) => city.metrics.jobs },
  { key: "unemploymentPercent", label: "Unemployment", unit: "percent", read: (city) => city.metrics.unemploymentPercent },
  { key: "happiness", label: "Happiness", unit: "percent", read: (city) => city.metrics.happiness },
  { key: "congestionPercent", label: "Congestion", unit: "percent", read: (city) => city.metrics.congestionPercent },
  { key: "utilityCoveragePercent", label: "Utility coverage", unit: "percent", read: (city) => city.metrics.utilityCoveragePercent },
  { key: "grossCityProductDaily", label: "Daily city output", unit: "currency-per-day", read: (city) => city.metrics.grossCityProductDaily },
  { key: "averageLandValue", label: "Average land value", unit: "currency", read: (city) => city.metrics.averageLandValue },
  { key: "consumerPriceIndex", label: "Consumer price index", unit: "percent", read: (city) => city.market.consumerPriceIndex },
  { key: "annualizedNetMigration", label: "Net migration", unit: "residents-per-year", read: (city) => city.metrics.annualizedNetMigration },
  { key: "municipalBalance", label: "Municipal balance", unit: "currency", read: (city) => city.metrics.municipalBalance },
];

export function captureBaseline(city: Readonly<CitySectionState>): BaselineSnapshot {
  return {
    cityId: city.id,
    elapsedDays: city.elapsedDays,
    values: Object.fromEntries(BASELINE_METRICS.map((metric) => [metric.key, metric.read(city)])) as Record<BaselineMetricKey, number>,
  };
}

export function compareWithBaseline(
  city: Readonly<CitySectionState>,
  baseline: Readonly<BaselineSnapshot>,
): BaselineComparisonRow[] {
  if (baseline.cityId !== city.id) throw new Error("Baseline belongs to a different city section");
  return BASELINE_METRICS.map((metric) => {
    const current = metric.read(city);
    const original = baseline.values[metric.key];
    const difference = current - original;
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      baseline: original,
      current,
      difference,
      percentDifference: original === 0 ? null : difference / Math.abs(original) * 100,
    };
  });
}

export function derivePersonDailyInsight(
  person: Readonly<Person>,
  household: Readonly<Household>,
  city: Readonly<CitySectionState>,
  buildings: readonly Building[],
): PersonDailyInsight {
  if (person.householdId !== household.id || !household.memberIds.includes(person.id)) {
    throw new Error("Person and household do not match");
  }
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));
  const timeline = person.schedule.map((entry, index): PersonTimelineEntry => {
    const previous = person.schedule[index - 1];
    return {
      activity: entry.activity,
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
      buildingId: entry.buildingId,
      buildingName: buildingsById.get(entry.buildingId)?.name ?? person.externalWorkplaceName ?? entry.buildingId,
      modeFromPrevious: previous !== undefined && previous.buildingId !== entry.buildingId
        ? person.preferredMode
        : undefined,
    };
  });
  const home = buildingsById.get(person.homeBuildingId);
  const homeDistrict = home === undefined ? undefined : nearestDistrict(home, city.districts);
  const work = person.workBuildingId === undefined ? undefined : buildingsById.get(person.workBuildingId);
  const workDistrict = work === undefined ? undefined : nearestDistrict(work, city.districts);
  const dailyIncome = person.ageGroup === "senior"
    ? 34
    : person.ageGroup === "adult" && person.workBuildingId !== undefined
      ? person.dailyWage > 0 ? person.dailyWage : workDistrict?.averageWageDaily ?? 0
      : 0;
  const familySize = Math.max(1, household.familySize);
  const householdExpenses = household.dailyExpenses.total > 0
    ? household.dailyExpenses
    : divideExpenseLedger(city.metrics.householdExpensesDaily, Math.max(1, city.metrics.households));
  const expenses = divideExpenseLedger(householdExpenses, familySize);
  expenses.transport = person.commuteCostDaily;
  expenses.total = sumExpenseLedger(expenses);
  const personalRentShare = expenses.housing + expenses.utilities;
  const personalGoodsSpending = expenses.goods;
  const accounting: PersonDailyAccounting = {
    dailyIncome,
    commuteCost: expenses.transport,
    personalRentShare,
    personalGoodsSpending,
    personalSpending: expenses.total,
    expenses,
    netDailyCash: dailyIncome - expenses.total,
    personalCash: person.money,
    sharedHouseholdCash: household.money,
  };
  const migrationRate = homeDistrict === undefined
    ? city.metrics.annualizedNetMigration / Math.max(1, city.metrics.population)
    : homeDistrict.annualizedMigration / Math.max(1, homeDistrict.population);
  const migrationStatus = migrationRate < 0 ? "leaving" : "staying";
  const strongestReason = homeDistrict === undefined
    ? "the citywide migration trend"
    : describeStrongestMigrationFactor(homeDistrict, migrationStatus);
  const cashDirection = accounting.netDailyCash < 0 ? "loses" : "keeps";
  const employmentReason = person.employmentStatus === "external"
    ? `works outside the section at ${person.externalWorkplaceName ?? "a regional employer"}`
    : person.employmentStatus === "unemployed"
      ? `has been unemployed for ${person.unemployedDays} days`
      : person.employmentStatus === "local"
        ? "holds a local job"
        : "is outside the labor force";
  const diagnosis = `${person.name} ${employmentReason} and is currently ${migrationStatus} because of ${strongestReason}. ` +
    `The household has $${round(household.rentArrears)} in rent arrears; the daily budget ${cashDirection} $${round(Math.abs(accounting.netDailyCash))}.`;

  return {
    personId: person.id,
    householdId: household.id,
    householdMemberIds: [...household.memberIds],
    homeDistrictId: homeDistrict?.id,
    timeline,
    accounting,
    migrationStatus,
    migrationRatePercent: migrationRate * 100,
    diagnosis,
  };
}

function divideExpenseLedger(
  expenses: Readonly<HouseholdExpenseLedger>,
  divisor: number,
): HouseholdExpenseLedger {
  const safeDivisor = Math.max(1, divisor);
  const divided = {
    housing: expenses.housing / safeDivisor,
    goods: expenses.goods / safeDivisor,
    utilities: expenses.utilities / safeDivisor,
    transport: expenses.transport / safeDivisor,
    healthcare: expenses.healthcare / safeDivisor,
    education: expenses.education / safeDivisor,
    recreation: expenses.recreation / safeDivisor,
    taxes: expenses.taxes / safeDivisor,
    total: 0,
  };
  divided.total = sumExpenseLedger(divided);
  return divided;
}

function sumExpenseLedger(expenses: Readonly<HouseholdExpenseLedger>): number {
  return expenses.housing + expenses.goods + expenses.utilities + expenses.transport
    + expenses.healthcare + expenses.education + expenses.recreation + expenses.taxes;
}

function derivePriceBreakdown(city: Readonly<CitySectionState>, good: GoodType): PriceBreakdown {
  const market = city.market;
  const basePrice = BASE_GOODS_PRICES[good];
  const demand = Math.max(0, market.demandDaily[good]);
  const localSupply = Math.max(0, market.localSupplyDaily[good]);
  const imports = Math.max(0, market.importsDaily[good]);
  const unmet = Math.max(0, market.unmetDemandDaily[good]);
  const localUsed = Math.min(demand, localSupply);
  const fulfilled = localUsed + imports;
  const scarcity = demand > 0 ? unmet / demand : 0;
  const localPrice = basePrice * clamp(0.84 + 0.28 * demand / Math.max(1, localSupply), 0.76, 1.55);
  const importSources = city.externalMarkets.filter((source) => source.importsDaily[good] > 0);
  const sourceImports = sum(importSources.map((source) => source.importsDaily[good]));
  const averageImportPrice = sourceImports > 0
    ? sum(importSources.map((source) => source.goodsPrices[good] * source.importsDaily[good])) / sourceImports
    : basePrice;
  const averageTransportCost = sourceImports > 0
    ? sum(importSources.map((source) => transportCostPerUnit(city, source.distanceKm, good) * source.importsDaily[good])) / sourceImports
    : 0;
  const localSupplyEffect = fulfilled > 0 ? localUsed / fulfilled * (localPrice - basePrice) : 0;
  const importedPriceEffect = fulfilled > 0 ? imports / fulfilled * (averageImportPrice - basePrice) : 0;
  const transportEffect = fulfilled > 0 ? imports / fulfilled * averageTransportCost : 0;
  const blendedPrice = basePrice + localSupplyEffect + importedPriceEffect + transportEffect;
  const shortageEffect = fulfilled > 0 ? blendedPrice * scarcity * 0.45 : basePrice * 0.8;
  const targetPrice = blendedPrice + shortageEffect;
  const currentPrice = market.prices[good];
  const contributions = [
    contribution("base", "Normal price", basePrice, "The normal price before supply, imports, and shortages."),
    contribution("localSupply", "Local supply and demand", localSupplyEffect, "Local prices respond to demand compared with available local goods."),
    contribution("importPrice", "Imported goods price", importedPriceEffect, "Imported goods use the configured price at each outside market."),
    contribution("transport", "Import transport", transportEffect, "Longer, heavier, and more congested deliveries cost more."),
    contribution("shortage", "Shortage markup", shortageEffect, "Unmet demand raises the target price by up to 45% of the supplied price."),
    contribution("smoothing", "Price adjustment over time", currentPrice - targetPrice, "The market moves 35% toward its target each day instead of changing instantly."),
  ];
  return {
    good,
    basePrice,
    currentPrice,
    targetPrice,
    demandDaily: demand,
    localSupplyDaily: localSupply,
    importsDaily: imports,
    unmetDemandDaily: unmet,
    transportCostDaily: market.transportCostDaily,
    contributions,
  };
}

function districtMigrationRates(district: Readonly<CityDistrictState>): Record<"jobs" | "happiness" | "housing" | "utilities" | "congestion", number> {
  const utilityReliability = average(Object.values(district.utilityCoverage));
  const jobSignal = clamp(
    (district.jobs - district.laborForce) / Math.max(1, district.laborForce),
    -0.5,
    0.5,
  );
  const housingRoom = clamp(1 - district.housingOccupancyPercent / 118, 0, 1);
  return {
    jobs: jobSignal * 0.035,
    happiness: (district.happiness - 65) / 1_100,
    housing: housingRoom * 0.025,
    utilities: (utilityReliability - 0.9) * 0.03,
    congestion: -district.congestionPercent / 5_000,
  };
}

function describeStrongestMigrationFactor(
  district: Readonly<CityDistrictState>,
  status: PersonDailyInsight["migrationStatus"],
): string {
  const rates = districtMigrationRates(district);
  const entries = Object.entries(rates) as Array<[keyof typeof rates, number]>;
  const aligned = entries.filter(([, value]) => status === "staying" ? value >= 0 : value < 0);
  const [key] = (aligned.length > 0 ? aligned : entries).sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))[0]!;
  const descriptions: Record<keyof typeof rates, Record<PersonDailyInsight["migrationStatus"], string>> = {
    jobs: { staying: "available jobs attracting residents", leaving: "too few available jobs" },
    happiness: { staying: "above-neutral district happiness", leaving: "below-neutral district happiness" },
    housing: { staying: "available housing", leaving: "limited housing room" },
    utilities: { staying: "reliable utilities", leaving: "unreliable utilities" },
    congestion: { staying: "the district's overall positive trend despite congestion", leaving: "traffic congestion" },
  };
  return descriptions[key][status];
}

function nearestDistrict(building: Readonly<Building>, districts: readonly CityDistrictState[]): CityDistrictState | undefined {
  return [...districts].sort((left, right) => {
    const leftDistance = Math.hypot(left.x - building.x, left.z - building.z);
    const rightDistance = Math.hypot(right.x - building.x, right.z - building.z);
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
}

function rentBurden(district: Readonly<CityDistrictState>): number {
  return clamp(
    district.households * district.rentIndex * 52 / Math.max(1, district.householdIncomeDaily),
    0,
    1,
  );
}

function spendingRoom(district: Readonly<CityDistrictState>): number {
  return clamp(
    district.disposableIncomeDaily / Math.max(1, district.householdIncomeDaily),
    0,
    1,
  );
}

function transportCostPerUnit(
  city: Readonly<CitySectionState>,
  distanceKm: number,
  good: GoodType,
): number {
  const weights: Record<GoodType, number> = { food: 1, consumerGoods: 0.7, industrialMaterials: 1.6 };
  const population = sum(city.districts.map((district) => district.population));
  const congestion = population > 0
    ? sum(city.districts.map((district) => district.congestionPercent * district.population)) / population
    : 0;
  return distanceKm * weights[good] * 0.018 * (1 + congestion / 120);
}

function contribution(
  key: string,
  label: string,
  value: number,
  explanation: string,
): InsightContribution {
  return { key, label, value, explanation };
}

function roundForLabel(value: number): number {
  if (value >= 1_000) return Math.round(value / 100) * 100;
  if (value >= 100) return Math.round(value / 10) * 10;
  return Math.round(value);
}

function average(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
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
