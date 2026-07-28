import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CityDistrictState, CityLinkDefinition } from "../models/cityTypes";
import type {
  AgentPosition,
  Building,
  BuildingConnectionKind,
  GridCellDesign,
  GridSignalDesign,
  Pedestrian,
  SimulationState,
  TransitStop,
  Vehicle,
  ZoneType,
} from "../models/types";
import { BUILD_CELL_SIZE, BUILD_GRID_SIZE } from "../models/types";

const WORLD_SCALE = 0.62;
const CITY_DETAIL_DISTANCE = 205;
const VEHICLE_COLORS = ["#ef5a45", "#2f75c9", "#e2ad3c", "#2f956f", "#865fb0"];
const CONNECTION_COLORS = { commute: "#49a7e8", customer: "#e0a83d", supply: "#db735d" };
const ZONE_COLORS: Record<ZoneType, string> = {
  residential: "#69a8a0",
  commercial: "#d8a755",
  industrial: "#b66c52",
  civic: "#688fc3",
  park: "#5d9b67",
};

export type VisualLayer =
  | "none"
  | "congestion"
  | "pedestrian-wait"
  | "land-value"
  | "utilities"
  | "jobs"
  | "shortages"
  | "migration"
  | "freight"
  | "profit";

export type VisibleFlow = "commute" | "customer" | "supply" | "daily-route";
export type SceneDetailMode = "city" | "street" | "entity";

export interface DaylightState {
  daylight: number;
  sunriseMinutes: number;
  sunsetMinutes: number;
  sunProgress: number;
}

export interface VisualLayerMetrics {
  congestion: number;
  pedestrianWait: number;
  landValue: number;
  utilities: number;
  jobs: number;
  shortages: number;
  migration: number;
  freight: number;
  profit: number;
}

export type SceneSelection =
  | { kind: "building"; id: string }
  | { kind: "person"; id: string }
  | null;

export function resolveSceneDetailMode(cameraDistance: number, hasSelection: boolean): SceneDetailMode {
  if (hasSelection) return "entity";
  return cameraDistance > CITY_DETAIL_DISTANCE ? "city" : "street";
}

export function calculateDaylight(timeOfDayMinutes: number, calendarMonth: number): DaylightState {
  const minute = ((timeOfDayMinutes % 1440) + 1440) % 1440;
  const month = THREE.MathUtils.clamp(calendarMonth, 1, 12);
  const seasonalOffset = Math.sin((month - 3) / 12 * Math.PI * 2);
  const daylightHours = 12 + seasonalOffset * 3;
  const sunriseMinutes = 720 - daylightHours * 30;
  const sunsetMinutes = 720 + daylightHours * 30;
  const twilightMinutes = 45;
  const sunProgress = THREE.MathUtils.clamp(
    (minute - sunriseMinutes) / (sunsetMinutes - sunriseMinutes),
    0,
    1,
  );

  let daylight = 0.04;
  if (minute >= sunriseMinutes && minute <= sunsetMinutes) {
    daylight = 0.22 + Math.sin(sunProgress * Math.PI) * 0.78;
  } else if (minute >= sunriseMinutes - twilightMinutes && minute < sunriseMinutes) {
    daylight = THREE.MathUtils.lerp(0.04, 0.22, (minute - sunriseMinutes + twilightMinutes) / twilightMinutes);
  } else if (minute > sunsetMinutes && minute <= sunsetMinutes + twilightMinutes) {
    daylight = THREE.MathUtils.lerp(0.22, 0.04, (minute - sunsetMinutes) / twilightMinutes);
  }

  return { daylight, sunriseMinutes, sunsetMinutes, sunProgress };
}

export function flowForConnection(kind: BuildingConnectionKind): VisibleFlow {
  return kind;
}

export function valueForVisualLayer(layer: VisualLayer, metrics: VisualLayerMetrics): number {
  switch (layer) {
    case "congestion": return metrics.congestion;
    case "pedestrian-wait": return metrics.pedestrianWait;
    case "land-value": return metrics.landValue;
    case "utilities": return metrics.utilities;
    case "jobs": return metrics.jobs;
    case "shortages": return metrics.shortages;
    case "migration": return metrics.migration;
    case "freight": return metrics.freight;
    case "profit": return metrics.profit;
    case "none": return 0.5;
  }
}

export function colorForVisualLayer(layer: VisualLayer, value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  if (layer === "none") return 0xffffff;
  if (layer === "land-value") return colorRamp(clamped, 0x315a78, 0x6fae9c, 0xf0c14b);
  if (layer === "utilities" || layer === "jobs" || layer === "migration" || layer === "profit") {
    return colorRamp(clamped, 0xc94d44, 0xe5ca62, 0x4d9b65);
  }
  return colorRamp(clamped, 0x3b76a5, 0xe1ca58, 0xc94d44);
}

export function isVisibleVehicleSegment(segmentId: string): boolean {
  return segmentId.startsWith("road-") || segmentId.startsWith("movement-");
}

export function isVisiblePedestrianSegment(segmentId: string): boolean {
  return segmentId.startsWith("sidewalk-") || segmentId.startsWith("crosswalk-");
}

interface SceneVisualMetrics {
  districts: ReadonlyMap<string, VisualLayerMetrics>;
  buildings: ReadonlyMap<string, VisualLayerMetrics>;
}

