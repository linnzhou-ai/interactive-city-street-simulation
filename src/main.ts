import "./styles.css";
import {
  captureBaseline,
  compareWithBaseline,
  deriveCongestionTripBreakdown,
  deriveHappinessBreakdown,
  deriveMigrationBreakdown,
  derivePersonDailyInsight,
  derivePriceBreakdowns,
  deriveRepresentationSummary,
  type BaselineComparisonRow,
  type InsightContribution,
} from "./core/insights";
import { OUTSIDE_COMMUTER_BUILDING_ID, planRoute, type MobilityNetwork } from "./core/network";
import { explainModeChoice, type MobilityConditions } from "./core/population";
import { Simulation } from "./core/simulation";
import { cityMinutesPerSecond, formatClockTime, formatLongDate } from "./core/timeScale";
import type { TimeHorizon } from "./models/cityTypes";
import type {
  BuildTool,
  Building,
  BuildingConnection,
  GridCellDesign,
  GridSignalDesign,
  IntersectionLayout,
  Person,
  SimulationEvent,
  SimulationState,
} from "./models/types";
import { BUILD_GRID_SIZE } from "./models/types";
import {
  ThreeRenderer,
  type SceneSelection,
  type VisibleFlow,
  type VisualLayer,
} from "./rendering/threeRenderer";

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
const buildModeButton = requireElement<HTMLButtonElement>("build-mode-button");
const simulateModeButton = requireElement<HTMLButtonElement>("simulate-mode-button");
const buildGrid = requireElement<HTMLElement>("build-grid");
const selectedBuildTool = requireElement<HTMLElement>("selected-build-tool");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const rotateLayoutButton = requireElement<HTMLButtonElement>("rotate-layout-button");
const mobilePanelButton = requireElement<HTMLButtonElement>("mobile-panel-button");
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
const selectionPanel = requireElement<HTMLElement>("selection-panel");
const selectionKicker = requireElement<HTMLElement>("selection-kicker");
const selectionTitle = requireElement<HTMLElement>("selection-title");
const selectionSummary = requireElement<HTMLElement>("selection-summary");
const selectionStats = requireElement<HTMLElement>("selection-stats");
const selectionConnectionsTitle = requireElement<HTMLElement>("selection-connections-title");
const selectionConnections = requireElement<HTMLElement>("selection-connections");
const selectionClose = requireElement<HTMLButtonElement>("selection-close");
const selectionDiagnosis = requireElement<HTMLElement>("selection-diagnosis");
const selectionTimelineSection = requireElement<HTMLElement>("selection-timeline-section");
const selectionTimeline = requireElement<HTMLOListElement>("selection-timeline");
const inspectionRunToggle = requireElement<HTMLInputElement>("inspection-run-toggle");
const inspectionMotionStatus = requireElement<HTMLElement>("inspection-motion-status");
const representationPerson = requireElement<HTMLElement>("representation-person");
const representationBuildings = requireElement<HTMLElement>("representation-buildings");
const representationActivity = requireElement<HTMLElement>("representation-activity");
const causeList = requireElement<HTMLElement>("cause-list");
const baselineList = requireElement<HTMLElement>("baseline-list");
const timelineMarkers = requireElement<HTMLOListElement>("timeline-markers");
const detailModeOutput = requireElement<HTMLElement>("detail-mode-output");
const flowToggles = [...document.querySelectorAll<HTMLInputElement>(".flow-toggles input")];
const heatLowLabel = requireElement<HTMLElement>("heat-low-label");
const heatHighLabel = requireElement<HTMLElement>("heat-high-label");
const mapModeButtons = [...document.querySelectorAll<HTMLButtonElement>(".map-mode-buttons button")];
const horizonButtons = [...document.querySelectorAll<HTMLButtonElement>(".horizon-control button")];
const designToolButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-design-tool], [data-build-tool]"),
];
const layoutButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-intersection-layout]"),
];
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

