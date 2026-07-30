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
  BuildingKind,
  ManualSignalTarget,
  LaneDirection,
  ExpansionRoad,
  ExpansionStreetObject,
  PedestrianSignalState,
  PedestrianSnapshot,
  RoadTrafficSnapshot,
  ScenarioSettings,
  SignalControlMode,
  SignalPhase,
  SignalSnapshot,
  SignalTiming,
  SimulationMetrics,
  VehicleKind,
  VehicleSnapshot,
} from "../models/types";
import type { TravelMode } from "../models/entityTypes";
import { expansionRoadDisplayName } from "./expansionRoadNaming";
import { vehicleLengthMeters } from "./vehicleDimensions";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const VEHICLE_TARGETS = [0, 110, 260, 560] as const;
const PEDESTRIAN_TARGETS = [0, 150, 360, 750] as const;
const VEHICLE_SPAWN_RATES = [0, 5, 14, 28] as const;
const PEDESTRIAN_SPAWN_RATES = [0, 8, 22, 45] as const;
const SAMPLED_PEDESTRIAN_STOP_DISTANCE_METERS = 9;
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
const VIOLATION_FLASH_SECONDS = 2;
const INTERSECTION_STOP_LINE_DISTANCE_METERS = 14;
const INTERSECTION_CLEARANCE_SECONDS = 2;
const VEHICLE_KINDS: readonly VehicleKind[] = [
  "sedan",
  "sedan",
  "compact",
  "suv",
  "van",
  "bus",
];

