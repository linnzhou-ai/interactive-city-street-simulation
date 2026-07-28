import "./styles.css";
import { deriveBuildingRole } from "./core/buildingActivity";
import {
  EditHistory,
  PROJECT_STATE_VERSION,
  parseProjectSnapshot,
  type EditorSnapshot,
  type ProjectSnapshot,
} from "./core/projectState";
import { Simulation } from "./core/simulation";
import { PENN_LANDMARKS } from "./data/pennRoadGraph";
import type {
  AppMode,
  BuildingKind,
  BuildTool,
  CameraMode,
  DesignImpact,
  DistrictFeature,
  EnvironmentMode,
  FeatureDesign,
  LaneDirection,
  ManualSignalTarget,
  MapOverlayMode,
  PlacedBuilding,
  ScenarioSettings,
  SignalControlMode,
  SignalTiming,
  WeatherMode,
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
const undoButton = requireElement<HTMLButtonElement>("undo-button");
const redoButton = requireElement<HTMLButtonElement>("redo-button");
const environmentMode = requireElement<HTMLElement>("environment-mode");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const saveSlotControl = requireElement<HTMLSelectElement>("save-slot-control");
const saveProjectButton = requireElement<HTMLButtonElement>("save-project-button");
const loadProjectButton = requireElement<HTMLButtonElement>("load-project-button");
const exportProjectButton = requireElement<HTMLButtonElement>("export-project-button");
const importProjectButton = requireElement<HTMLButtonElement>("import-project-button");
const importProjectFile = requireElement<HTMLInputElement>("import-project-file");
const autosaveStatus = requireElement<HTMLElement>("autosave-status");
const buildingFloorsControl = requireElement<HTMLInputElement>("building-floors-control");
const buildingColorControl = requireElement<HTMLInputElement>("building-color-control");
const buildingEditor = requireElement<HTMLElement>("building-editor");
const buildingPositionOutput = requireElement<HTMLElement>("building-position-output");
const selectedBuildingKind = requireElement<HTMLSelectElement>("selected-building-kind");
const selectedBuildingFloors = requireElement<HTMLInputElement>("selected-building-floors");
const selectedBuildingColor = requireElement<HTMLInputElement>("selected-building-color");
const rotateBuildingButton = requireElement<HTMLButtonElement>("rotate-building-button");
const deleteBuildingButton = requireElement<HTMLButtonElement>("delete-building-button");
const buildingResidentsOutput = requireElement<HTMLElement>("building-residents-output");
const buildingJobsOutput = requireElement<HTMLElement>("building-jobs-output");
const buildingVisitorsOutput = requireElement<HTMLElement>("building-visitors-output");
const buildingFreightOutput = requireElement<HTMLElement>("building-freight-output");
const speedControl = requireElement<HTMLInputElement>("speed-control");
const speedOutput = requireElement<HTMLOutputElement>("speed-output");
const vehicleVolumeControl = requireElement<HTMLInputElement>("vehicle-volume-control");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const pedestrianVolumeControl = requireElement<HTMLInputElement>("pedestrian-volume-control");
const pedestrianVolumeOutput = requireElement<HTMLOutputElement>("pedestrian-volume-output");
const timeOfDayControl = requireElement<HTMLInputElement>("time-of-day-control");
const timeOfDayOutput = requireElement<HTMLOutputElement>("time-of-day-output");
const weatherControl = requireElement<HTMLSelectElement>("weather-control");
const demandPeriodOutput = requireElement<HTMLElement>("demand-period-output");
const pedestrianMarkersControl = requireElement<HTMLInputElement>(
  "pedestrian-markers-control",
);
const vehicleMarkersControl = requireElement<HTMLInputElement>("vehicle-markers-control");
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
const buildingArrivals = requireElement<HTMLElement>("building-arrivals");
const averageSpeed = requireElement<HTMLElement>("average-speed");
const intersectionDelay = requireElement<HTMLElement>("intersection-delay");
const rushHourButton = requireElement<HTMLButtonElement>("rush-hour-button");
const classChangeButton = requireElement<HTMLButtonElement>("class-change-button");
const baselineMetricsButton = requireElement<HTMLButtonElement>("baseline-metrics-button");
const modifiedMetricsButton = requireElement<HTMLButtonElement>("modified-metrics-button");
const metricsKicker = requireElement<HTMLElement>("metrics-kicker");
const analysisOverlay = requireElement<HTMLSelectElement>("analysis-overlay");
const districtResidentsOutput = requireElement<HTMLElement>("district-residents-output");
const districtJobsOutput = requireElement<HTMLElement>("district-jobs-output");
const districtVisitorsOutput = requireElement<HTMLElement>("district-visitors-output");
const districtFreightOutput = requireElement<HTMLElement>("district-freight-output");
const locationSearch = requireElement<HTMLFormElement>("location-search");
const locationSearchInput = requireElement<HTMLInputElement>("location-search-input");
const locationOptions = requireElement<HTMLDataListElement>("location-options");
const buildToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-tool]"),
);
const buildingToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-building-tool]"),
);