const simulation = new Simulation();
const baseline = captureBaseline(simulation.getState().city);
let activeSelection: SceneSelection = null;
let inspectionRestoreRunning = false;
const renderer = new ThreeRenderer(canvas, (selection) => {
  if (selection !== null && activeSelection === null) {
    inspectionRestoreRunning = simulation.getState().running;
    if (!inspectionRunToggle.checked) simulation.pause();
    document.body.dataset.mobileInspector = "open";
    mobilePanelButton.setAttribute("aria-pressed", "true");
  }
  if (selection === null && activeSelection !== null) restoreAfterInspection();
  activeSelection = selection;
  updateInterface();
});
let previousTimestamp = performance.now();
let previousInterfaceTimestamp = previousTimestamp;
let activeLayer: Layer = "overview";
let activeVisualLayer: VisualLayer = "none";
const gridCells = new Map<string, GridCellDesign>();
const gridSignals = new Map<string, GridSignalDesign>();
let activeBuildTool: BuildTool = "lane";
let isPainting = false;
let hoveredGridCell: { row: number; column: number } | null = null;
let selectedGridCell: { row: number; column: number } | null = null;

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

buildModeButton.addEventListener("click", () => setAppMode("build"));
simulateModeButton.addEventListener("click", () => setAppMode("simulate"));

for (const button of designToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.designTool ?? button.dataset.buildTool;
    if (isBuildTool(tool)) selectBuildTool(tool);
  });
}

for (const button of layoutButtons) {
  button.addEventListener("click", () => {
    const layout = button.dataset.intersectionLayout;
    if (!isIntersectionLayout(layout)) return;
    seedGridLayout(layout);
    layoutButtons.forEach((candidate) =>
      candidate.setAttribute("aria-pressed", String(candidate === button)),
    );
  });
}

rotateLayoutButton.addEventListener("click", rotateGridDesign);
resetDesignButton.addEventListener("click", () => {
  gridCells.clear();
  gridSignals.clear();
  selectedGridCell = null;
  syncBuildGrid();
});

runButton.addEventListener("click", () => {
  simulation.start();
  if (activeSelection !== null) inspectionRunToggle.checked = true;
  updateInterface();
});

pauseButton.addEventListener("click", () => {
  simulation.pause();
  if (activeSelection !== null) inspectionRunToggle.checked = false;
  updateInterface();
});

resetButton.addEventListener("click", () => {
  simulation.reset();
  activeSelection = null;
  inspectionRestoreRunning = false;
  inspectionRunToggle.checked = false;
  renderer.setSelection(null);
  updateInterface();
});

selectionClose.addEventListener("click", () => {
  closeInspection();
  updateInterface();
});

