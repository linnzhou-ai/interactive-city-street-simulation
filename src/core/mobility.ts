import type {
  AgeGroup,
  Building,
  Pedestrian,
  RoutePoint,
  SignalPhase,
  StreetNetwork,
  TravelDirection,
  TripRequest,
  Vehicle,
  VehicleType,
} from "../models/types";
import {
  EAST_BUS_STOP_NODE_ID,
  WEST_BUS_STOP_NODE_ID,
  buildStreetNetwork,
  findRoute,
  planRoute,
  planRouteBetweenNodes,
  type MobilityNetwork,
  type MobilityNetworkEdge,
  type RoutePlan,
} from "./network";

const MAX_STEP_SECONDS = 0.1;
const MPH_TO_METERS_PER_SECOND = 0.44704;
const METERS_PER_SECOND_TO_MPH = 1 / MPH_TO_METERS_PER_SECOND;
const STOP_LINE_BUFFER_METERS = 0.5;
const EPSILON = 1e-9;

export interface MobilityConfig {
  roadCapacity: number;
  speedLimitMph: number;
  safeFollowingGapMeters: number;
  busHeadwayMinutes: number;
  busCapacity: number;
  busDwellSeconds: number;
  maxActiveBuses: number;
}

export interface MobilityCounters {
  completedVehicles: number;
  completedFreight: number;
  completedService: number;
  completedPedestrians: number;
  completedTransitTrips: number;
  transitRidership: number;
  potentialConflicts: number;
  averageVehicleTravelSeconds: number;
  averagePedestrianWaitSeconds: number;
  averageTransitWaitMinutes: number;
}

export interface MobilitySnapshot {
  elapsedSeconds: number;
  signalPhase: SignalPhase;
  vehicles: Vehicle[];
  pedestrians: Pedestrian[];
  busQueueLength: number;
  busPassengersOnBoard: number;
  roadVolume: number;
  roadCongestionPercent: number;
  redLightQueue: number;
  pedestrianSignalWaiters: number;
  counters: MobilityCounters;
}

export interface ConsumeTripsResult {
  accepted: number;
  rejected: string[];
}

type BuildingAccess = Pick<Building, "id" | "x" | "z">;

interface RoadAgent {
  requestId: string;
  vehicle: Vehicle;
  plan: RoutePlan;
  edgeIndex: number;
  edgeProgressMeters: number;
  isBus: boolean;
}

interface PedestrianAgent {
  requestId: string;
  pedestrian: Pedestrian;
  plan: RoutePlan;
  edgeIndex: number;
  edgeProgressMeters: number;
  crossingCommitted: boolean;
}

interface BusPassenger {
  request: TripRequest;
  originStopId: string;
  destinationStopId: string;
  queuedAtSeconds: number;
}

interface BusRuntime {
  roadAgent: RoadAgent;
  currentStopId: string;
  destinationStopId: string;
  dwellRemainingSeconds: number;
  passengers: BusPassenger[];
}

const DEFAULT_CONFIG: MobilityConfig = {
  roadCapacity: 12,
  speedLimitMph: 25,
  safeFollowingGapMeters: 5,
  busHeadwayMinutes: 5,
  busCapacity: 24,
  busDwellSeconds: 3,
  maxActiveBuses: 4,
};

export class MobilitySystem {
  private readonly buildings: readonly BuildingAccess[];
  private readonly network: MobilityNetwork;
  private readonly roadAgents = new Map<string, RoadAgent>();
  private readonly pedestrianAgents = new Map<string, PedestrianAgent>();
  private readonly buses = new Map<string, BusRuntime>();
  private readonly busQueues = new Map<string, BusPassenger[]>([
    [WEST_BUS_STOP_NODE_ID, []],
    [EAST_BUS_STOP_NODE_ID, []],
  ]);
  private readonly externalOccupancy = new Map<string, number>();
  private readonly activeConflictPairs = new Set<string>();
  private config: MobilityConfig;
  private signalPhase: SignalPhase = "vehicles";
  private elapsedSeconds = 0;
  private nextBusId = 1;
  private nextBusSpawnSeconds = 0;
  private completedVehicles = 0;
  private completedFreight = 0;
  private completedService = 0;
  private completedPedestrians = 0;
  private completedTransitTrips = 0;
  private transitRidership = 0;
  private potentialConflicts = 0;
  private totalVehicleTravelSeconds = 0;
  private totalPedestrianWaitSeconds = 0;
  private totalTransitWaitSeconds = 0;

