import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  resolveSubsteppedMovement,
} from "../core/collision";
import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_LANDMARKS,
  PENN_ROAD_GRAPH,
  PENN_STREETS,
} from "../data/pennRoadGraph";
import type {
  CameraMode,
  DistrictFeature,
  EnvironmentMode,
  FeatureDesign,
  GeoPoint,
  MapOverlayMode,
  PedestrianSnapshot,
  PlacedBuilding,
  SignalSnapshot,
  SimulationState,
  VehicleKind,
  VehicleSnapshot,
} from "../models/types";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const ROAD_WIDTH = 15;
const MAJOR_ROAD_WIDTH = 22;
const SIDEWALK_WIDTH = 6;
const WORLD_SIZE = 5_200;
const RENDER_HEIGHTS = {
  ground: -0.08,
  lawn: 0.02,
  lawnPatch: 0.055,
  blockCenter: 0.15,
  roadCenter: 0.04,
  roadSurface: 0.08,
  intersectionSurface: 0.105,
  sidewalkCenter: 0.15,
  sidewalkSurface: 0.29,
  roadMarking: 0.16,
  crosswalk: 0.2,
  selectionSurface: 0.22,
} as const;
const ROAD_HEIGHT = RENDER_HEIGHTS.roadSurface;
const FLY_COLLIDER_RADIUS = 0.45;
const WALK_COLLIDER_RADIUS = 0.38;
const WALK_PLAYER_HEIGHT = 1.78;
const WALK_EYE_HEIGHT = 1.68;
const WALK_GRAVITY = 18;
const MAX_COLLISION_STEP = 0.18;

interface SignalAssembly {
  intersectionId: string;
  axis: DistrictFeature["axis"];
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  walk: THREE.MeshStandardMaterial;
  dontWalk: THREE.MeshStandardMaterial;
}

interface CollisionVolume extends SpatialBounds {
  box: THREE.Box3;
}

interface WalkableSurface extends SpatialBounds {
  height: number;
}

interface SpatialBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type EnvironmentStatusHandler = (mode: EnvironmentMode, detail: string) => void;
interface BuildingInteractionHandlers {
  onPlace: (x: number, z: number) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.5, 7_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly collisionClosest = new THREE.Vector3();
  private readonly features = PENN_ROAD_GRAPH;
  private readonly featureMeshes = new Map<string, THREE.Mesh>();
  private readonly selectableRoads: THREE.Mesh[] = [];
  private readonly designGroup = new THREE.Group();
  private readonly analysisGroup = new THREE.Group();
  private readonly trafficGroup = new THREE.Group();
  private readonly pedestrianGroup = new THREE.Group();
  private readonly placedBuildingGroup = new THREE.Group();
  private readonly placedBuildingMeshes = new Map<string, THREE.Group>();
  private readonly placementPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly placementPoint = new THREE.Vector3();
  private readonly dragOffset = new THREE.Vector3();
  private readonly vehiclePool: THREE.Group[] = [];
  private readonly pedestrianPool: THREE.Group[] = [];
  private readonly signalAssemblies: SignalAssembly[] = [];
  private readonly flyKeys = new Set<string>();
  private readonly collisionIndex = new SpatialHash<CollisionVolume>(96);
  private readonly walkableIndex = new SpatialHash<WalkableSurface>(96);
  private readonly collisionDebugGroup = new THREE.Group();
  private readonly collisionDebugEnabled = new URLSearchParams(window.location.search).has(
    "collisionDebug",
  );
  private selectionHandler: ((feature: DistrictFeature) => void) | null = null;
  private buildingInteractionHandlers: BuildingInteractionHandlers | null = null;
  private selectedFeatureId: string | null = null;
  private selectedPlacedBuildingId: string | null = null;
  private buildingPlacementEnabled = false;
  private draggingBuildingId: string | null = null;
  private buildMode = true;
  private cameraMode: CameraMode = "orbit";
  private flySpeedScale = 1;
  private flyYaw = 0;
  private flyPitch = -0.55;
  private walkVerticalVelocity = 0;
  private grounded = false;
  private collisionDebugPlayer: THREE.Mesh | null = null;
  private collisionDebugRay: THREE.Line | null = null;
  private collisionDebugStatus: HTMLOutputElement | null = null;
  private looking = false;
  private lastPointer = new THREE.Vector2();
  private pointerDown = new THREE.Vector2();
  private lastFrameTimestamp = performance.now();

  private readonly materials = createWorldMaterials();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.background = new THREE.Color("#b8cfd0");
    this.scene.fog = new THREE.FogExp2("#b8cfd0", 0.00026);

    this.camera.position.set(720, 720, 920);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(-90, 0, 70);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 2_700;
    this.controls.maxPolarAngle = Math.PI / 2.04;

