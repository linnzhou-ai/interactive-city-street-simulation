import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CityDistrictState, CityLinkDefinition } from "../models/cityTypes";
import type {
  Pedestrian,
  RoutePoint,
  SimulationState,
  TransitStop,
  Vehicle,
  ZoneType,
} from "../models/types";

const WORLD_SCALE = 0.38;
const VEHICLE_COLORS = ["#ef5a45", "#2f75c9", "#e2ad3c", "#2f956f", "#865fb0"];
const ZONE_COLORS: Record<ZoneType, string> = {
  residential: "#69a8a0",
  commercial: "#d8a755",
  industrial: "#b66c52",
  civic: "#688fc3",
  park: "#5d9b67",
};

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight("#fff3d7", 4.2);
  private readonly skyLight = new THREE.HemisphereLight("#e8f6ff", "#486247", 2.3);
  private readonly vehicles = new Map<string, THREE.Group>();
  private readonly pedestrians = new Map<string, THREE.Group>();
  private readonly districtMeshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  private readonly cityLinkMeshes = new Map<string, THREE.Mesh>();
  private readonly transitStopGroups = new Map<string, THREE.Group>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color("#b9d4df");
    this.scene.fog = new THREE.Fog("#b9d4df", 48, 105);
    this.camera.position.set(25, 27, 30);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI / 2.08;

    this.buildLighting();
    this.buildStreet();
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
    this.syncTransitStops(state.infrastructure.transitStops, state.network.nodes);
    this.syncVehicles(state.vehicles);
    this.syncPedestrians(state.pedestrians);
    this.updateDaylight(state.timeOfDayMinutes);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private buildLighting(): void {
    this.scene.add(this.skyLight);
    this.sun.position.set(16, 28, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -32;
    this.sun.shadow.camera.right = 32;
    this.sun.shadow.camera.top = 32;
    this.sun.shadow.camera.bottom = -32;
    this.scene.add(this.sun);
  }

  private buildStreet(): void {
    const ground = mesh(
      new THREE.PlaneGeometry(84, 84),
      new THREE.MeshStandardMaterial({ color: "#799c73", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    for (const x of [-18.25, 0, 18.25]) this.addBox(x, 0.08, 0, 2.2, 0.12, 78, "#30383a");
    for (const z of [-9.1, 9.1]) this.addBox(0, 0.08, z, 78, 0.12, 2.2, "#30383a");
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
        new THREE.BoxGeometry(length, 0.08, 0.42),
        new THREE.MeshStandardMaterial({ color: "#6f8785", roughness: 0.9 }),
      );
      linkMesh.position.set((startX + endX) / 2, 0.24, (startZ + endZ) / 2);
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
          new THREE.BoxGeometry(district.width * WORLD_SCALE * 0.82, 1, district.depth * WORLD_SCALE * 0.82),
          new THREE.MeshStandardMaterial({ color: ZONE_COLORS[district.primaryZone], roughness: 0.82 }),
        );
        districtMesh.castShadow = true;
        districtMesh.receiveShadow = true;
        this.scene.add(districtMesh);
        this.districtMeshes.set(district.id, districtMesh);
      }
      const development = THREE.MathUtils.clamp(district.developedFloorArea / Math.max(1, district.maxFloorArea), 0, 1.2);
      const height = 0.32 + development * 1.65;
      districtMesh.scale.y = height;
      districtMesh.position.set(district.x * WORLD_SCALE, 0.22 + height / 2, district.z * WORLD_SCALE);
      const service = (
        district.utilityCoverage.power +
        district.utilityCoverage.water +
        district.utilityCoverage.waste
      ) / 3;
      districtMesh.material.color
        .set(ZONE_COLORS[district.primaryZone])
        .lerp(new THREE.Color("#b64f45"), (1 - service) * 0.65 + district.congestionPercent / 450);
    }
    for (const [id, districtMesh] of this.districtMeshes) {
      if (activeIds.has(id)) continue;
      this.scene.remove(districtMesh);
      this.districtMeshes.delete(id);
    }
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
      this.placeOnRoute(group, state.route, state.progress, 0.12);
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
      this.placeOnRoute(group, state.route, state.progress, 0.13);
    }
    this.removeMissing(this.pedestrians, activeIds);
  }

  private addPedestrian(state: Pedestrian): THREE.Group {
    const group = new THREE.Group();
    const clothingColors = ["#156f73", "#9b4f59", "#6d5b9a", "#49734f"];
    const body = mesh(
      new THREE.CapsuleGeometry(0.2, state.ageGroup === "child" ? 0.42 : 0.62, 4, 8),
      new THREE.MeshStandardMaterial({ color: clothingColors[paletteIndex(state.id, 4)] }),
    );
    body.position.y = state.ageGroup === "child" ? 0.85 : 1.05;
    body.castShadow = true;
    const head = mesh(
      new THREE.SphereGeometry(0.2, 14, 10),
      new THREE.MeshStandardMaterial({ color: "#d7a27c" }),
    );
    head.position.y = state.ageGroup === "child" ? 1.38 : 1.72;
    head.castShadow = true;
    group.add(body, head);
    this.scene.add(group);
    this.pedestrians.set(state.id, group);
    return group;
  }

  private placeOnRoute(group: THREE.Group, route: readonly RoutePoint[], progress: number, y: number): void {
    if (route.length === 0) return;
    if (route.length === 1) {
      group.position.set(route[0].x * WORLD_SCALE, y, route[0].z * WORLD_SCALE);
      return;
    }
    const scaled = Math.min(1, Math.max(0, progress)) * (route.length - 1);
    const index = Math.min(route.length - 2, Math.floor(scaled));
    const localProgress = scaled - index;
    const start = route[index];
    const end = route[index + 1];
    group.position.set(
      THREE.MathUtils.lerp(start.x, end.x, localProgress) * WORLD_SCALE,
      y,
      THREE.MathUtils.lerp(start.z, end.z, localProgress) * WORLD_SCALE,
    );
    group.rotation.y = Math.atan2(-(end.z - start.z), end.x - start.x);
  }

  private removeMissing(objects: Map<string, THREE.Group>, activeIds: Set<string>): void {
    for (const [id, group] of objects) {
      if (activeIds.has(id)) continue;
      this.scene.remove(group);
      objects.delete(id);
    }
  }

  private updateDaylight(timeMinutes: number): void {
    const angle = ((timeMinutes - 360) / 1440) * Math.PI * 2;
    const daylight = THREE.MathUtils.clamp(Math.sin(angle) * 0.7 + 0.35, 0.08, 1);
    this.sun.intensity = 0.4 + daylight * 4;
    this.skyLight.intensity = 0.35 + daylight * 2;
    this.sun.position.set(Math.cos(angle) * 28, 8 + daylight * 25, Math.sin(angle) * 22);
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
