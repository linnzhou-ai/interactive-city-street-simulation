import "./styles.css";
import createElement from "lucide/dist/esm/createElement.mjs";
import CarFront from "lucide/dist/esm/icons/car-front.mjs";
import ChartNoAxesCombined from "lucide/dist/esm/icons/chart-no-axes-combined.mjs";
import Landmark from "lucide/dist/esm/icons/landmark.mjs";
import LayoutDashboard from "lucide/dist/esm/icons/layout-dashboard.mjs";
import MapPinned from "lucide/dist/esm/icons/map-pinned.mjs";
import Users from "lucide/dist/esm/icons/users.mjs";
import {
  captureBaseline,
  compareWithBaseline,
  deriveCongestionTripBreakdown,
  deriveBuildingFinancialFlow,
  deriveBuildingTrafficInsight,
  deriveBuildingUtilityInsight,
  deriveHappinessBreakdown,
  deriveMigrationBreakdown,
  derivePersonHappinessInsight,
  derivePersonDailyInsight,
  derivePriceBreakdowns,
  deriveRepresentationSummary,
  type BaselineComparisonRow,
  type BuildingFinancialFlow,
  type InsightContribution,
} from "./core/insights";
import { OUTSIDE_COMMUTER_BUILDING_ID, planRoute, type MobilityNetwork } from "./core/network";
import { explainModeChoice, type MobilityConditions } from "./core/population";
import { Simulation } from "./core/simulation";
import { formatClockTime, formatLongDate } from "./core/timeScale";
import type { TimeHorizon } from "./models/cityTypes";
import type { Building, BuildingConnection, Person, SimulationEvent, SimulationState } from "./models/types";
import {
  ThreeRenderer,
  type SceneSelection,
  type VisibleFlow,
  type VisualLayer,
} from "./rendering/threeRenderer";

type Layer = "overview" | "people" | "economy" | "infrastructure" | "land-use";
type Mode = "overview" | "traffic" | "economy" | "people" | "services" | "land";

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
const settingsButton = requireElement<HTMLButtonElement>("settings-button");
const settingsClose = requireElement<HTMLButtonElement>("settings-close");
const settingsScrim = requireElement<HTMLButtonElement>("settings-scrim");
const settingsDrawer = requireElement<HTMLElement>("settings-drawer");
const statusPill = requireElement<HTMLSpanElement>("status-pill");
const dayOutput = requireElement<HTMLElement>("day-output");
const timeOutput = requireElement<HTMLElement>("time-output");
const hourOutput = requireElement<HTMLTimeElement>("hour-output");
const signalPhase = requireElement<HTMLElement>("signal-phase");
const signalTimeRemaining = requireElement<HTMLElement>("signal-time-remaining");
const activeLayerLabel = requireElement<HTMLElement>("active-layer-label");
const cityNameOutput = requireElement<HTMLElement>("city-name-output");
const representationBadge = requireElement<HTMLElement>("representation-badge");
const inspectorTitle = requireElement<HTMLElement>("inspector-title");
const inspectorSummary = requireElement<HTMLElement>("inspector-summary");
const metricsTitle = requireElement<HTMLElement>("metrics-title");
const eventList = requireElement<HTMLElement>("event-list");
const generatedCommutes = requireElement<HTMLElement>("generated-commutes");
const generatedShopping = requireElement<HTMLElement>("generated-shopping");
const generatedPedestrians = requireElement<HTMLElement>("generated-pedestrians");
const generatedFreight = requireElement<HTMLElement>("generated-freight");
const inspectorPanel = requireElement<HTMLElement>("inspector-panel");
const dashboardPanel = requireElement<HTMLElement>("dashboard-panel");
const modeSystemFlow = requireElement<HTMLElement>("mode-system-flow");
const selectionPanel = requireElement<HTMLElement>("selection-panel");
const selectionKicker = requireElement<HTMLElement>("selection-kicker");
const selectionTitle = requireElement<HTMLElement>("selection-title");
const selectionSummary = requireElement<HTMLElement>("selection-summary");
const selectionVisuals = requireElement<HTMLElement>("selection-visuals");
const selectionFinancialFlow = requireElement<HTMLElement>("selection-financial-flow");
const selectionSystemVisual = requireElement<HTMLElement>("selection-system-visual");
const selectionStats = requireElement<HTMLElement>("selection-stats");
const selectionConnectionsTitle = requireElement<HTMLElement>("selection-connections-title");
const selectionConnections = requireElement<HTMLElement>("selection-connections");
const selectionClose = requireElement<HTMLButtonElement>("selection-close");
const selectionDiagnosis = requireElement<HTMLElement>("selection-diagnosis");
const selectionTimelineSection = requireElement<HTMLElement>("selection-timeline-section");
const selectionTimeline = requireElement<HTMLOListElement>("selection-timeline");
const representationPerson = requireElement<HTMLElement>("representation-person");
const representationBuildings = requireElement<HTMLElement>("representation-buildings");
const representationActivity = requireElement<HTMLElement>("representation-activity");
const causeSection = requireElement<HTMLElement>("cause-section");
const causeList = requireElement<HTMLElement>("cause-list");
const baselineList = requireElement<HTMLElement>("baseline-list");
const timelineMarkers = requireElement<HTMLOListElement>("timeline-markers");
const detailModeOutput = requireElement<HTMLElement>("detail-mode-output");
const flowToggles = [...document.querySelectorAll<HTMLInputElement>(".flow-toggles input")];
const heatLowLabel = requireElement<HTMLElement>("heat-low-label");
const heatHighLabel = requireElement<HTMLElement>("heat-high-label");
const mapLegend = requireElement<HTMLElement>("map-legend");
const mapLegendTitle = requireElement<HTMLElement>("map-legend-title");
const modeLayerMenu = requireElement<HTMLElement>("mode-layer-menu");
const modeRailButtons = [...document.querySelectorAll<HTMLButtonElement>(".mode-rail button")];
const inspectorElements = Array.from({ length: 4 }, (_, index) => ({
  label: requireElement(`inspector-label-${index + 1}`),
  value: requireElement(`inspector-value-${index + 1}`),
}));
const metricElements = Array.from({ length: 6 }, (_, index) => ({
  label: requireElement(`metric-label-${index + 1}`),
  value: requireElement(`metric-value-${index + 1}`),
  detail: requireElement(`metric-detail-${index + 1}`),
}));
const INTERFACE_UPDATE_INTERVAL_MS = 100;

type SimulationRate = "slow" | "standard" | "fast" | "day" | "week";

const SIMULATION_RATES: Record<SimulationRate, { horizon: TimeHorizon; multiplier: number; label: string }> = {
  slow: { horizon: "day", multiplier: 0.5, label: "30 city min/sec" },
  standard: { horizon: "day", multiplier: 1, label: "1 city hour/sec" },
  fast: { horizon: "week", multiplier: 1, label: "6 city hours/sec" },
  day: { horizon: "month", multiplier: 1, label: "1 city day/sec" },
  week: { horizon: "year", multiplier: 1, label: "1 city week/sec" },
};

const simulation = new Simulation();
const baseline = captureBaseline(simulation.getState().city);
let activeSelection: SceneSelection = null;
const renderer = new ThreeRenderer(canvas, (selection) => {
  if (selection !== null) document.body.dataset.mobileInspector = "open";
  activeSelection = selection;
  updateInterface();
});
let previousTimestamp = performance.now();
let previousInterfaceTimestamp = previousTimestamp;
let activeLayer: Layer = "overview";
let activeMode: Mode = "overview";
let activeVisualLayer: VisualLayer = "none";

interface ModeLayerOption {
  label: string;
  layer: Layer;
  visualLayer: VisualLayer;
}

const modeLayers: Record<Mode, readonly ModeLayerOption[]> = {
  overview: [{ label: "Standard", layer: "overview", visualLayer: "none" }],
  traffic: [
    { label: "Congestion", layer: "infrastructure", visualLayer: "congestion" },
    { label: "Pedestrian wait", layer: "infrastructure", visualLayer: "pedestrian-wait" },
    { label: "Freight", layer: "infrastructure", visualLayer: "freight" },
  ],
  economy: [
    { label: "Profit", layer: "economy", visualLayer: "profit" },
    { label: "Goods shortages", layer: "economy", visualLayer: "shortages" },
  ],
  people: [
    { label: "Job access", layer: "people", visualLayer: "jobs" },
    { label: "Migration", layer: "people", visualLayer: "migration" },
  ],
  services: [{ label: "Utilities", layer: "infrastructure", visualLayer: "utilities" }],
  land: [{ label: "Land value", layer: "land-use", visualLayer: "land-value" }],
};

const modeIcons = {
  overview: LayoutDashboard,
  traffic: CarFront,
  economy: ChartNoAxesCombined,
  people: Users,
  services: Landmark,
  land: MapPinned,
} satisfies Record<Mode, readonly unknown[]>;

