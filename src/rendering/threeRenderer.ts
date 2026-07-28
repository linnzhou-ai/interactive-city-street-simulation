import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CityDistrictState, CityLinkDefinition } from "../models/cityTypes";
import type {
  AgentPosition,
  Building,
  Pedestrian,
  SimulationState,
  TransitStop,
  Vehicle,
  ZoneType,
} from "../models/types";

const WORLD_SCALE = 0.62;
const VEHICLE_COLORS = ["#ef5a45", "#2f75c9", "#e2ad3c", "#2f956f", "#865fb0"];
const CONNECTION_COLORS = { commute: "#49a7e8", customer: "#e0a83d", supply: "#db735d" };
const ZONE_COLORS: Record<ZoneType, string> = {
  residential: "#69a8a0",
  commercial: "#d8a755",
  industrial: "#b66c52",
  civic: "#688fc3",
  park: "#5d9b67",
};

export type SceneSelection =
  | { kind: "building"; id: string }
  | { kind: "person"; id: string }
  | null;

export function isVisibleVehicleSegment(segmentId: string): boolean {
  return segmentId.startsWith("road-") || segmentId.startsWith("movement-");
}

export function isVisiblePedestrianSegment(segmentId: string): boolean {
  return segmentId.startsWith("sidewalk-") || segmentId.startsWith("crosswalk-");
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
  private selection: SceneSelection = null;
  private pointerStart: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelection: (selection: SceneSelection) => void = () => undefined,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
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
    this.buildStreet();
    this.scene.add(this.connectionLines);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
  }

  setSelection(selection: SceneSelection): void {
    this.selection = selection;
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.camera.aspect = bounds.width / Math.max(bounds.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  render(state: Readonly<SimulationState>): void {
    this.syncCityLinks(state.city.links, state.city.districts);
    this.syncCityDistricts(state.city.districts);
    this.syncBuildings(state.buildings);
    this.syncTransitStops(state.infrastructure.transitStops, state.network.nodes);
    this.syncVehicles(state.vehicles);
    this.syncPedestrians(state.pedestrians);
    this.syncSelection(state);
    this.updateDaylight(state.timeOfDayMinutes);

    this.controls.update();
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
    const pickable = [...this.buildings.values(), ...this.pedestrians.values()];
    const hit = this.raycaster.intersectObjects(pickable, true)[0];
    const selection = selectionFromObject(hit?.object);
    this.selection = selection;
    this.onSelection(selection);
  };

  private buildLighting(): void {
    this.scene.add(this.skyLight);
    this.sun.position.set(32, 55, 26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -105;
    this.sun.shadow.camera.right = 105;
    this.sun.shadow.camera.top = 105;
    this.sun.shadow.camera.bottom = -105;
    this.scene.add(this.sun);
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
    this.addBox(0, 0.13, 0, roadLength, 0.16, roadWidth, "#30383a");
    this.addBox(0, 0.14, 0, roadWidth, 0.18, 154, "#30383a");

    const sidewalkOffset = 5.9;
    for (const offset of [-sidewalkOffset, sidewalkOffset]) {
      this.addBox(0, 0.2, offset, roadLength, 0.2, 1.15, "#b6bab5");
      this.addBox(offset, 0.21, 0, 1.15, 0.22, 154, "#b6bab5");
    }

    for (let position = -82; position <= 82; position += 6) {
      if (Math.abs(position) < 7) continue;
      this.addBox(position, 0.24, 0, 2.7, 0.03, 0.12, "#e7d86b", false);
    }
    for (let position = -70; position <= 70; position += 6) {
      if (Math.abs(position) < 7) continue;
      this.addBox(0, 0.25, position, 0.12, 0.03, 2.7, "#e7d86b", false);
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
      );
    }
  }

  private syncCityLinks(
    links: readonly CityLinkDefinition[],
    districts: readonly CityDistrictState[],
  ): void {
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
      this.scene.add(linkMesh);
      this.cityLinkMeshes.set(link.id, linkMesh);
    }
  }

  private syncCityDistricts(districts: readonly CityDistrictState[]): void {
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
      const service = (
        district.utilityCoverage.power +
        district.utilityCoverage.water +
        district.utilityCoverage.waste
      ) / 3;
      districtMesh.material.color
        .set(ZONE_COLORS[district.primaryZone])
        .lerp(new THREE.Color("#b64f45"), (1 - service) * 0.65 + district.congestionPercent / 450);
    }
    this.removeMissingMeshes(this.districtMeshes, activeIds);
  }

  private syncBuildings(states: readonly Building[]): void {
    const activeIds = new Set<string>();
    for (const state of states) {
      activeIds.add(state.id);
      const group = this.buildings.get(state.id) ?? this.addBuilding(state);
      group.position.set(state.x * WORLD_SCALE, 0.18, state.z * WORLD_SCALE);
      const body = group.getObjectByName("building-body") as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      const roof = group.getObjectByName("building-roof") as THREE.Mesh;
      const height = 1.25 + state.floors * 0.72;
      body.scale.y = height;
      body.position.y = height / 2;
      roof.position.y = height + 0.13;
      body.material.color.set(ZONE_COLORS[state.zone]);
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
      this.scene.add(group);
      this.transitStopGroups.set(stop.id, group);
    }
  }

  private syncVehicles(vehicleStates: readonly Vehicle[]): void {
    const activeIds = new Set<string>();
    for (const state of vehicleStates) {
      if (state.completed) continue;
      activeIds.add(state.id);
      const group = this.vehicles.get(state.id) ?? this.addVehicle(state);
      group.visible = isVisibleVehicleSegment(state.position.segmentId);
      if (group.visible) {
        this.placeAgent(group, state.position, 0.2);
      }
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
    body.castShadow = true;
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
      if (state.completed) continue;
      activeIds.add(state.id);
      const group = this.pedestrians.get(state.id) ?? this.addPedestrian(state);
      group.visible = isVisiblePedestrianSegment(state.position.segmentId);
      group.userData.selection = state.personId === undefined
        ? undefined
        : { kind: "person", id: state.personId } satisfies Exclude<SceneSelection, null>;
      if (group.visible) {
        this.placeAgent(group, state.position, 0.22, pedestrianLaneOffset(state.position.segmentId));
      }
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
    body.castShadow = true;
    const head = mesh(
      new THREE.SphereGeometry(0.24, 14, 10),
      new THREE.MeshStandardMaterial({ color: "#d7a27c" }),
    );
    head.position.y = state.ageGroup === "child" ? 1.38 : 1.72;
    head.castShadow = true;
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
    for (const [id, group] of this.buildings) {
      const body = group.getObjectByName("building-body") as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
      const selected = this.selection?.kind === "building" && this.selection.id === id;
      body.material.emissive.set(selected ? "#f6c85f" : "#000000");
      body.material.emissiveIntensity = selected ? 0.65 : 0;
    }
    for (const group of this.pedestrians.values()) {
      const body = group.getObjectByName("person-body") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const selected = this.selection?.kind === "person" && this.selection.id === group.userData.selection?.id;
      body.material.emissive.set(selected ? "#fff4a3" : "#000000");
      body.material.emissiveIntensity = selected ? 1 : 0;
      group.scale.setScalar(selected ? 1.75 : 1.35);
    }

    this.clearConnectionLines();
    if (this.selection?.kind === "building") {
      for (const connection of state.buildingConnections) {
        if (
          connection.fromBuildingId !== this.selection.id &&
          connection.toBuildingId !== this.selection.id
        ) continue;
        const from = this.pointForBuilding(connection.fromBuildingId, state);
        const to = this.pointForBuilding(connection.toBuildingId, state);
        if (from !== undefined && to !== undefined) {
          this.addConnectionLine(from, to, CONNECTION_COLORS[connection.kind]);
        }
      }
    }
    if (this.selection?.kind === "person") {
      const person = state.people.find((candidate) => candidate.id === this.selection?.id);
      if (person === undefined) return;
      const itinerary = person.schedule
        .map((activity) => this.pointForBuilding(activity.buildingId, state))
        .filter((point): point is THREE.Vector3 => point !== undefined)
        .filter((point, index, points) => index === 0 || !point.equals(points[index - 1]!));
      for (let index = 1; index < itinerary.length; index += 1) {
        this.addConnectionLine(itinerary[index - 1]!, itinerary[index]!, "#f0dd70");
      }
    }
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
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(30));
    const material = new THREE.LineDashedMaterial({ color, dashSize: 0.75, gapSize: 0.48 });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.connectionLines.add(line);
  }

  private clearConnectionLines(): void {
    for (const child of [...this.connectionLines.children]) {
      this.connectionLines.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
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
    for (const [id, group] of objects) {
      if (activeIds.has(id)) continue;
      this.scene.remove(group);
      objects.delete(id);
    }
  }

  private removeMissingMeshes(
    objects: Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>,
    activeIds: Set<string>,
  ): void {
    for (const [id, object] of objects) {
      if (activeIds.has(id)) continue;
      this.scene.remove(object);
      objects.delete(id);
    }
  }

  private updateDaylight(timeMinutes: number): void {
    const angle = ((timeMinutes - 360) / 1440) * Math.PI * 2;
    const daylight = THREE.MathUtils.clamp(Math.sin(angle) * 0.7 + 0.35, 0.08, 1);
    this.sun.intensity = 0.4 + daylight * 4;
    this.skyLight.intensity = 0.35 + daylight * 2;
    this.sun.position.set(Math.cos(angle) * 52, 15 + daylight * 48, Math.sin(angle) * 44);
    const nightSky = new THREE.Color("#192838");
    const daySky = new THREE.Color("#b9d4df");
    const sky = nightSky.clone().lerp(daySky, daylight);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.renderer.toneMappingExposure = 0.65 + daylight * 0.45;
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
  ): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    const object = mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
    object.position.set(x, y, z);
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    this.scene.add(object);
    return object;
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
