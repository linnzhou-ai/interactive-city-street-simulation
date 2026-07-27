import "./styles.css";
import { Simulation } from "./core/simulation";
import type {
  BuildTool,
  GridCellDesign,
  GridSignalDesign,
  IntersectionLayout,
} from "./models/types";
import { BUILD_GRID_SIZE } from "./models/types";
import { ThreeRenderer } from "./rendering/threeRenderer";

const canvas = requireElement<HTMLCanvasElement>("simulation-canvas");
const simulationTitle = requireElement<HTMLHeadingElement>("simulation-title");
const buildModeButton = requireElement<HTMLButtonElement>("build-mode-button");
const simulateModeButton = requireElement<HTMLButtonElement>("simulate-mode-button");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const speedControl = requireElement<HTMLInputElement>("speed-control");
const speedOutput = requireElement<HTMLOutputElement>("speed-output");
const vehicleVolumeControl = requireElement<HTMLInputElement>("vehicle-volume-control");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const pedestrianVolumeControl = requireElement<HTMLInputElement>("pedestrian-volume-control");
const pedestrianVolumeOutput = requireElement<HTMLOutputElement>("pedestrian-volume-output");
const speedLimitControl = requireElement<HTMLInputElement>("speed-limit-control");
const signalCycleControl = requireElement<HTMLInputElement>("signal-cycle-control");
const statusPill = requireElement<HTMLSpanElement>("status-pill");
const resetDesignButton = requireElement<HTMLButtonElement>("reset-design-button");
const rotateLayoutButton = requireElement<HTMLButtonElement>("rotate-layout-button");
const buildGrid = requireElement<HTMLElement>("build-grid");
const selectedBuildTool = requireElement<HTMLElement>("selected-build-tool");
const rushHourButton = requireElement<HTMLButtonElement>("rush-hour-button");
const schoolArrivalButton = requireElement<HTMLButtonElement>("school-arrival-button");
const vehicleTime = requireElement<HTMLElement>("vehicle-time");
const congestion = requireElement<HTMLElement>("congestion");
const pedestrianWait = requireElement<HTMLElement>("pedestrian-wait");
const conflicts = requireElement<HTMLElement>("conflicts");

const simulation = new Simulation();
const renderer = new ThreeRenderer(canvas);
const gridCells = new Map<string, GridCellDesign>();
const gridSignals = new Map<string, GridSignalDesign>();
let activeBuildTool: BuildTool = "lane";
let isPainting = false;
let hoveredGridCell: { row: number; column: number } | null = null;
let selectedGridCell: { row: number; column: number } | null = null;
const designToolButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-design-tool], [data-build-tool]"),
);
const layoutButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-intersection-layout]"),
);
let previousTimestamp = performance.now();

buildModeButton.addEventListener("click", () => {
  setAppMode("build");
});

simulateModeButton.addEventListener("click", () => {
  setAppMode("simulate");
});

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

speedControl.addEventListener("input", () => {
  const speed = Number(speedControl.value);
  simulation.setSimulationSpeed(speed);
  speedOutput.value = `${speed.toFixed(1)}×`;
});

vehicleVolumeControl.addEventListener("input", () => {
  const volume = Number(vehicleVolumeControl.value);
  simulation.setVehicleVolume(volume);
  vehicleVolumeOutput.value = formatVolume(volume);
  updateMetrics();
});

pedestrianVolumeControl.addEventListener("input", () => {
  const volume = Number(pedestrianVolumeControl.value);
  simulation.setPedestrianVolume(volume);
  pedestrianVolumeOutput.value = formatVolume(volume);
  updateMetrics();
});

speedLimitControl.addEventListener("change", () => {
  const speedLimit = Number(speedLimitControl.value);
  if (Number.isFinite(speedLimit)) {
    simulation.setSpeedLimit(speedLimit);
    speedLimitControl.value = String(simulation.getSettings().speedLimitMph);
  }
});

signalCycleControl.addEventListener("change", () => {
  const signalCycle = Number(signalCycleControl.value);
  if (Number.isFinite(signalCycle)) {
    simulation.setSignalCycle(signalCycle);
    signalCycleControl.value = String(simulation.getSettings().signalCycleSeconds);
  }
});

for (const button of designToolButtons) {
  button.addEventListener("click", () => {
    const tool = button.dataset.designTool ?? button.dataset.buildTool;
    if (!isBuildTool(tool)) return;
    selectBuildTool(tool);
  });
}

for (const button of layoutButtons) {
  button.addEventListener("click", () => {
    const layout = button.dataset.intersectionLayout;
    if (!isIntersectionLayout(layout)) return;
    setIntersectionLayout(layout);
  });
}

rotateLayoutButton.addEventListener("click", () => {
  renderer.rotateIntersection();
  rotateGridDesign();
  simulation.reset();
  updateInterface();
});

resetDesignButton.addEventListener("click", () => {
  gridCells.clear();
  gridSignals.clear();
  selectedGridCell = null;
  syncBuildGrid();
  simulationTitle.textContent = "Empty build lot";
  simulation.reset();
  updateInterface();
});

rushHourButton.addEventListener("click", () => {
  applyScenario({
    vehicleVolume: 3,
    pedestrianVolume: 1,
    speedLimitMph: 35,
    signalCycleSeconds: 20,
  });
});