const simulation = new Simulation();
simulation.setSimulationSeed(createSessionSeed());
simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
const renderer = new ThreeRenderer(canvas);
const designs = new Map<string, FeatureDesign>();
const placedBuildings = new Map<string, PlacedBuilding>();
const features = renderer.getFeatures();
const editHistory = new EditHistory();
const AUTOSAVE_KEY = "penn-street-lab:autosave";
const SAVE_SLOT_PREFIX = "penn-street-lab:slot:";
let appMode: AppMode = "build";
let cameraMode: CameraMode = "orbit";
let metricView: "baseline" | "modified" = "modified";
let selectedFeature = features.find((feature) => feature.id === "walnut-34-36") ?? features[0];
let selectedPlacedBuildingId: string | null = null;
let activeBuildingTool: BuildingKind | null = "residential";
let nextBuildingId = 1;
let previousTimestamp = performance.now();
let dragStartSnapshot: EditorSnapshot | null = null;
let autosaveTimer: number | null = null;
let lastClockMinute = -1;

buildModeButton.addEventListener("click", () => setAppMode("build"));
simulateModeButton.addEventListener("click", () => setAppMode("simulate"));
orbitCameraButton.addEventListener("click", () => setCameraMode("orbit"));
flyCameraButton.addEventListener("click", () => setCameraMode("fly"));
walkCameraButton.addEventListener("click", () => setCameraMode("walk"));
undoButton.addEventListener("click", undoEdit);
redoButton.addEventListener("click", redoEdit);
saveProjectButton.addEventListener("click", saveProjectToSlot);
loadProjectButton.addEventListener("click", loadProjectFromSlot);
exportProjectButton.addEventListener("click", exportProject);
importProjectButton.addEventListener("click", () => importProjectFile.click());
importProjectFile.addEventListener("change", () => void importProject());

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
  syncEnvironmentControls();
  updateInterface();
});

resetDesignButton.addEventListener("click", () => {
  if (designs.size === 0 && placedBuildings.size === 0) return;
  recordEdit();
  designs.clear();
  placedBuildings.clear();
  selectedPlacedBuildingId = null;
  renderer.setPlacedBuildings([]);
  renderer.setSelectedPlacedBuilding(null);
  syncBuildingActivity();
  syncDesign();
  finishEdit("Empty design autosaved");
  selectionStatus.textContent = "All placed buildings and street interventions were reset.";
});

for (const button of buildingToolButtons) {
  button.addEventListener("click", () => {
    const kind = button.dataset.buildingTool;
    if (isBuildingKind(kind)) selectBuildingTool(kind);
  });
}

buildingFloorsControl.addEventListener("change", () => {
  buildingFloorsControl.value = String(clampFloors(Number(buildingFloorsControl.value)));
});
selectedBuildingFloors.addEventListener("change", updateSelectedBuilding);
selectedBuildingColor.addEventListener("change", updateSelectedBuilding);
selectedBuildingKind.addEventListener("change", updateSelectedBuilding);
rotateBuildingButton.addEventListener("click", rotateSelectedBuilding);
deleteBuildingButton.addEventListener("click", deleteSelectedBuilding);

speedControl.addEventListener("input", () => {
  const speed = Number(speedControl.value);
  simulation.setSimulationSpeed(speed);
  speedOutput.value = `${speed.toFixed(1)}×`;
  scheduleAutosave();
});

vehicleVolumeControl.addEventListener("input", () => {
  const volume = Number(vehicleVolumeControl.value);
  simulation.setVehicleVolume(volume);
  vehicleVolumeOutput.value = formatVolume(volume);
  scheduleAutosave();
});

