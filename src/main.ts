import "./styles.css";
import { Simulation } from "./core/simulation";
import { formatLongDate } from "./core/timeScale";
import type { TimeHorizon } from "./models/cityTypes";
import type { SimulationState } from "./models/types";
import { ThreeRenderer } from "./rendering/threeRenderer";

type Layer = "overview" | "people" | "economy" | "infrastructure" | "land-use";

interface DisplayItem {
  label: string;
  value: (state: Readonly<SimulationState>) => string;
  detail?: string;
}

interface LayerView {
  title: string;
  sceneLabel: string;
  summary: (state: Readonly<SimulationState>) => string;
  inspector: DisplayItem[];
  metrics: DisplayItem[];
}

const canvas = requireElement<HTMLCanvasElement>("simulation-canvas");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const statusPill = requireElement<HTMLSpanElement>("status-pill");
const dayOutput = requireElement<HTMLElement>("day-output");
const timeOutput = requireElement<HTMLElement>("time-output");
const signalPhase = requireElement<HTMLElement>("signal-phase");
const signalTimeRemaining = requireElement<HTMLElement>("signal-time-remaining");
const activeLayerLabel = requireElement<HTMLElement>("active-layer-label");
const cityNameOutput = requireElement<HTMLElement>("city-name-output");
const inspectorTitle = requireElement<HTMLElement>("inspector-title");
const inspectorSummary = requireElement<HTMLElement>("inspector-summary");
const metricsTitle = requireElement<HTMLElement>("metrics-title");
const eventList = requireElement<HTMLOListElement>("event-list");
const generatedCommutes = requireElement<HTMLElement>("generated-commutes");
const generatedShopping = requireElement<HTMLElement>("generated-shopping");
const generatedPedestrians = requireElement<HTMLElement>("generated-pedestrians");
const generatedFreight = requireElement<HTMLElement>("generated-freight");
const layerTabs = [...document.querySelectorAll<HTMLButtonElement>(".layer-tab")];
const horizonButtons = [...document.querySelectorAll<HTMLButtonElement>(".horizon-control button")];

const simulation = new Simulation();
const renderer = new ThreeRenderer(canvas);
let previousTimestamp = performance.now();
let activeLayer: Layer = "overview";