interface VisualMetricsCache {
  elapsedSeconds: number;
  layer: VisualLayer;
  buildings: readonly Building[];
  districts: readonly CityDistrictState[];
  vehicles: readonly Vehicle[];
  pedestrians: readonly Pedestrian[];
  metrics: SceneVisualMetrics;
}

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 340);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight("#fff3d7", 4.2);
  private readonly skyLight = new THREE.HemisphereLight("#e8f6ff", "#486247", 2.3);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly vehicles = new Map<string, THREE.Group>();
  private readonly pedestrians = new Map<string, THREE.Group>();
  private readonly buildings = new Map<string, THREE.Group>();
  private readonly districtMeshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  private readonly cityLinkMeshes = new Map<string, THREE.Mesh>();
  private readonly transitStopGroups = new Map<string, THREE.Group>();
  private readonly connectionLines = new THREE.Group();
  private readonly streetElements = new THREE.Group();
  private readonly buildGridGroup = new THREE.Group();
  private readonly buildGridHelper = new THREE.GridHelper(
    BUILD_GRID_SIZE * BUILD_CELL_SIZE,
    BUILD_GRID_SIZE,
    "#75e4c4",
    "#8aa99c",
  );
  private buildMode = false;
  private selection: SceneSelection = null;
  private visualLayer: VisualLayer = "none";
  private visibleFlows = new Set<VisibleFlow>(["commute", "customer", "supply", "daily-route"]);
  private detailMode: SceneDetailMode = "street";
  private visualMetricsCache: VisualMetricsCache | null = null;
  private connectionRenderSignature = "";
  private lastShadowUpdateMs = Number.NEGATIVE_INFINITY;
  private pointerStart: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelection: (selection: SceneSelection) => void = () => undefined,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color("#b9d4df");
    this.scene.fog = new THREE.Fog("#b9d4df", 135, 300);
    this.camera.position.set(98, 106, 116);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 230;
    this.controls.maxPolarAngle = Math.PI / 2.08;

    this.buildLighting();
    this.scene.add(this.streetElements);
    this.buildStreet();
    this.buildGridHelper.position.y = 0.58;
    this.buildGridHelper.visible = false;
    this.buildGridGroup.visible = false;
    this.scene.add(this.buildGridHelper, this.buildGridGroup);
    this.scene.add(this.connectionLines);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
  }

  setSelection(selection: SceneSelection): void {
    this.selection = selection;
    this.detailMode = resolveSceneDetailMode(
      this.camera.position.distanceTo(this.controls.target),
      selection !== null,
    );
    this.connectionRenderSignature = "";
  }

  setBuildMode(enabled: boolean): void {
    this.buildMode = enabled;
    this.buildGridHelper.visible = enabled;
    this.buildGridGroup.visible = enabled;
    this.streetElements.visible = !enabled;
    this.connectionLines.visible = !enabled;
    for (const collection of [
      this.buildings,
      this.vehicles,
      this.pedestrians,
      this.transitStopGroups,
    ]) {
      for (const object of collection.values()) object.visible = !enabled;
    }
    for (const object of this.districtMeshes.values()) object.visible = !enabled;
    for (const object of this.cityLinkMeshes.values()) object.visible = !enabled;
    if (enabled) {
      this.setSelection(null);
      this.camera.position.set(36, 42, 42);
      this.controls.target.set(0, 0, 0);
    } else {
      this.camera.position.set(98, 106, 116);
      this.controls.target.set(0, 0, 0);
      this.visualMetricsCache = null;
    }
    this.controls.update();
    this.renderer.shadowMap.needsUpdate = true;
  }

  setGridDesign(
    cells: readonly GridCellDesign[],
    signals: readonly GridSignalDesign[] = [],
  ): void {
    this.clearBuildGrid();
    for (const cell of cells) this.buildGridCell(cell);
    this.addAutomaticStopLines(cells);
    for (const signal of signals) this.buildGridSignal(signal);
    this.renderer.shadowMap.needsUpdate = true;
  }

  setVisualLayer(layer: VisualLayer): void {
    if (this.visualLayer === layer) return;
    this.visualLayer = layer;
    this.visualMetricsCache = null;
  }

  setVisibleFlows(flows: ReadonlySet<VisibleFlow> | readonly VisibleFlow[]): void {
    const nextFlows = new Set(flows);
    if (setsEqual(this.visibleFlows, nextFlows)) return;
    this.visibleFlows = nextFlows;
    this.connectionRenderSignature = "";
    this.clearConnectionLines();
  }

  getDetailMode(): SceneDetailMode {
    return this.detailMode;
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.camera.aspect = bounds.width / Math.max(bounds.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  render(state: Readonly<SimulationState>): void {
    this.controls.update();
    if (this.buildMode) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.detailMode = resolveSceneDetailMode(
      this.camera.position.distanceTo(this.controls.target),
      this.selection !== null,
    );
    const visualMetrics = this.getVisualMetrics(state);
    this.syncCityLinks(state.city.links, state.city.districts);
    this.syncCityDistricts(state.city.districts, visualMetrics.districts);
    this.syncBuildings(state.buildings, visualMetrics.buildings);
    this.syncTransitStops(state.infrastructure.transitStops, state.network.nodes);
    this.syncVehicles(state.vehicles);
    this.syncPedestrians(state.pedestrians);
    this.syncSelection(state);
    this.syncSelectionDimming(state);
    this.updateDaylight(state.timeOfDayMinutes, state.calendarMonth);

    this.renderer.render(this.scene, this.camera);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (
      this.pointerStart === null ||
      Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5
    ) {
      this.pointerStart = null;
      return;
    }
    this.pointerStart = null;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickable = [...this.buildings.values(), ...this.pedestrians.values()]
      .filter((object) => object.visible);
    const hit = this.raycaster.intersectObjects(pickable, true)[0];
    const selection = selectionFromObject(hit?.object);
    this.setSelection(selection);
    this.onSelection(selection);
  };

  private buildLighting(): void {
    this.scene.add(this.skyLight);
    this.sun.position.set(32, 55, 26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -105;
    this.sun.shadow.camera.right = 105;
    this.sun.shadow.camera.top = 105;
    this.sun.shadow.camera.bottom = -105;
    this.scene.add(this.sun);
    this.renderer.shadowMap.needsUpdate = true;
  }

  private buildStreet(): void {
    const ground = mesh(
      new THREE.PlaneGeometry(190, 165),
      new THREE.MeshStandardMaterial({ color: "#789872", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const roadLength = 178;
    const roadWidth = 8.7;
    this.addBox(0, 0.13, 0, roadLength, 0.16, roadWidth, "#30383a", true, this.streetElements);
    this.addBox(0, 0.14, 0, roadWidth, 0.18, 154, "#30383a", true, this.streetElements);

    const sidewalkOffset = 5.9;
    for (const offset of [-sidewalkOffset, sidewalkOffset]) {
      this.addBox(0, 0.2, offset, roadLength, 0.2, 1.15, "#b6bab5", true, this.streetElements);
      this.addBox(offset, 0.21, 0, 1.15, 0.22, 154, "#b6bab5", true, this.streetElements);
    }

    for (let position = -82; position <= 82; position += 6) {
      if (Math.abs(position) < 7) continue;
      this.addBox(position, 0.24, 0, 2.7, 0.03, 0.12, "#e7d86b", false, this.streetElements);
    }
    for (let position = -70; position <= 70; position += 6) {
      if (Math.abs(position) < 7) continue;
      this.addBox(0, 0.25, position, 0.12, 0.03, 2.7, "#e7d86b", false, this.streetElements);
    }
    this.addCrosswalk(0, -6.2, true);
    this.addCrosswalk(0, 6.2, true);
    this.addCrosswalk(-6.2, 0, false);
    this.addCrosswalk(6.2, 0, false);
  }

  private addCrosswalk(x: number, z: number, horizontal: boolean): void {
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const offset = stripe * 0.8;
      this.addBox(
        x + (horizontal ? offset : 0),
        0.27,
        z + (horizontal ? 0 : offset),
        horizontal ? 0.42 : 3.6,
        0.03,
        horizontal ? 3.6 : 0.42,
        "#ecebe1",
        false,
        this.streetElements,
      );
    }
  }

  private syncCityLinks(
    links: readonly CityLinkDefinition[],
    districts: readonly CityDistrictState[],
  ): void {
    for (const linkMesh of this.cityLinkMeshes.values()) {
      linkMesh.visible = this.detailMode === "city";
    }
    if (this.cityLinkMeshes.size === links.length) return;
    const districtById = new Map(districts.map((district) => [district.id, district]));
    for (const link of links) {
      if (this.cityLinkMeshes.has(link.id)) continue;
      const start = districtById.get(link.fromDistrictId);
      const end = districtById.get(link.toDistrictId);
      if (!start || !end) continue;
      const startX = start.x * WORLD_SCALE;
      const startZ = start.z * WORLD_SCALE;
      const endX = end.x * WORLD_SCALE;
      const endZ = end.z * WORLD_SCALE;
      const length = Math.hypot(endX - startX, endZ - startZ);
      const linkMesh = mesh(
        new THREE.BoxGeometry(length, 0.06, 0.32),
        new THREE.MeshStandardMaterial({ color: "#6f8785", roughness: 0.9 }),
      );
      linkMesh.position.set((startX + endX) / 2, 0.08, (startZ + endZ) / 2);
      linkMesh.rotation.y = -Math.atan2(endZ - startZ, endX - startX);
      linkMesh.visible = this.detailMode === "city";
      this.scene.add(linkMesh);
      this.cityLinkMeshes.set(link.id, linkMesh);
    }
  }

  private syncCityDistricts(
    districts: readonly CityDistrictState[],
    visualMetrics: ReadonlyMap<string, VisualLayerMetrics>,
  ): void {
    const activeIds = new Set<string>();
    for (const district of districts) {
      activeIds.add(district.id);
      let districtMesh = this.districtMeshes.get(district.id);
      if (!districtMesh) {
        districtMesh = mesh(
          new THREE.BoxGeometry(district.width * WORLD_SCALE * 0.82, 0.1, district.depth * WORLD_SCALE * 0.82),
          new THREE.MeshStandardMaterial({ color: ZONE_COLORS[district.primaryZone], roughness: 0.96 }),
        );
        districtMesh.receiveShadow = true;
        this.scene.add(districtMesh);
        this.districtMeshes.set(district.id, districtMesh);
      }
      districtMesh.position.set(district.x * WORLD_SCALE, 0.08, district.z * WORLD_SCALE);
      districtMesh.visible = this.detailMode === "city";
      const metrics = visualMetrics.get(district.id);
      districtMesh.material.color.set(
        this.visualLayer === "none" || metrics === undefined
          ? ZONE_COLORS[district.primaryZone]
          : colorForVisualLayer(this.visualLayer, valueForVisualLayer(this.visualLayer, metrics)),
      );
    }
    this.removeMissingMeshes(this.districtMeshes, activeIds);
  }

  private syncBuildings(
    states: readonly Building[],
    visualMetrics: ReadonlyMap<string, VisualLayerMetrics>,
  ): void {
    const activeIds = new Set<string>();
    for (const state of states) {
      activeIds.add(state.id);
      const group = this.buildings.get(state.id) ?? this.addBuilding(state);
      group.position.set(state.x * WORLD_SCALE, 0.18, state.z * WORLD_SCALE);
      group.visible = this.detailMode !== "city";
      const body = group.getObjectByName("building-body") as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      const roof = group.getObjectByName("building-roof") as THREE.Mesh;
      const height = 1.25 + state.floors * 0.72;
      body.scale.y = height;
      body.position.y = height / 2;
      roof.position.y = height + 0.13;
      const metrics = visualMetrics.get(state.id);
      body.material.color.set(
        this.visualLayer === "none" || metrics === undefined
          ? ZONE_COLORS[state.zone]
          : colorForVisualLayer(this.visualLayer, valueForVisualLayer(this.visualLayer, metrics)),
      );
      const selected = this.selection?.kind === "building" && this.selection.id === state.id;
      body.material.emissive.set(selected ? "#f6c85f" : "#000000");
      body.material.emissiveIntensity = selected ? 0.65 : 0;
    }
    this.removeMissing(this.buildings, activeIds);
  }

  private addBuilding(state: Building): THREE.Group {
    const group = new THREE.Group();
    group.userData.selection = { kind: "building", id: state.id } satisfies Exclude<SceneSelection, null>;
    const body = mesh(
      new THREE.BoxGeometry(5.2, 1, 4.1),
      new THREE.MeshStandardMaterial({ color: ZONE_COLORS[state.zone], roughness: 0.68 }),
    );
    body.name = "building-body";
    body.castShadow = true;
    body.receiveShadow = true;
    const roof = mesh(
      new THREE.BoxGeometry(5.45, 0.24, 4.35),
      new THREE.MeshStandardMaterial({ color: "#d9ded7", roughness: 0.82 }),
    );
    roof.name = "building-roof";
    roof.castShadow = true;
    group.add(body, roof);
    this.scene.add(group);
    this.buildings.set(state.id, group);
    return group;
  }

  private syncTransitStops(
    stops: readonly TransitStop[],
    nodes: ReadonlyArray<{ id: string; x: number; z: number }>,
  ): void {
    for (const group of this.transitStopGroups.values()) {
      group.visible = this.detailMode !== "city";
    }
    if (this.transitStopGroups.size === stops.length) return;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    for (const stop of stops) {
      if (this.transitStopGroups.has(stop.id)) continue;
      const node = nodeMap.get(stop.nodeId);
      if (!node) continue;
      const group = new THREE.Group();
      const pole = mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 1.8, 10),
        new THREE.MeshStandardMaterial({ color: "#263238" }),
      );
      pole.position.y = 0.9;
      const sign = mesh(
        new THREE.BoxGeometry(0.65, 0.5, 0.1),
        new THREE.MeshStandardMaterial({ color: "#4f9fc6", emissive: "#153b4d" }),
      );
      sign.position.y = 1.65;
      group.add(pole, sign);
      group.position.set(node.x * WORLD_SCALE, 0.42, node.z * WORLD_SCALE);
      group.visible = this.detailMode !== "city";
      this.scene.add(group);
      this.transitStopGroups.set(stop.id, group);
    }
  }

  private syncVehicles(vehicleStates: readonly Vehicle[]): void {
    const activeIds = new Set<string>();
    for (const state of vehicleStates) {
      if (state.completed || !isVisibleVehicleSegment(state.position.segmentId)) {
        this.removeGroup(this.vehicles, state.id);
        continue;
      }
      activeIds.add(state.id);
      const existing = this.vehicles.get(state.id);
      if (this.detailMode === "city" && existing === undefined) continue;
      const group = existing ?? this.addVehicle(state);
      group.visible = this.detailMode !== "city";
      this.placeAgent(group, state.position, 0.2);
    }
    this.removeMissing(this.vehicles, activeIds);
  }

  private addVehicle(state: Vehicle): THREE.Group {
    const group = new THREE.Group();
    const color = state.vehicleType === "bus"
      ? "#e6c54f"
      : state.vehicleType === "truck"
        ? "#6587a6"
        : VEHICLE_COLORS[paletteIndex(state.id, VEHICLE_COLORS.length)];
    const dimensions = state.vehicleType === "bus"
      ? [3.8, 1.05, 1.35]
      : state.vehicleType === "truck"
        ? [3.3, 1.15, 1.35]
        : [2.35, 0.72, 1.2];
    const body = mesh(
      new THREE.BoxGeometry(dimensions[0], dimensions[1], dimensions[2]),
      new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.06 }),
    );
    body.position.y = 0.45 + dimensions[1] / 2;
    group.add(body);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#151a1c", roughness: 0.85 });
    for (const x of [-dimensions[0] * 0.31, dimensions[0] * 0.31]) {
      for (const z of [-dimensions[2] * 0.53, dimensions[2] * 0.53]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 14), wheelMaterial);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.34, z);
        group.add(wheel);
      }
    }
    this.scene.add(group);
    this.vehicles.set(state.id, group);
    return group;
  }

  private syncPedestrians(states: readonly Pedestrian[]): void {
    const activeIds = new Set<string>();
    for (const state of states) {
      if (state.completed || !isVisiblePedestrianSegment(state.position.segmentId)) {
        this.removeGroup(this.pedestrians, state.id);
        continue;
      }
      activeIds.add(state.id);
      const existing = this.pedestrians.get(state.id);
      if (this.detailMode === "city" && existing === undefined) continue;
      const group = existing ?? this.addPedestrian(state);
      group.visible = this.detailMode !== "city";
      group.userData.selection = state.personId === undefined
        ? undefined
        : { kind: "person", id: state.personId } satisfies Exclude<SceneSelection, null>;
      this.placeAgent(group, state.position, 0.22, pedestrianLaneOffset(state.position.segmentId));
      const body = group.getObjectByName("person-body") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const selected = this.selection?.kind === "person" && this.selection.id === state.personId;
      body.material.emissive.set(selected ? "#fff4a3" : "#000000");
      body.material.emissiveIntensity = selected ? 1 : 0;
      group.scale.setScalar(selected ? 1.75 : 1.35);
    }
    this.removeMissing(this.pedestrians, activeIds);
  }

  private addPedestrian(state: Pedestrian): THREE.Group {
    const group = new THREE.Group();
    const clothingColors = ["#156f73", "#9b4f59", "#6d5b9a", "#49734f"];
    const body = mesh(
      new THREE.CapsuleGeometry(0.25, state.ageGroup === "child" ? 0.46 : 0.68, 4, 8),
      new THREE.MeshStandardMaterial({ color: clothingColors[paletteIndex(state.id, 4)] }),
    );
    body.name = "person-body";
    body.position.y = state.ageGroup === "child" ? 0.85 : 1.05;
    const head = mesh(
      new THREE.SphereGeometry(0.24, 14, 10),
      new THREE.MeshStandardMaterial({ color: "#d7a27c" }),
    );
    head.position.y = state.ageGroup === "child" ? 1.38 : 1.72;
    const pickTarget = mesh(
      new THREE.SphereGeometry(0.62, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pickTarget.position.y = 1;
    group.add(body, head, pickTarget);
    this.scene.add(group);
    this.pedestrians.set(state.id, group);
    return group;
  }

  private syncSelection(state: Readonly<SimulationState>): void {
    this.connectionLines.visible = this.detailMode === "entity";
    const flowSignature = [...this.visibleFlows].sort().join(",");
    if (this.selection?.kind === "building") {
      const connections = state.buildingConnections.filter((connection) =>
        this.visibleFlows.has(flowForConnection(connection.kind))
        && (connection.fromBuildingId === this.selection?.id
          || connection.toBuildingId === this.selection?.id)
      );
      const signature = `building:${this.selection.id}:${flowSignature}:${connections.map((connection) =>
        `${connection.kind}:${connection.fromBuildingId}:${connection.toBuildingId}:${connection.volume}`
      ).join("|")}`;
      if (signature === this.connectionRenderSignature) return;
      this.connectionRenderSignature = signature;
      this.clearConnectionLines();
      for (const connection of connections) {
        const from = this.pointForBuilding(connection.fromBuildingId, state);
        const to = this.pointForBuilding(connection.toBuildingId, state);
        if (from !== undefined && to !== undefined) {
          this.addConnectionLine(from, to, CONNECTION_COLORS[connection.kind]);
        }
      }
      return;
    }
    if (this.selection?.kind === "person") {
      const person = state.people.find((candidate) => candidate.id === this.selection?.id);
      const signature = person === undefined || !this.visibleFlows.has("daily-route")
        ? `person:${this.selection.id}:${flowSignature}:hidden`
        : `person:${person.id}:${flowSignature}:${person.schedule.map((activity) =>
          `${activity.activity}:${activity.startMinute}:${activity.endMinute}:${activity.buildingId}`
        ).join("|")}`;
      if (signature === this.connectionRenderSignature) return;
      this.connectionRenderSignature = signature;
      this.clearConnectionLines();
      if (person === undefined || !this.visibleFlows.has("daily-route")) return;
      const itinerary = person.schedule
        .map((activity) => this.pointForBuilding(activity.buildingId, state))
        .filter((point): point is THREE.Vector3 => point !== undefined)
        .filter((point, index, points) => index === 0 || !point.equals(points[index - 1]!));
      for (let index = 1; index < itinerary.length; index += 1) {
        this.addConnectionLine(itinerary[index - 1]!, itinerary[index]!, "#f0dd70");
      }
      return;
    }
    if (this.connectionRenderSignature === "none") return;
    this.connectionRenderSignature = "none";
    this.clearConnectionLines();
  }

  private syncSelectionDimming(state: Readonly<SimulationState>): void {
    if (this.selection === null) {
      for (const group of this.buildings.values()) setGroupDimmed(group, false);
      for (const group of this.vehicles.values()) setGroupDimmed(group, false);
      for (const group of this.pedestrians.values()) setGroupDimmed(group, false);
      return;
    }

    const relatedBuildingIds = new Set<string>();
    const relatedPersonIds = new Set<string>();
    if (this.selection.kind === "building") {
      relatedBuildingIds.add(this.selection.id);
      for (const connection of state.buildingConnections) {
        if (!this.visibleFlows.has(flowForConnection(connection.kind))) continue;
        if (connection.fromBuildingId !== this.selection.id && connection.toBuildingId !== this.selection.id) continue;
        relatedBuildingIds.add(connection.fromBuildingId);
        relatedBuildingIds.add(connection.toBuildingId);
        connection.personIds.forEach((id) => relatedPersonIds.add(id));
      }
      for (const person of state.people) {
        if (
          person.homeBuildingId === this.selection.id
          || person.workBuildingId === this.selection.id
          || person.currentBuildingId === this.selection.id
          || person.destinationBuildingId === this.selection.id
        ) {
          relatedPersonIds.add(person.id);
        }
      }
    } else {
      relatedPersonIds.add(this.selection.id);
      const person = state.people.find((candidate) => candidate.id === this.selection?.id);
      if (person !== undefined) {
        relatedBuildingIds.add(person.homeBuildingId);
        relatedBuildingIds.add(person.currentBuildingId);
        if (person.workBuildingId !== undefined) relatedBuildingIds.add(person.workBuildingId);
        if (person.schoolBuildingId !== undefined) relatedBuildingIds.add(person.schoolBuildingId);
        if (person.destinationBuildingId !== undefined) relatedBuildingIds.add(person.destinationBuildingId);
        if (this.visibleFlows.has("daily-route")) {
          person.schedule.forEach((activity) => relatedBuildingIds.add(activity.buildingId));
        }
      }
    }

    for (const [id, group] of this.buildings) {
      setGroupDimmed(group, !relatedBuildingIds.has(id));
    }
    for (const [id, group] of this.vehicles) {
      const vehicle = state.vehicles.find((candidate) => candidate.id === id);
      const related = vehicle !== undefined && (
        (vehicle.ownerPersonId !== undefined && relatedPersonIds.has(vehicle.ownerPersonId))
        || (vehicle.destinationBuildingId !== undefined && relatedBuildingIds.has(vehicle.destinationBuildingId))
      );
      setGroupDimmed(group, !related);
    }
    for (const [id, group] of this.pedestrians) {
      const pedestrian = state.pedestrians.find((candidate) => candidate.id === id);
      const related = pedestrian !== undefined && (
        (pedestrian.personId !== undefined && relatedPersonIds.has(pedestrian.personId))
        || (pedestrian.destinationBuildingId !== undefined && relatedBuildingIds.has(pedestrian.destinationBuildingId))
      );
      setGroupDimmed(group, !related);
    }
  }

  private getVisualMetrics(state: Readonly<SimulationState>): SceneVisualMetrics {
    if (this.visualLayer === "none") return EMPTY_SCENE_VISUAL_METRICS;
    const cache = this.visualMetricsCache;
    if (
      cache !== null
      && cache.elapsedSeconds === state.elapsedSeconds
      && cache.layer === this.visualLayer
      && cache.buildings === state.buildings
      && cache.districts === state.city.districts
      && cache.vehicles === state.vehicles
      && cache.pedestrians === state.pedestrians
    ) {
      return cache.metrics;
    }
    const metrics = createSceneVisualMetrics(state);
    this.visualMetricsCache = {
      elapsedSeconds: state.elapsedSeconds,
      layer: this.visualLayer,
      buildings: state.buildings,
      districts: state.city.districts,
      vehicles: state.vehicles,
      pedestrians: state.pedestrians,
      metrics,
    };
    return metrics;
  }

  private pointForBuilding(id: string, state: Readonly<SimulationState>): THREE.Vector3 | undefined {
    const building = state.buildings.find((candidate) => candidate.id === id);
    if (building !== undefined) return new THREE.Vector3(building.x * WORLD_SCALE, 1.6, building.z * WORLD_SCALE);
    const externalNode = state.network.nodes.find((node) => node.buildingId === id);
    return externalNode === undefined
      ? undefined
      : new THREE.Vector3(externalNode.x * WORLD_SCALE, 1.6, externalNode.z * WORLD_SCALE);
  }

  private addConnectionLine(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    const middle = from.clone().lerp(to, 0.5);
    middle.y = Math.max(3.2, from.distanceTo(to) * 0.08);
    const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
    const group = new THREE.Group();
    const outline = mesh(
      new THREE.TubeGeometry(curve, 32, 0.24, 7, false),
      new THREE.MeshBasicMaterial({ color: "#111816", transparent: true, opacity: 0.62, depthTest: false, depthWrite: false }),
    );
    const route = mesh(
      new THREE.TubeGeometry(curve, 32, 0.13, 7, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false }),
    );
    const arrowProgress = 0.76;
    const direction = curve.getTangent(arrowProgress).normalize();
    const arrow = mesh(
      new THREE.ConeGeometry(0.62, 1.45, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    arrow.position.copy(curve.getPoint(arrowProgress));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const origin = mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    origin.position.copy(from);
    outline.renderOrder = 18;
    route.renderOrder = 19;
    arrow.renderOrder = 20;
    origin.renderOrder = 20;
    group.add(outline, route, arrow, origin);
    this.connectionLines.add(group);
  }

  private clearConnectionLines(): void {
    for (const child of [...this.connectionLines.children]) {
      this.connectionLines.remove(child);
      disposeObject(child);
    }
  }

  private placeAgent(
    group: THREE.Group,
    position: AgentPosition,
    y: number,
    lateralOffset = 0,
  ): void {
    const perpendicularX = Math.sin(position.headingRadians);
    const perpendicularZ = Math.cos(position.headingRadians);
    group.position.set(
      position.x * WORLD_SCALE + perpendicularX * lateralOffset,
      y,
      position.z * WORLD_SCALE + perpendicularZ * lateralOffset,
    );
    group.rotation.y = position.headingRadians;
  }

  private removeMissing(objects: Map<string, THREE.Group>, activeIds: Set<string>): void {
    for (const [id] of objects) {
      if (activeIds.has(id)) continue;
      this.removeGroup(objects, id);
    }
  }

  private removeGroup(objects: Map<string, THREE.Group>, id: string): void {
    const group = objects.get(id);
    if (!group) return;
    this.scene.remove(group);
    disposeObject(group);
    objects.delete(id);
  }

  private removeMissingMeshes(
    objects: Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>,
    activeIds: Set<string>,
  ): void {
    for (const [id, object] of objects) {
      if (activeIds.has(id)) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      object.material.dispose();
      objects.delete(id);
    }
  }

  private updateDaylight(timeMinutes: number, calendarMonth: number): void {
    const daylightState = calculateDaylight(timeMinutes, calendarMonth);
    const daylight = daylightState.daylight;
    const sunArc = daylightState.sunProgress * Math.PI;
    const sunHeight = Math.sin(sunArc);
    this.sun.intensity = 0.4 + daylight * 4;
    this.skyLight.intensity = 0.35 + daylight * 2;
    const now = performance.now();
    if (now - this.lastShadowUpdateMs >= 250) {
      this.lastShadowUpdateMs = now;
      this.sun.position.set(Math.cos(sunArc) * 52, 5 + sunHeight * 52, Math.sin(sunArc) * 30);
      this.renderer.shadowMap.needsUpdate = true;
    }
    const nightSky = new THREE.Color("#192838");
    const daySky = new THREE.Color("#b9d4df");
    const sky = nightSky.clone().lerp(daySky, daylight);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.renderer.toneMappingExposure = 0.65 + daylight * 0.45;
  }

  private buildGridCell(cell: GridCellDesign): void {
    const { x, z } = this.getBuildCellPosition(cell.row, cell.column);
    const tileSize = BUILD_CELL_SIZE - 0.18;

    if (cell.element === "lane" || cell.element === "white-lane") {
      this.addBox(x, 0.5, z, tileSize, 0.16, tileSize, "#29343a", false, this.buildGridGroup);
      const horizontal = cell.rotation % 2 === 1;
      this.addBox(
        x,
        0.61,
        z,
        horizontal ? tileSize - 0.3 : 0.12,
        0.035,
        horizontal ? 0.12 : tileSize - 0.3,
        cell.element === "lane" ? "#f6ca55" : "#f4f5f2",
        false,
        this.buildGridGroup,
      );
      return;
    }

    if (cell.element === "asphalt") {
      this.addBox(x, 0.5, z, tileSize, 0.16, tileSize, "#20292d", false, this.buildGridGroup);
      return;
    }

    if (cell.element === "sidewalk") {
      this.addBox(x, 0.57, z, tileSize, 0.3, tileSize, "#c7c8be", true, this.buildGridGroup);
      this.addBox(
        x,
        0.75,
        z,
        tileSize - 0.45,
        0.06,
        tileSize - 0.45,
        "#93af82",
        false,
        this.buildGridGroup,
      );
      return;
    }

    if (cell.element === "crosswalk") {
      this.addBox(x, 0.5, z, tileSize, 0.16, tileSize, "#29343a", false, this.buildGridGroup);
      for (let stripe = -2; stripe <= 2; stripe += 1) {
        const horizontal = cell.rotation % 2 === 1;
        this.addBox(
          x + (horizontal ? 0 : stripe * 0.65),
          0.6,
          z + (horizontal ? stripe * 0.65 : 0),
          horizontal ? tileSize - 0.55 : 0.38,
          0.04,
          horizontal ? 0.38 : tileSize - 0.55,
          "#f2efe6",
          false,
          this.buildGridGroup,
        );
      }
      return;
    }

    this.buildGridSignal(cell);
  }

  private buildGridSignal(signal: GridSignalDesign): void {
    const { x, z } = this.getBuildCellPosition(signal.row, signal.column);
    const pole = mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 3, 12),
      new THREE.MeshStandardMaterial({ color: "#263238", metalness: 0.35 }),
    );
    pole.position.set(x, 2, z);
    pole.castShadow = true;
    this.buildGridGroup.add(pole);

    const housing = this.addBox(
      x,
      3.35,
      z,
      0.72,
      1.05,
      0.5,
      "#162126",
      true,
      this.buildGridGroup,
    );
    housing.rotation.y = signal.rotation * (Math.PI / 2);
    const lampOffsets = [
      [0, 0.28],
      [0.28, 0],
      [0, -0.28],
      [-0.28, 0],
    ] as const;
    const [lampX, lampZ] = lampOffsets[signal.rotation % 4] ?? lampOffsets[0];
    for (const [index, color] of ["#ff5e57", "#f6ca55", "#55df88"].entries()) {
      const lamp = mesh(
        new THREE.SphereGeometry(0.15, 12, 10),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }),
      );
      lamp.position.set(x + lampX, 3.68 - index * 0.32, z + lampZ);
      this.buildGridGroup.add(lamp);
    }
  }

  private addAutomaticStopLines(cells: readonly GridCellDesign[]): void {
    const cellMap = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
    const tileSize = BUILD_CELL_SIZE - 0.18;
    const approaches = [
      { row: -1, column: 0, edgeX: 0, edgeZ: 1 },
      { row: 1, column: 0, edgeX: 0, edgeZ: -1 },
      { row: 0, column: -1, edgeX: 1, edgeZ: 0 },
      { row: 0, column: 1, edgeX: -1, edgeZ: 0 },
    ] as const;

    for (const intersection of cells) {
      if (intersection.element !== "asphalt") continue;
      for (const approach of approaches) {
        const row = intersection.row + approach.row;
        const column = intersection.column + approach.column;
        const road = cellMap.get(`${row}:${column}`);
        if (!road || (road.element !== "lane" && road.element !== "white-lane")) continue;
        const { x, z } = this.getBuildCellPosition(row, column);
        const lineRunsEastWest = approach.row !== 0;
        this.addBox(
          x + approach.edgeX * (tileSize / 2 - 0.32),
          0.65,
          z + approach.edgeZ * (tileSize / 2 - 0.32),
          lineRunsEastWest ? tileSize - 0.45 : 0.18,
          0.045,
          lineRunsEastWest ? 0.18 : tileSize - 0.45,
          "#ffffff",
          false,
          this.buildGridGroup,
        );
      }
    }
  }

  private getBuildCellPosition(row: number, column: number): { x: number; z: number } {
    const offset = (BUILD_GRID_SIZE - 1) / 2;
    return {
      x: (column - offset) * BUILD_CELL_SIZE,
      z: (row - offset) * BUILD_CELL_SIZE,
    };
  }

  private clearBuildGrid(): void {
    for (const child of [...this.buildGridGroup.children]) {
      this.buildGridGroup.remove(child);
      disposeObject(child);
    }
  }

  private addBox(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string,
    shadows = true,
    parent: THREE.Object3D = this.scene,
  ): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    const object = mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
    object.position.set(x, y, z);
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    parent.add(object);
    return object;
  }
}

