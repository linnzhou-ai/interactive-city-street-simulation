import "./styles.css";
import { Simulation } from "./core/simulation";
import { ThreeRenderer } from "./rendering/threeRenderer";
import type { SimulationMetrics, SimulationState } from "./models/types";

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
const inspectorTitle = requireElement<HTMLElement>("inspector-title");
const inspectorSummary = requireElement<HTMLElement>("inspector-summary");
const metricsTitle = requireElement<HTMLElement>("metrics-title");
const eventList = requireElement<HTMLOListElement>("event-list");
const layerTabs = [...document.querySelectorAll<HTMLButtonElement>(".layer-tab")];

const simulation = new Simulation();
const renderer = new ThreeRenderer(canvas);
let previousTimestamp = performance.now();
let activeLayer: Layer = "overview";

const views: Record<Layer, LayerView> = {
  overview: {
    title: "Street health",
    sceneLabel: "Systems overview",
    summary: (state) => state.metrics.utilityCoveragePercent < 85
      ? "Utility limits are reducing building performance."
      : state.metrics.congestionPercent >= 60
        ? "Street demand is producing sustained queues."
        : "Mobility, services and local activity are operating within capacity.",
    inspector: [
      item("Population", (metrics) => number(metrics.population)),
      item("Active trips", (metrics) => number(metrics.activeTrips)),
      item("Jobs filled", (metrics) => percent(metrics.jobFillPercent)),
      item("Utility coverage", (metrics) => percent(metrics.utilityCoveragePercent)),
    ],
    metrics: [
      item("Congestion", (metrics) => percent(metrics.congestionPercent), "Network volume against road capacity"),
      item("Travel time", (metrics) => seconds(metrics.averageVehicleTravelSeconds), "Average completed vehicle trip"),
      item("Household happiness", (metrics) => percent(metrics.householdHappiness), "Schedules, costs and services"),
      item("Goods available", (metrics) => percent(metrics.goodsAvailabilityPercent), "Retail demand supplied"),
      item("Land value", (metrics) => currency(metrics.averageLandValue), "Average developed parcel"),
      item("Utilities", (metrics) => percent(metrics.utilityCoveragePercent), "Power, water and waste"),
    ],
  },
  people: {
    title: "People and routines",
    sceneLabel: "Daily routines",
    summary: (state) => `${state.people.length} residents follow age-specific home, school, work, shopping and leisure schedules.`,
    inspector: [
      { label: "Children", value: (state) => number(countPeople(state, "child")) },
      { label: "Adults", value: (state) => number(countPeople(state, "adult")) },
      { label: "Seniors", value: (state) => number(countPeople(state, "senior")) },
      { label: "Households", value: (state) => number(state.households.length) },
    ],
    metrics: [
      item("Population", (metrics) => number(metrics.population), "Residents with individual schedules"),
      item("Active trips", (metrics) => number(metrics.activeTrips), "Walking, driving and transit"),
      item("Transit riders", (metrics) => number(metrics.transitRidership), "Passengers who boarded"),
      item("Transit wait", (metrics) => minutes(metrics.averageTransitWaitMinutes), "Average passenger queue time"),
      item("Pedestrian wait", (metrics) => seconds(metrics.pedestrianWaitSeconds), "Average completed crossing delay"),
      item("Happiness", (metrics) => percent(metrics.householdHappiness), "Goods, rent and income balance"),
    ],
  },
  economy: {
    title: "Local economy",
    sceneLabel: "Goods and jobs",
    summary: (state) => `${formatAmount(state.economy.goodsProduced)} goods produced, ${formatAmount(state.economy.goodsImported)} imported and ${state.economy.deliveriesCompleted} deliveries dispatched today.`,
    inspector: [
      { label: "Employed", value: (state) => number(state.economy.employedWorkers) },
      { label: "Open jobs", value: (state) => number(state.economy.availableJobs) },
      { label: "Retail sales", value: (state) => currency(state.economy.retailSales * 10) },
      { label: "Business revenue", value: (state) => currency(state.economy.businessRevenue) },
    ],
    metrics: [
      item("Jobs filled", (metrics) => percent(metrics.jobFillPercent), "Employed workers against positions"),
      item("Goods available", (metrics) => percent(metrics.goodsAvailabilityPercent), "Inventory against customer demand"),
      { label: "Produced", value: (state) => formatAmount(state.economy.goodsProduced), detail: "Local industrial output" },
      { label: "Imported", value: (state) => formatAmount(state.economy.goodsImported), detail: "Goods entering the street" },
      { label: "Exported", value: (state) => formatAmount(state.economy.goodsExported), detail: "Surplus leaving the street" },
      { label: "Average rent", value: (state) => currency(state.economy.averageRent), detail: "Daily residential cost" },
    ],
  },
  infrastructure: {
    title: "Infrastructure networks",
    sceneLabel: "Utilities and capacity",
    summary: (state) => `Roads carry ${Math.round(state.infrastructure.roadVolume)} active vehicle-edge movements while utility networks allocate service by demand and priority.`,
    inspector: [
      { label: "Power", value: (state) => percent(state.infrastructure.utilities.power.coveragePercent) },
      { label: "Water", value: (state) => percent(state.infrastructure.utilities.water.coveragePercent) },
      { label: "Waste", value: (state) => percent(state.infrastructure.utilities.waste.coveragePercent) },
      { label: "Road condition", value: (state) => percent(state.infrastructure.roadCondition) },
    ],
    metrics: [
      item("Utility coverage", (metrics) => percent(metrics.utilityCoveragePercent), "Average network delivery"),
      item("Waste collected", (metrics) => percent(metrics.wasteCollectionPercent), "Collection against generated waste"),
      item("Congestion", (metrics) => percent(metrics.congestionPercent), "Volume-to-capacity pressure"),
      item("Traffic flow", (metrics) => `${metrics.trafficFlowPerMinute.toFixed(1)}/min`, "Completed vehicle trips"),
      item("Transit riders", (metrics) => number(metrics.transitRidership), "Passengers transported"),
      item("Safety conflicts", (metrics) => number(metrics.potentialConflicts), "Vehicle-crosswalk proximity events"),
    ],
  },
  "land-use": {
    title: "Land use and growth",
    sceneLabel: "Zoning and land value",
    summary: (state) => `${state.landUse.parcels.length} parcels respect zoning, terrain slope and building-height limits.`,
    inspector: [
      { label: "Growth events", value: (state) => number(state.landUse.growthEvents) },
      { label: "Floor area", value: (state) => number(state.landUse.developedFloorArea) },
      { label: "Permitted area", value: (state) => number(state.landUse.permittedFloorArea) },
      { label: "Average value", value: (state) => currency(state.landUse.averageLandValue) },
    ],
    metrics: [
      item("Land value", (metrics) => currency(metrics.averageLandValue), "Access, amenities and demand"),
      { label: "Residential demand", value: (state) => percent(state.economy.zoneDemand.residential), detail: "Housing suitability signal" },
      { label: "Commercial demand", value: (state) => percent(state.economy.zoneDemand.commercial), detail: "Retail suitability signal" },
      { label: "Industrial demand", value: (state) => percent(state.economy.zoneDemand.industrial), detail: "Production suitability signal" },
      { label: "Developed floors", value: (state) => number(state.landUse.developedFloorArea), detail: "Current built floor area" },
      { label: "Growth", value: (state) => number(state.landUse.growthEvents), detail: "Permitted floor additions" },
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
    for (const candidate of layerTabs) {
      candidate.setAttribute("aria-pressed", String(candidate === tab));
    }
    updateInterface();
  });
}