pedestrianVolumeControl.addEventListener("input", () => {
  const volume = Number(pedestrianVolumeControl.value);
  simulation.setPedestrianVolume(volume);
  pedestrianVolumeOutput.value = formatVolume(volume);
  scheduleAutosave();
});

timeOfDayControl.addEventListener("input", () => {
  simulation.setTimeOfDay(Number(timeOfDayControl.value));
  syncEnvironmentControls();
  scheduleAutosave();
});

weatherControl.addEventListener("change", () => {
  simulation.setWeather(weatherControl.value as WeatherMode);
  syncEnvironmentControls();
  scheduleAutosave();
});

pedestrianMarkersControl.addEventListener("change", () => {
  renderer.setPedestrianMarkersVisible(pedestrianMarkersControl.checked);
});

vehicleMarkersControl.addEventListener("change", () => {
  renderer.setVehicleMarkersVisible(vehicleMarkersControl.checked);
});

speedLimitControl.addEventListener("change", () => {
  simulation.setSpeedLimit(Number(speedLimitControl.value));
  speedLimitControl.value = String(simulation.getSettings().speedLimitMph);
  scheduleAutosave();
});

signalCycleControl.addEventListener("change", () => {
  simulation.setSignalCycle(Number(signalCycleControl.value));
  signalCycleControl.value = String(simulation.getSettings().signalCycleSeconds);
  updateSelectionPanel();
  scheduleAutosave();
});

simulationSeedControl.addEventListener("change", () => {
  simulation.setSimulationSeed(Number(simulationSeedControl.value));
  simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
  updateInterface();
  scheduleAutosave();
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
    if (isBuildTool(tool)) {
      activeBuildingTool = null;
      renderer.setBuildingPlacementEnabled(false);
      buildingToolButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", "false"));
      applyBuildTool(tool);
    }
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
  selectedPlacedBuildingId = null;
  renderer.setSelectedPlacedBuilding(null);
  selectedFeature = feature;
  renderer.setSelectedFeature(feature.id);
  updateSelectionPanel();
});

renderer.setBuildingInteractionHandlers({
  onPlace: (x, z) => placeBuilding(x, z),
  onSelect: (id) => selectPlacedBuilding(id),
  onMoveStart: () => {
    dragStartSnapshot = captureEditorSnapshot();
  },
  onMove: (id, x, z) => movePlacedBuilding(id, x, z),
  onMoveEnd: () => {
    if (
      dragStartSnapshot &&
      !editorSnapshotsEqual(dragStartSnapshot, captureEditorSnapshot())
    ) {
      editHistory.record(dragStartSnapshot);
      finishEdit("Building move autosaved");
    }
    dragStartSnapshot = null;
  },
  onPlacementRejected: (reason) => {
    selectionStatus.textContent = reason;
  },
});

renderer.setEnvironmentStatusHandler((mode, detail) => {
  updateEnvironmentStatus(mode, detail);
});

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.render(simulation.getState());
});

window.addEventListener("keydown", (event) => {
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key.toLowerCase() === "z" && !isTypingTarget(event.target)) {
    event.preventDefault();
    if (event.shiftKey) redoEdit();
    else undoEdit();
    return;
  }
  if (
    event.key.toLowerCase() !== "r" ||
    appMode !== "build" ||
    isTypingTarget(event.target)
  ) {
    return;
  }
  if (selectedPlacedBuildingId) {
    event.preventDefault();
    rotateSelectedBuilding();
  }
});

function animationFrame(timestamp: number): void {
  const deltaSeconds = (timestamp - previousTimestamp) / 1000;
  previousTimestamp = timestamp;
  simulation.update(deltaSeconds);
  const state = simulation.getState();
  renderer.render(state);
  const clockMinute = Math.floor(state.timeOfDayHours * 60);
  if (clockMinute !== lastClockMinute) {
    lastClockMinute = clockMinute;
    syncEnvironmentControls();
    if (clockMinute % 5 === 0) scheduleAutosave("Clock autosaved");
  }
  updateMetrics();
  window.requestAnimationFrame(animationFrame);
}