const views: Record<Layer, LayerView> = {
  overview: {
    title: "City section health",
    sceneLabel: "City systems overview",
    summary: (state) => state.city.metrics.utilityCoveragePercent < 88
      ? "Utility limits are reducing district performance and long-term growth."
      : state.city.metrics.congestionPercent >= 65
        ? "Regional travel demand is exceeding the connected network capacity."
        : "Population, services, mobility and development are operating within modeled capacity.",
    inspector: [
      entry("City population", (state) => number(state.city.metrics.population)),
      entry("Districts", (state) => number(state.city.districts.length)),
      entry("Unemployment", (state) => percent(state.city.metrics.unemploymentPercent)),
      entry("Utility coverage", (state) => percent(state.city.metrics.utilityCoveragePercent)),
    ],
    metrics: [
      entry("Congestion", (state) => percent(state.city.metrics.congestionPercent), "Daily network demand against capacity"),
      entry("Daily output", (state) => currency(state.city.metrics.grossCityProductDaily), "Modeled gross city product"),
      entry("Housing occupancy", (state) => percent(state.city.metrics.housingOccupancyPercent), "Residents against available units"),
      entry("Transit share", (state) => percent(state.city.metrics.transitSharePercent), "Trips carried by public transit"),
      entry("Land value", (state) => currency(state.city.metrics.averageLandValue), "Population-weighted district value"),
      entry("Municipal balance", (state) => currency(state.city.metrics.municipalBalance), "Taxes less infrastructure maintenance"),
    ],
  },
  people: {
    title: "Population and households",
    sceneLabel: "Demographics and migration",
    summary: (state) => `${number(state.city.metrics.population)} residents in ${number(state.city.metrics.households)} households respond to housing, jobs, services, costs and access.`,
    inspector: [
      entry("Children", (state) => number(sumDistricts(state, (district) => district.children))),
      entry("Adults", (state) => number(sumDistricts(state, (district) => district.adults))),
      entry("Seniors", (state) => number(sumDistricts(state, (district) => district.seniors))),
      entry("Annual migration", (state) => signedNumber(sumDistricts(state, (district) => district.annualizedMigration))),
    ],
    metrics: [
      entry("Population", (state) => number(state.city.metrics.population), "District-level demographic totals"),
      entry("Households", (state) => number(state.city.metrics.households), "Average modeled household size"),
      entry("Unemployment", (state) => percent(state.city.metrics.unemploymentPercent), "Labor force without matched jobs"),
      entry("Housing occupancy", (state) => percent(state.city.metrics.housingOccupancyPercent), "Population against housing capacity"),
      entry("Happiness", (state) => percent(state.city.metrics.happiness), "Jobs, goods, services, rent and travel"),
      entry("Annual migration", (state) => signedNumber(sumDistricts(state, (district) => district.annualizedMigration)), "Current conditions annualized"),
    ],
  },
  economy: {
    title: "Goods and money",
    sceneLabel: "Supply, demand and trade",
    summary: (state) => `${percent(state.city.market.localSupplyPercent)} of purchased goods are supplied locally; ${percent(state.city.market.importDependencePercent)} arrive through external connections.`,
    inspector: [
      entry("Food", (state) => marketBalance(state, "food")),
      entry("Consumer goods", (state) => marketBalance(state, "consumerGoods")),
      entry("Industrial materials", (state) => marketBalance(state, "industrialMaterials")),
      entry("Unmet demand", (state) => formatAmount(sumGoods(state.city.market.unmetDemandDaily))),
    ],
    metrics: [
      entry("Household income", (state) => currency(state.city.metrics.householdIncomeDaily), "Wages and senior income each day"),
      entry("Household spending", (state) => currency(state.city.metrics.householdSpendingDaily), "Budget-limited purchases at current prices"),
      entry("Business profit", (state) => currency(state.city.metrics.businessProfitDaily), "Revenue less wages, rent, inputs and transport"),
      entry("Price index", (state) => state.city.market.consumerPriceIndex.toFixed(1), "Food and consumer goods against base prices"),
      entry("Goods imported", (state) => formatAmount(state.city.metrics.goodsImportedDaily), "Bounded external supply delivered each day"),
      entry("Transport cost", (state) => currency(state.city.market.transportCostDaily), "Distance, weight and congestion costs"),
    ],
  },
  infrastructure: {
    title: "Infrastructure networks",
    sceneLabel: "Mobility and utilities",
    summary: (state) => `${number(state.city.links.length)} district links carry ${number(state.city.metrics.dailyTrips)} daily trips while shared networks allocate power, water and waste capacity.`,
    inspector: [
      entry("Power", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.power * 100))),
      entry("Water", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.water * 100))),
      entry("Waste", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.waste * 100))),
      entry("Network links", (state) => number(state.city.links.length)),
    ],
    metrics: [
      entry("Commutes", (state) => number(state.city.metrics.commuteTripsDaily), "Work journeys generated by filled jobs"),
      entry("Shopping", (state) => number(state.city.metrics.shoppingTripsDaily), "Trips generated by household purchases"),
      entry("Freight", (state) => number(state.city.metrics.freightTripsDaily), "Local deliveries, imports and exports"),
      entry("Congestion", (state) => percent(state.city.metrics.congestionPercent), "Private trips against road capacity"),
      entry("Transit share", (state) => percent(state.city.metrics.transitSharePercent), "Demand served by transit capacity"),
      entry("Utilities", (state) => percent(state.city.metrics.utilityCoveragePercent), "Power, water and waste coverage"),
      entry("Waste collected", (state) => percent(state.city.metrics.wasteCollectionPercent), "Collection against generated waste"),
      entry("Maintenance", (state) => currency(state.city.metrics.maintenanceCostDaily), "Daily systems operating cost"),
    ],
  },
  "land-use": {
    title: "Land use and growth",
    sceneLabel: "District zoning and value",
    summary: (state) => `${state.city.districts.length} districts apply terrain, zoning strictness, floor-area limits, housing demand and infrastructure reliability.`,
    inspector: [
      entry("Developed area", (state) => area(sumDistricts(state, (district) => district.developedFloorArea))),
      entry("Zoned capacity", (state) => area(sumDistricts(state, (district) => district.maxFloorArea))),
      entry("Housing units", (state) => number(sumDistricts(state, (district) => district.housingUnits))),
      entry("Average value", (state) => currency(state.city.metrics.averageLandValue)),
    ],
    metrics: [
      entry("Land value", (state) => currency(state.city.metrics.averageLandValue), "Access, services, demand and congestion"),
      entry("Rent index", (state) => state.city.metrics.averageRentIndex.toFixed(2), "Value and occupancy pressure"),
      entry("Housing occupancy", (state) => percent(state.city.metrics.housingOccupancyPercent), "Residents against available units"),
      entry("Developed area", (state) => area(sumDistricts(state, (district) => district.developedFloorArea)), "Current modeled floor area"),
      entry("Zoned capacity", (state) => area(sumDistricts(state, (district) => district.maxFloorArea)), "Maximum permitted floor area"),
      entry("Timeline points", (state) => number(state.city.timeline.length), "Weekly and calendar-boundary history"),
    ],
  },
};

