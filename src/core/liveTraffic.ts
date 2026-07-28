import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_STREETS,
} from "../data/pennRoadGraph";
import type {
  FeatureDesign,
  ManualSignalTarget,
  PedestrianSnapshot,
  PlacedBuilding,
  ScenarioSettings,
  SignalControlMode,
  SignalPhase,
  SignalSnapshot,
  SignalTiming,
  SimulationMetrics,
  VehicleKind,
  VehicleSnapshot,
} from "../models/types";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const VEHICLE_TARGETS = [0, 40, 100, 170] as const;
const PEDESTRIAN_TARGETS = [0, 55, 145, 260] as const;
const VEHICLE_SPAWN_RATES = [0, 0.28, 0.72, 1.25] as const;
const PEDESTRIAN_SPAWN_RATES = [0, 0.45, 1.1, 1.9] as const;
const VEHICLE_COLORS = [
  "#c9473a",
  "#275f7b",
  "#d1a13d",
  "#e5e2d9",
  "#283832",
  "#754564",
  "#b9c2c1",
] as const;
const PEDESTRIAN_COLORS = [
  "#236f75",
  "#b65a4b",
  "#d4a646",
  "#735483",
  "#39684e",
] as const;
const VEHICLE_KINDS: readonly VehicleKind[] = [
  "sedan",
  "sedan",
  "compact",
  "suv",
  "van",
  "bus",
];

export const DEFAULT_SIGNAL_TIMING: SignalTiming = {
  northSouthGreenSeconds: 30,
  eastWestGreenSeconds: 30,
  yellowSeconds: 3,
  allRedSeconds: 1,
  pedestrianSeconds: 21,
};

interface GridNode {
  id: string;
  column: number;
  row: number;
  x: number;
  z: number;
  portal?: boolean;
}

interface BuildingNode {
  id: string;
  kind: PlacedBuilding["kind"];
  node: GridNode;
  curb: GridNode;
  entrance: GridNode;
  weight: number;
}

interface VehicleRoute {
  path: readonly GridNode[];
  freight: boolean;
}

interface VehicleAgent {
  id: number;
  path: readonly GridNode[];
  segmentIndex: number;
  distanceOnSegment: number;
  speed: number;
  desiredSpeed: number;
  queued: boolean;
  kind: VehicleKind;
  color: string;
  length: number;
  spawnedAt: number;
  delaySeconds: number;
  lanePreference: 0 | 1;
  complianceProbability: number;
  aggressiveYellow: boolean;
  mayRunRed: boolean;
  violationIntersectionId: string | null;
  violatingUntilSeconds: number;
}

interface PedestrianAgent {
  id: number;
  path: readonly GridNode[];
  segmentIndex: number;
  distanceOnSegment: number;
  speed: number;
  desiredSpeed: number;
  waiting: boolean;
  color: string;
  variant: number;
  side: 1 | -1;
  spawnedAt: number;
  waitSeconds: number;
  committedIntersectionId: string | null;
  complianceProbability: number;
  mayCrossAgainstSignal: boolean;
  signalViolationUsed: boolean;
  violatingUntilSeconds: number;
}

interface PositionedAgent {
  x: number;
  z: number;
  heading: number;
}

interface AutoPhaseStep {
  phase: SignalPhase;
  duration: number;
}

export class IntersectionSignalController {
  readonly intersectionId: string;
  private timing: SignalTiming;
  private mode: SignalControlMode = "automatic";
  private phase: SignalPhase = "ns-green";
  private autoStepIndex = 0;
  private phaseElapsed = 0;
  private manualQueue: SignalPhase[] = [];

  constructor(
    intersectionId: string,
    timing: Readonly<SignalTiming> = DEFAULT_SIGNAL_TIMING,
  ) {
    this.intersectionId = intersectionId;
    this.timing = sanitizeTiming(timing);
  }

  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      if (this.mode === "manual" && this.manualQueue.length === 0) return;
      const duration = this.currentDuration();
      const available = Math.max(0, duration - this.phaseElapsed);
      const consumed = Math.min(remaining, available);
      this.phaseElapsed += consumed;
      remaining -= consumed;
      if (this.phaseElapsed + 1e-6 < duration) return;
      this.phaseElapsed = 0;
      if (this.mode === "automatic") {
        const sequence = this.autoSequence();
        this.autoStepIndex = (this.autoStepIndex + 1) % sequence.length;
        this.phase = sequence[this.autoStepIndex].phase;
      } else {
        this.phase = this.manualQueue.shift() ?? this.phase;
      }
    }
  }

  setTiming(timing: Partial<SignalTiming>): void {
    this.timing = sanitizeTiming({ ...this.timing, ...timing });
    this.phaseElapsed = Math.min(this.phaseElapsed, this.currentDuration());
  }

  reset(timing: Readonly<SignalTiming> = DEFAULT_SIGNAL_TIMING): void {
    this.timing = sanitizeTiming(timing);
    this.mode = "automatic";
    this.phase = "ns-green";
    this.autoStepIndex = 0;
    this.phaseElapsed = 0;
    this.manualQueue = [];
  }

  setMode(mode: SignalControlMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.manualQueue = [];
    this.phaseElapsed = 0;
    if (mode === "automatic") {
      const matchingIndex = this.autoSequence().findIndex(
        (step) => step.phase === this.phase,
      );
      if (matchingIndex >= 0 && this.phase !== "all-red") {
        this.autoStepIndex = matchingIndex;
      } else {
        this.autoStepIndex = 2;
        this.phase = "all-red";
      }
    }
  }

  requestManualPhase(target: ManualSignalTarget): void {
    this.mode = "manual";
    this.phaseElapsed = 0;
    const transition = manualTransition(this.phase, target);
    this.phase = transition.shift() ?? target;
    this.manualQueue = transition;
  }

  getSnapshot(): SignalSnapshot {
    const nextPhase =
      this.mode === "manual"
        ? (this.manualQueue[0] ?? this.phase)
        : this.autoSequence()[(this.autoStepIndex + 1) % this.autoSequence().length]
            .phase;
    return {
      intersectionId: this.intersectionId,
      mode: this.mode,
      phase: this.phase,
      nextPhase,
      timeRemainingSeconds:
        this.mode === "manual" && this.manualQueue.length === 0
          ? null
          : Math.max(0, this.currentDuration() - this.phaseElapsed),
      timing: { ...this.timing },
    };
  }

  private currentDuration(): number {
    if (this.mode === "automatic") {
      return this.autoSequence()[this.autoStepIndex].duration;
    }
    if (this.manualQueue.length === 0) return Number.POSITIVE_INFINITY;
    return phaseDuration(this.phase, this.timing);
  }

  private autoSequence(): AutoPhaseStep[] {
    return [
      { phase: "ns-green", duration: this.timing.northSouthGreenSeconds },
      { phase: "ns-yellow", duration: this.timing.yellowSeconds },
      { phase: "all-red", duration: this.timing.allRedSeconds },
      { phase: "ew-green", duration: this.timing.eastWestGreenSeconds },
      { phase: "ew-yellow", duration: this.timing.yellowSeconds },
      { phase: "all-red", duration: this.timing.allRedSeconds },
      { phase: "pedestrian-walk", duration: this.timing.pedestrianSeconds },
      { phase: "all-red", duration: this.timing.allRedSeconds },
    ];
  }
}

