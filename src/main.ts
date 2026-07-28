import "./styles.css";
import { Simulation } from "./core/simulation";
import { PENN_LANDMARKS } from "./data/pennRoadGraph";
import type {
  AppMode,
  BuildTool,
  CameraMode,
  DesignImpact,
  DistrictFeature,
  EnvironmentMode,
  FeatureDesign,
  LaneDirection,
  ManualSignalTarget,
  MapOverlayMode,
  SignalControlMode,
  SignalTiming,
} from "./models/types";
import type {
  BuildingConnectionKind,
  DetailedBuilding,
  DetailedPerson,
  EntitySelection,
} from "./models/entityTypes";
import type { TimeHorizon } from "./models/cityTypes";
import { ThreeRenderer } from "./rendering/threeRenderer";

const canvas = requireElement<HTMLCanvasElement>("simulation-canvas");
const simulationTitle = requireElement<HTMLElement>("simulation-title");
const sceneSubtitle = requireElement<HTMLElement>("scene-subtitle");
const buildModeButton = requireElement<HTMLButtonElement>("build-mode-button");
const simulateModeButton = requireElement<HTMLButtonElement>("simulate-mode-button");
const orbitCameraButton = requireElement<HTMLButtonElement>("orbit-camera-button");
const flyCameraButton = requireElement<HTMLButtonElement>("fly-camera-button");
const walkCameraButton = requireElement<HTMLButtonElement>("walk-camera-button");
const environmentMode = requireElement<HTMLElement>("environment-mode");
const orbitCameraHint = requireElement<HTMLElement>("orbit-camera-hint");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const speedControl = requireElement<HTMLInputElement>("speed-control");
const speedOutput = requireElement<HTMLOutputElement>("speed-output");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const pedestrianVolumeOutput = requireElement<HTMLOutputElement>("pedestrian-volume-output");
const cityDate = requireElement<HTMLElement>("city-date");
const cityClock = requireElement<HTMLElement>("city-clock");
const timeHorizonControl = requireElement<HTMLSelectElement>("time-horizon-control");
const commuteTripShare = requireElement<HTMLElement>("commute-trip-share");
const shoppingTripShare = requireElement<HTMLElement>("shopping-trip-share");
const freightTripShare = requireElement<HTMLElement>("freight-trip-share");
const speedLimitControl = requireElement<HTMLInputElement>("speed-limit-control");
const signalCycleControl = requireElement<HTMLInputElement>("signal-cycle-control");
const simulationSeedControl = requireElement<HTMLInputElement>("simulation-seed-control");
const signalEditor = requireElement<HTMLElement>("signal-editor");
const signalModeControl = requireElement<HTMLSelectElement>("signal-mode-control");
const signalNorthSouthGreen = requireElement<HTMLInputElement>("signal-ns-green");
const signalEastWestGreen = requireElement<HTMLInputElement>("signal-ew-green");
const signalYellow = requireElement<HTMLInputElement>("signal-yellow");
const signalAllRed = requireElement<HTMLInputElement>("signal-all-red");
const signalPedestrian = requireElement<HTMLInputElement>("signal-pedestrian");
const signalCurrentPhase = requireElement<HTMLElement>("signal-current-phase");
const signalNextPhase = requireElement<HTMLElement>("signal-next-phase");
const signalTimeRemaining = requireElement<HTMLElement>("signal-time-remaining");
const manualSignalControls = requireElement<HTMLElement>("manual-signal-controls");
const manualNorthSouthButton = requireElement<HTMLButtonElement>("manual-ns-button");
const manualEastWestButton = requireElement<HTMLButtonElement>("manual-ew-button");
const manualAllRedButton = requireElement<HTMLButtonElement>("manual-all-red-button");
const statusPill = requireElement<HTMLElement>("status-pill");
const signalPhase = requireElement<HTMLElement>("signal-phase");
const selectionTitle = requireElement<HTMLElement>("selection-title");
const selectionDescription = requireElement<HTMLElement>("selection-description");
const selectionStatus = requireElement<HTMLElement>("selection-status");
const featureKind = requireElement<HTMLElement>("feature-kind");
const designSummary = requireElement<HTMLElement>("design-summary");
const vehicleTime = requireElement<HTMLElement>("vehicle-time");
const congestion = requireElement<HTMLElement>("congestion");
const pedestrianWait = requireElement<HTMLElement>("pedestrian-wait");
const conflicts = requireElement<HTMLElement>("conflicts");
const throughput = requireElement<HTMLElement>("throughput");
const activeVehicles = requireElement<HTMLElement>("active-vehicles");
const activePedestrians = requireElement<HTMLElement>("active-pedestrians");
const crossingsCompleted = requireElement<HTMLElement>("crossings-completed");
const averageSpeed = requireElement<HTMLElement>("average-speed");
const intersectionDelay = requireElement<HTMLElement>("intersection-delay");
const cityPopulation = requireElement<HTMLElement>("city-population");
const cityOutput = requireElement<HTMLElement>("city-output");
const cityUnemployment = requireElement<HTMLElement>("city-unemployment");
const cityUtilities = requireElement<HTMLElement>("city-utilities");
const cityImports = requireElement<HTMLElement>("city-imports");
const cityMigration = requireElement<HTMLElement>("city-migration");
const representationNote = requireElement<HTMLElement>("representation-note");
const baselineMetricsButton = requireElement<HTMLButtonElement>("baseline-metrics-button");
const modifiedMetricsButton = requireElement<HTMLButtonElement>("modified-metrics-button");
const metricsKicker = requireElement<HTMLElement>("metrics-kicker");
const analysisOverlay = requireElement<HTMLSelectElement>("analysis-overlay");
const entityInspector = requireElement<HTMLElement>("entity-inspector");
const mapLegend = requireElement<HTMLElement>("map-legend");
const alertCount = requireElement<HTMLElement>("alert-count");
const groupedAlerts = requireElement<HTMLElement>("grouped-alerts");
const entityTooltip = requireElement<HTMLElement>("entity-tooltip");
const flowControls = requireElement<HTMLFieldSetElement>("flow-controls");
const settingsButton = requireElement<HTMLButtonElement>("settings-button");
const settingsCloseButton = requireElement<HTMLButtonElement>("settings-close-button");
const settingsDrawer = requireElement<HTMLElement>("settings-drawer");
const settingsScrim = requireElement<HTMLButtonElement>("settings-scrim");
const speedLimitOutput = requireElement<HTMLOutputElement>("speed-limit-output");
const signalCycleOutput = requireElement<HTMLOutputElement>("signal-cycle-output");
const transitHeadwayControl = requireElement<HTMLInputElement>("transit-headway-control");
const transitHeadwayOutput = requireElement<HTMLOutputElement>("transit-headway-output");
const roadCapacityControl = requireElement<HTMLInputElement>("road-capacity-control");
const roadCapacityOutput = requireElement<HTMLOutputElement>("road-capacity-output");
const utilityCapacityControl = requireElement<HTMLInputElement>("utility-capacity-control");
const utilityCapacityOutput = requireElement<HTMLOutputElement>("utility-capacity-output");
const zoningControl = requireElement<HTMLInputElement>("zoning-control");
const zoningOutput = requireElement<HTMLOutputElement>("zoning-output");
const timeHorizonPreview = requireElement<HTMLElement>("time-horizon-preview");
const speedLimitPreview = requireElement<HTMLElement>("speed-limit-preview");
const signalCyclePreview = requireElement<HTMLElement>("signal-cycle-preview");
const transitHeadwayPreview = requireElement<HTMLElement>("transit-headway-preview");
const roadCapacityPreview = requireElement<HTMLElement>("road-capacity-preview");
const utilityCapacityPreview = requireElement<HTMLElement>("utility-capacity-preview");
const zoningPreview = requireElement<HTMLElement>("zoning-preview");
const locationSearch = requireElement<HTMLFormElement>("location-search");
const locationSearchInput = requireElement<HTMLInputElement>("location-search-input");
const locationOptions = requireElement<HTMLDataListElement>("location-options");
const buildToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-tool]"),
);