export const DEFAULT_SIGNAL_TIMING: SignalTiming = {
  northSouthGreenSeconds: 37.5,
  eastWestGreenSeconds: 37.5,
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

interface AgentRouteNode {
  id: string;
  x: number;
  z: number;
  column?: number;
  row?: number;
}

const STATIC_SEGMENT_GEOMETRY = new Map(
  PENN_ROAD_GRAPH
    .filter((feature) => feature.kind === "street" && feature.path.length >= 2)
    .map((feature) => [
      feature.id,
      {
        start: {
          id: `${feature.id}:0`,
          x: (feature.path[0].longitude - PENN_CENTER.longitude) *
            METERS_PER_DEGREE_LONGITUDE,
          z: -(feature.path[0].latitude - PENN_CENTER.latitude) *
            METERS_PER_DEGREE_LATITUDE,
        },
        end: {
          id: `${feature.id}:1`,
          x: (feature.path[1].longitude - PENN_CENTER.longitude) *
            METERS_PER_DEGREE_LONGITUDE,
          z: -(feature.path[1].latitude - PENN_CENTER.latitude) *
            METERS_PER_DEGREE_LATITUDE,
        },
      },
    ] as const),
);

interface AgentRoute {
  nodes: readonly AgentRouteNode[];
  segmentIds: readonly string[];
}

export type TrafficRouteEndpoint =
  | Readonly<{ x: number; z: number }>
  | "outside-work"
  | "outside-market";

export interface TrafficRoutePath {
  points: readonly Readonly<{ x: number; z: number }>[];
  segmentIds: readonly string[];
  distanceMeters: number;
}

interface VehicleAgent {
  id: number;
  driverPersonId?: string;
  displayName?: string;
  path: readonly AgentRouteNode[];
  segmentIds: readonly string[];
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
  segmentDelaySeconds: number;
  complianceProbability: number;
  aggressiveYellow: boolean;
  mayRunRed: boolean;
  violationIntersectionId: string | null;
  committedIntersectionId: string | null;
  violatingUntilSeconds: number;
}

interface VehicleLeader {
  distanceOnSegment: number;
  length: number;
}

interface IntersectionReservation {
  vehicleKey: string;
  expiresAtSeconds: number;
}

interface PedestrianAgent {
  id: number;
  personId?: string;
  displayName?: string;
  path: readonly AgentRouteNode[];
  segmentIds: readonly string[];
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
  complianceProbability: number;
  mayCrossAgainstSignal: boolean;
  signalViolationUsed: boolean;
  violatingUntilSeconds: number;
}

interface BuildingDestination {
  kind: BuildingKind;
  node: GridNode;
}

type BuildingDestinationInput = Readonly<{
  kind: BuildingKind;
  x: number;
  z: number;
  id?: string;
  floors?: number;
  rotation?: number;
  color?: string;
}>;

interface EconomicRouteEdge {
  to: string;
  segmentId: string;
  cost: number;
}

interface EconomicRouteNode {
  id: string;
  x: number;
  z: number;
  staticNode: boolean;
  edges: EconomicRouteEdge[];
}

interface EconomicRoute {
  nodeIds: string[];
  segmentIds: string[];
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
      if (this.mode === "manual" && this.manualQueue.length === 0) {
        this.phaseElapsed += remaining;
        return;
      }
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
    const pedestrian = pedestrianIndication(
      this.phase,
      this.phaseElapsed,
      this.timing,
    );
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
      pedestrianState: pedestrian.state,
      pedestrianAxis: pedestrian.axis,
      pedestrianTimeRemainingSeconds: pedestrian.timeRemainingSeconds,
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
  private sampledVehicles: VehicleSnapshot[] = [];
  private resolvedVehicleSnapshots: VehicleSnapshot[] | undefined;
  private resolvedPedestrianSnapshots: PedestrianSnapshot[] | undefined;
  private intersectionReservations = new Map<string, IntersectionReservation>();
  private sampledVehicleHolds = new Map<number, {
    snapshot: VehicleSnapshot;
    intersectionId: string;
    axis: "x" | "z";
  }>();
  private sampledPedestrians: PedestrianSnapshot[] = [];
  private sampledPedestrianHolds = new Map<number, {
    snapshot: PedestrianSnapshot;
    intersectionId: string;
    committed: boolean;
  }>();
  private backgroundTrafficVisible = true;
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
  private buildingDestinations: BuildingDestination[] = [];
  private buildingDestinationNodeIds = new Set<string>();
  private expansionRoads: ExpansionRoad[] = [];
  private expansionStreetObjects: ExpansionStreetObject[] = [];
  private expansionRoadIds = new Set<string>();
  private expansionSignalControllerIds = new Set<string>();
  private economicRoadLoad = new Map<string, number>();
  private economicRouteNodes = new Map<string, EconomicRouteNode>();
  private walkingEconomicEdges = new Map<string, EconomicRouteEdge[]>();
  private expansionSegmentNodes = new Map<string, Set<string>>();
  private connectedEconomicNodes = new Set<string>();
  private endpointAccessSegments = new Map<string, Array<{
    segmentId: string;
    geometry: { start: AgentRouteNode; end: AgentRouteNode };
  }>>();
  private endpointIntersectionAnchors = new Map<string, boolean>();
  private sampledCrossingIntersections = new Set<string>();

  constructor(seed: number) {
    this.random = new RandomSource(seed);
    for (const node of this.nodes.flat()) {
      this.controllers.set(node.id, new IntersectionSignalController(node.id));
    }
    const graph = buildEconomicRouteGraph(
      this.nodes,
      this.roadSegments,
      [],
    );
    this.economicRouteNodes = graph.nodes;
    this.walkingEconomicEdges = bidirectionalEconomicEdges(graph.nodes);
    this.connectedEconomicNodes = graph.connectedNodeIds;
    this.scheduleNextSpawns(2, 2);
  }

  reset(seed: number, vehicleDemand = 2, pedestrianDemand = 2): void {
    this.random = new RandomSource(seed);
    this.vehicles = [];
    this.pedestrians = [];
    this.sampledVehicles = [];
    this.resolvedVehicleSnapshots = undefined;
    this.resolvedPedestrianSnapshots = undefined;
    this.intersectionReservations.clear();
    this.sampledVehicleHolds.clear();
    this.sampledPedestrians = [];
    this.sampledPedestrianHolds.clear();
    this.sampledCrossingIntersections.clear();
    this.backgroundTrafficVisible = true;
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
    this.resolvedVehicleSnapshots = undefined;
    this.resolvedPedestrianSnapshots = undefined;
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

  setBuildingDestinations<T extends BuildingDestinationInput>(
    buildings: readonly T[],
  ): void {
    const destinations = new Map<string, BuildingDestination>();
    for (const building of buildings) {
      const node = nearestGridNodeFromWorld(this.nodes, building.x, building.z);
      const existing = destinations.get(node.id);
      if (existing === undefined || building.kind === "industrial") {
        destinations.set(node.id, { kind: building.kind, node });
      }
    }
    this.buildingDestinations = [...destinations.values()];
    this.buildingDestinationNodeIds = new Set(destinations.keys());
    this.pedestrianDestinations.splice(
      0,
      this.pedestrianDestinations.length,
      ...PENN_LANDMARKS.map((landmark) =>
        nearestGridNode(this.nodes, landmark.longitude, landmark.latitude),
      ),
      ...this.buildingDestinations.map((destination) => destination.node),
    );
  }

  setExpansionNetwork<T extends BuildingDestinationInput>(
    roads: readonly ExpansionRoad[],
    streetObjects: readonly ExpansionStreetObject[],
    buildings: readonly T[],
  ): void {
    this.resolvedVehicleSnapshots = undefined;
    this.resolvedPedestrianSnapshots = undefined;
    for (const id of this.expansionSignalControllerIds) {
      this.controllers.delete(id);
    }
    this.expansionSignalControllerIds.clear();
    const nextRoadIds = new Set(roads.map((road) => road.id));
    const removedRoadIds = new Set(
      [...this.expansionRoadIds].filter((roadId) => !nextRoadIds.has(roadId)),
    );
    const affectedVehiclePositions = new Map(
      this.vehicles
        .filter((vehicle) =>
          vehicle.segmentIds.some((segmentId) => removedRoadIds.has(segmentId))
        )
        .map((vehicle) => [vehicle.id, positionVehicle(vehicle)]),
    );
    const affectedPedestrianPositions = new Map(
      this.pedestrians
        .filter((pedestrian) =>
          pedestrian.segmentIds.some((segmentId) =>
            removedRoadIds.has(segmentId)
          )
        )
        .map((pedestrian) => [
          pedestrian.id,
          positionPedestrian(
            pedestrian,
            this.roadSegments.get(pedestrian.segmentId),
          ),
        ]),
    );
    for (const roadId of this.expansionRoadIds) this.roadSegments.delete(roadId);
    this.expansionRoads = roads.map((road) => ({ ...road }));
    this.expansionStreetObjects = streetObjects.map((object) => ({ ...object }));
    this.expansionRoadIds = nextRoadIds;
    for (const road of roads) {
      this.roadSegments.set(road.id, expansionRoadModel(road));
    }
    this.endpointAccessSegments.clear();
    this.endpointIntersectionAnchors.clear();
    const graph = buildEconomicRouteGraph(
      this.nodes,
      this.roadSegments,
      roads,
      buildings,
    );
    this.economicRouteNodes = graph.nodes;
    this.walkingEconomicEdges = bidirectionalEconomicEdges(graph.nodes);
    this.expansionSegmentNodes = graph.expansionSegmentNodes;
    this.connectedEconomicNodes = graph.connectedNodeIds;
    for (const signal of streetObjects.filter((object) =>
      object.kind === "traffic-signal"
    )) {
      const nearest = [...graph.nodes.values()]
        .map((node) => ({
          node,
          distance: Math.hypot(node.x - signal.x, node.z - signal.z),
        }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (
        nearest
        && nearest.distance <= 4
        && !this.controllers.has(nearest.node.id)
      ) {
        this.controllers.set(
          nearest.node.id,
          new IntersectionSignalController(nearest.node.id),
        );
        this.expansionSignalControllerIds.add(nearest.node.id);
      }
    }
    this.relocateAgentsFromRemovedRoads(
      removedRoadIds,
      affectedVehiclePositions,
      affectedPedestrianPositions,
    );
    this.setBuildingDestinations(buildings);
  }

  setEconomicRoadLoad(load: ReadonlyMap<string, number>): void {
    this.economicRoadLoad = new Map(load);
  }

  setSampledMobility(
    vehicles: readonly VehicleSnapshot[],
    pedestrians: readonly PedestrianSnapshot[],
    visibleTrafficDelta?: number,
  ): void {
    this.resolvedPedestrianSnapshots = undefined;
    const previousVehicles = new Map(
      this.sampledVehicles.map((vehicle) => [vehicle.id, vehicle]),
    );
    const previousPedestrians = new Map(
      this.sampledPedestrians.map((pedestrian) => [pedestrian.id, pedestrian]),
    );
    const activeVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    for (const id of this.sampledVehicleHolds.keys()) {
      if (!activeVehicleIds.has(id)) this.sampledVehicleHolds.delete(id);
    }
    this.sampledVehicles = vehicles.map((vehicle) => {
      const aligned = this.alignSampledVehicleToLane({
        ...vehicle,
        occupantPersonIds: vehicle.occupantPersonIds
          ? [...vehicle.occupantPersonIds]
          : undefined,
      });
      return this.constrainSampledVehicle(
        aligned,
        previousVehicles.get(vehicle.id),
        visibleTrafficDelta,
      );
    });
    this.resolvedVehicleSnapshots = undefined;
    const activePedestrianIds = new Set(pedestrians.map((pedestrian) => pedestrian.id));
    for (const id of this.sampledPedestrianHolds.keys()) {
      if (!activePedestrianIds.has(id)) this.sampledPedestrianHolds.delete(id);
    }
    this.sampledPedestrians = pedestrians.map((pedestrian) => {
      const aligned = this.alignSampledPedestrianToSidewalk({ ...pedestrian });
      const previous = previousPedestrians.get(pedestrian.id);
      if (!previous) return aligned;
      const smoothed = smoothSampledPedestrianCorner(
        previous,
        aligned,
        visibleTrafficDelta === undefined
          ? Number.POSITIVE_INFINITY
          : Math.max(0.05, 1.45 * visibleTrafficDelta),
      );
      const hold = this.sampledPedestrianHolds.get(pedestrian.id);
      if (hold) {
        hold.snapshot = smoothed;
      }
      return smoothed;
    });
    this.rebuildSampledCrossingIntersections();
  }

  setBackgroundTrafficVisible(visible: boolean): void {
    if (this.backgroundTrafficVisible !== visible) {
      this.resolvedVehicleSnapshots = undefined;
      this.resolvedPedestrianSnapshots = undefined;
    }
    this.backgroundTrafficVisible = visible;
  }

  getExpansionCapacityScale(): number {
    let connectedLaneMeters = 0;
    for (const road of this.expansionRoads) {
      const nodes = this.expansionSegmentNodes.get(road.id);
      if (!nodes || ![...nodes].some((id) => this.connectedEconomicNodes.has(id))) {
        continue;
      }
      const lanes = this.roadSegments.get(road.id)?.travelLaneCount ?? 0;
      connectedLaneMeters += lanes * Math.hypot(
        road.endX - road.startX,
        road.endZ - road.startZ,
      );
    }
    return 1 + clamp(connectedLaneMeters / 45_000, 0, 0.14);
  }

  getRoadDescription(
    segmentId: string,
  ): { name: string; description: string } | undefined {
    const road = this.expansionRoads.find((candidate) => candidate.id === segmentId);
    if (!road) return undefined;
    const model = this.roadSegments.get(segmentId);
    return {
      name: model?.streetName ?? "Expansion road",
      description: `${Math.round(Math.hypot(road.endX - road.startX, road.endZ - road.startZ))} m user-built ${road.laneDirection ?? "two-way"} road`,
    };
  }

  getEndpointMobilitySupport(endpoint: Readonly<{ x: number; z: number }>): {
    connected: boolean;
    walkingBonus: number;
    cyclingBonus: number;
  } {
    const nearest = this.expansionRoads
      .map((road) => ({ road, distance: distanceToRoad(endpoint.x, endpoint.z, road) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || nearest.distance > Math.max(55, nearest.road.width * 2.5)) {
      const gridNode = nearestGridNodeFromWorld(this.nodes, endpoint.x, endpoint.z);
      const connected = Math.hypot(gridNode.x - endpoint.x, gridNode.z - endpoint.z) <= 180;
      return { connected, walkingBonus: 0, cyclingBonus: 0 };
    }
    const routeNodes = this.expansionSegmentNodes.get(nearest.road.id) ?? new Set();
    const connected = [...routeNodes].some((id) => this.connectedEconomicNodes.has(id));
    const nearbyObjects = this.expansionStreetObjects.filter((object) =>
      distanceToRoad(object.x, object.z, nearest.road) <= nearest.road.width
    );
    return {
      connected,
      walkingBonus: (nearest.road.widenedSidewalk ? 8 : 0)
        + (nearbyObjects.some((object) => object.kind === "crosswalk") ? 5 : 0),
      cyclingBonus: nearest.road.bikeLane ? 7 : 0,
    };
  }

  setAllSignalCycles(totalSeconds: number): void {
    const fixed =
      DEFAULT_SIGNAL_TIMING.yellowSeconds * 2 +
      DEFAULT_SIGNAL_TIMING.allRedSeconds * 2;
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
    this.resolvedVehicleSnapshots = undefined;
    this.routeCache.clear();
    this.reconcileVehicleRoutes();
  }

  setRoadDesigns(
    designs: ReadonlyMap<string, Readonly<LaneModelOverrides>>,
  ): void {
    this.resolvedVehicleSnapshots = undefined;
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
    for (const road of this.expansionRoads) {
      this.roadSegments.set(road.id, expansionRoadModel(road));
    }
    this.routeCache.clear();
    this.reconcileVehicleRoutes();
  }

  getRoadSegment(segmentId: string): RoadSegmentModel | undefined {
    return this.roadSegments.get(segmentId);
  }

  getRouteSegmentIds(
    from: TrafficRouteEndpoint,
    to: TrafficRouteEndpoint,
  ): string[] {
    if (this.expansionRoads.length > 0) {
      return economicRouteSegmentIds(
        this.economicRouteNodes,
        this.expansionRoads,
        this.expansionSegmentNodes,
        this.nodes,
        from,
        to,
      );
    }
    const fromPoint = typeof from === "string" ? null : nearestGridNodeFromWorld(this.nodes, from.x, from.z);
    const toPoint = typeof to === "string" ? null : nearestGridNodeFromWorld(this.nodes, to.x, to.z);
    const origin = typeof from === "string"
      ? this.outsideRouteNode(from, toPoint)
      : fromPoint as GridNode;
    const destination = typeof to === "string"
      ? this.outsideRouteNode(to, fromPoint)
      : toPoint as GridNode;
    const route = this.findVehicleRoute(origin, destination, 1.1) ?? [];
    const segments: string[] = [];
    for (let index = 0; index < route.length - 1; index += 1) {
      segments.push(segmentIdBetween(
        route[index].column,
        route[index].row,
        route[index + 1].column,
        route[index + 1].row,
      ));
    }
    return segments;
  }

  getRoutePath(
    from: TrafficRouteEndpoint,
    to: TrafficRouteEndpoint,
    mode: TravelMode,
  ): TrafficRoutePath {
    if (this.expansionRoads.length > 0) {
      const economicRoute = findEconomicRoute(
        this.economicRouteNodes,
        this.expansionRoads,
        this.expansionSegmentNodes,
        this.nodes,
        from,
        to,
        mode === "walk" ? this.walkingEconomicEdges : undefined,
      );
      if (economicRoute.nodeIds.length > 0) {
        return this.withEndpointAccess(
          economicRoutePath(
            this.economicRouteNodes,
            economicRoute,
          ),
          from,
          to,
        );
      }
    }
    const fromPoint = typeof from === "string"
      ? null
      : nearestGridNodeFromWorld(this.nodes, from.x, from.z);
    const toPoint = typeof to === "string"
      ? null
      : nearestGridNodeFromWorld(this.nodes, to.x, to.z);
    const origin = typeof from === "string"
      ? this.outsideRouteNode(from, toPoint)
      : fromPoint as GridNode;
    const destination = typeof to === "string"
      ? this.outsideRouteNode(to, fromPoint)
      : toPoint as GridNode;
    const route = mode === "walk"
      ? createManhattanPath(
          this.nodes,
          origin,
          destination,
          Math.abs(origin.column - destination.column)
            >= Math.abs(origin.row - destination.row),
        )
      : this.findVehicleRoute(origin, destination, 1.1)
        ?? createManhattanPath(this.nodes, origin, destination, true);
    const routeSegmentIds: string[] = [];
    for (let index = 0; index < route.length - 1; index += 1) {
      routeSegmentIds.push(segmentIdBetween(
        route[index].column,
        route[index].row,
        route[index + 1].column,
        route[index + 1].row,
      ));
    }
    const points = route.map((node) => ({ x: node.x, z: node.z }));
    const deduplicated = points.filter((point, index) =>
      index === 0 || Math.hypot(
        point.x - points[index - 1].x,
        point.z - points[index - 1].z,
      ) > 0.1
    );
    const segmentIds = deduplicated.slice(0, -1).map((_, index) => {
      return routeSegmentIds[
        Math.min(routeSegmentIds.length - 1, index)
      ] ?? "off-network";
    });
    return this.withEndpointAccess({
      points: deduplicated,
      segmentIds,
      distanceMeters: deduplicated.slice(1).reduce((total, point, index) =>
        total + Math.hypot(
          point.x - deduplicated[index].x,
          point.z - deduplicated[index].z,
        ), 0),
    }, from, to);
  }

  private withEndpointAccess(
    route: Readonly<TrafficRoutePath>,
    from: TrafficRouteEndpoint,
    to: TrafficRouteEndpoint,
  ): TrafficRoutePath {
    const points = route.points.map((point) => ({ ...point }));
    const segmentIds = [...route.segmentIds];
    const attach = (
      endpoint: TrafficRouteEndpoint,
      atStart: boolean,
    ): void => {
      if (typeof endpoint === "string" || points.length < 2) return;
      const anchor = atStart ? points[0] : points.at(-1)!;
      let access: {
        segmentId: string;
        geometry: { start: AgentRouteNode; end: AgentRouteNode };
        projection: ReturnType<typeof projectPointOntoSegment>;
      } | undefined;
      const anchorKey = `${Math.round(anchor.x * 10)}:${
        Math.round(anchor.z * 10)
      }`;
      let candidates = this.endpointAccessSegments.get(anchorKey);
      if (!candidates) {
        candidates = [];
        for (const segmentId of this.roadSegments.keys()) {
          const geometry = this.segmentGeometry(segmentId);
          if (
            geometry
            && projectPointOntoSegment(
              anchor.x,
              anchor.z,
              geometry.start,
              geometry.end,
            ).distance <= 1.5
          ) {
            candidates.push({ segmentId, geometry });
          }
        }
        this.endpointAccessSegments.set(anchorKey, candidates);
      }
      for (const candidate of candidates) {
        const projection = projectPointOntoSegment(
          endpoint.x,
          endpoint.z,
          candidate.geometry.start,
          candidate.geometry.end,
        );
        if (!access || projection.distance < access.projection.distance) {
          access = { ...candidate, projection };
        }
      }
      if (!access) return;
      const segmentLength = Math.max(0.001, distance(
        access.geometry.start,
        access.geometry.end,
      ));
      const progress = access.projection.distanceOnSegment / segmentLength;
      let point = {
        x: access.geometry.start.x
          + (access.geometry.end.x - access.geometry.start.x) * progress,
        z: access.geometry.start.z
          + (access.geometry.end.z - access.geometry.start.z) * progress,
      };
      let anchorIsIntersection = this.endpointIntersectionAnchors.get(anchorKey);
      if (anchorIsIntersection === undefined) {
        const anchorNode = [...this.economicRouteNodes.values()].find((node) =>
          Math.hypot(node.x - anchor.x, node.z - anchor.z) <= 0.1
        );
        anchorIsIntersection = new Set(
          anchorNode
            ? (this.walkingEconomicEdges.get(anchorNode.id) ?? [])
              .map((edge) => edge.segmentId)
            : [],
        ).size >= 2;
        this.endpointIntersectionAnchors.set(anchorKey, anchorIsIntersection);
      }
      const distanceFromIntersection = Math.hypot(
        point.x - anchor.x,
        point.z - anchor.z,
      );
      if (anchorIsIntersection && distanceFromIntersection < 24) {
        const projectedDirection = {
          x: point.x - anchor.x,
          z: point.z - anchor.z,
        };
        const endpointOptions = [
          access.geometry.start,
          access.geometry.end,
        ].map((candidate) => ({
          candidate,
          distance: Math.hypot(
            candidate.x - anchor.x,
            candidate.z - anchor.z,
          ),
          alignment:
            (candidate.x - anchor.x) * projectedDirection.x
            + (candidate.z - anchor.z) * projectedDirection.z,
        })).filter((candidate) => candidate.distance > 0.1);
        const target = endpointOptions.sort((left, right) =>
          right.alignment - left.alignment || right.distance - left.distance
        )[0];
        if (target) {
          const clearance = Math.min(24, target.distance);
          point = {
            x: anchor.x
              + (target.candidate.x - anchor.x)
              / target.distance * clearance,
            z: anchor.z
              + (target.candidate.z - anchor.z)
              / target.distance * clearance,
          };
        }
      }
      if (Math.hypot(point.x - anchor.x, point.z - anchor.z) <= 0.1) {
        return;
      }
      if (atStart) {
        points.unshift(point);
        segmentIds.unshift(access.segmentId);
      } else {
        points.push(point);
        segmentIds.push(access.segmentId);
      }
    };
    attach(from, true);
    attach(to, false);
    return {
      points,
      segmentIds,
      distanceMeters: route.distanceMeters,
    };
  }

  getCoverage(): {
    vehicleSegments: ReadonlySet<string>;
    pedestrianSegments: ReadonlySet<string>;
  } {
    return {
      vehicleSegments: new Set(this.getVehicles().map((vehicle) => vehicle.segmentId)),
      pedestrianSegments: new Set(
        this.getPedestrians().map((pedestrian) => pedestrian.segmentId),
      ),
    };
  }

  getVehicles(): VehicleSnapshot[] {
    if (this.resolvedVehicleSnapshots) return this.resolvedVehicleSnapshots;
    const background = this.backgroundTrafficVisible ? this.vehicles.map((vehicle) => {
      const position = positionVehicle(vehicle);
      return {
        id: vehicle.id,
        ...position,
        segmentId: vehicle.segmentId,
        driverPersonId: vehicle.driverPersonId,
        displayName: vehicle.displayName,
        laneId: vehicle.lane.id,
        speedMetersPerSecond: vehicle.speed,
        queued: vehicle.queued,
        kind: vehicle.kind,
        color: vehicle.color,
        complianceProbability: vehicle.complianceProbability,
        violating: this.elapsedSeconds < vehicle.violatingUntilSeconds,
        source: "background" as const,
        delaySeconds: vehicle.segmentDelaySeconds,
      };
    }) : [];
    this.resolvedVehicleSnapshots = this.resolveVehicleSpacing([
      ...this.sampledVehicles,
      ...background,
    ]);
    return this.resolvedVehicleSnapshots;
  }

  getPedestrians(): PedestrianSnapshot[] {
    if (this.resolvedPedestrianSnapshots) {
      return this.resolvedPedestrianSnapshots;
    }
    const background = this.backgroundTrafficVisible ? this.pedestrians.map((pedestrian) => {
      const position = positionPedestrian(
        pedestrian,
        this.roadSegments.get(pedestrian.segmentId),
      );
      return {
        id: pedestrian.id,
        ...position,
        segmentId: pedestrian.segmentId,
        personId: pedestrian.personId,
        displayName: pedestrian.displayName,
        waiting: pedestrian.waiting,
        color: pedestrian.color,
        variant: pedestrian.variant,
        complianceProbability: pedestrian.complianceProbability,
        violating: this.elapsedSeconds < pedestrian.violatingUntilSeconds,
        source: "background" as const,
        delaySeconds: pedestrian.waitSeconds,
      };
    }) : [];
    this.resolvedPedestrianSnapshots = this.resolvePedestrianSpacing(
      [...this.sampledPedestrians, ...background],
      this.getVehicles(),
    );
    return this.resolvedPedestrianSnapshots;
  }

  getRoadTraffic(): RoadTrafficSnapshot[] {
    const vehiclesBySegment = new Map<string, VehicleSnapshot[]>();
    for (const vehicle of this.getVehicles()) {
      const vehicles = vehiclesBySegment.get(vehicle.segmentId) ?? [];
      vehicles.push(vehicle);
      vehiclesBySegment.set(vehicle.segmentId, vehicles);
    }

    return [...this.roadSegments.values()].map((segment) => {
      const vehicles = vehiclesBySegment.get(segment.id) ?? [];
      if (this.expansionRoadIds.has(segment.id)) {
        return this.expansionRoadTraffic(segment, vehicles);
      }
      const queuedVehicles = vehicles.filter((vehicle) => vehicle.queued).length;
      const averageSpeedMetersPerSecond = vehicles.length === 0
        ? 0
        : vehicles.reduce((total, vehicle) => total + vehicle.speedMetersPerSecond, 0) / vehicles.length;
      const averageSpeedMph = averageSpeedMetersPerSecond * 2.23694;
      const representativeCapacity = Math.max(1, segment.travelLaneCount * 6);
      const loadRatio = clamp(vehicles.length / representativeCapacity, 0, 1.6);
      const queueRatio = queuedVehicles / Math.max(1, vehicles.length);
      const speedPenalty = vehicles.length === 0
        ? 0
        : 1 - clamp(averageSpeedMph / Math.max(1, segment.speedLimitMph), 0, 1);
      const congestionPercent = clamp(
        loadRatio * 50 + queueRatio * 35 + speedPenalty * 25,
        0,
        100,
      );
      const averageDelaySeconds = vehicles.length === 0
        ? 0
        : vehicles.reduce((total, vehicle) => total + (vehicle.delaySeconds ?? 0), 0) / vehicles.length;

      return {
        segmentId: segment.id,
        activeVehicles: vehicles.length,
        queuedVehicles,
        averageSpeedMph: roundOne(averageSpeedMph),
        congestionPercent: roundOne(congestionPercent),
        averageDelaySeconds: roundOne(averageDelaySeconds),
      };
    });
  }

  private expansionRoadTraffic(
    segment: Readonly<RoadSegmentModel>,
    visibleVehicles: readonly VehicleSnapshot[],
  ): RoadTrafficSnapshot {
    const road = this.expansionRoads.find((candidate) => candidate.id === segment.id);
    const dailyTrips = this.economicRoadLoad.get(segment.id) ?? 0;
    const laneCapacity = Math.max(1, segment.travelLaneCount) * 95;
    const loadRatio = clamp(dailyTrips / laneCapacity, 0, 1.8);
    const crosswalks = road
      ? this.expansionStreetObjects.filter((object) =>
          object.kind === "crosswalk" && distanceToRoad(object.x, object.z, road) <= road.width
        ).length
      : 0;
    const signals = road
      ? this.expansionStreetObjects.filter((object) =>
          object.kind === "traffic-signal" && distanceToRoad(object.x, object.z, road) <= road.width
        ).length
      : 0;
    const congestionPercent = clamp(
      loadRatio * 72 + Math.max(0, loadRatio - 0.75) * 48,
      0,
      100,
    );
    const modeledActiveVehicles = Math.round(dailyTrips / 18);
    const modeledQueuedVehicles = Math.round(
      modeledActiveVehicles * congestionPercent / 100 * 0.42,
    );
    const modeledDelaySeconds =
      congestionPercent * 0.52 + crosswalks * 3.5 + signals * 2.5;
    const modeledSpeedMph = dailyTrips <= 0
      ? 0
      : segment.speedLimitMph * clamp(1 - congestionPercent / 135, 0.2, 1);
    const activeVehicles = visibleVehicles.length;
    const queuedVehicles = visibleVehicles.filter((vehicle) => vehicle.queued).length;
    const averageSpeedMph = activeVehicles === 0
      ? modeledSpeedMph
      : visibleVehicles.reduce(
          (total, vehicle) => total + vehicle.speedMetersPerSecond * 2.23694,
          0,
        ) / activeVehicles;
    const averageDelaySeconds = activeVehicles === 0
      ? modeledDelaySeconds
      : visibleVehicles.reduce(
          (total, vehicle) => total + (vehicle.delaySeconds ?? 0),
          0,
        ) / activeVehicles;
    const liveLoadRatio = activeVehicles /
      Math.max(1, segment.travelLaneCount * 6);
    const liveQueueRatio = queuedVehicles / Math.max(1, activeVehicles);
    const liveSpeedPenalty = activeVehicles === 0
      ? 0
      : 1 - clamp(
          averageSpeedMph / Math.max(1, segment.speedLimitMph),
          0,
          1,
        );
    const liveCongestionPercent = clamp(
      liveLoadRatio * 50 + liveQueueRatio * 35 + liveSpeedPenalty * 25,
      0,
      100,
    );
    return {
      segmentId: segment.id,
      activeVehicles: activeVehicles || modeledActiveVehicles,
      queuedVehicles: activeVehicles > 0
        ? queuedVehicles
        : modeledQueuedVehicles,
      averageSpeedMph: roundOne(averageSpeedMph),
      congestionPercent: roundOne(
        Math.max(congestionPercent, liveCongestionPercent),
      ),
      averageDelaySeconds: roundOne(averageDelaySeconds),
    };
  }

  getMetrics(): SimulationMetrics {
    const vehicles = this.getVehicles();
    const pedestrians = this.getPedestrians();
    const queuedVehicles = vehicles.filter((vehicle) => vehicle.queued).length;
    const movingVehicles = vehicles.filter((vehicle) => vehicle.speedMetersPerSecond > 0.25);
    const averageSpeedMetersPerSecond =
      movingVehicles.length === 0
        ? 0
        : movingVehicles.reduce((sum, vehicle) => sum + vehicle.speedMetersPerSecond, 0) /
          movingVehicles.length;
    const activeVehicleTravel = this.vehicles.reduce(
      (sum, vehicle) => sum + (this.elapsedSeconds - vehicle.spawnedAt),
      0,
    );
    const vehicleSampleCount =
      this.completedVehicleTrips + vehicles.length;
    const activePedestrianWait = pedestrians.reduce(
      (sum, pedestrian) => sum + (pedestrian.delaySeconds ?? 0),
      0,
    );
    const pedestrianSampleCount =
      this.completedPedestrianTrips + pedestrians.length;
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
              vehicles.reduce(
                (sum, vehicle) => sum + (vehicle.delaySeconds ?? 0),
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
      activeVehicles: vehicles.length,
      activePedestrians: pedestrians.length,
      crossingsCompleted: this.crossingsCompleted,
      buildingArrivals: this.buildingArrivals,
      trafficViolations: this.trafficViolations,
      jaywalkingViolations: this.jaywalkingViolations,
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

  private outsideRouteNode(
    endpoint: Extract<TrafficRouteEndpoint, string>,
    reference: GridNode | null,
  ): GridNode {
    if (endpoint === "outside-market") return this.nodes[0][0];
    const boundary = this.nodes.flat().filter((node) =>
      node.column === 0
      || node.row === 0
      || node.column === this.nodes.length - 1
      || node.row === this.nodes[0].length - 1
    );
    if (!reference) return boundary[0];
    return boundary.reduce((nearest, node) =>
      distance(node, reference) < distance(nearest, reference) ? node : nearest
    );
  }

  private updateVehicleSpawner(
    deltaSeconds: number,
    demand: number,
    speedLimitMph: number,
    violationRiskMultiplier: number,
  ): void {
    const level = clampDemand(demand);
    this.nextVehicleSpawnSeconds -= deltaSeconds;
    const target = Math.max(0, VEHICLE_TARGETS[level] - this.sampledVehicles.length);
    while (this.nextVehicleSpawnSeconds <= 0 && this.vehicles.length < target) {
      const route = this.createVehicleRoute(level);
      const destination = route.nodes.at(-1);
      const freight =
        destination !== undefined &&
        this.buildingDestinations.some(
          (building) =>
            building.kind === "industrial" &&
            building.node.id === destination.id,
        );
      const kind: VehicleKind = freight
        ? "truck"
        : this.random.pick(VEHICLE_KINDS);
      const assignment = this.laneForPath(
        route.nodes,
        route.segmentIds,
        0,
        kind,
      );
      const spawnDistance = this.randomVehicleSpawnDistance(
        route,
        vehicleLengthMeters(kind),
      );
      if (
        assignment
        && this.canSpawnVehicle(
          assignment.lane.id,
          spawnDistance,
          vehicleLengthMeters(kind),
        )
      ) {
        const expansionDriver = route.segmentIds.some((candidate) =>
          this.expansionRoadIds.has(candidate)
        );
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
        const desiredSpeed =
          Math.min(speedLimitMph, assignment.segment.speedLimitMph) *
          0.44704 *
          speedFactor;
        const speeding = speedFactor > 1;
        if (speeding) this.trafficViolations += 1;
        this.vehicles.push({
          id: this.nextVehicleId,
          driverPersonId: expansionDriver
            ? `ambient-driver-${this.nextVehicleId}`
            : undefined,
          displayName: expansionDriver
            ? ambientCitizenName(this.nextVehicleId)
            : undefined,
          path: route.nodes,
          segmentIds: route.segmentIds,
          segmentIndex: 0,
          distanceOnSegment: spawnDistance,
          speed: 0,
          desiredSpeed,
          queued: false,
          kind,
          color: this.random.pick(VEHICLE_COLORS),
          length: vehicleLengthMeters(kind),
          lane: assignment.lane,
          segmentId: assignment.segment.id,
          spawnedAt: this.elapsedSeconds,
          delaySeconds: 0,
          segmentDelaySeconds: 0,
          complianceProbability,
          aggressiveYellow: this.random.next() > effectiveCompliance,
          mayRunRed:
            this.random.next() <
            redSignalViolationProbability(
              complianceProbability,
              violationRiskMultiplier,
            ),
          violationIntersectionId: null,
          committedIntersectionId: null,
          violatingUntilSeconds:
            speeding ? this.elapsedSeconds + VIOLATION_FLASH_SECONDS : 0,
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
      const position = positionVehicle(vehicle);
      const start = vehicle.path[vehicle.segmentIndex];
      const end = vehicle.path[vehicle.segmentIndex + 1];
      if (!start || !end) return this.relocateVehicle(vehicle, position);
      const destination = vehicle.path.at(-1);
      if (
        isGridNode(start)
        && isGridNode(end)
        && isGridNode(destination)
      ) {
        const continuation = this.findVehicleRoute(end, destination);
        if (!continuation) return this.relocateVehicle(vehicle, position);
        const revisedRoute = gridAgentRoute([start, ...continuation]);
        const assignment = this.laneForPath(
          revisedRoute.nodes,
          revisedRoute.segmentIds,
          0,
          vehicle.kind,
        );
        if (!assignment) return this.relocateVehicle(vehicle, position);
        vehicle.path = revisedRoute.nodes;
        vehicle.segmentIds = revisedRoute.segmentIds;
        vehicle.segmentIndex = 0;
        vehicle.segmentId = assignment.segment.id;
        vehicle.lane = assignment.lane;
        vehicle.segmentDelaySeconds = 0;
        return true;
      }
      const assignment = this.laneForPath(
        vehicle.path,
        vehicle.segmentIds,
        vehicle.segmentIndex,
        vehicle.kind,
      );
      if (!assignment) return this.relocateVehicle(vehicle, position);
      vehicle.segmentId = assignment.segment.id;
      vehicle.lane = assignment.lane;
      vehicle.segmentDelaySeconds = 0;
      return true;
    });
  }

  private relocateAgentsFromRemovedRoads(
    removedRoadIds: ReadonlySet<string>,
    vehiclePositions: ReadonlyMap<number, PositionedAgent>,
    pedestrianPositions: ReadonlyMap<number, PositionedAgent>,
  ): void {
    if (removedRoadIds.size === 0) return;
    this.vehicles = this.vehicles.filter((vehicle) => {
      const position = vehiclePositions.get(vehicle.id);
      if (!position) return true;
      return this.relocateVehicle(vehicle, position);
    });
    this.pedestrians = this.pedestrians.filter((pedestrian) => {
      const position = pedestrianPositions.get(pedestrian.id);
      if (!position) return true;
      const relocation = this.nearestSurvivingRoute(position.x, position.z);
      if (!relocation) return false;
      pedestrian.path = relocation.route.nodes;
      pedestrian.segmentIds = relocation.route.segmentIds;
      pedestrian.segmentIndex = 0;
      pedestrian.distanceOnSegment = relocation.distanceOnSegment;
      pedestrian.segmentId = relocation.route.segmentIds[0];
      pedestrian.waiting = false;
      pedestrian.committedIntersectionId = null;
      return true;
    });
  }

  private relocateVehicle(
    vehicle: VehicleAgent,
    position: Readonly<PositionedAgent>,
  ): boolean {
    const relocation = this.nearestSurvivingRoute(
      position.x,
      position.z,
      vehicle.kind,
    );
    if (!relocation?.assignment) return false;
    vehicle.path = relocation.route.nodes;
    vehicle.segmentIds = relocation.route.segmentIds;
    vehicle.segmentIndex = 0;
    vehicle.distanceOnSegment = relocation.distanceOnSegment;
    vehicle.segmentId = relocation.assignment.segment.id;
    vehicle.lane = relocation.assignment.lane;
    vehicle.speed = Math.min(vehicle.speed, vehicle.desiredSpeed);
    vehicle.queued = false;
    vehicle.segmentDelaySeconds = 0;
    vehicle.violationIntersectionId = null;
    vehicle.committedIntersectionId = null;
    return true;
  }

  private nearestSurvivingRoute(
    x: number,
    z: number,
    vehicleKind?: VehicleKind,
  ): {
    route: AgentRoute;
    distanceOnSegment: number;
    assignment?: { segment: RoadSegmentModel; lane: RoadLane };
  } | null {
    const candidates: Array<{
      route: AgentRoute;
      distance: number;
      distanceOnSegment: number;
    }> = [];
    const edgeMap = vehicleKind
      ? new Map(
          [...this.economicRouteNodes].map(([id, node]) => [id, node.edges]),
        )
      : this.walkingEconomicEdges;
    for (const [fromId, edges] of edgeMap) {
      const from = this.economicRouteNodes.get(fromId);
      if (!from) continue;
      for (const edge of edges) {
        if (!this.roadSegments.has(edge.segmentId)) continue;
        const to = this.economicRouteNodes.get(edge.to);
        if (!to) continue;
        const projection = projectPointOntoSegment(x, z, from, to);
        candidates.push({
          route: {
            nodes: [from, to],
            segmentIds: [edge.segmentId],
          },
          distance: projection.distance,
          distanceOnSegment: projection.distanceOnSegment,
        });
      }
    }
    candidates.sort((left, right) => left.distance - right.distance);
    for (const candidate of candidates) {
      if (!vehicleKind) return candidate;
      const assignment = this.laneForPath(
        candidate.route.nodes,
        candidate.route.segmentIds,
        0,
        vehicleKind,
      );
      if (assignment) return { ...candidate, assignment };
    }
    return null;
  }

  private alignSampledVehicleToLane(
    vehicle: VehicleSnapshot,
  ): VehicleSnapshot {
    const segment = this.roadSegments.get(vehicle.segmentId);
    const geometry = this.segmentGeometry(vehicle.segmentId);
    if (!segment || !geometry) return vehicle;
    const movementX = Math.sin(vehicle.heading);
    const movementZ = Math.cos(vehicle.heading);
    const roadX = geometry.end.x - geometry.start.x;
    const roadZ = geometry.end.z - geometry.start.z;
    const direction: LaneTravelDirection =
      movementX * roadX + movementZ * roadZ >= 0 ? "forward" : "reverse";
    const lanes = segment.lanes.filter((lane) =>
      lane.direction === direction &&
      (lane.type === "general" || lane.type === "turn" || lane.type === "bus")
    );
    if (lanes.length === 0) return vehicle;
    const preferred = vehicle.kind === "bus"
      ? lanes.filter((lane) => lane.type === "bus")
      : lanes.filter((lane) => lane.type !== "bus");
    const choices = preferred.length > 0 ? preferred : lanes;
    const lane = choices[Math.abs(vehicle.id) % choices.length];
    const start = direction === "forward" ? geometry.start : geometry.end;
    const end = direction === "forward" ? geometry.end : geometry.start;
    const projection = projectPointOntoSegment(
      vehicle.x,
      vehicle.z,
      start,
      end,
    );
    const position = positionAlongPath(
      [start, end],
      0,
      projection.distanceOnSegment,
      direction === "forward" ? lane.offsetMeters : -lane.offsetMeters,
    );
    return {
      ...vehicle,
      x: position.x,
      z: position.z,
      heading: position.heading,
      laneId: lane.id,
    };
  }

  private constrainSampledVehicle(
    vehicle: VehicleSnapshot,
    previous: VehicleSnapshot | undefined,
    visibleTrafficDelta: number | undefined,
  ): VehicleSnapshot {
    const vehicleKey = `sampled:${vehicle.id}`;
    const held = this.sampledVehicleHolds.get(vehicle.id);
    if (held) {
      const signal = this.controllers.get(held.intersectionId)?.getSnapshot();
      if (
        (signal
          && !vehicleMayProceed(signal.phase, held.axis, 20, 0))
        || this.intersectionHasCrossingPedestrian(held.intersectionId)
        || !this.intersectionAvailable(held.intersectionId, vehicleKey)
      ) {
        return {
          ...held.snapshot,
          speedMetersPerSecond: 0,
          queued: true,
        };
      }
      this.sampledVehicleHolds.delete(vehicle.id);
    }
    const smoothed = previous
      ? smoothSampledVehicleMovement(
          previous,
          vehicle,
          visibleTrafficDelta === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(
                0.1,
                vehicle.speedMetersPerSecond * visibleTrafficDelta,
              ),
        )
      : vehicle;
    const segment = this.roadSegments.get(smoothed.segmentId);
    const geometry = this.segmentGeometry(smoothed.segmentId);
    const lane = segment?.lanes.find((candidate) =>
      candidate.id === smoothed.laneId
    );
    if (!segment || !geometry || !lane) return smoothed;
    const forward = lane.direction === "forward";
    const start = forward ? geometry.start : geometry.end;
    const end = forward ? geometry.end : geometry.start;
    const projection = projectPointOntoSegment(
      smoothed.x,
      smoothed.z,
      start,
      end,
    );
    const segmentLength = distance(start, end);
    const remaining = segmentLength - projection.distanceOnSegment;
    if (remaining >= 40) return smoothed;
    const intersectionNode = this.nearestIntersectionNode(end.x, end.z);
    if (!intersectionNode) return smoothed;
    const signal = this.controllers.get(intersectionNode.id)?.getSnapshot();
    const axis = movementAxis(start, end);
    const signalAllowsEntry =
      !signal
      || vehicleMayProceed(
        signal.phase,
        axis,
        remaining,
        smoothed.speedMetersPerSecond,
      );
    const canEnter =
      signalAllowsEntry
      && !this.intersectionHasCrossingPedestrian(intersectionNode.id)
      && this.intersectionAvailable(intersectionNode.id, vehicleKey);
    if (canEnter) {
      const commitDistance =
        vehicleStopCenterDistance(vehicleLengthMeters(smoothed.kind))
        + Math.max(
          0.5,
          smoothed.speedMetersPerSecond * (visibleTrafficDelta ?? 0.1),
        );
      if (remaining <= commitDistance) {
        this.reserveIntersection(intersectionNode.id, vehicleKey);
      }
      return smoothed;
    }
    const stopCenterDistance = vehicleStopCenterDistance(
      vehicleLengthMeters(smoothed.kind),
    );
    const distanceBeforeStop =
      remaining - stopCenterDistance;
    if (distanceBeforeStop > 0) {
      return {
        ...smoothed,
        speedMetersPerSecond: Math.min(
          smoothed.speedMetersPerSecond,
          Math.max(0, distanceBeforeStop * 0.7),
        ),
      };
    }
    const stopped = positionAlongPath(
      [start, end],
      0,
      Math.max(0, segmentLength - stopCenterDistance),
      forward ? lane.offsetMeters : -lane.offsetMeters,
    );
    const snapshot = {
      ...smoothed,
      x: stopped.x,
      z: stopped.z,
      heading: stopped.heading,
      speedMetersPerSecond: 0,
      queued: true,
    };
    this.sampledVehicleHolds.set(smoothed.id, {
      snapshot,
      intersectionId: intersectionNode.id,
      axis,
    });
    return snapshot;
  }

  private resolveVehicleSpacing(
    vehicles: readonly VehicleSnapshot[],
  ): VehicleSnapshot[] {
    const resolved = vehicles.map((vehicle) => ({ ...vehicle }));
    const sampledLaneIds = new Set(
      this.sampledVehicles.map((vehicle) => vehicle.laneId),
    );
    const lanes = new Map<string, Array<{
      vehicle: VehicleSnapshot;
      start: AgentRouteNode;
      end: AgentRouteNode;
      lane: RoadLane;
      progress: number;
      length: number;
    }>>();
    for (const vehicle of resolved) {
      if (!sampledLaneIds.has(vehicle.laneId)) continue;
      const segment = this.roadSegments.get(vehicle.segmentId);
      const geometry = this.segmentGeometry(vehicle.segmentId);
      const lane = segment?.lanes.find((candidate) =>
        candidate.id === vehicle.laneId
      );
      if (!segment || !geometry || !lane) continue;
      const forward = lane.direction === "forward";
      const start = forward ? geometry.start : geometry.end;
      const end = forward ? geometry.end : geometry.start;
      const progress = projectPointOntoSegment(
        vehicle.x,
        vehicle.z,
        start,
        end,
      ).distanceOnSegment;
      const bucket = lanes.get(lane.id) ?? [];
      bucket.push({
        vehicle,
        start,
        end,
        lane,
        progress,
        length: vehicleLengthMeters(vehicle.kind),
      });
      lanes.set(lane.id, bucket);
    }
    for (const bucket of lanes.values()) {
      bucket.sort((left, right) => right.progress - left.progress);
      for (let index = 1; index < bucket.length; index += 1) {
        const leader = bucket[index - 1];
        const follower = bucket[index];
        const maximumProgress =
          leader.progress
          - leader.length / 2
          - follower.length / 2
          - 2.8;
        if (follower.progress <= maximumProgress) continue;
        follower.progress = Math.max(0, maximumProgress);
        const forward = follower.lane.direction === "forward";
        const position = positionAlongPath(
          [follower.start, follower.end],
          0,
          follower.progress,
          forward
            ? follower.lane.offsetMeters
            : -follower.lane.offsetMeters,
        );
        Object.assign(follower.vehicle, {
          x: position.x,
          z: position.z,
          heading: position.heading,
          speedMetersPerSecond: 0,
          queued: true,
        });
      }
    }
    if (this.sampledVehicles.length === 0) return resolved;
    const occupied = new Map<string, VehicleSnapshot[]>();
    for (const vehicle of resolved) {
      const neighbors = nearbySpatialValues(occupied, vehicle.x, vehicle.z);
      let retreat = 0;
      for (const other of neighbors) {
        if (other.laneId === vehicle.laneId) continue;
        const clearance =
          vehicleLengthMeters(other.kind) / 2
          + vehicleLengthMeters(vehicle.kind) / 2
          + 1;
        retreat = Math.max(
          retreat,
          clearance - Math.hypot(
            other.x - vehicle.x,
            other.z - vehicle.z,
          ),
        );
      }
      if (retreat > 0) {
        const segment = this.roadSegments.get(vehicle.segmentId);
        const geometry = this.segmentGeometry(vehicle.segmentId);
        const lane = segment?.lanes.find((candidate) =>
          candidate.id === vehicle.laneId
        );
        if (geometry && lane) {
          const forward = lane.direction === "forward";
          const start = forward ? geometry.start : geometry.end;
          const end = forward ? geometry.end : geometry.start;
          const progress = projectPointOntoSegment(
            vehicle.x,
            vehicle.z,
            start,
            end,
          ).distanceOnSegment;
          const position = positionAlongPath(
            [start, end],
            0,
            Math.max(0, progress - retreat),
            forward ? lane.offsetMeters : -lane.offsetMeters,
          );
          Object.assign(vehicle, {
            x: position.x,
            z: position.z,
            heading: position.heading,
            speedMetersPerSecond: 0,
            queued: true,
          });
        }
      }
      addSpatialValue(occupied, vehicle);
    }
    return resolved;
  }

  private resolvePedestrianSpacing(
    pedestrians: readonly PedestrianSnapshot[],
    vehicles: readonly VehicleSnapshot[],
  ): PedestrianSnapshot[] {
    const resolved = pedestrians.map((pedestrian) => ({ ...pedestrian }));
    const vehicleBuckets = new Map<string, VehicleSnapshot[]>();
    for (const vehicle of vehicles) addSpatialValue(vehicleBuckets, vehicle);
    for (const pedestrian of resolved) {
      let backwardDistance = 0;
      for (const vehicle of nearbySpatialValues(
        vehicleBuckets,
        pedestrian.x,
        pedestrian.z,
      )) {
        const clearance = vehicleLengthMeters(vehicle.kind) / 2 + 0.55;
        const centerDistance = Math.hypot(
          pedestrian.x - vehicle.x,
          pedestrian.z - vehicle.z,
        );
        backwardDistance = Math.max(
          backwardDistance,
          clearance - centerDistance,
        );
      }
      if (backwardDistance <= 0) continue;
      const shift = backwardDistance + 0.15;
      pedestrian.x -= Math.sin(pedestrian.heading) * shift;
      pedestrian.z -= Math.cos(pedestrian.heading) * shift;
      pedestrian.waiting = true;
    }
    return resolved;
  }

  private alignSampledPedestrianToSidewalk(
    pedestrian: PedestrianSnapshot,
  ): PedestrianSnapshot {
    const held = this.sampledPedestrianHolds.get(pedestrian.id);
    if (held) {
      const signal = this.controllers.get(held.intersectionId)?.getSnapshot();
      if (
        !held.committed
        && !pedestrian.violating
        && (
          this.intersectionOccupiedByVehicle(held.intersectionId)
          || (
            signal !== undefined
            && !pedestrianMayEnterCrossing(
              signal.pedestrianState,
              signal.pedestrianAxis,
              pedestrianAxisFromHeading(pedestrian.heading),
              false,
            )
          )
        )
      ) {
        return { ...held.snapshot, waiting: true };
      }
      held.committed = true;
    }
    const segment = this.roadSegments.get(pedestrian.segmentId);
    const geometry = this.segmentGeometry(pedestrian.segmentId);
    if (!segment || !geometry) {
      return held ? { ...held.snapshot, waiting: true } : pedestrian;
    }
    const movementX = Math.sin(pedestrian.heading);
    const movementZ = Math.cos(pedestrian.heading);
    const roadX = geometry.end.x - geometry.start.x;
    const roadZ = geometry.end.z - geometry.start.z;
    const forward = movementX * roadX + movementZ * roadZ >= 0;
    const start = forward ? geometry.start : geometry.end;
    const end = forward ? geometry.end : geometry.start;
    const projection = projectPointOntoSegment(
      pedestrian.x,
      pedestrian.z,
      start,
      end,
    );
    const length = Math.max(0.001, distance(start, end));
    const directionX = (end.x - start.x) / length;
    const directionZ = (end.z - start.z) / length;
    const projectedX = start.x + directionX * projection.distanceOnSegment;
    const projectedZ = start.z + directionZ * projection.distanceOnSegment;
    const signedOffset =
      -(pedestrian.x - projectedX) * directionZ
      + (pedestrian.z - projectedZ) * directionX;
    const side = Math.abs(signedOffset) > 0.1
      ? Math.sign(signedOffset)
      : pedestrian.id % 2 === 0 ? 1 : -1;
    const position = positionAlongPath(
      [start, end],
      0,
      projection.distanceOnSegment,
      (segment.totalWidthMeters / 2 + 3.65) * side,
    );
    const aligned = {
      ...pedestrian,
      x: position.x,
      z: position.z,
      heading: position.heading,
    };
    if (held) {
      this.sampledPedestrianHolds.delete(pedestrian.id);
    }
    const signalNode = length - projection.distanceOnSegment
        <= SAMPLED_PEDESTRIAN_STOP_DISTANCE_METERS
      ? this.nearestSignalNode(end.x, end.z)
      : null;
    const signal = signalNode
      ? this.controllers.get(signalNode.id)!.getSnapshot()
      : null;
    if (
      signalNode
      && signal
      && (
        this.intersectionOccupiedByVehicle(signalNode.id)
        || !pedestrianMayEnterCrossing(
          signal.pedestrianState,
          signal.pedestrianAxis,
          movementAxis(start, end),
          pedestrian.violating,
        )
      )
    ) {
      const waiting = { ...aligned, waiting: true };
      this.sampledPedestrianHolds.set(pedestrian.id, {
        snapshot: waiting,
        intersectionId: signalNode.id,
        committed: false,
      });
      return waiting;
    }
    return aligned;
  }

  private nearestSignalNode(
    x: number,
    z: number,
  ): EconomicRouteNode | null {
    let nearest: EconomicRouteNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [id, node] of this.economicRouteNodes) {
      if (!this.controllers.has(id)) continue;
      const candidateDistance = Math.hypot(node.x - x, node.z - z);
      if (candidateDistance < nearestDistance) {
        nearest = node;
        nearestDistance = candidateDistance;
      }
    }
    return nearestDistance <= 1.5 ? nearest : null;
  }

  private nearestIntersectionNode(
    x: number,
    z: number,
  ): EconomicRouteNode | null {
    let nearest: EconomicRouteNode | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.economicRouteNodes.values()) {
      const candidateDistance = Math.hypot(node.x - x, node.z - z);
      if (candidateDistance < nearestDistance) {
        nearest = node;
        nearestDistance = candidateDistance;
      }
    }
    return nearestDistance <= 1.5 ? nearest : null;
  }

  private segmentGeometry(
    segmentId: string,
  ): { start: AgentRouteNode; end: AgentRouteNode } | null {
    const expansionRoad = this.expansionRoads.find((road) =>
      road.id === segmentId
    );
    if (expansionRoad) {
      return {
        start: {
          id: `${segmentId}:start`,
          x: expansionRoad.startX,
          z: expansionRoad.startZ,
        },
        end: {
          id: `${segmentId}:end`,
          x: expansionRoad.endX,
          z: expansionRoad.endZ,
        },
      };
    }
    return STATIC_SEGMENT_GEOMETRY.get(segmentId) ?? null;
  }

  private updatePedestrianSpawner(
    deltaSeconds: number,
    demand: number,
    violationRiskMultiplier: number,
  ): void {
    const level = clampDemand(demand);
    this.nextPedestrianSpawnSeconds -= deltaSeconds;
    const target = Math.max(0, PEDESTRIAN_TARGETS[level] - this.sampledPedestrians.length);
    while (
      this.nextPedestrianSpawnSeconds <= 0 &&
      this.pedestrians.length < target
    ) {
      const route = this.createPedestrianRoute(level);
      if (this.canSpawnPedestrian(route.nodes)) {
        const segmentId = route.segmentIds[0] ?? "complete";
        const expansionTraveler = route.segmentIds.some((candidate) =>
          this.expansionRoadIds.has(candidate)
        );
        const complianceProbability = sampleComplianceProbability(
          this.random.next(),
        );
        this.pedestrians.push({
          id: this.nextPedestrianId,
          personId: expansionTraveler
            ? `ambient-person-${this.nextPedestrianId}`
            : undefined,
          displayName: expansionTraveler
            ? ambientCitizenName(this.nextPedestrianId)
            : undefined,
          path: route.nodes,
          segmentIds: route.segmentIds,
          segmentIndex: 0,
          distanceOnSegment: 0,
          speed: 0,
          desiredSpeed: pedestrianWalkingSpeedMetersPerSecond(
            this.random.next(),
          ),
          waiting: false,
          color: this.random.pick(PEDESTRIAN_COLORS),
          variant: this.random.integer(4),
          side: this.random.next() < 0.5 ? -1 : 1,
          spawnedAt: this.elapsedSeconds,
          waitSeconds: 0,
          committedIntersectionId: null,
          segmentId,
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
    const sampledBlockers = new Map<string, VehicleLeader[]>();
    for (const vehicle of this.sampledVehicles) {
      const segment = this.roadSegments.get(vehicle.segmentId);
      const geometry = this.segmentGeometry(vehicle.segmentId);
      const lane = segment?.lanes.find((candidate) =>
        candidate.id === vehicle.laneId
      );
      if (!segment || !geometry || !lane) continue;
      const start = lane.direction === "forward"
        ? geometry.start
        : geometry.end;
      const end = lane.direction === "forward"
        ? geometry.end
        : geometry.start;
      const blocker = {
        distanceOnSegment: projectPointOntoSegment(
          vehicle.x,
          vehicle.z,
          start,
          end,
        ).distanceOnSegment,
        length: vehicleLengthMeters(vehicle.kind),
      };
      const laneBlockers = sampledBlockers.get(lane.id) ?? [];
      laneBlockers.push(blocker);
      sampledBlockers.set(lane.id, laneBlockers);
    }
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
        const ambientLeader = bucket[index - 1];
        const sampledLeader = (sampledBlockers.get(vehicle.lane.id) ?? [])
          .filter((candidate) =>
            candidate.distanceOnSegment > vehicle.distanceOnSegment
          )
          .reduce<VehicleLeader | undefined>((nearest, candidate) =>
            !nearest
            || candidate.distanceOnSegment < nearest.distanceOnSegment
              ? candidate
              : nearest, undefined);
        const leader =
          ambientLeader
          && (
            !sampledLeader
            || ambientLeader.distanceOnSegment
              < sampledLeader.distanceOnSegment
          )
            ? ambientLeader
            : sampledLeader;
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
      if (this.continueVehicleToBoundary(vehicle)) return true;
      this.completedVehicleTrips += 1;
      this.completedVehicleTravelSeconds +=
        this.elapsedSeconds - vehicle.spawnedAt;
      this.completedVehicleDelaySeconds += vehicle.delaySeconds;
      if (this.isBuildingDestination(vehicle.path.at(-1))) {
        this.buildingArrivals += 1;
      }
      return false;
    });
  }

  private continueVehicleToBoundary(vehicle: VehicleAgent): boolean {
    const destination = vehicle.path.at(-1);
    if (!destination) return false;
    if (!isGridNode(destination)) {
      const route = findEconomicRoute(
        this.economicRouteNodes,
        this.expansionRoads,
        this.expansionSegmentNodes,
        this.nodes,
        { x: destination.x, z: destination.z },
        "outside-work",
        undefined,
      );
      const nodes = route.nodeIds
        .map((nodeId) => this.economicRouteNodes.get(nodeId))
        .filter((node): node is EconomicRouteNode => Boolean(node));
      if (
        nodes.length === route.nodeIds.length &&
        nodes.length >= 2 &&
        this.applyVehicleContinuation(vehicle, {
          nodes,
          segmentIds: route.segmentIds,
        })
      ) {
        return true;
      }
      return false;
    }
    if (
      destination.column === 0 ||
      destination.row === 0 ||
      destination.column === this.nodes.length - 1 ||
      destination.row === this.nodes[0].length - 1
    ) {
      return false;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const boundary = this.randomBoundaryNode();
      if (boundary.id === destination.id) continue;
      const route = this.findVehicleRoute(destination, boundary, 1.1);
      if (!route || route.length < 2) continue;
      const continuation = gridAgentRoute(route);
      if (this.applyVehicleContinuation(vehicle, continuation)) {
        if (this.isBuildingDestination(destination)) this.buildingArrivals += 1;
        return true;
      }
    }
    return false;
  }

  private applyVehicleContinuation(
    vehicle: VehicleAgent,
    continuation: Readonly<AgentRoute>,
  ): boolean {
    const assignment = this.laneForPath(
      continuation.nodes,
      continuation.segmentIds,
      0,
      vehicle.kind,
    );
    if (!assignment) return false;
    vehicle.path = continuation.nodes;
    vehicle.segmentIds = continuation.segmentIds;
    vehicle.segmentIndex = 0;
    vehicle.distanceOnSegment = 0;
    vehicle.segmentId = assignment.segment.id;
    vehicle.lane = assignment.lane;
    vehicle.queued = false;
    vehicle.segmentDelaySeconds = 0;
    vehicle.violationIntersectionId = null;
    return true;
  }

  private advanceVehicle(
    vehicle: VehicleAgent,
    leader: VehicleLeader | undefined,
    directionBuckets: ReadonlyMap<string, readonly VehicleAgent[]>,
    deltaSeconds: number,
  ): void {
    const start = vehicle.path[vehicle.segmentIndex];
    const end = vehicle.path[vehicle.segmentIndex + 1];
    if (!start || !end) return;
    const segmentLength = distance(start, end);
    const remaining = segmentLength - vehicle.distanceOnSegment;
    const stopCenterDistance = vehicleStopCenterDistance(vehicle.length);
    let mustStopBeforeIntersection = false;
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
    if (!finalNode && remaining < 40) {
      const controller = this.controllers.get(end.id);
      const signal = controller?.getSnapshot();
      const axis = Math.abs(end.x - start.x) > Math.abs(end.z - start.z) ? "x" : "z";
      const legalCanProceed =
        signal === undefined ||
        vehicleMayProceed(signal.phase, axis, remaining, vehicle.speed);
      const behaviorCanProceed =
        signal === undefined ||
        vehicleMayProceedWithBehavior(
          signal.phase,
          axis,
          remaining,
          vehicle.speed,
          vehicle.aggressiveYellow,
          vehicle.mayRunRed,
        );
      const alreadyCommitted = vehicle.committedIntersectionId === end.id;
      const vehicleKey = `background:${vehicle.id}`;
      const rightOfWayAvailable =
        alreadyCommitted || this.intersectionAvailable(end.id, vehicleKey);
      const canEnter =
        behaviorCanProceed
        && !this.intersectionHasCrossingPedestrian(end.id)
        && rightOfWayAvailable;
      if (
        !alreadyCommitted &&
        canEnter &&
        !legalCanProceed &&
        vehicle.violationIntersectionId !== end.id
      ) {
        vehicle.violationIntersectionId = end.id;
        vehicle.violatingUntilSeconds =
          this.elapsedSeconds + VIOLATION_FLASH_SECONDS;
        this.trafficViolations += 1;
      }
      const nextKey = nextVehicleSegmentDirectionKey(
        vehicle,
        this.expansionRoads,
      );
      const downstreamBlocked =
        nextKey !== null &&
        (directionBuckets.get(nextKey) ?? []).some(
          (candidate) => candidate.distanceOnSegment < 14,
        );
      const entryBlocked =
        !alreadyCommitted && (!canEnter || downstreamBlocked);
      if (entryBlocked) {
        mustStopBeforeIntersection = true;
        targetSpeed = Math.min(
          targetSpeed,
          Math.max(0, (remaining - stopCenterDistance) * 0.7),
        );
      } else {
        if (alreadyCommitted) {
          this.reserveIntersection(end.id, vehicleKey);
        }
        if (
          !alreadyCommitted &&
          remaining <=
            stopCenterDistance + Math.max(0.5, vehicle.speed * deltaSeconds)
        ) {
          vehicle.committedIntersectionId = end.id;
          this.reserveIntersection(end.id, vehicleKey);
        }
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
    if (vehicle.queued) {
      vehicle.delaySeconds += deltaSeconds;
      vehicle.segmentDelaySeconds += deltaSeconds;
    }
    let travel = vehicle.speed * deltaSeconds;
    if (mustStopBeforeIntersection) {
      travel = Math.min(
        travel,
        Math.max(0, remaining - stopCenterDistance),
      );
    }
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
      vehicle.segmentDelaySeconds = 0;
      vehicle.committedIntersectionId = null;
      if (vehicle.segmentIndex < vehicle.path.length - 1) {
        const assignment = this.laneForPath(
          vehicle.path,
          vehicle.segmentIds,
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
      if (signal) {
        const crossingAxis = movementAxis(start, end);
        const legalEntry = pedestrianMayEnterCrossing(
          signal.pedestrianState,
          signal.pedestrianAxis,
          crossingAxis,
          false,
        );
        if (
          pedestrian.committedIntersectionId === null &&
          legalEntry &&
          !this.intersectionOccupiedByVehicle(end.id)
        ) {
          pedestrian.committedIntersectionId = end.id;
        }
        if (
          pedestrian.committedIntersectionId === null &&
          !pedestrian.signalViolationUsed &&
          pedestrian.mayCrossAgainstSignal &&
          pedestrianMayEnterCrossing(
            signal.pedestrianState,
            signal.pedestrianAxis,
            crossingAxis,
            true,
          )
          && (
            signal.pedestrianState !== "walk"
            || signal.pedestrianAxis !== crossingAxis
          ) &&
          !this.intersectionOccupiedByVehicle(end.id)
        ) {
          pedestrian.committedIntersectionId = end.id;
          pedestrian.signalViolationUsed = true;
          pedestrian.violatingUntilSeconds =
            this.elapsedSeconds + VIOLATION_FLASH_SECONDS;
          this.trafficViolations += 1;
          this.jaywalkingViolations += 1;
        }
        if (
          pedestrian.committedIntersectionId !== end.id &&
          (
            !legalEntry
            || this.intersectionOccupiedByVehicle(end.id)
          )
        ) {
          targetSpeed = Math.min(
            targetSpeed,
            Math.max(0, (remaining - 3.2) * 0.8),
          );
        }
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
        pedestrian.segmentId =
          pedestrian.segmentIds[pedestrian.segmentIndex] ?? "complete";
      } else if (this.isBuildingDestination(segmentEnd)) {
        this.buildingArrivals += 1;
      }
    }
  }

  private isBuildingDestination(node: AgentRouteNode | undefined): boolean {
    return node !== undefined && this.buildingDestinationNodeIds.has(node.id);
  }

  private createVehicleRoute(demandLevel: number): AgentRoute {
    const corridorBias =
      demandLevel >= 3 ? 1.35 : demandLevel === 2 ? 1 : 0.72;
    const boundaryProbability =
      demandLevel >= 3 ? 0.76 : demandLevel === 2 ? 0.68 : 0.58;
    const expansionRoute = this.createExpansionAmbientRoute(
      "car",
      demandLevel >= 3 ? 0.42 : 0.3,
    );
    if (expansionRoute) return expansionRoute;
    if (this.buildingDestinations.length > 0 && this.random.next() < 0.72) {
      const destination = this.random.pick(this.buildingDestinations).node;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const origin = this.randomBoundaryNode();
        if (origin.id === destination.id) continue;
        const route = this.findVehicleRoute(origin, destination, corridorBias);
        if (route && route.length >= 2) return gridAgentRoute(route);
      }
    }
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
          return gridAgentRoute([...first, ...second.slice(1)]);
        }
      }
      const direct = this.findVehicleRoute(
        origin,
        destination,
        corridorBias,
      );
      if (direct && direct.length >= 6) return gridAgentRoute(direct);
    }
    return gridAgentRoute(
      this.findVehicleRoute(
        this.nodes[0][0],
        this.nodes[this.nodes.length - 1][this.nodes[0].length - 1],
      ) ?? [
        this.nodes[0][0],
        this.nodes[1][0],
        this.nodes[1][1],
      ],
    );
  }

  private createPedestrianRoute(demandLevel: number): AgentRoute {
    const destinationBias =
      demandLevel >= 3 ? 0.62 : demandLevel === 2 ? 0.44 : 0.28;
    const expansionRoute = this.createExpansionAmbientRoute(
      "walk",
      demandLevel >= 3 ? 0.48 : 0.34,
    );
    if (expansionRoute) return expansionRoute;
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
        return gridAgentRoute(createManhattanPath(
          this.nodes,
          origin,
          destination,
          this.random.next() < 0.5,
        ));
      }
    }
    return gridAgentRoute(createManhattanPath(
      this.nodes,
      this.nodes[1][1],
      this.nodes[this.nodes.length - 2][this.nodes[0].length - 2],
      false,
    ));
  }

  private createExpansionAmbientRoute(
    mode: TravelMode,
    probability: number,
  ): AgentRoute | null {
    if (
      this.expansionRoads.length === 0
      || this.random.next() >= probability
    ) {
      return null;
    }
    const connectedRoads = this.expansionRoads.filter((road) =>
      [...(this.expansionSegmentNodes.get(road.id) ?? [])].some((nodeId) =>
        this.connectedEconomicNodes.has(nodeId)
      )
    );
    if (connectedRoads.length === 0) return null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const road = this.random.pick(connectedRoads);
      const roadNodes = [...(this.expansionSegmentNodes.get(road.id) ?? [])]
        .map((nodeId) => this.economicRouteNodes.get(nodeId))
        .filter((node): node is EconomicRouteNode => Boolean(node));
      if (roadNodes.length === 0) continue;
      const roadNode = this.random.pick(roadNodes);
      const cityNode = this.randomBoundaryNode();
      const roadEndpoint = { x: roadNode.x, z: roadNode.z };
      const cityEndpoint = { x: cityNode.x, z: cityNode.z };
      const from = this.random.next() < 0.5 ? cityEndpoint : roadEndpoint;
      const to = from === cityEndpoint ? roadEndpoint : cityEndpoint;
      const route = findEconomicRoute(
        this.economicRouteNodes,
        this.expansionRoads,
        this.expansionSegmentNodes,
        this.nodes,
        from,
        to,
        mode === "walk" ? this.walkingEconomicEdges : undefined,
      );
      if (
        route.nodeIds.length < 2
        || !route.segmentIds.includes(road.id)
      ) {
        continue;
      }
      const nodes = route.nodeIds
        .map((nodeId) => this.economicRouteNodes.get(nodeId))
        .filter((node): node is EconomicRouteNode => Boolean(node));
      if (nodes.length === route.nodeIds.length) {
        return { nodes, segmentIds: route.segmentIds };
      }
    }
    return null;
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

  private randomVehicleSpawnDistance(
    route: Readonly<AgentRoute>,
    vehicleLength: number,
  ): number {
    const segmentLength = distance(route.nodes[0]!, route.nodes[1]!);
    const preferredClearance = vehicleStopCenterDistance(vehicleLength) + 2;
    const clearance = Math.min(preferredClearance, segmentLength / 3);
    return clearance
      + this.random.next() * Math.max(0, segmentLength - clearance * 2);
  }

  private canSpawnVehicle(
    laneId: string,
    distanceOnSegment: number,
    vehicleLength: number,
  ): boolean {
    const minimumGap = Math.max(10, vehicleLength + 4);
    return !this.vehicles.some(
      (vehicle) =>
        vehicle.lane.id === laneId
        && Math.abs(vehicle.distanceOnSegment - distanceOnSegment) < minimumGap,
    );
  }

  private canSpawnPedestrian(route: readonly AgentRouteNode[]): boolean {
    const key = `${route[0].id}>${route[1].id}`;
    return !this.pedestrians.some(
      (pedestrian) =>
        pedestrianSegmentKey(pedestrian) === key &&
        pedestrian.distanceOnSegment < 1.5,
    );
  }

  private intersectionHasCrossingPedestrian(intersectionId: string): boolean {
    return this.sampledCrossingIntersections.has(intersectionId)
      || this.pedestrians.some((pedestrian) =>
        pedestrian.committedIntersectionId === intersectionId
        && pedestrian.speed > 0.08
      );
  }

  private rebuildSampledCrossingIntersections(): void {
    this.sampledCrossingIntersections.clear();
    const pedestrianBuckets = new Map<string, PedestrianSnapshot[]>();
    for (const pedestrian of this.sampledPedestrians) {
      if (!pedestrian.waiting) addSpatialValue(pedestrianBuckets, pedestrian);
    }
    for (const intersectionId of this.controllers.keys()) {
      const node = this.economicRouteNodes.get(intersectionId);
      if (
        node
        && nearbySpatialValues(
          pedestrianBuckets,
          node.x,
          node.z,
        ).some((pedestrian) =>
          Math.hypot(pedestrian.x - node.x, pedestrian.z - node.z) <= 11
        )
      ) {
        this.sampledCrossingIntersections.add(intersectionId);
      }
    }
  }

  private intersectionOccupiedByVehicle(intersectionId: string): boolean {
    const reservation = this.intersectionReservations.get(intersectionId);
    return reservation !== undefined
      && reservation.expiresAtSeconds > this.elapsedSeconds;
  }

  private intersectionAvailable(
    intersectionId: string,
    vehicleKey: string,
  ): boolean {
    const reservation = this.intersectionReservations.get(intersectionId);
    return reservation === undefined
      || reservation.vehicleKey === vehicleKey
      || reservation.expiresAtSeconds <= this.elapsedSeconds;
  }

  private reserveIntersection(
    intersectionId: string,
    vehicleKey: string,
  ): void {
    this.intersectionReservations.set(intersectionId, {
      vehicleKey,
      expiresAtSeconds:
        this.elapsedSeconds + INTERSECTION_CLEARANCE_SECONDS,
    });
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
    path: readonly AgentRouteNode[],
    segmentIds: readonly string[],
    segmentIndex: number,
    kind: VehicleKind,
  ): { segment: RoadSegmentModel; lane: RoadLane } | undefined {
    const start = path[segmentIndex];
    const end = path[segmentIndex + 1];
    if (!start || !end) return undefined;
    const segmentId = segmentIds[segmentIndex];
    if (!segmentId) return undefined;
    const segment = this.roadSegments.get(segmentId);
    if (!segment) return undefined;
    const movement = movementAt(path, segmentIndex + 1);
    const direction = routeSegmentDirection(
      segmentId,
      start,
      end,
      this.expansionRoads,
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

function gridAgentRoute(nodes: readonly GridNode[]): AgentRoute {
  return {
    nodes,
    segmentIds: nodes.slice(0, -1).map((node, index) => {
      const next = nodes[index + 1];
      return segmentIdBetween(node.column, node.row, next.column, next.row);
    }),
  };
}

function isGridNode(
  node: AgentRouteNode | undefined,
): node is GridNode {
  return node?.column !== undefined && node.row !== undefined;
}

function routeSegmentDirection(
  segmentId: string,
  start: Readonly<AgentRouteNode>,
  end: Readonly<AgentRouteNode>,
  expansionRoads: readonly ExpansionRoad[],
): LaneTravelDirection {
  const expansionRoad = expansionRoads.find((road) => road.id === segmentId);
  if (expansionRoad) {
    const routeX = end.x - start.x;
    const routeZ = end.z - start.z;
    const roadX = expansionRoad.endX - expansionRoad.startX;
    const roadZ = expansionRoad.endZ - expansionRoad.startZ;
    return routeX * roadX + routeZ * roadZ >= 0 ? "forward" : "reverse";
  }
  const feature = PENN_ROAD_GRAPH.find((candidate) => candidate.id === segmentId);
  if (feature?.axis === "x") return end.x <= start.x ? "forward" : "reverse";
  if (feature?.axis === "z") return end.z >= start.z ? "forward" : "reverse";
  return end.x < start.x || end.z > start.z ? "forward" : "reverse";
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

function nearestGridNodeFromWorld(
  nodes: readonly (readonly GridNode[])[],
  x: number,
  z: number,
): GridNode {
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

function expansionRoadModel(road: Readonly<ExpansionRoad>): RoadSegmentModel {
  const model = createRoadSegmentModel(
    {
      id: road.id,
      kind: "street",
      name: expansionRoadDisplayName(road),
      description: "User-built expansion road",
      axis: Math.abs(road.endX - road.startX) >= Math.abs(road.endZ - road.startZ)
        ? "x"
        : "z",
      path: [
        { longitude: 0, latitude: 0 },
        { longitude: 0, latitude: 0 },
      ],
    },
    {
      laneDelta: road.laneDelta,
      bikeLane: road.bikeLane,
      laneDirection: road.laneDirection,
    },
  );
  return {
    ...model,
    totalWidthMeters: road.width,
    speedLimitMph: 25,
    demandWeight: 0.9 + (road.laneDelta ?? 0) * 0.18,
  };
}

function buildEconomicRouteGraph(
  grid: readonly (readonly GridNode[])[],
  roadSegments: ReadonlyMap<string, RoadSegmentModel>,
  expansionRoads: readonly ExpansionRoad[],
  buildingEndpoints: readonly BuildingDestinationInput[] = [],
): {
  nodes: Map<string, EconomicRouteNode>;
  expansionSegmentNodes: Map<string, Set<string>>;
  connectedNodeIds: Set<string>;
} {
  const nodes = new Map<string, EconomicRouteNode>();
  const nodesByCoordinate = new Map<string, EconomicRouteNode>();
  const expansionSegmentNodes = new Map<string, Set<string>>();
  const coordinateKey = (x: number, z: number): string =>
    `${Math.round(x * 10)}:${Math.round(z * 10)}`;
  const addNode = (id: string, x: number, z: number, staticNode: boolean): EconomicRouteNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const existingAtCoordinate = nodesByCoordinate.get(coordinateKey(x, z));
    if (existingAtCoordinate) {
      if (staticNode) existingAtCoordinate.staticNode = true;
      return existingAtCoordinate;
    }
    const node = { id, x, z, staticNode, edges: [] };
    nodes.set(id, node);
    nodesByCoordinate.set(coordinateKey(x, z), node);
    return node;
  };
  const addEdge = (from: string, to: string, segmentId: string, cost: number): void => {
    const node = nodes.get(from);
    if (!node || node.edges.some((edge) => edge.to === to && edge.segmentId === segmentId)) return;
    node.edges.push({ to, segmentId, cost });
  };

  for (const gridNode of grid.flat()) {
    addNode(gridNode.id, gridNode.x, gridNode.z, true);
  }
  const baseSections: Array<{
    start: GridNode;
    end: GridNode;
    road: ExpansionRoad;
    segment: RoadSegmentModel;
  }> = [];
  for (const gridNode of grid.flat()) {
    for (const neighbor of adjacentNodes(grid, gridNode)) {
      if (
        neighbor.column < gridNode.column
        || neighbor.row < gridNode.row
      ) continue;
      const segmentId = segmentIdBetween(
        gridNode.column,
        gridNode.row,
        neighbor.column,
        neighbor.row,
      );
      const segment = roadSegments.get(segmentId);
      if (!segment) continue;
      baseSections.push({
        start: gridNode,
        end: neighbor,
        road: {
          id: segmentId,
          startX: gridNode.x,
          startZ: gridNode.z,
          endX: neighbor.x,
          endZ: neighbor.z,
          width: segment.totalWidthMeters,
          laneDelta: 0,
          bikeLane: false,
          widenedSidewalk: false,
          laneDirection: segment.directionality,
        },
        segment,
      });
    }
  }
  for (const gridNode of grid.flat()) {
    for (const neighbor of adjacentNodes(grid, gridNode)) {
      const segmentId = segmentIdBetween(
        gridNode.column,
        gridNode.row,
        neighbor.column,
        neighbor.row,
      );
      const segment = roadSegments.get(segmentId);
      if (!segment) continue;
      const direction = travelDirectionBetween(
        gridNode.column,
        gridNode.row,
        neighbor.column,
        neighbor.row,
      );
      if (!roadAllowsDirection(segment, direction)) continue;
      addEdge(
        gridNode.id,
        neighbor.id,
        segmentId,
        distance(gridNode, neighbor) / Math.max(0.65, segment.demandWeight),
      );
    }
  }

  const pointsByRoad = new Map<string, Array<{ x: number; z: number; t: number }>>();
  for (const road of expansionRoads) {
    pointsByRoad.set(road.id, [
      { x: road.startX, z: road.startZ, t: 0 },
      { x: road.endX, z: road.endZ, t: 1 },
    ]);
    for (const base of baseSections) {
      const intersection = roadIntersection(road, base.road);
      if (!intersection) continue;
      pointsByRoad.get(road.id)?.push({
        ...intersection,
        t: roadPosition(road, intersection.x, intersection.z),
      });
    }
  }
  for (const building of buildingEndpoints) {
    const access = expansionAccessRoad(
      grid,
      expansionRoads,
      building.x,
      building.z,
    );
    if (!access) continue;
    const t = roadPosition(access.road, building.x, building.z);
    pointsByRoad.get(access.road.id)?.push({
      x: access.road.startX + (access.road.endX - access.road.startX) * t,
      z: access.road.startZ + (access.road.endZ - access.road.startZ) * t,
      t,
    });
  }
  for (let leftIndex = 0; leftIndex < expansionRoads.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < expansionRoads.length; rightIndex += 1) {
      const intersection = roadIntersection(
        expansionRoads[leftIndex],
        expansionRoads[rightIndex],
      );
      if (!intersection) continue;
      pointsByRoad.get(expansionRoads[leftIndex].id)?.push({
        ...intersection,
        t: roadPosition(expansionRoads[leftIndex], intersection.x, intersection.z),
      });
      pointsByRoad.get(expansionRoads[rightIndex].id)?.push({
        ...intersection,
        t: roadPosition(expansionRoads[rightIndex], intersection.x, intersection.z),
      });
    }
  }

  const routeNodeForPoint = (x: number, z: number): EconomicRouteNode => {
    const existing = nodesByCoordinate.get(coordinateKey(x, z));
    if (existing) return existing;
    const base = baseSections.find((section) =>
      distanceToRoad(x, z, section.road) <= 1.5
    );
    if (base) {
      const progress = roadPosition(base.road, x, z);
      if (progress <= 0.001) {
        return nodes.get(base.start.id) as EconomicRouteNode;
      }
      if (progress >= 0.999) {
        return nodes.get(base.end.id) as EconomicRouteNode;
      }
      const node = addNode(
        `base-junction:${base.road.id}:${coordinateKey(x, z)}`,
        x,
        z,
        true,
      );
      const forward = travelDirectionBetween(
        base.start.column,
        base.start.row,
        base.end.column,
        base.end.row,
      );
      const reverse = travelDirectionBetween(
        base.end.column,
        base.end.row,
        base.start.column,
        base.start.row,
      );
      const startCost = Math.hypot(x - base.start.x, z - base.start.z)
        / Math.max(0.65, base.segment.demandWeight);
      const endCost = Math.hypot(base.end.x - x, base.end.z - z)
        / Math.max(0.65, base.segment.demandWeight);
      if (roadAllowsDirection(base.segment, forward)) {
        addEdge(base.start.id, node.id, base.road.id, startCost);
        addEdge(node.id, base.end.id, base.road.id, endCost);
      }
      if (roadAllowsDirection(base.segment, reverse)) {
        addEdge(base.end.id, node.id, base.road.id, endCost);
        addEdge(node.id, base.start.id, base.road.id, startCost);
      }
      return node;
    }
    const id = `expansion-node:${coordinateKey(x, z)}`;
    return addNode(id, x, z, false);
  };

  for (const road of expansionRoads) {
    const segment = roadSegments.get(road.id);
    if (!segment) continue;
    const uniquePoints = [...new Map(
      (pointsByRoad.get(road.id) ?? []).map((point) => [
        `${Math.round(point.x * 10)}:${Math.round(point.z * 10)}`,
        point,
      ]),
    ).values()].sort((left, right) => left.t - right.t);
    const routeNodes = uniquePoints.map((point) => routeNodeForPoint(point.x, point.z));
    expansionSegmentNodes.set(road.id, new Set(routeNodes.map((node) => node.id)));
    for (let index = 0; index < routeNodes.length - 1; index += 1) {
      const start = routeNodes[index];
      const end = routeNodes[index + 1];
      if (start.id === end.id) continue;
      const cost = Math.hypot(end.x - start.x, end.z - start.z)
        / Math.max(0.65, segment.demandWeight);
      if (segment.directionality !== "reverse") addEdge(start.id, end.id, road.id, cost);
      if (segment.directionality !== "forward") addEdge(end.id, start.id, road.id, cost);
    }
  }

  const connectedNodeIds = new Set<string>();
  const queue = [...nodes.values()].filter((node) => node.staticNode).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (connectedNodeIds.has(id)) continue;
    connectedNodeIds.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const edge of node.edges) {
      if (!connectedNodeIds.has(edge.to)) queue.push(edge.to);
    }
    for (const candidate of nodes.values()) {
      if (candidate.edges.some((edge) => edge.to === id) && !connectedNodeIds.has(candidate.id)) {
        queue.push(candidate.id);
      }
    }
  }
  return { nodes, expansionSegmentNodes, connectedNodeIds };
}

function bidirectionalEconomicEdges(
  nodes: ReadonlyMap<string, EconomicRouteNode>,
): Map<string, EconomicRouteEdge[]> {
  const edges = new Map<string, EconomicRouteEdge[]>();
  for (const node of nodes.values()) {
    edges.set(node.id, [...node.edges]);
  }
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      const reverse = edges.get(edge.to) ?? [];
      if (!reverse.some((candidate) =>
        candidate.to === node.id && candidate.segmentId === edge.segmentId
      )) {
        reverse.push({
          to: node.id,
          segmentId: edge.segmentId,
          cost: edge.cost,
        });
      }
      edges.set(edge.to, reverse);
    }
  }
  return edges;
}

function economicRouteSegmentIds(
  nodes: ReadonlyMap<string, EconomicRouteNode>,
  expansionRoads: readonly ExpansionRoad[],
  expansionSegmentNodes: ReadonlyMap<string, ReadonlySet<string>>,
  grid: readonly (readonly GridNode[])[],
  from: TrafficRouteEndpoint,
  to: TrafficRouteEndpoint,
): string[] {
  return findEconomicRoute(
    nodes,
    expansionRoads,
    expansionSegmentNodes,
    grid,
    from,
    to,
    undefined,
  ).segmentIds.filter((segmentId, index, segments) =>
    segmentId !== segments[index - 1]
  );
}

function findEconomicRoute(
  nodes: ReadonlyMap<string, EconomicRouteNode>,
  expansionRoads: readonly ExpansionRoad[],
  expansionSegmentNodes: ReadonlyMap<string, ReadonlySet<string>>,
  grid: readonly (readonly GridNode[])[],
  from: TrafficRouteEndpoint,
  to: TrafficRouteEndpoint,
  routeEdges: ReadonlyMap<string, readonly EconomicRouteEdge[]> | undefined,
): EconomicRoute {
  const originIds = economicEndpointNodes(
    nodes,
    expansionRoads,
    expansionSegmentNodes,
    grid,
    from,
  );
  const destinationIds = new Set(economicEndpointNodes(
    nodes,
    expansionRoads,
    expansionSegmentNodes,
    grid,
    to,
  ));
  if (originIds.length === 0 || destinationIds.size === 0) {
    return { nodeIds: [], segmentIds: [] };
  }
  const open = new Set(originIds);
  const costs = new Map(originIds.map((id) => [id, 0]));
  const previous = new Map<string, { nodeId: string; segmentId: string }>();
  let destination: string | null = null;
  while (open.size > 0) {
    let current: string | null = null;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const candidate of open) {
      const cost = costs.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (cost < currentCost) {
        current = candidate;
        currentCost = cost;
      }
    }
    if (!current) break;
    if (destinationIds.has(current)) {
      destination = current;
      break;
    }
    open.delete(current);
    for (
      const edge of routeEdges?.get(current)
        ?? nodes.get(current)?.edges
        ?? []
    ) {
      const nextCost = currentCost + edge.cost;
      if (nextCost >= (costs.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(edge.to, nextCost);
      previous.set(edge.to, { nodeId: current, segmentId: edge.segmentId });
      open.add(edge.to);
    }
  }
  if (!destination) return { nodeIds: [], segmentIds: [] };
  const nodeIds = [destination];
  const segmentIds: string[] = [];
  let current = destination;
  while (previous.has(current)) {
    const step = previous.get(current) as { nodeId: string; segmentId: string };
    nodeIds.unshift(step.nodeId);
    segmentIds.unshift(step.segmentId);
    current = step.nodeId;
  }
  return { nodeIds, segmentIds };
}

function economicRoutePath(
  nodes: ReadonlyMap<string, EconomicRouteNode>,
  route: Readonly<EconomicRoute>,
): TrafficRoutePath {
  const points: Array<{ x: number; z: number }> = [];
  const segmentIds: string[] = [];
  const append = (
    point: Readonly<{ x: number; z: number }>,
    segmentId: string,
  ): void => {
    const previous = points.at(-1);
    if (
      previous
      && Math.hypot(previous.x - point.x, previous.z - point.z) <= 0.1
    ) return;
    if (previous) segmentIds.push(segmentId);
    points.push({ x: point.x, z: point.z });
  };
  for (let index = 0; index < route.nodeIds.length; index += 1) {
    const node = nodes.get(route.nodeIds[index]);
    if (!node) continue;
    append(
      node,
      route.segmentIds[Math.max(0, index - 1)]
        ?? route.segmentIds[0]
        ?? "off-network",
    );
  }
  return {
    points,
    segmentIds,
    distanceMeters: points.slice(1).reduce((total, point, index) =>
      total + Math.hypot(
        point.x - points[index].x,
        point.z - points[index].z,
      ), 0),
  };
}

function economicEndpointNodes(
  nodes: ReadonlyMap<string, EconomicRouteNode>,
  expansionRoads: readonly ExpansionRoad[],
  expansionSegmentNodes: ReadonlyMap<string, ReadonlySet<string>>,
  grid: readonly (readonly GridNode[])[],
  endpoint: TrafficRouteEndpoint,
): string[] {
  if (typeof endpoint === "string") {
    const boundary = grid.flat().filter((node) =>
      node.column === 0 || node.row === 0
      || node.column === grid.length - 1
      || node.row === grid[0].length - 1
    );
    const node = endpoint === "outside-market" ? boundary[0] : boundary.at(-1);
    return node ? [node.id] : [];
  }
  const access = expansionAccessRoad(
    grid,
    expansionRoads,
    endpoint.x,
    endpoint.z,
  );
  if (access) {
    return [...(expansionSegmentNodes.get(access.road.id) ?? [])]
      .sort((left, right) => {
        const leftNode = nodes.get(left);
        const rightNode = nodes.get(right);
        return Math.hypot((leftNode?.x ?? 0) - endpoint.x, (leftNode?.z ?? 0) - endpoint.z)
          - Math.hypot((rightNode?.x ?? 0) - endpoint.x, (rightNode?.z ?? 0) - endpoint.z);
      })
      .slice(0, 1);
  }
  const nearestStatic = nearestGridNodeFromWorld(grid, endpoint.x, endpoint.z);
  const xs = grid.flat().map((node) => node.x);
  const zs = grid.flat().map((node) => node.z);
  const insideCore = endpoint.x >= Math.min(...xs) - 100
    && endpoint.x <= Math.max(...xs) + 100
    && endpoint.z >= Math.min(...zs) - 100
    && endpoint.z <= Math.max(...zs) + 100;
  return insideCore ? [nearestStatic.id] : [];
}

function roadAllowsDirection(
  segment: Readonly<RoadSegmentModel>,
  direction: LaneTravelDirection,
): boolean {
  return segment.lanes.some((lane) =>
    (lane.type === "general" || lane.type === "turn" || lane.type === "bus")
    && lane.direction === direction
  );
}

function roadIntersection(
  left: Readonly<ExpansionRoad>,
  right: Readonly<ExpansionRoad>,
): { x: number; z: number } | null {
  const leftHorizontal = Math.abs(left.endX - left.startX) >= Math.abs(left.endZ - left.startZ);
  const rightHorizontal = Math.abs(right.endX - right.startX) >= Math.abs(right.endZ - right.startZ);
  if (leftHorizontal === rightHorizontal) return null;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const x = vertical.startX;
  const z = horizontal.startZ;
  const withinHorizontal = x >= Math.min(horizontal.startX, horizontal.endX) - 1
    && x <= Math.max(horizontal.startX, horizontal.endX) + 1;
  const withinVertical = z >= Math.min(vertical.startZ, vertical.endZ) - 1
    && z <= Math.max(vertical.startZ, vertical.endZ) + 1;
  return withinHorizontal && withinVertical ? { x, z } : null;
}

function roadPosition(
  road: Readonly<ExpansionRoad>,
  x: number,
  z: number,
): number {
  const dx = road.endX - road.startX;
  const dz = road.endZ - road.startZ;
  const lengthSquared = dx * dx + dz * dz;
  return lengthSquared <= 0
    ? 0
    : clamp(((x - road.startX) * dx + (z - road.startZ) * dz) / lengthSquared, 0, 1);
}

function distanceToRoad(
  x: number,
  z: number,
  road: Readonly<ExpansionRoad>,
): number {
  const t = roadPosition(road, x, z);
  return Math.hypot(
    x - (road.startX + (road.endX - road.startX) * t),
    z - (road.startZ + (road.endZ - road.startZ) * t),
  );
}

function expansionAccessRoad(
  grid: readonly (readonly GridNode[])[],
  roads: readonly ExpansionRoad[],
  x: number,
  z: number,
): { road: ExpansionRoad; distance: number } | null {
  const nearest = roads
    .map((road) => ({ road, distance: distanceToRoad(x, z, road) }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest) return null;
  const maximumAccessDistance = Math.max(48, nearest.road.width * 2.5);
  const nativeRoadDistance = distanceToNativeRoad(grid, x, z);
  return nearest.distance <= maximumAccessDistance
      && nearest.distance + 4 < nativeRoadDistance
    ? nearest
    : null;
}

function distanceToNativeRoad(
  grid: readonly (readonly GridNode[])[],
  x: number,
  z: number,
): number {
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let column = 0; column < grid.length; column += 1) {
    for (let row = 0; row < grid[column].length; row += 1) {
      const start = grid[column][row];
      for (const end of [
        grid[column + 1]?.[row],
        grid[column]?.[row + 1],
      ]) {
        if (!end) continue;
        nearestDistance = Math.min(
          nearestDistance,
          projectPointOntoSegment(x, z, start, end).distance,
        );
      }
    }
  }
  return nearestDistance;
}

function projectPointOntoSegment(
  x: number,
  z: number,
  start: Readonly<{ x: number; z: number }>,
  end: Readonly<{ x: number; z: number }>,
): { distance: number; distanceOnSegment: number } {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const progress = length <= 0
    ? 0
    : clamp(
        ((x - start.x) * dx + (z - start.z) * dz) / (length * length),
        0,
        1,
      );
  return {
    distance: Math.hypot(
      x - (start.x + dx * progress),
      z - (start.z + dz * progress),
    ),
    distanceOnSegment: Math.min(
      Math.max(0, length - 0.5),
      progress * length,
    ),
  };
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
  return timing.allRedSeconds;
}

function pedestrianIndication(
  phase: SignalPhase,
  phaseElapsed: number,
  timing: Readonly<SignalTiming>,
): {
  state: PedestrianSignalState;
  axis: "x" | "z" | null;
  timeRemainingSeconds: number | null;
} {
  const axis = phase === "ns-green"
    ? "z"
    : phase === "ew-green"
      ? "x"
      : null;
  if (axis === null) {
    return {
      state: "dont-walk",
      axis: null,
      timeRemainingSeconds: null,
    };
  }
  const greenSeconds = phase === "ns-green"
    ? timing.northSouthGreenSeconds
    : timing.eastWestGreenSeconds;
  const pedestrianSeconds = Math.min(timing.pedestrianSeconds, greenSeconds);
  const walkSeconds = Math.min(7, Math.max(3, pedestrianSeconds - 3));
  if (phaseElapsed < walkSeconds) {
    return {
      state: "walk",
      axis,
      timeRemainingSeconds: walkSeconds - phaseElapsed,
    };
  }
  if (phaseElapsed < pedestrianSeconds) {
    return {
      state: "flashing-dont-walk",
      axis,
      timeRemainingSeconds: pedestrianSeconds - phaseElapsed,
    };
  }
  return {
    state: "dont-walk",
    axis,
    timeRemainingSeconds: Math.max(0, greenSeconds - phaseElapsed),
  };
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

export function pedestrianMayEnterCrossing(
  state: PedestrianSignalState,
  signalAxis: "x" | "z" | null,
  crossingAxis: "x" | "z",
  lawBreaker: boolean,
): boolean {
  return (state === "walk" && signalAxis === crossingAxis) || lawBreaker;
}

function movementAxis(
  start: Pick<PositionedAgent, "x" | "z">,
  end: Pick<PositionedAgent, "x" | "z">,
): "x" | "z" {
  return Math.abs(end.x - start.x) >= Math.abs(end.z - start.z) ? "x" : "z";
}

function pedestrianAxisFromHeading(heading: number): "x" | "z" {
  return Math.abs(Math.sin(heading)) >= Math.abs(Math.cos(heading)) ? "x" : "z";
}

function smoothSampledVehicleMovement(
  previous: Readonly<VehicleSnapshot>,
  current: Readonly<VehicleSnapshot>,
  maximumDistance: number,
): VehicleSnapshot {
  const deltaX = current.x - previous.x;
  const deltaZ = current.z - previous.z;
  const displacement = Math.hypot(deltaX, deltaZ);
  if (displacement <= maximumDistance) return { ...current };
  if (
    previous.segmentId === current.segmentId
    && previous.laneId === current.laneId
  ) {
    return {
      ...current,
      x: previous.x + deltaX / displacement * maximumDistance,
      z: previous.z + deltaZ / displacement * maximumDistance,
      heading: previous.heading,
    };
  }
  const previousAxis =
    Math.abs(Math.sin(previous.heading)) >= Math.abs(Math.cos(previous.heading))
      ? "x"
      : "z";
  const primaryDelta = previousAxis === "x" ? deltaX : deltaZ;
  const secondaryDelta = previousAxis === "x" ? deltaZ : deltaX;
  const primaryStep =
    Math.sign(primaryDelta)
    * Math.min(maximumDistance, Math.abs(primaryDelta));
  const remaining = maximumDistance - Math.abs(primaryStep);
  const secondaryStep =
    Math.sign(secondaryDelta) * Math.min(remaining, Math.abs(secondaryDelta));
  const turned = Math.abs(secondaryStep) > 0.001;
  return {
    ...current,
    segmentId: turned ? current.segmentId : previous.segmentId,
    laneId: turned ? current.laneId : previous.laneId,
    x: previous.x + (previousAxis === "x" ? primaryStep : secondaryStep),
    z: previous.z + (previousAxis === "z" ? primaryStep : secondaryStep),
    heading: turned ? current.heading : previous.heading,
  };
}

function smoothSampledPedestrianCorner(
  previous: Readonly<PedestrianSnapshot>,
  current: Readonly<PedestrianSnapshot>,
  maximumDistance: number,
): PedestrianSnapshot {
  const deltaX = current.x - previous.x;
  const deltaZ = current.z - previous.z;
  if (Math.hypot(deltaX, deltaZ) <= maximumDistance) return { ...current };
  const previousAxis = pedestrianAxisFromHeading(previous.heading);
  const primaryDelta = previousAxis === "x" ? deltaX : deltaZ;
  const secondaryDelta = previousAxis === "x" ? deltaZ : deltaX;
  const primaryStep =
    Math.sign(primaryDelta)
    * Math.min(maximumDistance, Math.abs(primaryDelta));
  const remaining = maximumDistance - Math.abs(primaryStep);
  const secondaryStep =
    Math.sign(secondaryDelta) * Math.min(remaining, Math.abs(secondaryDelta));
  const movedOnSecondaryAxis = Math.abs(secondaryStep) > 0.001;
  return {
    ...current,
    segmentId: movedOnSecondaryAxis ? current.segmentId : previous.segmentId,
    x: previous.x + (previousAxis === "x" ? primaryStep : secondaryStep),
    z: previous.z + (previousAxis === "z" ? primaryStep : secondaryStep),
    heading: movedOnSecondaryAxis
      ? current.heading
      : previous.heading,
    waiting: false,
  };
}

export function pedestrianWalkingSpeedMetersPerSecond(sample: number): number {
  return 1.15 + clamp(sample, 0, 1) * 0.3;
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

export function vehicleStopCenterDistance(vehicleLength: number): number {
  return INTERSECTION_STOP_LINE_DISTANCE_METERS
    + Math.max(0, vehicleLength) / 2;
}

export function physicalLaneCount(laneDelta: -1 | 0 | 1): 1 | 2 {
  return laneDelta === 1 ? 2 : 1;
}

export function laneDirectionAllowsMovement(
  direction: LaneDirection,
  forward: boolean,
): boolean {
  if (direction === "two-way") return true;
  return direction === "forward" ? forward : !forward;
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

function positionPedestrian(
  pedestrian: PedestrianAgent,
  segment: RoadSegmentModel | undefined,
): PositionedAgent {
  const sidewalkOffset = (segment?.totalWidthMeters ?? 15) / 2 + 3.65;
  return positionAlongPath(
    pedestrian.path,
    pedestrian.segmentIndex,
    pedestrian.distanceOnSegment,
    sidewalkOffset * pedestrian.side,
  );
}

function positionAlongPath(
  path: readonly AgentRouteNode[],
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

const AGENT_SPATIAL_BUCKET_METERS = 10;

function addSpatialValue<T extends Readonly<{ x: number; z: number }>>(
  buckets: Map<string, T[]>,
  value: T,
): void {
  const key = spatialBucketKey(value.x, value.z);
  const bucket = buckets.get(key) ?? [];
  bucket.push(value);
  buckets.set(key, bucket);
}

function nearbySpatialValues<T>(
  buckets: ReadonlyMap<string, readonly T[]>,
  x: number,
  z: number,
): T[] {
  const column = Math.floor(x / AGENT_SPATIAL_BUCKET_METERS);
  const row = Math.floor(z / AGENT_SPATIAL_BUCKET_METERS);
  const nearby: T[] = [];
  for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      nearby.push(...(
        buckets.get(`${column + columnOffset}:${row + rowOffset}`) ?? []
      ));
    }
  }
  return nearby;
}

function spatialBucketKey(x: number, z: number): string {
  return `${Math.floor(x / AGENT_SPATIAL_BUCKET_METERS)}:${
    Math.floor(z / AGENT_SPATIAL_BUCKET_METERS)
  }`;
}

function vehicleSegmentKey(vehicle: VehicleAgent): string {
  return vehicle.lane.id;
}

function vehicleSegmentDirectionKey(vehicle: VehicleAgent): string {
  return `${vehicle.segmentId}:${directionForVehicle(vehicle)}`;
}

function nextVehicleSegmentDirectionKey(
  vehicle: VehicleAgent,
  expansionRoads: readonly ExpansionRoad[],
): string | null {
  const start = vehicle.path[vehicle.segmentIndex + 1];
  const end = vehicle.path[vehicle.segmentIndex + 2];
  if (!start || !end) return null;
  const segmentId = vehicle.segmentIds[vehicle.segmentIndex + 1];
  if (!segmentId) return null;
  return `${segmentId}:${routeSegmentDirection(
    segmentId,
    start,
    end,
    expansionRoads,
  )}`;
}

function pedestrianSegmentKey(pedestrian: PedestrianAgent): string {
  const start = pedestrian.path[pedestrian.segmentIndex];
  const end = pedestrian.path[pedestrian.segmentIndex + 1];
  return start && end ? `${start.id}>${end.id}` : `complete-${pedestrian.id}`;
}

function directionForVehicle(vehicle: VehicleAgent): LaneTravelDirection {
  return vehicle.lane.direction;
}

function movementAt(
  path: readonly AgentRouteNode[],
  intersectionIndex: number,
): LaneMovement {
  const previous = path[intersectionIndex - 1];
  const current = path[intersectionIndex];
  const next = path[intersectionIndex + 1];
  if (!previous || !current || !next) return "straight";
  const incomingX = -(current.x - previous.x);
  const incomingZ = current.z - previous.z;
  const outgoingX = -(next.x - current.x);
  const outgoingZ = next.z - current.z;
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

function ambientCitizenName(index: number): string {
  const firstNames = [
    "Avery",
    "Jordan",
    "Maya",
    "Daniel",
    "Sofia",
    "Eli",
    "Nora",
    "Marcus",
    "Priya",
    "Leo",
    "Camila",
    "Noah",
  ];
  const lastNames = [
    "Carter",
    "Kim",
    "Patel",
    "Lewis",
    "Nguyen",
    "Rivera",
    "Brooks",
    "Chen",
    "Johnson",
    "Ahmed",
    "Martin",
    "Wilson",
  ];
  return `${firstNames[index % firstNames.length]} ${
    lastNames[Math.floor(index / firstNames.length) % lastNames.length]
  }`;
}

function manhattanDistance(a: GridNode, b: GridNode): number {
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

function distance(
  a: Readonly<{ x: number; z: number }>,
  b: Readonly<{ x: number; z: number }>,
): number {
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
