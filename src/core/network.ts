import { MultiDirectedGraph } from "graphology";
import { dijkstra } from "graphology-shortest-path";
import type {
  Building,
  NetworkEdge,
  NetworkNode,
  RoutePoint,
  StreetNetwork,
  TravelMode,
} from "../models/types";

export const OUTSIDE_FREIGHT_BUILDING_ID = "outside-freight";
export const OUTSIDE_COMMUTER_BUILDING_ID = "outside-commuter-gateway";
export const WEST_BUS_STOP_NODE_ID = "bus-stop-west";
export const EAST_BUS_STOP_NODE_ID = "bus-stop-east";

const MONEY_TO_SECONDS = 45;
const CONGESTION_FACTOR = 0.15;

export interface MobilityNetworkEdge extends NetworkEdge {
  monetaryCost: Partial<Record<TravelMode, number>>;
  comfortPenalty: Partial<Record<TravelMode, number>>;
  turnPenalty: number;
}

export interface MobilityNetwork extends StreetNetwork {
  edges: MobilityNetworkEdge[];
}

export interface EdgeCostBreakdown {
  travelTimeSeconds: number;
  congestionDelaySeconds: number;
  monetaryCost: number;
  monetaryCostSeconds: number;
  comfortPenaltySeconds: number;
  turnPenaltySeconds: number;
  totalSeconds: number;
}

export interface RoutePlan {
  mode: TravelMode;
  points: RoutePoint[];
  edges: MobilityNetworkEdge[];
  cost: EdgeCostBreakdown;
}

export interface NetworkBuildOptions {
  roadCapacity?: number;
}

type BuildingAccess = Pick<Building, "id" | "x" | "z">;
type EdgeInput = Omit<
  MobilityNetworkEdge,
  "occupancy" | "congestion" | "monetaryCost" | "comfortPenalty" | "turnPenalty"
> & {
  monetaryCost?: Partial<Record<TravelMode, number>>;
  comfortPenalty?: Partial<Record<TravelMode, number>>;
  turnPenalty?: number;
};

const ROAD_MODES: TravelMode[] = ["car", "bus", "freight", "service"];
const PRIVATE_ROAD_MODES: TravelMode[] = ["car", "freight", "service"];