runButton.addEventListener("click", () => {
  simulation.start();
  updateInterface();
});

pauseButton.addEventListener("click", () => {
  simulation.pause();
  updateInterface();
});

resetButton.addEventListener("click", () => {
  simulation.reset();
  updateInterface();
});

for (const tab of layerTabs) {
  tab.addEventListener("click", () => {
    activeLayer = tab.dataset.layer as Layer;
    layerTabs.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === tab)));
    updateInterface();
  });
}

for (const button of horizonButtons) {
  button.addEventListener("click", () => {
    simulation.setTimeHorizon(button.dataset.horizon as TimeHorizon);
    horizonButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    updateInterface();
  });
}

const settings = simulation.getSettings();
bindRange("simulation-speed-control", "simulation-speed-output", settings.simulationSpeed, (value) => `${value.toFixed(1)}x`, (value) => simulation.setSimulationSpeed(value));
bindRange("speed-limit-control", "speed-limit-output", settings.speedLimitMph, (value) => `${value} mph`, (value) => simulation.setSpeedLimitMph(value));
bindRange("signal-cycle-control", "signal-cycle-output", settings.signalCycleSeconds, (value) => `${value}s`, (value) => simulation.setSignalCycleSeconds(value));
bindRange("transit-headway-control", "transit-headway-output", settings.transitHeadwayMinutes, (value) => `${value} min`, (value) => simulation.setTransitHeadwayMinutes(value));
bindRange("road-capacity-control", "road-capacity-output", settings.roadCapacity, (value) => `${value} vehicles`, (value) => simulation.setRoadCapacity(value));
bindRange("utility-capacity-control", "utility-capacity-output", settings.utilityCapacityScale, (value) => percent(value * 100), (value) => simulation.setUtilityCapacityScale(value));
bindRange("zoning-strictness-control", "zoning-strictness-output", settings.zoningStrictness, (value) => percent(value * 100), (value) => simulation.setZoningStrictness(value));

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.render(simulation.getState());
});

function animationFrame(timestamp: number): void {
  const deltaSeconds = (timestamp - previousTimestamp) / 1000;
  previousTimestamp = timestamp;
  simulation.update(deltaSeconds);
  renderer.render(simulation.getState());
  updateInterface();
  window.requestAnimationFrame(animationFrame);
}