  constructor(
    buildings: readonly BuildingAccess[],
    config: Partial<MobilityConfig> = {},
    network?: StreetNetwork,
  ) {
    this.buildings = buildings;
    this.config = sanitizeConfig({ ...DEFAULT_CONFIG, ...config });
    this.network = network
      ? normalizeNetwork(network)
      : buildStreetNetwork(buildings, { roadCapacity: this.config.roadCapacity });
    this.setRoadCapacity(this.config.roadCapacity);
  }

  getNetwork(): MobilityNetwork {
    return this.network;
  }

  getSignalPhase(): SignalPhase {
    return this.signalPhase;
  }

  setSignalPhase(phase: SignalPhase): void {
    this.signalPhase = phase;
  }

  setSpeedLimitMph(speedLimitMph: number): void {
    if (!Number.isFinite(speedLimitMph)) {
      return;
    }
    this.config = {
      ...this.config,
      speedLimitMph: Math.max(5, speedLimitMph),
    };
  }

  setBusHeadwayMinutes(busHeadwayMinutes: number): void {
    if (!Number.isFinite(busHeadwayMinutes)) {
      return;
    }
    const nextHeadway = Math.max(0.05, busHeadwayMinutes);
    this.config = { ...this.config, busHeadwayMinutes: nextHeadway };
    if (this.elapsedSeconds > 0 || this.buses.size > 0) {
      this.nextBusSpawnSeconds = this.elapsedSeconds + nextHeadway * 60;
    }
  }

  setRoadCapacity(capacity: number): void {
    const nextCapacity = Math.max(1, Math.floor(capacity));
    this.config = { ...this.config, roadCapacity: nextCapacity };
    for (const edge of this.network.edges) {
      if (isRoadEdge(edge)) {
        edge.capacity = nextCapacity;
      }
    }
    this.refreshEdgeOccupancy();
  }

  setEdgeOccupancy(edgeId: string, occupancy: number): void {
    if (!this.network.edges.some((edge) => edge.id === edgeId)) {
      throw new Error(`Unknown network edge: ${edgeId}`);
    }
    this.externalOccupancy.set(edgeId, Math.max(0, Math.floor(occupancy)));
    this.refreshEdgeOccupancy();
  }

  routeTrip(request: TripRequest): RoutePoint[] {
    return findRoute(
      this.network,
      request.originBuildingId,
      request.destinationBuildingId,
      request.mode,
    );
  }

  consumeTrips(requests: readonly TripRequest[]): ConsumeTripsResult {
    const rejected: string[] = [];
    let accepted = 0;
    for (const request of requests) {
      if (this.submitTrip(request)) {
        accepted += 1;
      } else {
        rejected.push(request.id);
      }
    }
    return { accepted, rejected };
  }

  submitTrip(request: TripRequest): boolean {
    if (this.hasRequest(request.id) || request.originBuildingId === request.destinationBuildingId) {
      return false;
    }

    try {
      if (request.mode === "walk") {
        this.addPedestrian(request);
      } else if (request.mode === "bus") {
        return this.queueBusPassenger(request);
      } else {
        this.addRoadVehicle(request);
      }
      this.refreshEdgeOccupancy();
      return true;
    } catch {
      return false;
    }
  }

  update(deltaSeconds: number, signalPhase?: SignalPhase): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    if (signalPhase) {
      this.signalPhase = signalPhase;
    }