export function buildStreetNetwork(
  buildings: readonly BuildingAccess[],
  options: NetworkBuildOptions = {},
): MobilityNetwork {
  const roadCapacity = Math.max(1, options.roadCapacity ?? 12);
  const nodes: NetworkNode[] = [];
  const edges: MobilityNetworkEdge[] = [];

  const addNode = (node: NetworkNode): void => {
    nodes.push(node);
  };
  const addEdge = (input: EdgeInput): void => {
    edges.push({
      ...input,
      occupancy: 0,
      congestion: 0,
      monetaryCost: input.monetaryCost ?? {},
      comfortPenalty: input.comfortPenalty ?? {},
      turnPenalty: input.turnPenalty ?? 0,
    });
  };
  const connectBothWays = (
    id: string,
    first: string,
    second: string,
    modes: TravelMode[],
    length: number,
    capacity: number,
    speed: number,
    comfortPenalty: Partial<Record<TravelMode, number>> = {},
  ): void => {
    addEdge({
      id: `${id}-out`,
      from: first,
      to: second,
      modes,
      length,
      capacity,
      freeFlowSpeed: speed,
      comfortPenalty,
    });
    addEdge({
      id: `${id}-back`,
      from: second,
      to: first,
      modes,
      length,
      capacity,
      freeFlowSpeed: speed,
      comfortPenalty,
    });
  };

  const roadNodes: NetworkNode[] = [
    { id: "road-west-in", kind: "road", x: -70, z: 4 },
    { id: "road-west-stop", kind: "road", x: -10, z: 4 },
    { id: "road-east-depart", kind: "road", x: 10, z: 4 },
    { id: "road-east-out", kind: "road", x: 70, z: 4 },
    { id: "road-east-in", kind: "road", x: 70, z: -4 },
    { id: "road-east-stop", kind: "road", x: 10, z: -4 },
    { id: "road-west-depart", kind: "road", x: -10, z: -4 },
    { id: "road-west-out", kind: "road", x: -70, z: -4 },
    { id: "road-north-in", kind: "road", x: -4, z: -70 },
    { id: "road-north-stop", kind: "road", x: -4, z: -10 },
    { id: "road-south-depart", kind: "road", x: -4, z: 10 },
    { id: "road-south-out", kind: "road", x: -4, z: 70 },
    { id: "road-south-in", kind: "road", x: 4, z: 70 },
    { id: "road-south-stop", kind: "road", x: 4, z: 10 },
    { id: "road-north-depart", kind: "road", x: 4, z: -10 },
    { id: "road-north-out", kind: "road", x: 4, z: -70 },
  ];
  roadNodes.forEach(addNode);

  const roadMoney = { car: 0.012, bus: 0.004, freight: 0.025, service: 0.02 };
  const addRoadEdge = (id: string, from: string, to: string, length: number): void => {
    addEdge({
      id,
      from,
      to,
      modes: ROAD_MODES,
      length,
      capacity: roadCapacity,
      freeFlowSpeed: 11.18,
      monetaryCost: roadMoney,
      comfortPenalty: { car: 0.4, bus: 0.7, freight: 0.6, service: 0.5 },
    });
  };
  addRoadEdge("road-west-approach", "road-west-in", "road-west-stop", 60);
  addRoadEdge("road-east-departure", "road-east-depart", "road-east-out", 60);
  addRoadEdge("road-east-approach", "road-east-in", "road-east-stop", 60);
  addRoadEdge("road-west-departure", "road-west-depart", "road-west-out", 60);
  addRoadEdge("road-north-approach", "road-north-in", "road-north-stop", 60);
  addRoadEdge("road-south-departure", "road-south-depart", "road-south-out", 60);
  addRoadEdge("road-south-approach", "road-south-in", "road-south-stop", 60);
  addRoadEdge("road-north-departure", "road-north-depart", "road-north-out", 60);

  const approaches = ["west", "east", "north", "south"] as const;
  const opposites = { west: "east", east: "west", north: "south", south: "north" } as const;
  const leftTurns = { west: "north", east: "south", north: "east", south: "west" } as const;
  const rightTurns = { west: "south", east: "north", north: "west", south: "east" } as const;
  for (const approach of approaches) {
    const movements = [
      { destination: opposites[approach], turn: "straight", penalty: 0 },
      { destination: leftTurns[approach], turn: "left", penalty: 4 },
      { destination: rightTurns[approach], turn: "right", penalty: 1.5 },
    ];
    for (const movement of movements) {
      const from = `road-${approach}-stop`;
      const to = `road-${movement.destination}-depart`;
      const fromNode = roadNodes.find((node) => node.id === from)!;
      const toNode = roadNodes.find((node) => node.id === to)!;
      addEdge({
        id: `movement-${approach}-${movement.turn}`,
        from,
        to,
        modes: ROAD_MODES,
        length: distance(fromNode, toNode),
        capacity: roadCapacity,
        freeFlowSpeed: 6.7,
        monetaryCost: roadMoney,
        comfortPenalty: { car: 0.8, bus: 1.2, freight: 1.4, service: 1 },
        turnPenalty: movement.penalty,
      });
    }
  }

  const sidewalkNodes: NetworkNode[] = [
    { id: "sidewalk-nw", kind: "sidewalk", x: -10, z: -10 },
    { id: "sidewalk-ne", kind: "sidewalk", x: 10, z: -10 },
    { id: "sidewalk-se", kind: "sidewalk", x: 10, z: 10 },
    { id: "sidewalk-sw", kind: "sidewalk", x: -10, z: 10 },
    { id: "sidewalk-west-n", kind: "sidewalk", x: -70, z: -10 },
    { id: "sidewalk-west-s", kind: "sidewalk", x: -70, z: 10 },
    { id: "sidewalk-east-n", kind: "sidewalk", x: 70, z: -10 },
    { id: "sidewalk-east-s", kind: "sidewalk", x: 70, z: 10 },
    { id: "sidewalk-north-w", kind: "sidewalk", x: -10, z: -70 },
    { id: "sidewalk-north-e", kind: "sidewalk", x: 10, z: -70 },
    { id: "sidewalk-south-w", kind: "sidewalk", x: -10, z: 70 },
    { id: "sidewalk-south-e", kind: "sidewalk", x: 10, z: 70 },
  ];
  sidewalkNodes.forEach(addNode);
  const walkComfort = { walk: 0.1 };
  const sidewalks = [
    ["west-n", "sidewalk-west-n", "sidewalk-nw"],
    ["west-s", "sidewalk-west-s", "sidewalk-sw"],
    ["east-n", "sidewalk-east-n", "sidewalk-ne"],
    ["east-s", "sidewalk-east-s", "sidewalk-se"],
    ["north-w", "sidewalk-north-w", "sidewalk-nw"],
    ["north-e", "sidewalk-north-e", "sidewalk-ne"],
    ["south-w", "sidewalk-south-w", "sidewalk-sw"],
    ["south-e", "sidewalk-south-e", "sidewalk-se"],
  ] as const;
  for (const [id, from, to] of sidewalks) {
    connectBothWays(`sidewalk-${id}`, from, to, ["walk"], 60, 80, 1.35, walkComfort);
  }

  const crosswalks = [
    ["north", "sidewalk-nw", "sidewalk-ne"],
    ["east", "sidewalk-ne", "sidewalk-se"],
    ["south", "sidewalk-sw", "sidewalk-se"],
    ["west", "sidewalk-nw", "sidewalk-sw"],
  ] as const;
  for (const [id, from, to] of crosswalks) {
    const crossingA: NetworkNode = {
      id: `crosswalk-${id}-a`,
      kind: "crosswalk",
      x: (nodes.find((node) => node.id === from)!.x * 2 + nodes.find((node) => node.id === to)!.x) / 3,
      z: (nodes.find((node) => node.id === from)!.z * 2 + nodes.find((node) => node.id === to)!.z) / 3,
    };
    const crossingB: NetworkNode = {
      id: `crosswalk-${id}-b`,
      kind: "crosswalk",
      x: (nodes.find((node) => node.id === from)!.x + nodes.find((node) => node.id === to)!.x * 2) / 3,
      z: (nodes.find((node) => node.id === from)!.z + nodes.find((node) => node.id === to)!.z * 2) / 3,
    };
    addNode(crossingA);
    addNode(crossingB);
    connectBothWays(`crosswalk-${id}-entry-a`, from, crossingA.id, ["walk"], 7, 24, 1.15, { walk: 0.8 });
    connectBothWays(`crosswalk-${id}-center`, crossingA.id, crossingB.id, ["walk"], 6, 24, 1.15, { walk: 1.2 });
    connectBothWays(`crosswalk-${id}-entry-b`, crossingB.id, to, ["walk"], 7, 24, 1.15, { walk: 0.8 });
  }

  addNode({ id: WEST_BUS_STOP_NODE_ID, kind: "bus-stop", x: -55, z: 12 });
  addNode({ id: EAST_BUS_STOP_NODE_ID, kind: "bus-stop", x: 55, z: -12 });
  connectBothWays("bus-west-eastbound", WEST_BUS_STOP_NODE_ID, "road-west-in", ["bus"], 16, 4, 5, { bus: 1 });
  connectBothWays("bus-west-westbound", "road-west-out", WEST_BUS_STOP_NODE_ID, ["bus"], 16, 4, 5, { bus: 1 });
  connectBothWays("bus-east-westbound", EAST_BUS_STOP_NODE_ID, "road-east-in", ["bus"], 16, 4, 5, { bus: 1 });
  connectBothWays("bus-east-eastbound", "road-east-out", EAST_BUS_STOP_NODE_ID, ["bus"], 16, 4, 5, { bus: 1 });

  addNode({
    id: accessNodeId(OUTSIDE_FREIGHT_BUILDING_ID),
    kind: "access",
    x: -85,
    z: 4,
    buildingId: OUTSIDE_FREIGHT_BUILDING_ID,
  });
  addEdge({
    id: "access-outside-freight-in",
    from: accessNodeId(OUTSIDE_FREIGHT_BUILDING_ID),
    to: "road-west-in",
    modes: ["freight", "service"],
    length: 15,
    capacity: roadCapacity,
    freeFlowSpeed: 8,
    monetaryCost: { freight: 0.05, service: 0.04 },
  });
  addEdge({
    id: "access-outside-freight-out",
    from: "road-west-out",
    to: accessNodeId(OUTSIDE_FREIGHT_BUILDING_ID),
    modes: ["freight", "service"],
    length: 15,
    capacity: roadCapacity,
    freeFlowSpeed: 8,
    monetaryCost: { freight: 0.05, service: 0.04 },
  });

  addNode({
    id: accessNodeId(OUTSIDE_COMMUTER_BUILDING_ID),
    kind: "access",
    x: 85,
    z: -4,
    buildingId: OUTSIDE_COMMUTER_BUILDING_ID,
  });
  addEdge({
    id: "access-outside-commuter-in",
    from: accessNodeId(OUTSIDE_COMMUTER_BUILDING_ID),
    to: "road-east-in",
    modes: ["car"],
    length: 15,
    capacity: roadCapacity,
    freeFlowSpeed: 8,
    monetaryCost: { car: 0.045 },
  });
  addEdge({
    id: "access-outside-commuter-out",
    from: "road-east-out",
    to: accessNodeId(OUTSIDE_COMMUTER_BUILDING_ID),
    modes: ["car"],
    length: 15,
    capacity: roadCapacity,
    freeFlowSpeed: 8,
    monetaryCost: { car: 0.045 },
  });

  const roadAccessByArm = {
    west: { incoming: "road-west-in", outgoing: "road-west-out" },
    east: { incoming: "road-east-in", outgoing: "road-east-out" },
    north: { incoming: "road-north-in", outgoing: "road-north-out" },
    south: { incoming: "road-south-in", outgoing: "road-south-out" },
  } as const;
  for (const building of buildings) {
    const accessId = accessNodeId(building.id);
    addNode({
      id: accessId,
      kind: "access",
      x: building.x,
      z: building.z,
      buildingId: building.id,
    });
    const arm = closestArm(building.x, building.z);
    const roadAccess = roadAccessByArm[arm];
    const roadDistance = Math.max(8, distance(building, nodes.find((node) => node.id === roadAccess.incoming)!));
    addEdge({
      id: `access-${building.id}-road-out`,
      from: accessId,
      to: roadAccess.incoming,
      modes: PRIVATE_ROAD_MODES,
      length: roadDistance,
      capacity: Math.max(2, roadCapacity / 2),
      freeFlowSpeed: 6.7,
      monetaryCost: { car: 0.02, freight: 0.04, service: 0.03 },
      comfortPenalty: { car: 1, freight: 1.5, service: 1.2 },
    });
    addEdge({
      id: `access-${building.id}-road-in`,
      from: roadAccess.outgoing,
      to: accessId,
      modes: PRIVATE_ROAD_MODES,
      length: roadDistance,
      capacity: Math.max(2, roadCapacity / 2),
      freeFlowSpeed: 6.7,
      monetaryCost: { car: 0.02, freight: 0.04, service: 0.03 },
      comfortPenalty: { car: 1, freight: 1.5, service: 1.2 },
    });

    const sidewalk = closestNode(building, sidewalkNodes);
    connectBothWays(
      `access-${building.id}-walk`,
      accessId,
      sidewalk.id,
      ["walk"],
      Math.max(3, distance(building, sidewalk)),
      30,
      1.25,
      { walk: 0.4 },
    );

    const busStop = building.x < 0 ? WEST_BUS_STOP_NODE_ID : EAST_BUS_STOP_NODE_ID;
    connectBothWays(
      `access-${building.id}-bus`,
      accessId,
      busStop,
      ["bus"],
      Math.max(5, distance(building, nodes.find((node) => node.id === busStop)!)),
      40,
      1.2,
      { bus: 3 },
    );
  }

  return { nodes, edges };
}