const simulation = new Simulation();
simulation.setSimulationSeed(createSessionSeed());
simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
const renderer = new ThreeRenderer(canvas);
const designs = new Map<string, FeatureDesign>();
const features = renderer.getFeatures();
let appMode: AppMode = "build";
let cameraMode: CameraMode = "orbit";
let metricView: "baseline" | "modified" = "modified";
let selectedFeature = features.find((feature) => feature.id === "walnut-34-36") ?? features[0];
let selectedEntity: EntitySelection | null = null;
let entityInterfaceSignature = "";
let previousTimestamp = performance.now();

buildModeButton.addEventListener("click", () => setAppMode("build"));
simulateModeButton.addEventListener("click", () => setAppMode("simulate"));
orbitCameraButton.addEventListener("click", () => setCameraMode("orbit"));
flyCameraButton.addEventListener("click", () => setCameraMode("fly"));
walkCameraButton.addEventListener("click", () => setCameraMode("walk"));

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

resetDesignButton.addEventListener("click", () => {
  designs.clear();
  syncDesign();
  selectionStatus.textContent = "All campus street interventions were reset.";
});

speedControl.addEventListener("input", () => {
  const speed = Number(speedControl.value);
  simulation.setSimulationSpeed(speed);
  speedOutput.value = `${speed.toFixed(1)}×`;
});

timeHorizonControl.addEventListener("change", () => {
  simulation.setTimeHorizon(timeHorizonControl.value as TimeHorizon);
  updateControlPreviews();
  updateInterface();
});

speedLimitControl.addEventListener("change", () => {
  simulation.setSpeedLimit(Number(speedLimitControl.value));
  speedLimitControl.value = String(simulation.getSettings().speedLimitMph);
  updateControlPreviews();
});

signalCycleControl.addEventListener("change", () => {
  simulation.setSignalCycle(Number(signalCycleControl.value));
  signalCycleControl.value = String(simulation.getSettings().signalCycleSeconds);
  updateControlPreviews();
  updateSelectionPanel();
});

simulationSeedControl.addEventListener("change", () => {
  simulation.setSimulationSeed(Number(simulationSeedControl.value));
  simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
  updateInterface();
});

signalModeControl.addEventListener("change", () => {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  simulation.setSignalMode(
    selectedFeature.id,
    signalModeControl.value as SignalControlMode,
  );
  updateSelectedSignalStatus();
  selectionStatus.textContent = `${formatSignalMode(signalModeControl.value as SignalControlMode)} control enabled at ${selectedFeature.name}.`;
});

for (const input of [
  signalNorthSouthGreen,
  signalEastWestGreen,
  signalYellow,
  signalAllRed,
  signalPedestrian,
]) {
  input.addEventListener("change", updateSelectedSignalTiming);
}

manualNorthSouthButton.addEventListener("click", () => {
  requestManualSignal("ns-green");
});
manualEastWestButton.addEventListener("click", () => {
  requestManualSignal("ew-green");
});
manualAllRedButton.addEventListener("click", () => {
  requestManualSignal("all-red");
});

for (const button of buildToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.buildTool;
    if (isBuildTool(tool)) applyBuildTool(tool);
  });
}

baselineMetricsButton.addEventListener("click", () => setMetricView("baseline"));
modifiedMetricsButton.addEventListener("click", () => setMetricView("modified"));

analysisOverlay.addEventListener("change", () => {
  renderer.setMapOverlay(analysisOverlay.value as MapOverlayMode);
  entityInterfaceSignature = "";
  updateEntityInterface();
});

flowControls.addEventListener("change", () => {
  const visible = new Set(
    Array.from(flowControls.querySelectorAll<HTMLInputElement>("input:checked"))
      .map((input) => input.value as BuildingConnectionKind),
  );
  renderer.setVisibleFlowKinds(visible);
});

settingsButton.addEventListener("click", () => setSettingsOpen(true));
settingsCloseButton.addEventListener("click", () => setSettingsOpen(false));
settingsScrim.addEventListener("click", () => setSettingsOpen(false));

transitHeadwayControl.addEventListener("input", () => {
  simulation.setTransitHeadway(Number(transitHeadwayControl.value));
  updateControlPreviews();
});
roadCapacityControl.addEventListener("input", () => {
  simulation.setRoadCapacity(Number(roadCapacityControl.value));
  updateControlPreviews();
});
utilityCapacityControl.addEventListener("input", () => {
  simulation.setUtilityCapacityScale(Number(utilityCapacityControl.value) / 100);
  updateControlPreviews();
});
zoningControl.addEventListener("input", () => {
  simulation.setZoningStrictness(Number(zoningControl.value) / 100);
  updateControlPreviews();
});

locationSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  flyToSearchResult(locationSearchInput.value);
});

renderer.setSelectionHandler((feature) => {
  if (appMode !== "build") return;
  selectedFeature = feature;
  renderer.setSelectedFeature(feature.id);
  updateSelectionPanel();
});

renderer.setEntitySelectionHandler((selection) => {
  if (appMode !== "simulate") return;
  selectedEntity = selection;
  renderer.setSelectedEntity(selection);
  entityInterfaceSignature = "";
  updateEntityInterface();
});

