import "./styles.css";
import {
  deriveBuildingIssues,
  type BuildingIssue,
  type BuildingIssueCategory,
} from "./core/buildingIssues";
import { Simulation } from "./core/simulation";
import { deriveBuildingRole } from "./core/buildingActivity";
import {
  buildingKindForFunction,
  defaultFunctionForKind,
  functionForPlacedBuilding,
} from "./core/expansionEconomy";
import {
  EditHistory,
  PROJECT_STATE_VERSION,
  parseProjectSnapshot,
  type EditorSnapshot,
  type ProjectSnapshot,
} from "./core/projectState";
import { getPhillyCrashRiskProfile } from "./data/phillyCrashProfile";
import { PENN_LANDMARKS } from "./data/pennRoadGraph";
import type {
  AppMode,
  BuildingKind,
  BuildWorkspace,
  BuildTool,
  CameraMode,
  DesignImpact,
  DistrictFeature,
  EnvironmentMode,
  ExpansionRoad,
  ExpansionStreetObject,
  ExpansionStreetObjectKind,
  FeatureDesign,
  LaneDirection,
  ManualSignalTarget,
  MapOverlayMode,
  MobilityDetailMode,
  PlacedBuilding,
  SceneHoverSelection,
  SignalControlMode,
  SignalTiming,
  WeatherMode,
} from "./models/types";
import type {
  BuildingConnectionKind,
  BuildingFunction,
  BuildingHistoryPoint,
  BuildingTrafficAttribution,
  DetailedBuilding,
  DetailedHousehold,
  HouseholdHistoryPoint,
  DetailedPerson,
  EntitySelection,
  PersonHistoryPoint,
} from "./models/entityTypes";
import type { TimeHorizon } from "./models/cityTypes";
import { ThreeRenderer } from "./rendering/threeRenderer";
import {
  installStatTooltips,
  type StatFactor,
  type StatHistorySample,
  type StatInsight,
} from "./ui/statTooltip";

const canvas = requireElement<HTMLCanvasElement>("simulation-canvas");
const simulationTitle = requireElement<HTMLElement>("simulation-title");
const sceneSubtitle = requireElement<HTMLElement>("scene-subtitle");
const buildModeButton = requireElement<HTMLButtonElement>("build-mode-button");
const simulateModeButton = requireElement<HTMLButtonElement>("simulate-mode-button");
const orbitCameraButton = requireElement<HTMLButtonElement>("orbit-camera-button");
const flyCameraButton = requireElement<HTMLButtonElement>("fly-camera-button");
const walkCameraButton = requireElement<HTMLButtonElement>("walk-camera-button");
const walkStartMarker = requireElement<HTMLButtonElement>("walk-start-marker");
const environmentMode = requireElement<HTMLElement>("environment-mode");
const orbitCameraHint = requireElement<HTMLElement>("orbit-camera-hint");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const saveProjectButton = requireElement<HTMLButtonElement>("save-project-button");
const loadProjectButton = requireElement<HTMLButtonElement>("load-project-button");
const exportProjectButton = requireElement<HTMLButtonElement>("export-project-button");
const importProjectButton = requireElement<HTMLButtonElement>("import-project-button");
const importProjectFile = requireElement<HTMLInputElement>("import-project-file");
const undoEditButton = requireElement<HTMLButtonElement>("undo-edit-button");
const redoEditButton = requireElement<HTMLButtonElement>("redo-edit-button");
const cityEditWorkspace = requireElement<HTMLButtonElement>("city-edit-workspace");
const expansionWorkspace = requireElement<HTMLButtonElement>("expansion-workspace");
const buildWorkspaceHelp = requireElement<HTMLElement>("build-workspace-help");
const buildSelectionName = requireElement<HTMLElement>("build-selection-name");
const buildActionStatus = requireElement<HTMLElement>("build-action-status");
const drawExpansionRoadButton = requireElement<HTMLButtonElement>("draw-expansion-road-button");
const placeExpansionCrosswalkButton = requireElement<HTMLButtonElement>("place-expansion-crosswalk-button");
const placeExpansionSignalButton = requireElement<HTMLButtonElement>("place-expansion-signal-button");
const eraseExpansionButton = requireElement<HTMLButtonElement>("erase-expansion-button");
const expansionRoadCount = requireElement<HTMLElement>("expansion-road-count");
const expansionRoadEditor = requireElement<HTMLElement>("expansion-road-editor");
const deleteExpansionRoadButton = requireElement<HTMLButtonElement>("delete-expansion-road-button");
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
const buildingBuildTimeOutput = requireElement<HTMLElement>("building-build-time-output");
const buildingProjectCostOutput = requireElement<HTMLElement>("building-project-cost-output");
const timeRateControl = requireElement<HTMLInputElement>("time-rate-control");
const timeRateOutput = requireElement<HTMLOutputElement>("time-rate-output");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const pedestrianVolumeOutput = requireElement<HTMLOutputElement>("pedestrian-volume-output");
const cityDate = requireElement<HTMLElement>("city-date");
const cityClock = requireElement<HTMLElement>("city-clock");
const commuteTripShare = requireElement<HTMLElement>("commute-trip-share");
const shoppingTripShare = requireElement<HTMLElement>("shopping-trip-share");
const freightTripShare = requireElement<HTMLElement>("freight-trip-share");
const speedLimitControl = requireElement<HTMLInputElement>("speed-limit-control");
const signalCycleControl = requireElement<HTMLInputElement>("signal-cycle-control");
const simulationSeedControl = requireElement<HTMLInputElement>("simulation-seed-control");
const timeOfDayControl = requireElement<HTMLInputElement>("time-of-day-control");
const timeOfDayOutput = requireElement<HTMLOutputElement>("time-of-day-output");
const weatherControl = requireElement<HTMLSelectElement>("weather-control");
const violationRiskOutput = requireElement<HTMLElement>("violation-risk-output");
const pedestrianMarkersControl = requireElement<HTMLInputElement>("pedestrian-markers-control");
const vehicleMarkersControl = requireElement<HTMLInputElement>("vehicle-markers-control");
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
const pedestrianWait = requireElement<HTMLElement>("pedestrian-wait");
const conflicts = requireElement<HTMLElement>("conflicts");
const throughput = requireElement<HTMLElement>("throughput");
const buildingArrivals = requireElement<HTMLElement>("building-arrivals");
const trafficViolations = requireElement<HTMLElement>("traffic-violations");
const jaywalkingViolations = requireElement<HTMLElement>("jaywalking-violations");
const cityOutput = requireElement<HTMLElement>("city-output");
const cityUnemployment = requireElement<HTMLElement>("city-unemployment");
const cityTrafficCost = requireElement<HTMLElement>("city-traffic-cost");
const cityMigration = requireElement<HTMLElement>("city-migration");
const baselineMetricsButton = requireElement<HTMLButtonElement>("baseline-metrics-button");
const modifiedMetricsButton = requireElement<HTMLButtonElement>("modified-metrics-button");
const metricsKicker = requireElement<HTMLElement>("metrics-kicker");
const performancePanel = requireElement<HTMLDetailsElement>("performance-panel");
const performanceSummary = requireElement<HTMLElement>("performance-summary");
const performanceMinimizeButton = requireElement<HTMLButtonElement>("performance-minimize-button");
const analysisOverlay = requireElement<HTMLSelectElement>("analysis-overlay");
const entityInspector = requireElement<HTMLElement>("entity-inspector");
const cityInspectorPanel = requireElement<HTMLElement>("city-inspector-panel");
const cityInspectorOverviewButton = requireElement<HTMLButtonElement>("city-inspector-overview-button");
const cityInspectorMinimizeButton = requireElement<HTMLButtonElement>("city-inspector-minimize-button");
const cityInspectorRestoreButton = requireElement<HTMLButtonElement>("city-inspector-restore-button");
const mapLegend = requireElement<HTMLElement>("map-legend");
const notificationCenter = requireElement<HTMLElement>("notification-center");
const notificationButton = requireElement<HTMLButtonElement>("notification-button");
const notificationCount = requireElement<HTMLElement>("notification-count");
const notificationPanel = requireElement<HTMLElement>("notification-panel");
const notificationCloseButton = requireElement<HTMLButtonElement>("notification-close-button");
const notificationSummary = requireElement<HTMLElement>("notification-summary");
const notificationList = requireElement<HTMLElement>("notification-list");
const entityTooltip = requireElement<HTMLElement>("entity-tooltip");
const statTooltip = requireElement<HTMLElement>("stat-tooltip");
const trackedPeople = requireElement<HTMLDetailsElement>("tracked-people");
const trackedPeopleCount = requireElement<HTMLElement>("tracked-people-count");
const trackedPeopleList = requireElement<HTMLElement>("tracked-people-list");
const buildingComparison = requireElement<HTMLElement>("building-comparison");
const settingsButton = requireElement<HTMLButtonElement>("settings-button");
const settingsCloseButton = requireElement<HTMLButtonElement>("settings-close-button");
const settingsDrawer = requireElement<HTMLElement>("settings-drawer");
const settingsScrim = requireElement<HTMLButtonElement>("settings-scrim");
const speedLimitOutput = requireElement<HTMLOutputElement>("speed-limit-output");
const signalCycleOutput = requireElement<HTMLOutputElement>("signal-cycle-output");
const transitHeadwayControl = requireElement<HTMLInputElement>("transit-headway-control");
const transitHeadwayOutput = requireElement<HTMLOutputElement>("transit-headway-output");
const timeRatePreview = requireElement<HTMLElement>("time-rate-preview");
const speedLimitPreview = requireElement<HTMLElement>("speed-limit-preview");
const signalCyclePreview = requireElement<HTMLElement>("signal-cycle-preview");
const transitHeadwayPreview = requireElement<HTMLElement>("transit-headway-preview");
const highContrastControl = requireElement<HTMLInputElement>("high-contrast-control");
const reducedMotionControl = requireElement<HTMLInputElement>("reduced-motion-control");
const uiScaleControl = requireElement<HTMLSelectElement>("ui-scale-control");
const locationSearch = requireElement<HTMLFormElement>("location-search");
const locationSearchInput = requireElement<HTMLInputElement>("location-search-input");
const locationOptions = requireElement<HTMLDataListElement>("location-options");
const searchMinimizeButton = requireElement<HTMLButtonElement>("search-minimize-button");
const searchRestoreButton = requireElement<HTMLButtonElement>("search-restore-button");
const buildToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-tool]"),
);
const buildingToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-building-tool]"),
);
const expansionRoadToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-expansion-road-tool]"),
);
const buildWorkspaceSections = Array.from(
  document.querySelectorAll<HTMLElement>("[data-build-workspace-section]"),
);

const TIME_RATE_PRESETS: readonly {
  label: string;
  simulationSpeed: number;
  timeHorizon: TimeHorizon;
  description: string;
}[] = [
  { label: "Real time", simulationSpeed: 1 / 3_600, timeHorizon: "day", description: "Residents and the city clock move at real-world speed." },
  { label: "10 sec/sec", simulationSpeed: 1 / 360, timeHorizon: "day", description: "Watch residents complete each part of their daily routes." },
  { label: "1 min/sec", simulationSpeed: 1 / 60, timeHorizon: "day", description: "Daily movement stays visible while routines progress more quickly." },
  { label: "30 min/sec", simulationSpeed: 0.5, timeHorizon: "day", description: "Fast daily observation with continuous sampled movement." },
  { label: "6 hr/sec", simulationSpeed: 1, timeHorizon: "week", description: "Schedules are deterministically interpolated between destinations." },
  { label: "1 day/sec", simulationSpeed: 1, timeHorizon: "month", description: "Completed trips feed daily attendance, spending, and delay outcomes." },
  { label: "1 week/sec", simulationSpeed: 1, timeHorizon: "year", description: "Skipped days resolve as outcomes; the map shows the current sampled instant." },
];

const simulation = new Simulation();
const initialTimeRate = TIME_RATE_PRESETS[Number(timeRateControl.value)]!;
simulation.setSimulationSpeed(initialTimeRate.simulationSpeed);
simulation.setTimeHorizon(initialTimeRate.timeHorizon);
simulation.setSimulationSeed(createSessionSeed());
simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
const renderer = new ThreeRenderer(canvas);
reducedMotionControl.checked = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
applyDisplayAccessibility();
const liveStatHistory = new Map<string, StatHistorySample[]>();
const favoritePersonIds = new Set<string>();
const comparedBuildingIds: string[] = [];
const visibleFlowKinds = new Set<BuildingConnectionKind>([
  "work",
  "visit",
  "delivery",
]);
let lastLiveHistorySlot = -1;
installStatTooltips(statTooltip, resolveStatInsight);
const designs = new Map<string, FeatureDesign>();
const placedBuildings = new Map<string, PlacedBuilding>();
const expansionRoads = new Map<string, ExpansionRoad>();
const expansionStreetObjects = new Map<string, ExpansionStreetObject>();
const editHistory = new EditHistory();
const PROJECT_SAVE_KEY = "penn-campus-simulator:linn-project";
const features = renderer.getFeatures();
let appMode: AppMode = "simulate";
let buildWorkspace: BuildWorkspace = "city-edit";
let activeBuildingTool: BuildingKind | null = null;
let expansionRoadToolActive = false;
let expansionEraseToolActive = false;
let activeExpansionStreetObjectTool: ExpansionStreetObjectKind | null = null;
let selectedPlacedBuildingId: string | null = null;
let selectedExpansionRoadId: string | null = null;
let movingBuildingId: string | null = null;
let nextBuildingId = 1;
let nextExpansionRoadId = 1;
let nextExpansionStreetObjectId = 1;
let cameraMode: CameraMode = "orbit";
let metricView: "baseline" | "modified" = "modified";
let selectedFeature: DistrictFeature | undefined =
  features.find((feature) => feature.id === "walnut-34-36") ?? features[0];
let selectedEntity: EntitySelection | null = null;
let selectedTrafficFeature: DistrictFeature | null = null;
let inspectorTab: "overview" | "causes" | "actions" = "overview";
let interventionFeedback = "";
let interventionBaseline: {
  day: number;
  congestion: number;
  trafficCost: number;
  businessProfit: number;
} | null = null;
let currentBuildingIssues: BuildingIssue[] = [];
let entityInterfaceSignature = "";
let showAffectedRoads = false;
let walkPlacementActive = false;
let walkMarkerPointerId: number | null = null;
let walkMarkerMoved = false;
let walkMarkerStart = { x: 0, y: 0 };
let restoreInspectorAfterBuild = false;
let previousTimestamp = performance.now();

buildModeButton.addEventListener("click", () => {
  simulation.pause();
  setAppMode("build");
});
simulateModeButton.addEventListener("click", () => {
  if (appMode === "simulate") return;
  simulation.pause();
  setAppMode("simulate");
});
orbitCameraButton.addEventListener("click", () => setCameraMode("orbit"));
flyCameraButton.addEventListener("click", () => setCameraMode("fly"));
walkCameraButton.addEventListener("click", beginWalkPlacement);
undoEditButton.addEventListener("click", undoEdit);
redoEditButton.addEventListener("click", redoEdit);
saveProjectButton.addEventListener("click", saveProject);
loadProjectButton.addEventListener("click", loadProject);
exportProjectButton.addEventListener("click", exportProject);
importProjectButton.addEventListener("click", () => importProjectFile.click());
importProjectFile.addEventListener("change", () => void importProject());
cityEditWorkspace.addEventListener("click", () => setBuildWorkspace("city-edit"));
expansionWorkspace.addEventListener("click", () => setBuildWorkspace("expansion"));
drawExpansionRoadButton.addEventListener("click", () => {
  if (buildWorkspace !== "expansion") setBuildWorkspace("expansion");
  setExpansionRoadToolActive(!expansionRoadToolActive);
});
placeExpansionCrosswalkButton.addEventListener("click", () =>
  selectExpansionStreetObjectTool("crosswalk"),
);
placeExpansionSignalButton.addEventListener("click", () =>
  selectExpansionStreetObjectTool("traffic-signal"),
);
eraseExpansionButton.addEventListener("click", () => {
  if (buildWorkspace !== "expansion") setBuildWorkspace("expansion");
  setExpansionEraseToolActive(!expansionEraseToolActive);
});

for (const button of buildingToolButtons) {
  button.addEventListener("click", () => {
    const kind = button.dataset.buildingTool;
    if (isBuildingKind(kind)) selectBuildingTool(kind);
  });
}

for (const button of expansionRoadToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.expansionRoadTool;
    if (isBuildTool(tool)) applyExpansionRoadTool(tool);
  });
}

buildingFloorsControl.addEventListener("change", () => {
  buildingFloorsControl.value = String(
    clampFloors(Number(buildingFloorsControl.value)),
  );
});
selectedBuildingFloors.addEventListener("change", updateSelectedBuilding);
selectedBuildingColor.addEventListener("change", updateSelectedBuilding);
selectedBuildingKind.addEventListener("change", updateSelectedBuilding);
rotateBuildingButton.addEventListener("click", rotateSelectedBuilding);
deleteBuildingButton.addEventListener("click", deleteSelectedBuilding);
deleteExpansionRoadButton.addEventListener("click", deleteSelectedExpansionRoad);

walkStartMarker.addEventListener("pointerdown", (event) => {
  if (!walkPlacementActive) return;
  event.preventDefault();
  walkMarkerPointerId = event.pointerId;
  walkMarkerMoved = false;
  walkMarkerStart = { x: event.clientX, y: event.clientY };
  document.body.dataset.walkMarkerDragging = "true";
});

window.addEventListener("pointermove", (event) => {
  if (event.pointerId !== walkMarkerPointerId) return;
  event.preventDefault();
  walkMarkerMoved ||= Math.hypot(
    event.clientX - walkMarkerStart.x,
    event.clientY - walkMarkerStart.y,
  ) > 4;
  if (!walkMarkerMoved) return;
  walkStartMarker.style.left = `${event.clientX}px`;
  walkStartMarker.style.top = `${event.clientY - walkStartMarker.offsetHeight / 2}px`;
});

window.addEventListener("pointerup", (event) => {
  if (event.pointerId !== walkMarkerPointerId) return;
  event.preventDefault();
  walkMarkerPointerId = null;
  document.body.dataset.walkMarkerDragging = "false";
  if (walkMarkerMoved) {
    walkStartMarker.style.visibility = "hidden";
    const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
    walkStartMarker.style.removeProperty("visibility");
    if (dropTarget === canvas) {
      completeWalkPlacement(event.clientX, event.clientY);
      return;
    }
    resetWalkMarkerPosition();
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  completeWalkPlacement(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
});

window.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== walkMarkerPointerId) return;
  walkMarkerPointerId = null;
  document.body.dataset.walkMarkerDragging = "false";
  resetWalkMarkerPosition();
});

runButton.addEventListener("click", () => {
  if (appMode === "build") setAppMode("simulate");
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
  if (
    designs.size === 0 &&
    placedBuildings.size === 0 &&
    expansionRoads.size === 0 &&
    expansionStreetObjects.size === 0
  ) return;
  recordEdit();
  designs.clear();
  placedBuildings.clear();
  expansionRoads.clear();
  expansionStreetObjects.clear();
  selectedPlacedBuildingId = null;
  selectedExpansionRoadId = null;
  nextBuildingId = 1;
  nextExpansionRoadId = 1;
  nextExpansionStreetObjectId = 1;
  syncExpansion();
  syncDesign();
  finishEdit();
  setBuildFeedback("All street edits and expansion items were reset.", "success");
});

timeRateControl.addEventListener("input", () => {
  const preset = selectedTimeRatePreset();
  simulation.setSimulationSpeed(preset.simulationSpeed);
  simulation.setTimeHorizon(preset.timeHorizon);
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

timeOfDayControl.addEventListener("input", () => {
  simulation.setTimeOfDay(Number(timeOfDayControl.value));
  syncEnvironmentControls();
});

weatherControl.addEventListener("change", () => {
  simulation.setWeather(weatherControl.value as WeatherMode);
  syncEnvironmentControls();
});

pedestrianMarkersControl.addEventListener("change", () => {
  renderer.setPedestrianMarkersVisible(pedestrianMarkersControl.checked);
});

vehicleMarkersControl.addEventListener("change", () => {
  renderer.setVehicleMarkersVisible(vehicleMarkersControl.checked);
});

highContrastControl.addEventListener("change", applyDisplayAccessibility);
reducedMotionControl.addEventListener("change", applyDisplayAccessibility);
uiScaleControl.addEventListener("change", applyDisplayAccessibility);

signalModeControl.addEventListener("change", () => {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  simulation.setSignalMode(
    selectedFeature.id,
    signalModeControl.value as SignalControlMode,
  );
  updateSelectedSignalStatus();
  setBuildFeedback(`${formatSignalMode(signalModeControl.value as SignalControlMode)} control enabled at ${selectedFeature.name}.`, "success");
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
      if (buildWorkspace !== "city-edit") setBuildWorkspace("city-edit");
      if (!validateBuildToolTarget(tool)) return;
      recordEdit();
      captureInterventionBaseline();
      applyBuildTool(tool);
      finishEdit();
      interventionFeedback = interventionPreview(tool);
      entityInterfaceSignature = "";
      updateEntityInterface();
    }
  });
}

baselineMetricsButton.addEventListener("click", () => setMetricView("baseline"));
modifiedMetricsButton.addEventListener("click", () => setMetricView("modified"));
performanceMinimizeButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  performancePanel.open = false;
  performanceSummary.focus();
});

analysisOverlay.addEventListener("change", () => {
  renderer.setMapOverlay(analysisOverlay.value as MapOverlayMode);
  entityTooltip.hidden = true;
  entityInterfaceSignature = "";
  updateEntityInterface();
});

notificationButton.addEventListener("click", () => {
  setNotificationOpen(notificationPanel.hidden);
});
notificationCloseButton.addEventListener("click", () => setNotificationOpen(false));
notificationList.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-issue-building]")
    : null;
  const buildingId = target?.dataset.issueBuilding;
  const category = target?.dataset.issueCategory as BuildingIssueCategory | undefined;
  if (buildingId && category) focusIssueBuilding(buildingId, category);
});
document.addEventListener("pointerdown", (event) => {
  if (notificationPanel.hidden || !(event.target instanceof Node)) return;
  if (!notificationCenter.contains(event.target)) setNotificationOpen(false);
});
document.addEventListener("keydown", (event) => {
  const commandKey = event.metaKey || event.ctrlKey;
  if (
    commandKey &&
    event.key.toLowerCase() === "z" &&
    !isTextEntryTarget(event.target)
  ) {
    event.preventDefault();
    if (event.shiftKey) redoEdit();
    else undoEdit();
    return;
  }
  if (
    event.key.toLowerCase() === "r" &&
    selectedPlacedBuildingId &&
    !isTextEntryTarget(event.target)
  ) {
    event.preventDefault();
    rotateSelectedBuilding();
    return;
  }
  if (event.key === "/" && !isTextEntryTarget(event.target)) {
    event.preventDefault();
    locationSearch.hidden = false;
    searchRestoreButton.hidden = true;
    locationSearchInput.focus();
    return;
  }
  if (event.key !== "Escape") return;
  if (!notificationPanel.hidden) {
    setNotificationOpen(false);
    return;
  }
  if (!settingsDrawer.hidden) {
    setSettingsOpen(false);
    return;
  }
  if (selectedEntity || selectedTrafficFeature) clearInspectorSelection();
});

