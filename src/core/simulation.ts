import { advanceCitySection } from "./cityEngine";
import { createCitySectionState, createDemoCitySectionDefinition } from "./cityModel";
import { advanceEconomy, type ExternalLaborMarket } from "./economy";
import {
  createInitialInfrastructure,
  updateInfrastructure,
  type InfrastructureModel,
} from "./infrastructure";
import { createInitialLandUse, updateLandUse } from "./landUse";
import { MobilitySystem, type MobilitySnapshot } from "./mobility";
import { OUTSIDE_FREIGHT_BUILDING_ID } from "./network";
import { deriveBuildingConnections } from "./observability";
import { advancePopulation, createPopulation } from "./population";
import { calendarFromElapsedDays, cityMinutesPerSecond } from "./timeScale";
import type { CitySectionDefinition, CitySectionState, CitySystemEvent, TimeHorizon } from "../models/cityTypes";
import type {
  ActivityType,
  ScenarioSettings,
  SimulationEvent,
  SimulationMetrics,
  SimulationState,
  TripRequest,
} from "../models/types";

export const DEFAULT_SETTINGS: ScenarioSettings = {
  simulationSpeed: 1,
  timeHorizon: "day",
  speedLimitMph: 25,
  signalCycleSeconds: 12,
  transitHeadwayMinutes: 8,
  roadCapacity: 20,
  utilityCapacityScale: 1,
  zoningStrictness: 1,
};

const START_MINUTE = 7 * 60;
const MAX_SUBSTEP_SECONDS = 0.1;
const MAX_EVENTS = 12;
const EPSILON = 1e-9;

interface DemandCredits {
  vehicle: number;
  pedestrian: number;
  freight: number;
}

export class Simulation {
  private settings: ScenarioSettings;
  private state!: SimulationState;
  private mobility!: MobilitySystem;
  private mobilitySnapshot!: MobilitySnapshot;
  private infrastructure!: InfrastructureModel;
  private cityMinute = START_MINUTE;
  private lastProcessedMinute = Math.floor(START_MINUTE);
  private lastEconomyDay = 0;
  private lastInfrastructureMinute = START_MINUTE;
  private nextTripSequence = 1;
  private nextEventSequence = 1;
  private cityDayCredit = 0;
  private demandCredits: DemandCredits = { vehicle: 0, pedestrian: 0, freight: 0 };
  private lastCongestionBand = 0;

  constructor(
    settings: Partial<ScenarioSettings> = {},
    private readonly cityDefinition: CitySectionDefinition = createDemoCitySectionDefinition(),
  ) {
    this.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    this.initialize(false);
  }

  getState(): Readonly<SimulationState> {
    return this.state;
  }

  getSettings(): Readonly<ScenarioSettings> {
    return this.settings;
  }

  start(): void {
    this.state.running = true;
  }

  pause(): void {
    this.state.running = false;
  }

  reset(): void {
    this.initialize(false);
  }

  setSimulationSpeed(value: number): void {
    this.settings = { ...this.settings, simulationSpeed: finiteClamp(value, 0.5, 4, this.settings.simulationSpeed) };
  }

  setTimeHorizon(value: TimeHorizon): void {
    if (!(value in { day: true, week: true, month: true, year: true })) return;
    this.settings = { ...this.settings, timeHorizon: value };
    this.state.timeHorizon = value;
  }

  setSpeedLimitMph(value: number): void {
    this.settings = { ...this.settings, speedLimitMph: finiteClamp(value, 5, 120, this.settings.speedLimitMph) };
    this.mobility.setSpeedLimitMph(this.settings.speedLimitMph);
  }

  setSignalCycleSeconds(value: number): void {
    this.settings = { ...this.settings, signalCycleSeconds: finiteClamp(value, 2, 300, this.settings.signalCycleSeconds) };
    this.updateSignalState();
  }