export class LiveTrafficSystem {
  private readonly nodes = createGridNodes();
  private readonly controllers = new Map<string, IntersectionSignalController>();
  private vehicles: VehicleAgent[] = [];
  private pedestrians: PedestrianAgent[] = [];
  private random: RandomSource;
  private nextVehicleId = 1;
  private nextPedestrianId = 1;
  private nextVehicleSpawnSeconds = 0;
  private nextPedestrianSpawnSeconds = 0;
  private elapsedSeconds = 0;
  private completedVehicleTrips = 0;
  private completedVehicleTravelSeconds = 0;
  private completedVehicleDelaySeconds = 0;
  private completedPedestrianTrips = 0;
  private completedPedestrianTravelSeconds = 0;
  private completedPedestrianWaitSeconds = 0;
  private crossingsCompleted = 0;
  private buildingArrivals = 0;
  private trafficViolations = 0;
  private jaywalkingViolations = 0;
  private buildingNodes: BuildingNode[] = [];
  private roadDesigns = new Map<string, FeatureDesign>();

  constructor(seed: number) {
    this.random = new RandomSource(seed);
    for (const node of this.nodes.flat()) {
      this.controllers.set(node.id, new IntersectionSignalController(node.id));
    }
    this.scheduleNextSpawns(2, 2);
  }

  reset(seed: number, vehicleDemand = 2, pedestrianDemand = 2): void {
    this.random = new RandomSource(seed);
    this.vehicles = [];
    this.pedestrians = [];
    this.nextVehicleId = 1;
    this.nextPedestrianId = 1;
    this.elapsedSeconds = 0;
    this.completedVehicleTrips = 0;
    this.completedVehicleTravelSeconds = 0;
    this.completedVehicleDelaySeconds = 0;
    this.completedPedestrianTrips = 0;
    this.completedPedestrianTravelSeconds = 0;
    this.completedPedestrianWaitSeconds = 0;
    this.crossingsCompleted = 0;
    this.buildingArrivals = 0;
    this.trafficViolations = 0;
    this.jaywalkingViolations = 0;
    for (const controller of this.controllers.values()) {
      controller.reset();
    }
    this.scheduleNextSpawns(vehicleDemand, pedestrianDemand);
  }