document.addEventListener("pointerover", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-stat]")
    : null;
  if (target) applyStatMapEmphasis(target.dataset.stat);
});
document.addEventListener("pointerout", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-stat]")
    : null;
  const next = event.relatedTarget instanceof Element
    ? event.relatedTarget.closest<HTMLElement>("[data-stat]")
    : null;
  if (target && target !== next) clearStatMapEmphasis();
});
document.addEventListener("focusin", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-stat]")
    : null;
  if (target) applyStatMapEmphasis(target.dataset.stat);
});
document.addEventListener("focusout", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-stat]")) {
    clearStatMapEmphasis();
  }
});

entityInspector.addEventListener("click", (event) => {
  const overviewTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-inspector-overview]")
    : null;
  if (overviewTarget) {
    clearInspectorSelection();
    return;
  }
  const compareTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-compare-building]")
    : null;
  const compareBuildingId = compareTarget?.dataset.compareBuilding;
  if (compareBuildingId) {
    toggleComparedBuilding(compareBuildingId);
    return;
  }
  const affectedRoadsTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-toggle-affected-roads]")
    : null;
  if (affectedRoadsTarget) {
    showAffectedRoads = !showAffectedRoads;
    entityInterfaceSignature = "";
    updateEntityInterface();
    return;
  }
  const tabTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-inspector-tab]")
    : null;
  const nextTab = tabTarget?.dataset.inspectorTab;
  if (nextTab === "overview" || nextTab === "causes" || nextTab === "actions") {
    inspectorTab = nextTab;
    entityInterfaceSignature = "";
    updateEntityInterface();
    return;
  }
  const buildAction = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-inspector-build-tool]")
    : null;
  const buildTool = buildAction?.dataset.inspectorBuildTool;
  if (isBuildTool(buildTool)) {
    if (appMode !== "build") {
      simulation.pause();
      setAppMode("build");
    }
    if (buildWorkspace !== "city-edit") setBuildWorkspace("city-edit");
    if (!validateBuildToolTarget(buildTool)) return;
    recordEdit();
    captureInterventionBaseline();
    applyBuildTool(buildTool);
    finishEdit();
    interventionFeedback = interventionPreview(buildTool);
    entityInterfaceSignature = "";
    updateEntityInterface();
    return;
  }
  const favoriteTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-favorite-person]")
    : null;
  const favoritePersonId = favoriteTarget?.dataset.favoritePerson;
  if (favoritePersonId) {
    toggleFavoritePerson(favoritePersonId);
    return;
  }
  const buildingTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-focus-building]")
    : null;
  const buildingId = buildingTarget?.dataset.focusBuilding;
  if (buildingId) {
    focusInspectorBuilding(buildingId);
    return;
  }
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-road-focus]")
    : null;
  const segmentId = target?.dataset.roadFocus;
  if (!segmentId) return;
  const feature = features.find((candidate) => candidate.id === segmentId);
  if (!feature) return;
  selectedTrafficFeature = feature;
  showAffectedRoads = false;
  selectedFeature = feature;
  selectedEntity = null;
  inspectorTab = "overview";
  renderer.setSelectedEntity(null);
  renderer.setSelectedFeature(segmentId);
  const [start, end = start] = feature.path;
  renderer.flyTo({
    longitude: (start.longitude + end.longitude) / 2,
    latitude: (start.latitude + end.latitude) / 2,
  }, cameraMode === "orbit" ? 330 : 180);
  syncEntitySelectionState();
  entityInterfaceSignature = "";
  updateEntityInterface();
});

entityInspector.addEventListener("change", (event) => {
  const input = event.target instanceof HTMLInputElement
    ? event.target.closest<HTMLInputElement>("[data-flow-kind]")
    : null;
  const kind = input?.dataset.flowKind as BuildingConnectionKind | undefined;
  if (!kind || !input) return;
  if (input.checked) visibleFlowKinds.add(kind);
  else visibleFlowKinds.delete(kind);
  renderer.setVisibleFlowKinds(visibleFlowKinds);
});

trackedPeopleList.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-tracked-person]")
    : null;
  const personId = target?.dataset.trackedPerson;
  if (personId) focusTrackedPerson(personId);
});

buildingComparison.addEventListener("click", (event) => {
  const focusTarget = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-comparison-focus]")
    : null;
  const buildingId = focusTarget?.dataset.comparisonFocus;
  if (buildingId) {
    focusInspectorBuilding(buildingId);
    return;
  }
  if (event.target instanceof Element && event.target.closest("[data-comparison-clear]")) {
    comparedBuildingIds.length = 0;
    entityInterfaceSignature = "";
    updateEntityInterface();
  }
});

settingsButton.addEventListener("click", () => {
  setNotificationOpen(false);
  setSettingsOpen(true);
});
settingsCloseButton.addEventListener("click", () => setSettingsOpen(false));
settingsScrim.addEventListener("click", () => setSettingsOpen(false));

cityInspectorMinimizeButton.addEventListener("click", () => {
  cityInspectorPanel.hidden = true;
  cityInspectorRestoreButton.hidden = false;
  document.body.dataset.cityInspector = "minimized";
  cityInspectorRestoreButton.focus();
});
cityInspectorRestoreButton.addEventListener("click", () => {
  cityInspectorPanel.hidden = false;
  cityInspectorRestoreButton.hidden = true;
  document.body.dataset.cityInspector = "open";
  cityInspectorMinimizeButton.focus();
});
cityInspectorOverviewButton.addEventListener("click", clearInspectorSelection);

transitHeadwayControl.addEventListener("input", () => {
  simulation.setTransitHeadway(Number(transitHeadwayControl.value));
  updateControlPreviews();
});
locationSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  flyToSearchResult(locationSearchInput.value);
});
locationSearchInput.addEventListener("input", () => locationSearchInput.setCustomValidity(""));
searchMinimizeButton.addEventListener("click", () => {
  locationSearch.hidden = true;
  searchRestoreButton.hidden = false;
  searchRestoreButton.focus();
});
searchRestoreButton.addEventListener("click", () => {
  locationSearch.hidden = false;
  searchRestoreButton.hidden = true;
  locationSearchInput.focus();
});

renderer.setSelectionHandler((feature) => {
  showAffectedRoads = false;
  selectedTrafficFeature = feature;
  selectedEntity = null;
  renderer.setSelectedEntity(null);
  selectedFeature = feature;
  renderer.setSelectedFeature(feature.id);
  inspectorTab = appMode === "build" ? "actions" : "overview";
  syncEntitySelectionState();
  updateSelectionPanel();
  entityInterfaceSignature = "";
  updateEntityInterface();
});

renderer.setEntitySelectionHandler((selection) => {
  showAffectedRoads = false;
  selectedTrafficFeature = null;
  selectedFeature = undefined;
  selectedEntity = selection;
  inspectorTab = "overview";
  renderer.setSelectedFeature(null);
  renderer.setSelectedEntity(selection);
  syncEntitySelectionState();
  entityInterfaceSignature = "";
  updateEntityInterface();
});

renderer.setEntityHoverHandler((selection, clientX, clientY) => {
  updateEntityTooltip(selection, clientX, clientY);
});

renderer.setBuildingInteractionHandlers({
  place: placeBuilding,
  select: (id) => {
    if (appMode === "simulate" && id) {
      selectedPlacedBuildingId = id;
      selectedEntity = { kind: "building", id };
      selectedTrafficFeature = null;
      selectedFeature = undefined;
      inspectorTab = "overview";
      renderer.setSelectedPlacedBuilding(id);
      renderer.setSelectedEntity(selectedEntity);
      syncEntitySelectionState();
      entityInterfaceSignature = "";
      updateEntityInterface();
      return;
    }
    selectPlacedBuilding(id);
  },
  move: (id, x, z, rotation, finished) => {
    if (movingBuildingId !== id) {
      recordEdit();
      movingBuildingId = id;
    }
    const building = placedBuildings.get(id);
    if (building) {
      placedBuildings.set(id, { ...building, x, z, rotation });
      if (selectedPlacedBuildingId === id) {
        buildingPositionOutput.textContent = formatBuildingPosition(x, z);
      }
    }
    if (finished) {
      movingBuildingId = null;
      syncExpansion();
      finishEdit();
    }
  },
});

renderer.setExpansionRoadInteractionHandlers({
  create: (roadData) => {
    if (appMode !== "build" || buildWorkspace !== "expansion") return;
    const validation = renderer.validateExpansionRoad(roadData);
    if (!validation.valid) {
      setBuildFeedback(validation.reason, "error");
      return;
    }
    recordEdit();
    const road: ExpansionRoad = {
      id: `expansion-road-${nextExpansionRoadId++}`,
      ...roadData,
    };
    expansionRoads.set(road.id, road);
    syncExpansion();
    selectExpansionRoad(road.id);
    finishEdit();
    setBuildFeedback(
      "Expansion road added. Draw road remains active for the next segment.",
      "success",
    );
  },
  select: selectExpansionRoad,
});

renderer.setExpansionStreetObjectInteractionHandlers({
  place: (objectData) => {
    if (appMode !== "build" || buildWorkspace !== "expansion") return;
    recordEdit();
    const object: ExpansionStreetObject = {
      id: `expansion-object-${nextExpansionStreetObjectId++}`,
      ...objectData,
    };
    expansionStreetObjects.set(object.id, object);
    syncExpansion();
    finishEdit();
    setBuildFeedback(
      object.kind === "crosswalk"
        ? "Crosswalk placed on the expansion road."
        : "Traffic signal placed on the expansion road.",
      "success",
    );
  },
});

renderer.setExpansionEraseInteractionHandlers((target, id) => {
  eraseExpansionObject(target, id);
});

renderer.setExpansionStatusHandler((message, tone = "info") => {
  setBuildFeedback(message, tone);
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

function setBuildFeedback(
  message: string,
  tone: "info" | "success" | "warning" | "error" = "info",
): void {
  selectionStatus.textContent = message;
  buildActionStatus.textContent = message;
  buildActionStatus.dataset.tone = tone;
}

function updateBuildSelectionName(): void {
  if (buildWorkspace === "city-edit") {
    buildSelectionName.textContent = selectedFeature?.name ?? "No street selected";
    return;
  }
  const building = selectedPlacedBuildingId
    ? placedBuildings.get(selectedPlacedBuildingId)
    : undefined;
  if (building) {
    buildSelectionName.textContent = formatBuildingFunction(
      functionForPlacedBuilding(building),
    );
    return;
  }
  if (selectedExpansionRoadId) {
    buildSelectionName.textContent =
      `Expansion road ${selectedExpansionRoadId.match(/\d+$/)?.[0] ?? ""}`.trim();
    return;
  }
  if (activeBuildingTool) {
    buildSelectionName.textContent = `New ${formatBuildingKind(activeBuildingTool).toLowerCase()}`;
    return;
  }
  if (activeExpansionStreetObjectTool) {
    buildSelectionName.textContent = activeExpansionStreetObjectTool === "crosswalk"
      ? "New crosswalk"
      : "New traffic signal";
    return;
  }
  buildSelectionName.textContent = expansionEraseToolActive
    ? "User-built item"
    : "Expansion area";
}

function setBuildWorkspace(workspace: BuildWorkspace): void {
  buildWorkspace = workspace;
  document.body.dataset.buildWorkspace = workspace;
  const expansion = workspace === "expansion";
  cityEditWorkspace.setAttribute("aria-pressed", String(!expansion));
  expansionWorkspace.setAttribute("aria-pressed", String(expansion));
  for (const section of buildWorkspaceSections) {
    section.hidden = section.dataset.buildWorkspaceSection !== workspace;
  }
  renderer.setExpansionMode(appMode === "build" && expansion);
  if (expansion) {
    renderer.setSelectedFeature(null);
    buildWorkspaceHelp.textContent =
      "Build on the green edge outside the city outline. Draw roads first so new buildings are reachable.";
    updateBuildSelectionName();
    if (!activeBuildingTool && !activeExpansionStreetObjectTool) {
      setExpansionRoadToolActive(true);
    } else {
      syncExpansionToolState();
    }
  } else {
    expansionRoadToolActive = false;
    expansionEraseToolActive = false;
    activeExpansionStreetObjectTool = null;
    activeBuildingTool = null;
    renderer.setSelectedPlacedBuilding(null);
    renderer.setSelectedExpansionRoad(null);
    selectedPlacedBuildingId = null;
    selectedExpansionRoadId = null;
    buildingEditor.hidden = true;
    expansionRoadEditor.hidden = true;
    selectedFeature = selectedFeature && features.some(
      (feature) => feature.id === selectedFeature?.id,
    )
      ? selectedFeature
      : features.find((feature) => feature.kind === "street") ?? features[0];
    selectedTrafficFeature = selectedFeature ?? null;
    selectedEntity = null;
    renderer.setSelectedEntity(null);
    buildWorkspaceHelp.textContent =
      "Click a highlighted street or intersection, then apply an edit below.";
    renderer.setSelectedFeature(selectedFeature?.id ?? null);
    syncExpansionToolState();
    updateBuildSelectionName();
    updateSelectionPanel();
    setBuildFeedback(
      selectedFeature
        ? `${selectedFeature.name} is ready to edit.`
        : "Select a highlighted street or intersection to begin.",
    );
  }
}

function setExpansionRoadToolActive(active: boolean): void {
  expansionRoadToolActive = active && buildWorkspace === "expansion";
  if (expansionRoadToolActive) {
    expansionEraseToolActive = false;
    activeExpansionStreetObjectTool = null;
    activeBuildingTool = null;
  }
  syncExpansionToolState();
  updateBuildSelectionName();
  setBuildFeedback(
    expansionRoadToolActive
      ? "Draw road active: click a start point, then an end point on green expansion ground."
      : "Choose an expansion tool.",
  );
}

function selectExpansionStreetObjectTool(
  tool: ExpansionStreetObjectKind,
): void {
  if (buildWorkspace !== "expansion") setBuildWorkspace("expansion");
  activeExpansionStreetObjectTool =
    activeExpansionStreetObjectTool === tool ? null : tool;
  expansionRoadToolActive = false;
  expansionEraseToolActive = false;
  activeBuildingTool = null;
  syncExpansionToolState();
  updateBuildSelectionName();
  setBuildFeedback(
    activeExpansionStreetObjectTool === "crosswalk"
      ? "Crosswalk active: click directly on a user-built road."
      : activeExpansionStreetObjectTool === "traffic-signal"
        ? "Traffic signal active: click directly on a user-built road."
        : "Choose an expansion tool.",
  );
}

function setExpansionEraseToolActive(active: boolean): void {
  expansionEraseToolActive = active && buildWorkspace === "expansion";
  if (expansionEraseToolActive) {
    expansionRoadToolActive = false;
    activeExpansionStreetObjectTool = null;
    activeBuildingTool = null;
  }
  syncExpansionToolState();
  updateBuildSelectionName();
  if (expansionEraseToolActive) {
    setBuildFeedback(
      "Bulldoze active: click a user-built road, object, or building.",
      "warning",
    );
  } else {
    setBuildFeedback("Choose an expansion tool.");
  }
}

function selectBuildingTool(kind: BuildingKind): void {
  if (buildWorkspace !== "expansion") setBuildWorkspace("expansion");
  activeBuildingTool = activeBuildingTool === kind ? null : kind;
  expansionRoadToolActive = false;
  expansionEraseToolActive = false;
  activeExpansionStreetObjectTool = null;
  if (activeBuildingTool) {
    buildingColorControl.value = defaultBuildingColor(activeBuildingTool);
  }
  syncExpansionToolState();
  updateBuildSelectionName();
  setBuildFeedback(
    activeBuildingTool
      ? `Place ${formatBuildingKind(activeBuildingTool).toLowerCase()}: click green expansion ground outside the city outline.`
      : "Choose an expansion tool.",
  );
}

function syncExpansionToolState(): void {
  const active =
    appMode === "build" &&
    buildWorkspace === "expansion" &&
    cameraMode === "orbit";
  renderer.setExpansionMode(appMode === "build" && buildWorkspace === "expansion");
  renderer.setExpansionRoadDrawEnabled(active && expansionRoadToolActive);
  renderer.setExpansionEraseEnabled(active && expansionEraseToolActive);
  renderer.setExpansionStreetObjectPlacementTool(
    active ? activeExpansionStreetObjectTool : null,
  );
  renderer.setBuildingPlacementEnabled(active && activeBuildingTool !== null);
  canvas.dataset.buildInteraction = !active
    ? "none"
    : expansionEraseToolActive
      ? "erase"
      : expansionRoadToolActive
        ? "road"
        : activeExpansionStreetObjectTool
          ? "street-object"
          : activeBuildingTool
            ? "building"
            : "none";
  drawExpansionRoadButton.setAttribute(
    "aria-pressed",
    String(expansionRoadToolActive),
  );
  eraseExpansionButton.setAttribute(
    "aria-pressed",
    String(expansionEraseToolActive),
  );
  placeExpansionCrosswalkButton.setAttribute(
    "aria-pressed",
    String(activeExpansionStreetObjectTool === "crosswalk"),
  );
  placeExpansionSignalButton.setAttribute(
    "aria-pressed",
    String(activeExpansionStreetObjectTool === "traffic-signal"),
  );
  for (const button of buildingToolButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.buildingTool === activeBuildingTool),
    );
  }
}

function placeBuilding(x: number, z: number): void {
  if (
    appMode !== "build" ||
    buildWorkspace !== "expansion" ||
    !activeBuildingTool
  ) return;
  const requestedBuilding: PlacedBuilding = {
    id: `placed-building-${nextBuildingId}`,
    kind: activeBuildingTool,
    function: defaultFunctionForKind(activeBuildingTool),
    x,
    z,
    rotation: 0,
    floors: clampFloors(Number(buildingFloorsControl.value)),
    color: buildingColorControl.value,
  };
  const building = renderer.resolveExpansionBuildingPlacement(requestedBuilding);
  if (!building) {
    setBuildFeedback(
      "Place buildings near a user-built road with enough open roadside space.",
      "error",
    );
    return;
  }
  const validation = renderer.validateBuildingPlacement(building);
  if (!validation.valid) {
    setBuildFeedback(validation.reason, "error");
    return;
  }
  recordEdit();
  nextBuildingId += 1;
  placedBuildings.set(building.id, building);
  syncExpansion();
  selectPlacedBuilding(building.id);
  finishEdit();
  const access = simulation.getExpansionBuildingAccess(building.id);
  setBuildFeedback(
    `${formatBuildingKind(building.kind)} placed. Drag it to move; use the editor below to change its use, floors, or rotation. ${access?.connected ? "Transport network connected." : "Draw a road nearby to connect it."}`,
    "success",
  );
}

function selectPlacedBuilding(id: string | null): void {
  selectedPlacedBuildingId = id;
  selectedExpansionRoadId = null;
  renderer.setSelectedPlacedBuilding(id);
  renderer.setSelectedExpansionRoad(null);
  expansionRoadEditor.hidden = true;
  const building = id ? placedBuildings.get(id) : undefined;
  buildingEditor.hidden = !building;
  updateBuildSelectionName();
  if (!building) return;
  selectedBuildingKind.value = functionForPlacedBuilding(building);
  selectedBuildingFloors.value = String(building.floors);
  selectedBuildingColor.value = building.color;
  buildingPositionOutput.textContent = formatBuildingPosition(
    building.x,
    building.z,
  );
  const role = deriveBuildingRole(building);
  buildingResidentsOutput.textContent = role.residents.toLocaleString();
  buildingJobsOutput.textContent = role.jobs.toLocaleString();
  buildingVisitorsOutput.textContent = role.dailyVisitors.toLocaleString();
  buildingFreightOutput.textContent = role.dailyFreightTrips.toLocaleString();
  const detailed = simulation.getState().entities.buildings.find(
    (candidate) => candidate.id === building.id,
  );
  buildingBuildTimeOutput.textContent = detailed
    ? `${detailed.constructionDaysRemaining} days`
    : "Pending";
  buildingProjectCostOutput.textContent = detailed
    ? formatDetailedMoney(detailed.constructionCost)
    : "Pending";
  const access = simulation.getExpansionBuildingAccess(building.id);
  setBuildFeedback(
    access?.connected
      ? `Connected to the transport network. Walking support +${access.walkingBonus}; cycling support +${access.cyclingBonus}.`
      : "Not connected. Draw a road close to this building so deliveries, workers, customers, and residents can reach it.",
    access?.connected ? "success" : "warning",
  );
}

function updateSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  const current = placedBuildings.get(selectedPlacedBuildingId);
  if (!current) return;
  const updated: PlacedBuilding = {
    ...current,
    kind: buildingKindForFunction(selectedBuildingKind.value as BuildingFunction),
    function: selectedBuildingKind.value as BuildingFunction,
    floors: clampFloors(Number(selectedBuildingFloors.value)),
    color: selectedBuildingColor.value,
  };
  const resolved = renderer.resolveExpansionBuildingPlacement(updated);
  if (!resolved) {
    setBuildFeedback(
      "The selected building no longer fits on this roadside parcel.",
      "error",
    );
    selectPlacedBuilding(current.id);
    return;
  }
  const validation = renderer.validateBuildingPlacement(resolved);
  if (!validation.valid) {
    setBuildFeedback(validation.reason, "error");
    selectPlacedBuilding(current.id);
    return;
  }
  recordEdit();
  placedBuildings.set(resolved.id, resolved);
  syncExpansion();
  selectPlacedBuilding(resolved.id);
  finishEdit();
}

function rotateSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  const current = placedBuildings.get(selectedPlacedBuildingId);
  if (!current) return;
  const updated = {
    ...current,
    rotation: (current.rotation + Math.PI / 2) % (Math.PI * 2),
  };
  const validation = renderer.validateBuildingPlacement(updated);
  if (!validation.valid) {
    setBuildFeedback(validation.reason, "error");
    return;
  }
  recordEdit();
  placedBuildings.set(updated.id, updated);
  syncExpansion();
  selectPlacedBuilding(updated.id);
  finishEdit();
}