for (const placeholder of document.querySelectorAll<HTMLElement>("[data-mode-icon]")) {
  const mode = placeholder.dataset.modeIcon as Mode;
  placeholder.replaceWith(createElement(modeIcons[mode]));
}

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
      entry("Moving in / year", (state) => number(state.city.metrics.annualizedMigrationIn)),
      entry("Moving out / year", (state) => number(state.city.metrics.annualizedMigrationOut)),
    ],
    metrics: [
      entry("Population", (state) => number(state.city.metrics.population), "District-level demographic totals"),
      entry("Households", (state) => number(state.city.metrics.households), "Average modeled household size"),
      entry("Moving in", (state) => number(state.city.metrics.annualizedMigrationIn), "Annualized arrivals under current conditions"),
      entry("Moving out", (state) => number(state.city.metrics.annualizedMigrationOut), "Annualized departures under current conditions"),
      entry("Net migration", (state) => signedNumber(state.city.metrics.annualizedNetMigration), "Arrivals less departures per year"),
      entry("Happiness", (state) => percent(state.city.metrics.happiness), "Jobs, goods, services, rent and travel"),
    ],
  },
  economy: {
    title: "Goods and money",
    sceneLabel: "Supply, demand and trade",
    summary: (state) => `${percent(state.city.market.localSupplyPercent)} of purchased goods are supplied locally; ${number(state.economy.externalWorkers)} visible workers commute outside the section.`,
    inspector: [
      entry("Food", (state) => marketBalance(state, "food")),
      entry("Consumer goods", (state) => marketBalance(state, "consumerGoods")),
      entry("Industrial materials", (state) => marketBalance(state, "industrialMaterials")),
      entry("External workers", (state) => number(state.economy.externalWorkers)),
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
      entry("Citywide power", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.power * 100))),
      entry("Citywide water", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.water * 100))),
      entry("Citywide waste service", (state) => percent(weightedCity(state, (district) => district.utilityCoverage.waste * 100))),
      entry("Citywide links", (state) => number(state.city.links.length)),
    ],
    metrics: [
      entry("Commutes", (state) => number(state.city.metrics.commuteTripsDaily), "Work journeys generated by filled jobs"),
      entry("Shopping", (state) => number(state.city.metrics.shoppingTripsDaily), "Trips generated by household purchases"),
      entry("Freight", (state) => number(state.city.metrics.freightTripsDaily), "Local deliveries, imports and exports"),
      entry("Congestion", (state) => percent(state.city.metrics.congestionPercent), "Private trips against road capacity"),
      entry("Transit share", (state) => percent(state.city.metrics.transitSharePercent), "Demand served by transit capacity"),
      entry("Utilities", (state) => percent(state.city.metrics.utilityCoveragePercent), "Power, water and waste coverage"),
      entry("Waste service coverage", (state) => percent(state.city.metrics.wasteCollectionPercent), "Citywide access to waste service"),
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
  activeSelection = null;
  renderer.setSelection(null);
  updateInterface();
});

selectionClose.addEventListener("click", () => {
  closeInspection();
  updateInterface();
});

for (const toggle of flowToggles) {
  toggle.addEventListener("change", () => {
    renderer.setVisibleFlows(flowToggles
      .filter((candidate) => candidate.checked)
      .map((candidate) => candidate.value as VisibleFlow));
    updateInterface();
  });
}

settingsButton.addEventListener("click", () => setSettingsOpen(settingsDrawer.dataset.open !== "true"));
settingsClose.addEventListener("click", () => setSettingsOpen(false));
settingsScrim.addEventListener("click", () => setSettingsOpen(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsDrawer.dataset.open === "true") setSettingsOpen(false);
  else if (event.key === "Escape" && !modeLayerMenu.hidden) modeLayerMenu.hidden = true;
  else if (event.key === "Escape" && activeSelection !== null) closeInspection();
});

for (const button of modeRailButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as Mode;
    const wasActive = activeMode === mode;
    const options = modeLayers[mode];
    if (!wasActive) setMapLayer(mode, options[0]!);
    if (options.length > 1) {
      renderModeLayerMenu(mode);
      modeLayerMenu.hidden = wasActive ? !modeLayerMenu.hidden : false;
    } else {
      modeLayerMenu.hidden = true;
    }
  });
}

function setMapLayer(mode: Mode, option: Readonly<ModeLayerOption>): void {
  activeMode = mode;
  activeLayer = option.layer;
  activeVisualLayer = option.visualLayer;
  renderer.setVisualLayer(activeVisualLayer);
  updateHeatLegend(activeVisualLayer);
  setText(mapLegendTitle, option.label);
  setText(activeLayerLabel, option.label);
  mapLegend.hidden = activeVisualLayer === "none";
  modeRailButtons.forEach((candidate) => {
    candidate.setAttribute("aria-pressed", String(candidate.dataset.mode === activeMode));
  });
  updateInterface();
}

function renderModeLayerMenu(mode: Mode): void {
  const options = modeLayers[mode];
  modeLayerMenu.dataset.mode = mode;
  modeLayerMenu.replaceChildren(...options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.visualLayer === activeVisualLayer));
    button.addEventListener("click", () => {
      setMapLayer(mode, option);
      modeLayerMenu.hidden = true;
    });
    return button;
  }));
}

const settings = simulation.getSettings();
const simulationRateControl = requireElement<HTMLSelectElement>("simulation-rate-control");
const dayNightControl = requireElement<HTMLInputElement>("day-night-control");
const speedLimitControl = bindRange("speed-limit-control", "speed-limit-output", settings.speedLimitMph, (value) => `${value} mph`, (value) => simulation.setSpeedLimitMph(value));
const signalCycleControl = bindRange("signal-cycle-control", "signal-cycle-output", settings.signalCycleSeconds, (value) => `${value}s`, (value) => simulation.setSignalCycleSeconds(value));
const transitHeadwayControl = bindRange("transit-headway-control", "transit-headway-output", settings.transitHeadwayMinutes, (value) => `${value} min`, (value) => simulation.setTransitHeadwayMinutes(value));
const roadCapacityControl = bindRange("road-capacity-control", "road-capacity-output", settings.roadCapacity, (value) => `${value} vehicles`, (value) => simulation.setRoadCapacity(value));
const utilityCapacityControl = bindRange("utility-capacity-control", "utility-capacity-output", settings.utilityCapacityScale, (value) => percent(value * 100), (value) => simulation.setUtilityCapacityScale(value));
const zoningStrictnessControl = bindRange("zoning-strictness-control", "zoning-strictness-output", settings.zoningStrictness, (value) => percent(value * 100), (value) => simulation.setZoningStrictness(value));

simulationRateControl.value = simulationRateForSettings(settings.timeHorizon, settings.simulationSpeed);
simulationRateControl.addEventListener("change", () => {
  const rate = SIMULATION_RATES[simulationRateControl.value as SimulationRate];
  simulation.setTimeHorizon(rate.horizon);
  simulation.setSimulationSpeed(rate.multiplier);
  updateInterface();
});
dayNightControl.addEventListener("change", () => {
  renderer.setDayNightCycleEnabled(dayNightControl.checked);
  renderer.render(simulation.getState());
  updateControlEffects(simulation.getState());
});

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.render(simulation.getState());
});

function animationFrame(timestamp: number): void {
  const deltaSeconds = (timestamp - previousTimestamp) / 1000;
  previousTimestamp = timestamp;
  simulation.update(deltaSeconds);
  renderer.render(simulation.getState());
  if (timestamp - previousInterfaceTimestamp >= INTERFACE_UPDATE_INTERVAL_MS) {
    previousInterfaceTimestamp = timestamp;
    updateInterface();
  }
  window.requestAnimationFrame(animationFrame);
}

function updateInterface(): void {
  const state = simulation.getState();
  const view = views[activeLayer];
  const selectedMapLayer = modeLayers[activeMode].find((option) => option.visualLayer === activeVisualLayer)
    ?? modeLayers[activeMode][0]!;
  statusPill.dataset.status = state.running ? "running" : state.elapsedSeconds > 0 ? "paused" : "ready";
  setText(statusPill, state.running ? "Running" : state.elapsedSeconds > 0 ? "Paused" : "Ready");
  runButton.disabled = state.running;
  pauseButton.disabled = !state.running;
  setText(dayOutput, `Day ${Math.floor(state.metrics.simulatedDays) + 1} · ${selectedSimulationRate().label}`);
  setText(timeOutput, formatLongDate(state.city.startYear, state.metrics.simulatedDays));
  const clockTime = formatClockTime(state.timeOfDayMinutes);
  setText(hourOutput, clockTime);
  hourOutput.dateTime = clockTime;
  setText(signalPhase, state.signalPhase === "vehicles" ? "Vehicles" : "Pedestrians");
  setText(signalTimeRemaining, state.signalPhaseRemainingSeconds.toFixed(1));
  setText(generatedCommutes, `${number(state.city.metrics.commuteTripsDaily)}/day`);
  setText(generatedShopping, `${number(state.city.metrics.shoppingTripsDaily)}/day`);
  setText(generatedPedestrians, `${number(state.city.metrics.pedestrianTripsDaily)}/day`);
  setText(generatedFreight, `${number(state.city.metrics.freightTripsDaily)}/day`);
  setText(cityNameOutput, state.city.name);
  setText(activeLayerLabel, selectedMapLayer.label);
  setText(detailModeOutput, `${capitalize(renderer.getDetailMode())} detail`);
  setText(inspectorTitle, view.title);
  setText(inspectorSummary, view.summary(state));
  setText(metricsTitle, view.sceneLabel);
  view.inspector.forEach((display, index) => {
    const elements = inspectorElements[index]!;
    setText(elements.label, display.label);
    setText(elements.value, display.value(state));
  });
  view.metrics.slice(0, 6).forEach((display, index) => {
    const elements = metricElements[index]!;
    setText(elements.label, display.label);
    setText(elements.value, display.value(state));
    setText(elements.detail, display.detail ?? "");
  });
  renderRepresentation(state);
  renderModeSystemFlow(state);
  renderCauses(state);
  renderBaseline(state);
  renderTimelineMarkers(state);
  renderEvents(state);
  updateControlEffects(state);
  renderSelection(state);
}