inspectionRunToggle.addEventListener("change", () => {
  if (activeSelection === null) return;
  if (inspectionRunToggle.checked) simulation.start();
  else simulation.pause();
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

mobilePanelButton.addEventListener("click", () => {
  const showInspector = document.body.dataset.mobileInspector !== "open";
  document.body.dataset.mobileInspector = showInspector ? "open" : "closed";
  mobilePanelButton.setAttribute("aria-pressed", String(showInspector));
  mobilePanelButton.setAttribute("aria-label", showInspector ? "Hide inspector" : "Show inspector");
  mobilePanelButton.title = showInspector ? "Hide inspector" : "Show inspector";
});

settingsButton.addEventListener("click", () => setSettingsOpen(settingsDrawer.dataset.open !== "true"));
settingsClose.addEventListener("click", () => setSettingsOpen(false));
settingsScrim.addEventListener("click", () => setSettingsOpen(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsDrawer.dataset.open === "true") setSettingsOpen(false);
});

for (const button of mapModeButtons) {
  button.addEventListener("click", () => {
    activeLayer = button.dataset.layer as Layer;
    activeVisualLayer = button.dataset.visualLayer as VisualLayer;
    renderer.setVisualLayer(activeVisualLayer);
    updateHeatLegend(activeVisualLayer);
    mapModeButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
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
const simulationSpeedControl = bindRange("simulation-speed-control", "simulation-speed-output", settings.simulationSpeed, (value) => `${value.toFixed(1)}x`, (value) => simulation.setSimulationSpeed(value));
const speedLimitControl = bindRange("speed-limit-control", "speed-limit-output", settings.speedLimitMph, (value) => `${value} mph`, (value) => simulation.setSpeedLimitMph(value));
const signalCycleControl = bindRange("signal-cycle-control", "signal-cycle-output", settings.signalCycleSeconds, (value) => `${value}s`, (value) => simulation.setSignalCycleSeconds(value));
const transitHeadwayControl = bindRange("transit-headway-control", "transit-headway-output", settings.transitHeadwayMinutes, (value) => `${value} min`, (value) => simulation.setTransitHeadwayMinutes(value));
const roadCapacityControl = bindRange("road-capacity-control", "road-capacity-output", settings.roadCapacity, (value) => `${value} vehicles`, (value) => simulation.setRoadCapacity(value));
const utilityCapacityControl = bindRange("utility-capacity-control", "utility-capacity-output", settings.utilityCapacityScale, (value) => percent(value * 100), (value) => simulation.setUtilityCapacityScale(value));
const zoningStrictnessControl = bindRange("zoning-strictness-control", "zoning-strictness-output", settings.zoningStrictness, (value) => percent(value * 100), (value) => simulation.setZoningStrictness(value));

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
  statusPill.dataset.status = state.running ? "running" : state.elapsedSeconds > 0 ? "paused" : "ready";
  setText(statusPill, state.running ? "Running" : state.elapsedSeconds > 0 ? "Paused" : "Ready");
  runButton.disabled = state.running;
  pauseButton.disabled = !state.running;
  setText(dayOutput, `Day ${Math.floor(state.metrics.simulatedDays) + 1} · ${capitalize(state.timeHorizon)} horizon`);
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
  setText(activeLayerLabel, view.sceneLabel);
  setText(detailModeOutput, `${capitalize(renderer.getDetailMode())} detail`);
  setText(inspectorTitle, view.title);
  setText(inspectorSummary, view.summary(state));
  setText(metricsTitle, view.sceneLabel);
  setText(
    inspectionMotionStatus,
    activeSelection === null
      ? "Select an entity to inspect"
      : state.running
        ? "Movement continues while inspecting"
        : "Paused for inspection",
  );

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
  setText(representationBuildings, summary.citywideLabel);
  setText(
    representationActivity,
    `${number(movingAgents)} visible moving agents sample ${number(state.city.metrics.dailyTrips)} citywide trips per day.`,
  );
}

function renderCauses(state: Readonly<SimulationState>): void {
  let contributions: InsightContribution[];
  let formatValue: (value: number) => string;
  if (activeLayer === "people" || activeLayer === "land-use") {
    contributions = deriveMigrationBreakdown(state.city).contributions;
    formatValue = (value) => `${signedNumber(value)}/yr`;
  } else if (activeLayer === "economy") {
    contributions = derivePriceBreakdowns(state.city).consumerGoods.contributions;
    formatValue = (value) => signedCurrency(value);
  } else if (activeLayer === "infrastructure") {
    contributions = deriveCongestionTripBreakdown(state.city).rows.map((row) => ({
      key: row.category,
      label: row.label,
      value: row.sharePercent,
      explanation: row.contributesToRoadCongestion
        ? `${number(row.tripsDaily)} daily trips use road capacity.`
        : `${number(row.tripsDaily)} daily trips are tracked separately from private road demand.`,
    }));
    formatValue = (value) => percent(value);
  } else {
    contributions = deriveHappinessBreakdown(state.city).contributions;
    formatValue = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
  }

  const renderKey = `${activeLayer}:${contributions.map((row) => `${row.key}:${row.value.toFixed(3)}`).join("|")}`;
  if (causeList.dataset.renderKey === renderKey) return;
  causeList.dataset.renderKey = renderKey;
  const maximum = Math.max(1, ...contributions.map((row) => Math.abs(row.value)));
  causeList.replaceChildren(...contributions.map((contribution) => {
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
  selectionPanel.hidden = activeSelection === null;
  dashboardPanel.hidden = activeSelection !== null;
  inspectorPanel.setAttribute("aria-labelledby", activeSelection === null ? "inspector-title" : "selection-title");
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
  const dailySpending = insight.accounting.personalRentShare
    + insight.accounting.personalGoodsSpending
    + insight.accounting.commuteCost;
  const averageGoodsPrice = (state.city.market.prices.food + state.city.market.prices.consumerGoods) / 2;
  const estimatedGoods = insight.accounting.personalGoodsSpending / Math.max(0.01, averageGoodsPrice);
  const routeCommuteCost = routes
    .filter((route) => route.activity === "work" || route.fromActivity === "work")
    .reduce((total, route) => total + route.cost, 0);
  const commuteCost = Math.max(insight.accounting.commuteCost, routeCommuteCost);
  const [highestNeed, highestNeedLevel] = Object.entries(person.needs)
    .sort((left, right) => right[1] - left[1])[0]!;
  selectionKicker.textContent = "Representative resident";
  selectionTitle.textContent = person.name;
  selectionSummary.textContent = `${person.age}-year-old ${person.incomeBand}-income resident, currently ${person.currentActivity} at ${currentBuilding}.`;
  renderStatRows([
    ["Household members", number(insight.householdMemberIds.length)],
    ["Shared household cash", currency(insight.accounting.sharedHouseholdCash)],
    ["Daily wage", currency(insight.accounting.dailyIncome)],
    ["Employment", employmentLabel(person)],
    ["Unemployed", `${number(person.unemployedDays)} days`],
    ["Daily spending", currency(dailySpending)],
    ["Commute cost", currency(commuteCost)],
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
    try {
      const plan = planRoute(state.network as MobilityNetwork, origin.id, destination.id, choice.mode);
      durationMinutes = plan.cost.travelTimeSeconds / 60;
      cost = plan.cost.monetaryCost;
    } catch {
      durationMinutes = Math.hypot(destination.x - origin.x, destination.z - origin.z) / 4;
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
    time.textContent = formatClock(activity.startMinute);
    destination.textContent = `${capitalize(activity.activity)} · ${buildings.get(activity.buildingId)?.name ?? "Outside city"}`;
    travel.textContent = route === undefined
      ? "Starts here"
      : `${capitalize(route.mode)} · ${Math.max(1, Math.round(route.durationMinutes))} min`;
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
  dashboardPanel.hidden = false;
  document.body.dataset.mobileInspector = "closed";
  mobilePanelButton.setAttribute("aria-pressed", "false");
  restoreAfterInspection();
}

function restoreAfterInspection(): void {
  const shouldRun = inspectionRestoreRunning;
  inspectionRestoreRunning = false;
  inspectionRunToggle.checked = false;
  if (shouldRun) simulation.start();
  else simulation.pause();
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
  const simulationSpeed = simulationSpeedControl.valueAsNumber;
  const speedLimit = speedLimitControl.valueAsNumber;
  const signalCycle = signalCycleControl.valueAsNumber;
  const transitHeadway = transitHeadwayControl.valueAsNumber;
  const roadCapacity = roadCapacityControl.valueAsNumber;
  const utilityCapacity = utilityCapacityControl.valueAsNumber;
  const zoningStrictness = zoningStrictnessControl.valueAsNumber;
  const simulatedMinutesPerSecond = cityMinutesPerSecond(state.timeHorizon) * simulationSpeed;
  const speedTimeChange = (1 - 25 / speedLimit) * 100;
  const roadCapacityChange = (roadCapacity / 20 - 1) * 100;
  const zoningAllowanceChange = (1 / zoningStrictness - 1) * 100;

  setText(requireElement("simulation-speed-effect"), `${formatSimulationRate(simulatedMinutesPerSecond)} of city time per real second.`);
  setText(
    requireElement("speed-limit-effect"),
    speedTimeChange === 0
      ? "Matches the 25 mph baseline; higher speeds shorten free-flow trips but increase conflict severity."
      : `${Math.abs(Math.round(speedTimeChange))}% ${speedTimeChange > 0 ? "shorter" : "longer"} free-flow trips than 25 mph; higher speeds increase conflict severity.`,
  );
  setText(requireElement("signal-cycle-effect"), `About ${Math.round(signalCycle / 2)}s per phase and ${Math.round(signalCycle / 4)}s average signal delay before congestion effects.`);
  setText(requireElement("transit-headway-effect"), `${(60 / transitHeadway).toFixed(1)} buses per hour; scheduled average wait is ${transitHeadway / 2} min.`);
  setText(
    requireElement("road-capacity-effect"),
    roadCapacityChange === 0
      ? `Matches baseline road capacity; current congestion is ${percent(state.city.metrics.congestionPercent)}.`
      : `${Math.abs(Math.round(roadCapacityChange))}% ${roadCapacityChange > 0 ? "more" : "less"} road capacity than baseline; current congestion is ${percent(state.city.metrics.congestionPercent)}.`,
  );
  setText(
    requireElement("utility-capacity-effect"),
    `Capacity is ${percent(utilityCapacity * 100)} of baseline; current delivered coverage is ${percent(state.city.metrics.utilityCoveragePercent)}.`,
  );
  setText(
    requireElement("zoning-strictness-effect"),
    zoningAllowanceChange === 0
      ? "Matches baseline development allowance before terrain and service limits."
      : `${Math.abs(Math.round(zoningAllowanceChange))}% ${zoningAllowanceChange > 0 ? "more" : "less"} development allowance before terrain and service limits.`,
  );
}

function formatSimulationRate(minutes: number): string {
  if (minutes >= 10080) return `${(minutes / 10080).toFixed(1)} weeks`;
  if (minutes >= 1440) return `${(minutes / 1440).toFixed(1)} days`;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)} hours`;
  return `${Math.round(minutes)} minutes`;
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
    if (!Number.isFinite(value)) return;
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

function setAppMode(mode: "build" | "simulate"): void {
  document.body.dataset.appMode = mode;
  const isBuildMode = mode === "build";
  buildModeButton.setAttribute("aria-pressed", String(isBuildMode));
  simulateModeButton.setAttribute("aria-pressed", String(!isBuildMode));
  renderer.setBuildMode(isBuildMode);
  if (isBuildMode) {
    simulation.pause();
    setSettingsOpen(false);
    activeSelection = null;
    renderer.setSelection(null);
  }
  updateInterface();
}

function createBuildGrid(): void {
  for (let row = 0; row < BUILD_GRID_SIZE; row += 1) {
    for (let column = 0; column < BUILD_GRID_SIZE; column += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "build-grid-cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute("aria-label", `Grid row ${row + 1}, column ${column + 1}: empty`);
      cell.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        isPainting = true;
        paintGridCell(row, column);
      });
      cell.addEventListener("pointerenter", () => {
        hoveredGridCell = { row, column };
        if (isPainting) paintGridCell(row, column);
      });
      cell.addEventListener("pointerleave", () => {
        if (hoveredGridCell?.row === row && hoveredGridCell.column === column) {
          hoveredGridCell = null;
        }
      });
      buildGrid.append(cell);
    }
  }
  window.addEventListener("pointerup", () => {
    isPainting = false;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "r" || document.body.dataset.appMode !== "build") return;
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) return;
    const targetCell = hoveredGridCell ?? selectedGridCell;
    if (!targetCell) return;
    event.preventDefault();
    rotateGridCell(targetCell.row, targetCell.column);
  });
}

function selectBuildTool(tool: BuildTool): void {
  activeBuildTool = tool;
  selectedBuildTool.textContent = formatBuildTool(tool);
  for (const button of designToolButtons) {
    const buttonTool = button.dataset.designTool ?? button.dataset.buildTool;
    const selected = buttonTool === tool;
    button.setAttribute("aria-pressed", String(selected));
    const status = button.querySelector<HTMLElement>("[data-tool-status]");
    if (status) status.textContent = selected ? "Selected" : "Place";
  }
}

function paintGridCell(row: number, column: number): void {
  const key = gridCellKey(row, column);
  selectedGridCell = { row, column };
  if (activeBuildTool === "erase") {
    if (gridSignals.has(key)) gridSignals.delete(key);
    else gridCells.delete(key);
  } else if (activeBuildTool === "signal") {
    gridSignals.set(key, { row, column, rotation: 0 });
  } else {
    gridCells.set(key, { row, column, element: activeBuildTool, rotation: 0 });
  }
  syncBuildGrid();
}

function rotateGridCell(row: number, column: number): void {
  const key = gridCellKey(row, column);
  const signal = gridSignals.get(key);
  if (signal) {
    gridSignals.set(key, { ...signal, rotation: (signal.rotation + 1) % 4 });
    selectedGridCell = { row, column };
    syncBuildGrid();
    return;
  }
  const current = gridCells.get(key);
  if (!current) return;
  gridCells.set(key, { ...current, rotation: (current.rotation + 1) % 4 });
  selectedGridCell = { row, column };
  syncBuildGrid();
}

function seedGridLayout(layout: IntersectionLayout): void {
  gridCells.clear();
  gridSignals.clear();
  selectedGridCell = null;
  const center = Math.floor((BUILD_GRID_SIZE - 1) / 2);
  for (let column = 0; column < BUILD_GRID_SIZE; column += 1) {
    gridCells.set(gridCellKey(center, column), {
      row: center,
      column,
      element: "lane",
      rotation: 1,
    });
  }
  if (layout === "four-way") {
    for (let row = 0; row < BUILD_GRID_SIZE; row += 1) {
      gridCells.set(gridCellKey(row, center), {
        row,
        column: center,
        element: "lane",
        rotation: 0,
      });
    }
  } else if (layout === "t-junction") {
    for (let row = 0; row <= center; row += 1) {
      gridCells.set(gridCellKey(row, center), {
        row,
        column: center,
        element: "lane",
        rotation: 0,
      });
    }
  }
  if (layout !== "straight") {
    gridCells.set(gridCellKey(center, center), {
      row: center,
      column: center,
      element: "asphalt",
      rotation: 0,
    });
  }
  syncBuildGrid();
}

function rotateGridDesign(): void {
  const rotated = new Map<string, GridCellDesign>();
  for (const cell of gridCells.values()) {
    const row = cell.column;
    const column = BUILD_GRID_SIZE - 1 - cell.row;
    rotated.set(gridCellKey(row, column), {
      ...cell,
      row,
      column,
      rotation: (cell.rotation + 1) % 4,
    });
  }
  gridCells.clear();
  for (const [key, cell] of rotated) gridCells.set(key, cell);

  const rotatedSignals = new Map<string, GridSignalDesign>();
  for (const signal of gridSignals.values()) {
    const row = signal.column;
    const column = BUILD_GRID_SIZE - 1 - signal.row;
    rotatedSignals.set(gridCellKey(row, column), {
      row,
      column,
      rotation: (signal.rotation + 1) % 4,
    });
  }
  gridSignals.clear();
  for (const [key, signal] of rotatedSignals) gridSignals.set(key, signal);
  syncBuildGrid();
}

function syncBuildGrid(): void {
  renderer.setGridDesign([...gridCells.values()], [...gridSignals.values()]);
  const cellButtons = buildGrid.querySelectorAll<HTMLButtonElement>(".build-grid-cell");
  for (const cellButton of cellButtons) {
    const row = Number(cellButton.dataset.row);
    const column = Number(cellButton.dataset.column);
    const design = gridCells.get(gridCellKey(row, column));
    const signal = gridSignals.get(gridCellKey(row, column));
    cellButton.dataset.element = design?.element ?? "empty";
    cellButton.dataset.rotation = String(design?.rotation ?? 0);
    cellButton.dataset.signal = String(Boolean(signal));
    cellButton.style.setProperty("--signal-rotation", `${(signal?.rotation ?? 0) * 90}deg`);
    cellButton.setAttribute(
      "aria-selected",
      String(selectedGridCell?.row === row && selectedGridCell.column === column),
    );
    cellButton.setAttribute(
      "aria-label",
      `Grid row ${row + 1}, column ${column + 1}: ${design?.element ?? "empty"}${
        signal ? " with traffic signal" : ""
      }`,
    );
  }
}

function gridCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function isBuildTool(value: string | undefined): value is BuildTool {
  return value === "lane"
    || value === "white-lane"
    || value === "asphalt"
    || value === "sidewalk"
    || value === "crosswalk"
    || value === "signal"
    || value === "erase";
}

function isIntersectionLayout(value: string | undefined): value is IntersectionLayout {
  return value === "four-way" || value === "t-junction" || value === "straight";
}

function formatBuildTool(tool: BuildTool): string {
  if (tool === "erase") return "Bulldoze";
  if (tool === "lane") return "Yellow lane";
  if (tool === "white-lane") return "White lane";
  if (tool === "asphalt") return "Intersection tile";
  if (tool === "sidewalk") return "Sidewalk";
  if (tool === "crosswalk") return "Crosswalk";
  return "Traffic signal";
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
createBuildGrid();
seedGridLayout("four-way");
selectBuildTool("lane");
setAppMode("build");
renderer.render(simulation.getState());
updateHeatLegend("none");
updateInterface();
window.requestAnimationFrame(animationFrame);