  update(
    deltaSeconds: number,
    settings: Pick<
      ScenarioSettings,
      "vehicleVolume" | "pedestrianVolume" | "speedLimitMph"
    > & {
      violationRiskMultiplier?: number;
      pedestrianViolationRiskMultiplier?: number;
    },
  ): void {
    if (deltaSeconds <= 0) return;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      const step = Math.min(0.1, remaining);
      this.elapsedSeconds += step;
      for (const controller of this.controllers.values()) controller.update(step);
      this.updateVehicleSpawner(
        step,
        settings.vehicleVolume,
        settings.speedLimitMph,
        settings.violationRiskMultiplier ?? 1,
      );
      this.updatePedestrianSpawner(
        step,
        settings.pedestrianVolume,
        settings.pedestrianViolationRiskMultiplier ??
          settings.violationRiskMultiplier ??
          1,
      );
      this.updateVehicles(step);
      this.updatePedestrians(step);
      remaining -= step;
    }
  }

  setSignalTiming(
    intersectionId: string,
    timing: Partial<SignalTiming>,
  ): void {
    this.controllers.get(intersectionId)?.setTiming(timing);
  }

  setBuildingDestinations(buildings: readonly PlacedBuilding[]): void {
    this.buildingNodes = buildings.map((building) => {
      const node = this.nearestNode(building.x, building.z);
      const entrance = createBuildingEntrance(building, node);
      return {
        id: building.id,
        kind: building.kind,
        node,
        curb: createBuildingCurb(building.id, entrance, node),
        entrance,
        weight: Math.max(1, building.floors),
      };
    });
  }

  setRoadDesigns(designs: ReadonlyMap<string, FeatureDesign>): void {
    this.roadDesigns = new Map(designs);
  }

  setAllSignalCycles(totalSeconds: number): void {
    const fixed =
      DEFAULT_SIGNAL_TIMING.yellowSeconds * 2 +
      DEFAULT_SIGNAL_TIMING.allRedSeconds * 3 +
      DEFAULT_SIGNAL_TIMING.pedestrianSeconds;
    const green = Math.max(10, (Math.max(totalSeconds, fixed + 20) - fixed) / 2);
    for (const controller of this.controllers.values()) {
      controller.setTiming({
        northSouthGreenSeconds: green,
        eastWestGreenSeconds: green,
      });
    }
  }

  setSignalMode(intersectionId: string, mode: SignalControlMode): void {
    this.controllers.get(intersectionId)?.setMode(mode);
  }

  requestManualPhase(
    intersectionId: string,
    target: ManualSignalTarget,
  ): void {
    this.controllers.get(intersectionId)?.requestManualPhase(target);
  }

  getSignal(intersectionId: string): SignalSnapshot | undefined {
    return this.controllers.get(intersectionId)?.getSnapshot();
  }

  getSignals(): SignalSnapshot[] {
    return Array.from(this.controllers.values(), (controller) =>
      controller.getSnapshot(),
    );
  }

  getVehicles(): VehicleSnapshot[] {
    return this.vehicles.map((vehicle) => {
      const position = positionVehicle(vehicle, this.roadDesigns);
      return {
        id: vehicle.id,
        ...position,
        speedMetersPerSecond: vehicle.speed,
        queued: vehicle.queued,
        kind: vehicle.kind,
        color: vehicle.color,
        complianceProbability: vehicle.complianceProbability,
        violating: this.elapsedSeconds < vehicle.violatingUntilSeconds,
      };
    });
  }

  getPedestrians(): PedestrianSnapshot[] {
    return this.pedestrians.map((pedestrian) => {
      const position = positionPedestrian(pedestrian);
      return {
        id: pedestrian.id,
        ...position,
        waiting: pedestrian.waiting,
        color: pedestrian.color,
        variant: pedestrian.variant,
        complianceProbability: pedestrian.complianceProbability,
        violating: this.elapsedSeconds < pedestrian.violatingUntilSeconds,
      };
    });
  }

  getMetrics(): SimulationMetrics {
    const queuedVehicles = this.vehicles.filter((vehicle) => vehicle.queued).length;
    const movingVehicles = this.vehicles.filter((vehicle) => vehicle.speed > 0.25);
    const averageSpeedMetersPerSecond =
      movingVehicles.length === 0
        ? 0
        : movingVehicles.reduce((sum, vehicle) => sum + vehicle.speed, 0) /
          movingVehicles.length;
    const activeVehicleTravel = this.vehicles.reduce(
      (sum, vehicle) => sum + (this.elapsedSeconds - vehicle.spawnedAt),
      0,
    );
    const vehicleSampleCount =
      this.completedVehicleTrips + this.vehicles.length;
    const activePedestrianWait = this.pedestrians.reduce(
      (sum, pedestrian) => sum + pedestrian.waitSeconds,
      0,
    );
    const pedestrianSampleCount =
      this.completedPedestrianTrips + this.pedestrians.length;
    const completedPeople =
      this.completedVehicleTrips * 1.4 + this.completedPedestrianTrips;
    const throughputPerHour =
      this.elapsedSeconds <= 0
        ? 0
        : Math.round((completedPeople / this.elapsedSeconds) * 3_600);
    return {
      vehicleTravelSeconds: roundOne(
        vehicleSampleCount === 0
          ? 0
          : (this.completedVehicleTravelSeconds + activeVehicleTravel) /
              vehicleSampleCount,
      ),
      averageSpeedMph: roundOne(averageSpeedMetersPerSecond * 2.23694),
      congestion: queuedVehicles,
      intersectionDelaySeconds: roundOne(
        vehicleSampleCount === 0
          ? 0
          : (this.completedVehicleDelaySeconds +
              this.vehicles.reduce(
                (sum, vehicle) => sum + vehicle.delaySeconds,
                0,
              )) /
              vehicleSampleCount,
      ),
      pedestrianWaitSeconds: roundOne(
        pedestrianSampleCount === 0
          ? 0
          : (this.completedPedestrianWaitSeconds + activePedestrianWait) /
              pedestrianSampleCount,
      ),
      potentialConflicts: 0,
      throughputPerHour,
      activeVehicles: this.vehicles.length,
      activePedestrians: this.pedestrians.length,
      crossingsCompleted: this.crossingsCompleted,
      buildingArrivals: this.buildingArrivals,
      trafficViolations: this.trafficViolations,
      jaywalkingViolations: this.jaywalkingViolations,
    };
  }

  private updateVehicleSpawner(
    deltaSeconds: number,
    demand: number,
    speedLimitMph: number,
    violationRiskMultiplier: number,
  ): void {
    this.nextVehicleSpawnSeconds -= deltaSeconds;
    const target = Math.round(interpolateDemand(VEHICLE_TARGETS, demand));
    while (this.nextVehicleSpawnSeconds <= 0 && this.vehicles.length < target) {
      const route = this.createVehicleRoute();
      const lanePreference = this.random.next() < 0.5 ? 0 : 1;
      if (this.canSpawnVehicle(route.path, lanePreference)) {
        const kind = route.freight ? "truck" : this.random.pick(VEHICLE_KINDS);
        const complianceProbability = sampleComplianceProbability(
          this.random.next(),
        );
        const effectiveCompliance = complianceAdjustedForTime(
          complianceProbability,
          violationRiskMultiplier,
        );
        const speedFactor = driverSpeedFactor(
          effectiveCompliance,
          this.random.next(),
          this.random.next(),
        );
        const desiredSpeed = speedLimitMph * 0.44704 * speedFactor;
        const speeding = speedFactor > 1;
        if (speeding) this.trafficViolations += 1;
        this.vehicles.push({
          id: this.nextVehicleId,
          path: route.path,
          segmentIndex: 0,
          distanceOnSegment: 0,
          speed: 0,
          desiredSpeed,
          queued: false,
          kind,
          color: this.random.pick(VEHICLE_COLORS),
          length: vehicleLength(kind),
          spawnedAt: this.elapsedSeconds,
          delaySeconds: 0,
          lanePreference,
          complianceProbability,
          aggressiveYellow: this.random.next() > effectiveCompliance,
          mayRunRed:
            this.random.next() <
            redSignalViolationProbability(
              complianceProbability,
              violationRiskMultiplier,
            ),
          violationIntersectionId: null,
          violatingUntilSeconds: speeding ? this.elapsedSeconds + 3 : 0,
        });
        this.nextVehicleId += 1;
      }
      this.nextVehicleSpawnSeconds += randomArrival(
        this.random,
        interpolateDemand(VEHICLE_SPAWN_RATES, demand),
      );
    }
    if (this.nextVehicleSpawnSeconds <= 0) {
      this.nextVehicleSpawnSeconds = randomArrival(
        this.random,
        interpolateDemand(VEHICLE_SPAWN_RATES, demand),
      );
    }
  }

  private updatePedestrianSpawner(
    deltaSeconds: number,
    demand: number,
    violationRiskMultiplier: number,
  ): void {
    this.nextPedestrianSpawnSeconds -= deltaSeconds;
    const target = Math.round(interpolateDemand(PEDESTRIAN_TARGETS, demand));
    while (
      this.nextPedestrianSpawnSeconds <= 0 &&
      this.pedestrians.length < target
    ) {
      const route = this.createPedestrianRoute();
      if (this.canSpawnPedestrian(route)) {
        const complianceProbability = sampleComplianceProbability(
          this.random.next(),
        );
        this.pedestrians.push({
          id: this.nextPedestrianId,
          path: route,
          segmentIndex: 0,
          distanceOnSegment: 0,
          speed: 0,
          desiredSpeed: 1.2 + this.random.next() * 0.45,
          waiting: false,
          color: this.random.pick(PEDESTRIAN_COLORS),
          variant: this.random.integer(4),
          side: this.random.next() < 0.5 ? -1 : 1,
          spawnedAt: this.elapsedSeconds,
          waitSeconds: 0,
          committedIntersectionId: null,
          complianceProbability,
          mayCrossAgainstSignal:
            this.random.next() <
            pedestrianSignalViolationProbability(
              complianceProbability,
              violationRiskMultiplier,
            ),
          signalViolationUsed: false,
          violatingUntilSeconds: 0,
        });
        this.nextPedestrianId += 1;
      }
      this.nextPedestrianSpawnSeconds += randomArrival(
        this.random,
        interpolateDemand(PEDESTRIAN_SPAWN_RATES, demand),
      );
    }
    if (this.nextPedestrianSpawnSeconds <= 0) {
      this.nextPedestrianSpawnSeconds = randomArrival(
        this.random,
        interpolateDemand(PEDESTRIAN_SPAWN_RATES, demand),
      );
    }
  }

  private updateVehicles(deltaSeconds: number): void {
    const buckets = new Map<string, VehicleAgent[]>();
    for (const vehicle of this.vehicles) {
      const key = vehicleSegmentKey(vehicle, this.roadDesigns);
      const bucket = buckets.get(key) ?? [];
      bucket.push(vehicle);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => b.distanceOnSegment - a.distanceOnSegment);
      for (let index = 0; index < bucket.length; index += 1) {
        const vehicle = bucket[index];
        const leader = bucket[index - 1];
        this.advanceVehicle(vehicle, leader, buckets, deltaSeconds);
      }
    }
    this.vehicles = this.vehicles.filter((vehicle) => {
      if (vehicle.segmentIndex < vehicle.path.length - 1) return true;
      this.completedVehicleTrips += 1;
      this.completedVehicleTravelSeconds +=
        this.elapsedSeconds - vehicle.spawnedAt;
      this.completedVehicleDelaySeconds += vehicle.delaySeconds;
      return false;
    });
  }

  private advanceVehicle(
    vehicle: VehicleAgent,
    leader: VehicleAgent | undefined,
    buckets: ReadonlyMap<string, readonly VehicleAgent[]>,
    deltaSeconds: number,
  ): void {
    const start = vehicle.path[vehicle.segmentIndex];
    const end = vehicle.path[vehicle.segmentIndex + 1];
    if (!start || !end) return;
    const segmentLength = distance(start, end);
    const remaining = segmentLength - vehicle.distanceOnSegment;
    let targetSpeed = vehicle.desiredSpeed;
    if (leader) {
      const gap =
        leader.distanceOnSegment -
        vehicle.distanceOnSegment -
        leader.length -
        2.8;
      if (gap < 18) targetSpeed = Math.min(targetSpeed, Math.max(0, gap * 0.55));
    }
    const finalNode = vehicle.segmentIndex + 1 === vehicle.path.length - 1;
    if (!finalNode && remaining < 34) {
      const controller = this.controllers.get(end.id);
      const signal = controller?.getSnapshot();
      const axis = Math.abs(end.x - start.x) > Math.abs(end.z - start.z) ? "x" : "z";
      const legalCanProceed =
        signal !== undefined &&
        vehicleMayProceed(signal.phase, axis, remaining, vehicle.speed);
      const behaviorCanProceed =
        signal !== undefined &&
        vehicleMayProceedWithBehavior(
          signal.phase,
          axis,
          remaining,
          vehicle.speed,
          vehicle.aggressiveYellow,
          vehicle.mayRunRed,
        );
      const pedestrianInCrossing = this.intersectionHasCrossingPedestrian(end.id);
      const canProceed = behaviorCanProceed && !pedestrianInCrossing;
      if (
        canProceed &&
        !legalCanProceed &&
        vehicle.violationIntersectionId !== end.id
      ) {
        vehicle.violationIntersectionId = end.id;
        this.trafficViolations += 1;
        vehicle.violatingUntilSeconds = this.elapsedSeconds + 3;
      }
      const nextKey = nextVehicleSegmentKey(vehicle, this.roadDesigns);
      const downstreamBlocked =
        nextKey !== null &&
        (buckets.get(nextKey) ?? []).some(
          (candidate) => candidate.distanceOnSegment < 14,
        );
      if (!canProceed || downstreamBlocked) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (remaining - 6) * 0.7));
      } else {
        targetSpeed = Math.min(
          targetSpeed,
          safeIntersectionApproachSpeed(targetSpeed, remaining),
        );
      }
    }
    const acceleration = targetSpeed > vehicle.speed ? 2.2 : 4.8;
    vehicle.speed = moveToward(
      vehicle.speed,
      targetSpeed,
      acceleration * deltaSeconds,
    );
    vehicle.queued = vehicle.speed < 0.25 && targetSpeed < 0.5;
    if (vehicle.queued) vehicle.delaySeconds += deltaSeconds;
    let travel = vehicle.speed * deltaSeconds;
    while (travel > 0 && vehicle.segmentIndex < vehicle.path.length - 1) {
      const segmentStart = vehicle.path[vehicle.segmentIndex];
      const segmentEnd = vehicle.path[vehicle.segmentIndex + 1];
      const available =
        distance(segmentStart, segmentEnd) - vehicle.distanceOnSegment;
      if (travel < available) {
        vehicle.distanceOnSegment += travel;
        break;
      }
      travel -= available;
      vehicle.segmentIndex += 1;
      vehicle.distanceOnSegment = 0;
    }
  }

  private updatePedestrians(deltaSeconds: number): void {
    const buckets = new Map<string, PedestrianAgent[]>();
    for (const pedestrian of this.pedestrians) {
      const key = pedestrianSegmentKey(pedestrian);
      const bucket = buckets.get(key) ?? [];
      bucket.push(pedestrian);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => b.distanceOnSegment - a.distanceOnSegment);
      for (let index = 0; index < bucket.length; index += 1) {
        this.advancePedestrian(
          bucket[index],
          bucket[index - 1],
          deltaSeconds,
        );
      }
    }
    this.pedestrians = this.pedestrians.filter((pedestrian) => {
      if (pedestrian.segmentIndex < pedestrian.path.length - 1) return true;
      this.completedPedestrianTrips += 1;
      this.completedPedestrianTravelSeconds +=
        this.elapsedSeconds - pedestrian.spawnedAt;
      this.completedPedestrianWaitSeconds += pedestrian.waitSeconds;
      if (pedestrian.path.at(-1)?.id.endsWith(":entrance")) {
        this.buildingArrivals += 1;
      }
      return false;
    });
  }

  private advancePedestrian(
    pedestrian: PedestrianAgent,
    leader: PedestrianAgent | undefined,
    deltaSeconds: number,
  ): void {
    const start = pedestrian.path[pedestrian.segmentIndex];
    const end = pedestrian.path[pedestrian.segmentIndex + 1];
    if (!start || !end) return;
    const remaining = distance(start, end) - pedestrian.distanceOnSegment;
    const finalNode =
      pedestrian.segmentIndex + 1 === pedestrian.path.length - 1;
    let targetSpeed = pedestrian.desiredSpeed;
    if (leader) {
      const gap =
        leader.distanceOnSegment - pedestrian.distanceOnSegment - 0.7;
      if (gap < 1.5) targetSpeed = Math.min(targetSpeed, Math.max(0, gap));
    }
    if (!finalNode && remaining < 11) {
      const controller = this.controllers.get(end.id);
      const signal = controller?.getSnapshot();
      if (
        controller &&
        pedestrian.committedIntersectionId === null &&
        signal?.phase === "pedestrian-walk"
      ) {
        pedestrian.committedIntersectionId = end.id;
      }
      if (
        controller &&
        pedestrian.committedIntersectionId === null &&
        !pedestrian.signalViolationUsed &&
        pedestrian.mayCrossAgainstSignal &&
        signal?.phase !== "pedestrian-walk"
      ) {
        pedestrian.committedIntersectionId = end.id;
        pedestrian.signalViolationUsed = true;
        this.trafficViolations += 1;
        this.jaywalkingViolations += 1;
        pedestrian.violatingUntilSeconds = this.elapsedSeconds + 3;
      }
      if (
        controller &&
        pedestrian.committedIntersectionId !== end.id &&
        signal?.phase !== "pedestrian-walk"
      ) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (remaining - 3.2) * 0.8));
      }
    }
    pedestrian.speed = moveToward(
      pedestrian.speed,
      targetSpeed,
      (targetSpeed > pedestrian.speed ? 1.4 : 3.2) * deltaSeconds,
    );
    pedestrian.waiting = pedestrian.speed < 0.08 && targetSpeed < 0.1;
    if (pedestrian.waiting) pedestrian.waitSeconds += deltaSeconds;
    let travel = pedestrian.speed * deltaSeconds;
    while (travel > 0 && pedestrian.segmentIndex < pedestrian.path.length - 1) {
      const segmentStart = pedestrian.path[pedestrian.segmentIndex];
      const segmentEnd = pedestrian.path[pedestrian.segmentIndex + 1];
      const available =
        distance(segmentStart, segmentEnd) - pedestrian.distanceOnSegment;
      if (travel < available) {
        pedestrian.distanceOnSegment += travel;
        break;
      }
      travel -= available;
      if (pedestrian.committedIntersectionId === segmentEnd.id) {
        this.crossingsCompleted += 1;
        pedestrian.committedIntersectionId = null;
      }
      pedestrian.segmentIndex += 1;
      pedestrian.distanceOnSegment = 0;
    }
  }

  private createVehicleRoute(): VehicleRoute {
    if (this.buildingNodes.length > 0 && this.random.next() < 0.72) {
      const destination = this.pickBuildingNode([
        "commercial",
        "industrial",
        "civic",
        "residential",
      ]);
      const residentialOrigin = this.pickBuildingNode(["residential"]);
      const origin =
        residentialOrigin &&
        residentialOrigin.node.id !== destination?.node.id &&
        this.random.next() < 0.65
          ? residentialOrigin.node
          : this.randomBoundaryNode();
      if (
        destination &&
        origin.id !== destination.node.id &&
        manhattanDistance(origin, destination.node) >= 1
      ) {
        return {
          path: this.createLegalVehiclePath(origin, destination.node),
          freight: destination.kind === "industrial",
        };
      }
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const origin = this.randomBoundaryNode();
      const destination = this.randomBoundaryNode();
      if (
        origin.id !== destination.id &&
        manhattanDistance(origin, destination) >= 5
      ) {
        return {
          path: this.createLegalVehiclePath(origin, destination),
          freight: false,
        };
      }
    }
    return {
      path: this.createLegalVehiclePath(
        this.nodes[0][0],
        this.nodes[this.nodes.length - 1][this.nodes[0].length - 1],
      ),
      freight: false,
    };
  }

  private createPedestrianRoute(): readonly GridNode[] {
    if (this.buildingNodes.length > 0 && this.random.next() < 0.78) {
      const destination = this.pickBuildingNode([
        "commercial",
        "civic",
        "residential",
        "industrial",
      ]);
      const originBuilding = this.pickBuildingNode(["residential"]);
      const useOriginBuilding =
        originBuilding !== undefined &&
        originBuilding.node.id !== destination?.node.id;
      if (destination && !useOriginBuilding && this.random.next() < 0.55) {
        return [destination.curb, destination.entrance];
      }
      const originNode =
        useOriginBuilding && originBuilding
          ? originBuilding.node
          : this.randomNode();
      if (
        destination &&
        originNode.id !== destination.node.id &&
        manhattanDistance(originNode, destination.node) >= 1
      ) {
        const streetPath = createManhattanPath(
          this.nodes,
          originNode,
          destination.node,
          this.random.next() < 0.5,
        );
        return [
          ...(useOriginBuilding && originBuilding
            ? [originBuilding.entrance, originBuilding.curb]
            : []),
          ...streetPath,
          destination.curb,
          destination.entrance,
        ];
      }
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const origin = this.randomNode();
      const destination = this.randomNode();
      if (
        origin.id !== destination.id &&
        manhattanDistance(origin, destination) >= 4
      ) {
        return createManhattanPath(
          this.nodes,
          origin,
          destination,
          this.random.next() < 0.5,
        );
      }
    }
    return createManhattanPath(
      this.nodes,
      this.nodes[1][1],
      this.nodes[this.nodes.length - 2][this.nodes[0].length - 2],
      false,
    );
  }

  private randomBoundaryNode(): GridNode {
    const side = this.random.integer(4);
    if (side === 0) return this.nodes[0][this.random.integer(this.nodes[0].length)];
    if (side === 1) {
      return this.nodes[this.nodes.length - 1][
        this.random.integer(this.nodes[0].length)
      ];
    }
    if (side === 2) return this.nodes[this.random.integer(this.nodes.length)][0];
    return this.nodes[this.random.integer(this.nodes.length)][
      this.nodes[0].length - 1
    ];
  }

  private randomNode(): GridNode {
    return this.nodes[this.random.integer(this.nodes.length)][
      this.random.integer(this.nodes[0].length)
    ];
  }

  private nearestNode(x: number, z: number): GridNode {
    let nearest = this.nodes[0][0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.nodes.flat()) {
      const candidateDistance = Math.hypot(node.x - x, node.z - z);
      if (candidateDistance < nearestDistance) {
        nearest = node;
        nearestDistance = candidateDistance;
      }
    }
    return nearest;
  }

  private pickBuildingNode(
    preferredKinds: readonly PlacedBuilding["kind"][],
  ): BuildingNode | undefined {
    const preferred = this.buildingNodes.filter((building) =>
      preferredKinds.includes(building.kind),
    );
    const candidates = preferred.length > 0 ? preferred : this.buildingNodes;
    const totalWeight = candidates.reduce(
      (sum, building) => sum + building.weight,
      0,
    );
    let target = this.random.next() * totalWeight;
    for (const building of candidates) {
      target -= building.weight;
      if (target <= 0) return building;
    }
    return candidates[candidates.length - 1];
  }

  private canSpawnVehicle(
    route: readonly GridNode[],
    lanePreference: 0 | 1,
  ): boolean {
    const key = vehiclePathSegmentKey(
      route,
      0,
      lanePreference,
      this.roadDesigns,
    );
    return !this.vehicles.some(
      (vehicle) =>
        vehicleSegmentKey(vehicle, this.roadDesigns) === key &&
        vehicle.distanceOnSegment < 18,
    );
  }

  private intersectionHasCrossingPedestrian(intersectionId: string): boolean {
    return this.pedestrians.some(
      (pedestrian) => pedestrian.committedIntersectionId === intersectionId,
    );
  }

  private createLegalVehiclePath(
    origin: GridNode,
    destination: GridNode,
  ): GridNode[] {
    const preferred = createManhattanPath(
      this.nodes,
      origin,
      destination,
      this.random.next() < 0.5,
    );
    if (pathObeysLaneDirections(preferred, this.roadDesigns)) return preferred;
    return findLegalPath(this.nodes, origin, destination, this.roadDesigns) ?? preferred;
  }

  private canSpawnPedestrian(route: readonly GridNode[]): boolean {
    const key = `${route[0].id}>${route[1].id}`;
    return !this.pedestrians.some(
      (pedestrian) =>
        pedestrianSegmentKey(pedestrian) === key &&
        pedestrian.distanceOnSegment < 1.5,
    );
  }

  private scheduleNextSpawns(
    vehicleDemand: number,
    pedestrianDemand: number,
  ): void {
    this.nextVehicleSpawnSeconds = randomArrival(
      this.random,
      interpolateDemand(VEHICLE_SPAWN_RATES, vehicleDemand),
    );
    this.nextPedestrianSpawnSeconds = randomArrival(
      this.random,
      interpolateDemand(PEDESTRIAN_SPAWN_RATES, pedestrianDemand),
    );
  }
}