function setAppMode(mode: AppMode): void {
  appMode = mode;
  document.body.dataset.appMode = mode;
  const building = mode === "build";
  if (building && cameraMode !== "orbit") setCameraMode("orbit");
  flyCameraButton.disabled = building;
  walkCameraButton.disabled = building;
  buildModeButton.setAttribute("aria-pressed", String(building));
  simulateModeButton.setAttribute("aria-pressed", String(!building));
  renderer.setBuildMode(building);
  renderer.setBuildingPlacementEnabled(
    building && cameraMode === "orbit" && activeBuildingTool !== null,
  );
  renderer.setMapOverlay(
    building ? "none" : (analysisOverlay.value as MapOverlayMode),
  );
  if (building) {
    updateSelectionPanel();
  } else {
    simulationTitle.textContent = "Penn · University City";
    sceneSubtitle.textContent = "Live traffic, pedestrian, and signal operations";
  }
  updateHistoryButtons();
  updateInterface();
}

function setCameraMode(mode: CameraMode): void {
  cameraMode = mode;
  document.body.dataset.cameraMode = mode;
  orbitCameraButton.setAttribute("aria-pressed", String(mode === "orbit"));
  flyCameraButton.setAttribute("aria-pressed", String(mode === "fly"));
  walkCameraButton.setAttribute("aria-pressed", String(mode === "walk"));
  renderer.setCameraMode(mode);
  renderer.setBuildingPlacementEnabled(
    appMode === "build" && mode === "orbit" && activeBuildingTool !== null,
  );
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
  buildingArrivals.textContent = metrics.buildingArrivals.toLocaleString();
  signalPhase.textContent = formatSignalPhase(state.signalPhase);
  updateSelectedSignalStatus();
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
  if (selectedPlacedBuildingId) {
    const building = placedBuildings.get(selectedPlacedBuildingId);
    if (building) {
      renderPlacedBuildingSelection(building);
      return;
    }
  }
  if (!selectedFeature) return;
  buildingEditor.hidden = true;
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
      ? [
          formatLaneChange(design.laneDelta),
          design.bikeLane ? "Protected bike lane" : "No bike lane",
          design.widenedSidewalk ? "Wider sidewalk" : "Standard sidewalk",
          formatDirection(design.laneDirection, selectedFeature.axis),
        ]
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

function selectBuildingTool(kind: BuildingKind): void {
  if (cameraMode !== "orbit") setCameraMode("orbit");
  activeBuildingTool = kind;
  buildingColorControl.value = defaultBuildingColor(kind);
  renderer.setBuildingPlacementEnabled(appMode === "build" && cameraMode === "orbit");
  renderer.setSelectedFeature(null);
  buildingToolButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.buildingTool === kind));
  });
  selectionStatus.textContent = `Click anywhere on the ground to place a ${formatBuildingKind(kind).toLowerCase()} building.`;
}

function placeBuilding(x: number, z: number): void {
  if (!activeBuildingTool || appMode !== "build") return;
  const building: PlacedBuilding = {
    id: `placed-building-${nextBuildingId++}`,
    kind: activeBuildingTool,
    x,
    z,
    rotation: 0,
    floors: clampFloors(Number(buildingFloorsControl.value)),
    color: buildingColorControl.value,
  };
  const placement = renderer.validateBuildingPlacement(building);
  if (!placement.valid) {
    selectionStatus.textContent = placement.reason;
    return;
  }
  recordEdit();
  placedBuildings.set(building.id, building);
  renderer.setPlacedBuildings([...placedBuildings.values()]);
  syncBuildingActivity();
  selectPlacedBuilding(building.id);
  finishEdit("Building placement autosaved");
  selectionStatus.textContent = `${formatBuildingKind(building.kind)} building placed. Drag it to fine-tune the position.`;
}

function selectPlacedBuilding(id: string | null): void {
  selectedPlacedBuildingId = id;
  renderer.setSelectedPlacedBuilding(id);
  if (id) renderer.setSelectedFeature(null);
  updateSelectionPanel();
}

function movePlacedBuilding(id: string, x: number, z: number): void {
  const current = placedBuildings.get(id);
  if (!current) return;
  placedBuildings.set(id, { ...current, x, z });
  syncBuildingActivity();
  if (selectedPlacedBuildingId === id) {
    buildingPositionOutput.textContent = formatBuildingPosition(x, z);
  }
}

function updateSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  const current = placedBuildings.get(selectedPlacedBuildingId);
  if (!current) return;
  const updated: PlacedBuilding = {
    ...current,
    kind: selectedBuildingKind.value as BuildingKind,
    floors: clampFloors(Number(selectedBuildingFloors.value)),
    color: selectedBuildingColor.value,
  };
  const placement = renderer.validateBuildingPlacement(updated, updated.id);
  if (!placement.valid) {
    selectedBuildingKind.value = current.kind;
    selectedBuildingFloors.value = String(current.floors);
    selectionStatus.textContent = placement.reason;
    return;
  }
  recordEdit();
  selectedBuildingFloors.value = String(updated.floors);
  placedBuildings.set(updated.id, updated);
  renderer.setPlacedBuildings([...placedBuildings.values()]);
  syncBuildingActivity();
  renderer.setSelectedPlacedBuilding(updated.id);
  renderPlacedBuildingSelection(updated);
  finishEdit("Building edit autosaved");
}

function rotateSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  const current = placedBuildings.get(selectedPlacedBuildingId);
  if (!current) return;
  const updated = {
    ...current,
    rotation: (current.rotation + Math.PI / 2) % (Math.PI * 2),
  };
  const placement = renderer.validateBuildingPlacement(updated, updated.id);
  if (!placement.valid) {
    selectionStatus.textContent = placement.reason;
    return;
  }
  recordEdit();
  placedBuildings.set(updated.id, updated);
  renderer.setPlacedBuildings([...placedBuildings.values()]);
  syncBuildingActivity();
  renderer.setSelectedPlacedBuilding(updated.id);
  renderPlacedBuildingSelection(updated);
  finishEdit("Building rotation autosaved");
}

function deleteSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  recordEdit();
  placedBuildings.delete(selectedPlacedBuildingId);
  selectedPlacedBuildingId = null;
  renderer.setPlacedBuildings([...placedBuildings.values()]);
  renderer.setSelectedPlacedBuilding(null);
  syncBuildingActivity();
  updateSelectionPanel();
  finishEdit("Building removal autosaved");
  selectionStatus.textContent = "Building removed.";
}

function renderPlacedBuildingSelection(building: PlacedBuilding): void {
  buildingEditor.hidden = false;
  signalEditor.hidden = true;
  selectionTitle.textContent = `${formatBuildingKind(building.kind)} building`;
  selectionDescription.textContent = `${building.floors} floors · ${formatBuildingFunction(building.kind)}`;
  featureKind.textContent = "Building";
  featureKind.dataset.kind = "building";
  simulationTitle.textContent = `${formatBuildingKind(building.kind)} building`;
  sceneSubtitle.textContent = "Drag to move · R to rotate";
  selectedBuildingKind.value = building.kind;
  selectedBuildingFloors.value = String(building.floors);
  selectedBuildingColor.value = building.color;
  buildingPositionOutput.textContent = formatBuildingPosition(building.x, building.z);
  const role = deriveBuildingRole(building);
  buildingResidentsOutput.textContent = role.residents.toLocaleString();
  buildingJobsOutput.textContent = role.jobs.toLocaleString();
  buildingVisitorsOutput.textContent = role.dailyVisitors.toLocaleString();
  buildingFreightOutput.textContent = role.dailyFreightTrips.toLocaleString();
  buildToolButtons.forEach((button) => {
    button.disabled = true;
  });
  designSummary.replaceChildren(
    createSummaryTag(`${building.floors} floors`, true),
    createSummaryTag(`${Math.round(THREE_RADIANS_TO_DEGREES * building.rotation)}° rotation`, true),
    createSummaryTag(formatBuildingKind(building.kind), true),
  );
  selectionStatus.textContent =
    "This building generates live trips in Simulate mode. Edit its use or size to change demand.";
}

function syncBuildingActivity(): void {
  simulation.setPlacedBuildings([...placedBuildings.values()]);
  updateBuildingActivitySummary();
}

function updateBuildingActivitySummary(): void {
  const activity = simulation.getBuildingActivity();
  districtResidentsOutput.textContent = activity.residents.toLocaleString();
  districtJobsOutput.textContent = activity.jobs.toLocaleString();
  districtVisitorsOutput.textContent = activity.dailyVisitors.toLocaleString();
  districtFreightOutput.textContent =
    activity.dailyFreightTrips.toLocaleString();
}