const settings = simulation.getSettings();
bindRange("simulation-speed-control", "simulation-speed-output", settings.simulationSpeed, (value) => `${value.toFixed(1)}x`, (value) => simulation.setSimulationSpeed(value));
bindRange("vehicle-volume-control", "vehicle-volume-output", settings.vehicleVolume, (value) => `${value}/min`, (value) => simulation.setVehicleVolume(value));
bindRange("pedestrian-volume-control", "pedestrian-volume-output", settings.pedestrianVolume, (value) => `${value}/min`, (value) => simulation.setPedestrianVolume(value));
bindRange("freight-volume-control", "freight-volume-output", settings.freightVolume, (value) => `${value}/min`, (value) => simulation.setFreightVolume(value));
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
  dayOutput.textContent = `Day ${state.day}`;
  timeOutput.textContent = formatClock(state.timeOfDayMinutes);
  signalPhase.textContent = state.signalPhase === "vehicles" ? "Vehicles" : "Pedestrians";
  signalTimeRemaining.textContent = state.signalPhaseRemainingSeconds.toFixed(1);
  activeLayerLabel.textContent = view.sceneLabel;
  inspectorTitle.textContent = view.title;
  inspectorSummary.textContent = view.summary(state);
  metricsTitle.textContent = view.sceneLabel;

  view.inspector.forEach((entry, index) => {
    requireElement(`inspector-label-${index + 1}`).textContent = entry.label;
    requireElement(`inspector-value-${index + 1}`).textContent = entry.value(state);
  });
  view.metrics.forEach((entry, index) => {
    requireElement(`metric-label-${index + 1}`).textContent = entry.label;
    requireElement(`metric-value-${index + 1}`).textContent = entry.value(state);
    requireElement(`metric-detail-${index + 1}`).textContent = entry.detail ?? "";
  });
  renderEvents(state);
}

function renderEvents(state: Readonly<SimulationState>): void {
  const visible = state.events.slice(0, 5);
  eventList.replaceChildren(...visible.map((event) => {
    const item = document.createElement("li");
    item.dataset.severity = event.severity;
    const time = document.createElement("time");
    time.textContent = formatClock(event.minute % 1440);
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

function item(label: string, value: (metrics: SimulationMetrics) => string, detail?: string): DisplayItem {
  return { label, value: (state) => value(state.metrics), detail };
}

function countPeople(state: Readonly<SimulationState>, ageGroup: "child" | "adult" | "senior"): number {
  return state.people.filter((person) => person.ageGroup === ageGroup).length;
}

function formatClock(totalMinutes: number): string {
  const minute = Math.floor(totalMinutes) % 60;
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function seconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

function minutes(value: number): string {
  return `${value.toFixed(1)} min`;
}

function currency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function number(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? number(value) : value.toFixed(1);
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