export function calculateEdgeCost(
  edge: NetworkEdge & Partial<MobilityNetworkEdge>,
  mode: TravelMode,
): EdgeCostBreakdown {
  if (!edge.modes.includes(mode)) {
    return {
      travelTimeSeconds: Number.POSITIVE_INFINITY,
      congestionDelaySeconds: 0,
      monetaryCost: 0,
      monetaryCostSeconds: 0,
      comfortPenaltySeconds: 0,
      turnPenaltySeconds: 0,
      totalSeconds: Number.POSITIVE_INFINITY,
    };
  }

  const freeFlowSeconds = edge.length / Math.max(0.1, edge.freeFlowSpeed);
  const volumeCapacityRatio = edge.occupancy / Math.max(1, edge.capacity);
  const congestionMultiplier = 1 + CONGESTION_FACTOR * volumeCapacityRatio ** 4;
  const travelTimeSeconds = freeFlowSeconds * congestionMultiplier;
  const congestionDelaySeconds = travelTimeSeconds - freeFlowSeconds;
  const monetaryCost = edge.monetaryCost?.[mode] ?? 0;
  const monetaryCostSeconds = monetaryCost * MONEY_TO_SECONDS;
  const comfortPenaltySeconds = edge.comfortPenalty?.[mode] ?? 0;
  const turnPenaltySeconds = edge.turnPenalty ?? 0;

  return {
    travelTimeSeconds,
    congestionDelaySeconds,
    monetaryCost,
    monetaryCostSeconds,
    comfortPenaltySeconds,
    turnPenaltySeconds,
    totalSeconds:
      travelTimeSeconds + monetaryCostSeconds + comfortPenaltySeconds + turnPenaltySeconds,
  };
}