    let remaining = deltaSeconds;
    while (remaining > EPSILON) {
      const step = Math.min(MAX_STEP_SECONDS, remaining);
      this.advance(step);
      remaining -= step;
    }
  }

  getSnapshot(): MobilitySnapshot {
    this.refreshEdgeOccupancy();
    const roadEdges = this.network.edges.filter(isRoadEdge);
    const roadVolume = roadEdges.reduce((total, edge) => total + edge.occupancy, 0);
    const congestion = roadEdges.length > 0
      ? roadEdges.reduce(
          (total, edge) => total + Math.min(1, edge.occupancy / Math.max(1, edge.capacity)),
          0,
        ) / roadEdges.length
      : 0;
    const vehicles = [...this.roadAgents.values()].map((agent) => ({ ...agent.vehicle }));
    const pedestrians = [...this.pedestrianAgents.values()].map((agent) => ({
      ...agent.pedestrian,
    }));

    return {
      elapsedSeconds: this.elapsedSeconds,
      signalPhase: this.signalPhase,
      vehicles,
      pedestrians,
      busQueueLength: [...this.busQueues.values()].reduce((total, queue) => total + queue.length, 0),
      busPassengersOnBoard: [...this.buses.values()].reduce(
        (total, bus) => total + bus.passengers.length,
        0,
      ),
      roadVolume,
      roadCongestionPercent: congestion * 100,
      redLightQueue: [...this.roadAgents.values()].filter((agent) =>
        this.isStoppedAtRed(agent),
      ).length,
      pedestrianSignalWaiters: [...this.pedestrianAgents.values()].filter((agent) =>
        this.isWaitingForPedestrianSignal(agent),
      ).length,
      counters: this.getCounters(),
    };
  }

  getCounters(): MobilityCounters {
    return {
      completedVehicles: this.completedVehicles,
      completedFreight: this.completedFreight,
      completedService: this.completedService,
      completedPedestrians: this.completedPedestrians,
      completedTransitTrips: this.completedTransitTrips,
      transitRidership: this.transitRidership,
      potentialConflicts: this.potentialConflicts,
      averageVehicleTravelSeconds:
        this.completedVehicles > 0 ? this.totalVehicleTravelSeconds / this.completedVehicles : 0,
      averagePedestrianWaitSeconds:
        this.completedPedestrians > 0
          ? this.totalPedestrianWaitSeconds / this.completedPedestrians
          : 0,
      averageTransitWaitMinutes:
        this.transitRidership > 0
          ? this.totalTransitWaitSeconds / this.transitRidership / 60
          : 0,
    };
  }

  private advance(step: number): void {
    this.spawnDueBuses();
    this.refreshEdgeOccupancy();
    this.advanceRoadTraffic(step);
    this.advancePedestrians(step);
    this.updateConflictProxy();
    this.elapsedSeconds += step;
  }

  private addRoadVehicle(request: TripRequest): void {
    const plan = planRoute(
      this.network,
      request.originBuildingId,
      request.destinationBuildingId,
      request.mode,
    );
    if (plan.edges.length === 0) {
      throw new Error("Road trip has no movement edges");
    }
    const vehicleType = vehicleTypeFor(request);
    const vehicle: Vehicle = {
      id: request.id,
      kind: "vehicle",
      vehicleType,
      direction: inferDirection(plan.points),
      progress: 0,
      completed: false,
      elapsedSeconds: 0,
      route: plan.points,
      waitingSeconds: 0,
      currentSpeedMph: 0,
      occupancy: 1,
      capacity: vehicleType === "truck" ? 2 : vehicleType === "service" ? 4 : 5,
      tripPurpose: request.purpose,
      ownerPersonId: request.personId,
      destinationBuildingId: request.destinationBuildingId,
      cargoUnits: request.cargoUnits,
    };
    this.roadAgents.set(vehicle.id, {
      requestId: request.id,
      vehicle,
      plan,
      edgeIndex: 0,
      edgeProgressMeters: 0,
      isBus: false,
    });
  }

  private addPedestrian(request: TripRequest): void {
    const plan = planRoute(
      this.network,
      request.originBuildingId,
      request.destinationBuildingId,
      "walk",
    );
    if (plan.edges.length === 0) {
      throw new Error("Walking trip has no movement edges");
    }
    const pedestrian: Pedestrian = {
      id: request.id,
      kind: "pedestrian",
      progress: 0,
      completed: false,
      elapsedSeconds: 0,
      route: plan.points,
      waitSeconds: 0,
      ageGroup: request.travelerAgeGroup ?? "adult",
      activity: request.purpose === "delivery" || request.purpose === "service"
        ? "work"
        : request.purpose,
      personId: request.personId,
      destinationBuildingId: request.destinationBuildingId,
    };
    this.pedestrianAgents.set(pedestrian.id, {
      requestId: request.id,
      pedestrian,
      plan,
      edgeIndex: 0,
      edgeProgressMeters: 0,
      crossingCommitted: false,
    });
  }

  private queueBusPassenger(request: TripRequest): boolean {
    planRoute(
      this.network,
      request.originBuildingId,
      request.destinationBuildingId,
      "bus",
    );
    const originStopId = this.closestBusStop(request.originBuildingId);
    const destinationStopId = this.closestBusStop(request.destinationBuildingId);
    if (originStopId === destinationStopId) {
      return false;
    }
    this.busQueues.get(originStopId)!.push({
      request,
      originStopId,
      destinationStopId,
      queuedAtSeconds: this.elapsedSeconds,
    });
    return true;
  }

  private advanceRoadTraffic(step: number): void {
    const orderedAgents = [...this.roadAgents.values()].sort((first, second) => {
      const edgeDifference = currentEdge(first).id.localeCompare(currentEdge(second).id);
      return edgeDifference !== 0
        ? edgeDifference
        : second.edgeProgressMeters - first.edgeProgressMeters;
    });

    for (const agent of orderedAgents) {
      const bus = this.buses.get(agent.vehicle.id);
      agent.vehicle.elapsedSeconds += step;
      if (bus && bus.dwellRemainingSeconds > 0) {
        bus.dwellRemainingSeconds = Math.max(0, bus.dwellRemainingSeconds - step);
        agent.vehicle.currentSpeedMph = 0;
        agent.vehicle.waitingSeconds += step;
        continue;
      }

      const traveled = this.moveRoadAgent(agent, step);
      agent.vehicle.currentSpeedMph = (traveled / step) * METERS_PER_SECOND_TO_MPH;
      if (traveled < 0.05 * step) {
        agent.vehicle.waitingSeconds += step;
      }
      agent.vehicle.progress = routeProgress(agent.plan, agent.edgeIndex, agent.edgeProgressMeters);

      if (agent.edgeIndex >= agent.plan.edges.length) {
        if (bus) {
          this.arriveBus(bus);
        } else {
          this.completeRoadAgent(agent);
        }
      }
    }
    this.refreshEdgeOccupancy();
  }

  private moveRoadAgent(agent: RoadAgent, step: number): number {
    if (agent.edgeIndex >= agent.plan.edges.length) {
      return 0;
    }
    const edge = currentEdge(agent);
    const ratio = edge.occupancy / Math.max(1, edge.capacity);
    const capacityMultiplier = 1 / (1 + 0.15 * ratio ** 4);
    const speedLimit = this.config.speedLimitMph * MPH_TO_METERS_PER_SECOND;
    let remainingTravel = Math.min(edge.freeFlowSpeed, speedLimit) * capacityMultiplier * step;
    const initialTravel = remainingTravel;

    const leader = this.findLeader(agent, edge.id);
    if (leader) {
      remainingTravel = Math.min(
        remainingTravel,
        Math.max(
          0,
          leader.edgeProgressMeters
            - this.config.safeFollowingGapMeters
            - agent.edgeProgressMeters,
        ),
      );
    }

    let traveled = 0;
    while (remainingTravel > EPSILON && agent.edgeIndex < agent.plan.edges.length) {
      const activeEdge = currentEdge(agent);
      const nextEdge = agent.plan.edges[agent.edgeIndex + 1];
      const canExit = !nextEdge || this.canEnterRoadEdge(nextEdge);
      const stopPosition = nextEdge && !canExit
        ? Math.max(0, activeEdge.length - STOP_LINE_BUFFER_METERS)
        : activeEdge.length;
      const allowedTravel = Math.max(0, stopPosition - agent.edgeProgressMeters);
      const movement = Math.min(remainingTravel, allowedTravel);
      agent.edgeProgressMeters += movement;
      traveled += movement;
      remainingTravel -= movement;

      if (agent.edgeProgressMeters + EPSILON < activeEdge.length || !canExit) {
        break;
      }
      agent.edgeIndex += 1;
      agent.edgeProgressMeters = 0;
      if (agent.edgeIndex >= agent.plan.edges.length) {
        break;
      }
    }
    return Math.min(traveled, initialTravel);
  }

  private canEnterRoadEdge(edge: MobilityNetworkEdge): boolean {
    if (edge.id.startsWith("movement-") && this.signalPhase !== "vehicles") {
      return false;
    }
    return edge.occupancy < edge.capacity;
  }

  private findLeader(agent: RoadAgent, edgeId: string): RoadAgent | undefined {
    let leader: RoadAgent | undefined;
    for (const candidate of this.roadAgents.values()) {
      if (
        candidate === agent
        || candidate.edgeIndex >= candidate.plan.edges.length
        || currentEdge(candidate).id !== edgeId
        || candidate.edgeProgressMeters <= agent.edgeProgressMeters
      ) {
        continue;
      }
      if (!leader || candidate.edgeProgressMeters < leader.edgeProgressMeters) {
        leader = candidate;
      }
    }
    return leader;
  }

  private completeRoadAgent(agent: RoadAgent): void {
    agent.vehicle.completed = true;
    agent.vehicle.progress = 1;
    agent.vehicle.currentSpeedMph = 0;
    this.completedVehicles += 1;
    this.totalVehicleTravelSeconds += agent.vehicle.elapsedSeconds;
    if (agent.vehicle.vehicleType === "truck") {
      this.completedFreight += 1;
    } else if (agent.vehicle.vehicleType === "service") {
      this.completedService += 1;
    }
    this.roadAgents.delete(agent.vehicle.id);
  }

  private advancePedestrians(step: number): void {
    for (const agent of [...this.pedestrianAgents.values()]) {
      const pedestrian = agent.pedestrian;
      pedestrian.elapsedSeconds += step;
      const edge = agent.plan.edges[agent.edgeIndex];
      if (!edge) {
        this.completePedestrian(agent);
        continue;
      }
      if (
        isCrosswalkEdge(edge)
        && !agent.crossingCommitted
        && this.signalPhase !== "pedestrians"
      ) {
        pedestrian.waitSeconds += step;
        continue;
      }

      const speed = pedestrianSpeed(pedestrian.ageGroup);
      let remainingTravel = speed * step;
      while (remainingTravel > EPSILON && agent.edgeIndex < agent.plan.edges.length) {
        const activeEdge = agent.plan.edges[agent.edgeIndex]!;
        if (
          isCrosswalkEdge(activeEdge)
          && !agent.crossingCommitted
          && this.signalPhase !== "pedestrians"
          && agent.edgeProgressMeters <= EPSILON
        ) {
          pedestrian.waitSeconds += step;
          break;
        }
        if (isCrosswalkEdge(activeEdge)) {
          agent.crossingCommitted = true;
        }
        const movement = Math.min(remainingTravel, activeEdge.length - agent.edgeProgressMeters);
        agent.edgeProgressMeters += movement;
        remainingTravel -= movement;
        if (agent.edgeProgressMeters + EPSILON < activeEdge.length) {
          break;
        }
        const nextEdge = agent.plan.edges[agent.edgeIndex + 1];
        if (
          nextEdge
          && isCrosswalkEdge(nextEdge)
          && !agent.crossingCommitted
          && this.signalPhase !== "pedestrians"
        ) {
          pedestrian.waitSeconds += step;
          break;
        }
        agent.edgeIndex += 1;
        agent.edgeProgressMeters = 0;
        if (!nextEdge || !isCrosswalkEdge(nextEdge)) {
          agent.crossingCommitted = false;
        }
      }
      pedestrian.progress = routeProgress(agent.plan, agent.edgeIndex, agent.edgeProgressMeters);
      if (agent.edgeIndex >= agent.plan.edges.length) {
        this.completePedestrian(agent);
      }
    }
  }

  private completePedestrian(agent: PedestrianAgent): void {
    agent.pedestrian.completed = true;
    agent.pedestrian.progress = 1;
    this.completedPedestrians += 1;
    this.totalPedestrianWaitSeconds += agent.pedestrian.waitSeconds;
    this.pedestrianAgents.delete(agent.pedestrian.id);
  }

  private spawnDueBuses(): void {
    const headwaySeconds = this.config.busHeadwayMinutes * 60;
    while (this.nextBusSpawnSeconds <= this.elapsedSeconds + EPSILON) {
      if (this.buses.size < this.config.maxActiveBuses) {
        this.spawnBus();
      }
      this.nextBusSpawnSeconds += headwaySeconds;
    }
  }

  private spawnBus(): void {
    const id = `bus-${this.nextBusId}`;
    this.nextBusId += 1;
    const plan = planRouteBetweenNodes(
      this.network,
      WEST_BUS_STOP_NODE_ID,
      EAST_BUS_STOP_NODE_ID,
      "bus",
    );
    const vehicle: Vehicle = {
      id,
      kind: "vehicle",
      vehicleType: "bus",
      direction: inferDirection(plan.points),
      progress: 0,
      completed: false,
      elapsedSeconds: 0,
      route: plan.points,
      waitingSeconds: 0,
      currentSpeedMph: 0,
      occupancy: 1,
      capacity: this.config.busCapacity,
      tripPurpose: "work",
      cargoUnits: 0,
    };
    const roadAgent: RoadAgent = {
      requestId: id,
      vehicle,
      plan,
      edgeIndex: 0,
      edgeProgressMeters: 0,
      isBus: true,
    };
    const bus: BusRuntime = {
      roadAgent,
      currentStopId: WEST_BUS_STOP_NODE_ID,
      destinationStopId: EAST_BUS_STOP_NODE_ID,
      dwellRemainingSeconds: this.config.busDwellSeconds,
      passengers: [],
    };
    this.roadAgents.set(id, roadAgent);
    this.buses.set(id, bus);
    this.boardBus(bus);
  }

  private arriveBus(bus: BusRuntime): void {
    bus.currentStopId = bus.destinationStopId;
    const remainingPassengers: BusPassenger[] = [];
    for (const passenger of bus.passengers) {
      if (passenger.destinationStopId === bus.currentStopId) {
        this.completedTransitTrips += 1;
      } else {
        remainingPassengers.push(passenger);
      }
    }
    bus.passengers = remainingPassengers;
    bus.destinationStopId = bus.currentStopId === WEST_BUS_STOP_NODE_ID
      ? EAST_BUS_STOP_NODE_ID
      : WEST_BUS_STOP_NODE_ID;
    this.boardBus(bus);

    const plan = planRouteBetweenNodes(
      this.network,
      bus.currentStopId,
      bus.destinationStopId,
      "bus",
    );
    bus.roadAgent.plan = plan;
    bus.roadAgent.edgeIndex = 0;
    bus.roadAgent.edgeProgressMeters = 0;
    bus.roadAgent.vehicle.route = plan.points;
    bus.roadAgent.vehicle.progress = 0;
    bus.roadAgent.vehicle.direction = inferDirection(plan.points);
    bus.roadAgent.vehicle.occupancy = 1 + bus.passengers.length;
    bus.dwellRemainingSeconds = this.config.busDwellSeconds;
  }

  private boardBus(bus: BusRuntime): void {
    const queue = this.busQueues.get(bus.currentStopId)!;
    const remainingQueue: BusPassenger[] = [];
    for (const passenger of queue) {
      if (
        passenger.destinationStopId === bus.destinationStopId
        && bus.passengers.length < this.config.busCapacity
      ) {
        bus.passengers.push(passenger);
        this.transitRidership += 1;
        this.totalTransitWaitSeconds += this.elapsedSeconds - passenger.queuedAtSeconds;
      } else {
        remainingQueue.push(passenger);
      }
    }
    this.busQueues.set(bus.currentStopId, remainingQueue);
    bus.roadAgent.vehicle.occupancy = 1 + bus.passengers.length;
  }

  private refreshEdgeOccupancy(): void {
    const activeCounts = new Map<string, number>();
    for (const agent of this.roadAgents.values()) {
      if (agent.edgeIndex < agent.plan.edges.length) {
        const edgeId = currentEdge(agent).id;
        activeCounts.set(edgeId, (activeCounts.get(edgeId) ?? 0) + 1);
      }
    }
    for (const edge of this.network.edges) {
      edge.occupancy = (this.externalOccupancy.get(edge.id) ?? 0) + (activeCounts.get(edge.id) ?? 0);
      edge.congestion = edge.occupancy / Math.max(1, edge.capacity);
    }
  }

  private updateConflictProxy(): void {
    const vehiclesInIntersection = [...this.roadAgents.values()].filter(
      (agent) => agent.edgeIndex < agent.plan.edges.length && currentEdge(agent).id.startsWith("movement-"),
    );
    const pedestriansInCrosswalk = [...this.pedestrianAgents.values()].filter((agent) => {
      const edge = agent.plan.edges[agent.edgeIndex];
      return edge ? isCrosswalkEdge(edge) && agent.edgeProgressMeters > 0 : false;
    });
    const currentPairs = new Set<string>();
    for (const vehicle of vehiclesInIntersection) {
      for (const pedestrian of pedestriansInCrosswalk) {
        const pair = `${vehicle.vehicle.id}:${pedestrian.pedestrian.id}`;
        currentPairs.add(pair);
        if (!this.activeConflictPairs.has(pair)) {
          this.potentialConflicts += 1;
        }
      }
    }
    this.activeConflictPairs.clear();
    currentPairs.forEach((pair) => this.activeConflictPairs.add(pair));
  }

  private closestBusStop(buildingId: string): string {
    const building = this.buildings.find((candidate) => candidate.id === buildingId);
    if (!building) {
      const accessNode = this.network.nodes.find((node) => node.buildingId === buildingId);
      if (!accessNode) {
        throw new Error(`Unknown building: ${buildingId}`);
      }
      return accessNode.x < 0 ? WEST_BUS_STOP_NODE_ID : EAST_BUS_STOP_NODE_ID;
    }
    return building.x < 0 ? WEST_BUS_STOP_NODE_ID : EAST_BUS_STOP_NODE_ID;
  }

  private hasRequest(requestId: string): boolean {
    if (this.roadAgents.has(requestId) || this.pedestrianAgents.has(requestId)) {
      return true;
    }
    for (const queue of this.busQueues.values()) {
      if (queue.some((passenger) => passenger.request.id === requestId)) {
        return true;
      }
    }
    for (const bus of this.buses.values()) {
      if (bus.passengers.some((passenger) => passenger.request.id === requestId)) {
        return true;
      }
    }
    return false;
  }

  private isStoppedAtRed(agent: RoadAgent): boolean {
    if (this.signalPhase === "vehicles" || agent.edgeIndex >= agent.plan.edges.length) {
      return false;
    }
    const edge = currentEdge(agent);
    const nextEdge = agent.plan.edges[agent.edgeIndex + 1];
    return Boolean(
      nextEdge?.id.startsWith("movement-")
      && edge.length - agent.edgeProgressMeters <= STOP_LINE_BUFFER_METERS + 0.01,
    );
  }

  private isWaitingForPedestrianSignal(agent: PedestrianAgent): boolean {
    if (this.signalPhase === "pedestrians") {
      return false;
    }
    const edge = agent.plan.edges[agent.edgeIndex];
    const nextEdge = agent.plan.edges[agent.edgeIndex + 1];
    return Boolean(!agent.crossingCommitted && edge && (
      (isCrosswalkEdge(edge) && agent.edgeProgressMeters <= EPSILON)
      || (nextEdge && isCrosswalkEdge(nextEdge) && edge.length - agent.edgeProgressMeters <= EPSILON)
    ));
  }
}

