import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  Building,
  Pedestrian,
  RoutePoint,
  SimulationState,
  TransitStop,
  Vehicle,
  ZoneParcel,
  ZoneType,
} from "../models/types";

const ROAD_WIDTH = 8;
const FLOOR_HEIGHT = 1.05;
const WORLD_SCALE = 0.38;
const VEHICLE_COLORS = ["#ef5a45", "#2f75c9", "#e2ad3c", "#2f956f", "#865fb0"];
const ZONE_COLORS: Record<ZoneType, string> = {
  residential: "#69a8a0",
  commercial: "#d8a755",
  industrial: "#b66c52",
  civic: "#688fc3",
  park: "#5d9b67",
};

interface SignalLampMaterials {
  red: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
}

interface BuildingVisual {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  lastFloors: number;
}

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight("#fff3d7", 4.2);
  private readonly skyLight = new THREE.HemisphereLight("#e8f6ff", "#486247", 2.3);
  private readonly vehicles = new Map<string, THREE.Group>();
  private readonly pedestrians = new Map<string, THREE.Group>();
  private readonly buildings = new Map<string, BuildingVisual>();
  private readonly parcelMeshes = new Map<string, THREE.Mesh>();
  private readonly transitStopGroups = new Map<string, THREE.Group>();
  private readonly vehicleSignals: SignalLampMaterials[] = [];
  private readonly pedestrianSignals: SignalLampMaterials[] = [];
  private readonly trafficOverlayMaterial = new THREE.MeshStandardMaterial({
    color: "#4fa57b",
    emissive: "#1d503a",
    transparent: true,
    opacity: 0.24,
  });

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
    this.syncParcels(state.landUse.parcels);
    this.syncBuildings(state.buildings, state.timeOfDayMinutes);
    this.syncTransitStops(state.infrastructure.transitStops, state.network.nodes);
    this.syncVehicles(state.vehicles);
    this.syncPedestrians(state.pedestrians);
    this.updateSignals(state.signalPhase === "vehicles");
    this.updateTrafficOverlay(state.metrics.congestionPercent);
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

    this.addBox(0, 0.04, 0, 84, 0.08, ROAD_WIDTH, "#29343a");
    this.addBox(0, 0.05, 0, ROAD_WIDTH, 0.1, 84, "#29343a");
    this.addSidewalk(-13, -13, 16, 16);
    this.addSidewalk(13, -13, 16, 16);
    this.addSidewalk(-13, 13, 16, 16);
    this.addSidewalk(13, 13, 16, 16);
    this.addRoadMarkings();
    this.addCrosswalks();
    this.addSignals();

    const horizontalFlow = mesh(new THREE.PlaneGeometry(72, 2.8), this.trafficOverlayMaterial);
    horizontalFlow.rotation.x = -Math.PI / 2;
    horizontalFlow.position.y = 0.13;
    this.scene.add(horizontalFlow);
  }

  private addSidewalk(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, 0.18, z, width, 0.36, depth, "#c7c8be");
  }

  private addRoadMarkings(): void {
    for (let offset = -40; offset <= 40; offset += 4) {
      if (Math.abs(offset) < 5) continue;
      this.addBox(offset, 0.12, 0, 2, 0.03, 0.12, "#f6ca55", false);
      this.addBox(0, 0.12, offset, 0.12, 0.03, 2, "#f6ca55", false);
    }
  }

  private addCrosswalks(): void {
    for (let index = -4; index <= 4; index += 1) {
      this.addBox(index * 0.78, 0.13, -5.2, 0.44, 0.025, 1.8, "#f2efe6", false);
      this.addBox(index * 0.78, 0.13, 5.2, 0.44, 0.025, 1.8, "#f2efe6", false);
      this.addBox(-5.2, 0.13, index * 0.78, 1.8, 0.025, 0.44, "#f2efe6", false);
      this.addBox(5.2, 0.13, index * 0.78, 1.8, 0.025, 0.44, "#f2efe6", false);
    }
  }

  private addSignals(): void {
    for (const [x, z] of [[-5.2, -5.2], [5.2, 5.2]] as const) {
      const pole = mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 3.4, 12),
        new THREE.MeshStandardMaterial({ color: "#263238", metalness: 0.35 }),
      );
      pole.position.set(x, 1.9, z);
      pole.castShadow = true;
      this.scene.add(pole);
      this.addSignalLight(x, 3.35, z, this.vehicleSignals);
      this.addSignalLight(x + (x < 0 ? 0.5 : -0.5), 2.45, z, this.pedestrianSignals, 0.2);
    }
  }

  private addSignalLight(
    x: number,
    y: number,
    z: number,
    target: SignalLampMaterials[],
    radius = 0.28,
  ): void {
    this.addBox(x, y, z, 0.72, 1.05, 0.5, "#162126");
    const red = new THREE.MeshStandardMaterial({
      color: "#601f1f",
      emissive: "#ff413b",
      emissiveIntensity: 1.8,
    });
    const green = new THREE.MeshStandardMaterial({
      color: "#1d5635",
      emissive: "#39df78",
      emissiveIntensity: 0.08,
    });
    const geometry = new THREE.SphereGeometry(radius, 18, 14);
    const lampZ = z + (z < 0 ? 0.28 : -0.28);
    const redLamp = mesh(geometry, red);
    redLamp.position.set(x, y + 0.24, lampZ);
    const greenLamp = mesh(geometry, green);
    greenLamp.position.set(x, y - 0.24, lampZ);
    this.scene.add(redLamp, greenLamp);
    target.push({ red, green });
  }

  private syncParcels(parcels: readonly ZoneParcel[]): void {
    for (const parcel of parcels) {
      if (this.parcelMeshes.has(parcel.id)) continue;
      const material = new THREE.MeshStandardMaterial({
        color: ZONE_COLORS[parcel.zone],
        transparent: true,
        opacity: parcel.zone === "park" ? 0.58 : 0.2,
        roughness: 0.9,
      });
      const parcelMesh = mesh(
        new THREE.BoxGeometry(parcel.width * WORLD_SCALE, 0.05, parcel.depth * WORLD_SCALE),
        material,
      );
      parcelMesh.position.set(parcel.x * WORLD_SCALE, 0.4, parcel.z * WORLD_SCALE);
      parcelMesh.receiveShadow = true;
      this.scene.add(parcelMesh);
      this.parcelMeshes.set(parcel.id, parcelMesh);
    }
  }

  private syncBuildings(buildingStates: readonly Building[], timeMinutes: number): void {
    const activeIds = new Set<string>();
    for (const building of buildingStates) {
      activeIds.add(building.id);
      let visual = this.buildings.get(building.id);
      if (!visual) {
        visual = this.addBuilding(building);
        this.buildings.set(building.id, visual);
      }
      this.updateBuildingVisual(visual, building, timeMinutes);
    }

    for (const [id, visual] of this.buildings) {
      if (activeIds.has(id)) continue;
      this.scene.remove(visual.group);
      this.buildings.delete(id);
    }
  }

  private addBuilding(building: Building): BuildingVisual {
    const group = new THREE.Group();
    group.position.set(building.x * WORLD_SCALE, 0.42, building.z * WORLD_SCALE);
    const footprint = building.zone === "industrial" ? [6.2, 5.2] : [4.8, 4.8];
    const material = new THREE.MeshStandardMaterial({
      color: ZONE_COLORS[building.zone],
      roughness: building.zone === "commercial" ? 0.38 : 0.72,
      metalness: building.zone === "commercial" ? 0.12 : 0.02,
    });
    const body = mesh(new THREE.BoxGeometry(footprint[0], 1, footprint[1]), material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    if (building.zone === "park") {
      body.visible = false;
      for (const [x, z] of [[-1.4, -1.2], [1.1, 0.8], [-0.4, 1.5]] as const) {
        const trunk = mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 1.5, 8),
          new THREE.MeshStandardMaterial({ color: "#74513b" }),
        );
        trunk.position.set(x, 0.75, z);
        const crown = mesh(
          new THREE.IcosahedronGeometry(0.85, 1),
          new THREE.MeshStandardMaterial({ color: "#3e8253" }),
        );
        crown.position.set(x, 1.9, z);
        crown.castShadow = true;
        group.add(trunk, crown);
      }
    } else {
      const roof = mesh(
        new THREE.BoxGeometry(footprint[0] * 0.82, 0.35, footprint[1] * 0.82),
        new THREE.MeshStandardMaterial({ color: "#46555a", roughness: 0.8 }),
      );
      roof.position.y = 0.2;
      roof.name = "roof";
      roof.castShadow = true;
      group.add(roof);
    }

    this.scene.add(group);
    return { group, body, lastFloors: -1 };
  }

  private updateBuildingVisual(
    visual: BuildingVisual,
    building: Building,
    timeMinutes: number,
  ): void {
    const floors = Math.max(1, building.floors);
    if (visual.lastFloors !== floors && building.zone !== "park") {
      const height = floors * FLOOR_HEIGHT;
      visual.body.scale.y = height;
      visual.body.position.y = height / 2;
      const roof = visual.group.getObjectByName("roof");
      if (roof) roof.position.y = height + 0.18;
      visual.lastFloors = floors;
    }

    const service = (
      building.utilityService.power +
      building.utilityService.water +
      building.utilityService.waste
    ) / 3;
    const baseColor = new THREE.Color(ZONE_COLORS[building.zone]);
    const shortageColor = new THREE.Color("#7b3734");
    visual.body.material.color.copy(baseColor).lerp(shortageColor, 1 - service);
    const night = timeMinutes < 360 || timeMinutes > 1140;
    visual.body.material.emissive.set(night && service > 0.7 ? "#4b3f20" : "#000000");
    visual.body.material.emissiveIntensity = night ? 0.55 * service : 0;
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

  private updateSignals(vehiclesGo: boolean): void {
    for (const lamps of this.vehicleSignals) this.setSignalLamps(lamps, vehiclesGo);
    for (const lamps of this.pedestrianSignals) this.setSignalLamps(lamps, !vehiclesGo);
  }

  private setSignalLamps(lamps: SignalLampMaterials, canGo: boolean): void {
    lamps.red.emissiveIntensity = canGo ? 0.08 : 1.8;
    lamps.green.emissiveIntensity = canGo ? 1.8 : 0.08;
  }

  private updateTrafficOverlay(congestionPercent: number): void {
    const congestion = THREE.MathUtils.clamp(congestionPercent / 100, 0, 1);
    this.trafficOverlayMaterial.color.set("#4fa57b").lerp(new THREE.Color("#e15b4f"), congestion);
    this.trafficOverlayMaterial.emissive.set("#1d503a").lerp(new THREE.Color("#7d2420"), congestion);
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