export function findRoute(
  network: StreetNetwork,
  originBuildingId: string,
  destinationBuildingId: string,
  mode: TravelMode,
): RoutePoint[] {
  return planRouteBetweenNodes(
    network,
    accessNodeId(originBuildingId),
    accessNodeId(destinationBuildingId),
    mode,
  ).points;
}

export function planRoute(
  network: StreetNetwork,
  originBuildingId: string,
  destinationBuildingId: string,
  mode: TravelMode,
): RoutePlan {
  return planRouteBetweenNodes(
    network,
    accessNodeId(originBuildingId),
    accessNodeId(destinationBuildingId),
    mode,
  );
}

export function planRouteBetweenNodes(
  network: StreetNetwork,
  originNodeId: string,
  destinationNodeId: string,
  mode: TravelMode,
): RoutePlan {
  const graph = new MultiDirectedGraph<NetworkNode, MobilityNetworkEdge>();
  for (const node of network.nodes) {
    graph.addNode(node.id, node);
  }

  const edgeById = new Map<string, MobilityNetworkEdge>();
  for (const sourceEdge of network.edges) {
    if (!sourceEdge.modes.includes(mode)) {
      continue;
    }
    const edge = normalizeEdge(sourceEdge);
    graph.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, edge);
    edgeById.set(edge.id, edge);
  }

  if (!graph.hasNode(originNodeId) || !graph.hasNode(destinationNodeId)) {
    throw new Error(`Unknown route endpoint: ${originNodeId} -> ${destinationNodeId}`);
  }

  let nodePath: string[];
  try {
    nodePath = dijkstra.bidirectional(graph, originNodeId, destinationNodeId, (edgeId) => {
      const edge = edgeById.get(edgeId);
      return edge ? calculateEdgeCost(edge, mode).totalSeconds : Number.POSITIVE_INFINITY;
    });
  } catch {
    throw new Error(`No ${mode} route from ${originNodeId} to ${destinationNodeId}`);
  }
  if (nodePath.length === 0) {
    throw new Error(`No ${mode} route from ${originNodeId} to ${destinationNodeId}`);
  }

  const routeEdges: MobilityNetworkEdge[] = [];
  for (let index = 0; index < nodePath.length - 1; index += 1) {
    const edgeIds = graph.directedEdges(nodePath[index]!, nodePath[index + 1]!);
    const bestEdge = edgeIds
      .map((edgeId) => edgeById.get(edgeId)!)
      .sort((first, second) => {
        const difference = calculateEdgeCost(first, mode).totalSeconds - calculateEdgeCost(second, mode).totalSeconds;
        return difference !== 0 ? difference : first.id.localeCompare(second.id);
      })[0];
    if (!bestEdge) {
      throw new Error(`Broken route between ${nodePath[index]} and ${nodePath[index + 1]}`);
    }
    routeEdges.push(bestEdge);
  }

  return {
    mode,
    points: nodePath.map((nodeId) => {
      const node = graph.getNodeAttributes(nodeId);
      return { nodeId, x: node.x, z: node.z };
    }),
    edges: routeEdges,
    cost: sumCosts(routeEdges.map((edge) => calculateEdgeCost(edge, mode))),
  };
}