function sanitizeConfig(config: MobilityConfig): MobilityConfig {
  return {
    roadCapacity: Math.max(1, Math.floor(config.roadCapacity)),
    speedLimitMph: Math.max(5, config.speedLimitMph),
    safeFollowingGapMeters: Math.max(1, config.safeFollowingGapMeters),
    busHeadwayMinutes: Math.max(0.05, config.busHeadwayMinutes),
    busCapacity: Math.max(1, Math.floor(config.busCapacity)),
    busDwellSeconds: Math.max(0, config.busDwellSeconds),
    maxActiveBuses: Math.max(1, Math.floor(config.maxActiveBuses)),
  };
}

function normalizeNetwork(network: StreetNetwork): MobilityNetwork {
  return {
    nodes: network.nodes,
    edges: network.edges.map((edge) => ({
      ...edge,
      monetaryCost: (edge as Partial<MobilityNetworkEdge>).monetaryCost ?? {},
      comfortPenalty: (edge as Partial<MobilityNetworkEdge>).comfortPenalty ?? {},
      turnPenalty: (edge as Partial<MobilityNetworkEdge>).turnPenalty ?? 0,
    })),
  };
}

function currentEdge(agent: RoadAgent): MobilityNetworkEdge {
  return agent.plan.edges[agent.edgeIndex]!;
}