renderer.setEntityHoverHandler((selection, clientX, clientY) => {
  updateEntityTooltip(selection, clientX, clientY);
});

renderer.setEnvironmentStatusHandler((mode, detail) => {
  updateEnvironmentStatus(mode, detail);
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
  updateMetrics();
  window.requestAnimationFrame(animationFrame);
}

function setAppMode(mode: AppMode): void {
  appMode = mode;
  document.body.dataset.appMode = mode;
  const building = mode === "build";
  buildModeButton.setAttribute("aria-pressed", String(building));
  simulateModeButton.setAttribute("aria-pressed", String(!building));
  renderer.setBuildMode(building);
  renderer.setMapOverlay(
    building ? "none" : (analysisOverlay.value as MapOverlayMode),
  );
  renderer.setSelectedEntity(building ? null : selectedEntity);
  if (building) {
    orbitCameraHint.textContent = "Drag to orbit · Scroll to zoom · Click a highlighted street";
    updateSelectionPanel();
  } else {
    orbitCameraHint.textContent = "Drag to orbit · Scroll to zoom · Click a building or person";
    simulationTitle.textContent = "Penn · University City";
    sceneSubtitle.textContent = "Live traffic, pedestrian, and signal operations";
  }
  entityInterfaceSignature = "";
  updateInterface();
}

function setCameraMode(mode: CameraMode): void {
  cameraMode = mode;
  document.body.dataset.cameraMode = mode;
  orbitCameraButton.setAttribute("aria-pressed", String(mode === "orbit"));
  flyCameraButton.setAttribute("aria-pressed", String(mode === "fly"));
  walkCameraButton.setAttribute("aria-pressed", String(mode === "walk"));
  renderer.setCameraMode(mode);
}

function updateEnvironmentStatus(mode: EnvironmentMode, detail: string): void {
  environmentMode.textContent = mode === "rendered" ? "Rendered" : "Loading";
  environmentMode.parentElement?.setAttribute("data-environment", mode);
  environmentMode.parentElement?.setAttribute("title", detail);
}

function updateInterface(): void {
  const state = simulation.getState();
  statusPill.dataset.status = state.running ? "running" : "paused";
  statusPill.textContent = state.running
    ? "Running"
    : state.elapsedSeconds > 0
      ? "Paused"
      : "Ready";
  runButton.disabled = state.running;
  pauseButton.disabled = !state.running;
  renderer.render(state);
  updateMetrics();
}

function updateMetrics(): void {
  const state = simulation.getState();
  const metrics =
    metricView === "baseline" ? simulation.getBaselineMetrics() : state.metrics;
  vehicleTime.textContent = `${metrics.vehicleTravelSeconds.toFixed(1)} s`;
  averageSpeed.textContent = `${metrics.averageSpeedMph.toFixed(1)} mph`;
  congestion.textContent = String(metrics.congestion);
  intersectionDelay.textContent = `${metrics.intersectionDelaySeconds.toFixed(1)} s`;
  pedestrianWait.textContent = `${metrics.pedestrianWaitSeconds.toFixed(1)} s`;
  conflicts.textContent = String(metrics.potentialConflicts);
  throughput.textContent = metrics.throughputPerHour.toLocaleString();
  activeVehicles.textContent = metrics.activeVehicles.toLocaleString();
  activePedestrians.textContent = metrics.activePedestrians.toLocaleString();
  crossingsCompleted.textContent = metrics.crossingsCompleted.toLocaleString();
  signalPhase.textContent = formatSignalPhase(state.signalPhase);
  cityDate.textContent = state.cityActivity.dateLabel;
  cityClock.textContent = state.cityActivity.clockLabel;
  vehicleVolumeOutput.value = formatVolume(state.cityActivity.vehicleDemandLevel);
  pedestrianVolumeOutput.value = formatVolume(
    state.cityActivity.pedestrianDemandLevel,
  );
  commuteTripShare.textContent = `Work ${state.cityActivity.commuteSharePercent}%`;
  shoppingTripShare.textContent = `Shopping ${state.cityActivity.shoppingSharePercent}%`;
  freightTripShare.textContent = `Freight ${state.cityActivity.freightSharePercent}%`;
  const cityMetrics = state.city.metrics;
  cityPopulation.textContent = Math.round(cityMetrics.population).toLocaleString();
  cityOutput.textContent = formatCurrency(cityMetrics.grossCityProductDaily);
  cityUnemployment.textContent = `${cityMetrics.unemploymentPercent.toFixed(1)}%`;
  cityUtilities.textContent = `${cityMetrics.utilityCoveragePercent.toFixed(0)}%`;
  cityImports.textContent = `${state.city.market.importDependencePercent.toFixed(0)}%`;
  cityMigration.textContent = `${formatSigned(cityMetrics.annualizedNetMigration)}/yr`;
  const visiblePeople = Math.max(
    1,
    metrics.activePedestrians + metrics.activeVehicles * 1.4,
  );
  const representedResidents = Math.max(
    1,
    Math.round(cityMetrics.population / visiblePeople / 10) * 10,
  );
  representationNote.textContent = `1 visible agent represents about ${representedResidents.toLocaleString()} residents; buildings represent district activity.`;
  updateSelectedSignalStatus();
  updateEntityInterface();
}

function setMetricView(view: "baseline" | "modified"): void {
  metricView = view;
  const baseline = view === "baseline";
  baselineMetricsButton.setAttribute("aria-pressed", String(baseline));
  modifiedMetricsButton.setAttribute("aria-pressed", String(!baseline));
  metricsKicker.textContent = baseline ? "Baseline network" : "Modified design";
  updateMetrics();
}

function updateSelectionPanel(): void {
  if (!selectedFeature) return;
  const design = getDesign(selectedFeature.id);
  selectionTitle.textContent = selectedFeature.name;
  selectionDescription.textContent = selectedFeature.description;
  featureKind.textContent = selectedFeature.kind === "street" ? "Street" : "Intersection";
  featureKind.dataset.kind = selectedFeature.kind;
  simulationTitle.textContent = selectedFeature.name;
  sceneSubtitle.textContent = selectedFeature.description;
  signalEditor.hidden = selectedFeature.kind !== "intersection";
  if (selectedFeature.kind === "intersection") {
    const signal = simulation.getSignal(selectedFeature.id);
    if (signal) {
      signalModeControl.value = signal.mode;
      signalNorthSouthGreen.value = String(
        signal.timing.northSouthGreenSeconds,
      );
      signalEastWestGreen.value = String(signal.timing.eastWestGreenSeconds);
      signalYellow.value = String(signal.timing.yellowSeconds);
      signalAllRed.value = String(signal.timing.allRedSeconds);
      signalPedestrian.value = String(signal.timing.pedestrianSeconds);
    }
    updateSelectedSignalStatus();
  }

  for (const button of buildToolButtons) {
    button.disabled = button.dataset.target !== selectedFeature.kind;
  }

  const summaries =
    selectedFeature.kind === "street"
      ? streetDesignSummaries(selectedFeature, design)
      : [
          design.crosswalk ? "High-vis crosswalk" : "Standard crosswalk",
          design.pedestrianIsland ? "Pedestrian island" : "No refuge island",
          `${signalCycleSeconds(selectedFeature.id).toFixed(0)} sec signal`,
        ];

  designSummary.replaceChildren(
    ...summaries.map((summary, index) => {
      const tag = document.createElement("span");
      tag.textContent = summary;
      tag.dataset.active = String(index === 0 || !summary.startsWith("No "));
      return tag;
    }),
  );
  selectionStatus.textContent = "Changes appear directly in the 3D street and update simulation results.";
}

function updateSelectedSignalTiming(): void {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  const timing: SignalTiming = {
    northSouthGreenSeconds: Number(signalNorthSouthGreen.value),
    eastWestGreenSeconds: Number(signalEastWestGreen.value),
    yellowSeconds: Number(signalYellow.value),
    allRedSeconds: Number(signalAllRed.value),
    pedestrianSeconds: Number(signalPedestrian.value),
  };
  simulation.setSignalTiming(selectedFeature.id, timing);
  const signal = simulation.getSignal(selectedFeature.id);
  if (signal) {
    signalNorthSouthGreen.value = String(signal.timing.northSouthGreenSeconds);
    signalEastWestGreen.value = String(signal.timing.eastWestGreenSeconds);
    signalYellow.value = String(signal.timing.yellowSeconds);
    signalAllRed.value = String(signal.timing.allRedSeconds);
    signalPedestrian.value = String(signal.timing.pedestrianSeconds);
  }
  updateSelectedSignalStatus();
  selectionStatus.textContent = `Live signal timing updated at ${selectedFeature.name}.`;
}

function requestManualSignal(target: ManualSignalTarget): void {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  simulation.requestManualSignal(selectedFeature.id, target);
  signalModeControl.value = "manual";
  updateSelectedSignalStatus();
  selectionStatus.textContent = `${formatSignalPhase(target)} requested with a safe yellow and all-red transition.`;
}

function updateSelectedSignalStatus(): void {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  const signal = simulation.getSignal(selectedFeature.id);
  if (!signal) return;
  signalModeControl.value = signal.mode;
  manualSignalControls.hidden = signal.mode !== "manual";
  signalCurrentPhase.textContent = formatSignalPhase(signal.phase);
  signalNextPhase.textContent = formatSignalPhase(signal.nextPhase);
  signalTimeRemaining.textContent =
    signal.timeRemainingSeconds === null
      ? "Held"
      : `${signal.timeRemainingSeconds.toFixed(1)} sec`;
  manualNorthSouthButton.setAttribute(
    "aria-pressed",
    String(signal.phase === "ns-green"),
  );
  manualEastWestButton.setAttribute(
    "aria-pressed",
    String(signal.phase === "ew-green"),
  );
  manualAllRedButton.setAttribute(
    "aria-pressed",
    String(signal.phase === "all-red"),
  );
}

function signalCycleSeconds(intersectionId: string): number {
  const timing = simulation.getSignal(intersectionId)?.timing;
  if (!timing) return simulation.getSettings().signalCycleSeconds;
  return (
    timing.northSouthGreenSeconds +
    timing.eastWestGreenSeconds +
    timing.yellowSeconds * 2 +
    timing.allRedSeconds * 3 +
    timing.pedestrianSeconds
  );
}

function applyBuildTool(tool: BuildTool): void {
  if (!selectedFeature) return;
  const streetTool = ["add-lane", "remove-lane", "bike-lane", "sidewalk", "direction"].includes(
    tool,
  );
  if (
    (streetTool && selectedFeature.kind !== "street") ||
    (!streetTool && selectedFeature.kind !== "intersection")
  ) {
    selectionStatus.textContent = `Select a ${streetTool ? "street segment" : "intersection"} first.`;
    return;
  }

  const design = getDesign(selectedFeature.id);
  if (tool === "add-lane") design.laneDelta = design.laneDelta === 1 ? 0 : 1;
  if (tool === "remove-lane") design.laneDelta = design.laneDelta === -1 ? 0 : -1;
  if (tool === "bike-lane") design.bikeLane = !design.bikeLane;
  if (tool === "sidewalk") design.widenedSidewalk = !design.widenedSidewalk;
  if (tool === "crosswalk") design.crosswalk = !design.crosswalk;
  if (tool === "island") design.pedestrianIsland = !design.pedestrianIsland;
  if (tool === "direction") design.laneDirection = nextDirection(design.laneDirection);

  designs.set(selectedFeature.id, design);
  syncDesign();
  selectionStatus.textContent = `${formatTool(tool)} applied to ${selectedFeature.name}.`;
}

function syncDesign(): void {
  renderer.setDesigns(designs);
  simulation.setRoadDesigns(designs);
  const impact: DesignImpact = {
    laneCapacityDelta: 0,
    bikeLanes: 0,
    sidewalkUpgrades: 0,
    crosswalks: 0,
    pedestrianIslands: 0,
  };
  for (const design of designs.values()) {
    impact.laneCapacityDelta += design.laneDelta;
    impact.bikeLanes += Number(design.bikeLane);
    impact.sidewalkUpgrades += Number(design.widenedSidewalk);
    impact.crosswalks += Number(design.crosswalk);
    impact.pedestrianIslands += Number(design.pedestrianIsland);
  }
  simulation.setDesignImpact(impact);
  updateSelectionPanel();
  updateMetrics();
}

function getDesign(featureId: string): FeatureDesign {
  const road = simulation.getRoadSegment(featureId);
  return (
    designs.get(featureId) ?? {
      laneDelta: 0,
      bikeLane: road?.lanes.some((lane) => lane.type === "bike") ?? false,
      widenedSidewalk: false,
      crosswalk: false,
      pedestrianIsland: false,
      laneDirection: road?.directionality ?? "two-way",
      signalCycleSeconds: simulation.getSettings().signalCycleSeconds,
    }
  );
}

function streetDesignSummaries(
  feature: DistrictFeature,
  design: Readonly<FeatureDesign>,
): string[] {
  const road = simulation.getRoadSegment(feature.id);
  if (!road) {
    return [
      formatLaneChange(design.laneDelta),
      formatDirection(design.laneDirection, feature.axis),
    ];
  }
  return [
    `${road.roadClass.replace("-", " ")} · ${road.travelLaneCount} travel lanes`,
    road.lanes.some((lane) => lane.type === "bike")
      ? "Protected bike lane"
      : "No bike lane",
    road.lanes.some((lane) => lane.type === "parking")
      ? "Curb parking lane"
      : "No parking lane",
    design.widenedSidewalk ? "Wider sidewalk" : "Standard sidewalk",
    formatDirection(road.directionality, feature.axis),
  ];
}

function updateEntityInterface(): void {
  if (appMode !== "simulate") return;
  const state = simulation.getState();
  const selectedPerson = selectedEntity?.kind === "person"
    ? state.entities.people.find((person) => person.id === selectedEntity?.id)
    : undefined;
  const signature = [
    state.entities.lastUpdatedDay,
    selectedPerson?.currentActivity ?? "static",
    selectedEntity?.kind ?? "none",
    selectedEntity?.id ?? "none",
    analysisOverlay.value,
  ].join(":");
  if (signature === entityInterfaceSignature) return;
  entityInterfaceSignature = signature;
  renderMapLegend(analysisOverlay.value as MapOverlayMode);
  renderGroupedAlerts();

  if (!selectedEntity) {
    const represented = Math.max(1, Math.round(state.city.metrics.population / Math.max(1, state.entities.people.length)));
    const localWorkers = state.entities.people.filter((person) => person.employment === "local").length;
    const externalWorkers = state.entities.people.filter((person) => person.employment === "external").length;
    entityInspector.innerHTML = `
      <div class="inspector-empty district-overview">
        <strong>University City model</strong>
        <p>Click any building or visible person to inspect the decisions behind the citywide totals.</p>
        <div class="inspector-stat-grid">
          <span><small>Modeled buildings</small><b>${state.entities.buildings.length}</b></span>
          <span><small>Sample residents</small><b>${state.entities.people.length}</b></span>
          <span><small>Local workers</small><b>${localWorkers}</b></span>
          <span><small>Outside workers</small><b>${externalWorkers}</b></span>
        </div>
        <p class="representation-callout">1 visible resident represents about ${represented.toLocaleString()} city residents. Every modeled building has its own function and accounting.</p>
        <details class="simulation-order">
          <summary>Today's simulation steps</summary>
          <ol>
            <li>Buildings request workers and supplies.</li>
            <li>Residents work, earn wages, and make service visits.</li>
            <li>Labor and utilities gate production and sales.</li>
            <li>Revenue, costs, prices, wages, and rent adjust.</li>
            <li>Households evaluate needs, finances, and migration.</li>
          </ol>
        </details>
      </div>`;
    return;
  }

  if (selectedEntity.kind === "building") {
    const building = state.entities.buildings.find((candidate) => candidate.id === selectedEntity?.id);
    if (building) renderBuildingInspector(building);
  } else {
    const person = state.entities.people.find((candidate) => candidate.id === selectedEntity?.id);
    if (person) renderPersonInspector(person);
  }
}

function renderBuildingInspector(building: DetailedBuilding): void {
  const state = simulation.getState();
  const accounting = building.accounting;
  const residents = building.residentIds.length;
  const employees = building.employeeIds.length;
  const connections = state.entities.connections.filter(
    (connection) => connection.fromBuildingId === building.id || connection.toBuildingId === building.id,
  );
  const connectionTotals = {
    commute: sumNumbers(connections.filter((connection) => connection.kind === "commute").map((connection) => connection.volume)),
    customer: sumNumbers(connections.filter((connection) => connection.kind === "customer").map((connection) => connection.volume)),
    supply: sumNumbers(connections.filter((connection) => connection.kind === "supply").map((connection) => connection.volume)),
  };
  const civic = isCivicFunction(building.function);
  const housing = building.function === "housing";
  const revenueLabel = housing ? "Rent" : civic ? "Funding + fees" : "Revenue";
  const netLabel = civic ? "Balance" : "Net";
  const maxFlow = Math.max(1, accounting.operatingRevenue, accounting.operatingCost);
  const utilityAverage = (
    (building.utilityService.power + building.utilityService.water + building.utilityService.waste) / 3
  ) * 100;
  const primaryStats = housing
    ? [
        ["Residents", `${residents} / ${building.residentCapacity}`],
        ["Daily rent", formatDetailedMoney(building.rentDaily)],
        ["Land value", formatDetailedMoney(building.landValue)],
        ["Utilities", `${utilityAverage.toFixed(0)}%`],
      ]
    : civic
      ? [
          ["Staff", `${employees} / ${accounting.requiredWorkers}`],
          ["Service visits", `${Math.round(accounting.serviceDelivered)} / ${Math.round(accounting.serviceDemand)}`],
          ["Service quality", `${Math.round(accounting.serviceQuality * 100)}%`],
          ["Daily wage", formatDetailedMoney(accounting.averageWage)],
        ]
      : [
          ["Employees", `${employees} / ${accounting.requiredWorkers}`],
          ["Customers", accounting.customers.toLocaleString()],
          ["Goods sold", accounting.goodsSold.toLocaleString()],
          ["Daily wage", formatDetailedMoney(accounting.averageWage)],
        ];
  entityInspector.innerHTML = `
    <article class="entity-card">
      <header class="entity-heading">
        <div><small>${formatBuildingFunction(building.function)} · ${escapeHtml(building.address)}</small><h3>${escapeHtml(building.name)}</h3></div>
        <span data-entity-status="${accounting.status}">${formatEntityStatus(accounting.status)}</span>
      </header>
      <div class="inspector-stat-grid">${primaryStats.map(([label, value]) => `<span><small>${label}</small><b>${value}</b></span>`).join("")}</div>
      <section class="accounting-section">
        <h4>${civic ? "Service accounting" : housing ? "Housing accounting" : "Business accounting"}</h4>
        <div class="accounting-flow">
          ${accountingNode(revenueLabel, accounting.operatingRevenue, maxFlow, "income")}
          <i>→</i>
          ${accountingNode("Costs", accounting.operatingCost, maxFlow, "cost")}
          <i>→</i>
          ${accountingNode(netLabel, accounting.profit, maxFlow, accounting.profit >= 0 ? "income" : "loss")}
        </div>
        <div class="cost-breakdown">
          <span>Payroll <b>${formatDetailedMoney(accounting.dailyWages)}</b></span>
          <span>Supplies <b>${formatDetailedMoney(accounting.supplyCost)}</b></span>
          <span>Transport <b>${formatDetailedMoney(accounting.transportCost)}</b></span>
          <span>Utilities <b>${formatDetailedMoney(accounting.utilityCost)}</b></span>
          <span>Maintenance <b>${formatDetailedMoney(accounting.maintenanceCost)}</b></span>
        </div>
        <p class="entity-diagnosis">${escapeHtml(accounting.diagnosis)}</p>
      </section>
      <section class="utility-strip">
        <h4>Utility service</h4>
        ${utilityMeter("Power", building.utilityService.power, "Regional electric grid")}
        ${utilityMeter("Water", building.utilityService.water, "Municipal water system")}
        ${utilityMeter("Waste", building.utilityService.waste, "Sanitation collection")}
      </section>
      <section class="connection-summary">
        <h4>Daily connections</h4>
        <div class="connection-totals">
          <span data-flow="commute"><b>${Math.round(connectionTotals.commute)}</b> commuters</span>
          <span data-flow="customer"><b>${Math.round(connectionTotals.customer)}</b> visits</span>
          <span data-flow="supply"><b>${Math.round(connectionTotals.supply)}</b> supply units</span>
        </div>
        <details><summary>Connected buildings</summary>${renderConnectionDetails(connections, building.id)}</details>
      </section>
    </article>`;
}

function renderPersonInspector(person: DetailedPerson): void {
  const state = simulation.getState();
  const buildingById = new Map(state.entities.buildings.map((building) => [building.id, building]));
  const household = state.entities.households.find((candidate) => candidate.id === person.householdId);
  const householdMembers = household?.memberIds
    .map((id) => state.entities.people.find((candidate) => candidate.id === id)?.name)
    .filter((name): name is string => Boolean(name)) ?? [];
  const net = person.dailyWage - person.dailySpending;
  const maxFlow = Math.max(1, person.dailyWage, person.dailySpending);
  entityInspector.innerHTML = `
    <article class="entity-card person-card">
      <header class="entity-heading">
        <div><small>${person.age} years old · ${formatEmployment(person.employment)}</small><h3>${escapeHtml(person.name)}</h3></div>
        <span data-migration="${person.migrationStatus}">${formatActivity(person.currentActivity)}</span>
      </header>
      <section class="schedule-section">
        <h4>Daily route</h4>
        <div class="schedule-timeline">${person.schedule.map((item) => {
          const buildingName = buildingById.get(item.buildingId)?.name ?? "Outside University City";
          return `<div><time>${formatMinute(item.startMinute)}</time><span data-activity="${item.activity}"></span><p><b>${formatActivity(item.activity)}</b><small>${escapeHtml(buildingName)} · ${formatMode(item.mode)} · ${item.travelMinutes} min</small></p></div>`;
        }).join("")}</div>
      </section>
      <section class="accounting-section">
        <h4>Daily finances</h4>
        <div class="accounting-flow">
          ${accountingNode("Wage", person.dailyWage, maxFlow, "income")}
          <i>→</i>
          ${accountingNode("Spending", person.dailySpending, maxFlow, "cost")}
          <i>→</i>
          ${accountingNode("Net", net, maxFlow, net >= 0 ? "income" : "loss")}
        </div>
        <div class="cost-breakdown">
          <span>Commute <b>${formatDetailedMoney(person.commuteCost)}</b></span>
          <span>Cash <b>${formatDetailedMoney(person.money)}</b></span>
          <span>Household <b>${householdMembers.length} people</b></span>
          <span>Shared balance <b>${formatDetailedMoney(household?.money ?? 0)}</b></span>
        </div>
      </section>
      <section class="needs-section">
        <h4>Needs and happiness <strong>${person.happiness.toFixed(0)}%</strong></h4>
        ${Object.entries(person.needs).map(([need, value]) => `<label><span>${capitalize(need)}</span><meter min="0" max="100" value="${value}"></meter><b>${value.toFixed(0)}</b></label>`).join("")}
      </section>
      <section class="household-section">
        <h4>Household</h4>
        <p>${householdMembers.map(escapeHtml).join(", ")}</p>
        <div class="cost-breakdown">
          <span>Income <b>${formatDetailedMoney(household?.dailyIncome ?? 0)}</b></span>
          <span>Housing <b>${formatDetailedMoney(household?.dailyExpenses.housing ?? 0)}</b></span>
          <span>Goods <b>${formatDetailedMoney(household?.dailyExpenses.goods ?? 0)}</b></span>
          <span>Transport <b>${formatDetailedMoney(household?.dailyExpenses.transport ?? 0)}</b></span>
        </div>
      </section>
      <p class="migration-callout" data-migration="${person.migrationStatus}"><b>${formatMigration(person.migrationStatus)}</b>${escapeHtml(person.migrationReason)}</p>
    </article>`;
}

function renderConnectionDetails(
  connections: ReturnType<Simulation["getState"]>["entities"]["connections"],
  selectedBuildingId: string,
): string {
  const buildingById = new Map(simulation.getState().entities.buildings.map((building) => [building.id, building.name]));
  const rows = connections.slice(0, 12).map((connection) => {
    const otherId = connection.fromBuildingId === selectedBuildingId
      ? connection.toBuildingId
      : connection.fromBuildingId;
    const name = buildingById.get(otherId)
      ?? (otherId === "outside-work" ? "Jobs outside the section" : "Regional suppliers");
    return `<li><span data-flow="${connection.kind}">${capitalize(connection.kind)}</span><b>${Math.round(connection.volume)}</b><small>${escapeHtml(name)}</small></li>`;
  }).join("");
  return `<ul class="connection-list">${rows || "<li>No active connections in this category.</li>"}</ul>`;
}

function renderMapLegend(mode: MapOverlayMode): void {
  const legends: Partial<Record<MapOverlayMode, readonly [string, string]>> = {
    economy: ["Low activity", "High activity"],
    profitability: ["Operating loss", "Strong surplus"],
    "land-value": ["Lower value", "Higher value"],
    utilities: ["Service shortage", "Fully served"],
    employment: ["Understaffed", "Fully staffed"],
    happiness: ["Low wellbeing", "High wellbeing"],
    migration: ["Leaving pressure", "Stable"],
    goods: ["Shortage", "Well stocked"],
  };
  const labels = legends[mode];
  mapLegend.innerHTML = labels
    ? `<span>${labels[0]}</span><i></i><span>${labels[1]}</span>`
    : mode === "none"
      ? "<span>Building rings show assigned functions.</span>"
      : `<span>${capitalize(mode.replace("-", " "))} is drawn on streets and intersections.</span>`;
}

function renderGroupedAlerts(): void {
  const state = simulation.getState();
  const events = state.entities.events;
  alertCount.textContent = String(events.length + state.cityEvents.length);
  const groups = new Map<string, string[]>();
  for (const entry of events) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry.message);
    groups.set(entry.category, list);
  }
  for (const entry of state.cityEvents) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry.message);
    groups.set(entry.category, list);
  }
  groupedAlerts.innerHTML = [...groups.entries()].map(([category, messages]) => `
    <section><h4>${capitalize(category.replace("-", " "))} <span>${messages.length}</span></h4>
    <ul>${messages.slice(0, 4).map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></section>`).join("")
    || "<p>No active warnings.</p>";
}