function renderRepresentation(state: Readonly<SimulationState>): void {
  const summary = deriveRepresentationSummary(state.city, state.people, state.buildings);
  const movingAgents = state.vehicles.filter((vehicle) => !vehicle.completed).length
    + state.pedestrians.filter((pedestrian) => !pedestrian.completed).length;
  setText(representationPerson, summary.peopleLabel);
  setText(representationBadge, summary.peopleLabel);
  setText(representationBuildings, summary.citywideLabel);
  setText(
    representationActivity,
    `${number(movingAgents)} visible moving agents sample ${number(state.city.metrics.dailyTrips)} citywide trips per day.`,
  );
}

function renderModeSystemFlow(state: Readonly<SimulationState>): void {
  modeSystemFlow.hidden = false;
  if (activeMode === "traffic") {
    if (activeVisualLayer === "pedestrian-wait") {
      const queued = state.pedestrians.filter((pedestrian) => pedestrian.waitSeconds > 0.5).length;
      renderModeEquation(
        "Visible street sample",
        [
          ["Walking demand", number(state.pedestrians.length)],
          ["Waiting", number(queued)],
          ["Average wait", `${Math.round(state.metrics.pedestrianWaitSeconds)} sec`],
        ],
        "Pedestrian queues are measured only for the detailed intersection, not the full city section.",
      );
      return;
    }
    if (activeVisualLayer === "freight") {
      const activeTrucks = state.vehicles.filter((vehicle) => !vehicle.completed && vehicle.vehicleType === "truck").length;
      renderModeEquation(
        "Freight activity",
        [
          ["Citywide demand", `${number(state.city.metrics.freightTripsDaily)}/day`],
          ["Visible trucks", number(activeTrucks)],
          ["Deliveries", number(state.economy.deliveriesCompleted)],
        ],
        "Citywide freight demand generates a smaller visible sample of street deliveries.",
      );
      return;
    }
    const roadDemand = deriveCongestionTripBreakdown(state.city).roadTripsDaily;
    const roadCapacity = state.city.links.reduce((total, link) => total + link.roadCapacityDaily, 0)
      * roadCapacityControl.valueAsNumber / 20;
    const queuedVehicles = state.vehicles.filter((vehicle) => !vehicle.completed && vehicle.waitingSeconds > 0.5);
    const averageWait = average(queuedVehicles.map((vehicle) => vehicle.waitingSeconds));
    renderModeEquation(
      "Traffic accounting",
      [
        ["Citywide demand", `${number(roadDemand)}/day`],
        ["Citywide capacity", `${number(roadCapacity)}/day`],
        ["Citywide congestion", percent(state.city.metrics.congestionPercent)],
      ],
      `Visible street sample: ${number(state.vehicles.length)} active vehicles, ${number(queuedVehicles.length)} queued, ${Math.round(averageWait)} sec average queue delay.`,
    );
    return;
  }

  if (activeMode === "services") {
    const heading = document.createElement("strong");
    const rows = document.createElement("div");
    const note = document.createElement("p");
    heading.textContent = "Detailed utility networks";
    rows.className = "utility-flow-rows";
    rows.replaceChildren(...(["power", "water", "waste"] as const).map((kind) => {
      const utility = state.infrastructure.utilities[kind];
      const row = document.createElement("article");
      const title = document.createElement("strong");
      const equation = document.createElement("div");
      title.textContent = `${capitalize(kind)} · ${utility.sourceName}`;
      equation.className = "utility-flow-equation";
      const values: ReadonlyArray<readonly [string, string]> = [
        ["Demand", formatAmount(utility.demand)],
        ["Losses", percent(utility.lossPercent)],
        ["Delivered", formatAmount(utility.delivered)],
        ["Shortfall", formatAmount(Math.max(0, utility.demand - utility.delivered))],
      ];
      values.forEach(([label, value], index) => {
        if (index > 0) {
          const arrow = document.createElement("i");
          arrow.textContent = "→";
          equation.append(arrow);
        }
        const item = document.createElement("span");
        const itemLabel = document.createElement("small");
        const itemValue = document.createElement("b");
        itemLabel.textContent = label;
        itemValue.textContent = value;
        item.append(itemLabel, itemValue);
        equation.append(item);
      });
      row.append(title, equation);
      return row;
    }));
    note.textContent = `Visible street coverage ${percent(state.metrics.utilityCoveragePercent)} · citywide service coverage ${percent(state.city.metrics.utilityCoveragePercent)}.`;
    modeSystemFlow.replaceChildren(heading, rows, note);
    return;
  }

  modeSystemFlow.hidden = true;
  modeSystemFlow.replaceChildren();
}

function renderModeEquation(
  titleText: string,
  values: ReadonlyArray<readonly [string, string]>,
  noteText: string,
): void {
  const title = document.createElement("strong");
  const equation = document.createElement("div");
  const note = document.createElement("p");
  title.textContent = titleText;
  equation.className = "mode-equation";
  values.forEach(([label, value], index) => {
    if (index > 0) {
      const arrow = document.createElement("i");
      arrow.textContent = "→";
      equation.append(arrow);
    }
    const node = document.createElement("span");
    const nodeLabel = document.createElement("small");
    const nodeValue = document.createElement("b");
    nodeLabel.textContent = label;
    nodeValue.textContent = value;
    node.append(nodeLabel, nodeValue);
    equation.append(node);
  });
  note.textContent = noteText;
  modeSystemFlow.replaceChildren(title, equation, note);
}

function renderCauses(state: Readonly<SimulationState>): void {
  if (activeMode === "services") {
    causeSection.hidden = true;
    return;
  }
  causeSection.hidden = false;
  let contributions: InsightContribution[];
  let formatValue: (value: number) => string;
  if (activeLayer === "people" || activeLayer === "land-use") {
    contributions = deriveMigrationBreakdown(state.city).contributions;
    formatValue = (value) => `${signedNumber(value)}/yr`;
  } else if (activeLayer === "economy") {
    contributions = derivePriceBreakdowns(state.city).consumerGoods.contributions;
    formatValue = (value) => signedCurrency(value);
  } else if (activeLayer === "infrastructure") {
    const breakdown = deriveCongestionTripBreakdown(state.city);
    contributions = breakdown.rows.filter((row) => row.contributesToRoadCongestion).map((row) => ({
      key: row.category,
      label: row.label.replace("Private ", ""),
      value: breakdown.roadTripsDaily > 0 ? row.tripsDaily / breakdown.roadTripsDaily * 100 : 0,
      explanation: `${number(row.tripsDaily)} citywide daily trips use road capacity.`,
    }));
    formatValue = (value) => percent(value);
  } else {
    contributions = deriveHappinessBreakdown(state.city).contributions;
    formatValue = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
  }

  const displayedContributions = contributions
    .filter((row) => row.key !== "reconciliation")
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 5);
  const renderKey = `${activeLayer}:${displayedContributions.map((row) => `${row.key}:${row.value.toFixed(3)}`).join("|")}`;
  if (causeList.dataset.renderKey === renderKey) return;
  causeList.dataset.renderKey = renderKey;
  const maximum = Math.max(1, ...displayedContributions.map((row) => Math.abs(row.value)));
  causeList.replaceChildren(...displayedContributions.map((contribution) => {
    const row = document.createElement("div");
    row.title = contribution.explanation;
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    const meter = document.createElement("span");
    const fill = document.createElement("i");
    term.textContent = contribution.label;
    value.textContent = formatValue(contribution.value);
    meter.className = "cause-meter";
    fill.style.setProperty("--cause-width", `${Math.max(1, Math.abs(contribution.value) / maximum * 100)}%`);
    fill.style.setProperty("--cause-color", contribution.value < 0 ? "#e16d61" : "#75dabc");
    meter.append(fill);
    row.append(term, value, meter);
    return row;
  }));
}

function renderBaseline(state: Readonly<SimulationState>): void {
  const displayedKeys = new Set<BaselineComparisonRow["key"]>([
    "population",
    "grossCityProductDaily",
    "congestionPercent",
    "averageLandValue",
  ]);
  const rows = compareWithBaseline(state.city, baseline).filter((row) => displayedKeys.has(row.key));
  const renderKey = rows.map((row) => `${row.key}:${row.current.toFixed(2)}`).join("|");
  if (baselineList.dataset.renderKey === renderKey) return;
  baselineList.dataset.renderKey = renderKey;
  baselineList.replaceChildren(...rows.map((comparison) => {
    const row = document.createElement("div");
    const label = document.createElement("span");
    const current = document.createElement("strong");
    const original = document.createElement("span");
    const difference = document.createElement("em");
    row.className = "baseline-row";
    label.textContent = comparison.label;
    current.textContent = formatBaselineValue(comparison, comparison.current);
    original.textContent = formatBaselineValue(comparison, comparison.baseline);
    difference.textContent = formatBaselineDifference(comparison);
    difference.dataset.direction = comparison.difference < 0 ? "down" : comparison.difference > 0 ? "up" : "flat";
    row.append(label, current, original, difference);
    return row;
  }));
}

function renderTimelineMarkers(state: Readonly<SimulationState>): void {
  const points = state.city.timeline.filter((point) => point.day > baseline.elapsedDays).slice(-3);
  const values = points.map((point) => {
    const populationDifference = point.population - baseline.values.population;
    const outputDifference = point.grossCityProductDaily - baseline.values.grossCityProductDaily;
    const congestionDifference = point.congestionPercent - baseline.values.congestionPercent;
    return `${formatLongDate(state.city.startYear, point.day)}: population ${signedNumber(populationDifference)}, output ${signedCurrency(outputDifference)}, congestion ${signedFixed(congestionDifference)} pts.`;
  });
  const rows = values.length > 0 ? values : ["Run the simulation to add control comparison markers."];
  const renderKey = rows.join("|");
  if (timelineMarkers.dataset.renderKey === renderKey) return;
  timelineMarkers.dataset.renderKey = renderKey;
  timelineMarkers.replaceChildren(...rows.map((value) => {
    const row = document.createElement("li");
    row.textContent = value;
    return row;
  }));
}