function createSummaryTag(text: string, active: boolean): HTMLSpanElement {
  const tag = document.createElement("span");
  tag.textContent = text;
  tag.dataset.active = String(active);
  return tag;
}

const THREE_RADIANS_TO_DEGREES = 180 / Math.PI;

function formatBuildingPosition(x: number, z: number): string {
  return `X ${x.toFixed(1)} · Z ${z.toFixed(1)}`;
}

function formatBuildingFunction(kind: BuildingKind): string {
  if (kind === "residential") return "homes generate residents and commute trips";
  if (kind === "commercial") return "workplaces generate jobs and visitor trips";
  if (kind === "industrial") return "industry generates jobs and freight trucks";
  return "public services generate jobs and visitor trips";
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

  recordEdit();
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
  finishEdit("Street edit autosaved");
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
  scheduleAutosave();
}

function captureEditorSnapshot(): EditorSnapshot {
  return {
    designs: Array.from(designs, ([id, design]) => [id, { ...design }]),
    buildings: Array.from(placedBuildings.values(), (building) => ({
      ...building,
    })),
    nextBuildingId,
  };
}

function editorSnapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function captureProjectSnapshot(): ProjectSnapshot {
  const state = simulation.getState();
  return {
    version: PROJECT_STATE_VERSION,
    savedAt: new Date().toISOString(),
    ...captureEditorSnapshot(),
    settings: { ...simulation.getSettings() },
    timeOfDayHours: state.timeOfDayHours,
    weather: state.weather,
  };
}

function applyEditorSnapshot(snapshot: EditorSnapshot): void {
  designs.clear();
  for (const [id, design] of snapshot.designs) {
    designs.set(id, { ...design });
  }
  placedBuildings.clear();
  for (const building of snapshot.buildings) {
    placedBuildings.set(building.id, { ...building });
  }
  nextBuildingId = Math.max(1, snapshot.nextBuildingId);
  selectedPlacedBuildingId = null;
  renderer.setSelectedPlacedBuilding(null);
  renderer.setPlacedBuildings([...placedBuildings.values()]);
  syncBuildingActivity();
  syncDesign();
}

function applyProjectSnapshot(snapshot: ProjectSnapshot): void {
  applyEditorSnapshot(snapshot);
  applyScenarioSettings(snapshot.settings);
  simulation.setTimeOfDay(snapshot.timeOfDayHours);
  simulation.setWeather(snapshot.weather);
  simulation.start();
  syncEnvironmentControls();
  editHistory.clear();
  updateHistoryButtons();
  updateInterface();
}

function applyScenarioSettings(settings: ScenarioSettings): void {
  simulation.setSimulationSeed(settings.simulationSeed);
  simulation.setSimulationSpeed(settings.simulationSpeed);
  simulation.setVehicleVolume(settings.vehicleVolume);
  simulation.setPedestrianVolume(settings.pedestrianVolume);
  simulation.setSpeedLimit(settings.speedLimitMph);
  simulation.setSignalCycle(settings.signalCycleSeconds);
  syncScenarioControls();
}

function syncScenarioControls(): void {
  const settings = simulation.getSettings();
  speedControl.value = String(settings.simulationSpeed);
  speedOutput.value = `${settings.simulationSpeed.toFixed(1)}×`;
  vehicleVolumeControl.value = String(settings.vehicleVolume);
  vehicleVolumeOutput.value = formatVolume(settings.vehicleVolume);
  pedestrianVolumeControl.value = String(settings.pedestrianVolume);
  pedestrianVolumeOutput.value = formatVolume(settings.pedestrianVolume);
  speedLimitControl.value = String(settings.speedLimitMph);
  signalCycleControl.value = String(settings.signalCycleSeconds);
  simulationSeedControl.value = String(settings.simulationSeed);
}

function recordEdit(): void {
  editHistory.record(captureEditorSnapshot());
  updateHistoryButtons();
}

function finishEdit(message: string): void {
  updateHistoryButtons();
  scheduleAutosave(message);
}

function undoEdit(): void {
  const previous = editHistory.undo(captureEditorSnapshot());
  if (!previous) return;
  applyEditorSnapshot(previous);
  updateHistoryButtons();
  scheduleAutosave("Undo autosaved");
}