function routeProgress(plan: RoutePlan, edgeIndex: number, edgeProgressMeters: number): number {
  const totalLength = plan.edges.reduce((total, edge) => total + edge.length, 0);
  if (totalLength <= 0 || edgeIndex >= plan.edges.length) {
    return 1;
  }
  const completedLength = plan.edges
    .slice(0, edgeIndex)
    .reduce((total, edge) => total + edge.length, 0);
  return Math.min(1, (completedLength + edgeProgressMeters) / totalLength);
}

function vehicleTypeFor(request: TripRequest): VehicleType {
  if (request.mode === "freight") {
    return "truck";
  }
  if (request.mode === "service") {
    return "service";
  }
  return request.vehicleType === "truck" || request.vehicleType === "service"
    ? request.vehicleType
    : "car";
}

function inferDirection(points: readonly RoutePoint[]): TravelDirection {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return "eastbound";
  }
  const xDifference = last.x - first.x;
  const zDifference = last.z - first.z;
  if (Math.abs(xDifference) >= Math.abs(zDifference)) {
    return xDifference >= 0 ? "eastbound" : "westbound";
  }
  return zDifference >= 0 ? "southbound" : "northbound";
}

function pedestrianSpeed(ageGroup: AgeGroup): number {
  if (ageGroup === "child") {
    return 1.1;
  }
  if (ageGroup === "senior") {
    return 0.95;
  }
  return 1.35;
}

function isRoadEdge(edge: MobilityNetworkEdge): boolean {
  return edge.id.startsWith("road-") || edge.id.startsWith("movement-");
}

function isCrosswalkEdge(edge: MobilityNetworkEdge): boolean {
  return edge.id.startsWith("crosswalk-");
}