const EMPTY_SCENE_VISUAL_METRICS: SceneVisualMetrics = {
  districts: new Map(),
  buildings: new Map(),
};

interface AgentDestinationMetrics {
  vehiclePressure: number;
  pedestrianWaitTotal: number;
  pedestrianCount: number;
  freight: number;
}

function createSceneVisualMetrics(state: Readonly<SimulationState>): SceneVisualMetrics {
  const buildingDistrictIds = new Map<string, string>();
  const districtsById = new Map(state.city.districts.map((district) => [district.id, district]));
  for (const building of state.buildings) {
    const district = districtForBuilding(building, state.city.districts);
    if (district !== undefined) buildingDistrictIds.set(building.id, district.id);
  }

  const buildingDestinations = new Map<string, AgentDestinationMetrics>();
  const districtDestinations = new Map<string, AgentDestinationMetrics>();
  for (const vehicle of state.vehicles) {
    if (vehicle.completed || vehicle.destinationBuildingId === undefined) continue;
    const destination = destinationMetrics(buildingDestinations, vehicle.destinationBuildingId);
    const vehiclePressure = 1
      + Math.min(vehicle.waitingSeconds / 60, 2)
      + Math.max(0, 1 - vehicle.currentSpeedMph / 30);
    destination.vehiclePressure += vehiclePressure;
    if (vehicle.vehicleType === "truck") destination.freight += 1 + vehicle.cargoUnits / 20;
    const districtId = buildingDistrictIds.get(vehicle.destinationBuildingId);
    if (districtId !== undefined) {
      const districtDestination = destinationMetrics(districtDestinations, districtId);
      districtDestination.vehiclePressure += vehiclePressure;
      if (vehicle.vehicleType === "truck") districtDestination.freight += 1 + vehicle.cargoUnits / 20;
    }
  }
  for (const pedestrian of state.pedestrians) {
    if (pedestrian.completed || pedestrian.destinationBuildingId === undefined) continue;
    const destination = destinationMetrics(buildingDestinations, pedestrian.destinationBuildingId);
    destination.pedestrianWaitTotal += pedestrian.waitSeconds;
    destination.pedestrianCount += 1;
    const districtId = buildingDistrictIds.get(pedestrian.destinationBuildingId);
    if (districtId !== undefined) {
      const districtDestination = destinationMetrics(districtDestinations, districtId);
      districtDestination.pedestrianWaitTotal += pedestrian.waitSeconds;
      districtDestination.pedestrianCount += 1;
    }
  }

  const buildingLandValues = state.buildings.map((building) => building.landValue);
  const districtLandValues = state.city.districts.map((district) => district.landValue);
  const maxBuildingJobs = Math.max(0, ...state.buildings.map((building) => building.jobCapacity));
  const maxDistrictJobs = Math.max(0, ...state.city.districts.map((district) => district.jobs));
  const maxBuildingPressure = Math.max(0, ...state.buildings.map((building) =>
    buildingDestinations.get(building.id)?.vehiclePressure ?? 0
  ));
  const maxDistrictPressure = Math.max(0, ...state.city.districts.map((district) =>
    districtDestinations.get(district.id)?.vehiclePressure ?? 0
  ));
  const maxMigration = Math.max(0, ...state.city.districts.map((district) => Math.abs(district.annualizedMigration)));
  const buildingFreight = new Map(state.buildings.map((building) => [
    building.id,
    (buildingDestinations.get(building.id)?.freight ?? 0)
      + (building.accounting?.goodsReceived ?? 0) / 50
      + (building.accounting?.importedSupplies ?? 0) / 50,
  ]));
  const maxBuildingFreight = Math.max(0, ...buildingFreight.values());
  const districtFreight = new Map(state.city.districts.map((district) => [
    district.id,
    district.freightTripsDaily + (districtDestinations.get(district.id)?.freight ?? 0),
  ]));
  const maxDistrictFreight = Math.max(0, ...districtFreight.values());

  const buildingMetrics = new Map<string, VisualLayerMetrics>();
  for (const building of state.buildings) {
    const destination = buildingDestinations.get(building.id);
    const district = districtsById.get(buildingDistrictIds.get(building.id) ?? "");
    const requiredGoods = Math.max(building.customerDemand, building.productionRate);
    const operatingBase = Math.max(
      1,
      building.accounting?.revenue ?? 0,
      building.accounting?.operatingCost ?? 0,
      Math.abs(building.accounting?.profit ?? 0),
    );
    buildingMetrics.set(building.id, {
      congestion: normalizeToMaximum(destination?.vehiclePressure ?? 0, maxBuildingPressure),
      pedestrianWait: clamp01(
        (destination?.pedestrianWaitTotal ?? 0) / Math.max(1, destination?.pedestrianCount ?? 0) / 120,
      ),
      landValue: normalizeRange(building.landValue, buildingLandValues),
      utilities: clamp01(average(Object.values(building.utilityService))),
      jobs: normalizeToMaximum(building.jobCapacity, maxBuildingJobs),
      shortages: requiredGoods <= 0
        ? 0
        : clamp01((requiredGoods - building.goodsInventory) / requiredGoods),
      migration: normalizeSigned(district?.annualizedMigration ?? 0, maxMigration),
      freight: normalizeToMaximum(buildingFreight.get(building.id) ?? 0, maxBuildingFreight),
      profit: normalizeSigned(building.accounting?.profit ?? 0, operatingBase),
    });
  }

  const districtMetrics = new Map<string, VisualLayerMetrics>();
  for (const district of state.city.districts) {
    const destination = districtDestinations.get(district.id);
    const goodsDemand = sumRecord(district.goodsDemandByType);
    const goodsAvailable = sumRecord(district.goodsInventory);
    const businessBase = Math.max(
      1,
      district.businessRevenueDaily,
      district.businessCostsDaily,
      Math.abs(district.businessProfitDaily),
    );
    const activeCongestion = normalizeToMaximum(destination?.vehiclePressure ?? 0, maxDistrictPressure);
    districtMetrics.set(district.id, {
      congestion: clamp01(district.congestionPercent / 100 * 0.8 + activeCongestion * 0.2),
      pedestrianWait: clamp01(
        (destination?.pedestrianWaitTotal ?? 0) / Math.max(1, destination?.pedestrianCount ?? 0) / 120,
      ),
      landValue: normalizeRange(district.landValue, districtLandValues),
      utilities: clamp01(average(Object.values(district.utilityCoverage))),
      jobs: normalizeToMaximum(district.jobs, maxDistrictJobs),
      shortages: goodsDemand <= 0 ? 0 : clamp01((goodsDemand - goodsAvailable) / goodsDemand),
      migration: normalizeSigned(district.annualizedMigration, maxMigration),
      freight: normalizeToMaximum(districtFreight.get(district.id) ?? 0, maxDistrictFreight),
      profit: normalizeSigned(district.businessProfitDaily, businessBase),
    });
  }

  return { districts: districtMetrics, buildings: buildingMetrics };
}