function renderSelection(state: Readonly<SimulationState>): void {
  inspectorPanel.dataset.view = activeSelection === null ? "mode" : "selection";
  inspectorPanel.hidden = false;
  selectionPanel.hidden = activeSelection === null;
  dashboardPanel.hidden = activeSelection !== null;
  if (activeSelection === null) return;

  if (activeSelection.kind === "building") {
    const building = state.buildings.find((candidate) => candidate.id === activeSelection?.id);
    if (building === undefined) {
      clearSelection();
      return;
    }
    renderBuildingSelection(building, state);
    return;
  }

  const person = state.people.find((candidate) => candidate.id === activeSelection?.id);
  if (person === undefined) {
    clearSelection();
    return;
  }
  renderPersonSelection(person, state);
}

function renderBuildingSelection(building: Building, state: Readonly<SimulationState>): void {
  const inspectorNames: Record<Building["buildingUse"], string> = {
    housing: "Residential property",
    retail: "Retail business",
    industrial: "Industrial employer",
    school: "School service",
    library: "Library service",
    clinic: "Health service",
    park: "Public amenity",
  };
  selectionKicker.textContent = inspectorNames[building.buildingUse];
  selectionTitle.textContent = building.name;
  const calculatedWages = building.employeeIds.reduce((total, personId) => {
    const employee = state.people.find((person) => person.id === personId);
    return total + (employee?.dailyWage ?? 0);
  }, 0);
  const accounting = building.accounting ?? {
    operatingModel: building.zone === "residential" ? "housing" : "business",
    operatingStatus: "closed",
    serviceKind: "none",
    requiredWorkers: building.jobCapacity,
    staffingRatio: 0,
    averageWage: building.wageOffer ?? 0,
    unitPrice: building.retailPrice ?? 0,
    cashReserve: building.cashReserve ?? 0,
    workforceChange: 0,
    lossStreak: building.unprofitableDays ?? 0,
    dailyWages: calculatedWages,
    rentIncome: 0,
    occupancyCost: building.zone === "commercial" || building.zone === "industrial" ? building.rent : 0,
    maintenanceCost: 0,
    utilityCost: 0,
    goodsReceived: 0,
    localSupplies: 0,
    importedSupplies: 0,
    supplyCost: 0,
    transportCost: 0,
    goodsSold: 0,
    revenue: 0,
    operatingCost: calculatedWages + building.rent,
    profit: -(calculatedWages + building.rent),
    customers: 0,
    municipalFunding: 0,
    serviceDemand: 0,
    serviceDelivered: 0,
    serviceQuality: 0,
  };
  const averageWage = building.employeeIds.length > 0
    ? accounting.dailyWages / building.employeeIds.length
    : 0;
  const utilitySummary = `Power ${percent(building.utilityService.power * 100)}, water ${percent(building.utilityService.water * 100)}, waste ${percent(building.utilityService.waste * 100)}`;
  const commonBusinessRows: ReadonlyArray<readonly [string, string]> = [
    ["Operating status", capitalize(accounting.operatingStatus)],
    ["Employees", `${building.employeeIds.length} / ${building.jobCapacity}`],
    ["Average daily wage", currency(averageWage || accounting.averageWage)],
    ["Workforce change", signedNumber(accounting.workforceChange)],
  ];
  const tenantArrears = state.households
    .filter((household) => household.homeBuildingId === building.id)
    .reduce((total, household) => total + household.rentArrears, 0);
  renderBuildingVisuals(building, accounting);
  renderBuildingFinancialFlow(building, accounting);
  if (activeMode === "traffic") renderBuildingTrafficVisual(building, state);
  else renderBuildingUtilityVisual(building);

  switch (building.buildingUse) {
    case "housing":
      selectionSummary.textContent = `${building.floors}-floor housing property. ${utilitySummary}.`;
      renderStatRows([
        ["Residents", `${building.residentIds.length} / ${building.residentCapacity}`],
        ["Occupancy", percent(building.residentIds.length / Math.max(1, building.residentCapacity) * 100)],
        ["Daily asking rent", currency(building.rent)],
        ["Tenant arrears", currency(tenantArrears)],
        ["Rent collected", currency(accounting.rentIncome)],
        ["Maintenance and utilities", currency(accounting.maintenanceCost + accounting.utilityCost)],
        ["Property net income", currency(accounting.profit)],
      ]);
      break;
    case "retail":
      selectionSummary.textContent = `Customer-facing shop operating at ${percent(building.efficiency * 100)} efficiency. ${utilitySummary}.`;
      renderStatRows([
        ...commonBusinessRows,
        ["Selling price", currency(accounting.unitPrice)],
        ["Customers today", number(accounting.customers)],
        ["Units sold", `${formatAmount(accounting.goodsSold)} of ${formatAmount(building.goodsInventory + accounting.goodsSold)} available`],
        ["Local / imported supply", `${formatAmount(accounting.localSupplies)} / ${formatAmount(accounting.importedSupplies)}`],
        ["Revenue / operating cost", `${currency(accounting.revenue)} / ${currency(accounting.operatingCost)}`],
        ["Operating profit", currency(accounting.profit)],
        ["Cash reserve", currency(accounting.cashReserve)],
      ]);
      break;
    case "industrial":
      selectionSummary.textContent = `Goods producer with ${formatAmount(building.goodsInventory)} units in inventory. ${utilitySummary}.`;
      renderStatRows([
        ...commonBusinessRows,
        ["Production capacity", `${formatAmount(building.productionRate)} units/day`],
        ["Goods produced or received", formatAmount(accounting.goodsReceived)],
        ["Goods shipped", formatAmount(accounting.goodsSold)],
        ["Inventory", formatAmount(building.goodsInventory)],
        ["Supply and transport", currency(accounting.supplyCost + accounting.transportCost)],
        ["Revenue / operating cost", `${currency(accounting.revenue)} / ${currency(accounting.operatingCost)}`],
        ["Operating profit", currency(accounting.profit)],
        ["Cash reserve", currency(accounting.cashReserve)],
      ]);
      break;
    case "school":
      selectionSummary.textContent = `Education facility funded to serve local students. ${utilitySummary}.`;
      renderServiceRows(building, accounting, "Students served", "Education coverage");
      break;
    case "library":
      selectionSummary.textContent = `Community learning facility providing library access. ${utilitySummary}.`;
      renderServiceRows(building, accounting, "Visits served", "Library coverage");
      break;
    case "clinic":
      selectionSummary.textContent = `Health facility treating residents within available staff and utility capacity. ${utilitySummary}.`;
      renderServiceRows(building, accounting, "Patients served", "Health coverage");
      break;
    case "park":
      selectionSummary.textContent = `Public recreation space maintained for neighborhood visits. ${utilitySummary}.`;
      renderServiceRows(building, accounting, "Recreation visits", "Amenity coverage");
      break;
  }
  selectionTimelineSection.hidden = true;
  setText(selectionDiagnosis, diagnoseBuilding(building));

  selectionConnectionsTitle.textContent = "Connection totals";
  const buildingById = new Map(state.buildings.map((candidate) => [candidate.id, candidate]));
  const relationships = state.buildingConnections.filter(
    (connection) => connection.fromBuildingId === building.id || connection.toBuildingId === building.id,
  );
  renderConnectionGroups(buildBuildingConnectionGroups(building, relationships, buildingById));
}

function renderServiceRows(
  building: Readonly<Building>,
  accounting: NonNullable<Building["accounting"]>,
  deliveredLabel: string,
  coverageLabel: string,
): void {
  renderStatRows([
    ["Operating status", capitalize(accounting.operatingStatus)],
    ["Staff", `${building.employeeIds.length} / ${building.jobCapacity}`],
    [deliveredLabel, `${formatAmount(accounting.serviceDelivered)} / ${formatAmount(accounting.serviceDemand)} demand`],
    [coverageLabel, percent(accounting.serviceQuality * 100)],
    ["Daily staff wages", currency(accounting.dailyWages)],
    ["Maintenance and utilities", currency(accounting.maintenanceCost + accounting.utilityCost)],
    ["Municipal funding", currency(accounting.municipalFunding)],
    ["Funding balance", currency(accounting.municipalFunding - accounting.operatingCost)],
  ]);
}

interface VisualSummary {
  label: string;
  value: string;
  detail: string;
  progress?: number;
  tone?: "positive" | "warning" | "negative" | "neutral";
}