    this.scene.add(
      this.designGroup,
      this.analysisGroup,
      this.trafficGroup,
      this.pedestrianGroup,
      this.placedBuildingGroup,
    );
    this.buildLightingAndSky();
    this.buildGround();
    this.buildRoadsAndSidewalks();
    this.buildDistrictArchitecture();
    this.buildLandmarks();
    this.buildTreesAndStreetFurniture();
    this.buildParkedCars();
    this.buildCollisionIndexes();
    this.buildCollisionDebug();
    this.buildSignals();
    this.bindInput();
    this.updateFeatureHighlights();
  }

  getFeatures(): readonly DistrictFeature[] {
    return this.features;
  }

  getCameraSnapshot(): GeoPoint & { heading: number } {
    const point = worldToGeo(this.camera.position.x, this.camera.position.z);
    return {
      ...point,
      altitude: this.camera.position.y,
      heading: this.camera.rotation.y,
    };
  }

  flyTo(point: GeoPoint, altitude = 260): void {
    const target = geoToWorld(point);
    this.camera.position.set(target.x + altitude * 0.7, altitude, target.z + altitude * 0.9);
    this.controls.target.set(target.x, 8, target.z);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  setSelectionHandler(handler: (feature: DistrictFeature) => void): void {
    this.selectionHandler = handler;
  }

  setBuildingInteractionHandlers(handlers: BuildingInteractionHandlers): void {
    this.buildingInteractionHandlers = handlers;
  }

  setBuildingPlacementEnabled(enabled: boolean): void {
    this.buildingPlacementEnabled = enabled;
    if (this.cameraMode === "orbit") {
      this.canvas.style.cursor = enabled ? "crosshair" : "grab";
    }
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    clearGroup(this.placedBuildingGroup);
    this.placedBuildingMeshes.clear();
    for (const building of buildings) {
      const group = this.createPlacedBuilding(building);
      this.placedBuildingMeshes.set(building.id, group);
      this.placedBuildingGroup.add(group);
    }
    this.updatePlacedBuildingSelection();
  }

  setSelectedPlacedBuilding(id: string | null): void {
    this.selectedPlacedBuildingId = id;
    this.updatePlacedBuildingSelection();
  }

  setEnvironmentStatusHandler(handler: EnvironmentStatusHandler): void {
    handler("rendered", "Standalone Three.js urban district");
  }

  setBuildMode(enabled: boolean): void {
    this.buildMode = enabled;
    this.updateFeatureHighlights();
  }

  setCameraMode(mode: CameraMode): void {
    const previousMode = this.cameraMode;
    this.cameraMode = mode;
    this.flyKeys.clear();
    this.looking = false;
    this.controls.enabled = mode === "orbit";
    this.canvas.style.cursor =
      mode === "orbit" && !this.buildingPlacementEnabled ? "grab" : "crosshair";
    if (previousMode === "walk" && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (mode === "fly" || mode === "walk") {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      this.flyYaw = Math.atan2(-direction.x, -direction.z);
      this.flyPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      if (mode === "walk") this.enterWalkMode();
      this.applyFlyRotation();
    } else {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      this.controls.target.copy(this.camera.position).addScaledVector(direction, 45);
    }
  }

  setSelectedFeature(featureId: string | null): void {
    this.selectedFeatureId = featureId;
    this.updateFeatureHighlights();
  }

  setDesigns(designs: ReadonlyMap<string, FeatureDesign>): void {
    clearGroup(this.designGroup);
    for (const [featureId, design] of designs) {
      const feature = this.features.find((candidate) => candidate.id === featureId);
      if (!feature) continue;
      if (feature.kind === "street") this.addStreetDesign(feature, design);
      else this.addIntersectionDesign(feature, design);
    }
  }

  setMapOverlay(mode: MapOverlayMode): void {
    clearGroup(this.analysisGroup);
    if (mode === "none") return;
    const material = new THREE.MeshBasicMaterial({
      color:
        mode === "congestion" ? "#f47b54" : mode === "pedestrians" ? "#59bdd7" : "#ef5c4f",
      transparent: true,
      opacity: mode === "conflicts" ? 0.38 : 0.3,
      depthWrite: false,
    });
    if (mode === "conflicts") {
      for (const [index, feature] of this.features
        .filter((candidate) => candidate.kind === "intersection")
        .entries()) {
        if (index % 2 !== 0) continue;
        const position = geoToWorld(feature.path[0]);
        const marker = new THREE.Mesh(new THREE.CircleGeometry(15, 24), material);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(position.x, 0.42, position.z);
        this.analysisGroup.add(marker);
      }
      return;
    }
    for (const [index, feature] of this.features
      .filter((candidate) => candidate.kind === "street")
      .entries()) {
      if (index % (mode === "congestion" ? 3 : 4) !== 0) continue;
      this.analysisGroup.add(
        createSegmentMesh(
          feature,
          mode === "congestion" ? ROAD_WIDTH * 0.78 : ROAD_WIDTH * 0.52,
          0.3,
          material,
        ),
      );
    }
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.camera.aspect = bounds.width / Math.max(bounds.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  render(state: Readonly<SimulationState>): void {
    const now = performance.now();
    const frameSeconds = Math.min((now - this.lastFrameTimestamp) / 1000, 0.1);
    this.lastFrameTimestamp = now;
    if (this.cameraMode === "fly") this.updateFlyCamera(frameSeconds);
    if (this.cameraMode === "walk") this.updateWalkCamera(frameSeconds);

    this.syncVehicles(state.vehicles);
    this.syncPedestrians(state.pedestrians);
    this.updateSignals(state.signals);

    if (this.cameraMode === "orbit") this.controls.update();
    this.updateCollisionDebug();
    this.renderer.render(this.scene, this.camera);
  }

  private buildLightingAndSky(): void {
    const hemisphere = new THREE.HemisphereLight("#dff3ff", "#536044", 2.35);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight("#fff3d6", 4.8);
    sun.position.set(-620, 1_050, 470);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -1_050;
    sun.shadow.camera.right = 1_050;
    sun.shadow.camera.top = 1_050;
    sun.shadow.camera.bottom = -1_050;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 2_500;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.06;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight("#b6d4e2", 1.1);
    fill.position.set(900, 420, -700);
    this.scene.add(fill);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      this.materials.ground,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = RENDER_HEIGHTS.ground;
    ground.receiveShadow = true;
    ground.userData.walkable = true;
    this.scene.add(ground);

    const campusLawn = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 350),
      this.materials.campusGrass,
    );
    campusLawn.rotation.x = -Math.PI / 2;
    campusLawn.position.set(-70, RENDER_HEIGHTS.lawn, 140);
    campusLawn.receiveShadow = true;
    campusLawn.userData.walkable = true;
    this.scene.add(campusLawn);

    for (const [x, z, width, depth] of [
      [-120, 125, 185, 90],
      [260, 300, 150, 110],
      [410, 30, 190, 130],
      [-520, -250, 150, 100],
    ] as const) {
      const lawn = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        this.materials.lawn,
      );
      lawn.rotation.x = -Math.PI / 2;
      lawn.position.set(x, RENDER_HEIGHTS.lawnPatch, z);
      lawn.userData.walkable = true;
      this.scene.add(lawn);
    }
  }

  private buildRoadsAndSidewalks(): void {
    for (const feature of this.features) {
      if (feature.kind !== "street") continue;
      const width = roadWidth(feature);
      const material = this.materials.asphalt.clone();
      const road = createSegmentMesh(feature, width, ROAD_HEIGHT, material);
      road.userData.featureId = feature.id;
      road.userData.walkable = true;
      road.receiveShadow = true;
      this.featureMeshes.set(feature.id, road);
      this.selectableRoads.push(road);
      this.scene.add(road);

      const [start, end] = feature.path.map(geoToWorld);
      const direction = end.clone().sub(start);
      const length = direction.length();
      const center = start.clone().add(end).multiplyScalar(0.5);
      const angle = Math.atan2(direction.x, direction.z);
      const normal = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const sidewalkOffset = width / 2 + SIDEWALK_WIDTH / 2 + 0.65;
      for (const side of [-1, 1]) {
        const sidewalk = box(
          length,
          0.28,
          SIDEWALK_WIDTH,
          this.materials.sidewalk,
        );
        sidewalk.position.copy(center).addScaledVector(normal, sidewalkOffset * side);
        sidewalk.position.y = RENDER_HEIGHTS.sidewalkCenter;
        sidewalk.rotation.y = angle;
        sidewalk.receiveShadow = true;
        sidewalk.userData.walkable = true;
        this.scene.add(sidewalk);
      }

      const centerLine = box(
        length * 0.96,
        0.025,
        feature.name === "Market Street" ? 0.3 : 0.2,
        this.materials.yellowLine,
      );
      centerLine.position.copy(center);
      centerLine.position.y = RENDER_HEIGHTS.roadMarking;
      centerLine.rotation.y = angle;
      this.scene.add(centerLine);

      if (width >= MAJOR_ROAD_WIDTH) {
        for (const laneOffset of [-width * 0.25, width * 0.25]) {
          const laneLine = box(length * 0.94, 0.02, 0.14, this.materials.whiteLine);
          laneLine.position.copy(center).addScaledVector(normal, laneOffset);
          laneLine.position.y = RENDER_HEIGHTS.roadMarking + 0.01;
          laneLine.rotation.y = angle;
          this.scene.add(laneLine);
        }
      }
    }

    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "intersection",
    )) {
      const position = geoToWorld(feature.path[0]);
      const intersectionMaterial = this.materials.asphalt.clone();
      intersectionMaterial.polygonOffset = true;
      intersectionMaterial.polygonOffsetFactor = -1;
      intersectionMaterial.polygonOffsetUnits = -1;
      const intersection = box(
        MAJOR_ROAD_WIDTH + 0.8,
        0.05,
        MAJOR_ROAD_WIDTH + 0.8,
        intersectionMaterial,
      );
      intersection.position.set(
        position.x,
        RENDER_HEIGHTS.intersectionSurface - 0.025,
        position.z,
      );
      intersection.receiveShadow = true;
      intersection.userData.walkable = true;
      intersection.userData.featureId = feature.id;
      this.selectableRoads.push(intersection);
      this.scene.add(intersection);
      if (position.length() > 930) continue;
      this.addCrosswalk(position.x, position.z);
    }
  }

  private addCrosswalk(x: number, z: number): void {
    for (let index = -3; index <= 3; index += 1) {
      const stripeA = box(1.35, 0.025, 6.2, this.materials.whiteLine);
      stripeA.position.set(x + index * 2.25, RENDER_HEIGHTS.crosswalk, z - 10.5);
      const stripeB = stripeA.clone();
      stripeB.position.z = z + 10.5;
      const stripeC = box(6.2, 0.025, 1.35, this.materials.whiteLine);
      stripeC.position.set(x - 10.5, RENDER_HEIGHTS.crosswalk, z + index * 2.25);
      const stripeD = stripeC.clone();
      stripeD.position.x = x + 10.5;
      this.scene.add(stripeA, stripeB, stripeC, stripeD);
    }
  }

  private buildDistrictArchitecture(): void {
    const rng = seededRandom(20260727);
    for (let avenueIndex = 0; avenueIndex < PENN_AVENUES.length - 1; avenueIndex += 1) {
      for (let streetIndex = 0; streetIndex < PENN_STREETS.length - 1; streetIndex += 1) {
        const west = geoToWorld({
          longitude: PENN_AVENUES[avenueIndex + 1].longitude,
          latitude: PENN_CENTER.latitude,
        }).x;
        const east = geoToWorld({
          longitude: PENN_AVENUES[avenueIndex].longitude,
          latitude: PENN_CENTER.latitude,
        }).x;
        const north = geoToWorld({
          longitude: PENN_CENTER.longitude,
          latitude: PENN_STREETS[streetIndex].latitude,
        }).z;
        const south = geoToWorld({
          longitude: PENN_CENTER.longitude,
          latitude: PENN_STREETS[streetIndex + 1].latitude,
        }).z;
        const blockCenter = new THREE.Vector3((west + east) / 2, 0, (north + south) / 2);
        const blockWidth = Math.abs(east - west) - 31;
        const blockDepth = Math.abs(south - north) - 31;
        if (blockWidth < 22 || blockDepth < 22) continue;

        const paving = box(blockWidth, 0.16, blockDepth, this.materials.blockPaving);
        paving.position.set(blockCenter.x, RENDER_HEIGHTS.blockCenter, blockCenter.z);
        paving.receiveShadow = true;
        paving.userData.walkable = true;
        this.scene.add(paving);

        if (this.nearLandmark(blockCenter.x, blockCenter.z, 80)) continue;
        const distance = Math.hypot(blockCenter.x, blockCenter.z);
        const core = distance < 760;
        const buildingCount = core ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
        for (let index = 0; index < buildingCount; index += 1) {
          const cellWidth = blockWidth / buildingCount;
          const width = Math.max(18, cellWidth * (0.58 + rng() * 0.28));
          const depth = Math.max(20, blockDepth * (0.55 + rng() * 0.28));
          const x =
            blockCenter.x -
            blockWidth / 2 +
            cellWidth * (index + 0.5) +
            (rng() - 0.5) * cellWidth * 0.18;
          const z = blockCenter.z + (rng() - 0.5) * blockDepth * 0.2;
          const archetype = Math.floor(rng() * 12);
          this.addArchetypeBuilding(archetype, x, z, width, depth, core, rng);
        }
      }
    }
  }

  private addArchetypeBuilding(
    archetype: number,
    x: number,
    z: number,
    width: number,
    depth: number,
    core: boolean,
    rng: () => number,
  ): void {
    const group = new THREE.Group();
    group.position.set(x, 0.26, z);
    group.rotation.y = (rng() - 0.5) * 0.06;
    const baseHeight = core ? 18 + rng() * 48 : 14 + rng() * 78;

    if (archetype === 0 || archetype === 1) {
      this.addVolume(group, 0, 0, width, depth, baseHeight, this.materials.historicBrick, true);
      this.addPitchedRoof(group, 0, baseHeight, 0, width * 0.88, depth * 0.88, "#59433d");
      if (archetype === 0) {
        this.addVolume(
          group,
          0,
          -depth * 0.12,
          width * 0.22,
          depth * 0.35,
          baseHeight * 1.38,
          this.materials.darkStone,
          true,
        );
      }
    } else if (archetype === 2) {
      this.addVolume(group, -width * 0.22, 0, width * 0.56, depth, baseHeight, this.materials.redBrick, true);
      this.addVolume(group, width * 0.28, depth * 0.18, width * 0.44, depth * 0.64, baseHeight * 0.78, this.materials.redBrick, true);
    } else if (archetype === 3 || archetype === 4) {
      this.addVolume(group, 0, 0, width, depth, baseHeight * 0.32, this.materials.concrete, true);
      this.addVolume(group, 0, 0, width * 0.68, depth * 0.74, baseHeight, this.materials.glass, true);
      this.addRoofDetails(group, width * 0.5, depth * 0.5, baseHeight, rng);
    } else if (archetype === 5) {
      this.addVolume(group, 0, 0, width, depth, baseHeight * 0.28, this.materials.limestone, true);
      this.addVolume(group, 0, 0, width * 0.56, depth * 0.62, baseHeight * 1.45, this.materials.dorm, true);
      this.addRoofDetails(group, width * 0.4, depth * 0.45, baseHeight * 1.45, rng);
    } else if (archetype === 6) {
      const count = Math.max(3, Math.floor(width / 12));
      for (let index = 0; index < count; index += 1) {
        const unitWidth = width / count - 0.5;
        const unitX = -width / 2 + (index + 0.5) * (width / count);
        const height = 12 + (index % 3) * 2.5;
        this.addVolume(
          group,
          unitX,
          0,
          unitWidth,
          depth * 0.8,
          height,
          index % 2 ? this.materials.rowhouseRed : this.materials.rowhouseTan,
          true,
        );
        this.addPitchedRoof(group, unitX, height, 0, unitWidth * 0.92, depth * 0.74, "#504740");
      }
    } else if (archetype === 7) {
      this.addVolume(group, 0, 0, width, depth, baseHeight * 0.82, this.materials.office, true);
      this.addVolume(group, width * 0.18, 0, width * 0.42, depth * 0.72, baseHeight * 1.25, this.materials.glass, true);
    } else if (archetype === 8) {
      this.addVolume(group, 0, 0, width, depth, baseHeight * 0.55, this.materials.hospital, true);
      this.addVolume(group, -width * 0.24, 0, width * 0.42, depth * 0.82, baseHeight * 1.2, this.materials.hospital, true);
      this.addVolume(group, width * 0.24, 0, width * 0.42, depth * 0.72, baseHeight, this.materials.glass, true);
      this.addRoofDetails(group, width * 0.8, depth * 0.7, baseHeight * 1.2, rng);
    } else if (archetype === 9) {
      this.addVolume(group, 0, 0, width, depth, baseHeight * 0.75, this.materials.parking, true);
      for (let level = 1; level < 5; level += 1) {
        const band = box(width * 1.01, 0.55, depth * 1.01, this.materials.darkBand);
        band.position.y = (baseHeight * 0.75 * level) / 5;
        group.add(band);
      }
    } else if (archetype === 10) {
      this.addVolume(group, 0, 0, width, depth, 9 + rng() * 8, this.materials.retail, true);
      const awning = box(width * 0.82, 0.45, 2.2, this.materials.awning);
      awning.position.set(0, 4.1, depth / 2 + 1);
      group.add(awning);
    } else {
      this.addVolume(group, -width * 0.18, 0, width * 0.64, depth, baseHeight * 0.78, this.materials.academic, true);
      this.addVolume(group, width * 0.3, -depth * 0.17, width * 0.38, depth * 0.66, baseHeight, this.materials.academic, true);
      this.addRoofDetails(group, width * 0.65, depth * 0.7, baseHeight, rng);
    }
    this.scene.add(group);
  }

  private addVolume(
    group: THREE.Group,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    material: THREE.Material,
    shadows: boolean,
  ): THREE.Mesh {
    const volume = box(width, height, depth, material);
    volume.position.set(x, height / 2, z);
    volume.castShadow = shadows;
    volume.receiveShadow = true;
    volume.userData.collidable = true;
    group.add(volume);
    return volume;
  }

  private addPitchedRoof(
    group: THREE.Group,
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    color: string,
  ): void {
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(width, depth) * 0.55, Math.min(width, depth) * 0.55, 5, 4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    roof.scale.set(width / Math.max(depth, 1), 1, 1);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(x, y + 2.5, z);
    roof.castShadow = true;
    roof.userData.collidable = true;
    group.add(roof);
  }

  private addRoofDetails(
    group: THREE.Group,
    width: number,
    depth: number,
    height: number,
    rng: () => number,
  ): void {
    const unitCount = 1 + Math.floor(rng() * 3);
    for (let index = 0; index < unitCount; index += 1) {
      const unit = box(
        4 + rng() * 5,
        2.4 + rng() * 2,
        4 + rng() * 5,
        this.materials.rooftop,
      );
      unit.position.set(
        (rng() - 0.5) * width * 0.55,
        height + unit.geometry.parameters.height / 2,
        (rng() - 0.5) * depth * 0.55,
      );
      unit.castShadow = true;
      group.add(unit);
    }
  }

  private buildLandmarks(): void {
    for (const landmark of PENN_LANDMARKS) {
      const position = geoToWorld(landmark);
      const group = new THREE.Group();
      group.position.set(position.x, 0.3, position.z);
      group.userData.landmark = landmark.name;
      if (landmark.kind === "college-hall") this.buildCollegeHall(group);
      else if (landmark.kind === "fisher") this.buildFisher(group);
      else if (landmark.kind === "huntsman") this.buildHuntsman(group);
      else if (landmark.kind === "van-pelt") this.buildVanPelt(group);
      else if (landmark.kind === "museum") this.buildMuseum(group);
      else if (landmark.kind === "franklin-field") this.buildFranklinField(group);
      else if (landmark.kind === "gutmann") this.buildGutmann(group);
      else if (landmark.kind === "houston") this.buildHouston(group);
      else if (landmark.kind === "engineering") this.buildEngineering(group);
      else this.buildMedicine(group);
      this.scene.add(group);
    }
  }

  private buildCollegeHall(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 92, 34, 31, this.materials.landmarkStone, true);
    this.addVolume(group, 0, -2, 22, 26, 52, this.materials.landmarkStone, true);
    this.addVolume(group, -37, 0, 15, 26, 39, this.materials.darkStone, true);
    this.addVolume(group, 37, 0, 15, 26, 39, this.materials.darkStone, true);
    this.addPitchedRoof(group, 0, 31, 0, 88, 30, "#4e3d3a");
    for (const x of [-37, 0, 37]) {
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(5.5, 13, 6),
        this.materials.roofCopper,
      );
      spire.position.set(x, x === 0 ? 58 : 46, -2);
      spire.castShadow = true;
      group.add(spire);
    }
  }

  private buildFisher(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 62, 48, 28, this.materials.fisherBrick, true);
    this.addVolume(group, -24, -12, 18, 18, 49, this.materials.fisherBrick, true);
    this.addVolume(group, 20, 11, 22, 20, 37, this.materials.fisherBrick, true);
    for (const [x, z, height] of [[-24, -12, 56], [20, 11, 44]] as const) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(7, 12, 4), this.materials.darkRoof);
      cap.position.set(x, height, z);
      cap.rotation.y = Math.PI / 4;
      group.add(cap);
    }
  }

  private buildHuntsman(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 88, 56, 27, this.materials.huntsmanStone, true);
    this.addVolume(group, -31, 0, 25, 48, 42, this.materials.huntsmanStone, true);
    this.addVolume(group, 31, 0, 25, 48, 42, this.materials.huntsmanStone, true);
    const rotunda = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 13, 35, 24),
      this.materials.glass,
    );
    rotunda.position.set(0, 18, 27);
    rotunda.castShadow = true;
    group.add(rotunda);
  }

  private buildVanPelt(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 96, 62, 19, this.materials.limestone, true);
    this.addVolume(group, 0, -2, 78, 48, 32, this.materials.vanPelt, true);
    this.addVolume(group, 0, -3, 58, 35, 39, this.materials.limestone, true);
  }

  private buildMuseum(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 86, 57, 24, this.materials.museumBrick, true);
    this.addVolume(group, -28, -12, 31, 32, 32, this.materials.museumBrick, true);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      this.materials.roofCopper,
    );
    dome.position.set(-28, 32, -12);
    dome.castShadow = true;
    group.add(dome);
  }

  private buildFranklinField(group: THREE.Group): void {
    const field = new THREE.Mesh(new THREE.PlaneGeometry(145, 72), this.materials.field);
    field.rotation.x = -Math.PI / 2;
    field.position.y = 0.3;
    field.userData.walkable = true;
    group.add(field);
    const stadium = new THREE.Mesh(
      new THREE.TorusGeometry(51, 12, 10, 64),
      this.materials.stadiumConcrete,
    );
    stadium.rotation.x = Math.PI / 2;
    stadium.scale.x = 1.55;
    stadium.position.y = 8;
    stadium.castShadow = true;
    group.add(stadium);
  }

  private buildGutmann(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 66, 46, 16, this.materials.concrete, true);
    this.addVolume(group, 6, -2, 45, 36, 58, this.materials.glass, true);
    const crown = box(49, 4, 40, this.materials.silver);
    crown.position.set(6, 60, -2);
    group.add(crown);
  }

  private buildHouston(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 60, 45, 28, this.materials.historicBrick, true);
    this.addVolume(group, 0, -9, 18, 22, 43, this.materials.historicBrick, true);
    this.addPitchedRoof(group, 0, 28, 0, 56, 41, "#51403c");
  }

  private buildEngineering(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 82, 48, 22, this.materials.academic, true);
    this.addVolume(group, -19, 0, 34, 38, 42, this.materials.glass, true);
    this.addVolume(group, 26, 0, 25, 42, 34, this.materials.silver, true);
  }

  private buildMedicine(group: THREE.Group): void {
    this.addVolume(group, 0, 0, 112, 68, 24, this.materials.hospital, true);
    this.addVolume(group, -32, 0, 38, 52, 82, this.materials.hospital, true);
    this.addVolume(group, 18, -6, 45, 46, 66, this.materials.glass, true);
    this.addVolume(group, 43, 6, 24, 38, 48, this.materials.hospital, true);
  }

  private buildTreesAndStreetFurniture(): void {
    const rng = seededRandom(4438);
    const treePositions: Array<{ x: number; z: number; scale: number; type: number }> = [];
    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "street",
    )) {
      const [start, end] = feature.path.map(geoToWorld);
      const direction = end.clone().sub(start);
      const length = direction.length();
      const steps = Math.max(1, Math.floor(length / 42));
      const normal = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      const width = roadWidth(feature);
      for (let index = 1; index < steps; index += 1) {
        if (rng() < 0.34) continue;
        const base = start.clone().lerp(end, index / steps);
        const side = index % 2 === 0 ? 1 : -1;
        base.addScaledVector(normal, side * (width / 2 + SIDEWALK_WIDTH + 2.8));
        if (this.nearLandmark(base.x, base.z, 24)) continue;
        treePositions.push({
          x: base.x + (rng() - 0.5) * 3,
          z: base.z + (rng() - 0.5) * 3,
          scale: 0.75 + rng() * 0.7,
          type: Math.floor(rng() * 3),
        });
      }
    }
    this.addInstancedTrees(treePositions);
    this.addStreetlights();
    this.addCampusProps();
  }

  private addInstancedTrees(
    positions: Array<{ x: number; z: number; scale: number; type: number }>,
  ): void {
    const trunkGeometry = new THREE.CylinderGeometry(0.38, 0.52, 5.5, 7);
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeometry,
      this.materials.trunk,
      positions.length,
    );
    const crownMeshes = [
      new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(3.5, 1),
        this.materials.leavesA,
        positions.length,
      ),
      new THREE.InstancedMesh(
        new THREE.SphereGeometry(3.8, 9, 7),
        this.materials.leavesB,
        positions.length,
      ),
      new THREE.InstancedMesh(
        new THREE.ConeGeometry(3.4, 7.5, 9),
        this.materials.leavesC,
        positions.length,
      ),
    ];
    const counts = [0, 0, 0];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    positions.forEach((tree, index) => {
      position.set(tree.x, 2.8 * tree.scale, tree.z);
      scale.set(tree.scale, tree.scale, tree.scale);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.71);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(index, matrix);

      const crown = crownMeshes[tree.type];
      const crownIndex = counts[tree.type];
      position.y = tree.type === 2 ? 7.2 * tree.scale : 6.3 * tree.scale;
      matrix.compose(position, quaternion, scale);
      crown.setMatrixAt(crownIndex, matrix);
      counts[tree.type] += 1;
    });
    trunkMesh.castShadow = true;
    for (const [index, crown] of crownMeshes.entries()) {
      crown.count = counts[index];
      crown.castShadow = true;
      crown.instanceMatrix.needsUpdate = true;
      this.scene.add(crown);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(trunkMesh);
  }

  private addStreetlights(): void {
    const coreFeatures = this.features.filter((feature) => {
      if (feature.kind !== "street") return false;
      const center = segmentCenter(feature);
      return Math.hypot(center.x, center.z) < 880;
    });
    const positions: THREE.Vector3[] = [];
    for (const feature of coreFeatures) {
      const [start, end] = feature.path.map(geoToWorld);
      const direction = end.clone().sub(start);
      const normal = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      const steps = Math.max(1, Math.floor(direction.length() / 75));
      for (let index = 1; index < steps; index += 1) {
        const position = start.clone().lerp(end, index / steps);
        position.addScaledVector(normal, roadWidth(feature) / 2 + 3.6);
        positions.push(position);
      }
    }
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.22, 7.5, 8),
      this.materials.streetMetal,
      positions.length,
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      this.materials.lamp,
      positions.length,
    );
    const matrix = new THREE.Matrix4();
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x, 3.9, position.z);
      poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(position.x, 7.7, position.z);
      lamps.setMatrixAt(index, matrix);
    });
    this.scene.add(poles, lamps);
  }

  private addCampusProps(): void {
    const rng = seededRandom(90210);
    for (let index = 0; index < 45; index += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = 120 + rng() * 560;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (index % 3 === 0) {
        const bench = new THREE.Group();
        const seat = box(3.1, 0.25, 0.75, this.materials.wood);
        seat.position.y = 0.85;
        const back = box(3.1, 0.9, 0.18, this.materials.wood);
        back.position.set(0, 1.35, 0.32);
        bench.add(seat, back);
        bench.position.set(x, 0.25, z);
        bench.rotation.y = angle;
        this.scene.add(bench);
      } else {
        const planter = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1, 1.25, 1.1, 12),
          this.materials.planter,
        );
        planter.position.set(x, 0.72, z);
        this.scene.add(planter);
      }
    }
  }

  private buildParkedCars(): void {
    const rng = seededRandom(7781);
    const parked: Array<{ position: THREE.Vector3; rotation: number; color: THREE.Color }> = [];
    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "street",
    )) {
      const [start, end] = feature.path.map(geoToWorld);
      const direction = end.clone().sub(start);
      const length = direction.length();
      const normal = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      const steps = Math.floor(length / 24);
      for (let index = 1; index < steps; index += 1) {
        if (rng() < 0.45) continue;
        const position = start.clone().lerp(end, index / steps);
        position.addScaledVector(normal, (index % 2 ? 1 : -1) * (roadWidth(feature) / 2 - 2.2));
        parked.push({
          position,
          rotation: Math.atan2(direction.x, direction.z),
          color: new THREE.Color(
            ["#344a5e", "#bf4d42", "#d5d7d2", "#24282c", "#b28d48"][index % 5],
          ),
        });
      }
    }
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 0.72, 4.3),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.38,
        metalness: 0.08,
        vertexColors: true,
      }),
      parked.length,
    );
    const cabin = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.65, 0.6, 2.1),
      this.materials.carGlass,
      parked.length,
    );
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    parked.forEach((car, index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation);
      matrix.compose(
        new THREE.Vector3(car.position.x, 0.58, car.position.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      body.setMatrixAt(index, matrix);
      body.setColorAt(index, car.color);
      matrix.compose(
        new THREE.Vector3(car.position.x, 1.18, car.position.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      cabin.setMatrixAt(index, matrix);
    });
    body.castShadow = true;
    cabin.castShadow = true;
    this.scene.add(body, cabin);
  }

  private buildSignals(): void {
    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "intersection",
    )) {
      const position = geoToWorld(feature.path[0]);
      const major =
        feature.name.startsWith("38th") ||
        feature.name.startsWith("40th") ||
        feature.name.includes("Market") ||
        feature.name.includes("South");
      for (const [axis, sign] of [
        ["x", 1],
        ["x", -1],
        ["z", 1],
        ["z", -1],
      ] as const) {
        const group = this.createSignalAssembly(
          feature.id,
          axis,
          sign,
          major,
        );
        const corner = signalCorner(axis, sign);
        group.position.set(
          position.x + corner.x * 11.2,
          RENDER_HEIGHTS.sidewalkSurface,
          position.z + corner.z * 11.2,
        );
        group.rotation.y = signalFacingRotation(axis, sign);
        this.scene.add(group);
      }
    }
  }

  private createSignalAssembly(
    intersectionId: string,
    axis: DistrictFeature["axis"],
    _sign: 1 | -1,
    mastArm: boolean,
  ): THREE.Group {
    const group = new THREE.Group();
    const poleHeight = 7.2;
    const armLength = mastArm ? 8.2 : 5.8;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, poleHeight, 10),
      this.materials.streetMetal,
    );
    pole.position.y = poleHeight / 2;
    const arm = box(
      armLength,
      0.25,
      0.25,
      this.materials.streetMetal,
    );
    arm.position.set(-armLength / 2 + 0.1, poleHeight - 0.35, 0);
    const bracket = box(0.3, 0.85, 0.3, this.materials.streetMetal);
    bracket.position.set(-armLength + 0.45, poleHeight - 0.75, 0);
    const backing = box(1.45, 3.15, 0.18, this.materials.signalHousing);
    backing.position.set(-armLength + 0.45, poleHeight - 2.15, -0.34);
    const housing = box(1.2, 2.85, 0.78, this.materials.signalHousing);
    housing.position.set(-armLength + 0.45, poleHeight - 2.15, 0);
    const red = createSignalLensMaterial("#d84137");
    const yellow = createSignalLensMaterial("#e7b73f");
    const green = createSignalLensMaterial("#3cbd6d");
    for (const [offset, material] of [
      [0.86, red],
      [0, yellow],
      [-0.86, green],
    ] as const) {
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.13, 18),
        material,
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(
        -armLength + 0.45,
        poleHeight - 2.15 + offset,
        0.47,
      );
      group.add(lens);
    }
    const pedestrianHousing = box(
      1.15,
      1.4,
      0.62,
      this.materials.signalHousing,
    );
    pedestrianHousing.position.set(0, 3.15, 0.08);
    const walk = createSignalLensMaterial("#eef7ed");
    const dontWalk = createSignalLensMaterial("#df653f");
    const walkHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 8),
      walk,
    );
    walkHead.position.set(-0.22, 3.42, 0.43);
    const walkBody = box(0.16, 0.48, 0.08, walk);
    walkBody.position.set(-0.22, 3.03, 0.43);
    const hand = new THREE.Group();
    for (let finger = 0; finger < 4; finger += 1) {
      const digit = box(0.07, 0.36, 0.08, dontWalk);
      digit.position.set(0.08 + finger * 0.09, 3.34, 0.44);
      hand.add(digit);
    }
    const palm = box(0.38, 0.34, 0.08, dontWalk);
    palm.position.set(0.22, 3.02, 0.44);
    hand.add(palm);
    group.add(
      pole,
      arm,
      bracket,
      backing,
      housing,
      pedestrianHousing,
      walkHead,
      walkBody,
      hand,
    );
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    this.signalAssemblies.push({
      intersectionId,
      axis,
      red,
      yellow,
      green,
      walk,
      dontWalk,
    });
    return group;
  }

  private createPlacedBuilding(building: PlacedBuilding): THREE.Group {
    const group = new THREE.Group();
    group.position.set(building.x, 0, building.z);
    group.rotation.y = building.rotation;
    group.userData.placedBuildingId = building.id;

    const floors = THREE.MathUtils.clamp(Math.round(building.floors), 1, 20);
    const industrial = building.kind === "industrial";
    const commercial = building.kind === "commercial";
    const civic = building.kind === "civic";
    const width = industrial ? 24 : civic ? 18 : commercial ? 17 : 15;
    const depth = industrial ? 19 : civic ? 17 : commercial ? 15 : 14;
    const floorHeight = industrial ? 2.6 : 3.2;
    const height = Math.max(6, floors * floorHeight);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: building.color,
      roughness: 0.76,
      metalness: commercial ? 0.15 : 0.04,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: commercial ? "#a9cbd2" : "#344148",
      roughness: 0.72,
    });
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: commercial ? "#9edbea" : "#f4d78d",
      emissive: commercial ? "#2f6976" : "#70571d",
      emissiveIntensity: 0.28,
      roughness: 0.3,
    });

    const foundation = box(
      width + 4,
      0.45,
      depth + 4,
      new THREE.MeshStandardMaterial({ color: "#c5c0b3", roughness: 0.95 }),
    );
    foundation.position.y = 0.24;
    foundation.receiveShadow = true;
    const body = box(width, height, depth, bodyMaterial);
    body.position.y = 0.5 + height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    const roof = box(width + 0.8, civic ? 1.2 : 0.65, depth + 0.8, roofMaterial);
    roof.position.y = 0.58 + height;
    roof.castShadow = true;
    group.add(foundation, body, roof);

    const visibleFloorStep = Math.max(1, Math.ceil(floors / 8));
    for (let floor = 0; floor < floors; floor += visibleFloorStep) {
      const y = 1.9 + floor * floorHeight;
      for (const x of [-width * 0.27, width * 0.27]) {
        const window = box(2.4, 1.25, 0.16, windowMaterial);
        window.position.set(x, y, depth / 2 + 0.1);
        group.add(window);
      }
    }

    const door = box(2.5, 3.2, 0.2, this.materials.streetMetal);
    door.position.set(0, 2.05, depth / 2 + 0.14);
    group.add(door);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(width, depth) * 0.68, Math.max(width, depth) * 0.82, 40),
      new THREE.MeshBasicMaterial({
        color: "#73f0cb",
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    selectionRing.name = "building-selection-ring";
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.38;
    selectionRing.visible = false;
    group.add(selectionRing);
    return group;
  }

  private updatePlacedBuildingSelection(): void {
    for (const [id, group] of this.placedBuildingMeshes) {
      const ring = group.getObjectByName("building-selection-ring");
      if (ring) ring.visible = id === this.selectedPlacedBuildingId;
    }
  }

  private updatePointerRay(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private placedBuildingIdFromObject(object: THREE.Object3D | undefined): string | null {
    let current = object;
    while (current) {
      if (typeof current.userData.placedBuildingId === "string") {
        return current.userData.placedBuildingId;
      }
      current = current.parent ?? undefined;
    }
    return null;
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerDown.set(event.clientX, event.clientY);
      if (this.buildMode && this.cameraMode === "orbit") {
        this.updatePointerRay(event);
        const hit = this.raycaster.intersectObjects(
          [...this.placedBuildingMeshes.values()],
          true,
        )[0];
        const buildingId = this.placedBuildingIdFromObject(hit?.object);
        if (buildingId) {
          const group = this.placedBuildingMeshes.get(buildingId);
          if (group && this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)) {
            this.draggingBuildingId = buildingId;
            this.dragOffset.copy(group.position).sub(this.placementPoint);
            this.controls.enabled = false;
            this.canvas.setPointerCapture(event.pointerId);
            this.setSelectedPlacedBuilding(buildingId);
            this.buildingInteractionHandlers?.onSelect(buildingId);
            event.preventDefault();
            return;
          }
        }
      }
      if (this.cameraMode === "walk") {
        if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock();
        return;
      }
      if (this.cameraMode !== "fly") return;
      this.looking = true;
      this.lastPointer.set(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.draggingBuildingId) {
        this.updatePointerRay(event);
        const group = this.placedBuildingMeshes.get(this.draggingBuildingId);
        if (group && this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)) {
          group.position.copy(this.placementPoint).add(this.dragOffset);
          group.position.x = THREE.MathUtils.clamp(group.position.x, -1_150, 1_150);
          group.position.z = THREE.MathUtils.clamp(group.position.z, -1_150, 1_150);
          this.buildingInteractionHandlers?.onMove(
            this.draggingBuildingId,
            group.position.x,
            group.position.z,
          );
        }
        return;
      }
      if (this.cameraMode !== "fly" || !this.looking) return;
      const deltaX = event.clientX - this.lastPointer.x;
      const deltaY = event.clientY - this.lastPointer.y;
      this.flyYaw -= deltaX * 0.003;
      this.flyPitch = THREE.MathUtils.clamp(
        this.flyPitch - deltaY * 0.003,
        -Math.PI / 2 + 0.04,
        Math.PI / 2 - 0.04,
      );
      this.lastPointer.set(event.clientX, event.clientY);
      this.applyFlyRotation();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.draggingBuildingId) {
        this.draggingBuildingId = null;
        this.controls.enabled = true;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (this.cameraMode === "fly") {
        this.looking = false;
        this.canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (this.cameraMode === "walk") return;
      if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) < 5) {
        this.pickFeature(event);
      }
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (this.cameraMode !== "fly") return;
        event.preventDefault();
        this.flySpeedScale = THREE.MathUtils.clamp(
          this.flySpeedScale * (event.deltaY > 0 ? 0.84 : 1.18),
          0.2,
          2.5,
        );
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => {
      if (
        (this.cameraMode !== "fly" && this.cameraMode !== "walk") ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      if (isMovementKey(event.code)) {
        event.preventDefault();
        this.flyKeys.add(event.code);
        if (this.cameraMode === "walk" && event.code === "Space" && this.grounded) {
          this.walkVerticalVelocity = 5.6;
          this.grounded = false;
        }
      }
    });
    window.addEventListener("keyup", (event) => this.flyKeys.delete(event.code));
    window.addEventListener("blur", () => this.flyKeys.clear());
    document.addEventListener("mousemove", (event) => {
      if (
        this.cameraMode !== "walk" ||
        document.pointerLockElement !== this.canvas
      ) {
        return;
      }
      this.flyYaw -= event.movementX * 0.0022;
      this.flyPitch = THREE.MathUtils.clamp(
        this.flyPitch - event.movementY * 0.0022,
        -Math.PI / 2 + 0.08,
        Math.PI / 2 - 0.08,
      );
      this.applyFlyRotation();
    });
    document.addEventListener("pointerlockchange", () => {
      if (this.cameraMode !== "walk") return;
      this.canvas.style.cursor =
        document.pointerLockElement === this.canvas ? "none" : "crosshair";
    });
  }

  private pickFeature(event: PointerEvent): void {
    if (!this.buildMode || this.cameraMode !== "orbit") return;
    this.updatePointerRay(event);
    const buildingHit = this.raycaster.intersectObjects(
      [...this.placedBuildingMeshes.values()],
      true,
    )[0];
    const buildingId = this.placedBuildingIdFromObject(buildingHit?.object);
    if (buildingId) {
      this.setSelectedPlacedBuilding(buildingId);
      this.buildingInteractionHandlers?.onSelect(buildingId);
      return;
    }
    if (
      this.buildingPlacementEnabled &&
      this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)
    ) {
      this.buildingInteractionHandlers?.onPlace(
        THREE.MathUtils.clamp(this.placementPoint.x, -1_150, 1_150),
        THREE.MathUtils.clamp(this.placementPoint.z, -1_150, 1_150),
      );
      return;
    }
    const hit = this.raycaster.intersectObjects(this.selectableRoads, false)[0];
    const featureId = hit?.object.userData.featureId as string | undefined;
    if (!featureId) return;
    const feature = this.features.find((candidate) => candidate.id === featureId);
    if (feature) this.selectionHandler?.(feature);
  }

  private updateFlyCamera(deltaSeconds: number): void {
    const movementDelta = Math.min(deltaSeconds, 0.025);
    const altitude = Math.max(2, this.camera.position.y);
    const baseSpeed =
      altitude < 12 ? 7 : altitude < 120 ? 7 + altitude * 0.3 : Math.min(520, 38 + altitude * 0.42);
    const boost = this.flyKeys.has("ShiftLeft") || this.flyKeys.has("ShiftRight") ? 4 : 1;
    const distance = baseSpeed * this.flySpeedScale * boost * movementDelta;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const displacement = new THREE.Vector3();
    if (this.flyKeys.has("KeyW")) displacement.addScaledVector(forward, distance);
    if (this.flyKeys.has("KeyS")) displacement.addScaledVector(forward, -distance);
    if (this.flyKeys.has("KeyA")) displacement.addScaledVector(right, -distance);
    if (this.flyKeys.has("KeyD")) displacement.addScaledVector(right, distance);
    if (this.flyKeys.has("KeyE")) displacement.y += distance;
    if (this.flyKeys.has("KeyQ")) displacement.y -= distance;
    this.movePlayerWithCollision(displacement, "fly");
  }

  private updateWalkCamera(deltaSeconds: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.flyYaw), 0, -Math.cos(this.flyYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const walking = new THREE.Vector3();
    if (this.flyKeys.has("KeyW")) walking.add(forward);
    if (this.flyKeys.has("KeyS")) walking.sub(forward);
    if (this.flyKeys.has("KeyA")) walking.sub(right);
    if (this.flyKeys.has("KeyD")) walking.add(right);
    if (walking.lengthSq() > 0) {
      const running =
        this.flyKeys.has("ShiftLeft") || this.flyKeys.has("ShiftRight");
      walking.normalize().multiplyScalar((running ? 6.2 : 3.4) * deltaSeconds);
      this.movePlayerWithCollision(walking, "walk");
    }

    const groundHeight = this.getWalkableHeight(
      this.camera.position.x,
      this.camera.position.z,
    );
    const targetEyeHeight = groundHeight + WALK_EYE_HEIGHT;
    if (this.grounded && this.walkVerticalVelocity <= 0) {
      const step = targetEyeHeight - this.camera.position.y;
      if (Math.abs(step) <= 0.36) {
        this.camera.position.y = targetEyeHeight;
        this.walkVerticalVelocity = 0;
      } else {
        this.grounded = false;
      }
    }

    if (!this.grounded) {
      this.walkVerticalVelocity -= WALK_GRAVITY * deltaSeconds;
      const beforeY = this.camera.position.y;
      this.movePlayerWithCollision(
        new THREE.Vector3(0, this.walkVerticalVelocity * deltaSeconds, 0),
        "walk",
      );
      if (this.walkVerticalVelocity > 0 && this.camera.position.y === beforeY) {
        this.walkVerticalVelocity = 0;
      }
      if (
        this.walkVerticalVelocity <= 0 &&
        this.camera.position.y <= targetEyeHeight + 0.04
      ) {
        this.camera.position.y = targetEyeHeight;
        this.walkVerticalVelocity = 0;
        this.grounded = true;
      }
    }
  }

  private movePlayerWithCollision(
    displacement: THREE.Vector3,
    mode: "fly" | "walk",
  ): void {
    this.camera.position.copy(
      resolveSubsteppedMovement(
        this.camera.position,
        displacement,
        (candidate) => this.canOccupy(candidate, mode),
        MAX_COLLISION_STEP,
      ),
    );
  }

  private canOccupy(position: THREE.Vector3, mode: "fly" | "walk"): boolean {
    const radius = mode === "fly" ? FLY_COLLIDER_RADIUS : WALK_COLLIDER_RADIUS;
    const groundHeight = this.getWalkableHeight(position.x, position.z);
    if (
      (mode === "fly" && position.y - radius < groundHeight) ||
      (mode === "walk" && position.y - WALK_EYE_HEIGHT < groundHeight - 0.05)
    ) {
      return false;
    }

    const volumes = this.collisionIndex.query(
      position.x - radius,
      position.x + radius,
      position.z - radius,
      position.z + radius,
    );
    if (mode === "fly") {
      for (const volume of volumes) {
        volume.box.clampPoint(position, this.collisionClosest);
        if (
          this.collisionClosest.distanceToSquared(position) <
          radius * radius
        ) {
          return false;
        }
      }
      return true;
    }

    const bottom = position.y - WALK_EYE_HEIGHT;
    const top = bottom + WALK_PLAYER_HEIGHT;
    for (const volume of volumes) {
      const box = volume.box;
      if (top <= box.min.y || bottom >= box.max.y) continue;
      if (
        position.x > box.min.x - radius &&
        position.x < box.max.x + radius &&
        position.z > box.min.z - radius &&
        position.z < box.max.z + radius
      ) {
        return false;
      }
    }
    return true;
  }

  private enterWalkMode(): void {
    const safe = this.findSafeWalkPosition(
      this.camera.position.x,
      this.camera.position.z,
    );
    this.camera.position.set(safe.x, safe.height + WALK_EYE_HEIGHT, safe.z);
    this.walkVerticalVelocity = 0;
    this.grounded = true;
  }

  private findSafeWalkPosition(
    startX: number,
    startZ: number,
  ): { x: number; z: number; height: number } {
    const candidates: Array<{ x: number; z: number }> = [{ x: startX, z: startZ }];
    for (let radius = 3; radius <= 72; radius += 3) {
      for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * Math.PI * 2;
        candidates.push({
          x: startX + Math.cos(angle) * radius,
          z: startZ + Math.sin(angle) * radius,
        });
      }
    }
    for (const candidate of candidates) {
      const height = this.getWalkableHeight(candidate.x, candidate.z);
      const eye = new THREE.Vector3(candidate.x, height + WALK_EYE_HEIGHT, candidate.z);
      if (this.canOccupy(eye, "walk")) return { ...candidate, height };
    }

    const safeStreet =
      this.features.find((feature) => feature.id === "walnut-34-36") ??
      this.features.find((feature) => feature.kind === "street");
    const safePoint = safeStreet ? segmentCenter(safeStreet) : new THREE.Vector3();
    return {
      x: safePoint.x,
      z: safePoint.z,
      height: this.getWalkableHeight(safePoint.x, safePoint.z),
    };
  }

  private getWalkableHeight(x: number, z: number): number {
    let height: number = RENDER_HEIGHTS.ground;
    for (const surface of this.walkableIndex.query(x, x, z, z)) {
      if (
        x >= surface.minX &&
        x <= surface.maxX &&
        z >= surface.minZ &&
        z <= surface.maxZ
      ) {
        height = Math.max(height, surface.height);
      }
    }
    return height;
  }

  private applyFlyRotation(): void {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.flyPitch, this.flyYaw, 0);
  }

  private updateFeatureHighlights(): void {
    for (const [featureId, road] of this.featureMeshes) {
      const material = road.material as THREE.MeshStandardMaterial;
      const selected = featureId === this.selectedFeatureId;
      material.color.set(selected ? "#3d625f" : "#2c3337");
      material.emissive.set(selected ? "#1f6a5b" : "#000000");
      material.emissiveIntensity = selected ? 0.6 : 0;
      material.roughness = 0.9;
    }
  }

  private addStreetDesign(feature: DistrictFeature, design: FeatureDesign): void {
    if (
      design.laneDelta !== 0 ||
      design.bikeLane ||
      design.widenedSidewalk ||
      design.laneDirection !== "two-way"
    ) {
      const overlay = createSegmentMesh(
        feature,
        roadWidth(feature) + design.laneDelta * 3.2,
        0.04,
        this.materials.editedAsphalt,
      );
      overlay.position.y = RENDER_HEIGHTS.roadSurface + 0.025;
      this.designGroup.add(overlay);
      const line = createSegmentMesh(feature, 0.22, 0.03, this.materials.yellowLine);
      line.position.y = RENDER_HEIGHTS.selectionSurface + 0.01;
      this.designGroup.add(line);
    }
    if (design.bikeLane) {
      for (const side of [-1, 1]) {
        const lane = createOffsetSegmentMesh(
          feature,
          side * (roadWidth(feature) / 2 - 2),
          2.1,
          0.04,
          this.materials.bikeLane,
        );
        lane.position.y = RENDER_HEIGHTS.selectionSurface + 0.015;
        this.designGroup.add(lane);
      }
    }
    if (design.widenedSidewalk) {
      for (const side of [-1, 1]) {
        const walk = createOffsetSegmentMesh(
          feature,
          side * (roadWidth(feature) / 2 + 4.8),
          8.5,
          0.32,
          this.materials.sidewalk,
        );
        walk.position.y = RENDER_HEIGHTS.sidewalkCenter + 0.03;
        this.designGroup.add(walk);
      }
    }
  }

  private addIntersectionDesign(feature: DistrictFeature, design: FeatureDesign): void {
    const position = geoToWorld(feature.path[0]);
    if (design.crosswalk) this.addCrosswalkToGroup(position.x, position.z, this.designGroup);
    if (design.pedestrianIsland) {
      const island = new THREE.Mesh(
        new THREE.CapsuleGeometry(1.5, 5.5, 4, 10),
        this.materials.sidewalk,
      );
      island.rotation.z = Math.PI / 2;
      island.position.set(position.x, 0.7, position.z);
      this.designGroup.add(island);
    }
  }

  private addCrosswalkToGroup(x: number, z: number, group: THREE.Group): void {
    for (let index = -3; index <= 3; index += 1) {
      const stripe = box(1.35, 0.03, 8, this.materials.whiteLine);
      stripe.position.set(
        x + index * 2.25,
        RENDER_HEIGHTS.selectionSurface + 0.025,
        z,
      );
      group.add(stripe);
    }
  }

  private syncVehicles(vehicles: readonly VehicleSnapshot[]): void {
    while (this.vehiclePool.length < vehicles.length) {
      const object = createCar("#ffffff", "sedan");
      this.vehiclePool.push(object);
      this.trafficGroup.add(object);
    }
    for (let index = 0; index < this.vehiclePool.length; index += 1) {
      const object = this.vehiclePool[index];
      const vehicle = vehicles[index];
      object.visible = vehicle !== undefined;
      if (!vehicle) continue;
      object.position.set(vehicle.x, 0.25, vehicle.z);
      object.rotation.y = vehicle.heading;
      updateCarAppearance(object, vehicle.color, vehicle.kind);
    }
  }

  private syncPedestrians(
    pedestrians: readonly PedestrianSnapshot[],
  ): void {
    while (this.pedestrianPool.length < pedestrians.length) {
      const object = createPerson("#ffffff", 0);
      this.pedestrianPool.push(object);
      this.pedestrianGroup.add(object);
    }
    for (let index = 0; index < this.pedestrianPool.length; index += 1) {
      const object = this.pedestrianPool[index];
      const pedestrian = pedestrians[index];
      object.visible = pedestrian !== undefined;
      if (!pedestrian) continue;
      object.position.set(pedestrian.x, 0.28, pedestrian.z);
      object.rotation.y = pedestrian.heading;
      updatePersonAppearance(object, pedestrian.color, pedestrian.variant);
    }
  }

  private updateSignals(signals: readonly SignalSnapshot[]): void {
    const byIntersection = new Map(
      signals.map((signal) => [signal.intersectionId, signal]),
    );
    for (const assembly of this.signalAssemblies) {
      const signal = byIntersection.get(assembly.intersectionId);
      const phase = signal?.phase ?? "all-red";
      const axisGreen =
        (assembly.axis === "x" && phase === "ew-green") ||
        (assembly.axis === "z" && phase === "ns-green");
      const axisYellow =
        (assembly.axis === "x" && phase === "ew-yellow") ||
        (assembly.axis === "z" && phase === "ns-yellow");
      setSignalLens(assembly.red, !axisGreen && !axisYellow);
      setSignalLens(assembly.yellow, axisYellow);
      setSignalLens(assembly.green, axisGreen);
      setSignalLens(assembly.walk, phase === "pedestrian-walk");
      setSignalLens(assembly.dontWalk, phase !== "pedestrian-walk");
    }
  }

  private buildCollisionIndexes(): void {
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.collidable === true) {
        const collisionBox = new THREE.Box3().setFromObject(object);
        if (!collisionBox.isEmpty()) {
          this.collisionIndex.insert({
            box: collisionBox,
            minX: collisionBox.min.x,
            maxX: collisionBox.max.x,
            minZ: collisionBox.min.z,
            maxZ: collisionBox.max.z,
          });
        }
      }
      if (object.userData.walkable === true) {
        const surfaceBox = new THREE.Box3().setFromObject(object);
        if (!surfaceBox.isEmpty()) {
          this.walkableIndex.insert({
            minX: surfaceBox.min.x,
            maxX: surfaceBox.max.x,
            minZ: surfaceBox.min.z,
            maxZ: surfaceBox.max.z,
            height: surfaceBox.max.y,
          });
        }
      }
    });
  }

  private buildCollisionDebug(): void {
    if (!this.collisionDebugEnabled) return;
    let helperCount = 0;
    for (const volume of this.collisionIndex.getAll()) {
      if (helperCount >= 260) break;
      const center = volume.box.getCenter(new THREE.Vector3());
      if (Math.hypot(center.x, center.z) > 1_150) continue;
      this.collisionDebugGroup.add(
        new THREE.Box3Helper(volume.box, new THREE.Color("#ff704d")),
      );
      helperCount += 1;
    }

    this.collisionDebugPlayer = new THREE.Mesh(
      new THREE.CapsuleGeometry(WALK_COLLIDER_RADIUS, 1.02, 6, 10),
      new THREE.MeshBasicMaterial({
        color: "#54e8bd",
        wireframe: true,
        depthTest: false,
      }),
    );
    this.collisionDebugPlayer.renderOrder = 50;
    this.collisionDebugGroup.add(this.collisionDebugPlayer);

    this.collisionDebugRay = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(0, -2, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: "#f6d260",
        depthTest: false,
      }),
    );
    this.collisionDebugRay.renderOrder = 50;
    this.collisionDebugGroup.add(this.collisionDebugRay);
    this.scene.add(this.collisionDebugGroup);

    this.collisionDebugStatus = document.createElement("output");
    this.collisionDebugStatus.className = "collision-debug-status";
    document.body.append(this.collisionDebugStatus);
  }

  private updateCollisionDebug(): void {
    if (!this.collisionDebugEnabled || !this.collisionDebugPlayer) return;
    const mode = this.cameraMode;
    const centerY =
      mode === "walk"
        ? this.camera.position.y - WALK_EYE_HEIGHT + WALK_PLAYER_HEIGHT / 2
        : this.camera.position.y;
    this.collisionDebugPlayer.position.set(
      this.camera.position.x,
      centerY,
      this.camera.position.z,
    );
    this.collisionDebugPlayer.scale.setScalar(
      mode === "fly" ? FLY_COLLIDER_RADIUS / WALK_COLLIDER_RADIUS : 1,
    );
    const playerMaterial = this.collisionDebugPlayer
      .material as THREE.MeshBasicMaterial;
    playerMaterial.color.set(
      mode === "walk" && this.grounded ? "#54e8bd" : "#66b8ff",
    );

    if (this.collisionDebugRay) {
      this.collisionDebugRay.geometry.setFromPoints([
        this.camera.position.clone(),
        new THREE.Vector3(
          this.camera.position.x,
          this.getWalkableHeight(
            this.camera.position.x,
            this.camera.position.z,
          ),
          this.camera.position.z,
        ),
      ]);
    }
    if (this.collisionDebugStatus) {
      this.collisionDebugStatus.value = [
        `mode: ${mode}`,
        `grounded: ${this.grounded}`,
        `height: ${this.camera.position.y.toFixed(2)} m`,
        `collision boxes: ${this.collisionIndex.size}`,
      ].join(" · ");
    }
  }

  private nearLandmark(x: number, z: number, radius: number): boolean {
    return PENN_LANDMARKS.some((landmark) => {
      const position = geoToWorld(landmark);
      return Math.hypot(position.x - x, position.z - z) < radius;
    });
  }

}