function createGridNodes(): GridNode[][] {
  return PENN_AVENUES.map((avenue, column) =>
    PENN_STREETS.map((street, row) => ({
      id: `${avenue.short}-${street.slug}`,
      column,
      row,
      x:
        (avenue.longitude - PENN_CENTER.longitude) *
        METERS_PER_DEGREE_LONGITUDE,
      z:
        -(street.latitude - PENN_CENTER.latitude) *
        METERS_PER_DEGREE_LATITUDE,
    })),
  );
}

function createManhattanPath(
  nodes: readonly (readonly GridNode[])[],
  origin: GridNode,
  destination: GridNode,
  horizontalFirst: boolean,
): GridNode[] {
  const path = [origin];
  let column = origin.column;
  let row = origin.row;
  const moveColumns = (): void => {
    while (column !== destination.column) {
      column += Math.sign(destination.column - column);
      path.push(nodes[column][row]);
    }
  };
  const moveRows = (): void => {
    while (row !== destination.row) {
      row += Math.sign(destination.row - row);
      path.push(nodes[column][row]);
    }
  };
  if (horizontalFirst) {
    moveColumns();
    moveRows();
  } else {
    moveRows();
    moveColumns();
  }
  return path;
}

function sanitizeTiming(timing: Readonly<SignalTiming>): SignalTiming {
  return {
    northSouthGreenSeconds: clamp(timing.northSouthGreenSeconds, 10, 120),
    eastWestGreenSeconds: clamp(timing.eastWestGreenSeconds, 10, 120),
    yellowSeconds: clamp(timing.yellowSeconds, 2, 8),
    allRedSeconds: clamp(timing.allRedSeconds, 0.5, 5),
    pedestrianSeconds: clamp(timing.pedestrianSeconds, 21, 60),
  };
}