schoolArrivalButton.addEventListener("click", () => {
  applyScenario({
    vehicleVolume: 2,
    pedestrianVolume: 3,
    speedLimitMph: 15,
    signalCycleSeconds: 30,
  });
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
  const metrics = simulation.getState().metrics;
  vehicleTime.textContent = `${metrics.vehicleTravelSeconds.toFixed(1)} s`;
  congestion.textContent = String(metrics.congestion);
  pedestrianWait.textContent = `${metrics.pedestrianWaitSeconds.toFixed(1)} s`;
  conflicts.textContent = String(metrics.potentialConflicts);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

function formatVolume(volume: number): string {
  return ["Low", "Medium", "High"][volume - 1] ?? "Low";
}

function setIntersectionLayout(layout: IntersectionLayout): void {
  renderer.setIntersectionLayout(layout);
  simulationTitle.textContent = formatLayoutName(layout);

  for (const button of layoutButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.intersectionLayout === layout));
  }

  seedGridLayout(layout);
  simulation.reset();
  updateInterface();
}

function setAppMode(mode: "build" | "simulate"): void {
  document.body.dataset.appMode = mode;
  const isBuildMode = mode === "build";
  buildModeButton.setAttribute("aria-pressed", String(isBuildMode));
  simulateModeButton.setAttribute("aria-pressed", String(!isBuildMode));
  renderer.setBuildMode(isBuildMode);
  simulation.pause();
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
    ) {
      return;
    }

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
    if (gridSignals.has(key)) {
      gridSignals.delete(key);
    } else {
      gridCells.delete(key);
    }
  } else if (activeBuildTool === "signal") {
    gridSignals.set(key, { row, column, rotation: 0 });
  } else {
    gridCells.set(key, { row, column, element: activeBuildTool, rotation: 0 });
  }
  simulationTitle.textContent = "Custom street design";
  syncBuildGrid();
}

function rotateGridCell(row: number, column: number): void {
  const key = gridCellKey(row, column);
  const signal = gridSignals.get(key);
  if (signal) {
    gridSignals.set(key, {
      ...signal,
      rotation: (signal.rotation + 1) % 4,
    });
    selectedGridCell = { row, column };
    syncBuildGrid();
    return;
  }
  const current = gridCells.get(key);
  if (!current) return;
  selectedGridCell = { row, column };
  gridCells.set(key, {
    ...current,
    rotation: (current.rotation + 1) % 4,
  });
  syncBuildGrid();
}

function seedGridLayout(layout: IntersectionLayout): void {
  gridCells.clear();
  gridSignals.clear();
  selectedGridCell = null;
  const center = Math.floor((BUILD_GRID_SIZE - 1) / 2);
  if (layout === "four-way" || layout === "straight" || layout === "t-junction") {
    for (let column = 0; column < BUILD_GRID_SIZE; column += 1) {
      gridCells.set(gridCellKey(center, column), {
        row: center,
        column,
        element: "lane",
        rotation: 1,
      });
    }
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
    gridCells.set(gridCellKey(center, center), {
      row: center,
      column: center,
      element: "asphalt",
      rotation: 0,
    });
  } else if (layout === "t-junction") {
    for (let row = 0; row <= center; row += 1) {
      gridCells.set(gridCellKey(row, center), {
        row,
        column: center,
        element: "lane",
        rotation: 0,
      });
    }
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
      row,
      column,
      element: cell.element,
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
  const cells = buildGrid.querySelectorAll<HTMLButtonElement>(".build-grid-cell");
  for (const cellButton of cells) {
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

function applyScenario(settings: {
  vehicleVolume: number;
  pedestrianVolume: number;
  speedLimitMph: number;
  signalCycleSeconds: number;
}): void {
  simulation.setVehicleVolume(settings.vehicleVolume);
  simulation.setPedestrianVolume(settings.pedestrianVolume);
  simulation.setSpeedLimit(settings.speedLimitMph);
  simulation.setSignalCycle(settings.signalCycleSeconds);

  vehicleVolumeControl.value = String(settings.vehicleVolume);
  vehicleVolumeOutput.value = formatVolume(settings.vehicleVolume);
  pedestrianVolumeControl.value = String(settings.pedestrianVolume);
  pedestrianVolumeOutput.value = formatVolume(settings.pedestrianVolume);
  speedLimitControl.value = String(settings.speedLimitMph);
  signalCycleControl.value = String(settings.signalCycleSeconds);

  simulation.reset();
  updateInterface();
}

function isBuildTool(value: string | undefined): value is BuildTool {
  return (
    value === "lane" ||
    value === "white-lane" ||
    value === "asphalt" ||
    value === "sidewalk" ||
    value === "crosswalk" ||
    value === "signal" ||
    value === "erase"
  );
}

function isIntersectionLayout(value: string | undefined): value is IntersectionLayout {
  return value === "four-way" || value === "t-junction" || value === "straight";
}

function formatLayoutName(layout: IntersectionLayout): string {
  if (layout === "t-junction") return "T-junction";
  if (layout === "straight") return "Straight street";
  return "Four-way intersection";
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

renderer.resize();
createBuildGrid();
setIntersectionLayout("four-way");
selectBuildTool("lane");
setAppMode("build");
window.requestAnimationFrame(animationFrame);