function redoEdit(): void {
  const next = editHistory.redo(captureEditorSnapshot());
  if (!next) return;
  applyEditorSnapshot(next);
  updateHistoryButtons();
  scheduleAutosave("Redo autosaved");
}

function updateHistoryButtons(): void {
  undoButton.disabled = !editHistory.canUndo || appMode !== "build";
  redoButton.disabled = !editHistory.canRedo || appMode !== "build";
}

function scheduleAutosave(message = "Changes autosaved"): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(captureProjectSnapshot()));
      autosaveStatus.textContent = `${message} · ${formatClockTime(new Date())}`;
    } catch {
      autosaveStatus.textContent = "Autosave unavailable in this browser.";
    }
    autosaveTimer = null;
  }, 300);
}

function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    applyProjectSnapshot(parseProjectSnapshot(raw));
    autosaveStatus.textContent = "Autosaved design restored";
    return true;
  } catch {
    autosaveStatus.textContent = "Autosave could not be restored";
    return false;
  }
}

function saveProjectToSlot(): void {
  try {
    localStorage.setItem(
      `${SAVE_SLOT_PREFIX}${saveSlotControl.value}`,
      JSON.stringify(captureProjectSnapshot()),
    );
    autosaveStatus.textContent = `Saved to slot ${saveSlotControl.value}`;
  } catch {
    autosaveStatus.textContent = "This browser could not save the project.";
  }
}

function loadProjectFromSlot(): void {
  try {
    const raw = localStorage.getItem(`${SAVE_SLOT_PREFIX}${saveSlotControl.value}`);
    if (!raw) {
      autosaveStatus.textContent = `Slot ${saveSlotControl.value} is empty`;
      return;
    }
    applyProjectSnapshot(parseProjectSnapshot(raw));
    scheduleAutosave(`Slot ${saveSlotControl.value} loaded`);
  } catch {
    autosaveStatus.textContent = "The selected save is invalid.";
  }
}

function exportProject(): void {
  const blob = new Blob([JSON.stringify(captureProjectSnapshot(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `penn-street-design-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  autosaveStatus.textContent = "Design exported as JSON";
}

async function importProject(): Promise<void> {
  const file = importProjectFile.files?.[0];
  if (!file) return;
  try {
    applyProjectSnapshot(parseProjectSnapshot(await file.text()));
    scheduleAutosave("Imported design autosaved");
  } catch (error) {
    autosaveStatus.textContent =
      error instanceof Error ? error.message : "Could not import this design.";
  } finally {
    importProjectFile.value = "";
  }
}

function syncEnvironmentControls(): void {
  const state = simulation.getState();
  timeOfDayControl.value = String(state.timeOfDayHours);
  timeOfDayOutput.value = formatTimeOfDay(state.timeOfDayHours);
  weatherControl.value = state.weather;
  demandPeriodOutput.textContent = formatDemandPeriod(state.timeOfDayHours);
  renderer.setEnvironment(state.timeOfDayHours, state.weather);
}

function formatTimeOfDay(hourValue: number): string {
  const totalMinutes = Math.round(hourValue * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatDemandPeriod(hourValue: number): string {
  const hour = ((hourValue % 24) + 24) % 24;
  if ((hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 19)) {
    return "Rush hour · traffic demand increased";
  }
  if (hour >= 11 && hour < 14) return "Lunch period · pedestrian demand increased";
  if (hour >= 22 || hour < 6) return "Night · district demand reduced";
  return hour < 12 ? "Morning activity" : "Regular daytime activity";
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function isBuildingKind(value: string | undefined): value is BuildingKind {
  return (
    value === "residential" ||
    value === "commercial" ||
    value === "industrial" ||
    value === "civic"
  );
}

function defaultBuildingColor(kind: BuildingKind): string {
  if (kind === "residential") return "#bf765f";
  if (kind === "commercial") return "#6f9eb3";
  if (kind === "industrial") return "#a66b4e";
  return "#8a87b8";
}

function formatBuildingKind(kind: BuildingKind): string {
  return kind[0].toUpperCase() + kind.slice(1);
}

function clampFloors(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(20, Math.round(value)));
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
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
setCameraMode(cameraMode);
if (!restoreAutosave()) {
  syncScenarioControls();
  syncEnvironmentControls();
}
setAppMode("build");
simulation.start();
updateInterface();
window.requestAnimationFrame(animationFrame);