function manualTransition(
  current: SignalPhase,
  target: ManualSignalTarget,
): SignalPhase[] {
  if (current === target) return [];
  if (target === "all-red") {
    if (current === "ns-green") return ["ns-yellow", "all-red"];
    if (current === "ew-green") return ["ew-yellow", "all-red"];
    if (current === "ns-yellow" || current === "ew-yellow") {
      return [current, "all-red"];
    }
    return ["all-red"];
  }
  if (current === "ns-green") {
    return target === "ew-green"
      ? ["ns-yellow", "all-red", "ew-green"]
      : [];
  }
  if (current === "ew-green") {
    return target === "ns-green"
      ? ["ew-yellow", "all-red", "ns-green"]
      : [];
  }
  if (current === "ns-yellow" || current === "ew-yellow") {
    return [current, "all-red", target];
  }
  if (current === "all-red") return ["all-red", target];
  return ["all-red", target];
}

function phaseDuration(
  phase: SignalPhase,
  timing: Readonly<SignalTiming>,
): number {
  if (phase === "ns-green") return timing.northSouthGreenSeconds;
  if (phase === "ew-green") return timing.eastWestGreenSeconds;
  if (phase === "ns-yellow" || phase === "ew-yellow") {
    return timing.yellowSeconds;
  }
  if (phase === "pedestrian-walk") return timing.pedestrianSeconds;
  return timing.allRedSeconds;
}