function renderBuildingVisuals(
  building: Readonly<Building>,
  accounting: NonNullable<Building["accounting"]>,
): void {
  const staffing = building.jobCapacity > 0 ? building.employeeIds.length / building.jobCapacity * 100 : 100;
  const utilityCoverage = (building.utilityService.power + building.utilityService.water + building.utilityService.waste) / 3 * 100;
  const financialTone = accounting.profit > 0 ? "positive" : accounting.profit < 0 ? "negative" : "neutral";
  const workforce: VisualSummary = {
    label: accounting.operatingModel === "civic" || accounting.operatingModel === "amenity" ? "Staffing" : "Workforce",
    value: `${building.employeeIds.length} / ${building.jobCapacity}`,
    detail: `${percent(staffing)} of positions filled`,
    progress: staffing,
    tone: staffing >= 80 ? "positive" : staffing >= 50 ? "warning" : "negative",
  };
  const utilities: VisualSummary = {
    label: "Utilities",
    value: percent(utilityCoverage),
    detail: "Power, water and waste",
    progress: utilityCoverage,
    tone: utilityCoverage >= 90 ? "positive" : utilityCoverage >= 70 ? "warning" : "negative",
  };

  if (building.buildingUse === "housing") {
    const occupancy = building.residentIds.length / Math.max(1, building.residentCapacity) * 100;
    renderVisualSummaries([
      {
        label: "Occupancy",
        value: percent(occupancy),
        detail: `${building.residentIds.length} of ${building.residentCapacity} resident places`,
        progress: occupancy,
        tone: occupancy >= 85 ? "positive" : occupancy >= 55 ? "warning" : "negative",
      },
      {
        label: "Rent collected",
        value: currency(accounting.rentIncome),
        detail: `${currency(building.rent)} asking rent per day`,
        tone: accounting.rentIncome > 0 ? "positive" : "warning",
      },
      {
        label: "Net income",
        value: signedCurrency(accounting.profit),
        detail: "After maintenance and utilities",
        tone: financialTone,
      },
      utilities,
    ]);
    return;
  }

  if (building.buildingUse === "retail") {
    const available = building.goodsInventory + accounting.goodsSold;
    const sellThrough = accounting.goodsSold / Math.max(1, available) * 100;
    const received = accounting.localSupplies + accounting.importedSupplies;
    const localShare = accounting.localSupplies / Math.max(1, received) * 100;
    renderVisualSummaries([
      workforce,
      {
        label: "Sales",
        value: formatAmount(accounting.goodsSold),
        detail: `${number(accounting.customers)} customers today`,
        progress: sellThrough,
        tone: sellThrough >= 65 ? "positive" : sellThrough >= 30 ? "warning" : "negative",
      },
      {
        label: "Local supply",
        value: percent(localShare),
        detail: `${formatAmount(accounting.localSupplies)} local · ${formatAmount(accounting.importedSupplies)} imported`,
        progress: localShare,
        tone: localShare >= 60 ? "positive" : "warning",
      },
      {
        label: "Profit",
        value: signedCurrency(accounting.profit),
        detail: `${currency(accounting.revenue)} revenue`,
        tone: financialTone,
      },
    ]);
    return;
  }

  if (building.buildingUse === "industrial") {
    const output = accounting.goodsReceived / Math.max(1, building.productionRate) * 100;
    renderVisualSummaries([
      workforce,
      {
        label: "Output",
        value: formatAmount(accounting.goodsReceived),
        detail: `${formatAmount(building.productionRate)} unit daily capacity`,
        progress: output,
        tone: output >= 75 ? "positive" : output >= 40 ? "warning" : "negative",
      },
      {
        label: "Inventory",
        value: formatAmount(building.goodsInventory),
        detail: `${formatAmount(accounting.goodsSold)} shipped today`,
        tone: building.goodsInventory > 0 ? "neutral" : "warning",
      },
      {
        label: "Profit",
        value: signedCurrency(accounting.profit),
        detail: `${currency(accounting.revenue)} revenue`,
        tone: financialTone,
      },
    ]);
    return;
  }

  const demandServed = accounting.serviceDelivered / Math.max(1, accounting.serviceDemand) * 100;
  const fundingBalance = accounting.municipalFunding - accounting.operatingCost;
  renderVisualSummaries([
    workforce,
    {
      label: "Demand served",
      value: percent(demandServed),
      detail: `${formatAmount(accounting.serviceDelivered)} of ${formatAmount(accounting.serviceDemand)} visits`,
      progress: demandServed,
      tone: demandServed >= 80 ? "positive" : demandServed >= 50 ? "warning" : "negative",
    },
    {
      label: "Service quality",
      value: percent(accounting.serviceQuality * 100),
      detail: "Staffing and utilities combined",
      progress: accounting.serviceQuality * 100,
      tone: accounting.serviceQuality >= 0.8 ? "positive" : accounting.serviceQuality >= 0.5 ? "warning" : "negative",
    },
    {
      label: "Funding balance",
      value: signedCurrency(fundingBalance),
      detail: `${currency(accounting.municipalFunding)} municipal funding`,
      tone: fundingBalance >= 0 ? "positive" : "negative",
    },
  ]);
}

function renderVisualSummaries(items: readonly VisualSummary[]): void {
  const renderKey = JSON.stringify(items);
  if (selectionVisuals.dataset.renderKey === renderKey) return;
  selectionVisuals.dataset.renderKey = renderKey;
  selectionVisuals.replaceChildren(...items.map((item) => {
    const card = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const detail = document.createElement("small");
    card.dataset.tone = item.tone ?? "neutral";
    label.textContent = item.label;
    value.textContent = item.value;
    detail.textContent = item.detail;
    card.append(label, value);
    if (item.progress !== undefined) {
      const meter = document.createElement("div");
      const fill = document.createElement("i");
      meter.className = "visual-meter";
      fill.style.setProperty("--visual-progress", `${Math.max(0, Math.min(100, item.progress))}%`);
      meter.append(fill);
      card.append(meter);
    }
    card.append(detail);
    return card;
  }));
}

function renderBuildingFinancialFlow(
  building: Readonly<Building>,
  accounting: NonNullable<Building["accounting"]>,
): void {
  const flow = deriveBuildingFinancialFlow(building, accounting);
  if (flow === null) {
    selectionFinancialFlow.hidden = true;
    selectionFinancialFlow.removeAttribute("data-render-key");
    selectionFinancialFlow.replaceChildren();
    return;
  }

  selectionFinancialFlow.hidden = false;
  const renderKey = JSON.stringify(flow);
  if (selectionFinancialFlow.dataset.renderKey === renderKey) return;
  selectionFinancialFlow.dataset.renderKey = renderKey;

  const heading = document.createElement("div");
  const title = document.createElement("strong");
  const equation = document.createElement("small");
  heading.className = "financial-flow-heading";
  title.textContent = "Daily financial flow";
  equation.textContent = `${flow.revenueLabel} - costs = ${flow.resultLabel.toLowerCase()}`;
  heading.append(title, equation);

  const chart = document.createElement("div");
  chart.className = "financial-flow-chart";
  const maximum = Math.max(flow.revenue, flow.costs, Math.abs(flow.profit), 1);
  const nodes: ReadonlyArray<{
    kind: "revenue" | "costs" | "result";
    label: string;
    value: number;
  }> = [
    { kind: "revenue", label: flow.revenueLabel, value: flow.revenue },
    { kind: "costs", label: "Costs", value: flow.costs },
    { kind: "result", label: flow.resultLabel, value: flow.profit },
  ];

  nodes.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement("span");
      arrow.className = "financial-flow-arrow";
      arrow.textContent = "\u2192";
      arrow.setAttribute("aria-hidden", "true");
      chart.append(arrow);
    }

    const node = document.createElement("div");
    const label = document.createElement("span");
    const amount = document.createElement("strong");
    const meter = document.createElement("div");
    const fill = document.createElement("div");
    node.className = "financial-flow-node";
    node.dataset.kind = item.kind;
    if (item.kind === "result") node.dataset.tone = item.value < 0 ? "negative" : "positive";
    label.textContent = item.label;
    amount.textContent = item.kind === "result" ? signedCurrency(item.value) : currency(item.value);
    meter.className = "financial-flow-meter";
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `${item.label}: ${currency(item.value)}`);
    fill.className = "financial-flow-fill";
    fill.style.setProperty("--financial-width", `${item.value === 0 ? 0 : Math.max(5, Math.abs(item.value) / maximum * 100)}%`);
    if (item.kind === "costs") appendCostSegments(fill, flow);
    meter.append(fill);
    node.append(label, amount, meter);
    chart.append(node);
  });

  const costSummary = document.createElement("p");
  const largestCost = [...flow.costSegments].sort((left, right) => right.value - left.value)[0];
  costSummary.className = "financial-flow-summary";
  costSummary.textContent = largestCost === undefined
    ? "No operating costs recorded today."
    : `Largest cost: ${largestCost.label} ${currency(largestCost.value)} (${percent(largestCost.sharePercent)}).`;
  selectionFinancialFlow.replaceChildren(heading, chart, costSummary);
}

function appendCostSegments(container: HTMLElement, flow: Readonly<BuildingFinancialFlow>): void {
  container.replaceChildren(...flow.costSegments.map((segment) => {
    const bar = document.createElement("i");
    bar.dataset.segment = segment.key;
    bar.style.setProperty("--cost-share", `${segment.sharePercent}%`);
    bar.title = `${segment.label}: ${currency(segment.value)} (${percent(segment.sharePercent)})`;
    return bar;
  }));
}

function renderBuildingUtilityVisual(building: Readonly<Building>): void {
  const insight = deriveBuildingUtilityInsight(building);
  const renderKey = `utilities:${JSON.stringify(insight)}`;
  if (selectionSystemVisual.dataset.renderKey === renderKey) return;
  selectionSystemVisual.dataset.renderKey = renderKey;
  selectionSystemVisual.hidden = false;

  const heading = createSystemVisualHeading(
    "Utility service",
    `Efficiency ${percent(insight.efficiencyPercent)}`,
    "Delivered coverage affects daily operations",
  );
  const rows = document.createElement("div");
  rows.className = "driver-rows";
  rows.replaceChildren(...insight.coverage.map((utility) => createDriverRow(
    utility.label,
    percent(utility.coveragePercent),
    utility.coveragePercent,
    utility.coveragePercent >= 90 ? "positive" : utility.coveragePercent >= 70 ? "warning" : "negative",
  )));
  const summary = document.createElement("p");
  summary.className = "system-visual-summary";
  if (insight.bottleneck.coveragePercent >= 99 && insight.wasteStored === 0) {
    summary.textContent = "All three utility networks are fully serving this building; no waste is awaiting collection.";
  } else {
    summary.textContent = `${insight.bottleneck.label} is the limiting network at ${percent(insight.bottleneck.coveragePercent)}. `
      + `${formatAmount(insight.wasteStored)} units of waste are awaiting collection.`;
  }
  selectionSystemVisual.replaceChildren(heading, rows, summary);
}