function updateEntityTooltip(
  selection: EntitySelection | null,
  clientX: number,
  clientY: number,
): void {
  if (!selection || appMode !== "simulate") {
    entityTooltip.hidden = true;
    return;
  }
  const state = simulation.getState();
  const mode = analysisOverlay.value as MapOverlayMode;
  if (selection.kind === "person") {
    const person = state.entities.people.find((candidate) => candidate.id === selection.id);
    if (!person) return;
    entityTooltip.innerHTML = `<strong>${escapeHtml(person.name)}</strong><span>${formatActivity(person.currentActivity)} · ${person.happiness.toFixed(0)}% happiness</span><small>${escapeHtml(person.migrationReason)}</small>`;
  } else {
    const building = state.entities.buildings.find((candidate) => candidate.id === selection.id);
    if (!building) return;
    entityTooltip.innerHTML = buildingTooltip(building, mode);
  }
  entityTooltip.hidden = false;
  entityTooltip.style.left = `${Math.min(window.innerWidth - 260, clientX + 14)}px`;
  entityTooltip.style.top = `${Math.min(window.innerHeight - 130, clientY + 14)}px`;
}

function buildingTooltip(building: DetailedBuilding, mode: MapOverlayMode): string {
  const accounting = building.accounting;
  const utility = Math.round((building.utilityService.power + building.utilityService.water + building.utilityService.waste) / 3 * 100);
  const residents = simulation.getState().entities.people.filter((person) => person.homeBuildingId === building.id);
  const trips = simulation.getState().entities.connections
    .filter((connection) => connection.fromBuildingId === building.id || connection.toBuildingId === building.id);
  let value = `${formatBuildingFunction(building.function)} · ${formatEntityStatus(accounting.status)}`;
  let why = accounting.diagnosis;
  if (mode === "profitability") value = `${formatDetailedMoney(accounting.operatingRevenue)} revenue − ${formatDetailedMoney(accounting.operatingCost)} costs = ${formatDetailedMoney(accounting.profit)}`;
  else if (mode === "economy") value = `${formatDetailedMoney(accounting.operatingRevenue)} daily activity · ${accounting.customers} customers`;
  else if (mode === "land-value") {
    value = `${formatDetailedMoney(building.landValue)} land value`;
    why = `Utility service ${utility}%, staffing ${Math.round(accounting.staffingRatio * 100)}%, and district congestion ${simulation.getState().city.metrics.congestionPercent.toFixed(0)}% drive this value.`;
  } else if (mode === "utilities") {
    value = `${utility}% utility service`;
    why = `Power comes from the regional grid, water from the municipal system, and waste from sanitation collection.`;
  } else if (mode === "employment") value = `${building.employeeIds.length} of ${accounting.requiredWorkers} required positions filled`;
  else if (mode === "happiness") {
    const happiness = residents.length > 0 ? sumNumbers(residents.map((person) => person.happiness)) / residents.length : accounting.serviceQuality * 100;
    value = `${happiness.toFixed(0)}% ${residents.length > 0 ? "resident happiness" : "service quality"}`;
    why = residents.length > 0 ? "Income, expenses, needs, commute, and service access determine this score." : accounting.diagnosis;
  } else if (mode === "migration") {
    const leaving = residents.filter((person) => person.migrationStatus !== "staying").length;
    value = `${leaving} of ${residents.length} residents considering departure`;
    why = leaving > 0 ? "Unemployment, negative finances, or unmet needs are the modeled causes." : "Residents currently have no strong pressure to leave.";
  } else if (mode === "goods") value = `${building.goodsInventory.toFixed(0)} units in stock · ${accounting.importedSupplies.toFixed(0)} imported`;
  else if (["congestion", "pedestrians", "conflicts"].includes(mode)) {
    value = `${Math.round(sumNumbers(trips.map((connection) => connection.volume)))} connected daily trips`;
    why = `Commutes, customer visits, and supply deliveries are the building's traffic causes.`;
  }
  return `<strong>${escapeHtml(building.name)}</strong><span>${escapeHtml(value)}</span><small>${escapeHtml(why)}</small>`;
}