export function vehicleMayProceed(
  phase: SignalPhase,
  axis: "x" | "z",
  distanceToStopLine: number,
  speed: number,
): boolean {
  if (axis === "z" && phase === "ns-green") return true;
  if (axis === "x" && phase === "ew-green") return true;
  const matchingYellow =
    (axis === "z" && phase === "ns-yellow") ||
    (axis === "x" && phase === "ew-yellow");
  if (!matchingYellow) return false;
  const comfortableStopDistance = speed * speed / (2 * 3.8) + 2;
  return distanceToStopLine <= comfortableStopDistance;
}

export function vehicleMayProceedWithBehavior(
  phase: SignalPhase,
  axis: "x" | "z",
  distanceToStopLine: number,
  speed: number,
  aggressiveYellow: boolean,
  mayRunRed: boolean,
): boolean {
  if (vehicleMayProceed(phase, axis, distanceToStopLine, speed)) return true;
  const matchingYellow =
    (axis === "z" && phase === "ns-yellow") ||
    (axis === "x" && phase === "ew-yellow");
  if (matchingYellow && aggressiveYellow) {
    const comfortableStopDistance = speed * speed / (2 * 3.8) + 2;
    return distanceToStopLine <= comfortableStopDistance + 12;
  }
  const facingRedOnOpposingGreen =
    (axis === "z" && phase === "ew-green") ||
    (axis === "x" && phase === "ns-green");
  return facingRedOnOpposingGreen && mayRunRed;
}