function renderBuildingTrafficVisual(
  building: Readonly<Building>,
  state: Readonly<SimulationState>,
): void {
  const insight = deriveBuildingTrafficInsight(
    building,
    state.vehicles,
    state.buildingConnections,
    state.network.edges,
  );
  const renderKey = `traffic:${JSON.stringify(insight)}`;
  if (selectionSystemVisual.dataset.renderKey === renderKey) return;
  selectionSystemVisual.dataset.renderKey = renderKey;
  selectionSystemVisual.hidden = false;

  const heading = createSystemVisualHeading(
    "Destination traffic",
    `${number(insight.activeArrivals)} active`,
    "Visible vehicles currently heading here",
  );
  const rows = document.createElement("div");
  rows.className = "driver-rows";
  rows.replaceChildren(...insight.rows.map((row) => createDriverRow(
    row.label,
    number(row.activeArrivals),
    row.sharePercent,
    row.activeArrivals > 0 ? "warning" : "positive",
  )));
  const summary = document.createElement("p");
  summary.className = "system-visual-summary";
  summary.textContent = `${number(insight.queuedArrivals)} arrivals queued · ${Math.round(insight.averageWaitSeconds)} sec average wait · ${percent(insight.accessLoadPercent)} access-road load. `
    + `Connected daily activity: ${formatAmount(insight.connectedCommutes)} commuters, ${formatAmount(insight.connectedVisitors)} visitors, ${formatAmount(insight.connectedSupplyUnits)} supply units.`;
  selectionSystemVisual.replaceChildren(heading, rows, summary);
}

function renderPersonHappinessVisual(person: Readonly<Person>): void {
  const insight = derivePersonHappinessInsight(person);
  const renderKey = `happiness:${JSON.stringify(insight)}`;
  if (selectionSystemVisual.dataset.renderKey === renderKey) return;
  selectionSystemVisual.dataset.renderKey = renderKey;
  selectionSystemVisual.hidden = false;

  const heading = createSystemVisualHeading(
    "Happiness drivers",
    percent(insight.score),
    "100 points minus unmet needs",
  );
  const rows = document.createElement("div");
  rows.className = "driver-rows";
  rows.replaceChildren(...insight.drivers.map((driver) => createDriverRow(
    driver.label,
    `-${driver.penaltyPoints.toFixed(1)}`,
    driver.unmetPercent,
    driver.unmetPercent <= 30 ? "positive" : driver.unmetPercent <= 60 ? "warning" : "negative",
  )));
  const largestPenalty = [...insight.drivers].sort((left, right) => right.penaltyPoints - left.penaltyPoints)[0]!;
  const summary = document.createElement("p");
  summary.className = "system-visual-summary";
  summary.textContent = `${largestPenalty.label} is the largest drag, subtracting ${largestPenalty.penaltyPoints.toFixed(1)} points.`;
  selectionSystemVisual.replaceChildren(heading, rows, summary);
}

function createSystemVisualHeading(titleText: string, outcomeText: string, equationText: string): HTMLElement {
  const heading = document.createElement("div");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  const equation = document.createElement("small");
  const outcome = document.createElement("b");
  heading.className = "system-visual-heading";
  title.textContent = titleText;
  equation.textContent = equationText;
  outcome.textContent = outcomeText;
  copy.append(title, equation);
  heading.append(copy, outcome);
  return heading;
}

function createDriverRow(
  labelText: string,
  valueText: string,
  progress: number,
  tone: "positive" | "warning" | "negative",
): HTMLElement {
  const row = document.createElement("div");
  const label = document.createElement("span");
  const track = document.createElement("div");
  const fill = document.createElement("i");
  const value = document.createElement("strong");
  row.className = "driver-row";
  row.dataset.tone = tone;
  label.textContent = labelText;
  track.className = "driver-track";
  fill.style.setProperty("--driver-progress", `${Math.max(0, Math.min(100, progress))}%`);
  track.append(fill);
  value.textContent = valueText;
  row.append(label, track, value);
  return row;
}

interface ConnectionGroup {
  label: string;
  summary: string;
  details: string[];
}

function buildBuildingConnectionGroups(
  building: Readonly<Building>,
  relationships: readonly BuildingConnection[],
  buildingById: ReadonlyMap<string, Building>,
): ConnectionGroup[] {
  const labels: Record<Building["buildingUse"], string> = {
    housing: "Resident destinations",
    retail: "Customers",
    industrial: "Trade partners",
    school: "Students",
    library: "Library visitors",
    clinic: "Patients",
    park: "Park visitors",
  };
  return (["commute", "customer", "supply"] as const).map((kind) => {
    const connections = relationships.filter((connection) => connection.kind === kind);
    const total = connections.reduce((sum, connection) => sum + connection.volume, 0);
    const inbound = connections
      .filter((connection) => connection.toBuildingId === building.id)
      .reduce((sum, connection) => sum + connection.volume, 0);
    const outbound = total - inbound;
    const label = kind === "commute" ? "Workforce trips" : kind === "customer" ? labels[building.buildingUse] : "Goods movement";
    const unit = kind === "supply" ? "units" : "people";
    const totalUnit = total === 1 ? (kind === "supply" ? "unit" : "person") : unit;
    return {
      label,
      summary: `${formatAmount(total)} ${totalUnit} · ${formatAmount(inbound)} in / ${formatAmount(outbound)} out`,
      details: connections.map((connection) => {
        const isOutbound = connection.fromBuildingId === building.id;
        const counterpartId = isOutbound ? connection.toBuildingId : connection.fromBuildingId;
        const counterpart = buildingById.get(counterpartId)?.name ?? "Outside city market";
        const direction = isOutbound ? "to" : "from";
        return `${formatAmount(connection.volume)} ${unit} ${direction} ${counterpart}`;
      }),
    };
  });
}

function diagnoseBuilding(building: Building): string {
  const accounting = building.accounting;
  if (!accounting) return "Detailed accounting will appear after the next daily economy cycle.";
  const vacancies = Math.max(0, building.jobCapacity - building.employeeIds.length);
  if (accounting.operatingModel === "housing") {
    if (building.residentIds.length === 0) return "This property is vacant, so it receives no rent while maintenance and utility costs continue.";
    if (accounting.profit < 0) return "Collected rent does not cover this property's maintenance and delivered utility costs.";
    return "Collected rent covers this property's maintenance and delivered utility costs.";
  }
  if (accounting.operatingModel === "civic" || accounting.operatingModel === "amenity") {
    if (building.employeeIds.length === 0) return "No service is delivered because this facility has no staff; fixed maintenance costs still require municipal funding.";
    if (accounting.serviceQuality < 0.75) return `Service is constrained by ${vacancies} vacant positions and available utility service.`;
    return "Municipal funding covers staff, maintenance, and utilities; this facility is measured by service coverage rather than profit.";
  }
  if (accounting.profit < 0) {
    if (accounting.operatingStatus === "closed") {
      return `The business is closed after ${accounting.lossStreak} unprofitable days depleted its cash reserve.`;
    }
    if (accounting.importedSupplies > accounting.localSupplies) {
      return `Profit is negative because imported supplies and their transport cost exceed current sales; ${vacancies} positions remain vacant.`;
    }
    if (vacancies > 0) {
      return `Profit is negative while ${vacancies} positions remain vacant, limiting output and sales.`;
    }
    return "Profit is negative because wages, rent, supplies, and transport cost more than current revenue.";
  }
  if (accounting.importedSupplies > accounting.localSupplies) {
    return `The building is profitable, but imported goods are its largest supply source and expose it to transport costs.`;
  }
  if (vacancies > 0) {
    return `The building is profitable with mostly local supply, though ${vacancies} open positions limit capacity.`;
  }
  return "The building is profitable with a full workforce and locally supplied goods covering most receipts.";
}

