import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_LANDMARKS,
  PENN_ROAD_GRAPH,
  PENN_STREETS,
} from "../data/pennRoadGraph";
import {
  chooseLane,
  createRoadSegmentModel,
  ROAD_SEGMENT_BY_ID,
  segmentIdBetween,
  travelDirectionBetween,
} from "../data/roadLanes";
import type {
  LaneModelOverrides,
  LaneMovement,
  LaneTravelDirection,
  RoadLane,
  RoadSegmentModel,
} from "../data/roadLanes";
import type {
  ManualSignalTarget,
  PedestrianSnapshot,
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
const VEHICLE_TARGETS = [0, 110, 260, 560] as const;
const PEDESTRIAN_TARGETS = [0, 150, 360, 750] as const;
const VEHICLE_SPAWN_RATES = [0, 5, 14, 28] as const;
const PEDESTRIAN_SPAWN_RATES = [0, 8, 22, 45] as const;
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
  pedestrianSeconds: 15,
};

interface GridNode {
  id: string;
  column: number;
  row: number;
  x: number;
  z: number;
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
  lane: RoadLane;
  segmentId: string;
  spawnedAt: number;
  delaySeconds: number;
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
  segmentId: string;
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
  private readonly pedestrianDestinations = PENN_LANDMARKS.map((landmark) =>
    nearestGridNode(this.nodes, landmark.longitude, landmark.latitude),
  );
  private readonly controllers = new Map<string, IntersectionSignalController>();
  private readonly roadSegments = new Map(ROAD_SEGMENT_BY_ID);
  private readonly routeCache = new Map<string, readonly GridNode[]>();
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
    >,
  ): void {
    if (deltaSeconds <= 0) return;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      const step = Math.min(0.1, remaining);
      this.elapsedSeconds += step;
      for (const controller of this.controllers.values()) controller.update(step);
      this.updateVehicleSpawner(step, settings.vehicleVolume, settings.speedLimitMph);
      this.updatePedestrianSpawner(step, settings.pedestrianVolume);
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

  setRoadDesign(
    segmentId: string,
    overrides: LaneModelOverrides,
  ): void {
    const feature = PENN_ROAD_GRAPH.find(
      (candidate) => candidate.id === segmentId && candidate.kind === "street",
    );
    if (!feature) return;
    const model = createRoadSegmentModel(feature, overrides);
    this.roadSegments.set(segmentId, model);
    this.routeCache.clear();
    this.reconcileVehicleRoutes();
  }

  setRoadDesigns(
    designs: ReadonlyMap<string, Readonly<LaneModelOverrides>>,
  ): void {
    this.roadSegments.clear();
    for (const [segmentId, base] of ROAD_SEGMENT_BY_ID) {
      const feature = PENN_ROAD_GRAPH.find(
        (candidate) => candidate.id === segmentId && candidate.kind === "street",
      );
      this.roadSegments.set(
        segmentId,
        feature
          ? createRoadSegmentModel(feature, designs.get(segmentId))
          : base,
      );
    }
    this.routeCache.clear();
    this.reconcileVehicleRoutes();
  }

  getRoadSegment(segmentId: string): RoadSegmentModel | undefined {
    return this.roadSegments.get(segmentId);
  }

  getCoverage(): {
    vehicleSegments: ReadonlySet<string>;
    pedestrianSegments: ReadonlySet<string>;
  } {
    return {
      vehicleSegments: new Set(this.vehicles.map((vehicle) => vehicle.segmentId)),
      pedestrianSegments: new Set(
        this.pedestrians.map((pedestrian) => pedestrian.segmentId),
      ),
    };
  }

  getVehicles(): VehicleSnapshot[] {
    return this.vehicles.map((vehicle) => {
      const position = positionVehicle(vehicle);
      return {
        id: vehicle.id,
        ...position,
        segmentId: vehicle.segmentId,
        laneId: vehicle.lane.id,
        speedMetersPerSecond: vehicle.speed,
        queued: vehicle.queued,
        kind: vehicle.kind,
        color: vehicle.color,
      };
    });
  }

  getPedestrians(): PedestrianSnapshot[] {
    return this.pedestrians.map((pedestrian) => {
      const position = positionPedestrian(pedestrian);
      return {
        id: pedestrian.id,
        ...position,
        segmentId: pedestrian.segmentId,
        waiting: pedestrian.waiting,
        color: pedestrian.color,
        variant: pedestrian.variant,
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
      potentialConflicts: this.countPotentialConflicts(),
      throughputPerHour,
      activeVehicles: this.vehicles.length,
      activePedestrians: this.pedestrians.length,
      crossingsCompleted: this.crossingsCompleted,
    };
  }

  private countPotentialConflicts(): number {
    const vehicleApproaches = new Set<string>();
    for (const vehicle of this.vehicles) {
      const start = vehicle.path[vehicle.segmentIndex];
      const end = vehicle.path[vehicle.segmentIndex + 1];
      if (
        start &&
        end &&
        distance(start, end) - vehicle.distanceOnSegment < 16 &&
        vehicle.speed > 0.5
      ) {
        vehicleApproaches.add(end.id);
      }
    }
    const pedestrianCrossings = new Set<string>();
    for (const pedestrian of this.pedestrians) {
      const start = pedestrian.path[pedestrian.segmentIndex];
      const end = pedestrian.path[pedestrian.segmentIndex + 1];
      if (
        start &&
        end &&
        distance(start, end) - pedestrian.distanceOnSegment < 7 &&
        pedestrian.speed > 0.2
      ) {
        pedestrianCrossings.add(end.id);
      }
    }
    let conflicts = 0;
    for (const intersectionId of vehicleApproaches) {
      if (pedestrianCrossings.has(intersectionId)) conflicts += 1;
    }
    return conflicts;
  }

  private updateVehicleSpawner(
    deltaSeconds: number,
    demand: number,
    speedLimitMph: number,
  ): void {
    const level = clampDemand(demand);
    this.nextVehicleSpawnSeconds -= deltaSeconds;
    const target = VEHICLE_TARGETS[level];
    while (this.nextVehicleSpawnSeconds <= 0 && this.vehicles.length < target) {
      const route = this.createVehicleRoute(level);
      const kind = this.random.pick(VEHICLE_KINDS);
      const assignment = this.laneForPath(route, 0, kind);
      if (assignment && this.canSpawnVehicle(assignment.lane.id)) {
        const desiredSpeed =
          Math.min(speedLimitMph, assignment.segment.speedLimitMph) *
          0.44704 *
          (0.82 + this.random.next() * 0.16);
        this.vehicles.push({
          id: this.nextVehicleId,
          path: route,
          segmentIndex: 0,
          distanceOnSegment: 0,
          speed: 0,
          desiredSpeed,
          queued: false,
          kind,
          color: this.random.pick(VEHICLE_COLORS),
          length: vehicleLength(kind),
          lane: assignment.lane,
          segmentId: assignment.segment.id,
          spawnedAt: this.elapsedSeconds,
          delaySeconds: 0,
        });
        this.nextVehicleId += 1;
      }
      this.nextVehicleSpawnSeconds += randomArrival(
        this.random,
        VEHICLE_SPAWN_RATES[level],
      );
    }
    if (this.nextVehicleSpawnSeconds <= 0) {
      this.nextVehicleSpawnSeconds = randomArrival(
        this.random,
        VEHICLE_SPAWN_RATES[level],
      );
    }
  }

  private reconcileVehicleRoutes(): void {
    this.vehicles = this.vehicles.filter((vehicle) => {
      const start = vehicle.path[vehicle.segmentIndex];
      const end = vehicle.path[vehicle.segmentIndex + 1];
      const destination = vehicle.path[vehicle.path.length - 1];
      if (!start || !end || !destination) return false;
      const segment = this.roadSegments.get(
        segmentIdBetween(start.column, start.row, end.column, end.row),
      );
      if (!segment) return false;
      const direction = travelDirectionBetween(
        start.column,
        start.row,
        end.column,
        end.row,
      );
      const continuation = this.findVehicleRoute(end, destination);
      if (!continuation) return false;
      const revisedPath = [start, ...continuation];
      const lane = chooseLane(
        segment,
        direction,
        movementAt(revisedPath, 1),
        vehicle.kind,
        this.random.next(),
      );
      if (!lane) return false;
      vehicle.path = revisedPath;
      vehicle.segmentIndex = 0;
      vehicle.segmentId = segment.id;
      vehicle.lane = lane;
      return true;
    });
  }

  private updatePedestrianSpawner(deltaSeconds: number, demand: number): void {
    const level = clampDemand(demand);
    this.nextPedestrianSpawnSeconds -= deltaSeconds;
    const target = PEDESTRIAN_TARGETS[level];
    while (
      this.nextPedestrianSpawnSeconds <= 0 &&
      this.pedestrians.length < target
    ) {
      const route = this.createPedestrianRoute(level);
      if (this.canSpawnPedestrian(route)) {
        const segmentId = segmentIdForPath(route, 0);
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
          segmentId,
        });
        this.nextPedestrianId += 1;
      }
      this.nextPedestrianSpawnSeconds += randomArrival(
        this.random,
        PEDESTRIAN_SPAWN_RATES[level],
      );
    }
    if (this.nextPedestrianSpawnSeconds <= 0) {
      this.nextPedestrianSpawnSeconds = randomArrival(
        this.random,
        PEDESTRIAN_SPAWN_RATES[level],
      );
    }
  }

  private updateVehicles(deltaSeconds: number): void {
    const buckets = new Map<string, VehicleAgent[]>();
    const directionBuckets = new Map<string, VehicleAgent[]>();
    for (const vehicle of this.vehicles) {
      const bucket = buckets.get(vehicleSegmentKey(vehicle)) ?? [];
      bucket.push(vehicle);
      buckets.set(vehicleSegmentKey(vehicle), bucket);
      const directionKey = vehicleSegmentDirectionKey(vehicle);
      const directionBucket = directionBuckets.get(directionKey) ?? [];
      directionBucket.push(vehicle);
      directionBuckets.set(directionKey, directionBucket);
    }
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => b.distanceOnSegment - a.distanceOnSegment);
      for (let index = 0; index < bucket.length; index += 1) {
        const vehicle = bucket[index];
        const leader = bucket[index - 1];
        this.advanceVehicle(
          vehicle,
          leader,
          directionBuckets,
          deltaSeconds,
        );
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
    directionBuckets: ReadonlyMap<string, readonly VehicleAgent[]>,
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
      const canProceed =
        signal !== undefined &&
        vehicleMayProceed(signal.phase, axis, remaining, vehicle.speed);
      const nextKey = nextVehicleSegmentDirectionKey(vehicle);
      const downstreamBlocked =
        nextKey !== null &&
        (directionBuckets.get(nextKey) ?? []).some(
          (candidate) => candidate.distanceOnSegment < 14,
        );
      if (!canProceed || downstreamBlocked) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (remaining - 6) * 0.7));
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
      if (vehicle.segmentIndex < vehicle.path.length - 1) {
        const assignment = this.laneForPath(
          vehicle.path,
          vehicle.segmentIndex,
          vehicle.kind,
        );
        if (assignment) {
          vehicle.segmentId = assignment.segment.id;
          vehicle.lane = assignment.lane;
          vehicle.desiredSpeed = Math.min(
            vehicle.desiredSpeed,
            assignment.segment.speedLimitMph * 0.44704,
          );
        }
      }
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
      const signal = this.controllers.get(end.id)?.getSnapshot();
      if (
        pedestrian.committedIntersectionId === null &&
        signal?.phase === "pedestrian-walk"
      ) {
        pedestrian.committedIntersectionId = end.id;
      }
      if (
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
      if (pedestrian.segmentIndex < pedestrian.path.length - 1) {
        pedestrian.segmentId = segmentIdForPath(
          pedestrian.path,
          pedestrian.segmentIndex,
        );
      }
    }
  }

  private createVehicleRoute(demandLevel: number): readonly GridNode[] {
    const corridorBias =
      demandLevel >= 3 ? 1.35 : demandLevel === 2 ? 1 : 0.72;
    const boundaryProbability =
      demandLevel >= 3 ? 0.76 : demandLevel === 2 ? 0.68 : 0.58;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const origin =
        this.random.next() < boundaryProbability
          ? this.randomBoundaryNode()
          : this.randomNode();
      const destination =
        this.random.next() < boundaryProbability
          ? this.randomBoundaryNode()
          : this.randomNode();
      if (
        origin.id === destination.id ||
        manhattanDistance(origin, destination) < 5
      ) {
        continue;
      }
      if (this.random.next() < (demandLevel >= 3 ? 0.58 : 0.42)) {
        const via = this.randomNode();
        const first = this.findVehicleRoute(origin, via, corridorBias);
        const second = this.findVehicleRoute(via, destination, corridorBias);
        if (first && second && first.length + second.length >= 7) {
          return [...first, ...second.slice(1)];
        }
      }
      const direct = this.findVehicleRoute(
        origin,
        destination,
        corridorBias,
      );
      if (direct && direct.length >= 6) return direct;
    }
    return (
      this.findVehicleRoute(
        this.nodes[0][0],
        this.nodes[this.nodes.length - 1][this.nodes[0].length - 1],
      ) ?? [
        this.nodes[0][0],
        this.nodes[1][0],
        this.nodes[1][1],
      ]
    );
  }

  private createPedestrianRoute(demandLevel: number): readonly GridNode[] {
    const destinationBias =
      demandLevel >= 3 ? 0.62 : demandLevel === 2 ? 0.44 : 0.28;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const origin =
        this.random.next() < 0.24
          ? this.randomBoundaryNode()
          : this.randomNode();
      const destination =
        this.random.next() < destinationBias
          ? this.random.pick(this.pedestrianDestinations)
          : this.randomNode();
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

  private canSpawnVehicle(laneId: string): boolean {
    return !this.vehicles.some(
      (vehicle) =>
        vehicle.lane.id === laneId && vehicle.distanceOnSegment < 18,
    );
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
      VEHICLE_SPAWN_RATES[clampDemand(vehicleDemand)],
    );
    this.nextPedestrianSpawnSeconds = randomArrival(
      this.random,
      PEDESTRIAN_SPAWN_RATES[clampDemand(pedestrianDemand)],
    );
  }

  private laneForPath(
    path: readonly GridNode[],
    segmentIndex: number,
    kind: VehicleKind,
  ): { segment: RoadSegmentModel; lane: RoadLane } | undefined {
    const start = path[segmentIndex];
    const end = path[segmentIndex + 1];
    if (!start || !end) return undefined;
    const segmentId = segmentIdBetween(
      start.column,
      start.row,
      end.column,
      end.row,
    );
    const segment = this.roadSegments.get(segmentId);
    if (!segment) return undefined;
    const movement = movementAt(path, segmentIndex + 1);
    const direction = travelDirectionBetween(
      start.column,
      start.row,
      end.column,
      end.row,
    );
    const selected = chooseLane(
      segment,
      direction,
      movement,
      kind,
      this.random.next(),
    );
    return selected ? { segment, lane: selected } : undefined;
  }

  private findVehicleRoute(
    origin: GridNode,
    destination: GridNode,
    corridorBias = 1,
  ): readonly GridNode[] | null {
    const cacheKey = `${origin.id}>${destination.id}:${corridorBias.toFixed(2)}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;
    const open = new Set<GridNode>([origin]);
    const previous = new Map<GridNode, GridNode>();
    const cost = new Map<GridNode, number>([[origin, 0]]);
    const estimate = new Map<GridNode, number>([
      [origin, manhattanDistance(origin, destination)],
    ]);
    while (open.size > 0) {
      let current: GridNode | null = null;
      let currentEstimate = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        const value = estimate.get(candidate) ?? Number.POSITIVE_INFINITY;
        if (value < currentEstimate) {
          current = candidate;
          currentEstimate = value;
        }
      }
      if (!current) break;
      if (current === destination) {
        const path = [current];
        while (previous.has(current)) {
          current = previous.get(current) as GridNode;
          path.push(current);
        }
        path.reverse();
        this.routeCache.set(cacheKey, path);
        return path;
      }
      open.delete(current);
      for (const neighbor of adjacentNodes(this.nodes, current)) {
        const segmentId = segmentIdBetween(
          current.column,
          current.row,
          neighbor.column,
          neighbor.row,
        );
        const segment = this.roadSegments.get(segmentId);
        if (!segment) continue;
        const direction = travelDirectionBetween(
          current.column,
          current.row,
          neighbor.column,
          neighbor.row,
        );
        if (
          !segment.lanes.some(
            (lane) =>
              (lane.type === "general" ||
                lane.type === "turn" ||
                lane.type === "bus") &&
              lane.direction === direction,
          )
        ) {
          continue;
        }
        const edgeCost =
          distance(current, neighbor) /
          Math.max(
            0.75,
            Math.pow(segment.demandWeight, corridorBias / 2),
          );
        const tentative = (cost.get(current) ?? 0) + edgeCost;
        if (tentative >= (cost.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }
        previous.set(neighbor, current);
        cost.set(neighbor, tentative);
        estimate.set(
          neighbor,
          tentative + manhattanDistance(neighbor, destination) * 45,
        );
        open.add(neighbor);
      }
    }
    return null;
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

function nearestGridNode(
  nodes: readonly (readonly GridNode[])[],
  longitude: number,
  latitude: number,
): GridNode {
  const x =
    (longitude - PENN_CENTER.longitude) * METERS_PER_DEGREE_LONGITUDE;
  const z =
    -(latitude - PENN_CENTER.latitude) * METERS_PER_DEGREE_LATITUDE;
  let nearest = nodes[0][0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const column of nodes) {
    for (const node of column) {
      const candidateDistance = Math.hypot(node.x - x, node.z - z);
      if (candidateDistance < nearestDistance) {
        nearest = node;
        nearestDistance = candidateDistance;
      }
    }
  }
  return nearest;
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
    pedestrianSeconds: clamp(timing.pedestrianSeconds, 5, 60),
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

function vehicleMayProceed(
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

function positionVehicle(vehicle: VehicleAgent): PositionedAgent {
  const direction = directionForVehicle(vehicle);
  return positionAlongPath(
    vehicle.path,
    vehicle.segmentIndex,
    vehicle.distanceOnSegment,
    direction === "forward"
      ? vehicle.lane.offsetMeters
      : -vehicle.lane.offsetMeters,
  );
}

function positionPedestrian(pedestrian: PedestrianAgent): PositionedAgent {
  const start = pedestrian.path[pedestrian.segmentIndex];
  const end = pedestrian.path[pedestrian.segmentIndex + 1] ?? start;
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

function vehicleSegmentKey(vehicle: VehicleAgent): string {
  return vehicle.lane.id;
}

function vehicleSegmentDirectionKey(vehicle: VehicleAgent): string {
  return `${vehicle.segmentId}:${directionForVehicle(vehicle)}`;
}

function nextVehicleSegmentDirectionKey(
  vehicle: VehicleAgent,
): string | null {
  const start = vehicle.path[vehicle.segmentIndex + 1];
  const end = vehicle.path[vehicle.segmentIndex + 2];
  if (!start || !end) return null;
  return `${segmentIdBetween(start.column, start.row, end.column, end.row)}:${travelDirectionBetween(start.column, start.row, end.column, end.row)}`;
}

function pedestrianSegmentKey(pedestrian: PedestrianAgent): string {
  const start = pedestrian.path[pedestrian.segmentIndex];
  const end = pedestrian.path[pedestrian.segmentIndex + 1];
  return start && end ? `${start.id}>${end.id}` : `complete-${pedestrian.id}`;
}

function segmentIdForPath(
  path: readonly GridNode[],
  segmentIndex: number,
): string {
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  if (!start || !end) return "complete";
  return segmentIdBetween(start.column, start.row, end.column, end.row);
}

function directionForVehicle(vehicle: VehicleAgent): LaneTravelDirection {
  const start = vehicle.path[vehicle.segmentIndex];
  const end = vehicle.path[vehicle.segmentIndex + 1];
  if (!start || !end) return vehicle.lane.direction;
  return travelDirectionBetween(
    start.column,
    start.row,
    end.column,
    end.row,
  );
}

function movementAt(
  path: readonly GridNode[],
  intersectionIndex: number,
): LaneMovement {
  const previous = path[intersectionIndex - 1];
  const current = path[intersectionIndex];
  const next = path[intersectionIndex + 1];
  if (!previous || !current || !next) return "straight";
  const incomingX = current.column - previous.column;
  const incomingZ = current.row - previous.row;
  const outgoingX = next.column - current.column;
  const outgoingZ = next.row - current.row;
  const cross = incomingX * outgoingZ - incomingZ * outgoingX;
  if (cross === 0) return "straight";
  return cross > 0 ? "right" : "left";
}

function adjacentNodes(
  nodes: readonly (readonly GridNode[])[],
  node: GridNode,
): GridNode[] {
  const candidates = [
    nodes[node.column - 1]?.[node.row],
    nodes[node.column + 1]?.[node.row],
    nodes[node.column]?.[node.row - 1],
    nodes[node.column]?.[node.row + 1],
  ];
  return candidates.filter((candidate): candidate is GridNode =>
    Boolean(candidate),
  );
}

function vehicleLength(kind: VehicleKind): number {
  if (kind === "compact") return 3.7;
  if (kind === "suv") return 4.8;
  if (kind === "van") return 5.4;
  if (kind === "bus") return 9.8;
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

function clampDemand(value: number): 1 | 2 | 3 {
  return Math.round(clamp(value, 1, 3)) as 1 | 2 | 3;
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