function setSettingsOpen(open: boolean): void {
  settingsDrawer.hidden = !open;
  settingsScrim.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
}

function updateControlPreviews(): void {
  const settings = simulation.getSettings();
  speedLimitOutput.value = `${settings.speedLimitMph} mph`;
  signalCycleOutput.value = `${settings.signalCycleSeconds} sec`;
  transitHeadwayOutput.value = `${settings.transitHeadwayMinutes} min`;
  roadCapacityOutput.value = `${settings.roadCapacity}%`;
  utilityCapacityOutput.value = `${Math.round(settings.utilityCapacityScale * 100)}%`;
  zoningOutput.value = `${Math.round(settings.zoningStrictness * 100)}%`;
  timeHorizonPreview.textContent = {
    day: "Each real second advances one simulated hour.",
    week: "Each real second advances six simulated hours.",
    month: "Each real second advances one simulated day.",
    year: "Each real second advances one simulated week.",
  }[settings.timeHorizon];
  speedLimitPreview.textContent = settings.speedLimitMph > 30
    ? "Faster free-flow trips, with more braking distance and crossing exposure."
    : settings.speedLimitMph < 20
      ? "Lower conflict severity, but longer vehicle and delivery trips."
      : "Balanced travel time and crossing risk.";
  signalCyclePreview.textContent = Math.abs(settings.signalCycleSeconds - 75) < 15
    ? "Near the district's balanced cycle."
    : settings.signalCycleSeconds > 90
      ? "Longer vehicle phases can increase pedestrian waiting."
      : "Short phases can add stopping delay on busy approaches.";
  transitHeadwayPreview.textContent = `About ${(60 / settings.transitHeadwayMinutes).toFixed(1)} departures per hour; shorter waits cost more service capacity.`;
  roadCapacityPreview.textContent = settings.roadCapacity === 100
    ? "Baseline vehicle and delivery capacity."
    : `${Math.abs(settings.roadCapacity - 100)}% ${settings.roadCapacity > 100 ? "more" : "less"} capacity for commutes and freight.`;
  utilityCapacityPreview.textContent = settings.utilityCapacityScale >= 1
    ? "Current supply should meet modeled demand unless the city grows."
    : "Shortfalls directly reduce production and civic-service delivery.";
  zoningPreview.textContent = settings.zoningStrictness > 1
    ? "Tighter limits slow floor-area and housing growth."
    : settings.zoningStrictness < 1
      ? "Looser limits allow faster long-term development."
      : "Baseline limits on long-term development.";
}

