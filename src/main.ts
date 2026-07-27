import "./styles.css";
import { Simulation } from "./core/simulation";
import { ThreeRenderer } from "./rendering/threeRenderer";

const canvas = requireElement<HTMLCanvasElement>("simulation-canvas");
const runButton = requireElement<HTMLButtonElement>("run-button");
const pauseButton = requireElement<HTMLButtonElement>("pause-button");
const resetButton = requireElement<HTMLButtonElement>("reset-button");
const speedControl = requireElement<HTMLInputElement>("speed-control");
const speedOutput = requireElement<HTMLOutputElement>("speed-output");
const vehicleVolumeControl = requireElement<HTMLInputElement>("vehicle-volume-control");
const vehicleVolumeOutput = requireElement<HTMLOutputElement>("vehicle-volume-output");
const speedLimitControl = requireElement<HTMLInputElement>("speed-limit-control");
const speedLimitOutput = requireElement<HTMLOutputElement>("speed-limit-output");
const signalCycleControl = requireElement<HTMLInputElement>("signal-cycle-control");
const signalCycleOutput = requireElement<HTMLOutputElement>("signal-cycle-output");
const statusPill = requireElement<HTMLSpanElement>("status-pill");
const signalPhase = requireElement<HTMLElement>("signal-phase");
const signalTimeRemaining = requireElement<HTMLElement>("signal-time-remaining");
const averageTravel = requireElement<HTMLElement>("average-travel");
const congestion = requireElement<HTMLElement>("congestion");
const trafficFlow = requireElement<HTMLElement>("traffic-flow");
const completedVehicles = requireElement<HTMLElement>("completed-vehicles");

const simulation = new Simulation();
const renderer = new ThreeRenderer(canvas);
let previousTimestamp = performance.now();
const settings = simulation.getSettings();

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

bindRangeControl(
  speedControl,
  speedOutput,
  settings.simulationSpeed,
  (value) => `${value.toFixed(1)}×`,
  (value) => simulation.setSimulationSpeed(value),
);

bindRangeControl(
  vehicleVolumeControl,
  vehicleVolumeOutput,
  settings.vehicleVolume,
  (value) => `${value} ${value === 1 ? "vehicle" : "vehicles"}/min`,
  (value) => simulation.setVehicleVolume(value),
);

bindRangeControl(
  speedLimitControl,
  speedLimitOutput,
  settings.speedLimitMph,
  (value) => `${value} mph`,
  (value) => simulation.setSpeedLimitMph(value),
);

bindRangeControl(
  signalCycleControl,
  signalCycleOutput,
  settings.signalCycleSeconds,
  (value) => `${value} s`,
  (value) => simulation.setSignalCycleSeconds(value),
);

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
  const state = simulation.getState();

  signalPhase.textContent = formatSignalPhase(state.signalPhase);
  signalTimeRemaining.textContent = state.signalPhaseRemainingSeconds.toFixed(1);
  averageTravel.textContent = formatMetric(
    state.metrics.averageVehicleTravelSeconds,
    (value) => `${value.toFixed(1)} s`,
  );
  congestion.textContent = formatMetric(
    state.metrics.congestionPercent,
    (value) => `${Math.round(value)}%`,
  );
  trafficFlow.textContent = formatMetric(
    state.metrics.trafficFlowPerMinute,
    (value) => `${value.toFixed(1)}/min`,
  );
  completedVehicles.textContent = formatMetric(
    state.metrics.completedVehicles,
    (value) => String(Math.round(value)),
  );
}

function bindRangeControl(
  control: HTMLInputElement,
  output: HTMLOutputElement,
  initialValue: number,
  formatValue: (value: number) => string,
  applyValue: (value: number) => void,
): void {
  const update = (): void => {
    const value = Number(control.value);
    output.value = formatValue(value);
    applyValue(value);
  };

  control.value = String(initialValue);
  output.value = formatValue(initialValue);
  control.addEventListener("input", update);
}

function formatSignalPhase(phase: string): string {
  if (phase === "vehicles") return "Vehicles";
  if (phase === "pedestrians") return "Pedestrians";
  return phase.replaceAll("_", " ");
}

function formatMetric(value: number | undefined, formatter: (value: number) => string): string {
  return value !== undefined && Number.isFinite(value) ? formatter(value) : "--";
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

renderer.resize();
updateInterface();
window.requestAnimationFrame(animationFrame);