function createWorldMaterials() {
  const brickTexture = createFacadeTexture("#8f5142", "#d69a78", "brick");
  const redBrickTexture = createFacadeTexture("#a45d4c", "#e2b58b", "brick");
  const stoneTexture = createFacadeTexture("#8c7469", "#d5c1a7", "arched");
  const glassTexture = createFacadeTexture("#466a77", "#a9d2d4", "glass");
  const limestoneTexture = createFacadeTexture("#b2aa90", "#eee2c1", "regular");
  const concreteTexture = createFacadeTexture("#8f9894", "#cad4cf", "regular");
  const darkTexture = createFacadeTexture("#555e5c", "#9fb4b4", "glass");
  const material = (texture: THREE.Texture, color = "#ffffff") =>
    new THREE.MeshStandardMaterial({
      map: texture,
      color,
      roughness: 0.72,
      metalness: texture === glassTexture ? 0.2 : 0.03,
    });
  return {
    ground: new THREE.MeshStandardMaterial({ color: "#71866d", roughness: 1 }),
    lawn: new THREE.MeshStandardMaterial({
      color: "#76976c",
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    campusGrass: new THREE.MeshStandardMaterial({
      color: "#87a978",
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    blockPaving: new THREE.MeshStandardMaterial({ color: "#b7b3a3", roughness: 0.96 }),
    asphalt: new THREE.MeshStandardMaterial({ color: "#2c3337", roughness: 0.92 }),
    editedAsphalt: new THREE.MeshStandardMaterial({ color: "#242b2e", roughness: 0.88 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: "#c7c5ba", roughness: 0.94 }),
    yellowLine: new THREE.MeshStandardMaterial({
      color: "#f1ca56",
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    whiteLine: new THREE.MeshStandardMaterial({
      color: "#f1efe8",
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    bikeLane: new THREE.MeshStandardMaterial({
      color: "#2ca79f",
      roughness: 0.84,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    historicBrick: material(brickTexture),
    redBrick: material(redBrickTexture),
    rowhouseRed: material(redBrickTexture, "#c9826f"),
    rowhouseTan: material(brickTexture, "#d3a37d"),
    landmarkStone: material(stoneTexture, "#9e6757"),
    darkStone: material(stoneTexture, "#6d5149"),
    fisherBrick: material(redBrickTexture, "#8e3f36"),
    huntsmanStone: material(limestoneTexture, "#c7b88e"),
    vanPelt: material(stoneTexture, "#8d8171"),
    limestone: material(limestoneTexture),
    museumBrick: material(brickTexture, "#b36f5c"),
    glass: material(glassTexture),
    office: material(darkTexture),
    concrete: material(concreteTexture),
    silver: material(concreteTexture, "#bac5c3"),
    dorm: material(brickTexture, "#9c6f5d"),
    hospital: material(concreteTexture, "#e0e2dd"),
    parking: material(concreteTexture, "#a6aaa3"),
    retail: material(redBrickTexture, "#bc8064"),
    academic: material(stoneTexture, "#a88975"),
    darkBand: new THREE.MeshStandardMaterial({ color: "#465056", roughness: 0.7 }),
    awning: new THREE.MeshStandardMaterial({ color: "#7d2c35", roughness: 0.8 }),
    rooftop: new THREE.MeshStandardMaterial({ color: "#697277", roughness: 0.88 }),
    roofCopper: new THREE.MeshStandardMaterial({ color: "#557a6b", roughness: 0.86 }),
    darkRoof: new THREE.MeshStandardMaterial({ color: "#3f4547", roughness: 0.9 }),
    field: new THREE.MeshStandardMaterial({ color: "#4f8b5c", roughness: 1 }),
    stadiumConcrete: new THREE.MeshStandardMaterial({ color: "#928d83", roughness: 0.95 }),
    trunk: new THREE.MeshStandardMaterial({ color: "#694c36", roughness: 1 }),
    leavesA: new THREE.MeshStandardMaterial({ color: "#3e7950", roughness: 1 }),
    leavesB: new THREE.MeshStandardMaterial({ color: "#527f48", roughness: 1 }),
    leavesC: new THREE.MeshStandardMaterial({ color: "#386b48", roughness: 1 }),
    streetMetal: new THREE.MeshStandardMaterial({ color: "#303a3e", roughness: 0.5, metalness: 0.35 }),
    lamp: new THREE.MeshStandardMaterial({ color: "#f5e3a6", emissive: "#d9aa58", emissiveIntensity: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ color: "#806248", roughness: 0.9 }),
    planter: new THREE.MeshStandardMaterial({ color: "#5d6660", roughness: 0.85 }),
    carGlass: new THREE.MeshStandardMaterial({ color: "#a8c4cc", roughness: 0.25, metalness: 0.08 }),
    signalHousing: new THREE.MeshStandardMaterial({ color: "#172126", roughness: 0.72 }),
  };
}

function createFacadeTexture(
  base: string,
  windowColor: string,
  style: "brick" | "arched" | "glass" | "regular",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable.");
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  if (style === "brick") {
    context.strokeStyle = "rgba(35,22,18,0.16)";
    context.lineWidth = 1;
    for (let y = 0; y < 128; y += 8) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(128, y);
      context.stroke();
    }
  }
  const columns = style === "glass" ? 6 : 5;
  const rows = style === "arched" ? 4 : 5;
  const marginX = 9;
  const marginY = 9;
  const cellWidth = (128 - marginX * 2) / columns;
  const cellHeight = (128 - marginY * 2) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = marginX + column * cellWidth + 2;
      const y = marginY + row * cellHeight + 3;
      context.fillStyle = windowColor;
      if (style === "arched") {
        context.beginPath();
        context.roundRect(x, y, cellWidth - 5, cellHeight - 6, [7, 7, 1, 1]);
        context.fill();
      } else {
        context.fillRect(x, y, cellWidth - 5, cellHeight - 6);
      }
      context.fillStyle = "rgba(255,255,255,0.2)";
      context.fillRect(x + 1, y + 1, 1.5, cellHeight - 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(style === "glass" ? 2 : 1.5, style === "arched" ? 1.4 : 2.2);
  texture.anisotropy = 4;
  return texture;
}

function roadWidth(feature: DistrictFeature): number {
  return feature.name === "Market Street" ||
    feature.name === "South Street" ||
    feature.name === "38th Street" ||
    feature.name === "40th Street"
    ? MAJOR_ROAD_WIDTH
    : ROAD_WIDTH;
}

function geoToWorld(point: Pick<GeoPoint, "longitude" | "latitude">): THREE.Vector3 {
  return new THREE.Vector3(
    (point.longitude - PENN_CENTER.longitude) * METERS_PER_DEGREE_LONGITUDE,
    0,
    -(point.latitude - PENN_CENTER.latitude) * METERS_PER_DEGREE_LATITUDE,
  );
}

function worldToGeo(x: number, z: number): GeoPoint {
  return {
    longitude: PENN_CENTER.longitude + x / METERS_PER_DEGREE_LONGITUDE,
    latitude: PENN_CENTER.latitude - z / METERS_PER_DEGREE_LATITUDE,
  };
}

function createSegmentMesh(
  feature: DistrictFeature,
  width: number,
  height: number,
  material: THREE.Material,
): THREE.Mesh {
  const [start, end] = feature.path.map(geoToWorld);
  const direction = end.clone().sub(start);
  const object = box(direction.length(), height, width, material);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.position.y = height / 2;
  object.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI / 2;
  return object;
}

function createOffsetSegmentMesh(
  feature: DistrictFeature,
  offset: number,
  width: number,
  height: number,
  material: THREE.Material,
): THREE.Mesh {
  const object = createSegmentMesh(feature, width, height, material);
  const [start, end] = feature.path.map(geoToWorld);
  const direction = end.clone().sub(start).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  object.position.addScaledVector(normal, offset);
  return object;
}

function segmentCenter(feature: DistrictFeature): THREE.Vector3 {
  const [start, end = start] = feature.path.map(geoToWorld);
  return start.clone().add(end).multiplyScalar(0.5);
}

function createCar(color: string, kind: VehicleKind): THREE.Group {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.08 });
  const glass = new THREE.MeshStandardMaterial({ color: "#aec8ce", roughness: 0.2, metalness: 0.12 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#171b1d", roughness: 0.94 });
  const body = box(1.9, 0.72, 4.2, paint);
  body.position.y = 0.72;
  const hood = box(1.86, 0.32, 1.25, paint);
  hood.position.set(0, 1.05, 1.35);
  const cabin = box(1.66, 0.68, 1.9, glass);
  cabin.position.set(0, 1.26, -0.2);
  group.add(body, hood, cabin);
  for (const x of [-1.02, 1.02]) {
    for (const z of [-1.25, 1.25]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.55, z);
      group.add(wheel);
    }
  }
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true;
  });
  group.userData.paint = paint;
  updateCarAppearance(group, color, kind);
  return group;
}

function createPerson(color: string, variant: number): THREE.Group {
  const group = new THREE.Group();
  const clothing = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({
    color: ["#d9a477", "#8b5b3f", "#efc6a0", "#70442f"][variant],
    roughness: 0.9,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.72, 4, 8), clothing);
  body.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
  head.position.y = 2.1;
  group.add(body, head);
  group.userData.clothing = clothing;
  group.userData.skin = skin;
  return group;
}

function updateCarAppearance(
  object: THREE.Group,
  color: string,
  kind: VehicleKind,
): void {
  const paint = object.userData.paint as THREE.MeshStandardMaterial | undefined;
  paint?.color.set(color);
  const scale =
    kind === "compact"
      ? [0.92, 0.9, 0.86]
      : kind === "suv"
        ? [1.06, 1.2, 1.12]
        : kind === "van"
          ? [1.08, 1.28, 1.28]
      : kind === "bus"
            ? [1.15, 1.35, 2.2]
            : kind === "truck"
              ? [1.12, 1.35, 1.65]
            : [1, 1, 1];
  object.scale.set(scale[0], scale[1], scale[2]);
}

function updatePersonAppearance(
  object: THREE.Group,
  color: string,
  variant: number,
): void {
  const clothing = object.userData.clothing as
    | THREE.MeshStandardMaterial
    | undefined;
  const skin = object.userData.skin as THREE.MeshStandardMaterial | undefined;
  clothing?.color.set(color);
  skin?.color.set(["#d9a477", "#8b5b3f", "#efc6a0", "#70442f"][variant % 4]);
}

function createSignalLensMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.18),
    emissive: color,
    emissiveIntensity: 0.04,
    roughness: 0.36,
  });
}

function setSignalLens(
  material: THREE.MeshStandardMaterial,
  active: boolean,
): void {
  material.color.copy(material.emissive).multiplyScalar(active ? 0.8 : 0.14);
  material.emissiveIntensity = active ? 3.4 : 0.035;
}

function signalCorner(
  axis: DistrictFeature["axis"],
  sign: 1 | -1,
): { x: number; z: number } {
  if (axis === "x") return { x: sign, z: sign };
  return { x: -sign, z: sign };
}

function signalFacingRotation(
  axis: DistrictFeature["axis"],
  sign: 1 | -1,
): number {
  if (axis === "x") return sign > 0 ? -Math.PI / 2 : Math.PI / 2;
  return sign > 0 ? Math.PI : 0;
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh<THREE.BoxGeometry, THREE.Material> {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

class SpatialHash<T extends SpatialBounds> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly items = new Set<T>();

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.items.size;
  }

  insert(item: T): void {
    this.items.add(item);
    for (const key of this.keysForBounds(
      item.minX,
      item.maxX,
      item.minZ,
      item.maxZ,
    )) {
      const cell = this.cells.get(key) ?? new Set<T>();
      cell.add(item);
      this.cells.set(key, cell);
    }
  }

  query(minX: number, maxX: number, minZ: number, maxZ: number): Set<T> {
    const results = new Set<T>();
    for (const key of this.keysForBounds(minX, maxX, minZ, maxZ)) {
      for (const item of this.cells.get(key) ?? []) results.add(item);
    }
    return results;
  }

  getAll(): ReadonlySet<T> {
    return this.items;
  }

  private keysForBounds(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ): string[] {
    const keys: string[] = [];
    const startX = Math.floor(minX / this.cellSize);
    const endX = Math.floor(maxX / this.cellSize);
    const startZ = Math.floor(minZ / this.cellSize);
    const endZ = Math.floor(maxZ / this.cellSize);
    for (let x = startX; x <= endX; x += 1) {
      for (let z = startZ; z <= endZ; z += 1) keys.push(`${x}:${z}`);
    }
    return keys;
  }
}

function isMovementKey(code: string): boolean {
  return [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyE",
    "KeyQ",
    "ShiftLeft",
    "ShiftRight",
    "Space",
  ].includes(code);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true']",
    ) !== null
  );
}