function destinationMetrics(
  destinations: Map<string, AgentDestinationMetrics>,
  id: string,
): AgentDestinationMetrics {
  const existing = destinations.get(id);
  if (existing !== undefined) return existing;
  const created = { vehiclePressure: 0, pedestrianWaitTotal: 0, pedestrianCount: 0, freight: 0 };
  destinations.set(id, created);
  return created;
}

function districtForBuilding(
  building: Building,
  districts: readonly CityDistrictState[],
): CityDistrictState | undefined {
  const containingDistrict = districts.find((district) =>
    Math.abs(building.x - district.x) <= district.width / 2
    && Math.abs(building.z - district.z) <= district.depth / 2
  );
  if (containingDistrict !== undefined) return containingDistrict;
  let nearest: CityDistrictState | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const district of districts) {
    const distance = Math.hypot(building.x - district.x, building.z - district.z);
    if (
      distance < nearestDistance
      || (distance === nearestDistance && district.id.localeCompare(nearest?.id ?? "") < 0)
    ) {
      nearest = district;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function setGroupDimmed(group: THREE.Group, dimmed: boolean): void {
  if (group.userData.dimmed === dimmed) return;
  group.userData.dimmed = dimmed;
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  for (const material of materials) {
    if (material.transparent && material.opacity === 0) continue;
    const transparent = dimmed;
    material.opacity = dimmed ? 0.2 : 1;
    material.depthWrite = !dimmed;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
  }
}

function selectionFromObject(object: THREE.Object3D | undefined): SceneSelection {
  let current = object;
  while (current !== undefined) {
    const selection = current.userData.selection as SceneSelection | undefined;
    if (selection !== undefined) return selection;
    current = current.parent ?? undefined;
  }
  return null;
}

function pedestrianLaneOffset(segmentId: string): number {
  return segmentId.endsWith("-back") ? -0.46 : 0.46;
}

function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  materials.forEach((material) => material.dispose());
}

function mesh<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
  geometry: TGeometry,
  material: TMaterial,
): THREE.Mesh<TGeometry, TMaterial> {
  return new THREE.Mesh(geometry, material);
}