function renderPersonSelection(person: Person, state: Readonly<SimulationState>): void {
  const buildingById = new Map(state.buildings.map((building) => [building.id, building]));
  const household = state.households.find((candidate) => candidate.id === person.householdId);
  if (household === undefined) {
    clearSelection();
    return;
  }
  const insight = derivePersonDailyInsight(person, household, state.city, state.buildings);
  const routes = buildPersonRoutes(person, state);
  const currentBuilding = buildingById.get(person.currentBuildingId)?.name
    ?? (person.currentBuildingId === OUTSIDE_COMMUTER_BUILDING_ID ? person.externalWorkplaceName ?? "Outside section job" : "In transit");
  const householdNames = insight.householdMemberIds
    .map((id) => state.people.find((candidate) => candidate.id === id)?.name ?? id)
    .join(", ");
  const dailySpending = insight.accounting.personalSpending;
  const averageGoodsPrice = (state.city.market.prices.food + state.city.market.prices.consumerGoods) / 2;
  const estimatedGoods = insight.accounting.personalGoodsSpending / Math.max(0.01, averageGoodsPrice);
  const commuteCost = insight.accounting.commuteCost;
  const [highestNeed, highestNeedLevel] = Object.entries(person.needs)
    .sort((left, right) => right[1] - left[1])[0]!;
  const dailyBalance = insight.accounting.dailyIncome - dailySpending;
  selectionKicker.textContent = "Representative resident";
  selectionTitle.textContent = person.name;
  selectionSummary.textContent = `${person.age}-year-old ${person.incomeBand}-income resident, currently ${person.currentActivity} at ${currentBuilding}.`;
  selectionFinancialFlow.hidden = true;
  renderPersonHappinessVisual(person);
  renderVisualSummaries([
    {
      label: "Happiness",
      value: percent(person.happiness),
      detail: "Education, goods, health, community and recreation",
      progress: person.happiness,
      tone: person.happiness >= 70 ? "positive" : person.happiness >= 45 ? "warning" : "negative",
    },
    {
      label: "Daily balance",
      value: signedCurrency(dailyBalance),
      detail: `${currency(insight.accounting.dailyIncome)} income · ${currency(dailySpending)} spending`,
      tone: dailyBalance >= 0 ? "positive" : "negative",
    },
    {
      label: "Need met",
      value: percent((1 - highestNeedLevel) * 100),
      detail: `${capitalize(highestNeed)} is the greatest unmet need`,
      progress: (1 - highestNeedLevel) * 100,
      tone: highestNeedLevel <= 0.3 ? "positive" : highestNeedLevel <= 0.6 ? "warning" : "negative",
    },
    {
      label: "Migration outlook",
      value: capitalize(insight.migrationStatus),
      detail: `${signedFixed(insight.migrationRatePercent)}% annual migration pressure`,
      tone: insight.migrationStatus === "staying" ? "positive" : insight.migrationStatus === "leaving" ? "negative" : "warning",
    },
  ]);
  renderStatRows([
    ["Household members", number(insight.householdMemberIds.length)],
    ["Shared household cash", currency(insight.accounting.sharedHouseholdCash)],
    ["Daily wage", currency(insight.accounting.dailyIncome)],
    ["Employment", employmentLabel(person)],
    ["Unemployed", `${number(person.unemployedDays)} days`],
    ["Daily spending", currency(dailySpending)],
    ["Housing and utilities", currency(insight.accounting.expenses.housing + insight.accounting.expenses.utilities)],
    ["Goods", currency(insight.accounting.expenses.goods)],
    ["Health, education, recreation", currency(
      insight.accounting.expenses.healthcare
      + insight.accounting.expenses.education
      + insight.accounting.expenses.recreation,
    )],
    ["Taxes", currency(insight.accounting.expenses.taxes)],
    ["Commute cost", currency(commuteCost)],
    ["Commute", person.commuteDistanceKm > 0
      ? `${person.commuteDistanceKm.toFixed(1)} km · ${Math.max(1, Math.round(person.commuteMinutesOneWay))} min each way`
      : "No work commute"],
    ["Goods purchased", `${formatAmount(estimatedGoods)} units / ${currency(insight.accounting.personalGoodsSpending)}`],
    ["Highest unmet need", `${capitalize(highestNeed)} · ${percent(highestNeedLevel * 100)}`],
    ["Happiness", percent(person.happiness)],
    ["Migration status", `${capitalize(insight.migrationStatus)} · ${signedFixed(insight.migrationRatePercent)}%/yr`],
  ]);
  const modeReason = routes[0]?.reason ?? "No travel is required for today's schedule.";
  setText(selectionDiagnosis, `${insight.diagnosis} Transport: ${modeReason}`);
  selectionTimelineSection.hidden = false;
  renderPersonTimeline(person, routes, buildingById);

  selectionConnectionsTitle.textContent = "Household and daily links";
  renderConnectionGroups([
    {
      label: "Household",
      summary: `${number(insight.householdMemberIds.length)} members · ${currency(insight.accounting.sharedHouseholdCash)} shared cash`,
      details: [
        `Members: ${householdNames}`,
        `Home: ${buildingById.get(person.homeBuildingId)?.name ?? "Unknown"}`,
      ],
    },
    {
      label: "Work and daily travel",
      summary: `${number(routes.length)} trips · ${currency(commuteCost)} commute cost`,
      details: [
        `Work: ${person.workBuildingId === undefined ? "Not employed" : buildingById.get(person.workBuildingId)?.name ?? person.externalWorkplaceName ?? "Outside city"}`,
        ...routes.map((route) => `${capitalize(route.mode)} to ${route.destination}: ${route.reason}`),
      ],
    },
  ]);
}

interface PersonRouteView {
  activity: Person["currentActivity"];
  fromActivity: Person["currentActivity"];
  startMinute: number;
  destination: string;
  mode: Person["preferredMode"];
  durationMinutes: number;
  cost: number;
  reason: string;
}

function buildPersonRoutes(person: Person, state: Readonly<SimulationState>): PersonRouteView[] {
  const buildings = new Map(state.buildings.map((building) => [building.id, building]));
  const conditions = currentMobilityConditions(state);
  const routes: PersonRouteView[] = [];
  person.schedule.forEach((activity, index) => {
    const previous = person.schedule[index - 1];
    if (previous === undefined || previous.buildingId === activity.buildingId) return;
    const origin = routeLocation(previous.buildingId, buildings, person);
    const destination = routeLocation(activity.buildingId, buildings, person);
    if (origin === undefined || destination === undefined) return;
    const choice = explainModeChoice(person, origin, destination, conditions);
    let durationMinutes: number;
    let cost = 0;
    const isWorkCommute = activity.activity === "work" || previous.activity === "work";
    if (isWorkCommute && person.commuteMinutesOneWay > 0) {
      durationMinutes = person.commuteMinutesOneWay;
      cost = person.commuteCostDaily / 2;
      routes.push({
        activity: activity.activity,
        fromActivity: previous.activity,
        startMinute: activity.startMinute,
        destination: destination.name,
        mode: choice.mode,
        durationMinutes,
        cost,
        reason: choice.reason,
      });
      return;
    }
    try {
      const plan = planRoute(state.network as MobilityNetwork, origin.id, destination.id, choice.mode);
      durationMinutes = plan.cost.travelTimeSeconds * 12 / 60;
      cost = plan.cost.monetaryCost;
    } catch {
      durationMinutes = Math.hypot(destination.x - origin.x, destination.z - origin.z) * 0.18;
    }
    routes.push({
      activity: activity.activity,
      fromActivity: previous.activity,
      startMinute: activity.startMinute,
      destination: destination.name,
      mode: choice.mode,
      durationMinutes,
      cost,
      reason: choice.reason,
    });
  });
  return routes;
}

function routeLocation(
  id: string,
  buildings: ReadonlyMap<string, Building>,
  person: Readonly<Person>,
): Pick<Building, "id" | "name" | "x" | "z"> | undefined {
  const building = buildings.get(id);
  if (building !== undefined) return building;
  return id === OUTSIDE_COMMUTER_BUILDING_ID
    ? { id, name: person.externalWorkplaceName ?? "Outside section job", x: 85, z: -4 }
    : undefined;
}

function employmentLabel(person: Readonly<Person>): string {
  if (person.employmentStatus === "external") return `Outside section · ${person.externalWorkplaceName ?? "regional job"}`;
  if (person.employmentStatus === "local") return "Local job";
  if (person.employmentStatus === "unemployed") return "Unemployed";
  return "Not in labor force";
}

function currentMobilityConditions(state: Readonly<SimulationState>): MobilityConditions {
  return {
    busAvailable: state.infrastructure.transitLines.some((line) => line.active),
    parkingPressure: state.infrastructure.parkingUsed / Math.max(1, state.infrastructure.parkingCapacity),
    congestion: state.metrics.congestionPercent / 100,
  };
}

function renderPersonTimeline(
  person: Person,
  routes: readonly PersonRouteView[],
  buildings: ReadonlyMap<string, Building>,
): void {
  const routeByStart = new Map(routes.map((route) => [route.startMinute, route]));
  const renderKey = `${person.id}:${person.schedule.map((entry) => entry.buildingId).join("|")}:${routes.map((route) => `${route.mode}:${route.durationMinutes.toFixed(1)}`).join("|")}`;
  if (selectionTimeline.dataset.renderKey === renderKey) return;
  selectionTimeline.dataset.renderKey = renderKey;
  selectionTimeline.replaceChildren(...person.schedule.map((activity) => {
    const route = routeByStart.get(activity.startMinute);
    const row = document.createElement("li");
    const time = document.createElement("time");
    const destination = document.createElement("strong");
    const travel = document.createElement("small");
    const departureMinute = route === undefined
      ? activity.startMinute
      : ((activity.startMinute - route.durationMinutes) % 1440 + 1440) % 1440;
    time.textContent = formatClock(departureMinute);
    destination.textContent = `${capitalize(activity.activity)} · ${buildings.get(activity.buildingId)?.name ?? "Outside city"}`;
    travel.textContent = route === undefined
      ? "Starts here"
      : `${capitalize(route.mode)} · ${Math.max(1, Math.round(route.durationMinutes))} min · arrives ${formatClock(activity.startMinute)}`;
    row.append(time, destination, travel);
    return row;
  }));
}

function renderStatRows(rows: ReadonlyArray<readonly [string, string]>): void {
  const renderKey = JSON.stringify(rows);
  if (selectionStats.dataset.renderKey === renderKey) return;
  selectionStats.dataset.renderKey = renderKey;
  selectionStats.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    return row;
  }));
}