export function accessNodeId(buildingId: string): string {
  return `access:${buildingId}`;
}

function normalizeEdge(edge: NetworkEdge): MobilityNetworkEdge {
  const weighted = edge as Partial<MobilityNetworkEdge>;
  return {
    ...edge,
    monetaryCost: weighted.monetaryCost ?? {},
    comfortPenalty: weighted.comfortPenalty ?? {},
    turnPenalty: weighted.turnPenalty ?? 0,
  };
}

function sumCosts(costs: EdgeCostBreakdown[]): EdgeCostBreakdown {
  const result: EdgeCostBreakdown = {
    travelTimeSeconds: 0,
    congestionDelaySeconds: 0,
    monetaryCost: 0,
    monetaryCostSeconds: 0,
    comfortPenaltySeconds: 0,
    turnPenaltySeconds: 0,
    totalSeconds: 0,
  };
  for (const cost of costs) {
    result.travelTimeSeconds += cost.travelTimeSeconds;
    result.congestionDelaySeconds += cost.congestionDelaySeconds;
    result.monetaryCost += cost.monetaryCost;
    result.monetaryCostSeconds += cost.monetaryCostSeconds;
    result.comfortPenaltySeconds += cost.comfortPenaltySeconds;
    result.turnPenaltySeconds += cost.turnPenaltySeconds;
    result.totalSeconds += cost.totalSeconds;
  }
  return result;
}

function closestArm(x: number, z: number): "west" | "east" | "north" | "south" {
  if (Math.abs(x) >= Math.abs(z)) {
    return x < 0 ? "west" : "east";
  }
  return z < 0 ? "north" : "south";
}

function closestNode(point: { x: number; z: number }, candidates: readonly NetworkNode[]): NetworkNode {
  return candidates.reduce((best, candidate) =>
    distance(point, candidate) < distance(point, best) ? candidate : best,
  );
}

function distance(first: { x: number; z: number }, second: { x: number; z: number }): number {
  return Math.hypot(second.x - first.x, second.z - first.z);
}