export function sampleComplianceProbability(sample: number): number {
  const normalized = clamp(sample, 0, 1);
  return 0.7 + 0.3 * (1 - Math.pow(1 - normalized, 3));
}

export function complianceAdjustedForTime(
  complianceProbability: number,
  violationRiskMultiplier: number,
): number {
  const nonCompliance =
    (1 - clamp(complianceProbability, 0, 1)) *
    clamp(violationRiskMultiplier, 0.5, 2.5);
  return clamp(1 - nonCompliance, 0.45, 1);
}

export function pedestrianSignalViolationProbability(
  complianceProbability: number,
  violationRiskMultiplier: number,
): number {
  const baseProbability =
    0.03 + (1 - clamp(complianceProbability, 0, 1)) * 0.18;
  return clamp(baseProbability * violationRiskMultiplier, 0.03, 0.22);
}

export function redSignalViolationProbability(
  complianceProbability: number,
  violationRiskMultiplier: number,
): number {
  const baseProbability =
    0.001 + (1 - clamp(complianceProbability, 0, 1)) * 0.018;
  return clamp(baseProbability * violationRiskMultiplier, 0.001, 0.03);
}

export function driverSpeedFactor(
  complianceProbability: number,
  complianceDecision: number,
  magnitudeSample: number,
): number {
  const magnitude = clamp(magnitudeSample, 0, 1);
  if (complianceDecision > complianceProbability) {
    return 1.02 + magnitude * 0.16;
  }
  return 0.82 + magnitude * 0.16;
}

export function safeIntersectionApproachSpeed(
  desiredSpeed: number,
  distanceToIntersection: number,
): number {
  if (distanceToIntersection >= 30) return desiredSpeed;
  const urbanIntersectionCap = 20 * 0.44704;
  const approachFactor = clamp((distanceToIntersection - 6) / 24, 0.35, 1);
  return Math.min(desiredSpeed, urbanIntersectionCap * approachFactor);
}

function positionVehicle(
  vehicle: VehicleAgent,
  designs: ReadonlyMap<string, FeatureDesign>,
): PositionedAgent {
  const lane = vehicleLane(vehicle, vehicle.segmentIndex, designs);
  const lateralOffset = lane === 0 ? 5 : 1.8;
  return positionAlongPath(
    vehicle.path,
    vehicle.segmentIndex,
    vehicle.distanceOnSegment,
    roadLaneCount(vehicle.path, vehicle.segmentIndex, designs) > 1
      ? lateralOffset
      : 3.1,
  );
}

function positionPedestrian(pedestrian: PedestrianAgent): PositionedAgent {
  const start = pedestrian.path[pedestrian.segmentIndex];
  const end = pedestrian.path[pedestrian.segmentIndex + 1] ?? start;
  if (start.portal || end.portal) {
    return positionAlongPath(
      pedestrian.path,
      pedestrian.segmentIndex,
      pedestrian.distanceOnSegment,
      0,
    );
  }
  const majorRoad =
    start.row === end.row
      ? PENN_STREETS[start.row].name === "Market Street" ||
        PENN_STREETS[start.row].name === "South Street"
      : PENN_AVENUES[start.column].name === "38th Street" ||
        PENN_AVENUES[start.column].name === "40th Street";
  const sidewalkOffset = (majorRoad ? 22 : 15) / 2 + 3.65;
  return positionAlongPath(
    pedestrian.path,
    pedestrian.segmentIndex,
    pedestrian.distanceOnSegment,
    sidewalkOffset * pedestrian.side,
  );
}

function createBuildingEntrance(
  building: PlacedBuilding,
  nearestNode: GridNode,
): GridNode {
  const depth =
    building.kind === "industrial"
      ? 19
      : building.kind === "civic"
        ? 17
        : building.kind === "commercial"
          ? 15
          : 14;
  const distanceFromCenter = depth / 2 + 1.2;
  return {
    id: `${building.id}:entrance`,
    column: nearestNode.column,
    row: nearestNode.row,
    x: building.x + Math.sin(building.rotation) * distanceFromCenter,
    z: building.z + Math.cos(building.rotation) * distanceFromCenter,
    portal: true,
  };
}

function createBuildingCurb(
  buildingId: string,
  entrance: GridNode,
  nearestNode: GridNode,
): GridNode {
  const dx = entrance.x - nearestNode.x;
  const dz = entrance.z - nearestNode.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const sidewalkDistance = 11.2;
  return {
    id: `${buildingId}:curb`,
    column: nearestNode.column,
    row: nearestNode.row,
    x: nearestNode.x + (dx / length) * sidewalkDistance,
    z: nearestNode.z + (dz / length) * sidewalkDistance,
    portal: true,
  };
}

function positionAlongPath(
  path: readonly GridNode[],
  segmentIndex: number,
  distanceOnSegment: number,
  lateralOffset: number,
): PositionedAgent {
  const start = path[Math.min(segmentIndex, path.length - 1)];
  const end = path[Math.min(segmentIndex + 1, path.length - 1)] ?? start;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const progress = clamp(distanceOnSegment / length, 0, 1);
  const directionX = dx / length;
  const directionZ = dz / length;
  return {
    x: start.x + dx * progress - directionZ * lateralOffset,
    z: start.z + dz * progress + directionX * lateralOffset,
    heading: Math.atan2(directionX, directionZ),
  };
}

function vehicleSegmentKey(
  vehicle: VehicleAgent,
  designs: ReadonlyMap<string, FeatureDesign>,
): string {
  return vehiclePathSegmentKey(
    vehicle.path,
    vehicle.segmentIndex,
    vehicle.lanePreference,
    designs,
    vehicle.id,
  );
}

function nextVehicleSegmentKey(
  vehicle: VehicleAgent,
  designs: ReadonlyMap<string, FeatureDesign>,
): string | null {
  const nextIndex = vehicle.segmentIndex + 1;
  if (!vehicle.path[nextIndex + 1]) return null;
  return vehiclePathSegmentKey(
    vehicle.path,
    nextIndex,
    vehicle.lanePreference,
    designs,
    vehicle.id,
  );
}