function accountingNode(label: string, value: number, max: number, tone: string): string {
  const width = Math.max(8, Math.min(100, Math.abs(value) / max * 100));
  return `<span class="accounting-node" data-tone="${tone}"><small>${label}</small><b>${formatDetailedMoney(value)}</b><i style="width:${width}%"></i></span>`;
}

function utilityMeter(label: string, value: number, source: string): string {
  return `<label><span>${label}<small>${source}</small></span><meter min="0" max="1" value="${value}"></meter><b>${Math.round(value * 100)}%</b></label>`;
}

function isCivicFunction(buildingFunction: DetailedBuilding["function"]): boolean {
  return ["university", "library", "school", "clinic", "culture", "recreation"].includes(buildingFunction);
}

function formatBuildingFunction(value: DetailedBuilding["function"]): string {
  const names: Record<DetailedBuilding["function"], string> = {
    housing: "Residential building",
    retail: "Retail business",
    office: "Office employer",
    university: "University facility",
    library: "Community library",
    school: "School",
    clinic: "Health service",
    culture: "Cultural service",
    recreation: "Recreation service",
    parking: "Parking service",
    industrial: "Production and supply",
  };
  return names[value];
}

function formatEntityStatus(value: DetailedBuilding["accounting"]["status"]): string {
  return value === "understaffed" ? "Understaffed" : capitalize(value);
}