function deleteSelectedBuilding(): void {
  if (!selectedPlacedBuildingId) return;
  eraseExpansionObject("building", selectedPlacedBuildingId);
}

function selectExpansionRoad(id: string | null): void {
  selectedExpansionRoadId = id;
  selectedPlacedBuildingId = null;
  renderer.setSelectedExpansionRoad(id);
  renderer.setSelectedPlacedBuilding(null);
  if (appMode === "simulate" && id) {
    const road = expansionRoads.get(id);
    if (!road) return;
    selectedEntity = null;
    selectedFeature = undefined;
    selectedTrafficFeature = {
      id: road.id,
      kind: "street",
      name: `Expansion Road ${road.id.match(/\d+$/)?.[0] ?? ""}`.trim(),
      description: `${Math.round(Math.hypot(road.endX - road.startX, road.endZ - road.startZ))} m user-built road`,
      axis: Math.abs(road.endX - road.startX) >= Math.abs(road.endZ - road.startZ)
        ? "x"
        : "z",
      path: [],
    };
    inspectorTab = "overview";
    syncEntitySelectionState();
    entityInterfaceSignature = "";
    updateEntityInterface();
    return;
  }
  buildingEditor.hidden = true;
  expansionRoadEditor.hidden = id === null;
  updateBuildSelectionName();
  if (id) {
    setBuildFeedback(
      "Road selected. Adjust its capacity and walking or cycling support below.",
    );
  }
}

function applyExpansionRoadTool(tool: BuildTool): void {
  if (!selectedExpansionRoadId) {
    setBuildFeedback("Select a user-built road before applying a road edit.", "error");
    return;
  }
  const road = expansionRoads.get(selectedExpansionRoadId);
  if (!road) return;
  const updated = { ...road };
  const laneDelta = updated.laneDelta ?? 0;
  recordEdit();
  if (tool === "add-lane") updated.laneDelta = laneDelta === 1 ? 0 : 1;
  if (tool === "remove-lane") updated.laneDelta = laneDelta === -1 ? 0 : -1;
  if (tool === "bike-lane") updated.bikeLane = !updated.bikeLane;
  if (tool === "sidewalk") updated.widenedSidewalk = !updated.widenedSidewalk;
  if (tool === "direction") {
    updated.laneDirection = nextDirection(updated.laneDirection ?? "two-way");
  }
  expansionRoads.set(updated.id, updated);
  syncExpansion();
  selectExpansionRoad(updated.id);
  finishEdit();
  setBuildFeedback(`${formatTool(tool)} applied to the selected expansion road.`, "success");
}

function deleteSelectedExpansionRoad(): void {
  if (!selectedExpansionRoadId) return;
  eraseExpansionObject("road", selectedExpansionRoadId);
}

function eraseExpansionObject(
  target: "road" | "street-object" | "building",
  id: string,
): void {
  if (target === "road") {
    const validation = renderer.validateExpansionRoadRemoval(id);
    if (!validation.valid) {
      setBuildFeedback(validation.reason, "error");
      return;
    }
  }
  recordEdit();
  let changed: boolean;
  if (target === "building") {
    changed = placedBuildings.delete(id);
    if (selectedPlacedBuildingId === id) selectPlacedBuilding(null);
  } else if (target === "street-object") {
    changed = expansionStreetObjects.delete(id);
  } else {
    const road = expansionRoads.get(id);
    changed = expansionRoads.delete(id);
    if (road) {
      for (const object of [...expansionStreetObjects.values()]) {
        if (
          distanceToSegment(
            object.x,
            object.z,
            road.startX,
            road.startZ,
            road.endX,
            road.endZ,
          ) <= road.width
        ) {
          expansionStreetObjects.delete(object.id);
        }
      }
    }
    if (selectedExpansionRoadId === id) selectExpansionRoad(null);
  }
  if (!changed) {
    editHistory.undo(captureEditorSnapshot());
    updateHistoryButtons();
    return;
  }
  syncExpansion();
  finishEdit();
  setBuildFeedback("User-built item erased. Undo is available.", "success");
}

function syncExpansion(): void {
  const buildings = [...placedBuildings.values()];
  const roads = [...expansionRoads.values()];
  const streetObjects = [...expansionStreetObjects.values()];
  renderer.setExpansionRoads(roads);
  renderer.setPlacedBuildings(buildings);
  renderer.setExpansionStreetObjects(streetObjects);
  simulation.setExpansionDesign(buildings, roads, streetObjects);
  const crosswalks = streetObjects.filter(
    (object) => object.kind === "crosswalk",
  ).length;
  expansionRoadCount.textContent =
    `${expansionRoads.size} roads · ${crosswalks} crosswalks · ${expansionStreetObjects.size - crosswalks} signals`;
}

function captureEditorSnapshot(): EditorSnapshot {
  return {
    designs: [...designs].map(([id, design]) => [id, { ...design }]),
    buildings: [...placedBuildings.values()].map((building) => ({ ...building })),
    expansionRoads: [...expansionRoads.values()].map((road) => ({ ...road })),
    expansionStreetObjects: [...expansionStreetObjects.values()].map(
      (object) => ({ ...object }),
    ),
    nextBuildingId,
    nextExpansionRoadId,
    nextExpansionStreetObjectId,
  };
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
  placedBuildings.clear();
  expansionRoads.clear();
  expansionStreetObjects.clear();
  for (const [id, design] of snapshot.designs) designs.set(id, { ...design });
  for (const road of snapshot.expansionRoads) {
    expansionRoads.set(road.id, { ...road });
  }
  renderer.setPlacedBuildings([]);
  renderer.setExpansionRoads([...expansionRoads.values()]);
  const alignedBuildings: PlacedBuilding[] = [];
  for (const building of snapshot.buildings) {
    renderer.setPlacedBuildings(alignedBuildings);
    alignedBuildings.push(
      renderer.resolveExpansionBuildingPlacement(building) ?? { ...building },
    );
  }
  for (const building of alignedBuildings) {
    placedBuildings.set(building.id, building);
  }
  for (const object of snapshot.expansionStreetObjects) {
    expansionStreetObjects.set(object.id, { ...object });
  }
  nextBuildingId = snapshot.nextBuildingId;
  nextExpansionRoadId = snapshot.nextExpansionRoadId;
  nextExpansionStreetObjectId = snapshot.nextExpansionStreetObjectId;
  selectedPlacedBuildingId = null;
  selectedExpansionRoadId = null;
  buildingEditor.hidden = true;
  expansionRoadEditor.hidden = true;
  renderer.setSelectedPlacedBuilding(null);
  renderer.setSelectedExpansionRoad(null);
  syncExpansion();
  syncDesign();
}

function applyProjectSnapshot(snapshot: ProjectSnapshot): void {
  applyEditorSnapshot(snapshot);
  simulation.setSimulationSpeed(snapshot.settings.simulationSpeed);
  simulation.setTimeHorizon(snapshot.settings.timeHorizon ?? "day");
  timeRateControl.value = String(nearestTimeRatePresetIndex(
    simulation.getSettings().simulationSpeed,
    simulation.getSettings().timeHorizon,
  ));
  simulation.setSpeedLimit(snapshot.settings.speedLimitMph);
  simulation.setSignalCycle(snapshot.settings.signalCycleSeconds);
  simulation.setSimulationSeed(snapshot.settings.simulationSeed);
  simulation.setTransitHeadway(snapshot.settings.transitHeadwayMinutes ?? 12);
  simulation.setRoadCapacity(snapshot.settings.roadCapacity ?? 100);
  simulation.setZoningStrictness(snapshot.settings.zoningStrictness ?? 1);
  simulation.setTimeOfDay(snapshot.timeOfDayHours);
  simulation.setWeather(snapshot.weather);
  speedLimitControl.value = String(simulation.getSettings().speedLimitMph);
  signalCycleControl.value = String(simulation.getSettings().signalCycleSeconds);
  simulationSeedControl.value = String(simulation.getSettings().simulationSeed);
  transitHeadwayControl.value = String(
    simulation.getSettings().transitHeadwayMinutes,
  );
  syncEnvironmentControls();
  editHistory.clear();
  updateHistoryButtons();
}

function recordEdit(): void {
  editHistory.record(captureEditorSnapshot());
  updateHistoryButtons();
}

function finishEdit(): void {
  localStorage.setItem(PROJECT_SAVE_KEY, JSON.stringify(captureProjectSnapshot()));
  updateHistoryButtons();
}

function undoEdit(): void {
  const snapshot = editHistory.undo(captureEditorSnapshot());
  if (!snapshot) return;
  applyEditorSnapshot(snapshot);
  finishEdit();
}

function redoEdit(): void {
  const snapshot = editHistory.redo(captureEditorSnapshot());
  if (!snapshot) return;
  applyEditorSnapshot(snapshot);
  finishEdit();
}

function updateHistoryButtons(): void {
  undoEditButton.disabled = !editHistory.canUndo;
  redoEditButton.disabled = !editHistory.canRedo;
}

function saveProject(): void {
  localStorage.setItem(PROJECT_SAVE_KEY, JSON.stringify(captureProjectSnapshot()));
  setBuildFeedback("Project saved in this browser.", "success");
}

function loadProject(): void {
  const raw = localStorage.getItem(PROJECT_SAVE_KEY);
  if (!raw) {
    setBuildFeedback("No saved project was found in this browser.", "warning");
    return;
  }
  try {
    applyProjectSnapshot(parseProjectSnapshot(raw));
    setBuildFeedback("Saved project loaded.", "success");
  } catch (error) {
    setBuildFeedback(
      error instanceof Error ? error.message : "The saved project could not be loaded.",
      "error",
    );
  }
}