function vehiclePathSegmentKey(
  path: readonly GridNode[],
  segmentIndex: number,
  lanePreference: 0 | 1,
  designs: ReadonlyMap<string, FeatureDesign>,
  vehicleId?: number,
): string {
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  if (!start || !end) return `complete-${vehicleId ?? "route"}`;
  const lane = laneForPath(path, segmentIndex, lanePreference, designs);
  return `${start.id}>${end.id}:lane-${lane}`;
}

function vehicleLane(
  vehicle: VehicleAgent,
  segmentIndex: number,
  designs: ReadonlyMap<string, FeatureDesign>,
): 0 | 1 {
  return laneForPath(
    vehicle.path,
    segmentIndex,
    vehicle.lanePreference,
    designs,
  );
}

function laneForPath(
  path: readonly GridNode[],
  segmentIndex: number,
  preference: 0 | 1,
  designs: ReadonlyMap<string, FeatureDesign>,
): 0 | 1 {
  if (roadLaneCount(path, segmentIndex, designs) === 1) return 0;
  const start = path[segmentIndex];
  const intersection = path[segmentIndex + 1];
  const after = path[segmentIndex + 2];
  if (!start || !intersection || !after) return preference;
  const incomingX = intersection.x - start.x;
  const incomingZ = intersection.z - start.z;
  const outgoingX = after.x - intersection.x;
  const outgoingZ = after.z - intersection.z;
  const turn = incomingX * outgoingZ - incomingZ * outgoingX;
  if (Math.abs(turn) < 0.001) return preference;
  return turn > 0 ? 0 : 1;
}

function roadLaneCount(
  path: readonly GridNode[],
  segmentIndex: number,
  designs: ReadonlyMap<string, FeatureDesign>,
): 1 | 2 {
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  if (!start || !end) return 1;
  return physicalLaneCount(
    designs.get(roadFeatureId(start, end))?.laneDelta ?? 0,
  );
}

export function physicalLaneCount(laneDelta: -1 | 0 | 1): 1 | 2 {
  return laneDelta === 1 ? 2 : 1;
}

function roadFeatureId(start: GridNode, end: GridNode): string {
  if (start.row === end.row) {
    const street = PENN_STREETS[start.row];
    const lower = Math.min(start.column, end.column);
    const upper = Math.max(start.column, end.column);
    return `${street.slug}-${PENN_AVENUES[lower].short}-${PENN_AVENUES[upper].short}`;
  }
  const avenue = PENN_AVENUES[start.column];
  const lower = Math.min(start.row, end.row);
  const upper = Math.max(start.row, end.row);
  return `${avenue.short}-${PENN_STREETS[lower].slug}-${PENN_STREETS[upper].slug}`;
}

function pathObeysLaneDirections(
  path: readonly GridNode[],
  designs: ReadonlyMap<string, FeatureDesign>,
): boolean {
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!segmentDirectionAllowed(path[index], path[index + 1], designs)) {
      return false;
    }
  }
  return true;
}

function segmentDirectionAllowed(
  start: GridNode,
  end: GridNode,
  designs: ReadonlyMap<string, FeatureDesign>,
): boolean {
  const direction = designs.get(roadFeatureId(start, end))?.laneDirection ?? "two-way";
  const forward = end.column > start.column || end.row > start.row;
  return laneDirectionAllowsMovement(direction, forward);
}

export function laneDirectionAllowsMovement(
  direction: FeatureDesign["laneDirection"],
  forward: boolean,
): boolean {
  if (direction === "two-way") return true;
  return direction === "forward" ? forward : !forward;
}

function findLegalPath(
  nodes: readonly (readonly GridNode[])[],
  origin: GridNode,
  destination: GridNode,
  designs: ReadonlyMap<string, FeatureDesign>,
): GridNode[] | null {
  const queue: GridNode[] = [origin];
  const previous = new Map<string, GridNode | null>([[origin.id, null]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.id === destination.id) break;
    const neighbors = [
      nodes[current.column - 1]?.[current.row],
      nodes[current.column + 1]?.[current.row],
      nodes[current.column]?.[current.row - 1],
      nodes[current.column]?.[current.row + 1],
    ].filter((candidate): candidate is GridNode => candidate !== undefined);
    for (const neighbor of neighbors) {
      if (
        previous.has(neighbor.id) ||
        !segmentDirectionAllowed(current, neighbor, designs)
      ) {
        continue;
      }
      previous.set(neighbor.id, current);
      queue.push(neighbor);
    }
  }
  if (!previous.has(destination.id)) return null;
  const path: GridNode[] = [];
  let current: GridNode | null = destination;
  while (current) {
    path.push(current);
    current = previous.get(current.id) ?? null;
  }
  return path.reverse();
}

function pedestrianSegmentKey(pedestrian: PedestrianAgent): string {
  const start = pedestrian.path[pedestrian.segmentIndex];
  const end = pedestrian.path[pedestrian.segmentIndex + 1];
  return start && end ? `${start.id}>${end.id}` : `complete-${pedestrian.id}`;
}

function vehicleLength(kind: VehicleKind): number {
  if (kind === "compact") return 3.7;
  if (kind === "suv") return 4.8;
  if (kind === "van") return 5.4;
  if (kind === "bus") return 9.8;
  if (kind === "truck") return 7.2;
  return 4.4;
}

function manhattanDistance(a: GridNode, b: GridNode): number {
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

function distance(a: GridNode, b: GridNode): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function randomArrival(random: RandomSource, ratePerSecond: number): number {
  if (ratePerSecond <= 0) return Number.POSITIVE_INFINITY;
  return -Math.log(Math.max(1e-9, 1 - random.next())) / ratePerSecond;
}

function interpolateDemand(values: readonly number[], demand: number): number {
  const sanitized = clamp(demand, 0, 3);
  const lower = Math.floor(sanitized);
  const upper = Math.ceil(sanitized);
  const progress = sanitized - lower;
  return values[lower] + (values[upper] - values[lower]) * progress;
}

function moveToward(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(target, current + maximumDelta);
  return Math.max(target, current - maximumDelta);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

class RandomSource {
  private value: number;

  constructor(seed: number) {
    this.value = Math.trunc(seed) >>> 0;
  }

  next(): number {
    this.value = (this.value * 1_664_525 + 1_013_904_223) >>> 0;
    return this.value / 4_294_967_296;
  }

  integer(maximum: number): number {
    return Math.floor(this.next() * maximum);
  }

  pick<T>(values: readonly T[]): T {
    return values[this.integer(values.length)];
  }
}
