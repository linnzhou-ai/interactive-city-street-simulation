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
  MapOverlayMode,
} from "./models/types";
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
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const speedControl = requireElement<HTMLInputElement>("speed-control");
const speedOutput = requireElement<HTMLOutputElement>("speed-output");
const vehicleVolumeControl = requireElement<HTMLInputElement>("vehicle-volume-control");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const pedestrianVolumeControl = requireElement<HTMLInputElement>("pedestrian-volume-control");
const pedestrianVolumeOutput = requireElement<HTMLOutputElement>("pedestrian-volume-output");
const speedLimitControl = requireElement<HTMLInputElement>("speed-limit-control");
const signalCycleControl = requireElement<HTMLInputElement>("signal-cycle-control");
const buildSignalCycle = requireElement<HTMLInputElement>("build-signal-cycle");
const buildSignalOutput = requireElement<HTMLOutputElement>("build-signal-output");
const signalEditor = requireElement<HTMLElement>("signal-editor");
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
const averageSpeed = requireElement<HTMLElement>("average-speed");
const intersectionDelay = requireElement<HTMLElement>("intersection-delay");
const rushHourButton = requireElement<HTMLButtonElement>("rush-hour-button");
const classChangeButton = requireElement<HTMLButtonElement>("class-change-button");
const baselineMetricsButton = requireElement<HTMLButtonElement>("baseline-metrics-button");
const modifiedMetricsButton = requireElement<HTMLButtonElement>("modified-metrics-button");
const metricsKicker = requireElement<HTMLElement>("metrics-kicker");
const analysisOverlay = requireElement<HTMLSelectElement>("analysis-overlay");
const locationSearch = requireElement<HTMLFormElement>("location-search");
const locationSearchInput = requireElement<HTMLInputElement>("location-search-input");
const locationOptions = requireElement<HTMLDataListElement>("location-options");
const buildToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-tool]"),
);

const simulation = new Simulation();
const renderer = new ThreeRenderer(canvas);
const designs = new Map<string, FeatureDesign>();
const features = renderer.getFeatures();
let appMode: AppMode = "build";
let cameraMode: CameraMode = "orbit";
let metricView: "baseline" | "modified" = "modified";
let selectedFeature = features.find((feature) => feature.id === "walnut-34-36") ?? features[0];
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

vehicleVolumeControl.addEventListener("input", () => {
  const volume = Number(vehicleVolumeControl.value);
  simulation.setVehicleVolume(volume);
  vehicleVolumeOutput.value = formatVolume(volume);
});

pedestrianVolumeControl.addEventListener("input", () => {
  const volume = Number(pedestrianVolumeControl.value);
  simulation.setPedestrianVolume(volume);
  pedestrianVolumeOutput.value = formatVolume(volume);
});

speedLimitControl.addEventListener("change", () => {
  simulation.setSpeedLimit(Number(speedLimitControl.value));
  speedLimitControl.value = String(simulation.getSettings().speedLimitMph);
});

signalCycleControl.addEventListener("change", () => {
  simulation.setSignalCycle(Number(signalCycleControl.value));
  signalCycleControl.value = String(simulation.getSettings().signalCycleSeconds);
});

buildSignalCycle.addEventListener("input", () => {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  const design = getDesign(selectedFeature.id);
  design.signalCycleSeconds = Number(buildSignalCycle.value);
  designs.set(selectedFeature.id, design);
  simulation.setSignalCycle(design.signalCycleSeconds);
  signalCycleControl.value = String(design.signalCycleSeconds);
  buildSignalOutput.value = `${design.signalCycleSeconds} sec`;
  syncDesign();
  selectionStatus.textContent = `Signal timing updated at ${selectedFeature.name}.`;
});

for (const button of buildToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.buildTool;
    if (isBuildTool(tool)) applyBuildTool(tool);
  });
}

rushHourButton.addEventListener("click", () => {
  applyScenario({ vehicleVolume: 3, pedestrianVolume: 2, speedLimitMph: 25, signalCycle: 85 });
});

classChangeButton.addEventListener("click", () => {
  applyScenario({ vehicleVolume: 1, pedestrianVolume: 3, speedLimitMph: 15, signalCycle: 55 });
});

baselineMetricsButton.addEventListener("click", () => setMetricView("baseline"));
modifiedMetricsButton.addEventListener("click", () => setMetricView("modified"));

analysisOverlay.addEventListener("change", () => {
  renderer.setMapOverlay(analysisOverlay.value as MapOverlayMode);
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

renderer.setEnvironmentStatusHandler((mode, detail) => {
  updateEnvironmentStatus(mode, detail);
});

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.render(simulation.getState(), simulation.getSettings());
});

function animationFrame(timestamp: number): void {
  const deltaSeconds = (timestamp - previousTimestamp) / 1000;
  previousTimestamp = timestamp;
  simulation.update(deltaSeconds);
  renderer.render(simulation.getState(), simulation.getSettings());
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
  if (building) {
    updateSelectionPanel();
  } else {
    simulationTitle.textContent = "Penn · University City";
    sceneSubtitle.textContent = "Live traffic, pedestrian, and signal operations";
  }
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
  renderer.render(state, simulation.getSettings());
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
  signalPhase.textContent = formatSignalPhase(state.signalPhase);
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
  buildSignalCycle.value = String(design.signalCycleSeconds);
  buildSignalOutput.value = `${design.signalCycleSeconds} sec`;

  for (const button of buildToolButtons) {
    button.disabled = button.dataset.target !== selectedFeature.kind;
  }

  const summaries =
    selectedFeature.kind === "street"
      ? [
          formatLaneChange(design.laneDelta),
          design.bikeLane ? "Protected bike lane" : "No bike lane",
          design.widenedSidewalk ? "Wider sidewalk" : "Standard sidewalk",
          formatDirection(design.laneDirection, selectedFeature.axis),
        ]
      : [
          design.crosswalk ? "High-vis crosswalk" : "Standard crosswalk",
          design.pedestrianIsland ? "Pedestrian island" : "No refuge island",
          `${design.signalCycleSeconds} sec signal`,
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
  return (
    designs.get(featureId) ?? {
      laneDelta: 0,
      bikeLane: false,
      widenedSidewalk: false,
      crosswalk: false,
      pedestrianIsland: false,
      laneDirection: "two-way",
      signalCycleSeconds: simulation.getSettings().signalCycleSeconds,
    }
  );
}

function applyScenario(settings: {
  vehicleVolume: number;
  pedestrianVolume: number;
  speedLimitMph: number;
  signalCycle: number;
}): void {
  simulation.setVehicleVolume(settings.vehicleVolume);
  simulation.setPedestrianVolume(settings.pedestrianVolume);
  simulation.setSpeedLimit(settings.speedLimitMph);
  simulation.setSignalCycle(settings.signalCycle);
  vehicleVolumeControl.value = String(settings.vehicleVolume);
  vehicleVolumeOutput.value = formatVolume(settings.vehicleVolume);
  pedestrianVolumeControl.value = String(settings.pedestrianVolume);
  pedestrianVolumeOutput.value = formatVolume(settings.pedestrianVolume);
  speedLimitControl.value = String(settings.speedLimitMph);
  signalCycleControl.value = String(settings.signalCycle);
  updateInterface();
}

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as unknown as T;
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
  if (phase === "east-west") return "East–west traffic";
  if (phase === "north-south") return "North–south traffic";
  return "Pedestrian crossing";
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
setCameraMode(cameraMode);
setAppMode("build");
simulation.start();
updateInterface();
window.requestAnimationFrame(animationFrame);