function exportProject(): void {
  const blob = new Blob(
    [JSON.stringify(captureProjectSnapshot(), null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "penn-campus-simulator-linn.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importProject(): Promise<void> {
  const file = importProjectFile.files?.[0];
  if (!file) return;
  try {
    applyProjectSnapshot(parseProjectSnapshot(await file.text()));
    finishEdit();
    setBuildFeedback(`${file.name} imported.`, "success");
  } catch (error) {
    setBuildFeedback(
      error instanceof Error ? error.message : "The project file could not be imported.",
      "error",
    );
  } finally {
    importProjectFile.value = "";
  }
}

function syncEnvironmentControls(): void {
  const state = simulation.getState();
  timeOfDayControl.value = String(state.timeOfDayHours);
  timeOfDayOutput.value = formatTimeOfDay(state.timeOfDayHours);
  weatherControl.value = state.weather;
  const risk = getPhillyCrashRiskProfile(state.timeOfDayHours);
  violationRiskOutput.textContent =
    `Philly crash index: traffic ${risk.trafficMultiplier.toFixed(2)}× · pedestrian ${risk.pedestrianMultiplier.toFixed(2)}×`;
  renderer.setTimeOfDay(state.timeOfDayHours);
  renderer.setWeather(state.weather);
}

function formatTimeOfDay(hours: number): string {
  const totalMinutes = Math.round(hours * 60) % 1440;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function formatBuildingPosition(x: number, z: number): string {
  return `X ${x.toFixed(0)} · Z ${z.toFixed(0)}`;
}

function formatBuildingKind(kind: BuildingKind): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} building`;
}

function defaultBuildingColor(kind: BuildingKind): string {
  if (kind === "commercial") return "#5f8ca8";
  if (kind === "industrial") return "#9b7654";
  if (kind === "civic") return "#c9aa62";
  return "#bf765f";
}

function clampFloors(value: number): number {
  return Math.max(1, Math.min(20, Math.round(value || 1)));
}

function isBuildingKind(value: string | undefined): value is BuildingKind {
  return (
    value === "residential" ||
    value === "commercial" ||
    value === "industrial" ||
    value === "civic"
  );
}

function distanceToSegment(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(x - startX, z - startZ);
  const t = Math.max(
    0,
    Math.min(1, ((x - startX) * dx + (z - startZ) * dz) / lengthSquared),
  );
  return Math.hypot(x - (startX + dx * t), z - (startZ + dz * t));
}

function setAppMode(mode: AppMode): void {
  cancelWalkPlacement();
  const enteringBuild = mode === "build" && appMode !== "build";
  const leavingBuild = mode === "simulate" && appMode === "build";
  appMode = mode;
  document.body.dataset.appMode = mode;
  const building = mode === "build";
  if (building && cameraMode !== "orbit") setCameraMode("orbit");
  buildModeButton.setAttribute("aria-pressed", String(building));
  simulateModeButton.setAttribute("aria-pressed", String(!building));
  flyCameraButton.disabled = building;
  walkCameraButton.disabled = building;
  flyCameraButton.title = building ? "Fly is available in Live mode" : "Fly camera";
  walkCameraButton.title = building ? "Walk is available in Live mode" : "Choose a walking start";
  renderer.setBuildMode(building);
  renderer.setExpansionMode(building && buildWorkspace === "expansion");
  renderer.setExpansionSelectionEnabled(true);
  syncExpansionToolState();
  renderer.setMapOverlay(analysisOverlay.value as MapOverlayMode);
  renderer.setSelectedEntity(selectedEntity);
  syncEntitySelectionState();
  if (building) {
    setNotificationOpen(false);
    if (enteringBuild) restoreInspectorAfterBuild = !cityInspectorPanel.hidden;
    cityInspectorPanel.hidden = true;
    cityInspectorRestoreButton.hidden = false;
    document.body.dataset.cityInspector = "minimized";
    setBuildWorkspace(buildWorkspace);
    orbitCameraHint.textContent = "Planning paused · Top-down building controls active";
    updateSelectionPanel();
  } else {
    if (leavingBuild && restoreInspectorAfterBuild) {
      cityInspectorPanel.hidden = false;
      cityInspectorRestoreButton.hidden = true;
      document.body.dataset.cityInspector = "open";
    }
    restoreInspectorAfterBuild = false;
    orbitCameraHint.textContent = "Live city · Select any road, building, or person";
    simulationTitle.textContent = "Penn · University City";
    sceneSubtitle.textContent = "Live traffic, pedestrian, and signal operations";
  }
  entityInterfaceSignature = "";
  updateInterface();
}

function setCameraMode(mode: CameraMode): void {
  cancelWalkPlacement();
  cameraMode = mode;
  document.body.dataset.cameraMode = mode;
  orbitCameraButton.setAttribute("aria-pressed", String(mode === "orbit"));
  flyCameraButton.setAttribute("aria-pressed", String(mode === "fly"));
  walkCameraButton.setAttribute("aria-pressed", String(mode === "walk"));
  renderer.setCameraMode(mode);
  syncExpansionToolState();
}

function beginWalkPlacement(): void {
  setCameraMode("orbit");
  walkPlacementActive = true;
  document.body.dataset.walkPlacement = "true";
  orbitCameraButton.setAttribute("aria-pressed", "false");
  flyCameraButton.setAttribute("aria-pressed", "false");
  walkCameraButton.setAttribute("aria-pressed", "true");
  orbitCameraHint.textContent = "Drag the person marker onto the map to choose a walk start";
}

function completeWalkPlacement(clientX: number, clientY: number): void {
  if (!renderer.setWalkStartFromScreen(clientX, clientY)) return;
  setCameraMode("walk");
}

function cancelWalkPlacement(): void {
  walkPlacementActive = false;
  walkMarkerPointerId = null;
  resetWalkMarkerPosition();
  document.body.dataset.walkPlacement = "false";
  document.body.dataset.walkMarkerDragging = "false";
  orbitCameraHint.textContent = appMode === "build"
    ? "Planning paused · Select a road, building, or person"
    : "Live city · Select any road, building, or person";
}

function resetWalkMarkerPosition(): void {
  walkStartMarker.style.removeProperty("left");
  walkStartMarker.style.removeProperty("top");
}

function syncEntitySelectionState(): void {
  document.body.dataset.entitySelection = selectedEntity?.kind ?? "none";
  cityInspectorOverviewButton.hidden = !selectedEntity && !selectedTrafficFeature;
}

function clearInspectorSelection(): void {
  showAffectedRoads = false;
  selectedEntity = null;
  selectedTrafficFeature = null;
  selectedFeature = undefined;
  inspectorTab = "overview";
  interventionFeedback = "";
  renderer.setSelectedEntity(null);
  renderer.setSelectedFeature(null);
  renderer.setSelectedPlacedBuilding(null);
  renderer.setSelectedExpansionRoad(null);
  entityTooltip.hidden = true;
  syncEntitySelectionState();
  updateSelectionPanel();
  entityInterfaceSignature = "";
  updateEntityInterface();
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
  recordLiveStatHistory();
  const metrics =
    metricView === "baseline" ? simulation.getBaselineMetrics() : state.metrics;
  vehicleTime.textContent = `${metrics.vehicleTravelSeconds.toFixed(1)} s`;
  pedestrianWait.textContent = `${metrics.pedestrianWaitSeconds.toFixed(1)} s`;
  conflicts.textContent = String(metrics.potentialConflicts);
  throughput.textContent = metrics.throughputPerHour.toLocaleString();
  buildingArrivals.textContent = metrics.buildingArrivals.toLocaleString();
  trafficViolations.textContent = metrics.trafficViolations.toLocaleString();
  jaywalkingViolations.textContent = metrics.jaywalkingViolations.toLocaleString();
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
  cityOutput.textContent = formatCurrency(cityMetrics.grossCityProductDaily);
  cityUnemployment.textContent = `${cityMetrics.unemploymentPercent.toFixed(1)}%`;
  cityTrafficCost.textContent = `${formatCurrency(cityMetrics.congestionCostDaily)}/day`;
  cityMigration.textContent = `${formatSigned(cityMetrics.annualizedNetMigration)}/yr`;
  syncEnvironmentControls();
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
  updateBuildSelectionName();
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
  setBuildFeedback(
    `${selectedFeature.name} selected. Available edits are enabled below.`,
  );
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
  setBuildFeedback(`Live signal timing updated at ${selectedFeature.name}.`, "success");
}

function requestManualSignal(target: ManualSignalTarget): void {
  if (!selectedFeature || selectedFeature.kind !== "intersection") return;
  simulation.requestManualSignal(selectedFeature.id, target);
  signalModeControl.value = "manual";
  updateSelectedSignalStatus();
  setBuildFeedback(`${formatSignalPhase(target)} requested with a safe yellow and all-red transition.`, "success");
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

function validateBuildToolTarget(tool: BuildTool): boolean {
  const streetTool = ["add-lane", "remove-lane", "bike-lane", "sidewalk", "direction"].includes(
    tool,
  );
  if (!selectedFeature) {
    setBuildFeedback(
      `Select a ${streetTool ? "street segment" : "intersection"} first.`,
      "error",
    );
    return false;
  }
  if (
    (streetTool && selectedFeature.kind !== "street") ||
    (!streetTool && selectedFeature.kind !== "intersection")
  ) {
    setBuildFeedback(
      `Select a ${streetTool ? "street segment" : "intersection"} first.`,
      "error",
    );
    return false;
  }
  return true;
}

function applyBuildTool(tool: BuildTool): void {
  if (!validateBuildToolTarget(tool) || !selectedFeature) return;

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
  setBuildFeedback(
    `${formatTool(tool)} applied to ${selectedFeature.name}.`,
    "success",
  );
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
  const state = simulation.getState();
  const favoriteSignature = state.entities.people
    .filter((person) => favoritePersonIds.has(person.id))
    .map((person) => `${person.id}-${person.mobility.phase}-${person.mobility.destinationBuildingId}-${Math.round(person.mobility.routeProgress * 20)}-${Math.round(person.happiness)}`)
    .join(",");
  const selectedPerson = selectedEntity?.kind === "person"
    ? state.entities.people.find((person) => person.id === selectedEntity?.id)
    : undefined;
  const selectedBuildingTraffic = selectedEntity?.kind === "building"
    ? simulation.getBuildingTrafficAttribution(selectedEntity.id)
    : null;
  renderer.setTrafficFocusSegments(
    showAffectedRoads
      ? selectedBuildingTraffic?.roads.slice(0, 8).map((road) => road.segmentId) ?? []
      : [],
  );
  const trafficSignature = selectedBuildingTraffic
    ? `${selectedBuildingTraffic.totalTransportCost}:${selectedBuildingTraffic.roads.slice(0, 6)
      .map((road) => `${road.segmentId}-${road.congestionPercent}-${road.attributedCongestionCost}`)
      .join(",")}`
    : "no-building-traffic";
  const signature = [
    state.entities.lastUpdatedDay,
    selectedPerson?.currentActivity ?? "static",
    selectedPerson?.mobility.phase ?? "stationary",
    Math.round((selectedPerson?.mobility.routeProgress ?? 0) * 20),
    selectedPerson?.mobility.delayMinutes ?? 0,
    state.mobilityDetailMode,
    selectedEntity?.kind ?? "none",
    selectedEntity?.id ?? "none",
    selectedTrafficFeature?.id ?? "no-road",
    state.roadTraffic.find((road) => road.segmentId === selectedTrafficFeature?.id)?.congestionPercent ?? 0,
    analysisOverlay.value,
    appMode,
    inspectorTab,
    interventionFeedback,
    showAffectedRoads,
    comparedBuildingIds.join(","),
    trafficSignature,
    favoriteSignature,
  ].join(":");
  if (signature === entityInterfaceSignature) return;
  entityInterfaceSignature = signature;
  renderMapLegend(analysisOverlay.value as MapOverlayMode);
  renderNotificationCenter();
  renderFavoritePeople();
  renderBuildingComparison();

  if (!selectedEntity && selectedTrafficFeature) {
    renderTrafficInspector(selectedTrafficFeature);
    return;
  }

  if (!selectedEntity) {
    const represented = Math.max(1, Math.round(state.city.metrics.population / Math.max(1, state.entities.people.length)));
    const localWorkers = state.entities.people.filter((person) => person.employment === "local").length;
    const externalWorkers = state.entities.people.filter((person) => person.employment === "external").length;
    entityInspector.innerHTML = `
      <div class="inspector-empty district-overview">
        <strong>University City model</strong>
        <p>Click any building or visible person to inspect the decisions behind the citywide totals.</p>
        <div class="inspector-stat-grid">
          ${statCell("Modeled buildings", state.entities.buildings.length.toLocaleString(), "model", "buildings")}
          ${statCell("Sample residents", state.entities.people.length.toLocaleString(), "model", "residents")}
          ${statCell("Local workers", localWorkers.toLocaleString(), "model", "localWorkers")}
          ${statCell("Outside workers", externalWorkers.toLocaleString(), "model", "outsideWorkers")}
        </div>
        <p class="representation-callout">1 visible resident represents about ${represented.toLocaleString()} city residents. Every modeled building has its own function and accounting.</p>
        <details class="simulation-order">
          <summary>Today's simulation steps</summary>
          <ol>
            <li>Buildings request workers and supplies.</li>
            <li>Residents work, earn wages, and make service visits.</li>
            <li>Labor and delivered supplies gate production and sales.</li>
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
    work: sumNumbers(connections.filter((connection) => connection.kind === "work").map((connection) => connection.volume)),
    visit: sumNumbers(connections.filter((connection) => connection.kind === "visit").map((connection) => connection.volume)),
    delivery: sumNumbers(connections.filter((connection) => connection.kind === "delivery").map((connection) => connection.volume)),
  };
  const civic = isCivicFunction(building.function);
  const housing = building.function === "housing";
  const residentPeople = state.entities.people.filter((person) => person.homeBuildingId === building.id);
  const residentHouseholds = state.entities.households.filter((household) => household.homeBuildingId === building.id);
  const revenueLabel = housing ? "Rent" : civic
    ? accounting.salesRevenue > 0 ? "Public + earned" : "Public grant"
    : "Revenue";
  const netLabel = civic ? "Balance" : "Net";
  const maxFlow = Math.max(1, accounting.operatingRevenue, accounting.operatingCost);
  const cityTraffic = state.city.metrics;
  const traffic = simulation.getBuildingTrafficAttribution(building.id);
  const generatedTrips = traffic
    ? traffic.workVehicleTripsDaily + traffic.visitVehicleTripsDaily + traffic.deliveryVehicleTripsDaily
    : connectionTotals.work + connectionTotals.visit;
  const primaryStats = building.developmentStage === "construction"
    ? [
        ["Stage", "Under construction", "developmentStage"],
        ["Opens in", `${building.constructionDaysRemaining} days`, "constructionDaysRemaining"],
        ["Project cost", formatDetailedMoney(building.constructionCost), "constructionCost"],
        ["Daily deliveries", Math.round(connectionTotals.delivery).toLocaleString(), "deliveryUnits"],
      ]
    : housing
    ? [
        ["Residents", `${residents} / ${building.residentCapacity}`, "residents"],
        ["Monthly rent", formatDetailedMoney(building.rentDaily * 30.4), "rentMonthly"],
        ["Land value", formatDetailedMoney(building.landValue), "landValue"],
        ["Vehicle trips", Math.round(generatedTrips).toLocaleString(), "connectedTrips"],
      ]
    : civic
      ? [
          ["Staff", `${employees} / ${accounting.requiredWorkers}`, "employees"],
          ["Service visits", `${Math.round(accounting.serviceDelivered)} / ${Math.round(accounting.serviceDemand)}`, "serviceDelivered"],
          ["Service quality", `${Math.round(accounting.serviceQuality * 100)}%`, "serviceQuality"],
          ["Public grant", formatDetailedMoney(accounting.municipalFunding), "municipalFunding"],
        ]
      : building.function === "retail"
        ? [
          ["Employees", `${employees} / ${accounting.requiredWorkers}`, "employees"],
          ["Customers", accounting.customers.toLocaleString(), "customers"],
          ["Consumer goods sold", accounting.goodsSold.toFixed(0), "goodsSold"],
          ["Shelf price", formatDetailedMoney(accounting.unitPrice), "unitPrice"],
        ]
        : building.function === "industrial"
          ? [
          ["Employees", `${employees} / ${accounting.requiredWorkers}`, "employees"],
          ["Finished output", `${accounting.goodsProduced.toFixed(0)} units`, "goodsProduced"],
          ["Raw stock", `${building.goodsInventory.toFixed(0)} units`, "goodsInventory"],
          ["Wholesale price", formatDetailedMoney(accounting.unitPrice), "unitPrice"],
        ]
          : building.function === "office"
            ? [
          ["Employees", `${employees} / ${accounting.requiredWorkers}`, "employees"],
          ["Service output", `${accounting.serviceDelivered.toFixed(0)} units`, "serviceDelivered"],
          ["Contract value", formatDetailedMoney(accounting.unitPrice), "unitPrice"],
          ["Workday wage", formatDetailedMoney(accounting.averageWage), "averageWage"],
        ]
            : [
          ["Staff", `${employees} / ${accounting.requiredWorkers}`, "employees"],
          ["Paid parking uses", accounting.serviceDelivered.toFixed(0), "serviceDelivered"],
          ["Parking fee", formatDetailedMoney(accounting.unitPrice), "unitPrice"],
          ["Daily revenue", formatDetailedMoney(accounting.salesRevenue), "salesRevenue"],
        ];
  const residentContext = housing
    ? `${renderHappinessAccounting(residentPeople, "Resident happiness")}${renderAffordabilityAccounting(building, residentHouseholds)}`
    : "";
  const overview = `
    <div class="inspector-stat-grid">${primaryStats.map(([label, value, key]) => statCell(label, value, "building", key, renderBuildingTrend(building, key))).join("")}</div>
    ${building.developmentStage === "construction" ? `<section class="public-funding-section"><h4>Development</h4><p>${civic ? "Municipal capital funding" : "Private development capital"} pays the ${formatDetailedMoney(building.constructionCost)} project cost. Material deliveries create freight traffic now; occupancy, hiring, services, and sales begin only after opening.</p></section>` : ""}
    ${renderBuildingBenchmark(building, state.entities.buildings)}
    ${residentContext}
    <section class="accounting-section">
      <h4>${civic ? "Service accounting" : housing ? "Housing accounting" : "Business accounting"}</h4>
      <div class="accounting-flow">
        ${accountingNode(revenueLabel, accounting.operatingRevenue, maxFlow, "income", "operatingRevenue", "building")}
        <i>→</i>
        ${accountingNode("Costs", accounting.operatingCost, maxFlow, "cost", "operatingCost", "building")}
        <i>→</i>
        ${accountingNode(netLabel, accounting.profit, maxFlow, accounting.profit >= 0 ? "income" : "loss", "profit", "building")}
      </div>
      <div class="cost-breakdown">
        ${inlineStat("Payroll", formatDetailedMoney(accounting.dailyWages), "building", "dailyWages")}
        ${inlineStat("Purchased inputs", formatDetailedMoney(accounting.supplyCost), "building", "supplyCost")}
        ${inlineStat("Delivery", formatDetailedMoney(accounting.transportCost), "building", "transportCost")}
        ${inlineStat("Maintenance", formatDetailedMoney(accounting.maintenanceCost), "building", "maintenanceCost")}
      </div>
      ${renderSupplyAccounting(building)}
      ${!civic && !housing ? renderBusinessOutputAccounting(building) : ""}
      ${!civic && !housing ? `<details class="inspector-details"><summary>Operating details</summary><div class="cost-breakdown business-response-grid">
        ${inlineStat("Local sales", formatDetailedMoney(accounting.localSalesRevenue), "building", "localSalesRevenue")}
        ${inlineStat("Outside sales", formatDetailedMoney(accounting.externalSalesRevenue), "building", "externalSalesRevenue")}
        ${inlineStat("Operating hours", `${Math.round(accounting.operatingScale * 100)}%`, "building", "operatingScale")}
        ${inlineStat("Condition", `${Math.round(accounting.buildingCondition * 100)}%`, "building", "buildingCondition")}
        ${inlineStat("Deferred upkeep", formatDetailedMoney(accounting.maintenanceDeferred), "building", "maintenanceDeferred")}
        ${inlineStat("Target margin", `${Math.round(accounting.targetMargin * 100)}%`, "building", "targetMargin")}
      </div></details>` : ""}
      <p class="entity-diagnosis">${escapeHtml(accounting.diagnosis)}</p>
    </section>
    ${civic ? `<section class="public-funding-section">
      <h4>Public funding</h4>
      <div class="cost-breakdown">
        ${inlineStat("City operating grant", formatDetailedMoney(accounting.municipalFunding), "building", "municipalFunding")}
        ${inlineStat("Service delivered", `${Math.round(accounting.serviceDelivered)} visits`, "building", "serviceDelivered")}
        ${inlineStat("City tax revenue", formatDetailedMoney(state.city.metrics.taxRevenueDaily), "building", "taxRevenueDaily")}
        ${inlineStat("Municipal balance", formatDetailedMoney(state.city.metrics.municipalBalance), "building", "municipalBalance")}
      </div>
      <p>Public funding pays for service capacity. Visits are outcomes, not sales.</p>
    </section>` : ""}`;
  const causes = `
    <section class="accessibility-section">
      <h4>Accessibility drives this result</h4>
      ${renderAccessibilityBreakdown(building)}
      <div class="causal-strip">
        <span>Road delay</span><i>→</i><span>Access</span><i>→</i><span>${civic ? "Service reach" : housing ? "Rent demand" : "Sales and costs"}</span>
      </div>
    </section>
    <section class="traffic-impact">
      <h4>Transport cost</h4>
      <div class="impact-chain">
        ${statCell("Base travel", formatDetailedMoney(traffic?.baseTransportCost ?? accounting.transportCost), "building", "baseTransportCost")}<i>+</i>
        ${statCell("Congestion", formatDetailedMoney(traffic?.congestionSurcharge ?? 0), "building", "congestionSurcharge")}<i>→</i>
        ${statCell("Total daily", formatDetailedMoney(traffic?.totalTransportCost ?? accounting.transportCost), "building", "totalTransportCost")}
      </div>
      <div class="transport-cost-summary">
        ${statCell("External customers", accounting.externalCustomers.toLocaleString(), "building", "externalCustomers")}
        ${statCell("Resident commutes", formatDetailedMoney(traffic?.residentCommuteCost ?? 0), "building", "residentCommuteCost")}
        ${statCell("Route delay", `${(traffic?.averageRouteDelayMinutes ?? cityTraffic.averageTrafficDelayMinutes).toFixed(1)} min`, "building", "routeDelay")}
        ${statCell("Road passages", Math.round(traffic?.roadTripsDaily ?? generatedTrips).toLocaleString(), "building", "roadTrips")}
      </div>
    </section>
    <section class="road-impact-section"><h4>Roads causing the cost</h4>${renderRoadImpacts(traffic)}</section>
    <button type="button" class="affected-roads-button" data-toggle-affected-roads aria-pressed="${showAffectedRoads}">
      ${showAffectedRoads ? "Hide" : "Show"} affected roads on map
    </button>
    <section class="connection-summary">
      <h4>Daily catchment</h4>
      <div class="connection-totals">
        <span data-flow="work"><b>${Math.round(connectionTotals.work)}</b> work legs</span>
        <span data-flow="visit"><b>${Math.round(connectionTotals.visit)}</b> visit legs</span>
        <span data-flow="delivery"><b>${Math.round(connectionTotals.delivery)}</b> supply units</span>
      </div>
      ${renderFlowControls()}
      <details><summary>Individual routes</summary>${renderConnectionDetails(connections, building.id)}</details>
    </section>`;
  const actions = `
    <section class="entity-actions-section">
      <h4>Change this outcome</h4>
      ${traffic?.roads[0] ? `<button type="button" class="primary-inspector-action" data-road-focus="${escapeHtml(traffic.roads[0].segmentId)}">Inspect ${escapeHtml(traffic.roads[0].roadName)}</button>` : ""}
      <p>Street and signal changes alter route delay first. Accessibility then changes worker choice, customer reach, deliveries, prices, profit, land value, and migration on following simulation days.</p>
      ${renderInterventionFeedback()}
    </section>`;
  entityInspector.innerHTML = `
    <article class="entity-card">
      ${renderInspectorBreadcrumb("Buildings", building.name)}
      <header class="entity-heading">
        <div><small>${formatBuildingFunction(building.function)} · ${escapeHtml(building.address)}</small><h3>${escapeHtml(building.name)}</h3></div>
        <div class="entity-heading-actions">
          <button type="button" class="compare-building-button" data-compare-building="${escapeHtml(building.id)}" aria-pressed="${comparedBuildingIds.includes(building.id)}" aria-label="${comparedBuildingIds.includes(building.id) ? "Remove from" : "Add to"} building comparison" title="Compare building">&#8644;</button>
          <span data-entity-status="${accounting.status}">${formatEntityStatus(accounting.status)}</span>
        </div>
      </header>
      <p class="heading-diagnosis">${escapeHtml(accounting.diagnosis)}</p>
      ${renderInspectorTabs(buildingCauseTabLabel(building.function), buildingActionTabLabel(building.function))}
      ${inspectorTab === "overview" ? overview : inspectorTab === "causes" ? causes : actions}
    </article>`;
}

function renderSupplyAccounting(building: Readonly<DetailedBuilding>): string {
  const accounting = building.accounting;
  if (accounting.goodsDemanded <= 0 && building.goodsInventory <= 0 && accounting.supplyCost <= 0) {
    return "";
  }
  const delivered = accounting.goodsReceived;
  const importShare = delivered > 0 ? accounting.importedSupplies / delivered : 0;
  const localShare = delivered > 0 ? accounting.localSupplies / delivered : 0;
  const landedCost = accounting.supplyCost + accounting.transportCost;
  const inputLabel = building.function === "industrial"
    ? "Raw material inputs"
    : building.function === "retail" ? "Consumer stock purchases" : "Operating inputs";
  const unitLabel = building.function === "industrial" ? "raw units" : "units";
  const diagnosis = delivered > 0
    ? accounting.importedSupplies > 0
      ? `${accounting.importedSupplies.toFixed(0)} ${unitLabel} came from outside the city section. Imports cost ${formatDetailedMoney(accounting.importedSupplyCost)} before ${formatDetailedMoney(accounting.transportCost)} in delivery costs.`
      : `All ${accounting.localSupplies.toFixed(0)} delivered ${unitLabel} were sourced inside the city section.`
    : "No input delivery arrived today; operations must use existing inventory or reduce output.";
  return `<div class="supply-accounting-section">
    <h4><span>${inputLabel}</span><strong>${Math.round(importShare * 100)}% imported</strong></h4>
    <div class="supply-source-grid">
      <span data-stat="localSupplies" data-stat-scope="building" tabindex="0">
        <small>Local supply</small><b data-stat-value>${accounting.localSupplies.toFixed(0)} units</b><em>${formatDetailedMoney(accounting.localSupplyCost)}</em>
      </span>
      <span data-stat="importedSupplies" data-stat-scope="building" tabindex="0">
        <small>Imported supply</small><b data-stat-value>${accounting.importedSupplies.toFixed(0)} units</b><em>${formatDetailedMoney(accounting.importedSupplyCost)}</em>
      </span>
    </div>
    <div class="supply-mix" aria-label="${Math.round(localShare * 100)} percent local and ${Math.round(importShare * 100)} percent imported">
      <i data-source="local" style="width:${localShare * 100}%"></i>
      <i data-source="imported" style="width:${importShare * 100}%"></i>
    </div>
    <div class="supply-cost-equation">
      ${statCell("Purchased inputs", formatDetailedMoney(accounting.supplyCost), "building", "supplyCost")}<i>+</i>
      ${statCell("Delivery", formatDetailedMoney(accounting.transportCost), "building", "transportCost")}<i>→</i>
      ${statCell("Landed cost", formatDetailedMoney(landedCost), "building", "landedSupplyCost")}
    </div>
    <p>${escapeHtml(diagnosis)}</p>
  </div>`;
}

function renderBusinessOutputAccounting(building: Readonly<DetailedBuilding>): string {
  const accounting = building.accounting;
  if (building.function === "industrial") {
    return `<div class="business-output-flow"><h4>Production</h4><div class="impact-chain">
      ${statCell("Raw stock after production", `${building.goodsInventory.toFixed(0)} units`, "building", "goodsInventory")}<i>→</i>
      ${statCell("Finished goods", `${accounting.goodsProduced.toFixed(0)} units`, "building", "goodsProduced")}<i>→</i>
      ${statCell("Wholesale sales", formatDetailedMoney(accounting.salesRevenue), "building", "salesRevenue")}
    </div></div>`;
  }
  if (building.function === "retail") {
    return `<div class="business-output-flow"><h4>Consumer goods</h4><div class="impact-chain">
      ${statCell("Stock available", `${(building.goodsInventory + accounting.goodsSold).toFixed(0)} units`, "building", "goodsInventory")}<i>→</i>
      ${statCell("Goods sold", `${accounting.goodsSold.toFixed(0)} units`, "building", "goodsSold")}<i>→</i>
      ${statCell("Retail sales", formatDetailedMoney(accounting.salesRevenue), "building", "salesRevenue")}
    </div></div>`;
  }
  const outputLabel = building.function === "parking" ? "Paid parking uses" : "Service output";
  const inputValue = building.function === "parking"
    ? `${accounting.customers} drivers`
    : `${accounting.activeWorkers} active staff`;
  return `<div class="business-output-flow"><h4>${building.function === "parking" ? "Parking service" : "Business services"}</h4><div class="impact-chain">
    ${statCell(building.function === "parking" ? "Demand" : "Labor", inputValue, "building", building.function === "parking" ? "customers" : "activeWorkers")}<i>→</i>
    ${statCell(outputLabel, `${accounting.serviceDelivered.toFixed(0)} units`, "building", "serviceDelivered")}<i>→</i>
    ${statCell("Service revenue", formatDetailedMoney(accounting.salesRevenue), "building", "salesRevenue")}
  </div></div>`;
}

function renderHappinessAccounting(
  people: readonly DetailedPerson[],
  title: string,
): string {
  if (people.length === 0) return "";
  const factors = [
    ["Needs", "needs", 0.35],
    ["Financial security", "financialSecurity", 0.25],
    ["Employment", "employment", 0.15],
    ["Housing", "housing", 0.15],
    ["Travel", "travel", 0.1],
  ] as const;
  const finalScore = sumNumbers(people.map((person) => person.happiness)) / people.length;
  const rows = factors.map(([label, key, weight]) => {
    const raw = averageHappinessComponent(people, key);
    return `<div class="happiness-factor">
      <span><b>${label}</b><small>${raw.toFixed(0)} × ${Math.round(weight * 100)}%</small></span>
      <meter min="0" max="100" value="${raw}"></meter>
      <strong>${(raw * weight).toFixed(1)} pts</strong>
    </div>`;
  }).join("");
  const considering = people.filter((person) => person.migrationStatus !== "staying").length;
  return `<section class="happiness-accounting">
    <h4>${title}<strong>${finalScore.toFixed(0)}%</strong></h4>
    <div class="happiness-factor-list">${rows}</div>
    <div class="happiness-total"><span>Weighted contributions</span><i>→</i><b>${finalScore.toFixed(0)} / 100</b></div>
    ${people.length > 1 ? `<small>${considering} of ${people.length} residents are considering departure or moving out.</small>` : ""}
  </section>`;
}

function renderAffordabilityAccounting(
  building: Readonly<DetailedBuilding>,
  households: readonly DetailedHousehold[],
): string {
  if (households.length === 0) return "";
  const income = sumNumbers(households.map((household) => household.dailyIncome)) / households.length;
  const afterRent = income - building.rentDaily;
  const burden = building.rentDaily / Math.max(25, income);
  const arrears = sumNumbers(households.map((household) => household.rentArrears));
  const debt = sumNumbers(households.map((household) => household.debt));
  const distressed = households.filter((household) =>
    household.financialStatus === "distressed" || household.financialStatus === "crisis"
  ).length;
  return `<section class="affordability-accounting">
    <h4>Housing affordability <strong>${Math.round(burden * 100)}% rent burden</strong></h4>
    <div class="impact-chain">
      <span><small>Average income</small><b>${formatDetailedMoney(income)}/day</b></span><i>−</i>
      <span><small>Rent</small><b>${formatDetailedMoney(building.rentDaily)}/day</b></span><i>→</i>
      <span><small>After rent</small><b>${formatDetailedMoney(afterRent)}/day</b></span>
    </div>
    <div class="cost-breakdown">
      <span>Land value<b>${formatDetailedMoney(building.landValue)}</b></span>
      <span>Households under pressure<b>${distressed} / ${households.length}</b></span>
      <span>Rent arrears<b>${formatDetailedMoney(arrears)}</b></span>
      <span>Other household debt<b>${formatDetailedMoney(debt)}</b></span>
    </div>
    <p>Land value influences rent; rent relative to household income determines financial pressure and relocation demand.</p>
  </section>`;
}

function renderRoadImpacts(traffic: BuildingTrafficAttribution | null): string {
  if (!traffic || traffic.roads.length === 0) {
    return `<p class="road-impact-empty">No vehicle route reaches this building. Start the simulation to collect live road delay.</p>`;
  }
  const maxCost = Math.max(0.01, ...traffic.roads.map((road) => road.attributedCongestionCost));
  return `<div class="road-impact-list">${traffic.roads.slice(0, 6).map((road, index) => {
    const kinds = road.kinds.map(capitalize).join(" · ");
    const share = road.attributedCongestionCost / maxCost * 100;
    return `<button type="button" class="road-impact-row" data-road-focus="${escapeHtml(road.segmentId)}">
      <i data-rank="${Math.min(index + 1, 3)}"></i>
      <span><b>${escapeHtml(road.roadName)}</b><small>${escapeHtml(road.description)} · ${escapeHtml(kinds)}</small></span>
      <meter min="0" max="100" value="${share}"></meter>
      <strong>${formatDetailedMoney(road.attributedCongestionCost)}</strong>
      <em>${road.congestionPercent.toFixed(0)}% congestion · ${road.averageDelaySeconds.toFixed(0)} sec delay</em>
    </button>`;
  }).join("")}</div>`;
}

function renderTrafficInspector(feature: DistrictFeature): void {
  const state = simulation.getState();
  const city = state.city.metrics;
  const road = state.roadTraffic.find((candidate) => candidate.segmentId === feature.id);
  const signal = state.signals.find((candidate) => candidate.intersectionId === feature.id);
  const totalTrips = Math.max(1, city.commuteTripsDaily + city.shoppingTripsDaily + city.freightTripsDaily);
  const causes = [
    ["Work", city.commuteTripsDaily],
    ["Shopping", city.shoppingTripsDaily],
    ["Freight", city.freightTripsDaily],
  ] as const;
  const localStats = road
    ? [
        ["Live congestion", `${road.congestionPercent.toFixed(0)}%`, "congestionPercent"],
        ["Active vehicles", road.activeVehicles.toLocaleString(), "activeVehicles"],
        ["Queued vehicles", road.queuedVehicles.toLocaleString(), "queuedVehicles"],
        ["Average speed", `${road.averageSpeedMph.toFixed(1)} mph`, "averageSpeedMph"],
      ]
    : [
        ["Signal phase", signal ? formatSignalPhase(signal.phase) : "Unsignalized", "signalPhase"],
        ["Network congestion", `${city.congestionPercent.toFixed(0)}%`, "networkCongestion"],
        ["Average delay", `${city.averageTrafficDelayMinutes.toFixed(1)} min`, "networkDelay"],
        ["Daily traffic cost", formatDetailedMoney(city.congestionCostDaily), "networkCost"],
      ];
  const overview = `
    <div class="inspector-stat-grid">${localStats.map(([label, value, key]) => statCell(label, value, "road", key)).join("")}</div>
    <section class="traffic-impact">
      <h4>Citywide consequence</h4>
      <div class="impact-chain">
        ${statCell("Congestion", `${city.congestionPercent.toFixed(0)}%`, "road", "networkCongestion")}<i>→</i>
        ${statCell("Extra travel", `${city.averageTrafficDelayMinutes.toFixed(1)} min/trip`, "road", "networkDelay")}<i>→</i>
        ${statCell("Lost time", `${formatDetailedMoney(city.congestionCostDaily)}/day`, "road", "networkCost")}
      </div>
      <p>Delay reduces access to workers, customers, services, and freight. Those access losses change costs and choices on the next simulated day.</p>
    </section>`;
  const causeContent = `
    <section class="traffic-impact">
      <h4>Trips using the network</h4>
      <div class="traffic-cause-bars">${causes.map(([label, trips]) => {
        const share = trips / totalTrips * 100;
        return `<label data-stat="${label.toLowerCase()}Trips" data-stat-scope="road" tabindex="0"><span>${label}<b data-stat-value>${Math.round(trips).toLocaleString()} trips</b></span><meter min="0" max="100" value="${share}"></meter><small>${share.toFixed(0)}%</small></label>`;
      }).join("")}</div>
      <div class="causal-strip"><span>Trip demand</span><i>→</i><span>Queue delay</span><i>→</i><span>Access loss</span><i>→</i><span>Higher costs</span></div>
    </section>`;
  const actions = `
    <section class="entity-actions-section">
      <h4>Street interventions</h4>
      <p>Each option previews its first-order effect. Run the city afterward to observe second-order changes in destination choice, prices, staffing, and migration.</p>
      <div class="intervention-grid">${renderRoadInterventions(feature)}</div>
      ${renderInterventionFeedback()}
    </section>`;
  entityInspector.innerHTML = `
    <article class="entity-card traffic-card">
      ${renderInspectorBreadcrumb(feature.kind === "street" ? "Streets" : "Intersections", feature.name)}
      <header class="entity-heading">
        <div><small>${feature.kind === "street" ? "Street segment" : "Intersection"}</small><h3>${escapeHtml(feature.name)}</h3></div>
        <span>${road ? `${road.congestionPercent.toFixed(0)}% busy` : "Traffic control"}</span>
      </header>
      <p class="heading-diagnosis">${road
        ? `${road.averageDelaySeconds.toFixed(0)} seconds of average delay raises travel costs and reduces access along this segment.`
        : "Signal timing changes queues, pedestrian wait, and downstream access."}</p>
      ${renderInspectorTabs("Traffic drivers", "Improve road")}
      ${inspectorTab === "overview" ? overview : inspectorTab === "causes" ? causeContent : actions}
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
  const favorite = favoritePersonIds.has(person.id);
  const mobility = person.mobility;
  const originName = buildingById.get(mobility.fromBuildingId)?.name
    ?? outsideLocationName(mobility.fromBuildingId);
  const destinationName = buildingById.get(mobility.destinationBuildingId)?.name
    ?? outsideLocationName(mobility.destinationBuildingId);
  const mobilityOverview = mobility.phase === "inside" || mobility.phase === "outside"
    ? `<section class="accounting-section current-trip-section">
        <h4>Current location</h4>
        <p class="entity-diagnosis"><b>${escapeHtml(destinationName)}</b> · ${formatActivity(mobility.activity)}. This location is the resident's literal simulated position.</p>
      </section>`
    : `<section class="accounting-section current-trip-section">
        <h4>Current trip <strong>${Math.round(mobility.routeProgress * 100)}%</strong></h4>
        <div class="accounting-flow journey-flow">
          <span class="accounting-node income"><small>From</small><b>${escapeHtml(originName)}</b></span><i>→</i>
          <span class="accounting-node cost"><small>${formatMode(mobility.mode)}</small><b>${formatActivity(mobility.activity)}</b></span><i>→</i>
          <span class="accounting-node income"><small>To</small><b>${escapeHtml(destinationName)}</b></span>
        </div>
        <div class="cost-breakdown">
          ${inlineStat("Departed", formatMinute(mobility.departureMinute), "person", "travelMinutes")}
          ${inlineStat("Expected", formatMinute(mobility.expectedArrivalMinute), "person", "travelMinutes")}
          ${inlineStat("Route delay", `${mobility.delayMinutes.toFixed(1)} min`, "person", "networkDelay")}
          ${inlineStat("Simulation detail", formatMobilityDetail(state.mobilityDetailMode), "person", "travelMinutes")}
        </div>
      </section>`;
  const overview = `
    ${mobilityOverview}
    <section class="schedule-section">
      <h4>Daily route</h4>
      <div class="schedule-timeline">${person.schedule.map((item) => {
        const destination = buildingById.get(item.buildingId);
        const buildingName = destination?.name ?? "Outside University City";
        const price = destination && ["shop", "leisure"].includes(item.activity) && destination.accounting.unitPrice > 0
          ? ` · ${formatDetailedMoney(destination.accounting.unitPrice)}`
          : "";
        return `<div><time>${formatMinute(item.startMinute)}</time><span data-activity="${item.activity}"></span><p><b>${formatActivity(item.activity)}</b><small>${escapeHtml(buildingName)} · ${formatMode(item.mode)} · ${item.travelMinutes} min${price}</small></p></div>`;
      }).join("")}</div>
    </section>`;
  const causes = `
    <section class="accounting-section">
      <h4>Daily finances</h4>
      <div class="accounting-flow">
        ${accountingNode("Wage", person.dailyWage, maxFlow, "income", "dailyWage", "person")}<i>→</i>
        ${accountingNode("Spending", person.dailySpending, maxFlow, "cost", "dailySpending", "person")}<i>→</i>
        ${accountingNode("Net", net, maxFlow, net >= 0 ? "income" : "loss", "netIncome", "person")}
      </div>
      <div class="cost-breakdown">
        ${inlineStat("Commute", formatDetailedMoney(person.commuteCost), "person", "commuteCost")}
        ${inlineStat("Network delay", `${state.city.metrics.averageTrafficDelayMinutes.toFixed(1)} min`, "person", "networkDelay")}
        ${inlineStat("Cash", formatDetailedMoney(person.money), "person", "money")}
        ${inlineStat("Shared balance", formatDetailedMoney(household?.money ?? 0), "household", "money")}
        ${inlineStat("Debt", formatDetailedMoney(household?.debt ?? 0), "household", "debt")}
        ${inlineStat("Rent arrears", formatDetailedMoney(household?.rentArrears ?? 0), "household", "rentArrears")}
        ${inlineStat("Safety-net aid", formatDetailedMoney(household?.assistanceReceived ?? 0), "household", "assistanceReceived")}
        ${inlineStat("Status", capitalize(household?.financialStatus ?? "stable"), "household", "financialStatus")}
      </div>
    </section>
    ${renderHappinessAccounting([person], "Happiness accounting")}
    <section class="needs-section">
      <h4>Needs and happiness <strong data-stat="happiness" data-stat-scope="person" data-stat-value tabindex="0">${person.happiness.toFixed(0)}%</strong></h4>
      ${Object.entries(person.needs).map(([need, value]) => `<label data-stat="${need}Need" data-stat-scope="person" tabindex="0"><span>${capitalize(need)}</span><meter min="0" max="100" value="${value}"></meter><b data-stat-value>${value.toFixed(0)}</b></label>`).join("")}
    </section>
    <section class="household-section">
      <h4>Household</h4>
      <p><b>${escapeHtml(buildingById.get(household?.homeBuildingId ?? "")?.name ?? "Unknown residence")}</b> · ${householdMembers.map(escapeHtml).join(", ")}</p>
      <p class="entity-diagnosis"><b>${household && household.lastMovedDay >= 0 ? `Moved on day ${household.lastMovedDay}:` : "Initial residence:"}</b> ${escapeHtml(household?.moveReason ?? "No household move has been recorded.")}</p>
    </section>
    <p class="migration-callout" data-migration="${person.migrationStatus}"><b>${formatMigration(person.migrationStatus)}</b>${escapeHtml(person.migrationReason)}</p>`;
  const actions = `
    <section class="entity-actions-section">
      <h4>Follow this resident</h4>
      <div class="person-location-actions">
        <button type="button" data-focus-building="${escapeHtml(person.homeBuildingId)}">Home</button>
        ${person.workBuildingId ? `<button type="button" data-focus-building="${escapeHtml(person.workBuildingId)}">Work</button>` : ""}
        ${person.schoolBuildingId ? `<button type="button" data-focus-building="${escapeHtml(person.schoolBuildingId)}">School</button>` : ""}
      </div>
      <p>The route and destination choices respond to wages, prices, service quality, accessibility, household finances, and changing needs.</p>
    </section>`;
  entityInspector.innerHTML = `
    <article class="entity-card person-card">
      ${renderInspectorBreadcrumb("Residents", person.name)}
      <header class="entity-heading">
        <div><small>${person.age} years old · ${formatEmployment(person.employment)}</small><h3>${escapeHtml(person.name)}</h3></div>
        <div class="entity-heading-actions">
          <button type="button" class="favorite-person-button" data-favorite-person="${escapeHtml(person.id)}" aria-pressed="${favorite}" aria-label="${favorite ? "Remove from" : "Add to"} favourite people" title="${favorite ? "Remove from" : "Add to"} favourite people">${favorite ? "&#9733;" : "&#9734;"}</button>
          <span data-migration="${person.migrationStatus}">${formatMobilityStatus(person)}</span>
        </div>
      </header>
      <p class="heading-diagnosis">${escapeHtml(person.migrationReason)}</p>
      ${renderInspectorTabs("Wellbeing", "Follow")}
      ${inspectorTab === "overview" ? overview : inspectorTab === "causes" ? causes : actions}
    </article>`;
}

function renderFavoritePeople(): void {
  const state = simulation.getState();
  const favorites = state.entities.people.filter((person) => favoritePersonIds.has(person.id));
  trackedPeople.hidden = favorites.length === 0;
  trackedPeopleCount.textContent = String(favorites.length);
  if (favorites.length === 0) {
    trackedPeopleList.replaceChildren();
    return;
  }
  const buildingById = new Map(
    state.entities.buildings.map((building) => [building.id, building.name]),
  );
  trackedPeopleList.innerHTML = favorites.map((person) => {
    const location = person.mobility.phase === "inside"
      ? buildingById.get(person.currentBuildingId) ?? "Outside the district"
      : `${formatMode(person.mobility.mode)} to ${buildingById.get(person.mobility.destinationBuildingId) ?? outsideLocationName(person.mobility.destinationBuildingId)}`;
    return `<button type="button" data-tracked-person="${escapeHtml(person.id)}" aria-label="Find ${escapeHtml(person.name)} on the map">
      <span class="tracked-person-marker" aria-hidden="true"><i></i></span>
      <span><b>${escapeHtml(person.name)}</b><small>${formatActivity(person.currentActivity)} · ${escapeHtml(location)}</small></span>
      <strong>${Math.round(person.happiness)}%</strong>
    </button>`;
  }).join("");
}

function toggleFavoritePerson(personId: string): void {
  if (favoritePersonIds.has(personId)) favoritePersonIds.delete(personId);
  else favoritePersonIds.add(personId);
  renderer.setFavoritePeople([...favoritePersonIds]);
  entityInterfaceSignature = "";
  updateEntityInterface();
}

function focusTrackedPerson(personId: string): void {
  const state = simulation.getState();
  const person = state.entities.people.find((candidate) => candidate.id === personId);
  if (!person) return;
  if (appMode !== "simulate") setAppMode("simulate");
  if (cameraMode !== "orbit") setCameraMode("orbit");
  showAffectedRoads = false;
  selectedTrafficFeature = null;
  selectedFeature = undefined;
  selectedEntity = { kind: "person", id: person.id };
  renderer.setSelectedFeature(null);
  renderer.setSelectedEntity(selectedEntity);
  syncEntitySelectionState();
  if (!renderer.focusPerson(person.id)) {
    const currentBuilding = state.entities.buildings.find(
      (building) => building.id === person.currentBuildingId,
    );
    if (currentBuilding) renderer.focusBuilding(currentBuilding);
  }
  entityInterfaceSignature = "";
  updateEntityInterface();
}

function focusInspectorBuilding(buildingId: string): void {
  const building = simulation.getState().entities.buildings.find(
    (candidate) => candidate.id === buildingId,
  );
  if (!building) return;
  showAffectedRoads = false;
  selectedTrafficFeature = null;
  selectedFeature = undefined;
  selectedEntity = { kind: "building", id: building.id };
  inspectorTab = "overview";
  renderer.setSelectedFeature(null);
  renderer.setSelectedEntity(selectedEntity);
  renderer.focusBuilding(building);
  syncEntitySelectionState();
  entityInterfaceSignature = "";
  updateEntityInterface();
}

function toggleComparedBuilding(buildingId: string): void {
  const index = comparedBuildingIds.indexOf(buildingId);
  if (index >= 0) comparedBuildingIds.splice(index, 1);
  else {
    if (comparedBuildingIds.length === 2) comparedBuildingIds.shift();
    comparedBuildingIds.push(buildingId);
  }
  entityInterfaceSignature = "";
  updateEntityInterface();
}

function renderBuildingComparison(): void {
  const state = simulation.getState();
  const buildings = comparedBuildingIds
    .map((id) => state.entities.buildings.find((building) => building.id === id))
    .filter((building): building is DetailedBuilding => Boolean(building));
  comparedBuildingIds.splice(0, comparedBuildingIds.length, ...buildings.map((building) => building.id));
  buildingComparison.hidden = buildings.length === 0;
  if (buildings.length === 0) {
    buildingComparison.replaceChildren();
    return;
  }
  const columns = buildings.map((building) => `<button type="button" data-comparison-focus="${escapeHtml(building.id)}">${escapeHtml(building.name)}</button>`).join("");
  const metric = (label: string, values: string[]) => `<div class="comparison-row"><span>${label}</span>${values.map((value) => `<b>${value}</b>`).join("")}</div>`;
  buildingComparison.innerHTML = `
    <header><strong>Building comparison</strong><span>${buildings.length} / 2</span><button type="button" data-comparison-clear aria-label="Clear comparison" title="Clear comparison">×</button></header>
    <div class="comparison-grid" data-columns="${buildings.length}">
      <div class="comparison-head"><span></span>${columns}</div>
      ${metric("Net / day", buildings.map((building) => formatDetailedMoney(building.accounting.profit)))}
      ${metric("Staffing", buildings.map((building) => `${building.employeeIds.length}/${building.accounting.requiredWorkers}`))}
      ${metric("Transport", buildings.map((building) => formatDetailedMoney(building.accounting.transportCost)))}
      ${metric("Imported", buildings.map((building) => `${building.accounting.importedSupplies.toFixed(0)} units`))}
    </div>`;
}

function renderBuildingTrend(building: Readonly<DetailedBuilding>, stat: string): string {
  const points = building.history.slice(-7);
  if (points.length < 2 || stat === "residents") return "";
  const accessors: Partial<Record<string, (point: BuildingHistoryPoint) => number>> = {
    rentMonthly: (point) => point.rentDaily * 30.4,
    landValue: (point) => point.landValue,
    connectedTrips: (point) => point.workLegs + point.visitLegs,
    employees: (point) => point.employees,
    serviceDelivered: (point) => point.serviceDelivered,
    serviceQuality: (point) => point.serviceQuality * 100,
    municipalFunding: (point) => point.municipalFunding,
    customers: (point) => point.customers,
    goodsProduced: (point) => point.goodsProduced,
    goodsSold: (point) => point.goodsSold,
    goodsInventory: (point) => point.goodsInventory,
    salesRevenue: (point) => point.salesRevenue,
    unitPrice: (point) => point.unitPrice,
    averageWage: (point) => point.averageWage,
  };
  const accessor = accessors[stat];
  if (!accessor) return "";
  const values = points.map(accessor);
  const minimum = Math.min(...values);
  const range = Math.max(0.01, Math.max(...values) - minimum);
  const change = values.at(-1)! - values[0]!;
  const moneyStats = new Set(["rentMonthly", "landValue", "municipalFunding", "unitPrice", "averageWage"]);
  const changeLabel = moneyStats.has(stat)
    ? formatSignedMoney(change)
    : stat === "serviceQuality"
      ? `${formatSigned(change)} pts`
      : formatSigned(change);
  return `<span class="inline-trend" data-trend="${change > 0 ? "up" : change < 0 ? "down" : "flat"}">
    <i aria-hidden="true">${values.map((value) => `<em style="height:${22 + (value - minimum) / range * 78}%"></em>`).join("")}</i>
    <small>${escapeHtml(changeLabel)} · 7d</small>
  </span>`;
}

function renderBuildingBenchmark(
  building: Readonly<DetailedBuilding>,
  allBuildings: readonly DetailedBuilding[],
): string {
  const peers = allBuildings.filter((candidate) => candidate.function === building.function);
  const civic = isCivicFunction(building.function);
  const housing = building.function === "housing";
  const current = housing
    ? building.rentDaily * 30.4
    : civic
      ? building.accounting.serviceQuality * 100
      : building.accounting.operatingRevenue > 0
        ? building.accounting.profit / building.accounting.operatingRevenue * 100
        : 0;
  const peerValues = peers.map((peer) => housing
    ? peer.rentDaily * 30.4
    : civic
      ? peer.accounting.serviceQuality * 100
      : peer.accounting.operatingRevenue > 0
        ? peer.accounting.profit / peer.accounting.operatingRevenue * 100
        : 0);
  const peerAverage = sumNumbers(peerValues) / Math.max(1, peerValues.length);
  const old = building.history.at(-7);
  const prior = old
    ? housing
      ? old.rentDaily * 30.4
      : civic
        ? old.serviceQuality * 100
        : old.operatingRevenue > 0 ? old.profit / old.operatingRevenue * 100 : 0
    : current;
  const formatter = housing ? formatDetailedMoney : (value: number) => `${value.toFixed(1)}%`;
  return `<div class="building-benchmark" aria-label="Current, previous week, and similar building comparison">
    <span><small>Current</small><b>${formatter(current)}</b></span>
    <span><small>7 days ago</small><b>${formatter(prior)}</b></span>
    <span><small>Similar buildings</small><b>${formatter(peerAverage)}</b></span>
  </div>`;
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

function renderInspectorTabs(causeLabel: string, actionLabel = "Actions"): string {
  const labels = {
    overview: "Overview",
    causes: causeLabel,
    actions: actionLabel,
  } as const;
  return `<nav class="inspector-tabs" aria-label="Inspector views">
    ${(["overview", "causes", "actions"] as const).map((tab) => `<button type="button" data-inspector-tab="${tab}" aria-pressed="${inspectorTab === tab}">${labels[tab]}</button>`).join("")}
  </nav>`;
}

function renderInspectorBreadcrumb(category: string, name: string): string {
  return `<nav class="inspector-breadcrumb" aria-label="Inspector location">
    <button type="button" data-inspector-overview>City overview</button><i aria-hidden="true">›</i>
    <span>${escapeHtml(category)}</span><i aria-hidden="true">›</i><b>${escapeHtml(name)}</b>
  </nav>`;
}

function buildingCauseTabLabel(buildingFunction: DetailedBuilding["function"]): string {
  if (buildingFunction === "housing") return "Housing drivers";
  if (isCivicFunction(buildingFunction)) return "Service drivers";
  return "Profit drivers";
}

function buildingActionTabLabel(buildingFunction: DetailedBuilding["function"]): string {
  if (buildingFunction === "housing") return "Housing options";
  if (isCivicFunction(buildingFunction)) return "Improve service";
  return "Improve business";
}

function renderAccessibilityBreakdown(building: Readonly<DetailedBuilding>): string {
  const access = building.accessibility;
  const scores = [
    ["Workers", access.workers],
    ["Customers", access.customers],
    ["Freight", access.freight],
    ["Services", access.services],
  ] as const;
  return `<div class="accessibility-breakdown">
    <div class="accessibility-score"><strong>${Math.round(access.overall)}</strong><span>Overall access</span><small>${access.averageTravelMinutes.toFixed(1)} min route delay</small></div>
    <div>${scores.map(([label, score]) => `<label><span>${label}<b>${Math.round(score)}</b></span><meter min="0" max="100" value="${score}"></meter></label>`).join("")}</div>
    <p>Congestion penalty ${access.congestionPenalty.toFixed(1)} · Transit benefit +${access.transitBonus.toFixed(1)}</p>
  </div>`;
}

function renderFlowControls(): string {
  const labels: Record<BuildingConnectionKind, readonly [string, string]> = {
    work: ["Work", "Home → workplace"],
    visit: ["Visits", "Person → destination"],
    delivery: ["Freight", "Supplier → receiver"],
  };
  return `<fieldset class="flow-controls inspector-flow-controls">
    <legend>Moving flows</legend>
    ${(["work", "visit", "delivery"] as const).map((kind) => `<label data-flow="${kind}"><input type="checkbox" data-flow-kind="${kind}" ${visibleFlowKinds.has(kind) ? "checked" : ""} /><span><b>${labels[kind][0]}</b><small>${labels[kind][1]}</small></span></label>`).join("")}
  </fieldset>`;
}

function renderRoadInterventions(feature: DistrictFeature): string {
  const tools: readonly BuildTool[] = feature.kind === "street"
    ? ["add-lane", "remove-lane", "bike-lane", "sidewalk", "direction"]
    : ["crosswalk", "island"];
  const previews: Record<BuildTool, string> = {
    "add-lane": "More vehicle capacity; possible crossing and walking penalty.",
    "remove-lane": "Less vehicle capacity; space can support safer non-car access.",
    "bike-lane": "Safer cycling and fewer short car trips.",
    sidewalk: "More pedestrian capacity and stronger nearby customer access.",
    crosswalk: "Shorter crossing waits and better service access.",
    island: "Lower crossing exposure with a small vehicle-capacity tradeoff.",
    direction: "Reroutes traffic and changes which buildings are easiest to reach.",
  };
  return tools.map((tool) => `<button type="button" data-inspector-build-tool="${tool}"><span>${formatTool(tool)}</span><small>${previews[tool]}</small></button>`).join("");
}

function interventionPreview(tool: BuildTool): string {
  const forecasts: Record<BuildTool, string> = {
    "add-lane": "Forecast: local queues may fall, improving freight and worker access after routes update.",
    "remove-lane": "Forecast: vehicle delay may rise, while walking safety and non-car access improve.",
    "bike-lane": "Forecast: some short trips shift away from cars and potential conflicts decline.",
    sidewalk: "Forecast: pedestrian throughput and nearby customer reach improve.",
    crosswalk: "Forecast: pedestrian waiting and service-access barriers decline.",
    island: "Forecast: crossing conflicts decline with a small turning-capacity cost.",
    direction: "Forecast: traffic redistributes; inspect affected routes after the next simulation day.",
  };
  return forecasts[tool];
}

function captureInterventionBaseline(): void {
  const state = simulation.getState();
  interventionBaseline = {
    day: state.entities.lastUpdatedDay,
    congestion: state.city.metrics.congestionPercent,
    trafficCost: state.city.metrics.congestionCostDaily,
    businessProfit: state.city.metrics.businessProfitDaily,
  };
}

function renderInterventionFeedback(): string {
  if (!interventionFeedback) return "";
  const state = simulation.getState();
  if (!interventionBaseline || state.entities.lastUpdatedDay <= interventionBaseline.day) {
    return `<p class="intervention-feedback">${escapeHtml(interventionFeedback)} Resume Live to measure the result.</p>`;
  }
  const congestionChange = state.city.metrics.congestionPercent - interventionBaseline.congestion;
  const trafficCostChange = state.city.metrics.congestionCostDaily - interventionBaseline.trafficCost;
  const profitChange = state.city.metrics.businessProfitDaily - interventionBaseline.businessProfit;
  return `<div class="intervention-result">
    <strong>Measured since day ${interventionBaseline.day}</strong>
    <span>Congestion <b>${formatSigned(congestionChange)} pts</b></span>
    <span>Traffic cost <b>${formatSignedMoney(trafficCostChange)}</b></span>
    <span>Business profit <b>${formatSignedMoney(profitChange)}</b></span>
  </div>`;
}

function renderMapLegend(mode: MapOverlayMode): void {
  const legends: Partial<Record<MapOverlayMode, readonly [string, string]>> = {
    congestion: ["Free flowing", "Severe delay"],
    profitability: ["Operating loss", "Strong surplus"],
    affordability: ["Severe pressure", "Affordable"],
    employment: ["Understaffed", "Fully staffed"],
    wellbeing: ["Low or leaving", "Happy and staying"],
    goods: ["Shortage", "Well stocked"],
  };
  const labels = legends[mode];
  mapLegend.innerHTML = labels
    ? `<span>${labels[0]}</span><i data-overlay="${mode}" aria-hidden="true"></i><span>${labels[1]}</span>`
    : mode === "none"
      ? "<span>Building rings show assigned functions.</span>"
      : `<span>${capitalize(mode.replace("-", " "))} is drawn on streets and intersections.</span>`;
}

function renderNotificationCenter(): void {
  const state = simulation.getState();
  const openCategories = new Set(
    [...notificationList.querySelectorAll<HTMLDetailsElement>("details[open][data-issue-category]")]
      .map((details) => details.dataset.issueCategory),
  );
  currentBuildingIssues = deriveBuildingIssues(state.entities, state.city);
  const criticalCount = currentBuildingIssues.filter((issue) => issue.severity === "critical").length;
  const warningCount = currentBuildingIssues.length - criticalCount;
  notificationCount.textContent = criticalCount > 99 ? "99+" : String(criticalCount);
  notificationCount.hidden = criticalCount === 0;
  notificationButton.setAttribute(
    "aria-label",
    criticalCount > 0
      ? `Open city issues, ${criticalCount} critical`
      : warningCount > 0
        ? `Open city issues, ${warningCount} warnings`
        : "Open city issues, no current issues",
  );
  notificationButton.dataset.state = criticalCount > 0
    ? "critical"
    : currentBuildingIssues.length > 0
      ? "warning"
      : "clear";
  notificationSummary.textContent = currentBuildingIssues.length === 0
    ? "No current building-level issues require attention."
    : `${criticalCount} critical and ${warningCount} warning conditions across ${new Set(currentBuildingIssues.map((issue) => issue.buildingId)).size} buildings.`;
  if (currentBuildingIssues.length === 0) {
    notificationList.innerHTML = `<p class="notification-empty">The city is operating within the current alert thresholds.</p>`;
    return;
  }
  const groups = new Map<BuildingIssueCategory, BuildingIssue[]>();
  for (const issue of currentBuildingIssues) {
    const group = groups.get(issue.category) ?? [];
    group.push(issue);
    groups.set(issue.category, group);
  }
  notificationList.innerHTML = [...groups.entries()].map(([category, issues]) => `
    <details class="notification-group" data-issue-category="${category}" ${openCategories.has(category) ? "open" : ""}>
      <summary><span data-issue-category="${category}"></span>${issueCategoryLabel(category)}<b>${issues.length}</b></summary>
      <div>${issues.map((issue) => `
        <button
          type="button"
          class="notification-item"
          data-severity="${issue.severity}"
          data-issue-building="${escapeHtml(issue.buildingId)}"
          data-issue-category="${issue.category}"
        >
          <i aria-hidden="true"></i>
          <span><b>${escapeHtml(issue.buildingName)}</b><small>${escapeHtml(issue.title)} · ${escapeHtml(issue.detail)}</small></span>
          <strong>${escapeHtml(issueValue(issue))}</strong>
        </button>`).join("")}</div>
    </details>`).join("");
}

function setNotificationOpen(open: boolean): void {
  notificationPanel.hidden = !open;
  notificationButton.setAttribute("aria-expanded", String(open));
  notificationButton.dataset.open = String(open);
}

function focusIssueBuilding(
  buildingId: string,
  category: BuildingIssueCategory,
): void {
  const building = simulation.getState().entities.buildings.find(
    (candidate) => candidate.id === buildingId,
  );
  if (!building) return;
  if (appMode !== "simulate") setAppMode("simulate");
  setCameraMode("orbit");
  const overlayByCategory: Record<BuildingIssueCategory, MapOverlayMode> = {
    traffic: "congestion",
    profitability: "profitability",
    happiness: "wellbeing",
    migration: "wellbeing",
    staffing: "employment",
  };
  analysisOverlay.value = overlayByCategory[category];
  renderer.setMapOverlay(analysisOverlay.value as MapOverlayMode);
  showAffectedRoads = false;
  selectedTrafficFeature = null;
  selectedFeature = undefined;
  selectedEntity = { kind: "building", id: building.id };
  renderer.setSelectedFeature(null);
  renderer.setSelectedEntity(selectedEntity);
  renderer.focusBuilding(building);
  syncEntitySelectionState();
  entityInterfaceSignature = "";
  setNotificationOpen(false);
  updateInterface();
}

function issueCategoryLabel(category: BuildingIssueCategory): string {
  const labels: Record<BuildingIssueCategory, string> = {
    traffic: "Transport and traffic",
    profitability: "Business losses",
    happiness: "Low happiness",
    migration: "Migration pressure",
    staffing: "Staff shortages",
  };
  return labels[category];
}

function issueValue(issue: Readonly<BuildingIssue>): string {
  if (issue.category === "traffic") return `${formatDetailedMoney(issue.value)}/day`;
  if (issue.category === "profitability") return `-${formatDetailedMoney(issue.value)}/day`;
  if (issue.category === "happiness") return `${(100 - issue.value).toFixed(0)}%`;
  if (issue.category === "staffing") return `${Math.round(issue.value)} vacant`;
  return "Departure risk";
}

function updateEntityTooltip(
  selection: SceneHoverSelection | null,
  clientX: number,
  clientY: number,
): void {
  if (!selection) {
    entityTooltip.hidden = true;
    return;
  }
  const state = simulation.getState();
  const mode = analysisOverlay.value as MapOverlayMode;
  if (selection.kind === "road") {
    const feature = features.find((candidate) => candidate.id === selection.id);
    if (!feature) return;
    entityTooltip.innerHTML = roadTooltip(feature);
  } else if (selection.kind === "person") {
    const person = state.entities.people.find((candidate) => candidate.id === selection.id);
    if (!person) return;
    const destination = state.entities.buildings.find(
      (building) => building.id === person.mobility.destinationBuildingId,
    )?.name ?? outsideLocationName(person.mobility.destinationBuildingId);
    entityTooltip.innerHTML = `<strong>${escapeHtml(person.name)}</strong><span>${formatMobilityStatus(person)} · ${person.happiness.toFixed(0)}% happiness</span><small>${person.mobility.phase === "inside"
      ? escapeHtml(destination)
      : `${Math.round(person.mobility.routeProgress * 100)}% to ${escapeHtml(destination)} · ${person.mobility.delayMinutes.toFixed(1)} min delay`
    }</small>`;
  } else {
    const building = state.entities.buildings.find((candidate) => candidate.id === selection.id);
    if (!building) return;
    entityTooltip.innerHTML = buildingTooltip(building, mode);
  }
  entityTooltip.hidden = false;
  const bounds = entityTooltip.getBoundingClientRect();
  entityTooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - bounds.width - 8, clientX + 14))}px`;
  entityTooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - bounds.height - 8, clientY + 14))}px`;
}

function roadTooltip(feature: DistrictFeature): string {
  const state = simulation.getState();
  const road = state.roadTraffic.find((candidate) => candidate.segmentId === feature.id);
  const signal = state.signals.find((candidate) => candidate.intersectionId === feature.id);
  const selectedTraffic = selectedEntity?.kind === "building"
    ? simulation.getBuildingTrafficAttribution(selectedEntity.id)
    : null;
  const buildingImpact = selectedTraffic?.roads.find((impact) => impact.segmentId === feature.id);
  if (!road) {
    const signalValue = signal
      ? `${formatSignalPhase(signal.phase)} · ${signal.timeRemainingSeconds?.toFixed(0) ?? "manual"} sec remaining`
      : "No signal controller";
    return `<strong>${escapeHtml(feature.name)}</strong><span>${escapeHtml(signalValue)}</span><small>${escapeHtml(feature.description)}</small>`;
  }
  const value = `${road.congestionPercent.toFixed(0)}% congestion · ${road.averageSpeedMph.toFixed(1)} mph · ${road.queuedVehicles} queued`;
  const cause = buildingImpact
    ? `${Math.round(buildingImpact.roadTripsDaily)} of the selected building's daily vehicle passages use this segment. Its queues and ${buildingImpact.averageDelaySeconds.toFixed(0)} seconds of measured delay account for ${formatDetailedMoney(buildingImpact.attributedCongestionCost)} of that building's congestion surcharge.`
    : selectedTraffic
      ? `${road.activeVehicles} vehicles are currently present with ${road.averageDelaySeconds.toFixed(0)} seconds of measured delay. The selected building has no modeled vehicle route on this segment.`
      : `${road.activeVehicles} vehicles are currently present. Measured delay is ${road.averageDelaySeconds.toFixed(0)} seconds; click a building to see whether its work trips, visits, or deliveries use this road.`;
  return `<strong>${escapeHtml(feature.name)}</strong><span>${escapeHtml(value)}</span><small>${escapeHtml(feature.description)}</small><div class="tooltip-transport">${escapeHtml(cause)}</div>`;
}

function buildingTooltip(building: DetailedBuilding, mode: MapOverlayMode): string {
  const accounting = building.accounting;
  const state = simulation.getState();
  const residents = state.entities.people.filter((person) => person.homeBuildingId === building.id);
  const households = state.entities.households.filter((household) => household.homeBuildingId === building.id);
  const trips = state.entities.connections
    .filter((connection) => connection.fromBuildingId === building.id || connection.toBuildingId === building.id);
  const traffic = simulation.getBuildingTrafficAttribution(building.id);
  let value = `${formatBuildingFunction(building.function)} · ${formatEntityStatus(accounting.status)}`;
  let why = accounting.diagnosis;
  if (mode === "none" && building.function === "housing" && residents.length > 0 && households.length > 0) {
    const happiness = sumNumbers(residents.map((person) => person.happiness)) / residents.length;
    const averageIncome = sumNumbers(households.map((household) => household.dailyIncome)) / households.length;
    const rentBurden = building.rentDaily / Math.max(25, averageIncome);
    value = `${happiness.toFixed(0)}% resident happiness · ${Math.round(rentBurden * 100)}% rent burden`;
    why = `Needs ${averageHappinessComponent(residents, "needs").toFixed(0)}, finances ${averageHappinessComponent(residents, "financialSecurity").toFixed(0)}, employment ${averageHappinessComponent(residents, "employment").toFixed(0)}, housing ${averageHappinessComponent(residents, "housing").toFixed(0)}, and travel ${averageHappinessComponent(residents, "travel").toFixed(0)} determine wellbeing. Rent is ${formatDetailedMoney(building.rentDaily)} per day.`;
  } else if (mode === "profitability") value = `${formatDetailedMoney(accounting.operatingRevenue)} revenue − ${formatDetailedMoney(accounting.operatingCost)} costs = ${formatDetailedMoney(accounting.profit)}`;
  else if (mode === "affordability") {
    if (building.function === "housing" && households.length > 0) {
      const averageIncome = sumNumbers(households.map((household) => household.dailyIncome)) / households.length;
      const rentBurden = building.rentDaily / Math.max(25, averageIncome);
      const arrears = sumNumbers(households.map((household) => household.rentArrears));
      const debt = sumNumbers(households.map((household) => household.debt));
      const distressed = households.filter((household) =>
        household.financialStatus === "distressed" || household.financialStatus === "crisis"
      ).length;
      value = `${Math.round(rentBurden * 100)}% average rent burden · ${distressed} of ${households.length} households distressed`;
      why = `${formatDetailedMoney(building.rentDaily)} daily rent is set partly by ${formatDetailedMoney(building.landValue)} land value. Household arrears total ${formatDetailedMoney(arrears)} and other debt totals ${formatDetailedMoney(debt)}.`;
    } else {
      value = "Affordability applies to residences";
      why = "Land value still affects this location internally, but housing affordability is measured where households pay rent.";
    }
  } else if (mode === "employment") value = `${building.employeeIds.length} of ${accounting.requiredWorkers} required positions filled`;
  else if (mode === "wellbeing") {
    const happiness = residents.length > 0 ? sumNumbers(residents.map((person) => person.happiness)) / residents.length : accounting.serviceQuality * 100;
    const leaving = residents.filter((person) => person.migrationStatus !== "staying").length;
    value = residents.length > 0
      ? `${happiness.toFixed(0)}% happiness · ${leaving} of ${residents.length} considering departure`
      : `${happiness.toFixed(0)}% service quality`;
    why = residents.length > 0
      ? `Needs ${averageHappinessComponent(residents, "needs").toFixed(0)}, finances ${averageHappinessComponent(residents, "financialSecurity").toFixed(0)}, employment ${averageHappinessComponent(residents, "employment").toFixed(0)}, housing ${averageHappinessComponent(residents, "housing").toFixed(0)}, and travel ${averageHappinessComponent(residents, "travel").toFixed(0)} combine into this score.`
      : accounting.diagnosis;
  } else if (mode === "goods") {
    if (building.function === "industrial") {
      value = `${accounting.goodsProduced.toFixed(0)} finished goods · ${building.goodsInventory.toFixed(0)} raw units in stock`;
      why = `${accounting.goodsReceived.toFixed(0)} raw units arrived today and labor converted them into wholesale output; ${accounting.goodsSold.toFixed(0)} finished units were sold.`;
    } else if (building.function === "retail") {
      value = `${building.goodsInventory.toFixed(0)} consumer goods in stock · ${accounting.goodsSold.toFixed(0)} sold`;
      why = `${accounting.goodsReceived.toFixed(0)} consumer-ready units arrived today, including ${accounting.importedSupplies.toFixed(0)} imported units.`;
    } else if (building.function === "office" || building.function === "parking") {
      value = `${accounting.serviceDelivered.toFixed(0)} service units delivered · ${formatDetailedMoney(accounting.salesRevenue)} revenue`;
      why = `${accounting.activeWorkers} active staff turn demand into billable services; this building does not sell physical consumer goods.`;
    } else {
      value = `${accounting.goodsReceived.toFixed(0)} operating inputs received · ${accounting.serviceDelivered.toFixed(0)} services delivered`;
      why = accounting.diagnosis;
    }
  }
  else if (mode === "congestion") {
    const workLegs = sumNumbers(trips.filter((trip) => trip.kind === "work").map((trip) => trip.volume));
    const visitLegs = sumNumbers(trips.filter((trip) => trip.kind === "visit").map((trip) => trip.volume));
    const deliveryUnits = sumNumbers(trips.filter((trip) => trip.kind === "delivery").map((trip) => trip.volume));
    const vehicleTrips = traffic
      ? traffic.workVehicleTripsDaily + traffic.visitVehicleTripsDaily + traffic.deliveryVehicleTripsDaily
      : 0;
    value = `${Math.round(vehicleTrips)} attributed vehicle trips per day`;
    why = `${Math.round(workLegs)} person work legs, ${Math.round(visitLegs)} person visit legs, and ${Math.round(deliveryUnits)} supply units are converted separately into vehicle trips. Network delay is ${state.city.metrics.averageTrafficDelayMinutes.toFixed(1)} minutes and transport costs this building ${formatDetailedMoney(accounting.transportCost)} daily.`;
  }
  const topRoad = traffic?.roads[0];
  const transport = traffic
    ? `<div class="tooltip-transport"><b>${formatDetailedMoney(traffic.totalTransportCost)} daily transport</b><span>${formatDetailedMoney(traffic.baseTransportCost)} base + ${formatDetailedMoney(traffic.congestionSurcharge)} congestion</span><small>${topRoad ? `${escapeHtml(topRoad.roadName)} is the largest road cause at ${formatDetailedMoney(topRoad.attributedCongestionCost)}.` : "No active vehicle route is measured."}</small></div>`
    : "";
  return `<strong>${escapeHtml(building.name)}</strong><span>${escapeHtml(value)}</span><small>${escapeHtml(why)}</small>${transport}`;
}

function recordLiveStatHistory(): void {
  const state = simulation.getState();
  const slot = Math.floor(state.elapsedSeconds / 2);
  if (slot === lastLiveHistorySlot) return;
  if (slot < lastLiveHistorySlot) liveStatHistory.clear();
  lastLiveHistorySlot = slot;
  const metrics = state.metrics;
  const values: Record<string, number> = {
    vehicleTravelSeconds: metrics.vehicleTravelSeconds,
    averageSpeedMph: metrics.averageSpeedMph,
    congestionPercent: state.city.metrics.congestionPercent,
    intersectionDelaySeconds: metrics.intersectionDelaySeconds,
    pedestrianWaitSeconds: metrics.pedestrianWaitSeconds,
    potentialConflicts: metrics.potentialConflicts,
    throughputPerHour: metrics.throughputPerHour,
    activeVehicles: metrics.activeVehicles,
    activePedestrians: metrics.activePedestrians,
    crossingsCompleted: metrics.crossingsCompleted,
  };
  for (const [key, value] of Object.entries(values)) {
    appendLiveHistory(`live:${key}`, state.cityActivity.clockLabel, value);
  }
  const road = state.roadTraffic.find((candidate) => candidate.segmentId === selectedTrafficFeature?.id);
  if (road) {
    appendLiveHistory(`road:${road.segmentId}:congestionPercent`, state.cityActivity.clockLabel, road.congestionPercent);
    appendLiveHistory(`road:${road.segmentId}:activeVehicles`, state.cityActivity.clockLabel, road.activeVehicles);
    appendLiveHistory(`road:${road.segmentId}:queuedVehicles`, state.cityActivity.clockLabel, road.queuedVehicles);
    appendLiveHistory(`road:${road.segmentId}:averageSpeedMph`, state.cityActivity.clockLabel, road.averageSpeedMph);
  }
}

function appendLiveHistory(key: string, label: string, value: number): void {
  const history = liveStatHistory.get(key) ?? [];
  liveStatHistory.set(key, [...history, { label, value }].slice(-24));
}

function resolveStatInsight(target: HTMLElement): StatInsight | null {
  const scope = target.dataset.statScope;
  const stat = target.dataset.stat;
  if (!scope || !stat) return null;
  const valueElement = target.matches("[data-stat-value]")
    ? target
    : target.querySelector<HTMLElement>("[data-stat-value]");
  const current = valueElement?.textContent?.trim() ?? target.textContent?.trim() ?? "";
  if (scope === "city") return cityStatInsight(stat, current);
  if (scope === "live") return liveStatInsight(stat, current);
  if (scope === "building") return buildingStatInsight(stat, current);
  if (scope === "person") return personStatInsight(stat, current);
  if (scope === "household") return householdStatInsight(stat, current);
  if (scope === "road") return roadStatInsight(stat, current);
  if (scope === "model") return modelStatInsight(stat, current);
  return null;
}

function modelStatInsight(stat: string, current: string): StatInsight {
  const state = simulation.getState();
  const people = state.entities.people;
  const titles: Record<string, string> = {
    buildings: "Modeled buildings",
    residents: "Visible resident sample",
    localWorkers: "Local workers",
    outsideWorkers: "Outside workers",
  };
  const values: Record<string, number> = {
    buildings: state.entities.buildings.length,
    residents: people.length,
    localWorkers: people.filter((person) => person.employment === "local").length,
    outsideWorkers: people.filter((person) => person.employment === "external").length,
  };
  const factors: Record<string, StatFactor[]> = {
    buildings: [
      factor("Map coverage", "Every rendered building receives a modeled function", true),
      factor("Aggregate city", "Buildings represent activity beyond their visible footprint", true),
    ],
    residents: [
      factor("Sampling", `${Math.round(state.city.metrics.population / Math.max(1, people.length)).toLocaleString()} city residents per visible resident`, true),
      factor("Households", `${state.entities.households.length} detailed households`, true),
    ],
    localWorkers: [
      factor("Local vacancies", `${sumNumbers(state.entities.buildings.map((building) => Math.max(0, building.accounting.requiredWorkers - building.employeeIds.length)))} open positions`, true),
      factor("Job matching", "Residents take available nearby jobs before remaining unemployed", true),
    ],
    outsideWorkers: [
      factor("External jobs", "Regional job markets absorb workers not employed in this section", true),
      factor("Commute cost", `${formatDetailedMoney(sumNumbers(people.filter((person) => person.employment === "external").map((person) => person.commuteCost)))} across sampled outside workers`, state.city.metrics.congestionPercent < 60),
    ],
  };
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: "A detailed sample used to make the larger citywide model inspectable.",
    history: [{ label: `Day ${state.entities.lastUpdatedDay}`, value: values[stat] ?? numericText(current) }],
    historyLabel: "Current model sample",
    factors: factors[stat] ?? [],
  };
}

function cityStatInsight(stat: string, current: string): StatInsight {
  const state = simulation.getState();
  const city = state.city;
  const metrics = city.metrics;
  const points = city.timeline;
  const titles: Record<string, string> = {
    population: "Population",
    output: "Daily economic output",
    unemployment: "Unemployment",
    trafficCost: "Daily traffic cost",
    imports: "Imported goods share",
    migration: "Annualized net migration",
  };
  const descriptions: Record<string, string> = {
    population: "Residents represented by the citywide economic model.",
    output: "Daily wages, business activity, rent, and civic output produced in the section.",
    unemployment: "Share of the labor force that does not currently hold a job.",
    trafficCost: "Value of time and operating expense lost to travel delay each day.",
    imports: "Share of consumed goods supplied by regional or outside-city markets.",
    migration: "Projected yearly population change if current conditions persist.",
  };
  const historyValue = (point: (typeof points)[number]): number => {
    if (stat === "population") return point.population;
    if (stat === "output") return point.grossCityProductDaily;
    if (stat === "unemployment") return point.unemploymentPercent;
    if (stat === "trafficCost") return point.congestionCostDaily;
    if (stat === "imports") return point.goodsImportedDaily / Math.max(1, point.goodsConsumedDaily) * 100;
    return point.annualizedNetMigration;
  };
  const factors: Record<string, StatFactor[]> = {
    population: [
      factor("Migration", `${formatSigned(metrics.annualizedNetMigration)} residents/year at current conditions`, metrics.annualizedNetMigration >= 0),
      factor("Housing", `${metrics.housingOccupancyPercent.toFixed(0)}% of capacity occupied`, metrics.housingOccupancyPercent < 96),
      factor("Wellbeing", `${metrics.happiness.toFixed(0)}% city happiness`, metrics.happiness >= 55),
    ],
    output: [
      factor("Employment", `${Math.round(metrics.employedResidents).toLocaleString()} employed residents`, metrics.unemploymentPercent < 8),
      factor("Business profit", `${formatDetailedMoney(metrics.businessProfitDaily)} per day`, metrics.businessProfitDaily >= 0),
      factor("Goods fulfillment", `${(100 - city.market.importDependencePercent).toFixed(0)}% supplied locally`, city.market.localSupplyPercent >= 50),
    ],
    unemployment: [
      factor("Available jobs", `${Math.round(metrics.jobs).toLocaleString()} jobs for ${Math.round(metrics.population).toLocaleString()} residents`, metrics.jobs >= metrics.employedResidents),
      factor("Filled jobs", `${Math.round(metrics.employedResidents).toLocaleString()} residents employed`, metrics.unemploymentPercent < 8),
      factor("Outside work", `${Math.round(metrics.externalCommutersDaily).toLocaleString()} daily external commuters`, true),
    ],
    trafficCost: [
      factor("Trip volume", `${Math.round(metrics.vehicleTripsDaily).toLocaleString()} vehicle trips/day`, metrics.congestionPercent < 60),
      factor("Delay", `${metrics.averageTrafficDelayMinutes.toFixed(1)} extra minutes per trip`, metrics.averageTrafficDelayMinutes < 8),
      factor("Congestion", `${metrics.congestionPercent.toFixed(0)}% network pressure`, metrics.congestionPercent < 60),
    ],
    imports: [
      factor("Local supply", `${city.market.localSupplyPercent.toFixed(0)}% of demand supplied locally`, city.market.localSupplyPercent >= 50),
      factor("Local demand", `${Math.round(metrics.goodsConsumedDaily).toLocaleString()} units consumed/day`, true),
      factor("Freight access", `${Math.round(metrics.freightTripsDaily).toLocaleString()} freight trips/day`, metrics.congestionPercent < 65),
    ],
    migration: [
      factor("Jobs", `${metrics.unemploymentPercent.toFixed(1)}% unemployment`, metrics.unemploymentPercent < 8),
      factor("Housing", `${metrics.housingOccupancyPercent.toFixed(0)}% occupied`, metrics.housingOccupancyPercent < 95),
      factor("Daily life", `${metrics.happiness.toFixed(0)}% happiness and ${metrics.averageTrafficDelayMinutes.toFixed(1)} min delay`, metrics.happiness >= 55 && metrics.averageTrafficDelayMinutes < 8),
    ],
  };
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: descriptions[stat] ?? "A citywide value produced by the simulation.",
    history: points.map((point) => ({ label: `Day ${point.day}`, value: historyValue(point) })),
    historyLabel: "City history",
    factors: factors[stat] ?? [],
  };
}

function liveStatInsight(stat: string, current: string): StatInsight {
  const state = simulation.getState();
  const settings = simulation.getSettings();
  const activity = state.cityActivity;
  const titles: Record<string, string> = {
    vehicleTravelSeconds: "Average vehicle trip",
    averageSpeedMph: "Average vehicle speed",
    congestionPercent: "Network congestion",
    intersectionDelaySeconds: "Intersection delay",
    pedestrianWaitSeconds: "Pedestrian wait",
    potentialConflicts: "Potential conflicts",
    throughputPerHour: "Network throughput",
    activeVehicles: "Active vehicles",
    activePedestrians: "Active pedestrians",
    crossingsCompleted: "Completed crossings",
  };
  const descriptions: Record<string, string> = {
    vehicleTravelSeconds: "Measured duration of completed live vehicle trips.",
    averageSpeedMph: "Mean speed of vehicles currently moving through the road network.",
    congestionPercent: "Citywide demand pressure relative to modeled road capacity.",
    intersectionDelaySeconds: "Average time vehicles lose at signals and queues.",
    pedestrianWaitSeconds: "Average time pedestrians wait before crossing.",
    potentialConflicts: "Close vehicle-pedestrian interactions detected in the live simulation.",
    throughputPerHour: "People and vehicles the current network is processing each hour.",
    activeVehicles: "Representative vehicle agents currently visible in the street model.",
    activePedestrians: "Representative pedestrian agents currently visible in the street model.",
    crossingsCompleted: "Pedestrian crossings completed since the latest reset.",
  };
  const demandFactors = [
    factor("Work trips", `${activity.commuteSharePercent}% of city trip demand`, activity.commuteSharePercent < 60),
    factor("Shopping trips", `${activity.shoppingSharePercent}% of city trip demand`, true),
    factor("Freight trips", `${activity.freightSharePercent}% of city trip demand`, activity.freightSharePercent < 20),
  ];
  const factors: Record<string, StatFactor[]> = {
    vehicleTravelSeconds: [
      factor("Speed limit", `${settings.speedLimitMph} mph`, settings.speedLimitMph >= 20),
      factor("Signal cycle", `${settings.signalCycleSeconds} seconds`, Math.abs(settings.signalCycleSeconds - 75) < 20),
      factor("Road pressure", `${state.city.metrics.congestionPercent.toFixed(0)}% congestion`, state.city.metrics.congestionPercent < 60),
    ],
    averageSpeedMph: [
      factor("Posted limit", `${settings.speedLimitMph} mph maximum`, settings.speedLimitMph >= 20),
      factor("Queues", `${sumNumbers(state.roadTraffic.map((road) => road.queuedVehicles))} vehicles queued`, sumNumbers(state.roadTraffic.map((road) => road.queuedVehicles)) < 20),
      factor("Road capacity", `${settings.roadCapacity}% of baseline`, settings.roadCapacity >= 100),
    ],
    congestionPercent: demandFactors,
    intersectionDelaySeconds: [
      factor("Signal timing", `${settings.signalCycleSeconds}-second cycle`, Math.abs(settings.signalCycleSeconds - 75) < 20),
      factor("Queued vehicles", `${sumNumbers(state.roadTraffic.map((road) => road.queuedVehicles))} across the district`, sumNumbers(state.roadTraffic.map((road) => road.queuedVehicles)) < 20),
      factor("Crosswalk upgrades", `${[...designs.values()].filter((design) => design.crosswalk).length} installed`, true),
    ],
    pedestrianWaitSeconds: [
      factor("Signal cycle", `${settings.signalCycleSeconds} seconds between phases`, settings.signalCycleSeconds <= 90),
      factor("Crosswalks", `${[...designs.values()].filter((design) => design.crosswalk).length} upgraded`, true),
      factor("Pedestrian demand", `${formatVolume(activity.pedestrianDemandLevel)} current activity`, activity.pedestrianDemandLevel < 3),
    ],
    potentialConflicts: [
      factor("Vehicle activity", `${formatVolume(activity.vehicleDemandLevel)} live demand`, activity.vehicleDemandLevel < 3),
      factor("Pedestrian activity", `${formatVolume(activity.pedestrianDemandLevel)} live demand`, activity.pedestrianDemandLevel < 3),
      factor("Safety upgrades", `${[...designs.values()].filter((design) => design.crosswalk || design.pedestrianIsland).length} crossings or islands`, true),
    ],
    throughputPerHour: [
      factor("Road capacity", `${settings.roadCapacity}% of baseline`, settings.roadCapacity >= 100),
      factor("Lane changes", `${sumNumbers([...designs.values()].map((design) => design.laneDelta))} net lanes`, true),
      factor("Congestion", `${state.city.metrics.congestionPercent.toFixed(0)}% network pressure`, state.city.metrics.congestionPercent < 60),
    ],
    activeVehicles: demandFactors,
    activePedestrians: [
      factor("Time of day", state.cityActivity.clockLabel, true),
      factor("Walking demand", `${Math.round(state.city.metrics.pedestrianTripsDaily).toLocaleString()} trips/day`, true),
      factor("Visible sample", "Agents represent a larger citywide population", true),
    ],
    crossingsCompleted: [
      factor("Elapsed run", `${state.elapsedSeconds.toFixed(0)} real simulation seconds`, true),
      factor("Pedestrian activity", `${formatVolume(activity.pedestrianDemandLevel)} live demand`, true),
      factor("Signal access", `${state.signals.length} controlled intersections`, true),
    ],
  };
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: descriptions[stat] ?? "A live street-simulation measurement.",
    history: liveStatHistory.get(`live:${stat}`) ?? [],
    historyLabel: "Recent live samples",
    factors: factors[stat] ?? demandFactors,
  };
}

function buildingStatInsight(stat: string, current: string): StatInsight | null {
  if (selectedEntity?.kind !== "building") return null;
  const state = simulation.getState();
  const building = state.entities.buildings.find((candidate) => candidate.id === selectedEntity?.id);
  if (!building) return null;
  const traffic = simulation.getBuildingTrafficAttribution(building.id);
  const titles: Record<string, string> = {
    residents: "Residents and capacity", rentMonthly: "Monthly rent", landValue: "Land value", connectedTrips: "Attributed vehicle trips",
    employees: "Staffing", activeWorkers: "Active staff today", serviceDelivered: "Service output delivered", serviceQuality: "Service quality", averageWage: "Average workday wage",
    customers: "Daily customers", goodsProduced: "Finished goods produced", goodsSold: "Goods sold", goodsInventory: "Stock on hand", unitPrice: "Unit price", operatingRevenue: "Operating revenue", operatingCost: "Operating costs", profit: "Net result",
    municipalFunding: "City operating grant", salesRevenue: "Earned revenue", taxRevenueDaily: "City tax revenue", municipalBalance: "Municipal balance",
    dailyWages: "Payroll", supplyCost: "Purchased input cost", localSupplyCost: "Local input cost", importedSupplyCost: "Imported input cost", landedSupplyCost: "Landed supply cost", transportCost: "Delivery transport cost", maintenanceCost: "Maintenance cost",
    goodsReceived: "Inputs received", localSupplies: "Local supply", importedSupplies: "Imported supply",
    localSalesRevenue: "Local sales", externalSalesRevenue: "Outside-market sales", operatingScale: "Operating hours", buildingCondition: "Building condition", maintenanceDeferred: "Deferred maintenance", targetMargin: "Target margin",
    baseTransportCost: "Base transport cost", congestionSurcharge: "Congestion surcharge", totalTransportCost: "Total transport cost",
    deliveryTransportCost: "Delivery cost", residentCommuteCost: "Resident commute cost", routeDelay: "Average route delay", roadTrips: "Road passages",
    commuteTrips: "Work-trip legs", customerTrips: "Visit legs", supplyTrips: "Delivery units",
  };
  const historyAccessors: Record<string, (point: BuildingHistoryPoint) => number> = {
    residents: () => building.residentIds.length,
    rentMonthly: (point) => point.rentDaily * 30.4,
    landValue: (point) => point.landValue,
    connectedTrips: (point) => point.workLegs + point.visitLegs,
    employees: (point) => point.employees,
    activeWorkers: (point) => point.activeWorkers,
    serviceDelivered: (point) => point.serviceDelivered,
    serviceQuality: (point) => point.serviceQuality * 100,
    averageWage: (point) => point.averageWage,
    customers: (point) => point.customers,
    goodsProduced: (point) => point.goodsProduced,
    goodsSold: (point) => point.goodsSold,
    goodsInventory: (point) => point.goodsInventory,
    unitPrice: (point) => point.unitPrice,
    operatingRevenue: (point) => point.operatingRevenue,
    operatingCost: (point) => point.operatingCost,
    profit: (point) => point.profit,
    dailyWages: (point) => point.dailyWages,
    municipalFunding: (point) => point.municipalFunding,
    salesRevenue: (point) => point.salesRevenue,
    localSalesRevenue: (point) => point.localSalesRevenue,
    externalSalesRevenue: (point) => point.externalSalesRevenue,
    operatingScale: (point) => point.operatingScale * 100,
    buildingCondition: (point) => point.buildingCondition * 100,
    maintenanceDeferred: (point) => point.maintenanceDeferred,
    targetMargin: (point) => point.targetMargin * 100,
    taxRevenueDaily: () => state.city.metrics.taxRevenueDaily,
    municipalBalance: () => state.city.metrics.municipalBalance,
    supplyCost: (point) => point.supplyCost,
    localSupplyCost: (point) => point.localSupplyCost,
    importedSupplyCost: (point) => point.importedSupplyCost,
    landedSupplyCost: (point) => point.supplyCost + point.transportCost,
    goodsReceived: (point) => point.goodsReceived,
    localSupplies: (point) => point.localSupplies,
    importedSupplies: (point) => point.importedSupplies,
    transportCost: (point) => point.transportCost,
    maintenanceCost: (point) => point.maintenanceCost,
    baseTransportCost: (point) => point.transportCost,
    congestionSurcharge: (point) => point.transportCost,
    totalTransportCost: (point) => point.transportCost,
    deliveryTransportCost: (point) => point.transportCost,
    residentCommuteCost: (point) => point.transportCost,
    routeDelay: () => state.city.metrics.averageTrafficDelayMinutes,
    roadTrips: (point) => point.workLegs + point.visitLegs,
    commuteTrips: (point) => point.workLegs,
    customerTrips: (point) => point.visitLegs,
    supplyTrips: (point) => point.deliveryUnits,
  };
  const factors = buildingFactors(stat, building, traffic);
  const descriptions: Record<string, string> = {
    averageWage: "The wage offered by this building per worker per day.",
    profit: "Operating revenue minus payroll, supplies, transport, and maintenance.",
    operatingRevenue: "Sales, rent, or public operating grants received by this building today.",
    operatingCost: "All labor, supply, transport, and maintenance expenses paid today.",
    landValue: "A slowly adjusting value based on access, staffing, wellbeing, and congestion.",
    rentMonthly: "The monthly equivalent of the daily housing charge used by the accounting simulation.",
    employees: "Filled positions compared with the building's current labor requirement.",
    activeWorkers: "Assigned employees who are scheduled to work today.",
    goodsProduced: "Finished wholesale goods created from raw material inputs and active industrial labor today.",
    goodsInventory: "Consumer stock for retailers or raw-material stock for industrial buildings.",
    unitPrice: "A market price that responds gradually to customer demand, inventory, input costs, and the city price level.",
    municipalFunding: "A city operating grant based on budgeted staffing, operating costs, tax capacity, and municipal finances.",
    salesRevenue: "Revenue earned from purchases or service fees, kept separate from public funding.",
    serviceQuality: "Share of scheduled civic demand delivered with current staffing.",
    supplyCost: "Purchase price of local and imported inputs before delivery costs.",
    localSupplies: "Units sourced inside the city section. The factor breakdown shows their purchase cost.",
    importedSupplies: "Units purchased from the outside market. The factor breakdown shows their purchase and delivery costs.",
    landedSupplyCost: "Purchased input cost plus the cost of delivering those inputs to this building.",
    transportCost: "Cost of moving local and imported supplies to this building through the road network.",
    congestionSurcharge: "Extra transport and commute expense attributed to delayed roads on this building's routes.",
  };
  const accessor = historyAccessors[stat] ?? (() => numericText(current));
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: descriptions[stat] ?? "A daily building value calculated from labor, demand, supplies, and access.",
    history: building.history.map((point) => ({ label: `Day ${point.day}`, value: accessor(point) })),
    historyLabel: "Building history",
    factors,
  };
}

function buildingFactors(
  stat: string,
  building: DetailedBuilding,
  traffic: BuildingTrafficAttribution | null,
): StatFactor[] {
  const state = simulation.getState();
  const accounting = building.accounting;
  const staffing = `${building.employeeIds.length} of ${accounting.requiredWorkers} positions filled`;
  if (stat === "averageWage") return [
    factor("Vacancies", staffing, building.employeeIds.length >= accounting.requiredWorkers),
    factor("Labor market", `${state.city.metrics.unemploymentPercent.toFixed(1)}% city unemployment`, state.city.metrics.unemploymentPercent < 8),
    factor("Employer finances", accounting.operatingRevenue > 0 ? `${(accounting.profit / accounting.operatingRevenue * 100).toFixed(0)}% prior margin influences private wages` : "No prior revenue margin", accounting.profit >= 0),
  ];
  if (stat === "unitPrice") return [
    factor("Cost-backed floor", `${formatDetailedMoney(accounting.operatingCost)} must be recovered across ${accounting.goodsDemanded.toFixed(0)} demanded units`, accounting.operatingRevenue >= accounting.operatingCost),
    factor("Target margin", `${Math.round(accounting.targetMargin * 100)}% before customer price response`, accounting.targetMargin <= 0.12),
    factor("Demand + inventory", `${accounting.customers} visits and ${building.goodsInventory.toFixed(0)} units available`, building.goodsInventory >= 15),
    factor("Price sensitivity", "Higher prices reduce future local choice and outside demand", accounting.unitPrice <= 2 * 22),
  ];
  if (["operatingScale", "buildingCondition", "maintenanceDeferred", "targetMargin"].includes(stat)) return [
    factor("Operating hours", `${Math.round(accounting.operatingScale * 100)}% of normal capacity`, accounting.operatingScale >= 0.9),
    factor("Loss streak", `${accounting.lossStreak} operating days`, accounting.lossStreak < 2),
    factor("Deferred upkeep", formatDetailedMoney(accounting.maintenanceDeferred), accounting.maintenanceDeferred === 0),
    factor("Building condition", `${Math.round(accounting.buildingCondition * 100)}% affects demand and output`, accounting.buildingCondition >= 0.9),
  ];
  if (["localSalesRevenue", "externalSalesRevenue"].includes(stat)) return [
    factor("Local transactions", `${formatDetailedMoney(accounting.localSalesRevenue)} paid by modeled households`, true),
    factor("Outside market", `${formatDetailedMoney(accounting.externalSalesRevenue)} enters through external customers or buyers`, true),
    factor("Accessibility", `${Math.round(building.accessibility.customers)} customer access`, building.accessibility.customers >= 60),
  ];
  if (["municipalFunding", "salesRevenue", "taxRevenueDaily", "municipalBalance"].includes(stat)) return [
    factor("City operating grant", `${formatDetailedMoney(accounting.municipalFunding)} today`, accounting.municipalFunding >= accounting.operatingCost),
    factor("Earned fees", `${formatDetailedMoney(accounting.salesRevenue)} kept separate from grants`, true),
    factor("Tax capacity", `${formatDetailedMoney(state.city.metrics.taxRevenueDaily)} citywide per day`, state.city.metrics.taxRevenueDaily >= state.city.metrics.civicOperatingCostDaily),
    factor("Municipal balance", formatDetailedMoney(state.city.metrics.municipalBalance), state.city.metrics.municipalBalance >= 0),
  ];
  if (["profit", "operatingRevenue", "operatingCost"].includes(stat)) return [
    factor("Revenue", `${formatDetailedMoney(accounting.operatingRevenue)} from sales, rent, or funding`, accounting.operatingRevenue >= accounting.operatingCost),
    factor("Payroll", formatDetailedMoney(accounting.dailyWages), accounting.dailyWages <= accounting.operatingRevenue),
    factor("Supplies + transport", formatDetailedMoney(accounting.supplyCost + accounting.transportCost), accounting.supplyCost + accounting.transportCost < accounting.operatingRevenue),
    factor("Maintenance", formatDetailedMoney(accounting.maintenanceCost), accounting.maintenanceCost < accounting.operatingRevenue),
  ];
  if (["transportCost", "baseTransportCost", "congestionSurcharge", "totalTransportCost", "deliveryTransportCost", "residentCommuteCost", "routeDelay", "roadTrips"].includes(stat)) return [
    factor("Supply deliveries", `${accounting.localSupplies.toFixed(0)} local and ${accounting.importedSupplies.toFixed(0)} imported units use roads`, accounting.importedSupplies < accounting.localSupplies),
    factor("Road congestion", `${state.city.metrics.congestionPercent.toFixed(0)}% citywide; ${(traffic?.averageRouteDelayMinutes ?? 0).toFixed(1)} min on this route`, state.city.metrics.congestionPercent < 60),
    factor("Worst road", traffic?.roads[0] ? `${traffic.roads[0].roadName}: ${traffic.roads[0].congestionPercent.toFixed(0)}% congestion` : "No measured vehicle route", !traffic?.roads[0] || traffic.roads[0].congestionPercent < 60),
  ];
  if (stat === "landValue") return [
    factor("Staffing and access", `${Math.round(accounting.staffingRatio * 100)}% staffing`, accounting.staffingRatio >= 0.8),
    factor("City wellbeing", `${state.city.metrics.happiness.toFixed(0)}% happiness`, state.city.metrics.happiness >= 55),
    factor("Congestion penalty", `-${(state.city.metrics.congestionPercent * 0.8).toFixed(0)} target-value points`, state.city.metrics.congestionPercent < 50),
  ];
  if (stat === "rentMonthly" || stat === "residents") {
    const occupancy = building.residentIds.length / Math.max(1, building.residentCapacity) * 100;
    return [
      factor("Occupancy", `${occupancy.toFixed(0)}% of resident capacity`, occupancy < 88),
      factor("Market response", occupancy > 90 ? "High occupancy raises the monthly asking rent" : occupancy < 65 ? "Vacancy pushes the asking rent down" : "Rent follows land value at a gradual pace", occupancy <= 90),
      factor("Housing capacity", `${building.residentCapacity} residents`, true),
    ];
  }
  if (["employees", "activeWorkers", "serviceDelivered", "serviceQuality", "customers", "goodsProduced", "goodsSold", "goodsInventory"].includes(stat)) return [
    factor("Staffing", staffing, accounting.staffingRatio >= 0.8),
    factor("Scheduled demand", `${accounting.customers || accounting.serviceDemand.toFixed(0)} visits today`, true),
    factor("Available goods", `${building.goodsInventory.toFixed(0)} in inventory; ${accounting.goodsReceived.toFixed(0)} delivered`, building.goodsInventory > 15),
  ];
  if (stat === "maintenanceCost") return [
    factor("Operating scale", `${building.jobCapacity} maximum positions and ${building.residentCapacity || 0} resident capacity`, true),
    factor("Physical upkeep", `${building.floors} floors and a ${Math.round(building.width * building.depth).toLocaleString()}-unit modeled footprint`, building.floors < 8),
    factor("Paid upkeep", `${formatDetailedMoney(accounting.maintenanceCost)} today`, accounting.maintenanceDeferred === 0),
    factor("Deferred upkeep", `${formatDetailedMoney(accounting.maintenanceDeferred)} accumulated`, accounting.maintenanceDeferred === 0),
  ];
  if (["supplyCost", "localSupplyCost", "importedSupplyCost", "landedSupplyCost", "goodsReceived", "localSupplies", "importedSupplies"].includes(stat)) return [
    factor("Local inputs", `${accounting.localSupplies.toFixed(0)} units cost ${formatDetailedMoney(accounting.localSupplyCost)}`, accounting.localSupplies >= accounting.importedSupplies),
    factor("Imported inputs", `${accounting.importedSupplies.toFixed(0)} units cost ${formatDetailedMoney(accounting.importedSupplyCost)}`, accounting.importedSupplies <= accounting.localSupplies),
    factor("Delivery", `${formatDetailedMoney(accounting.transportCost)} raises landed cost to ${formatDetailedMoney(accounting.supplyCost + accounting.transportCost)}`, accounting.transportCost < accounting.supplyCost),
    factor("Inventory", `${building.goodsInventory.toFixed(0)} units remain after production and sales`, building.goodsInventory > 15),
  ];
  if (stat === "dailyWages") return [
    factor("Staffing", staffing, accounting.staffingRatio >= 0.8),
    factor("Building size", `${building.floors} floors require ongoing maintenance`, building.floors < 8),
  ];
  return [
    factor("Commutes", `${building.employeeIds.length} workers assigned`, true),
    factor("Customer schedules", `${accounting.customers} daily visits`, true),
    factor("Supply routes", `${accounting.goodsReceived.toFixed(0)} units delivered`, state.city.metrics.congestionPercent < 60),
  ];
}

function personStatInsight(stat: string, current: string): StatInsight | null {
  if (selectedEntity?.kind !== "person") return null;
  const state = simulation.getState();
  const person = state.entities.people.find((candidate) => candidate.id === selectedEntity?.id);
  if (!person) return null;
  const titles: Record<string, string> = {
    dailyWage: "Daily wage", dailySpending: "Daily spending", netIncome: "Daily net income", commuteCost: "Commute cost",
    networkDelay: "Network delay", money: "Personal cash", householdSize: "Household members", happiness: "Happiness",
    goodsNeed: "Goods need", healthNeed: "Health need", educationNeed: "Education need", communityNeed: "Community need", recreationNeed: "Recreation need",
  };
  const accessors: Record<string, (point: PersonHistoryPoint) => number> = {
    dailyWage: (point) => point.dailyWage,
    dailySpending: (point) => point.dailySpending,
    netIncome: (point) => point.dailyWage - point.dailySpending,
    commuteCost: (point) => point.commuteCost,
    networkDelay: () => state.city.metrics.averageTrafficDelayMinutes,
    money: (point) => point.money,
    householdSize: () => state.entities.households.find((household) => household.id === person.householdId)?.memberIds.length ?? 1,
    happiness: (point) => point.happiness,
    goodsNeed: (point) => point.goodsNeed,
    healthNeed: (point) => point.healthNeed,
    educationNeed: (point) => point.educationNeed,
    communityNeed: (point) => point.communityNeed,
    recreationNeed: (point) => point.recreationNeed,
  };
  const factors = personFactors(stat, person);
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: stat.endsWith("Need")
      ? "A daily need score that rises after a matching visit and falls when unmet."
      : stat === "happiness"
        ? "Weighted result of needs, financial security, employment, housing, and travel burden."
        : "A daily household and personal-finance value produced by this resident's schedule.",
    history: person.history.map((point) => ({ label: `Day ${point.day}`, value: (accessors[stat] ?? (() => numericText(current)))(point) })),
    historyLabel: "Resident history",
    factors,
  };
}

function personFactors(stat: string, person: DetailedPerson): StatFactor[] {
  const state = simulation.getState();
  const workplace = state.entities.buildings.find((building) => building.id === person.workBuildingId);
  if (stat === "dailyWage") return [
    factor("Employment", formatEmployment(person.employment), person.employment !== "unemployed"),
    factor("Employer wage", workplace ? `${workplace.name}: ${formatDetailedMoney(workplace.accounting.averageWage)}/day` : "No local employer", Boolean(workplace)),
    factor("Employer status", workplace ? formatEntityStatus(workplace.accounting.status) : "External or no job", workplace?.accounting.status !== "closed"),
  ];
  if (["dailySpending", "netIncome", "money"].includes(stat)) return [
    factor("Income", `${formatDetailedMoney(person.dailyWage)} wage today`, person.dailyWage >= person.dailySpending),
    factor("Daily expenses", `${formatDetailedMoney(person.dailySpending)} including housing, goods, services, and travel`, person.dailySpending <= person.dailyWage),
    factor("Commute", `${formatDetailedMoney(person.commuteCost)} today`, person.commuteCost < person.dailyWage * 0.15),
  ];
  if (stat === "commuteCost" || stat === "networkDelay") return [
    factor("Travel mode", person.schedule.find((item) => item.activity === "work")?.mode ?? "No commute", true),
    factor("Trip time", `${sumNumbers(person.schedule.map((item) => item.travelMinutes))} scheduled minutes/day`, true),
    factor("Congestion", `${state.city.metrics.congestionPercent.toFixed(0)}% raises car and freight costs`, state.city.metrics.congestionPercent < 60),
  ];
  if (stat === "happiness") {
    const components = person.happinessComponents;
    return [
      factor("Needs · 35%", `${components.needs.toFixed(0)} score contributes ${(components.needs * 0.35).toFixed(1)} points`, components.needs >= 60),
      factor("Financial security · 25%", `${components.financialSecurity.toFixed(0)} score contributes ${(components.financialSecurity * 0.25).toFixed(1)} points`, components.financialSecurity >= 60),
      factor("Employment · 15%", `${components.employment.toFixed(0)} score contributes ${(components.employment * 0.15).toFixed(1)} points`, components.employment >= 60),
      factor("Housing · 15%", `${components.housing.toFixed(0)} score contributes ${(components.housing * 0.15).toFixed(1)} points`, components.housing >= 60),
      factor("Travel · 10%", `${components.travel.toFixed(0)} score contributes ${(components.travel * 0.1).toFixed(1)} points`, components.travel >= 60),
    ];
  }
  if (stat.endsWith("Need")) {
    const activity = stat.replace("Need", "").toLowerCase();
    return [
      factor("Today's schedule", person.schedule.map((item) => formatActivity(item.activity)).join(" → "), true),
      factor("Matching visit", "A matching visit adds 7 points", person.schedule.some((item) => needMetByActivity(activity, item.activity))),
      factor("Unmet need", "Without a matching visit, the score falls 3 points", person.schedule.some((item) => needMetByActivity(activity, item.activity))),
    ];
  }
  return [factor("Household", `${state.entities.households.find((household) => household.id === person.householdId)?.memberIds.length ?? 1} members share finances`, true)];
}

function householdStatInsight(stat: string, current: string): StatInsight | null {
  if (selectedEntity?.kind !== "person") return null;
  const state = simulation.getState();
  const person = state.entities.people.find((candidate) => candidate.id === selectedEntity?.id);
  const household = state.entities.households.find((candidate) => candidate.id === person?.householdId);
  if (!household) return null;
  const accessors: Record<string, (point: HouseholdHistoryPoint) => number> = {
    dailyIncome: (point) => point.dailyIncome,
    housing: (point) => point.housing,
    goods: (point) => point.goods,
    transport: (point) => point.transport,
    money: (point) => point.money,
    debt: (point) => point.debt,
    rentArrears: (point) => point.rentArrears,
    assistanceReceived: (point) => point.assistanceReceived,
    financialStatus: () => ["stable", "strained", "distressed", "crisis"].indexOf(household.financialStatus),
  };
  const titles: Record<string, string> = {
    dailyIncome: "Household income", housing: "Housing expense", goods: "Goods expense", transport: "Transport expense", money: "Shared household balance",
    debt: "Household debt", rentArrears: "Rent arrears", assistanceReceived: "Safety-net assistance", financialStatus: "Financial status",
  };
  const members = household.memberIds.map((id) => state.entities.people.find((candidate) => candidate.id === id)).filter(Boolean) as DetailedPerson[];
  const factors: Record<string, StatFactor[]> = {
    dailyIncome: [factor("Earners", `${members.filter((member) => member.dailyWage > 0).length} of ${members.length} members earn wages`, members.some((member) => member.dailyWage > 0)), factor("Combined wages", formatDetailedMoney(sumNumbers(members.map((member) => member.dailyWage))), true)],
    housing: [factor("Building rent", formatDetailedMoney(household.dailyExpenses.housing), true), factor("Occupancy", `${members.length} household members share this expense`, true)],
    goods: [factor("Household size", `${members.length} consumers`, true), factor("Needs", `${(sumNumbers(members.map((member) => member.needs.goods)) / Math.max(1, members.length)).toFixed(0)} average goods need`, true)],
    transport: [factor("Commutes", `${members.filter((member) => member.employment === "local" || member.employment === "external").length} workers travel`, true), factor("Congestion", `${state.city.metrics.congestionPercent.toFixed(0)}% network pressure`, state.city.metrics.congestionPercent < 60)],
    money: [factor("Daily income", formatDetailedMoney(household.dailyIncome), household.dailyIncome >= household.dailyExpenses.total), factor("Daily expenses", formatDetailedMoney(household.dailyExpenses.total), household.dailyExpenses.total <= household.dailyIncome), factor("Rent arrears", formatDetailedMoney(household.rentArrears), household.rentArrears === 0)],
    debt: [factor("Unpaid purchases", formatDetailedMoney(household.debt), household.debt === 0), factor("Rent tracked separately", formatDetailedMoney(household.rentArrears), household.rentArrears === 0)],
    rentArrears: [factor("Current housing charge", formatDetailedMoney(household.dailyExpenses.housing), true), factor("Outstanding rent", formatDetailedMoney(household.rentArrears), household.rentArrears === 0)],
    assistanceReceived: [factor("Eligibility", capitalize(household.financialStatus), household.assistanceReceived === 0), factor("Daily aid", formatDetailedMoney(household.assistanceReceived), true)],
    financialStatus: [factor("Cash", formatDetailedMoney(household.money), household.money > 0), factor("Debt", formatDetailedMoney(household.debt), household.debt === 0), factor("Rent arrears", formatDetailedMoney(household.rentArrears), household.rentArrears === 0), factor("Unmet essentials", formatDetailedMoney(household.unmetEssentials), household.unmetEssentials === 0)],
  };
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: "A shared household ledger updated after every resident earns income and pays daily expenses.",
    history: household.history.map((point) => ({ label: `Day ${point.day}`, value: (accessors[stat] ?? (() => numericText(current)))(point) })),
    historyLabel: "Household history",
    factors: factors[stat] ?? factors.money,
  };
}

function roadStatInsight(stat: string, current: string): StatInsight {
  const state = simulation.getState();
  const feature = selectedTrafficFeature;
  const road = state.roadTraffic.find((candidate) => candidate.segmentId === feature?.id);
  const city = state.city.metrics;
  const titles: Record<string, string> = {
    congestionPercent: "Road congestion", activeVehicles: "Vehicles on this road", queuedVehicles: "Queued vehicles", averageSpeedMph: "Road speed",
    signalPhase: "Signal phase", networkCongestion: "Network congestion", networkDelay: "Average network delay", networkCost: "Daily traffic cost",
    workTrips: "Work-trip demand", shoppingTrips: "Shopping-trip demand", freightTrips: "Freight-trip demand",
  };
  let history = road ? liveStatHistory.get(`road:${road.segmentId}:${stat}`) ?? [] : [];
  if (["networkCongestion", "networkDelay", "networkCost"].includes(stat)) {
    history = state.city.timeline.map((point) => ({
      label: `Day ${point.day}`,
      value: stat === "networkCongestion" ? point.congestionPercent : stat === "networkDelay" ? point.averageTrafficDelayMinutes : point.congestionCostDaily,
    }));
  }
  if (["workTrips", "shoppingTrips", "freightTrips"].includes(stat)) {
    history = state.city.timeline.map((point) => ({
      label: `Day ${point.day}`,
      value: stat === "workTrips" ? point.commuteTripsDaily : stat === "shoppingTrips" ? point.shoppingTripsDaily : point.freightTripsDaily,
    }));
  }
  const factors = road
    ? [
        factor("Current vehicles", `${road.activeVehicles} moving or queued`, road.activeVehicles < 12),
        factor("Queue", `${road.queuedVehicles} stopped vehicles`, road.queuedVehicles < 4),
        factor("Measured delay", `${road.averageDelaySeconds.toFixed(0)} seconds`, road.averageDelaySeconds < 30),
        factor("Road capacity", `${simulation.getSettings().roadCapacity}% of baseline`, simulation.getSettings().roadCapacity >= 100),
      ]
    : [
        factor("Work", `${Math.round(city.commuteTripsDaily).toLocaleString()} trips/day`, city.commuteTripsDaily < city.dailyTrips * 0.6),
        factor("Shopping", `${Math.round(city.shoppingTripsDaily).toLocaleString()} trips/day`, true),
        factor("Freight", `${Math.round(city.freightTripsDaily).toLocaleString()} trips/day`, city.freightTripsDaily < city.dailyTrips * 0.2),
        factor("Capacity and signals", `${simulation.getSettings().roadCapacity}% roads; ${simulation.getSettings().signalCycleSeconds}-second signals`, simulation.getSettings().roadCapacity >= 100),
      ];
  return {
    title: titles[stat] ?? capitalize(stat),
    current,
    description: road ? "A live measurement from agents currently using this road segment." : "A network result produced by city trip demand, road capacity, and signal timing.",
    history,
    historyLabel: road ? "Recent road samples" : "City history",
    factors,
  };
}

function factor(label: string, detail: string, positive: boolean): StatFactor {
  return { label, detail, tone: positive ? "positive" : "negative" };
}

function numericText(value: string): number {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function needMetByActivity(need: string, activity: DetailedPerson["currentActivity"]): boolean {
  if (need === "goods") return activity === "shop";
  if (need === "health") return activity === "healthcare";
  if (need === "education") return activity === "school" || activity === "library";
  if (need === "community") return activity === "library" || activity === "leisure";
  return activity === "leisure";
}

function setSettingsOpen(open: boolean): void {
  settingsDrawer.hidden = !open;
  settingsScrim.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
}

function updateControlPreviews(): void {
  const settings = simulation.getSettings();
  const timeRatePreset = selectedTimeRatePreset();
  timeRateOutput.value = timeRatePreset.label;
  timeRatePreview.textContent = timeRatePreset.description;
  speedLimitOutput.value = `${settings.speedLimitMph} mph`;
  signalCycleOutput.value = `${settings.signalCycleSeconds} sec`;
  transitHeadwayOutput.value = `${settings.transitHeadwayMinutes} min`;
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
}

function selectedTimeRatePreset(): (typeof TIME_RATE_PRESETS)[number] {
  const index = Math.min(
    TIME_RATE_PRESETS.length - 1,
    Math.max(0, Math.round(Number(timeRateControl.value))),
  );
  return TIME_RATE_PRESETS[index]!;
}

function nearestTimeRatePresetIndex(
  simulationSpeed: number,
  timeHorizon: TimeHorizon,
): number {
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < TIME_RATE_PRESETS.length; index += 1) {
    const preset = TIME_RATE_PRESETS[index]!;
    const horizonPenalty = preset.timeHorizon === timeHorizon ? 0 : 100;
    const speedDifference = Math.abs(
      Math.log(Math.max(simulationSpeed, 1 / 3_600))
        - Math.log(preset.simulationSpeed),
    );
    const score = horizonPenalty + speedDifference;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function accountingNode(
  label: string,
  value: number,
  max: number,
  tone: string,
  stat: string,
  scope: string,
): string {
  const width = Math.max(8, Math.min(100, Math.abs(value) / max * 100));
  return `<span class="accounting-node" data-tone="${tone}" data-stat="${stat}" data-stat-scope="${scope}" tabindex="0"><small>${label}</small><b data-stat-value>${formatDetailedMoney(value)}</b><i style="width:${width}%"></i></span>`;
}

function statCell(label: string, value: string, scope: string, stat: string, detail = ""): string {
  return `<span data-stat="${stat}" data-stat-scope="${scope}" tabindex="0"><small>${label}</small><b data-stat-value>${value}</b>${detail}</span>`;
}

function inlineStat(label: string, value: string, scope: string, stat: string): string {
  return `<span data-stat="${stat}" data-stat-scope="${scope}" tabindex="0">${label} <b data-stat-value>${value}</b></span>`;
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
  return value === "understaffed" ? "Understaffed" : value === "funded" ? "Publicly funded" : capitalize(value);
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

function formatMobilityStatus(person: Readonly<DetailedPerson>): string {
  if (person.mobility.phase === "walking") return `Walking to ${formatActivity(person.currentActivity)}`;
  if (person.mobility.phase === "driving") return `Driving to ${formatActivity(person.currentActivity)}`;
  if (person.mobility.phase === "transit") return `Transit to ${formatActivity(person.currentActivity)}`;
  return formatActivity(person.currentActivity);
}

function formatMobilityDetail(value: MobilityDetailMode): string {
  return value === "continuous"
    ? "Continuous movement"
    : value === "interpolated" ? "Schedule interpolation" : "Daily outcomes";
}

function outsideLocationName(buildingId: string): string {
  return buildingId === "outside-work"
    ? "Jobs outside the section"
    : buildingId === "outside-market" ? "Regional market" : "Outside University City";
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

function formatSignedMoney(value: number): string {
  const formatted = formatDetailedMoney(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function averageHappinessComponent(
  people: readonly DetailedPerson[],
  component: keyof DetailedPerson["happinessComponents"],
): number {
  return sumNumbers(people.map((person) => person.happinessComponents[component]))
    / Math.max(1, people.length);
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
  for (const building of simulation.getState().entities.buildings) optionNames.add(building.name);
  for (const person of simulation.getState().entities.people) optionNames.add(person.name);
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
  const state = simulation.getState();
  const building = state.entities.buildings.find(
    (candidate) => candidate.name.toLowerCase() === query,
  );
  if (building) {
    locationSearchInput.setCustomValidity("");
    focusInspectorBuilding(building.id);
    return;
  }
  const person = state.entities.people.find(
    (candidate) => candidate.name.toLowerCase() === query,
  );
  if (person) {
    locationSearchInput.setCustomValidity("");
    focusTrackedPerson(person.id);
    return;
  }
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
    locationSearchInput.setCustomValidity("Choose a listed building, resident, landmark, or street.");
    locationSearchInput.reportValidity();
    return;
  }
  locationSearchInput.setCustomValidity("");
  renderer.flyTo(point);
  if (feature) {
    selectedFeature = feature;
    selectedTrafficFeature = feature;
    selectedEntity = null;
    inspectorTab = "overview";
    renderer.setSelectedEntity(null);
    renderer.setSelectedFeature(feature.id);
    updateSelectionPanel();
    syncEntitySelectionState();
    entityInterfaceSignature = "";
    updateEntityInterface();
  } else if (landmark) {
    simulationTitle.textContent = landmark.name;
    sceneSubtitle.textContent = "Penn campus landmark";
  }
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLElement && target.isContentEditable;
}

function applyDisplayAccessibility(): void {
  const highContrast = highContrastControl.checked;
  const reducedMotion = reducedMotionControl.checked;
  document.documentElement.dataset.uiScale = uiScaleControl.value;
  document.body.dataset.highContrast = String(highContrast);
  document.body.dataset.reducedMotion = String(reducedMotion);
  renderer.setHighContrast(highContrast);
  renderer.setReducedMotion(reducedMotion);
}

function applyStatMapEmphasis(stat: string | undefined): void {
  if (!stat || selectedEntity?.kind !== "building") return;
  const workStats = new Set([
    "employees", "averageWage", "dailyWages", "residentCommuteCost", "commuteTrips",
  ]);
  const visitStats = new Set([
    "customers", "externalCustomers", "unitPrice", "operatingRevenue", "localSalesRevenue",
    "externalSalesRevenue", "serviceDelivered", "customerTrips",
  ]);
  const deliveryStats = new Set([
    "supplyCost", "localSupplyCost", "importedSupplyCost", "localSupplies", "importedSupplies",
    "goodsReceived", "transportCost", "landedSupplyCost", "deliveryTransportCost", "supplyTrips",
  ]);
  const kind = workStats.has(stat)
    ? "work"
    : visitStats.has(stat)
      ? "visit"
      : deliveryStats.has(stat)
        ? "delivery"
        : null;
  if (kind) renderer.setVisibleFlowKinds(new Set<BuildingConnectionKind>([kind]));
  if (["transportCost", "landedSupplyCost", "deliveryTransportCost", "congestionSurcharge", "totalTransportCost", "routeDelay", "roadTrips"].includes(stat)) {
    const traffic = simulation.getBuildingTrafficAttribution(selectedEntity.id);
    renderer.setTrafficFocusSegments(traffic?.roads.slice(0, 8).map((road) => road.segmentId) ?? []);
  }
}

function clearStatMapEmphasis(): void {
  renderer.setVisibleFlowKinds(visibleFlowKinds);
  if (selectedEntity?.kind !== "building" || !showAffectedRoads) {
    renderer.setTrafficFocusSegments([]);
    return;
  }
  const traffic = simulation.getBuildingTrafficAttribution(selectedEntity.id);
  renderer.setTrafficFocusSegments(traffic?.roads.slice(0, 8).map((road) => road.segmentId) ?? []);
}

renderer.resize();
renderer.setSelectedFeature(selectedFeature?.id ?? null);
syncExpansion();
updateHistoryButtons();
syncEnvironmentControls();
initializeSearch();
updateControlPreviews();
setCameraMode(cameraMode);
setAppMode("simulate");
updateInterface();
window.requestAnimationFrame(animationFrame);