function formatEmployment(value: DetailedPerson["employment"]): string {
  return value === "external" ? "Works outside the section" : value === "local" ? "Locally employed" : capitalize(value);
}

function formatActivity(value: DetailedPerson["currentActivity"]): string {
  return value === "shop" ? "Shopping" : value === "healthcare" ? "Health visit" : capitalize(value);
}

function formatMode(value: DetailedPerson["schedule"][number]["mode"]): string {
  return value === "transit" ? "Transit" : capitalize(value);
}

function formatMigration(value: DetailedPerson["migrationStatus"]): string {
  return value === "staying" ? "Staying: " : value === "considering-leaving" ? "Considering leaving: " : "Moving out: ";
}

function formatMinute(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDetailedMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(value);
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as unknown as T;
}

function createSessionSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] & 0x7fffffff) || 1;
}

function isBuildTool(value: string | undefined): value is BuildTool {
  return (
    value === "add-lane" ||
    value === "remove-lane" ||
    value === "bike-lane" ||
    value === "sidewalk" ||
    value === "crosswalk" ||
    value === "island" ||
    value === "direction"
  );
}

function nextDirection(direction: LaneDirection): LaneDirection {
  if (direction === "two-way") return "forward";
  if (direction === "forward") return "reverse";
  return "two-way";
}