  setTransitHeadwayMinutes(value: number): void {
    this.settings = { ...this.settings, transitHeadwayMinutes: finiteClamp(value, 3, 20, this.settings.transitHeadwayMinutes) };
    this.mobility.setBusHeadwayMinutes(this.settings.transitHeadwayMinutes);
    this.refreshInfrastructure(0);
  }

  setRoadCapacity(value: number): void {
    this.settings = { ...this.settings, roadCapacity: finiteClamp(value, 8, 40, this.settings.roadCapacity) };
    this.mobility.setRoadCapacity(this.settings.roadCapacity);
    this.refreshInfrastructure(0);
  }

  setUtilityCapacityScale(value: number): void {
    this.settings = { ...this.settings, utilityCapacityScale: finiteClamp(value, 0.5, 1.5, this.settings.utilityCapacityScale) };
    this.refreshInfrastructure(0);
  }

  setZoningStrictness(value: number): void {
    this.settings = { ...this.settings, zoningStrictness: finiteClamp(value, 0.5, 1.5, this.settings.zoningStrictness) };
  }

  update(deltaSeconds: number): void {
    if (!this.state.running || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const scaledSeconds = deltaSeconds * this.settings.simulationSpeed;
    const cityMinutes = scaledSeconds * cityMinutesPerSecond(this.settings.timeHorizon);
    this.state.elapsedSeconds += scaledSeconds;
    this.cityMinute += cityMinutes;
    this.cityDayCredit += cityMinutes / 1440;

    const completedCityDays = Math.floor(this.cityDayCredit + EPSILON);
    if (completedCityDays > 0) {
      const cityUpdate = advanceCitySection(this.state.city, completedCityDays, {
        roadCapacityScale: this.settings.roadCapacity / DEFAULT_SETTINGS.roadCapacity,
        utilityCapacityScale: this.settings.utilityCapacityScale,
        zoningStrictness: this.settings.zoningStrictness,
        transitServiceScale: DEFAULT_SETTINGS.transitHeadwayMinutes / this.settings.transitHeadwayMinutes,
      });
      this.state.city = cityUpdate.state;
      cityUpdate.events.forEach((event) => this.recordCityEvent(event));
      this.cityDayCredit -= completedCityDays;
    }

    this.updateClock();
    this.updateSignalState();
    if (Math.floor(this.cityMinute) > this.lastProcessedMinute) {
      this.processCityBoundaries(this.mobilitySnapshot);
    }

    let visualSeconds = Math.min(scaledSeconds, 5);
    while (visualSeconds > EPSILON) {
      const step = Math.min(MAX_SUBSTEP_SECONDS, visualSeconds);
      this.advanceDetail(step);
      visualSeconds -= step;
    }
    const mobility = this.mobility.getSnapshot();
    this.mobilitySnapshot = mobility;
    this.syncMobility(mobility);
    this.updateCongestionEvents(mobility);
    this.updateMetrics(mobility);
  }

  private initialize(running: boolean): void {
    this.cityMinute = START_MINUTE;
    this.lastProcessedMinute = Math.floor(START_MINUTE);
    this.lastEconomyDay = 0;
    this.lastInfrastructureMinute = START_MINUTE;
    this.nextTripSequence = 1;
    this.nextEventSequence = 1;
    this.cityDayCredit = 0;
    this.demandCredits = { vehicle: 0, pedestrian: 0, freight: 0 };
    this.lastCongestionBand = 0;

    const initialLand = createInitialLandUse();
    const city = createCitySectionState(this.cityDefinition);
    const population = createPopulation(initialLand.buildings, city.startYear);
    const economy = advanceEconomy({
      households: population.households,
      people: population.people,
      buildings: population.buildings,
      cityMinute: this.cityMinute,
      freightEntryBuildingId: OUTSIDE_FREIGHT_BUILDING_ID,
      consumerPriceIndex: city.market.consumerPriceIndex,
      externalLaborMarket: detailedExternalLaborMarket(city, population.people.length),
    });

    this.infrastructure = createInitialInfrastructure(economy.buildings, {
      capacityScale: this.settings.utilityCapacityScale,
      roadCapacity: this.settings.roadCapacity,
      transitHeadwayMinutes: this.settings.transitHeadwayMinutes,
    });
    const infrastructure = updateInfrastructure(economy.buildings, this.infrastructure, {
      elapsedDays: 0,
      capacityScale: this.settings.utilityCapacityScale,
      roadCapacity: this.settings.roadCapacity,
      roadVolume: 0,
      transitHeadwayMinutes: this.settings.transitHeadwayMinutes,
    });
    this.infrastructure = infrastructure.infrastructure;
    this.mobility = new MobilitySystem(infrastructure.buildings, {
      roadCapacity: this.settings.roadCapacity,
      speedLimitMph: this.settings.speedLimitMph,
      busHeadwayMinutes: this.settings.transitHeadwayMinutes,
    });

    this.state = {
      running,
      elapsedSeconds: 0,
      day: 1,
      calendarYear: city.year,
      calendarMonth: city.month,
      calendarDay: 1,
      timeOfDayMinutes: START_MINUTE,
      timeHorizon: this.settings.timeHorizon,
      signalPhase: "vehicles",
      signalPhaseRemainingSeconds: this.settings.signalCycleSeconds / 2,
      vehicles: [],
      pedestrians: [],
      people: economy.people,
      households: economy.households,
      buildings: infrastructure.buildings,
      buildingConnections: deriveBuildingConnections(economy.people, economy.tripRequests),
      network: this.mobility.getNetwork(),
      economy: economy.economy,
      landUse: initialLand.landUse,
      infrastructure: this.infrastructure.state,
      city,
      metrics: createInitialMetrics(economy.people.length, initialLand.landUse.averageLandValue, city),
      events: [],
    };
    this.recordEvent("population", `${economy.people.length} residents began their daily routines.`, "info");
    this.recordEvent(
      "economy",
      `${economy.economy.employedWorkers} workers found jobs, including ${economy.economy.externalWorkers} outside the section.`,
      "info",
    );
    this.mobility.consumeTrips(economy.tripRequests);
    const mobility = this.mobility.getSnapshot();
    this.mobilitySnapshot = mobility;
    this.syncMobility(mobility);
    this.updateMetrics(mobility);
  }

  private advanceDetail(step: number): void {
    this.generateBackgroundTrips(step);
    this.mobility.update(step, this.state.signalPhase);
  }

  private processCityBoundaries(mobility: MobilitySnapshot): void {
    const currentMinute = Math.floor(this.cityMinute);
    if (currentMinute <= this.lastProcessedMinute) return;
    const population = advancePopulation(
      this.state.people,
      currentMinute,
      this.state.buildings,
      {
        busAvailable: this.state.infrastructure.transitLines.some((line) => line.active),
        parkingPressure: ratio(
          this.state.infrastructure.parkingUsed,
          this.state.infrastructure.parkingCapacity,
        ),
        congestion: mobility.roadCongestionPercent / 100,
        startYear: this.state.city.startYear,
      },
    );
    this.state.people = population.people;
    if (this.settings.timeHorizon === "day") this.mobility.consumeTrips(population.tripRequests);

    const currentDay = Math.floor(currentMinute / 1440);
    while (this.lastEconomyDay < currentDay) {
      this.lastEconomyDay += 1;
      this.runDailySystems(this.lastEconomyDay);
    }

    const infrastructureDays = (currentMinute - this.lastInfrastructureMinute) / 1440;
    if (infrastructureDays >= 1 / 24) {
      this.refreshInfrastructure(Math.min(30, infrastructureDays));
      this.lastInfrastructureMinute = currentMinute;
    }
    this.lastProcessedMinute = currentMinute;
  }

  private runDailySystems(dayIndex: number): void {
    this.lastEconomyDay = dayIndex;
    const economy = advanceEconomy({
      households: this.state.households,
      people: this.state.people,
      buildings: this.state.buildings,
      cityMinute: dayIndex * 1440,
      freightEntryBuildingId: OUTSIDE_FREIGHT_BUILDING_ID,
      consumerPriceIndex: this.state.city.market.consumerPriceIndex,
      externalLaborMarket: detailedExternalLaborMarket(this.state.city, this.state.people.length),
    });
    this.state.households = economy.households;
    this.state.people = economy.people;
    this.state.buildings = economy.buildings;
    this.state.buildingConnections = deriveBuildingConnections(economy.people, economy.tripRequests);
    this.state.economy = economy.economy;
    if (this.settings.timeHorizon === "day") this.mobility.consumeTrips(economy.tripRequests);
    const growthBefore = this.state.landUse.growthEvents;
    const utilityCoverage = averageUtilityCoverage(this.state);
    const landUse = updateLandUse(this.state.landUse, this.state.buildings, {
      zoneDemand: this.state.economy.zoneDemand,
      zoningStrictness: this.settings.zoningStrictness,
      accessibility: 1 - this.state.metrics.congestionPercent / 140,
      transitProximity: this.state.infrastructure.transitLines.some((line) => line.active) ? 0.85 : 0.25,
      utilityReliability: utilityCoverage / 100,
      congestion: this.state.metrics.congestionPercent / 100,
      pollution: average(this.state.buildings.map((building) => building.pollution)) / 100,
      rentPressure: clamp01(this.state.economy.averageRent / 220),
    });
    this.state.landUse = landUse.landUse;
    this.state.buildings = landUse.buildings;
    this.refreshInfrastructure(0);

    this.recordEvent(
      "economy",
      `${formatNumber(economy.economy.goodsProduced)} goods produced; ${economy.economy.deliveriesCompleted} deliveries dispatched.`,
      "info",
    );
    economy.events.forEach((message) => this.recordEvent("economy", message, "warning"));
    const newGrowth = landUse.landUse.growthEvents - growthBefore;
    if (newGrowth > 0) {
      this.recordEvent("land-use", `${newGrowth} building ${newGrowth === 1 ? "project added" : "projects added"} floor area.`, "info");
    }
  }

  private refreshInfrastructure(elapsedDays: number): void {
    const mobility = this.mobility?.getSnapshot();
    const update = updateInfrastructure(this.state?.buildings ?? [], this.infrastructure, {
      elapsedDays,
      capacityScale: this.settings.utilityCapacityScale,
      roadCapacity: this.settings.roadCapacity,
      roadVolume: mobility?.roadVolume ?? 0,
      transitHeadwayMinutes: this.settings.transitHeadwayMinutes,
      parkingUsed: mobility ? Math.min(this.infrastructure.state.parkingCapacity, mobility.vehicles.length) : 0,
    });
    this.infrastructure = update.infrastructure;
    if (this.state) {
      this.state.buildings = update.buildings;
      this.state.infrastructure = update.infrastructure.state;
      const coverage = averageUtilityCoverage(this.state);
      if (coverage < 85) {
        this.recordEvent("utilities", `Network capacity constrained service to ${Math.round(coverage)}%.`, "warning");
      }
    }
  }

  private generateBackgroundTrips(step: number): void {
    const city = this.state.city.metrics;
    const vehicleRate = clamp(city.vehicleTripsDaily / 9_000, 0.4, 18);
    const pedestrianRate = clamp(city.pedestrianTripsDaily / 1_800, 0.8, 16);
    const freightRate = clamp(city.freightTripsDaily / 45, 0.1, 12);
    this.demandCredits.vehicle += (step * vehicleRate) / 60;
    this.demandCredits.pedestrian += (step * pedestrianRate) / 60;
    this.demandCredits.freight += (step * freightRate) / 60;

    this.consumeCredit("vehicle", () => this.createLocalTrip("car", "work"));
    this.consumeCredit("pedestrian", () => this.createLocalTrip("walk", "shopping"));
    this.consumeCredit("freight", () => this.createFreightTrip());
  }

  private consumeCredit(kind: keyof DemandCredits, create: () => TripRequest): void {
    let guard = 0;
    while (this.demandCredits[kind] >= 1 - EPSILON && guard < 4) {
      this.mobility.submitTrip(create());
      this.demandCredits[kind] -= 1;
      guard += 1;
    }
  }

  private createLocalTrip(mode: "car" | "walk", purpose: ActivityType): TripRequest {
    const sequence = this.nextTripSequence++;
    const eligiblePeople = mode === "car"
      ? this.state.people.filter((person) => person.ageGroup === "adult")
      : this.state.people;
    const person = eligiblePeople[sequence % eligiblePeople.length]!;
    const originBuildingId = person.currentBuildingId;
    const scheduledDestination = person.schedule.find(
      (activity) => activity.activity === purpose && activity.buildingId !== originBuildingId,
    );
    const fallbackDestination = person.schedule.find(
      (activity) => activity.buildingId !== originBuildingId,
    );
    const destinationBuildingId = scheduledDestination?.buildingId ?? fallbackDestination?.buildingId ?? person.homeBuildingId;
    return {
      id: `ambient-${mode}-${sequence}`,
      personId: person.id,
      travelerAgeGroup: person.ageGroup,
      originBuildingId,
      destinationBuildingId,
      mode,
      purpose,
      createdMinute: Math.floor(this.cityMinute),
      cargoUnits: 0,
    };
  }

  private createFreightTrip(): TripRequest {
    const destinations = this.state.buildings.filter((building) => building.zone === "commercial" || building.zone === "industrial");
    const industries = this.state.buildings.filter((building) => building.zone === "industrial");
    const sequence = this.nextTripSequence++;
    const building = destinations[sequence % destinations.length]!;
    const industry = industries[sequence % industries.length] ?? building;
    const imports = this.state.city.metrics.goodsImportedDaily;
    const exports = this.state.city.metrics.goodsExportedDaily;
    const externalFreight = this.state.city.externalMarkets.reduce(
      (total, market) => total + market.freightTripsDaily,
      0,
    );
    const externalShare = clamp(externalFreight / Math.max(1, this.state.city.metrics.freightTripsDaily), 0, 1);
    const sample = (sequence * 0.61803398875) % 1;
    const external = sample < externalShare;
    const inbound = imports + exports <= 0 || (sequence * 0.41421356237) % 1 < imports / Math.max(1, imports + exports);
    const averageCargo = (imports + exports + this.state.city.metrics.goodsProducedDaily) /
      Math.max(1, this.state.city.metrics.freightTripsDaily);
    return {
      id: `ambient-freight-${sequence}`,
      originBuildingId: external
        ? inbound ? OUTSIDE_FREIGHT_BUILDING_ID : industry.id
        : industry.id,
      destinationBuildingId: external
        ? inbound ? building.id : OUTSIDE_FREIGHT_BUILDING_ID
        : building.id,
      mode: "freight",
      purpose: "delivery",
      createdMinute: Math.floor(this.cityMinute),
      vehicleType: "truck",
      cargoUnits: clamp(averageCargo, 4, 36),
    };
  }

  private syncMobility(snapshot: MobilitySnapshot): void {
    this.state.vehicles = snapshot.vehicles;
    this.state.pedestrians = snapshot.pedestrians;
    this.state.network = this.mobility.getNetwork();
    this.state.infrastructure = {
      ...this.infrastructure.state,
      transitLines: this.infrastructure.state.transitLines.map((line) => ({
        ...line,
        passengersTransported: snapshot.counters.transitRidership,
        averageWaitMinutes: snapshot.counters.averageTransitWaitMinutes,
      })),
      roadVolume: snapshot.roadVolume,
    };
  }

  private updateClock(): void {
    const elapsedDays = Math.max(0, (this.cityMinute - START_MINUTE) / 1440);
    const calendar = calendarFromElapsedDays(this.state.city.startYear, elapsedDays);
    this.state.day = Math.floor(elapsedDays) + 1;
    this.state.calendarYear = calendar.year;
    this.state.calendarMonth = calendar.month;
    this.state.calendarDay = calendar.dayOfMonth;
    this.state.timeOfDayMinutes = ((this.cityMinute % 1440) + 1440) % 1440;
  }

  private updateSignalState(): void {
    const halfCycle = this.settings.signalCycleSeconds / 2;
    const cyclePosition = this.state.elapsedSeconds % this.settings.signalCycleSeconds;
    this.state.signalPhase = cyclePosition < halfCycle ? "vehicles" : "pedestrians";
    this.state.signalPhaseRemainingSeconds =
      this.state.signalPhase === "vehicles"
        ? halfCycle - cyclePosition
        : this.settings.signalCycleSeconds - cyclePosition;
    this.mobility?.setSignalPhase(this.state.signalPhase);
  }

  private updateCongestionEvents(snapshot: MobilitySnapshot): void {
    const band = snapshot.roadCongestionPercent >= 80 ? 2 : snapshot.roadCongestionPercent >= 50 ? 1 : 0;
    if (band > this.lastCongestionBand) {
      this.recordEvent(
        "mobility",
        band === 2 ? "Road demand exceeded practical capacity." : "Queues are forming at the intersection.",
        "warning",
      );
    }
    this.lastCongestionBand = band;
  }

  private updateMetrics(mobility: MobilitySnapshot): void {
    const commercial = this.state.buildings.filter((building) => building.zone === "commercial");
    const retailDemand = sum(commercial.map((building) => building.customerDemand));
    const retailInventory = sum(commercial.map((building) => building.goodsInventory));
    const jobs = this.state.economy.employedWorkers + this.state.economy.availableJobs;
    const utilityCoverage = averageUtilityCoverage(this.state);
    const happiness = average(this.state.households.map((household) => household.happiness));

    this.state.metrics = {
      averageVehicleTravelSeconds: mobility.counters.averageVehicleTravelSeconds,
      congestionPercent: mobility.roadCongestionPercent,
      pedestrianWaitSeconds: mobility.counters.averagePedestrianWaitSeconds,
      potentialConflicts: mobility.counters.potentialConflicts,
      completedVehicles: mobility.counters.completedVehicles,
      trafficFlowPerMinute: this.state.elapsedSeconds > 0
        ? (mobility.counters.completedVehicles * 60) / this.state.elapsedSeconds
        : 0,
      population: this.state.people.length,
      activeTrips: mobility.vehicles.length + mobility.pedestrians.length + mobility.busQueueLength + mobility.busPassengersOnBoard,
      transitRidership: mobility.counters.transitRidership,
      averageTransitWaitMinutes: mobility.counters.averageTransitWaitMinutes,
      goodsAvailabilityPercent: retailDemand > 0 ? clamp((retailInventory / retailDemand) * 100, 0, 100) : 100,
      jobFillPercent: jobs > 0 ? (this.state.economy.employedWorkers / jobs) * 100 : 100,
      averageLandValue: this.state.landUse.averageLandValue,
      utilityCoveragePercent: utilityCoverage,
      wasteCollectionPercent: this.state.infrastructure.utilities.waste.coveragePercent,
      householdHappiness: happiness,
      cityPopulation: this.state.city.metrics.population,
      districtCount: this.state.city.districts.length,
      grossCityProductDaily: this.state.city.metrics.grossCityProductDaily,
      municipalBalance: this.state.city.metrics.municipalBalance,
      cityUnemploymentPercent: this.state.city.metrics.unemploymentPercent,
      cityHousingOccupancyPercent: this.state.city.metrics.housingOccupancyPercent,
      cityTransitSharePercent: this.state.city.metrics.transitSharePercent,
      simulatedDays: Math.max(0, (this.cityMinute - START_MINUTE) / 1440),
    };
  }

  private recordEvent(
    category: SimulationEvent["category"],
    message: string,
    severity: SimulationEvent["severity"],
  ): void {
    const duplicate = this.state?.events[0];
    if (duplicate?.message === message && duplicate.minute === Math.floor(this.cityMinute)) return;
    const event: SimulationEvent = {
      id: `event-${this.nextEventSequence++}`,
      minute: Math.floor(this.cityMinute),
      category,
      message,
      severity,
    };
    if (this.state) this.state.events = [event, ...this.state.events].slice(0, MAX_EVENTS);
  }

  private recordCityEvent(event: CitySystemEvent): void {
    this.recordEvent(
      event.category === "finance" ? "economy" : event.category,
      event.message,
      event.severity,
    );
  }
}

function createInitialMetrics(
  population: number,
  landValue: number,
  city: SimulationState["city"],
): SimulationMetrics {
  return {
    averageVehicleTravelSeconds: 0,
    congestionPercent: 0,
    pedestrianWaitSeconds: 0,
    potentialConflicts: 0,
    completedVehicles: 0,
    trafficFlowPerMinute: 0,
    population,
    activeTrips: 0,
    transitRidership: 0,
    averageTransitWaitMinutes: 0,
    goodsAvailabilityPercent: 100,
    jobFillPercent: 0,
    averageLandValue: landValue,
    utilityCoveragePercent: 100,
    wasteCollectionPercent: 100,
    householdHappiness: 0,
    cityPopulation: city.metrics.population,
    districtCount: city.districts.length,
    grossCityProductDaily: city.metrics.grossCityProductDaily,
    municipalBalance: city.metrics.municipalBalance,
    cityUnemploymentPercent: city.metrics.unemploymentPercent,
    cityHousingOccupancyPercent: city.metrics.housingOccupancyPercent,
    cityTransitSharePercent: city.metrics.transitSharePercent,
    simulatedDays: city.elapsedDays,
  };
}

function detailedExternalLaborMarket(
  city: Readonly<CitySectionState>,
  representativePeople: number,
): ExternalLaborMarket | undefined {
  const markets = city.externalMarkets
    .filter((market) => market.externalJobs > 0 && market.commuterCapacityDaily > 0)
    .sort((left, right) => left.distanceKm - right.distanceKm);
  const nearest = markets[0];
  if (nearest === undefined || representativePeople <= 0) return undefined;
  const residentsPerRepresentative = city.metrics.population / representativePeople;
  const externalCapacity = sum(markets.map((market) =>
    Math.min(market.externalJobs, market.commuterCapacityDaily)
  ));
  const labor = sum(city.districts.map((district) => district.laborForce));
  const cityWage = labor > 0
    ? sum(city.districts.map((district) => district.averageWageDaily * district.laborForce)) / labor
    : 145;
  return {
    name: nearest.name,
    jobCapacity: Math.max(1, Math.round(externalCapacity / Math.max(1, residentsPerRepresentative))),
    dailyWage: Math.max(70, cityWage * 1.04),
    commuteCostDaily: nearest.distanceKm * 0.32,
  };
}

function sanitizeSettings(settings: ScenarioSettings): ScenarioSettings {
  return {
    simulationSpeed: finiteClamp(settings.simulationSpeed, 0.5, 4, 1),
    timeHorizon: sanitizeTimeHorizon(settings.timeHorizon),
    speedLimitMph: finiteClamp(settings.speedLimitMph, 10, 45, 25),
    signalCycleSeconds: finiteClamp(settings.signalCycleSeconds, 6, 40, 12),
    transitHeadwayMinutes: finiteClamp(settings.transitHeadwayMinutes, 3, 20, 8),
    roadCapacity: finiteClamp(settings.roadCapacity, 8, 40, 20),
    utilityCapacityScale: finiteClamp(settings.utilityCapacityScale, 0.5, 1.5, 1),
    zoningStrictness: finiteClamp(settings.zoningStrictness, 0.5, 1.5, 1),
  };
}

function sanitizeTimeHorizon(value: TimeHorizon): TimeHorizon {
  return value === "day" || value === "week" || value === "month" || value === "year" ? value : "day";
}

function averageUtilityCoverage(state: SimulationState): number {
  return average([
    state.infrastructure.utilities.power.coveragePercent,
    state.infrastructure.utilities.water.coveragePercent,
    state.infrastructure.utilities.waste.coveragePercent,
  ]);
}

function finiteClamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