function updateInterface(): void {
  const state = simulation.getState();
  const view = views[activeLayer];
  statusPill.dataset.status = state.running ? "running" : state.elapsedSeconds > 0 ? "paused" : "ready";
  statusPill.textContent = state.running ? "Running" : state.elapsedSeconds > 0 ? "Paused" : "Ready";
  runButton.disabled = state.running;
  pauseButton.disabled = !state.running;
  dayOutput.textContent = `Day ${Math.floor(state.metrics.simulatedDays) + 1} · ${capitalize(state.timeHorizon)} horizon`;
  timeOutput.textContent = formatLongDate(state.city.startYear, state.metrics.simulatedDays);
  signalPhase.textContent = state.signalPhase === "vehicles" ? "Vehicles" : "Pedestrians";
  signalTimeRemaining.textContent = state.signalPhaseRemainingSeconds.toFixed(1);
  generatedCommutes.textContent = `${number(state.city.metrics.commuteTripsDaily)}/day`;
  generatedShopping.textContent = `${number(state.city.metrics.shoppingTripsDaily)}/day`;
  generatedPedestrians.textContent = `${number(state.city.metrics.pedestrianTripsDaily)}/day`;
  generatedFreight.textContent = `${number(state.city.metrics.freightTripsDaily)}/day`;
  cityNameOutput.textContent = state.city.name;
  activeLayerLabel.textContent = view.sceneLabel;
  inspectorTitle.textContent = view.title;
  inspectorSummary.textContent = view.summary(state);
  metricsTitle.textContent = view.sceneLabel;

  view.inspector.forEach((display, index) => {
    requireElement(`inspector-label-${index + 1}`).textContent = display.label;
    requireElement(`inspector-value-${index + 1}`).textContent = display.value(state);
  });
  view.metrics.forEach((display, index) => {
    requireElement(`metric-label-${index + 1}`).textContent = display.label;
    requireElement(`metric-value-${index + 1}`).textContent = display.value(state);
    requireElement(`metric-detail-${index + 1}`).textContent = display.detail ?? "";
  });
  renderEvents(state);
}

function renderEvents(state: Readonly<SimulationState>): void {
  eventList.replaceChildren(...state.events.slice(0, 5).map((event) => {
    const item = document.createElement("li");
    item.dataset.severity = event.severity;
    const time = document.createElement("time");
    time.textContent = `Day ${Math.max(1, Math.floor((event.minute - 420) / 1440) + 1)}`;
    const message = document.createElement("span");
    message.textContent = event.message;
    item.append(time, message);
    return item;
  }));
}

function bindRange(
  controlId: string,
  outputId: string,
  initialValue: number,
  format: (value: number) => string,
  apply: (value: number) => void,
): void {
  const control = requireElement<HTMLInputElement>(controlId);
  const output = requireElement<HTMLOutputElement>(outputId);
  const update = (): void => {
    const value = Number(control.value);
    output.value = format(value);
    apply(value);
  };
  control.value = String(initialValue);
  output.value = format(initialValue);
  control.addEventListener("input", update);
}

function entry(label: string, value: DisplayItem["value"], detail?: string): DisplayItem {
  return { label, value, detail };
}

function sumDistricts(state: Readonly<SimulationState>, select: (district: SimulationState["city"]["districts"][number]) => number): number {
  return state.city.districts.reduce((total, district) => total + select(district), 0);
}

function weightedCity(state: Readonly<SimulationState>, select: (district: SimulationState["city"]["districts"][number]) => number): number {
  const population = state.city.metrics.population;
  return population > 0
    ? sumDistricts(state, (district) => select(district) * district.population) / population
    : 0;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function currency(value: number): string {
  const absolute = Math.abs(value);
  const prefix = value < 0 ? "-$" : "$";
  if (absolute >= 1_000_000) return `${prefix}${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${prefix}${(absolute / 1_000).toFixed(1)}K`;
  return `${prefix}${Math.round(absolute).toLocaleString()}`;
}

function marketBalance(
  state: Readonly<SimulationState>,
  good: keyof SimulationState["city"]["market"]["prices"],
): string {
  const market = state.city.market;
  const supply = market.localSupplyDaily[good] + market.importsDaily[good];
  return `$${market.prices[good].toFixed(2)} · ${formatAmount(supply)} / ${formatAmount(market.demandDaily[good])}`;
}

function sumGoods(goods: SimulationState["city"]["market"]["demandDaily"]): number {
  return goods.food + goods.consumerGoods + goods.industrialMaterials;
}

function number(value: number): string {
  return Math.round(value).toLocaleString();
}

function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${number(value)}`;
}

function area(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M m²` : `${number(value)} m²`;
}

function formatAmount(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : Number.isInteger(value) ? number(value) : value.toFixed(1);
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

renderer.resize();
renderer.render(simulation.getState());
updateInterface();
window.requestAnimationFrame(animationFrame);