function renderConnectionGroups(groups: readonly ConnectionGroup[]): void {
  const values = groups.length > 0 ? groups : [{ label: "No activity", summary: "No connected activity recorded today.", details: [] }];
  const renderKey = JSON.stringify(values);
  if (selectionConnections.dataset.renderKey === renderKey) return;
  selectionConnections.dataset.renderKey = renderKey;
  selectionConnections.replaceChildren(...values.map((group) => {
    const disclosure = document.createElement("details");
    const summary = document.createElement("summary");
    const heading = document.createElement("strong");
    const total = document.createElement("span");
    heading.textContent = group.label;
    total.textContent = group.summary;
    summary.append(heading, total);
    disclosure.append(summary);
    if (group.details.length > 0) {
      const list = document.createElement("ol");
      list.replaceChildren(...group.details.map((detail) => {
        const row = document.createElement("li");
        row.textContent = detail;
        return row;
      }));
      disclosure.append(list);
    }
    return disclosure;
  }));
}

function clearSelection(): void {
  closeInspection();
}

function closeInspection(): void {
  activeSelection = null;
  renderer.setSelection(null);
  selectionPanel.hidden = true;
  inspectorPanel.hidden = false;
  inspectorPanel.dataset.view = "mode";
  dashboardPanel.hidden = false;
  document.body.dataset.mobileInspector = "closed";
}

function renderEvents(state: Readonly<SimulationState>): void {
  const events = state.events.slice(0, 30);
  const renderKey = events.map((event) => `${event.id}:${event.message}`).join("|");
  if (eventList.dataset.renderKey === renderKey) return;
  eventList.dataset.renderKey = renderKey;
  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No alerts or system updates yet.";
    eventList.replaceChildren(empty);
    return;
  }

  const categories: SimulationEvent["category"][] = ["economy", "population", "mobility", "utilities", "land-use"];
  const categoryLabels: Record<SimulationEvent["category"], string> = {
    economy: "Economy",
    population: "Population",
    mobility: "Mobility",
    utilities: "Utilities",
    "land-use": "Land use",
  };
  eventList.replaceChildren(...categories.flatMap((category) => {
    const categoryEvents = events.filter((event) => event.category === category);
    if (categoryEvents.length === 0) return [];
    const messages = new Map<string, { event: SimulationEvent; count: number }>();
    for (const event of categoryEvents) {
      const existing = messages.get(event.message);
      if (existing === undefined) messages.set(event.message, { event, count: 1 });
      else existing.count += 1;
    }
    const warningCount = categoryEvents.filter((event) => event.severity === "warning").length;
    const disclosure = document.createElement("details");
    disclosure.className = "alert-group";
    disclosure.dataset.severity = warningCount > 0 ? "warning" : "info";
    disclosure.open = warningCount > 0;
    const summary = document.createElement("summary");
    const label = document.createElement("strong");
    const count = document.createElement("span");
    label.textContent = categoryLabels[category];
    count.textContent = warningCount > 0
      ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
      : `${categoryEvents.length} update${categoryEvents.length === 1 ? "" : "s"}`;
    summary.append(label, count);
    const list = document.createElement("ol");
    list.replaceChildren(...[...messages.values()].map(({ event, count: repeats }) => {
      const item = document.createElement("li");
      item.dataset.severity = event.severity;
      const time = document.createElement("time");
      time.textContent = `Day ${Math.max(1, Math.floor((event.minute - 420) / 1440) + 1)}`;
      const message = document.createElement("span");
      message.textContent = `${event.message}${repeats > 1 ? ` · repeated ${repeats} times` : ""}`;
      item.append(time, message);
      return item;
    }));
    disclosure.append(summary, list);
    return [disclosure];
  }));
}

function updateControlEffects(state: Readonly<SimulationState>): void {
  const speedLimit = speedLimitControl.valueAsNumber;
  const signalCycle = signalCycleControl.valueAsNumber;
  const transitHeadway = transitHeadwayControl.valueAsNumber;
  const roadCapacity = roadCapacityControl.valueAsNumber;
  const utilityCapacity = utilityCapacityControl.valueAsNumber;
  const zoningStrictness = zoningStrictnessControl.valueAsNumber;
  const speedTimeChange = (25 / speedLimit - 1) * 100;
  const roadCapacityChange = (roadCapacity / 20 - 1) * 100;
  const zoningAllowanceChange = (1 / zoningStrictness - 1) * 100;

  setText(requireElement("simulation-speed-effect"), `${selectedSimulationRate().label}; faster rates emphasize citywide trends and sample less street-level movement.`);
  setText(
    requireElement("day-night-effect"),
    dayNightControl.checked
      ? "Lighting follows sunrise, sunset, and the displayed clock."
      : "Lighting stays at midday while the simulation clock and schedules continue.",
  );
  setText(
    requireElement("speed-limit-effect"),
    speedTimeChange === 0
      ? "Matches the 25 mph baseline for vehicles in the visible street sample."
      : `${Math.abs(Math.round(speedTimeChange))}% ${speedTimeChange > 0 ? "longer" : "shorter"} visible-street free-flow time than 25 mph; this does not change citywide trip demand.`,
  );
  setText(requireElement("signal-cycle-effect"), `${Math.round(signalCycle / 2)}s vehicle phase and ${Math.round(signalCycle / 2)}s pedestrian phase at the visible intersection; observed pedestrian wait is ${Math.round(state.metrics.pedestrianWaitSeconds)}s.`);
  setText(requireElement("transit-headway-effect"), `${(60 / transitHeadway).toFixed(1)} buses per hour; scheduled average wait is ${transitHeadway / 2} min.`);
  setText(
    requireElement("road-capacity-effect"),
    roadCapacityChange === 0
      ? `Matches baseline capacity; citywide congestion is ${percent(state.city.metrics.congestionPercent)} and visible street load is ${percent(state.metrics.congestionPercent)}.`
      : `${Math.abs(Math.round(roadCapacityChange))}% ${roadCapacityChange > 0 ? "more" : "less"} capacity in both models; citywide congestion is ${percent(state.city.metrics.congestionPercent)} and visible street load is ${percent(state.metrics.congestionPercent)}.`,
  );
  setText(
    requireElement("utility-capacity-effect"),
    `Capacity is ${percent(utilityCapacity * 100)} of baseline; visible street coverage is ${percent(state.metrics.utilityCoveragePercent)} and citywide service coverage is ${percent(state.city.metrics.utilityCoveragePercent)}.`,
  );
  setText(
    requireElement("zoning-strictness-effect"),
    zoningAllowanceChange === 0
      ? "Matches baseline development allowance before terrain and service limits."
      : `${Math.abs(Math.round(zoningAllowanceChange))}% ${zoningAllowanceChange > 0 ? "more" : "less"} development allowance before terrain and service limits.`,
  );
}

function selectedSimulationRate(): Readonly<(typeof SIMULATION_RATES)[SimulationRate]> {
  return SIMULATION_RATES[simulationRateControl.value as SimulationRate] ?? SIMULATION_RATES.standard;
}

function simulationRateForSettings(horizon: TimeHorizon, multiplier: number): SimulationRate {
  const match = (Object.entries(SIMULATION_RATES) as Array<[SimulationRate, (typeof SIMULATION_RATES)[SimulationRate]]>)
    .find(([, rate]) => rate.horizon === horizon && rate.multiplier === multiplier);
  return match?.[0] ?? "standard";
}

function setSettingsOpen(open: boolean): void {
  settingsDrawer.dataset.open = String(open);
  settingsDrawer.setAttribute("aria-hidden", String(!open));
  settingsDrawer.toggleAttribute("inert", !open);
  settingsScrim.setAttribute("aria-hidden", String(!open));
  settingsButton.setAttribute("aria-expanded", String(open));
  document.body.dataset.settingsOpen = String(open);
}

function bindRange(
  controlId: string,
  outputId: string,
  initialValue: number,
  format: (value: number) => string,
  apply: (value: number) => void,
): HTMLInputElement {
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
  return control;
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

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
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

function number(value: number): string {
  return Math.round(value).toLocaleString();
}

function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${number(value)}`;
}

function signedFixed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function signedCurrency(value: number): string {
  return `${value >= 0 ? "+" : ""}${currency(value)}`;
}

function formatBaselineValue(row: BaselineComparisonRow, value: number): string {
  if (row.unit === "currency" || row.unit === "currency-per-day") return currency(value);
  if (row.unit === "percent") return percent(value);
  if (row.unit === "residents-per-year") return `${signedNumber(value)}/yr`;
  return number(value);
}

function formatBaselineDifference(row: BaselineComparisonRow): string {
  if (row.unit === "currency" || row.unit === "currency-per-day") return signedCurrency(row.difference);
  if (row.unit === "percent") return `${signedFixed(row.difference)} pts`;
  if (row.unit === "residents-per-year") return `${signedNumber(row.difference)}/yr`;
  return signedNumber(row.difference);
}

function updateHeatLegend(layer: VisualLayer): void {
  const labels: Record<VisualLayer, readonly [string, string]> = {
    none: ["Base", "color"],
    congestion: ["Free flow", "Gridlock"],
    "pedestrian-wait": ["No wait", "Long wait"],
    "land-value": ["Lower value", "Higher value"],
    utilities: ["Unserved", "Covered"],
    jobs: ["Few jobs", "Many jobs"],
    shortages: ["Supplied", "Shortage"],
    migration: ["Outflow", "Inflow"],
    freight: ["Low freight", "High freight"],
    profit: ["Loss", "Profit"],
  };
  const [low, high] = labels[layer];
  setText(heatLowLabel, low);
  setText(heatHighLabel, high);
}

function formatClock(minute: number): string {
  if (minute >= 1440) return "12:00a";
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")}${hours < 12 ? "a" : "p"}`;
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

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

renderer.resize();
renderer.render(simulation.getState());
updateHeatLegend("none");
updateInterface();
window.requestAnimationFrame(animationFrame);