function paletteIndex(id: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function sumRecord(values: Readonly<Record<string, number>>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function normalizeRange(value: number, values: readonly number[]): number {
  if (values.length === 0) return 0.5;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return maximum === minimum ? 0.5 : clamp01((value - minimum) / (maximum - minimum));
}

function normalizeToMaximum(value: number, maximum: number): number {
  return maximum <= 0 ? 0 : clamp01(value / maximum);
}

function normalizeSigned(value: number, maximumMagnitude: number): number {
  return maximumMagnitude <= 0 ? 0.5 : clamp01(0.5 + value / maximumMagnitude / 2);
}

function colorRamp(value: number, low: number, middle: number, high: number): number {
  return value <= 0.5
    ? interpolateColor(low, middle, value * 2)
    : interpolateColor(middle, high, (value - 0.5) * 2);
}

function interpolateColor(from: number, to: number, amount: number): number {
  const fromRed = (from >> 16) & 0xff;
  const fromGreen = (from >> 8) & 0xff;
  const fromBlue = from & 0xff;
  const toRed = (to >> 16) & 0xff;
  const toGreen = (to >> 8) & 0xff;
  const toBlue = to & 0xff;
  const red = Math.round(fromRed + (toRed - fromRed) * amount);
  const green = Math.round(fromGreen + (toGreen - fromGreen) * amount);
  const blue = Math.round(fromBlue + (toBlue - fromBlue) * amount);
  return (red << 16) | (green << 8) | blue;
}