function formatVolume(volume: number): string {
  return ["Low", "Medium", "High"][volume - 1] ?? "Medium";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString()}`;
}

function formatLaneChange(laneDelta: number): string {
  if (laneDelta > 0) return "+1 vehicle lane";
  if (laneDelta < 0) return "−1 vehicle lane";
  return "Existing lane count";
}

function formatDirection(direction: LaneDirection, axis: DistrictFeature["axis"]): string {
  if (direction === "two-way") return "Two-way";
  if (axis === "x") return direction === "forward" ? "Eastbound only" : "Westbound only";
  return direction === "forward" ? "Southbound only" : "Northbound only";
}

function formatTool(tool: BuildTool): string {
  const names: Record<BuildTool, string> = {
    "add-lane": "Vehicle lane",
    "remove-lane": "Lane reduction",
    "bike-lane": "Protected bike lane",
    sidewalk: "Sidewalk widening",
    crosswalk: "High-visibility crosswalk",
    island: "Pedestrian island",
    direction: "Lane direction",
  };
  return names[tool];
}

function formatSignalPhase(phase: ReturnType<Simulation["getState"]>["signalPhase"]): string {
  if (phase === "ns-green") return "N/S green";
  if (phase === "ns-yellow") return "N/S yellow";
  if (phase === "ew-green") return "E/W green";
  if (phase === "ew-yellow") return "E/W yellow";
  if (phase === "pedestrian-walk") return "Pedestrian walk";
  return "All red";
}

function formatSignalMode(mode: SignalControlMode): string {
  return mode === "automatic" ? "Automatic" : "Manual";
}

function initializeSearch(): void {
  const optionNames = new Set<string>();
  for (const landmark of PENN_LANDMARKS) optionNames.add(landmark.name);
  for (const feature of features) optionNames.add(feature.name);
  locationOptions.replaceChildren(
    ...Array.from(optionNames)
      .sort()
      .map((name) => {
        const option = document.createElement("option");
        option.value = name;
        return option;
      }),
  );

}

function flyToSearchResult(rawQuery: string): void {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return;
  const landmark = PENN_LANDMARKS.find(
    (candidate) => candidate.name.toLowerCase() === query,
  );
  const feature = features.find(
    (candidate) =>
      candidate.name.toLowerCase() === query ||
      `${candidate.name} ${candidate.description}`.toLowerCase().includes(query),
  );
  const point = landmark ?? feature?.path[Math.floor(feature.path.length / 2)];
  if (!point) {
    locationSearchInput.setCustomValidity("Choose a listed Penn landmark or street.");
    locationSearchInput.reportValidity();
    return;
  }
  locationSearchInput.setCustomValidity("");
  renderer.flyTo(point);
  if (feature) {
    selectedFeature = feature;
    renderer.setSelectedFeature(feature.id);
    if (appMode === "build") updateSelectionPanel();
  } else if (landmark) {
    simulationTitle.textContent = landmark.name;
    sceneSubtitle.textContent = "Penn campus landmark";
  }
}

renderer.resize();
renderer.setSelectedFeature(selectedFeature?.id ?? null);
initializeSearch();
updateControlPreviews();
setCameraMode(cameraMode);
setAppMode("build");
simulation.start();
updateInterface();
window.requestAnimationFrame(animationFrame);
