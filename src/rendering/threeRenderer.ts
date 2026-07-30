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
import { PENN_BUILDINGS } from "../data/pennBuildings";
import {
  createRoadSegmentModel,
  isDrivableLane,
  ROAD_SEGMENT_BY_ID,
} from "../data/roadLanes";
import type { RoadSegmentModel } from "../data/roadLanes";
import type {
  CameraMode,
  DistrictFeature,
  EnvironmentMode,
  ExpansionRoad,
  ExpansionStreetObject,
  ExpansionStreetObjectKind,
  FeatureDesign,
  GeoPoint,
  MapOverlayMode,
  PedestrianSnapshot,
  PlacedBuilding,
  SceneHoverSelection,
  SignalSnapshot,
  SimulationState,
  VehicleKind,
  VehicleSnapshot,
  WeatherMode,
} from "../models/types";
import {
  ExpansionBuilder,
  ROAD_ASPHALT_COLOR,
  type PlacementResult,
} from "./expansionBuilder";
import { projectPointToRoad } from "../core/expansionLayout";
import type {
  BuildingConnectionKind,
  DetailedBuilding,
  DetailedHousehold,
  DetailedPerson,
  EntityBuildingDefinition,
  EntitySelection,
} from "../models/entityTypes";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const ROAD_WIDTH = 15;
const MAJOR_ROAD_WIDTH = 22;
const SIDEWALK_WIDTH = 6;
const SIDEWALK_INTERSECTION_CLEARANCE = 14;
const WORLD_SIZE = 5_200;
const CAMERA_FAR = 16_000;
const SKY_RADIUS = 5_500;
const ORBIT_MIN_ALTITUDE = Math.ceil(
  Math.max(...PENN_BUILDINGS.map((building) => building.height)) + 36,
);
const ORBIT_MAX_FRAME_SCALE = 1.35;
const RENDER_HEIGHTS = {
  ground: -0.08,
  lawn: 0.02,
  blockCenter: 0.15,
  roadCenter: 0.04,
  roadSurface: 0.08,
  intersectionSurface: 0.105,
  sidewalkCenter: 0.15,
  sidewalkSurface: 0.29,
  roadMarking: 0.14,
  crosswalk: 0.18,
  selectionSurface: 0.155,
} as const;
const ROAD_HEIGHT = RENDER_HEIGHTS.roadSurface;
const FLY_COLLIDER_RADIUS = 0.45;
const WALK_COLLIDER_RADIUS = 0.38;
const WALK_PLAYER_HEIGHT = 1.78;
const WALK_EYE_HEIGHT = 1.68;
const WALK_GRAVITY = 18;
const MAX_COLLISION_STEP = 0.18;
const VEHICLE_INSTANCE_CAPACITY = 700;
const PEDESTRIAN_INSTANCE_CAPACITY = 1_000;

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

interface FlowParticle {
  mesh: THREE.Mesh;
  curve: THREE.QuadraticBezierCurve3;
  offset: number;
  speed: number;
}

interface TreePlacement {
  x: number;
  z: number;
  scale: number;
  type: number;
}

type EnvironmentStatusHandler = (mode: EnvironmentMode, detail: string) => void;
type EntityHoverHandler = (
  selection: SceneHoverSelection | null,
  clientX: number,
  clientY: number,
) => void;

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 4, CAMERA_FAR);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -RENDER_HEIGHTS.ground,
  );
  private readonly cityBounds = districtWorldBounds();
  private readonly atmosphericFog = new THREE.FogExp2("#a9c3c8", 0.000055);
  private readonly collisionClosest = new THREE.Vector3();
  private readonly features = PENN_ROAD_GRAPH;
  private readonly featureMeshes = new Map<string, THREE.Mesh>();
  private readonly selectableRoads: THREE.Mesh[] = [];
  private readonly designGroup = new THREE.Group();
  private readonly analysisGroup = new THREE.Group();
  private readonly trafficFocusGroup = new THREE.Group();
  private readonly entityMarkerGroup = new THREE.Group();
  private readonly personIconGroup = new THREE.Group();
  private readonly entityFlowGroup = new THREE.Group();
  private readonly flowParticles: FlowParticle[] = [];
  private readonly flowUp = new THREE.Vector3(0, 1, 0);
  private readonly flowTangent = new THREE.Vector3();
  private readonly entityHighlightGroup = new THREE.Group();
  private readonly trafficGroup = new THREE.Group();
  private readonly pedestrianGroup = new THREE.Group();
  private readonly vehicleBodies: THREE.InstancedMesh;
  private readonly vehicleCabins: THREE.InstancedMesh;
  private readonly pedestrianBodies: THREE.InstancedMesh;
  private readonly pedestrianHeads: THREE.InstancedMesh;
  private readonly selectableBuildings: THREE.Mesh[] = [];
  private readonly buildingGroups = new Map<string, THREE.Group>();
  private readonly personInstanceIds: string[] = [];
  private readonly vehicleInstancePersonIds: string[] = [];
  private readonly visiblePersonPoints: Array<{ id: string; x: number; z: number }> = [];
  private readonly personIconPool: THREE.Sprite[] = [];
  private readonly favoritePersonIds = new Set<string>();
  private readonly personViolationEventIds = new Map<string, string>();
  private readonly personViolationFlashUntil = new Map<string, number>();
  private readonly personIconMaterials = {
    standard: createPersonIconMaterial("#58d7bd", "#102b2e", false),
    selected: createPersonIconMaterial("#8af5da", "#f5fff9", false),
    favorite: createPersonIconMaterial("#f1c75b", "#30250f", true),
    violation: createPersonIconMaterial("#ff3b30", "#5b0905", false),
  };
  private readonly agentTransform = new THREE.Object3D();
  private readonly agentColor = new THREE.Color();
  private readonly signalAssemblies: SignalAssembly[] = [];
  private treePlacements: TreePlacement[] = [];
  private treeTrunkMesh: THREE.InstancedMesh | null = null;
  private treeCrownMeshes: THREE.InstancedMesh[] = [];
  private expansionRoads: ExpansionRoad[] = [];
  private readonly flyKeys = new Set<string>();
  private readonly flyVelocity = new THREE.Vector3();
  private readonly walkVelocity = new THREE.Vector3();
  private readonly collisionIndex = new SpatialHash<CollisionVolume>(96);
  private readonly walkableIndex = new SpatialHash<WalkableSurface>(96);
  private readonly collisionDebugGroup = new THREE.Group();
  private readonly entityOverlayMaterials = Array.from(
    { length: 11 },
    (_, index) => new THREE.MeshBasicMaterial({
      color: entityScoreColor(index / 10),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private readonly trafficOverlayMaterials = Array.from(
    { length: 11 },
    (_, index) => new THREE.MeshBasicMaterial({
      color: scoreColor(1 - index / 10),
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private readonly trafficFocusMaterials = [
    new THREE.MeshBasicMaterial({ color: "#f15b47", transparent: true, opacity: 0.92, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: "#f59f45", transparent: true, opacity: 0.86, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: "#f2d064", transparent: true, opacity: 0.78, depthWrite: false }),
  ];
  private readonly trafficDebugGroup = new THREE.Group();
  private readonly expansionBuilder: ExpansionBuilder;
  private readonly collisionDebugEnabled = new URLSearchParams(window.location.search).has(
    "collisionDebug",
  );
  private readonly trafficDebugEnabled = new URLSearchParams(window.location.search).has(
    "trafficDebug",
  );
  private selectionHandler: ((feature: DistrictFeature) => void) | null = null;
  private entitySelectionHandler: ((selection: EntitySelection) => void) | null = null;
  private entityHoverHandler: EntityHoverHandler | null = null;
  private selectedFeatureId: string | null = null;
  private selectedEntity: EntitySelection | null = null;
  private demolishedBuildingSignature = "";
  private visibleFlowKinds = new Set<BuildingConnectionKind>([
    "work",
    "visit",
    "delivery",
  ]);
  private mapOverlayMode: MapOverlayMode = "none";
  private highContrast = false;
  private reducedMotion = false;
  private lastState: Readonly<SimulationState> | null = null;
  private overlaySignature = "";
  private flowSignature = "";
  private trafficFocusSignature = "";
  private cameraMode: CameraMode = "orbit";
  private buildMode = true;
  private flySpeedScale = 1.2;
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
  private pendingWalkStart: { x: number; z: number } | null = null;
  private sky: THREE.Mesh | null = null;
  private hemisphereLight: THREE.HemisphereLight | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
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

    this.scene.background = new THREE.Color("#9fc3d3");
    this.scene.fog = this.atmosphericFog;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = false;
    this.controls.panSpeed = 1.1;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = ORBIT_MIN_ALTITUDE;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.expansionBuilder = new ExpansionBuilder(
      this.scene,
      this.camera,
      this.canvas,
      {
        minX: this.cityBounds.min.x,
        maxX: this.cityBounds.max.x,
        minZ: this.cityBounds.min.z,
        maxZ: this.cityBounds.max.z,
      },
      baseRoadGeometries(),
      PENN_BUILDINGS,
    );

    this.scene.add(
      this.designGroup,
      this.analysisGroup,
      this.trafficFocusGroup,
      this.entityMarkerGroup,
      this.personIconGroup,
      this.entityFlowGroup,
      this.entityHighlightGroup,
      this.trafficGroup,
      this.pedestrianGroup,
      this.trafficDebugGroup,
    );
    this.vehicleBodies = createAgentInstances(
      new THREE.BoxGeometry(1.9, 0.72, 4.2),
      new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.08 }),
      VEHICLE_INSTANCE_CAPACITY,
    );
    this.vehicleCabins = createAgentInstances(
      new THREE.BoxGeometry(1.66, 0.68, 1.9),
      new THREE.MeshStandardMaterial({
        color: "#aec8ce",
        roughness: 0.2,
        metalness: 0.12,
      }),
      VEHICLE_INSTANCE_CAPACITY,
    );
    this.pedestrianBodies = createAgentInstances(
      new THREE.CapsuleGeometry(0.28, 0.72, 3, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      PEDESTRIAN_INSTANCE_CAPACITY,
    );
    this.pedestrianHeads = createAgentInstances(
      new THREE.SphereGeometry(0.25, 8, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      PEDESTRIAN_INSTANCE_CAPACITY,
    );
    this.trafficGroup.add(this.vehicleBodies, this.vehicleCabins);
    this.pedestrianGroup.add(this.pedestrianBodies, this.pedestrianHeads);
    this.buildLightingAndSky();
    this.buildGround();
    this.buildRoadsAndSidewalks();
    this.buildTrafficDebug();
    this.buildDistrictArchitecture();
    this.buildLandmarks();
    this.expansionBuilder.setExistingBuildingMeshes(this.selectableBuildings);
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

  getBuildingDefinitions(): readonly EntityBuildingDefinition[] {
    return PENN_BUILDINGS;
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
    if (this.cameraMode === "orbit") {
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(target.x, altitude, target.z + 0.01);
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(target.x + altitude * 0.7, altitude, target.z + altitude * 0.9);
    }
    this.controls.target.set(target.x, 8, target.z);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  focusBuilding(
    building: Pick<DetailedBuilding, "x" | "z" | "height">,
  ): void {
    const altitude = THREE.MathUtils.clamp(200 + building.height * 1.4, 250, 350);
    this.flyTo(worldToGeo(building.x, building.z), altitude);
  }

  focusPerson(personId: string): boolean {
    const point = this.visiblePersonPoints.find((candidate) => candidate.id === personId);
    if (!point) return false;
    this.flyTo(worldToGeo(point.x, point.z), 145);
    return true;
  }

  focusExpansionRoad(
    road: Pick<ExpansionRoad, "startX" | "startZ" | "endX" | "endZ">,
  ): void {
    this.flyTo(worldToGeo(
      (road.startX + road.endX) / 2,
      (road.startZ + road.endZ) / 2,
    ), 185);
  }

  setSelectionHandler(handler: (feature: DistrictFeature) => void): void {
    this.selectionHandler = handler;
  }

  setEntitySelectionHandler(handler: (selection: EntitySelection) => void): void {
    this.entitySelectionHandler = handler;
  }

  setEntityHoverHandler(handler: EntityHoverHandler): void {
    this.entityHoverHandler = handler;
  }

  setEnvironmentStatusHandler(handler: EnvironmentStatusHandler): void {
    handler("rendered", "Standalone Three.js urban district");
  }

  setExpansionRoadSelectionHandler(handler: (id: string | null) => void): void {
    this.expansionBuilder.setHandlers({ selectRoad: handler });
  }

  setBuildingInteractionHandlers(handlers: {
    place?: (x: number, z: number) => void;
    select?: (id: string | null) => void;
    move?: (
      id: string,
      x: number,
      z: number,
      rotation: number,
      finished: boolean,
    ) => void;
  }): void {
    this.expansionBuilder.setHandlers({
      placeBuilding: handlers.place,
      selectBuilding: handlers.select,
      moveBuilding: handlers.move,
    });
  }

  setExpansionRoadInteractionHandlers(handlers: {
    create?: (road: Omit<ExpansionRoad, "id">) => void;
    select?: (id: string | null) => void;
  }): void {
    this.expansionBuilder.setHandlers({
      createRoad: handlers.create,
      selectRoad: handlers.select,
    });
  }

  setExpansionStreetObjectInteractionHandlers(handlers: {
    place?: (object: Omit<ExpansionStreetObject, "id">) => void;
  }): void {
    this.expansionBuilder.setHandlers({
      placeStreetObject: handlers.place,
    });
  }

  setExpansionEraseInteractionHandlers(
    handler: (
      target: "road" | "street-object" | "building" | "existing-building",
      id: string,
    ) => void,
  ): void {
    this.expansionBuilder.setHandlers({ erase: handler });
  }

  setExpansionStatusHandler(
    handler: (
      message: string,
      tone?: "info" | "success" | "warning" | "error",
    ) => void,
  ): void {
    this.expansionBuilder.setHandlers({ status: handler });
  }

  setExpansionMode(enabled: boolean): void {
    this.expansionBuilder.setEnabled(enabled);
    if (!enabled && this.cameraMode === "orbit") {
      this.controls.enabled = true;
      this.canvas.style.cursor = "grab";
    }
  }

  setExpansionSelectionEnabled(enabled: boolean): void {
    this.expansionBuilder.setSelectionEnabled(enabled);
  }

  setExpansionRoadDrawEnabled(enabled: boolean): void {
    this.expansionBuilder.setRoadDrawEnabled(enabled);
  }

  setExpansionStreetObjectPlacementTool(
    kind: ExpansionStreetObjectKind | null,
  ): void {
    this.expansionBuilder.setStreetObjectTool(kind);
  }

  setBuildingPlacementEnabled(enabled: boolean): void {
    this.expansionBuilder.setBuildingPlacementEnabled(enabled);
  }

  setExpansionEraseEnabled(enabled: boolean): void {
    this.expansionBuilder.setEraseEnabled(enabled);
  }

  setExpansionRoadEraseEnabled(enabled: boolean): void {
    this.expansionBuilder.setRoadEraseEnabled(enabled);
  }

  setPedestrianMarkersVisible(visible: boolean): void {
    this.pedestrianGroup.visible = visible;
  }

  setVehicleMarkersVisible(visible: boolean): void {
    this.trafficGroup.visible = visible;
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    this.expansionBuilder.setBuildings(buildings);
  }

  setDemolishedBuildings(ids: readonly string[]): void {
    const signature = [...ids].sort().join("|");
    if (signature === this.demolishedBuildingSignature) return;
    this.demolishedBuildingSignature = signature;
    const demolished = new Set(ids);
    for (const [id, group] of this.buildingGroups) {
      const visible = !demolished.has(id);
      group.visible = visible;
      group.traverse((object) => {
        object.visible = visible;
      });
    }
    for (const marker of this.entityMarkerGroup.children) {
      const id = marker.userData.entityId;
      if (typeof id === "string") marker.visible = !demolished.has(id);
    }
    this.expansionBuilder.setDemolishedBuildings(ids);
    this.collisionIndex.clear();
    this.walkableIndex.clear();
    this.buildCollisionIndexes();
  }

  setExpansionRoads(roads: readonly ExpansionRoad[]): void {
    this.expansionRoads = roads.map((road) => ({ ...road }));
    this.expansionBuilder.setRoads(roads);
    this.updateExpansionTreeVisibility();
  }

  matchExpansionRoadWidths(
    roads: readonly ExpansionRoad[],
  ): ExpansionRoad[] {
    return this.expansionBuilder.matchRoadWidths(roads);
  }

  setSelectedExpansionRoad(id: string | null): void {
    this.expansionBuilder.setSelectedRoad(id);
  }

  setExpansionStreetObjects(objects: readonly ExpansionStreetObject[]): void {
    this.expansionBuilder.setStreetObjects(objects);
  }

  resolveExpansionStreetObjectPlacement(
    x: number,
    z: number,
    kind: ExpansionStreetObjectKind,
  ): Omit<ExpansionStreetObject, "id"> | null {
    return this.expansionBuilder.resolveStreetObjectPlacement(x, z, kind);
  }

  resolveAutomaticExpansionStreetObjects(
    roadId: string,
  ): Array<Omit<ExpansionStreetObject, "id">> {
    return this.expansionBuilder.resolveAutomaticStreetObjects(roadId);
  }

  isExpansionCrosswalkSupported(x: number, z: number): boolean {
    return this.expansionBuilder.isCrosswalkSupported(x, z);
  }

  validateExpansionRoad(
    road: Readonly<Omit<ExpansionRoad, "id">>,
  ): PlacementResult {
    return this.expansionBuilder.validateRoad(road);
  }

  suggestMunicipalExpansionRoad(
    sequence: number,
  ): Omit<ExpansionRoad, "id"> | null {
    return this.expansionBuilder.suggestGrowthRoad(sequence);
  }

  validateExpansionRoadRemoval(id: string): PlacementResult {
    return this.expansionBuilder.validateRoadRemoval(id);
  }

  validateBuildingPlacement(
    building: Readonly<PlacedBuilding>,
  ): PlacementResult {
    return this.expansionBuilder.validateBuildingPlacement(building);
  }

  resolveExpansionBuildingPlacement(
    building: Readonly<PlacedBuilding>,
  ): PlacedBuilding | null {
    return this.expansionBuilder.resolveBuildingPlacement(building);
  }

  setSelectedPlacedBuilding(id: string | null): void {
    this.expansionBuilder.setSelectedBuilding(id);
  }

  setTimeOfDay(hours: number): void {
    const normalized = ((hours % 24) + 24) % 24;
    const daylight = THREE.MathUtils.clamp(
      Math.sin(((normalized - 6) / 12) * Math.PI),
      0.08,
      1,
    );
    if (this.sunLight) {
      this.sunLight.intensity = 0.55 + daylight * 4.25;
      const angle = ((normalized - 6) / 12) * Math.PI;
      this.sunLight.position.set(
        Math.cos(angle) * 1_050,
        180 + Math.sin(angle) * 900,
        470,
      );
    }
    if (this.hemisphereLight) {
      this.hemisphereLight.intensity = 0.65 + daylight * 1.7;
    }
    const night = new THREE.Color("#172b43");
    const day = new THREE.Color("#9fc3d3");
    this.scene.background = night.clone().lerp(day, daylight);
  }

  setWeather(weather: WeatherMode): void {
    if (weather === "fog") {
      this.atmosphericFog.color.set("#aebbb7");
      this.atmosphericFog.density = 0.00042;
      this.renderer.toneMappingExposure = 0.86;
    } else if (weather === "rain") {
      this.atmosphericFog.color.set("#788f99");
      this.atmosphericFog.density = 0.0002;
      this.renderer.toneMappingExposure = 0.8;
    } else {
      this.atmosphericFog.color.set("#a9c3c8");
      this.atmosphericFog.density =
        this.cameraMode === "walk" ? 0.00028 : this.cameraMode === "fly" ? 0.00012 : 0.000055;
      this.renderer.toneMappingExposure = 1.08;
    }
  }

  setBuildMode(enabled: boolean): void {
    this.buildMode = enabled;
    this.entityMarkerGroup.visible = !enabled;
    this.entityFlowGroup.visible = !enabled;
    this.entityHighlightGroup.visible = true;
    this.updatePersonIconGroupVisibility();
    this.updateFeatureHighlights();
  }

  setFavoritePeople(personIds: readonly string[]): void {
    this.favoritePersonIds.clear();
    for (const personId of personIds) this.favoritePersonIds.add(personId);
  }

  setCameraMode(mode: CameraMode): void {
    const previousMode = this.cameraMode;
    this.cameraMode = mode;
    this.flyKeys.clear();
    this.flyVelocity.set(0, 0, 0);
    this.walkVelocity.set(0, 0, 0);
    this.looking = false;
    this.controls.enabled = mode === "orbit";
    this.updatePersonIconGroupVisibility();
    this.canvas.style.cursor = mode === "orbit" ? "grab" : "crosshair";
    if (previousMode === "walk" && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (mode === "orbit") {
      this.atmosphericFog.density = 0.000055;
      this.frameOrbitView();
    } else {
      this.camera.up.set(0, 1, 0);
      this.atmosphericFog.density = mode === "walk" ? 0.00028 : 0.00012;
      if (mode === "fly" && previousMode === "orbit") this.frameFlyView();
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      const horizontalDirection = Math.hypot(direction.x, direction.z);
      this.flyYaw = horizontalDirection < 0.05
        ? 0
        : Math.atan2(-direction.x, -direction.z);
      this.flyPitch = horizontalDirection < 0.05
        ? mode === "walk" ? -0.08 : -0.58
        : Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      if (mode === "walk") this.enterWalkMode();
      this.applyFlyRotation();
    }
    this.updateCameraDepthRange();
  }

  setWalkStartFromScreen(clientX: number, clientY: number): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    this.setPointerFromClient(clientX, clientY, bounds);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return false;
    if (Math.abs(point.x) > WORLD_SIZE / 2 || Math.abs(point.z) > WORLD_SIZE / 2) {
      return false;
    }
    this.pendingWalkStart = { x: point.x, z: point.z };
    return true;
  }

  setSelectedFeature(featureId: string | null): void {
    this.selectedFeatureId = featureId;
    this.updateFeatureHighlights();
  }

  setSelectedEntity(selection: EntitySelection | null): void {
    this.selectedEntity = selection;
    this.flowSignature = "";
    this.rebuildEntitySelection();
  }

  setTrafficFocusSegments(segmentIds: readonly string[]): void {
    this.expansionBuilder.setHighlightedRoads(segmentIds);
    const signature = segmentIds.join(":");
    if (signature === this.trafficFocusSignature) return;
    this.trafficFocusSignature = signature;
    clearGroup(this.trafficFocusGroup);
    for (const [index, segmentId] of segmentIds.slice(0, 8).entries()) {
      const feature = this.features.find(
        (candidate) => candidate.id === segmentId && candidate.kind === "street",
      );
      if (!feature) continue;
      const material = this.trafficFocusMaterials[Math.min(index, 2)];
      const ribbon = createSegmentMesh(feature, roadWidth(feature) * 0.42, 0.26, material);
      ribbon.position.y = RENDER_HEIGHTS.selectionSurface + 0.2;
      ribbon.renderOrder = 7;
      this.trafficFocusGroup.add(ribbon);
    }
  }

  setVisibleFlowKinds(kinds: ReadonlySet<BuildingConnectionKind>): void {
    this.visibleFlowKinds = new Set(kinds);
    this.flowSignature = "";
    this.rebuildEntitySelection();
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
    this.mapOverlayMode = mode;
    this.overlaySignature = "";
    this.rebuildMapOverlay(this.lastState);
  }

  setHighContrast(enabled: boolean): void {
    if (this.highContrast === enabled) return;
    this.highContrast = enabled;
    this.entityOverlayMaterials.forEach((material, index) => {
      material.color.copy(entityScoreColor(index / 10, enabled));
    });
    this.trafficOverlayMaterials.forEach((material, index) => {
      material.color.copy(scoreColor(1 - index / 10, enabled));
    });
    const focusColors = enabled
      ? ["#d55e00", "#e69f00", "#f0e442"]
      : ["#f15b47", "#f59f45", "#f2d064"];
    this.trafficFocusMaterials.forEach((material, index) => material.color.set(focusColors[index]!));
    this.overlaySignature = "";
    this.flowSignature = "";
    this.rebuildMapOverlay(this.lastState);
    this.rebuildEntitySelection();
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  private rebuildMapOverlay(state: Readonly<SimulationState> | null): void {
    clearGroup(this.analysisGroup);
    const mode = this.mapOverlayMode;
    if (mode === "none") return;
    if (isEntityOverlay(mode)) {
      if (!state) return;
      this.addEntityOverlay(
        mode,
        state.entities.buildings,
        state.entities.people,
        state.entities.households,
      );
      return;
    }
    if (mode === "congestion") {
      if (!state) return;
      const trafficBySegment = new Map(
        state.roadTraffic.map((traffic) => [traffic.segmentId, traffic]),
      );
      for (const feature of this.features.filter((candidate) => candidate.kind === "street")) {
        const traffic = trafficBySegment.get(feature.id);
        const score = traffic?.congestionPercent ?? 0;
        const material = this.trafficOverlayMaterials[Math.round(score / 10)];
        this.analysisGroup.add(
          createSegmentMesh(feature, ROAD_WIDTH * 0.78, 0.32, material),
        );
      }
    }
  }

  private addEntityOverlay(
    mode: MapOverlayMode,
    buildings: readonly DetailedBuilding[],
    people: readonly DetailedPerson[],
    households: readonly DetailedHousehold[],
  ): void {
    const peopleByHome = new Map<string, DetailedPerson[]>();
    for (const person of people) {
      const residents = peopleByHome.get(person.homeBuildingId) ?? [];
      residents.push(person);
      peopleByHome.set(person.homeBuildingId, residents);
    }
    const householdsByHome = new Map<string, DetailedHousehold[]>();
    for (const household of households) {
      const residents = householdsByHome.get(household.homeBuildingId) ?? [];
      residents.push(household);
      householdsByHome.set(household.homeBuildingId, residents);
    }
    for (const building of buildings) {
      const residents = peopleByHome.get(building.id) ?? [];
      if (!entityOverlayApplies(mode, building, residents)) continue;
      const value = entityOverlayScore(
        mode,
        building,
        residents,
        householdsByHome.get(building.id) ?? [],
      );
      const material = this.entityOverlayMaterials[Math.round(value * 10)];
      const shell = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(5, building.width + 1.4),
          Math.max(5, building.height + 1.4),
          Math.max(5, building.depth + 1.4),
        ),
        material,
      );
      shell.position.set(building.x, building.height / 2 + 0.3, building.z);
      shell.renderOrder = 3;
      this.analysisGroup.add(shell);
      const marker = new THREE.Mesh(entityOverlayMarkerGeometry(mode), material);
      marker.position.set(building.x, building.height + 5, building.z);
      if (mode === "affordability") marker.rotation.x = Math.PI / 2;
      marker.renderOrder = 4;
      this.analysisGroup.add(marker);
    }
  }

  private rebuildEntitySelection(): void {
    this.flowParticles.length = 0;
    clearGroup(this.entityFlowGroup);
    clearGroup(this.entityHighlightGroup);
    if (!this.selectedEntity || !this.lastState) return;
    const state = this.lastState.entities;
    const selectedPerson = this.selectedEntity.kind === "person"
      ? state.people.find((person) => person.id === this.selectedEntity?.id)
      : undefined;
    const selectedBuildingId = this.selectedEntity.kind === "building"
      ? this.selectedEntity.id
      : selectedPerson?.mobility.phase === "inside"
        ? selectedPerson.currentBuildingId
        : undefined;
    const selectedBuilding = state.buildings.find(
      (building) => building.id === selectedBuildingId,
    );
    for (const child of this.entityMarkerGroup.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const material = child.material as THREE.MeshBasicMaterial;
      material.opacity = selectedBuilding
        ? child.userData.entityId === selectedBuilding.id ? 0.95 : 0.05
        : 0.72;
    }
    if (selectedPerson && selectedPerson.mobility.phase !== "inside") {
      const personHighlight = new THREE.Mesh(
        new THREE.RingGeometry(1.8, 2.8, 28),
        new THREE.MeshBasicMaterial({
          color: "#8af5da",
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      personHighlight.rotation.x = -Math.PI / 2;
      personHighlight.position.set(
        selectedPerson.mobility.x,
        0.35,
        selectedPerson.mobility.z,
      );
      this.entityHighlightGroup.add(personHighlight);
    }
    if (selectedBuilding) {
      const highlight = new THREE.Mesh(
        new THREE.RingGeometry(8, 11, 32),
        new THREE.MeshBasicMaterial({
          color: "#fff1a8",
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      highlight.rotation.x = -Math.PI / 2;
      highlight.position.set(
        selectedBuilding.x,
        selectedBuilding.height + 3,
        selectedBuilding.z,
      );
      this.entityHighlightGroup.add(highlight);
      const outline = new THREE.Mesh(
        new THREE.BoxGeometry(
          selectedBuilding.width + 3,
          selectedBuilding.height + 3,
          selectedBuilding.depth + 3,
        ),
        new THREE.MeshBasicMaterial({
          color: "#fff1a8",
          wireframe: true,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      outline.position.set(selectedBuilding.x, selectedBuilding.height / 2, selectedBuilding.z);
      outline.renderOrder = 7;
      this.entityHighlightGroup.add(outline);
    }

    const connections = state.connections
      .filter((connection) => this.visibleFlowKinds.has(connection.kind))
      .filter((connection) => {
        if (this.selectedEntity?.kind === "person") {
          return connection.personIds.includes(this.selectedEntity.id);
        }
        return connection.fromBuildingId === this.selectedEntity?.id
          || connection.toBuildingId === this.selectedEntity?.id;
      })
      .slice(0, 10);
    const buildingById = new Map(state.buildings.map((building) => [building.id, building]));
    for (const connection of connections) {
      const from = flowPoint(connection.fromBuildingId, buildingById, connection.toBuildingId, true);
      const to = flowPoint(connection.toBuildingId, buildingById, connection.fromBuildingId, false);
      this.addFlowArrow(from, to, connection.kind, connection.volume);
    }
  }

  private addFlowArrow(
    from: THREE.Vector3,
    to: THREE.Vector3,
    kind: BuildingConnectionKind,
    volume: number,
  ): void {
    const color = flowColor(kind, this.highContrast);
    const middle = from.clone().lerp(to, 0.5);
    middle.y += Math.min(80, 24 + from.distanceTo(to) * 0.11);
    const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
    const points = curve.getPoints(28);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color,
        dashSize: 12,
        gapSize: 7,
        linewidth: 2,
        transparent: true,
        opacity: 1,
        depthTest: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 6;
    this.entityFlowGroup.add(line);
    const ribbonRadius = clamp(2.4 + Math.log2(volume + 1) * 0.3, 3.1, 5.6);
    const outline = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, ribbonRadius + 1.5, 8, false),
      new THREE.MeshBasicMaterial({
        color: "#071417",
        depthTest: false,
        transparent: true,
        opacity: 0.58,
      }),
    );
    outline.renderOrder = 4;
    this.entityFlowGroup.add(outline);
    const ribbon = new THREE.Mesh(
      new THREE.TubeGeometry(
        curve,
        24,
        ribbonRadius,
        8,
        false,
      ),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    ribbon.renderOrder = 5;
    this.entityFlowGroup.add(ribbon);
    const particleSize = clamp(10 + Math.log2(volume + 1) * 1.1, 12, 20);
    const particleGeometry = kind === "delivery"
      ? new THREE.BoxGeometry(particleSize, particleSize * 0.75, particleSize * 1.25)
      : kind === "visit"
        ? new THREE.SphereGeometry(particleSize * 0.58, 10, 8)
        : new THREE.ConeGeometry(particleSize * 0.48, particleSize * 1.35, 10);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.42),
      depthTest: false,
      transparent: true,
      opacity: 0.98,
    });
    for (let index = 0; index < 3; index += 1) {
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);
      particle.renderOrder = 6;
      this.entityFlowGroup.add(particle);
      this.flowParticles.push({
        mesh: particle,
        curve,
        offset: index / 3,
        speed: kind === "delivery" ? 0.13 : 0.2,
      });
    }

    const previous = points.at(-2) ?? from;
    const direction = to.clone().sub(previous).normalize();
    const size = clamp(13 + Math.log2(volume + 1) * 1.2, 15, 24);
    const arrowhead = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.6, size * 1.6, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false }),
    );
    arrowhead.position.copy(to).addScaledVector(direction, -size * 0.65);
    arrowhead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    arrowhead.renderOrder = 6;
    this.entityFlowGroup.add(arrowhead);
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.camera.aspect = bounds.width / Math.max(bounds.height, 1);
    this.camera.updateProjectionMatrix();
    this.updateOrbitDistanceLimits();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  render(state: Readonly<SimulationState>): void {
    this.lastState = state;
    const now = performance.now();
    const frameSeconds = Math.min((now - this.lastFrameTimestamp) / 1000, 0.1);
    this.lastFrameTimestamp = now;
    if (this.cameraMode === "fly") this.updateFlyCamera(frameSeconds);
    if (this.cameraMode === "walk") this.updateWalkCamera(frameSeconds);
    if (this.cameraMode === "orbit") this.controls.update();
    this.updateCameraDepthRange();
    this.sky?.position.copy(this.camera.position);

    this.syncVehicles(state.vehicles, now);
    this.syncPedestrians(state.pedestrians, now);
    this.syncVisiblePeople(state.vehicles, state.pedestrians, now);
    this.updateSignals(state.signals);
    this.expansionBuilder.setRoadAnalysis(this.mapOverlayMode, state.roadTraffic);
    const signature = overlayStateSignature(this.mapOverlayMode, state);
    if (signature !== this.overlaySignature) {
      this.overlaySignature = signature;
      this.rebuildMapOverlay(state);
    }
    const selectedPerson = this.selectedEntity?.kind === "person"
      ? state.entities.people.find((person) => person.id === this.selectedEntity?.id)
      : undefined;
    const mobilitySignature = selectedPerson
      ? `${selectedPerson.mobility.phase}:${selectedPerson.mobility.segmentId ?? "none"}:${Math.round(selectedPerson.mobility.routeProgress * 40)}`
      : "static";
    const flowSignature = `${this.selectedEntity?.kind ?? "none"}:${this.selectedEntity?.id ?? "none"}:${state.entities.lastUpdatedDay}:${mobilitySignature}:${[...this.visibleFlowKinds].join(",")}`;
    if (flowSignature !== this.flowSignature) {
      this.flowSignature = flowSignature;
      this.rebuildEntitySelection();
    }
    this.updateFlowAnimation(now / 1_000);

    this.updateCollisionDebug();
    this.renderer.render(this.scene, this.camera);
  }

  private updateFlowAnimation(elapsedSeconds: number): void {
    for (const particle of this.flowParticles) {
      const progress = this.reducedMotion
        ? particle.offset
        : (elapsedSeconds * particle.speed + particle.offset) % 1;
      particle.curve.getPoint(progress, particle.mesh.position);
      particle.curve.getTangent(progress, this.flowTangent).normalize();
      particle.mesh.quaternion.setFromUnitVectors(this.flowUp, this.flowTangent);
    }
  }

  private buildLightingAndSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color("#5f91b5") },
          bottomColor: { value: new THREE.Color("#d8ddd0") },
        },
        vertexShader:
          "varying vec3 vSkyDirection; void main(){ vSkyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vSkyDirection; void main(){ float h=normalize(vSkyDirection).y; float f=pow(max(h,0.0),0.55); gl_FragColor=vec4(mix(bottomColor,topColor,f),1.0); }",
      }),
    );
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);

    const hemisphere = new THREE.HemisphereLight("#dff3ff", "#536044", 2.35);
    this.hemisphereLight = hemisphere;
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight("#fff3d6", 4.8);
    this.sunLight = sun;
    sun.position.set(-620, 1_050, 470);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -3_000;
    sun.shadow.camera.right = 3_000;
    sun.shadow.camera.top = 3_000;
    sun.shadow.camera.bottom = -3_000;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 6_500;
    sun.shadow.bias = -0.0002;
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
    ground.frustumCulled = false;
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
      lawn.position.set(x, RENDER_HEIGHTS.lawn, z);
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
          Math.max(1, length - SIDEWALK_INTERSECTION_CLEARANCE * 2),
          0.28,
          SIDEWALK_WIDTH,
          this.materials.sidewalk,
        );
        sidewalk.position.copy(center).addScaledVector(normal, sidewalkOffset * side);
        sidewalk.position.y = RENDER_HEIGHTS.sidewalkCenter;
        sidewalk.rotation.y = angle - Math.PI / 2;
        sidewalk.receiveShadow = true;
        sidewalk.userData.walkable = true;
        this.scene.add(sidewalk);
      }

      const roadModel = ROAD_SEGMENT_BY_ID.get(feature.id);
      if (roadModel) {
        this.addRoadLaneMarkings(
          feature,
          roadModel,
          this.scene,
          RENDER_HEIGHTS.roadMarking,
        );
      }
    }

    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "intersection",
    )) {
      const position = geoToWorld(feature.path[0]);
      const intersection = box(
        MAJOR_ROAD_WIDTH + 0.8,
        0.05,
        MAJOR_ROAD_WIDTH + 0.8,
        this.materials.asphalt,
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

      }
    }
    for (const building of PENN_BUILDINGS.filter((candidate) => candidate.source === "block")) {
      this.addArchetypeBuilding(building);
    }
    this.addDistantSkyline(seededRandom(20260727));
  }

  private addArchetypeBuilding(
    definition: EntityBuildingDefinition,
  ): void {
    const {
      archetype,
      x,
      z,
      width,
      depth,
    } = definition;
    const rng = seededRandom(definition.visualSeed);
    const group = new THREE.Group();
    group.position.set(x, 0.26, z);
    group.rotation.y = definition.rotation;
    const baseHeight = archetype === 5 ? definition.height / 1.45 : definition.height;

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
    this.registerEntityGroup(group, definition);
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
    const roofHeight = THREE.MathUtils.clamp(Math.min(width, depth) * 0.18, 2.8, 8);
    const roof = new THREE.Mesh(
      createGabledRoofGeometry(width, depth, roofHeight),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    roof.position.set(x, y, z);
    roof.castShadow = true;
    roof.receiveShadow = true;
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
      const definition = PENN_BUILDINGS.find(
        (candidate) => candidate.landmarkKind === landmark.kind,
      );
      if (!definition) continue;
      const group = new THREE.Group();
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
      fitObjectToFootprint(group, definition.width, definition.depth);
      group.position.set(definition.x, 0.3, definition.z);
      this.registerEntityGroup(group, definition);
      this.scene.add(group);
    }
  }

  private registerEntityGroup(
    group: THREE.Group,
    definition: EntityBuildingDefinition,
  ): void {
    group.userData.entityKind = "building";
    group.userData.entityId = definition.id;
    this.buildingGroups.set(definition.id, group);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.userData.entityKind = "building";
      child.userData.entityId = definition.id;
      this.selectableBuildings.push(child);
    });

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 5.2, 20),
      new THREE.MeshBasicMaterial({
        color: buildingFunctionColor(definition.function),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(definition.x, definition.height + 2.4, definition.z);
    marker.userData.entityId = definition.id;
    this.entityMarkerGroup.add(marker);
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
    positions: TreePlacement[],
  ): void {
    this.treePlacements = positions.map((position) => ({ ...position }));
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
    this.treeTrunkMesh = trunkMesh;
    this.treeCrownMeshes = crownMeshes;
    this.updateExpansionTreeVisibility();
  }

  private updateExpansionTreeVisibility(): void {
    if (!this.treeTrunkMesh || this.treeCrownMeshes.length === 0) return;
    const crownCounts = [0, 0, 0];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    this.treePlacements.forEach((tree, index) => {
      const blocked = this.expansionRoads.some((road) => {
        const sidewalkWidth = road.widenedSidewalk ? 5.5 : 3.5;
        return projectPointToRoad(road, tree.x, tree.z).distance
          <= road.width / 2 + sidewalkWidth + 1.5;
      });
      const visibleScale = blocked ? 0 : tree.scale;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.71);
      scale.set(visibleScale, visibleScale, visibleScale);
      position.set(tree.x, 2.8 * tree.scale, tree.z);
      matrix.compose(position, quaternion, scale);
      this.treeTrunkMesh!.setMatrixAt(index, matrix);

      const crownIndex = crownCounts[tree.type]++;
      position.y = tree.type === 2 ? 7.2 * tree.scale : 6.3 * tree.scale;
      matrix.compose(position, quaternion, scale);
      this.treeCrownMeshes[tree.type].setMatrixAt(crownIndex, matrix);
    });
    this.treeTrunkMesh.instanceMatrix.needsUpdate = true;
    for (const crown of this.treeCrownMeshes) {
      crown.instanceMatrix.needsUpdate = true;
    }
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

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerDown.set(event.clientX, event.clientY);
      if (
        this.cameraMode === "orbit" &&
        this.expansionBuilder.pointerDown(event.clientX, event.clientY)
      ) {
        this.controls.enabled = false;
        return;
      }
      if (this.cameraMode === "walk") {
        if (document.pointerLockElement === this.canvas) {
          const bounds = this.canvas.getBoundingClientRect();
          this.pickFeature(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        } else {
          this.pickFeature(event.clientX, event.clientY);
          void this.canvas.requestPointerLock();
        }
        return;
      }
      if (this.cameraMode !== "fly") return;
      this.looking = true;
      this.lastPointer.set(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (
        this.cameraMode === "orbit" &&
        this.expansionBuilder.pointerMove(event.clientX, event.clientY)
      ) {
        this.canvas.style.cursor = "grabbing";
        return;
      }
      if (!this.looking && document.pointerLockElement !== this.canvas && event.buttons === 0) {
        if (this.cameraMode === "orbit" && this.expansionBuilder.isEditing) {
          this.entityHoverHandler?.(null, 0, 0);
          this.canvas.style.cursor = "crosshair";
          return;
        }
        const selection = this.pickEntityAt(event.clientX, event.clientY)
          ?? this.pickRoadAt(event.clientX, event.clientY);
        this.entityHoverHandler?.(selection, event.clientX, event.clientY);
        this.canvas.style.cursor = selection
          ? "pointer"
          : this.cameraMode === "orbit" ? "grab" : "crosshair";
        if (this.cameraMode === "orbit") return;
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
    this.canvas.addEventListener("pointerleave", () => {
      this.entityHoverHandler?.(null, 0, 0);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      const clicked = Math.hypot(
        event.clientX - this.pointerDown.x,
        event.clientY - this.pointerDown.y,
      ) < 5;
      if (
        this.cameraMode === "orbit" &&
        this.expansionBuilder.pointerUp(event.clientX, event.clientY, clicked)
      ) {
        this.controls.enabled = true;
        this.canvas.style.cursor = "pointer";
        return;
      }
      if (this.cameraMode === "fly") {
        this.looking = false;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        if (clicked) this.pickFeature(event.clientX, event.clientY);
        return;
      }
      if (this.cameraMode === "walk") return;
      if (clicked) this.pickFeature(event.clientX, event.clientY);
    });
    const releaseInterruptedEdit = (event: PointerEvent) => {
      if (this.cameraMode !== "orbit" || this.controls.enabled) return;
      this.expansionBuilder.pointerUp(event.clientX, event.clientY, false);
      this.controls.enabled = true;
      this.canvas.style.cursor = "grab";
    };
    window.addEventListener("pointerup", releaseInterruptedEdit);
    window.addEventListener("pointercancel", releaseInterruptedEdit);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (this.cameraMode !== "fly") return;
        event.preventDefault();
        this.flySpeedScale = THREE.MathUtils.clamp(
          this.flySpeedScale * (event.deltaY > 0 ? 0.84 : 1.18),
          0.35,
          4.5,
        );
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.expansionBuilder.cancelPendingRoad();
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

  private pickFeature(clientX: number, clientY: number): void {
    if (this.expansionBuilder.selectAt(clientX, clientY)) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (this.buildMode && this.cameraMode === "orbit") {
      const road = this.pickRoadAt(clientX, clientY, bounds);
      const feature = road
        ? this.features.find((candidate) => candidate.id === road.id)
        : undefined;
      if (feature) this.selectionHandler?.(feature);
      return;
    }
    const selection = this.pickEntityAt(clientX, clientY, bounds);
    if (selection) {
      this.entitySelectionHandler?.(selection);
      return;
    }
    if (this.cameraMode !== "orbit") return;
    const road = this.pickRoadAt(clientX, clientY, bounds);
    const feature = road
      ? this.features.find((candidate) => candidate.id === road.id)
      : undefined;
    if (feature) this.selectionHandler?.(feature);
  }

  private pickRoadAt(
    clientX: number,
    clientY: number,
    bounds = this.canvas.getBoundingClientRect(),
  ): Extract<SceneHoverSelection, { kind: "road" }> | null {
    this.setPointerFromClient(clientX, clientY, bounds);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.selectableRoads, false)[0];
    const featureId = hit?.object.userData.featureId as string | undefined;
    return featureId ? { kind: "road", id: featureId } : null;
  }

  private pickEntityAt(
    clientX: number,
    clientY: number,
    bounds = this.canvas.getBoundingClientRect(),
  ): EntitySelection | null {
    this.setPointerFromClient(clientX, clientY, bounds);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.personIconGroup.visible) {
      const iconHit = this.raycaster.intersectObjects(this.personIconPool, false)
        .find((hit) => hit.object.visible);
      const iconPersonId = iconHit?.object.userData.entityId as string | undefined;
      if (iconPersonId) return { kind: "person", id: iconPersonId };
    }
    const nearbyPerson = this.nearestVisiblePerson(clientX, clientY, bounds);
    if (nearbyPerson) return { kind: "person", id: nearbyPerson };
    const buildingHit = this.raycaster.intersectObjects(this.selectableBuildings, false)[0];
    const personHit = this.raycaster.intersectObject(this.pedestrianBodies, false)[0];
    const vehicleHit = this.raycaster.intersectObject(this.vehicleBodies, false)[0];
    if (personHit && (!buildingHit || personHit.distance <= buildingHit.distance)) {
      const personId = personHit.instanceId === undefined
        ? undefined
        : this.personInstanceIds[personHit.instanceId];
      if (personId) return { kind: "person", id: personId };
    }
    if (
      vehicleHit
      && (!buildingHit || vehicleHit.distance <= buildingHit.distance)
    ) {
      const personId = vehicleHit.instanceId === undefined
        ? undefined
        : this.vehicleInstancePersonIds[vehicleHit.instanceId];
      if (personId) return { kind: "person", id: personId };
    }
    const buildingId = buildingHit?.object.userData.entityId as string | undefined;
    return buildingId ? { kind: "building", id: buildingId } : null;
  }

  private setPointerFromClient(clientX: number, clientY: number, bounds: DOMRect): void {
    this.pointer.set(
      ((clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
      -((clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
    );
  }

  private nearestVisiblePerson(
    clientX: number,
    clientY: number,
    bounds: DOMRect,
  ): string | null {
    let closestId: string | null = null;
    let closestDistance = 15;
    const projected = new THREE.Vector3();
    for (const person of this.visiblePersonPoints) {
      projected.set(person.x, 2, person.z).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const screenX = bounds.left + (projected.x + 1) * bounds.width / 2;
      const screenY = bounds.top + (1 - projected.y) * bounds.height / 2;
      const distance = Math.hypot(screenX - clientX, screenY - clientY);
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      closestId = person.id;
    }
    return closestId;
  }

  private updateFlyCamera(deltaSeconds: number): void {
    const movementDelta = Math.min(deltaSeconds, 0.05);
    const altitude = Math.max(2, this.camera.position.y);
    const baseSpeed =
      altitude < 12
        ? 18
        : altitude < 120
          ? 18 + altitude * 0.55
          : Math.min(680, 70 + altitude * 0.42);
    const boost = this.flyKeys.has("ShiftLeft") || this.flyKeys.has("ShiftRight") ? 3.2 : 1;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const desired = new THREE.Vector3();
    if (this.flyKeys.has("KeyW")) desired.add(forward);
    if (this.flyKeys.has("KeyS")) desired.sub(forward);
    if (this.flyKeys.has("KeyA")) desired.sub(right);
    if (this.flyKeys.has("KeyD")) desired.add(right);
    if (this.flyKeys.has("KeyE")) desired.y += 1;
    if (this.flyKeys.has("KeyQ")) desired.y -= 1;
    if (desired.lengthSq() > 0) {
      desired.normalize().multiplyScalar(baseSpeed * this.flySpeedScale * boost);
    }
    const response = desired.lengthSq() > 0 ? 6.5 : 9;
    this.flyVelocity.lerp(desired, 1 - Math.exp(-response * movementDelta));
    this.movePlayerWithCollision(
      this.flyVelocity.clone().multiplyScalar(movementDelta),
      "fly",
    );
  }

  private updateWalkCamera(deltaSeconds: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.flyYaw), 0, -Math.cos(this.flyYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const desired = new THREE.Vector3();
    if (this.flyKeys.has("KeyW")) desired.add(forward);
    if (this.flyKeys.has("KeyS")) desired.sub(forward);
    if (this.flyKeys.has("KeyA")) desired.sub(right);
    if (this.flyKeys.has("KeyD")) desired.add(right);
    if (desired.lengthSq() > 0) {
      const running =
        this.flyKeys.has("ShiftLeft") || this.flyKeys.has("ShiftRight");
      desired.normalize().multiplyScalar(running ? 7 : 4.2);
    }
    const movementDelta = Math.min(deltaSeconds, 0.05);
    const response = desired.lengthSq() > 0 ? 12 : 16;
    this.walkVelocity.lerp(desired, 1 - Math.exp(-response * movementDelta));
    this.movePlayerWithCollision(
      this.walkVelocity.clone().multiplyScalar(movementDelta),
      "walk",
    );

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
    const start = this.pendingWalkStart ?? {
      x: this.camera.position.x,
      z: this.camera.position.z,
    };
    const safe = this.findSafeWalkPosition(
      start.x,
      start.z,
    );
    this.pendingWalkStart = null;
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

  private frameOrbitView(): void {
    const center = this.cityBounds.getCenter(new THREE.Vector3());
    const altitude = this.orbitFramingAltitude();
    this.updateOrbitDistanceLimits();
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(center.x, Math.max(altitude, 720), center.z + 0.01);
    this.controls.target.set(center.x, 0, center.z);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private orbitFramingAltitude(): number {
    const size = this.cityBounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.35),
    );
    const fullDistrictAltitude = Math.max(
      size.z / (2 * Math.tan(verticalFov / 2)),
      size.x / (2 * Math.tan(horizontalFov / 2)),
    ) * 1.14;
    if (this.camera.aspect >= 0.75) return fullDistrictAltitude;
    return Math.max(
      720,
      size.z / (2 * Math.tan(verticalFov / 2)) * 1.08,
    );
  }

  private updateOrbitDistanceLimits(): void {
    this.controls.minDistance = ORBIT_MIN_ALTITUDE;
    this.controls.maxDistance = Math.max(
      ORBIT_MIN_ALTITUDE * 2,
      this.orbitFramingAltitude()
        * (this.camera.aspect < 0.75 ? 3.5 : ORBIT_MAX_FRAME_SCALE),
    );
  }

  private frameFlyView(): void {
    const center = this.cityBounds.getCenter(new THREE.Vector3());
    const size = this.cityBounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    const target = new THREE.Vector3(center.x, 18, center.z);
    this.camera.position.set(
      center.x + span * 0.38,
      THREE.MathUtils.clamp(span * 0.32, 260, 520),
      center.z + span * 0.55,
    );
    this.camera.lookAt(target);
    this.controls.target.copy(target);
  }

  private updateCameraDepthRange(): void {
    const near = this.cameraMode === "orbit"
      ? THREE.MathUtils.clamp(this.camera.position.y * 0.008, 1.5, 28)
      : this.cameraMode === "walk"
        ? 0.12
        : THREE.MathUtils.clamp(this.camera.position.y * 0.002, 0.3, 8);
    const far = this.cameraMode === "walk" ? 8_000 : CAMERA_FAR;
    if (Math.abs(this.camera.near - near) < 0.01 && this.camera.far === far) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private updateFeatureHighlights(): void {
    for (const [featureId, road] of this.featureMeshes) {
      const material = road.material as THREE.MeshStandardMaterial;
      const selected = featureId === this.selectedFeatureId;
      material.color.set(ROAD_ASPHALT_COLOR);
      material.emissive.set(selected ? "#1f6a5b" : "#000000");
      material.emissiveIntensity = selected ? 0.6 : 0;
      material.roughness = 0.9;
    }
  }

  private addStreetDesign(feature: DistrictFeature, design: FeatureDesign): void {
    const roadModel = createRoadSegmentModel(feature, design);
    const overlay = createSegmentMesh(
      feature,
      roadModel.totalWidthMeters,
      0.04,
      this.materials.editedAsphalt,
    );
    overlay.position.y = RENDER_HEIGHTS.roadSurface + 0.025;
    this.designGroup.add(overlay);
    this.addRoadLaneMarkings(
      feature,
      roadModel,
      this.designGroup,
      RENDER_HEIGHTS.selectionSurface + 0.01,
    );
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

  private syncVehicles(
    vehicles: readonly VehicleSnapshot[],
    timestampMs: number,
  ): void {
    const count = Math.min(vehicles.length, VEHICLE_INSTANCE_CAPACITY);
    for (let index = 0; index < count; index += 1) {
      const vehicle = vehicles[index];
      this.vehicleInstancePersonIds[index] = vehicle.driverPersonId
        ?? vehicle.occupantPersonIds?.[0]
        ?? "";
      const scale = vehicleScale(vehicle.kind);
      this.setAgentMatrix(
        this.vehicleBodies,
        index,
        vehicle.x,
        0.25 + 0.72 * scale[1],
        vehicle.z,
        vehicle.heading,
        scale,
      );
      const cabinOffset = -0.2 * scale[2];
      this.setAgentMatrix(
        this.vehicleCabins,
        index,
        vehicle.x + Math.sin(vehicle.heading) * cabinOffset,
        0.25 + 1.26 * scale[1],
        vehicle.z + Math.cos(vehicle.heading) * cabinOffset,
        vehicle.heading,
        scale,
      );
      const personId = vehicle.driverPersonId
        ?? vehicle.occupantPersonIds?.[0];
      const personViolationFlash = personId
        ? this.personViolationFlashIsRed(
            personId,
            vehicle.violationEventId,
            timestampMs,
          )
        : false;
      const backgroundViolationFlash =
        vehicle.violating && violationPulseIsRed(timestampMs);
      const violationFlash =
        personViolationFlash || backgroundViolationFlash;
      this.vehicleBodies.setColorAt(index, this.agentColor.set(vehicle.color));
      if (violationFlash) {
        this.vehicleBodies.setColorAt(index, this.agentColor.set("#ff3b30"));
      }
      this.vehicleCabins.setColorAt(
        index,
        this.agentColor.set(violationFlash ? "#ffb0a8" : "#aec8ce"),
      );
    }
    updateInstanceCount(this.vehicleBodies, count);
    updateInstanceCount(this.vehicleCabins, count);
  }

  private syncPedestrians(
    pedestrians: readonly PedestrianSnapshot[],
    timestampMs: number,
  ): void {
    const count = Math.min(pedestrians.length, PEDESTRIAN_INSTANCE_CAPACITY);
    for (let index = 0; index < count; index += 1) {
      const pedestrian = pedestrians[index];
      this.personInstanceIds[index] = pedestrian.personId ?? "";
      const heightScale = 0.92 + pedestrian.variant * 0.035;
      const scale: readonly [number, number, number] = [1, heightScale, 1];
      this.setAgentMatrix(
        this.pedestrianBodies,
        index,
        pedestrian.x,
        0.28 + 1.25 * heightScale,
        pedestrian.z,
        pedestrian.heading,
        scale,
      );
      this.setAgentMatrix(
        this.pedestrianHeads,
        index,
        pedestrian.x,
        0.28 + 2.1 * heightScale,
        pedestrian.z,
        pedestrian.heading,
        scale,
      );
      const personViolationFlash = pedestrian.personId
        ? this.personViolationFlashIsRed(
            pedestrian.personId,
            pedestrian.violationEventId,
            timestampMs,
          )
        : false;
      const backgroundViolationFlash =
        pedestrian.violating && violationPulseIsRed(timestampMs);
      this.pedestrianBodies.setColorAt(
        index,
        this.agentColor.set(
          personViolationFlash || backgroundViolationFlash
            ? "#ff3b30"
            : pedestrian.color,
        ),
      );
      this.pedestrianHeads.setColorAt(
        index,
        this.agentColor.set(
          ["#d9a477", "#8b5b3f", "#efc6a0", "#70442f"][
            pedestrian.variant % 4
          ],
        ),
      );
    }
    updateInstanceCount(this.pedestrianBodies, count);
    updateInstanceCount(this.pedestrianHeads, count);
  }

  private syncVisiblePeople(
    vehicles: readonly VehicleSnapshot[],
    pedestrians: readonly PedestrianSnapshot[],
    timestampMs: number,
  ): void {
    this.visiblePersonPoints.length = 0;
    const positions = new Map<string, {
      x: number;
      z: number;
      height: number;
      selectable: boolean;
      violating?: boolean;
      violationEventId?: string;
    }>();
    const expansionRoadIds = new Set(
      this.expansionRoads.map((road) => road.id),
    );
    for (const pedestrian of pedestrians) {
      if (pedestrian.personId) {
        positions.set(pedestrian.personId, {
          x: pedestrian.x,
          z: pedestrian.z,
          height: 3.1,
          selectable: true,
          violationEventId: pedestrian.violationEventId,
        });
      } else if (expansionRoadIds.has(pedestrian.segmentId)) {
        positions.set(`ambient-pedestrian:${pedestrian.id}`, {
          x: pedestrian.x,
          z: pedestrian.z,
          height: 3.1,
          selectable: false,
          violating: pedestrian.violating,
        });
      }
    }
    for (const vehicle of vehicles) {
      const peopleInVehicle = new Set(vehicle.occupantPersonIds ?? []);
      if (vehicle.driverPersonId) peopleInVehicle.add(vehicle.driverPersonId);
      for (const personId of peopleInVehicle) {
        positions.set(personId, {
          x: vehicle.x,
          z: vehicle.z,
          height: 4.1,
          selectable: true,
          violationEventId: vehicle.violationEventId,
        });
      }
    }
    let iconCount = 0;
    const iconPoints: Array<{ x: number; z: number }> = [];
    const orderedPositions = [...positions].sort(([leftId], [rightId]) =>
      Number(this.favoritePersonIds.has(rightId)) - Number(this.favoritePersonIds.has(leftId))
      || Number(this.selectedEntity?.kind === "person" && this.selectedEntity.id === rightId)
        - Number(this.selectedEntity?.kind === "person" && this.selectedEntity.id === leftId)
    );
    for (const [personId, point] of orderedPositions) {
      if (point.selectable) {
        this.visiblePersonPoints.push({
          id: personId,
          x: point.x,
          z: point.z,
        });
      }
      const selected = point.selectable
        && this.selectedEntity?.kind === "person"
        && this.selectedEntity.id === personId;
      const priority = selected ||
        point.selectable && this.favoritePersonIds.has(personId);
      if (!priority && iconPoints.some((iconPoint) =>
        Math.hypot(iconPoint.x - point.x, iconPoint.z - point.z) < 7
      )) continue;
      iconPoints.push(point);
      const icon = this.personIconPool[iconCount] ?? this.createPersonIcon();
      icon.position.set(point.x, point.height, point.z);
      icon.scale.set(selected ? 0.052 : 0.044, selected ? 0.066 : 0.056, 1);
      const violationFlash = point.selectable
        ? this.personViolationFlashIsRed(
            personId,
            point.violationEventId,
            timestampMs,
          )
        : point.violating && violationPulseIsRed(timestampMs);
      icon.material = violationFlash
        ? this.personIconMaterials.violation
        : point.selectable && this.favoritePersonIds.has(personId)
          ? this.personIconMaterials.favorite
          : selected
            ? this.personIconMaterials.selected
            : this.personIconMaterials.standard;
      icon.userData.entityId = point.selectable ? personId : undefined;
      icon.visible = true;
      iconCount += 1;
    }
    for (let index = iconCount; index < this.personIconPool.length; index += 1) {
      this.personIconPool[index].visible = false;
      this.personIconPool[index].userData.entityId = undefined;
    }
  }

  private createPersonIcon(): THREE.Sprite {
    const icon = new THREE.Sprite(this.personIconMaterials.standard);
    icon.center.set(0.5, 0);
    icon.renderOrder = 24;
    this.personIconPool.push(icon);
    this.personIconGroup.add(icon);
    return icon;
  }

  private personViolationFlashIsRed(
    personId: string,
    eventId: string | undefined,
    timestampMs: number,
  ): boolean {
    if (
      eventId
      && this.personViolationEventIds.get(personId) !== eventId
    ) {
      this.personViolationEventIds.set(personId, eventId);
      this.personViolationFlashUntil.set(personId, timestampMs + 2_000);
    }
    return (
      (this.personViolationFlashUntil.get(personId) ?? 0) > timestampMs
      && violationPulseIsRed(timestampMs)
    );
  }

  private updatePersonIconGroupVisibility(): void {
    this.personIconGroup.visible = !this.buildMode && this.cameraMode === "orbit";
  }

  private setAgentMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    heading: number,
    scale: readonly [number, number, number],
  ): void {
    this.agentTransform.position.set(x, y, z);
    this.agentTransform.rotation.set(0, heading, 0);
    this.agentTransform.scale.set(scale[0], scale[1], scale[2]);
    this.agentTransform.updateMatrix();
    mesh.setMatrixAt(index, this.agentTransform.matrix);
  }

  private addRoadLaneMarkings(
    feature: DistrictFeature,
    road: Readonly<RoadSegmentModel>,
    group: THREE.Object3D,
    y: number,
  ): void {
    if (road.directionality === "two-way") {
      const centerLine = createOffsetSegmentMesh(
        feature,
        0,
        0.24,
        0.025,
        this.materials.yellowLine,
      );
      centerLine.position.y = y;
      group.add(centerLine);
    }
    const travelLanes = road.lanes.filter(isDrivableLane);
    for (const direction of ["forward", "reverse"] as const) {
      const directional = travelLanes
        .filter((lane) => lane.direction === direction)
        .sort((a, b) => a.offsetMeters - b.offsetMeters);
      for (let index = 1; index < directional.length; index += 1) {
        const offset =
          (directional[index - 1].offsetMeters +
            directional[index].offsetMeters) /
          2;
        const divider = createOffsetSegmentMesh(
          feature,
          offset,
          0.13,
          0.022,
          this.materials.whiteLine,
        );
        divider.scale.x = 0.94;
        divider.position.y = y + 0.006;
        group.add(divider);
      }
    }
    for (const lane of road.lanes.filter((candidate) => candidate.type === "bike")) {
      const bikeSurface = createOffsetSegmentMesh(
        feature,
        lane.offsetMeters,
        lane.widthMeters,
        0.018,
        this.materials.bikeLane,
      );
      bikeSurface.position.y = y - 0.003;
      group.add(bikeSurface);
    }
  }

  private buildTrafficDebug(): void {
    if (!this.trafficDebugEnabled) return;
    const debugMaterials = {
      general: new THREE.MeshBasicMaterial({ color: "#58e4c2" }),
      turn: new THREE.MeshBasicMaterial({ color: "#ffcb66" }),
      bus: new THREE.MeshBasicMaterial({ color: "#ca85ff" }),
      bike: new THREE.MeshBasicMaterial({ color: "#46b9ff" }),
    } as const;
    for (const feature of this.features) {
      if (feature.kind !== "street") continue;
      const road = ROAD_SEGMENT_BY_ID.get(feature.id);
      if (!road) continue;
      for (const lane of road.lanes) {
        if (lane.type === "parking") continue;
        const centerline = createOffsetSegmentMesh(
          feature,
          lane.offsetMeters,
          lane.type === "bike" ? 0.16 : 0.11,
          0.02,
          debugMaterials[lane.type],
        );
        centerline.position.y = RENDER_HEIGHTS.selectionSurface + 0.08;
        this.trafficDebugGroup.add(centerline);
      }
    }
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: "#ff6f59" });
    for (const feature of this.features) {
      if (feature.kind !== "intersection") continue;
      const position = geoToWorld(feature.path[0]);
      const node = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 0.07, 10),
        nodeMaterial,
      );
      node.position.set(
        position.x,
        RENDER_HEIGHTS.selectionSurface + 0.12,
        position.z,
      );
      this.trafficDebugGroup.add(node);
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
      if (!objectAndAncestorsVisible(object)) return;
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

  private addDistantSkyline(rng: () => number): void {
    const center = this.cityBounds.getCenter(new THREE.Vector3());
    const size = this.cityBounds.getSize(new THREE.Vector3());
    const cityRadius = Math.hypot(size.x / 2, size.z / 2);
    for (let index = 0; index < 170; index += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = cityRadius + 220 + rng() * 900;
      const width = 24 + rng() * 55;
      const depth = 24 + rng() * 55;
      const height = 28 + rng() * (radius < 1_650 ? 150 : 85);
      const building = box(
        width,
        height,
        depth,
        rng() > 0.45 ? this.materials.distant : this.materials.distantGlass,
      );
      building.position.set(
        center.x + Math.cos(angle) * radius,
        height / 2,
        center.z + Math.sin(angle) * radius,
      );
      building.rotation.y = rng() * Math.PI;
      building.userData.collidable = true;
      this.scene.add(building);
    }
  }
}

function createWorldMaterials() {
  const material = (color: string, metalness = 0.03) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness,
    });
  return {
    ground: new THREE.MeshStandardMaterial({ color: "#71866d", roughness: 1 }),
    lawn: new THREE.MeshStandardMaterial({ color: "#76976c", roughness: 1 }),
    campusGrass: new THREE.MeshStandardMaterial({ color: "#87a978", roughness: 1 }),
    blockPaving: new THREE.MeshStandardMaterial({ color: "#b7b3a3", roughness: 0.96 }),
    asphalt: new THREE.MeshStandardMaterial({
      color: ROAD_ASPHALT_COLOR,
      roughness: 0.92,
    }),
    editedAsphalt: new THREE.MeshStandardMaterial({
      color: ROAD_ASPHALT_COLOR,
      roughness: 0.88,
    }),
    sidewalk: new THREE.MeshStandardMaterial({ color: "#c7c5ba", roughness: 0.94 }),
    yellowLine: new THREE.MeshStandardMaterial({ color: "#f1ca56", roughness: 0.75 }),
    whiteLine: new THREE.MeshStandardMaterial({ color: "#f1efe8", roughness: 0.8 }),
    bikeLane: new THREE.MeshStandardMaterial({ color: "#2ca79f", roughness: 0.84 }),
    historicBrick: material("#8f5142"),
    redBrick: material("#a45d4c"),
    rowhouseRed: material("#c9826f"),
    rowhouseTan: material("#d3a37d"),
    landmarkStone: material("#9e6757"),
    darkStone: material("#6d5149"),
    fisherBrick: material("#8e3f36"),
    huntsmanStone: material("#c7b88e"),
    vanPelt: material("#8d8171"),
    limestone: material("#b2aa90"),
    museumBrick: material("#b36f5c"),
    glass: material("#466a77", 0.2),
    office: material("#555e5c"),
    concrete: material("#8f9894"),
    silver: material("#bac5c3"),
    dorm: material("#9c6f5d"),
    hospital: material("#e0e2dd"),
    parking: material("#a6aaa3"),
    retail: material("#bc8064"),
    academic: material("#a88975"),
    darkBand: new THREE.MeshStandardMaterial({ color: "#465056", roughness: 0.7 }),
    awning: new THREE.MeshStandardMaterial({ color: "#7d2c35", roughness: 0.8 }),
    rooftop: new THREE.MeshStandardMaterial({ color: "#697277", roughness: 0.88 }),
    roofCopper: new THREE.MeshStandardMaterial({ color: "#557a6b", roughness: 0.86 }),
    darkRoof: new THREE.MeshStandardMaterial({ color: "#3f4547", roughness: 0.9 }),
    field: new THREE.MeshStandardMaterial({ color: "#4f8b5c", roughness: 1 }),
    stadiumConcrete: new THREE.MeshStandardMaterial({ color: "#928d83", roughness: 0.95 }),
    distant: new THREE.MeshStandardMaterial({ color: "#7d8a88", roughness: 0.9 }),
    distantGlass: new THREE.MeshStandardMaterial({ color: "#688493", roughness: 0.55, metalness: 0.1 }),
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

function roadWidth(feature: DistrictFeature): number {
  return feature.name === "Market Street" ||
    feature.name === "South Street" ||
    feature.name === "38th Street" ||
    feature.name === "40th Street"
    ? MAJOR_ROAD_WIDTH
    : ROAD_WIDTH;
}

function baseRoadGeometries(): ExpansionRoad[] {
  return PENN_ROAD_GRAPH
    .filter((feature) => feature.kind === "street")
    .map((feature) => {
      const [start, end] = feature.path.map(geoToWorld);
      return {
        id: `existing-road:${feature.id}`,
        startX: start.x,
        startZ: start.z,
        endX: end.x,
        endZ: end.z,
        width: roadWidth(feature),
        laneDelta: 0,
        bikeLane: false,
        widenedSidewalk: false,
        laneDirection: "two-way",
      };
    });
}

function objectAndAncestorsVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function geoToWorld(point: Pick<GeoPoint, "longitude" | "latitude">): THREE.Vector3 {
  return new THREE.Vector3(
    (point.longitude - PENN_CENTER.longitude) * METERS_PER_DEGREE_LONGITUDE,
    0,
    -(point.latitude - PENN_CENTER.latitude) * METERS_PER_DEGREE_LATITUDE,
  );
}

function districtWorldBounds(): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const feature of PENN_ROAD_GRAPH) {
    for (const point of feature.path) bounds.expandByPoint(geoToWorld(point));
  }
  for (const building of PENN_BUILDINGS) {
    bounds.expandByPoint(new THREE.Vector3(
      building.x - building.width / 2,
      0,
      building.z - building.depth / 2,
    ));
    bounds.expandByPoint(new THREE.Vector3(
      building.x + building.width / 2,
      0,
      building.z + building.depth / 2,
    ));
  }
  return bounds.expandByScalar(80);
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

export function createGabledRoofGeometry(
  width: number,
  depth: number,
  height: number,
): THREE.BufferGeometry {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const positions = new Float32Array([
    -halfWidth, 0, -halfDepth,
    halfWidth, 0, -halfDepth,
    -halfWidth, 0, halfDepth,
    halfWidth, 0, halfDepth,
    0, height, -halfDepth,
    0, height, halfDepth,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 4, 5, 0, 5, 2,
    1, 3, 5, 1, 5, 4,
    0, 1, 4,
    2, 5, 3,
    0, 2, 3, 0, 3, 1,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

export function fitObjectToFootprint(
  object: THREE.Object3D,
  width: number,
  depth: number,
): void {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x > width) object.scale.x *= width / size.x;
  if (size.z > depth) object.scale.z *= depth / size.z;
  object.updateMatrixWorld(true);
  const center = new THREE.Box3()
    .setFromObject(object)
    .getCenter(new THREE.Vector3());
  for (const child of object.children) {
    child.position.x -= center.x / object.scale.x;
    child.position.z -= center.z / object.scale.z;
  }
  object.updateMatrixWorld(true);
}

function vehicleScale(
  kind: VehicleKind,
): readonly [number, number, number] {
  return (
    kind === "compact"
      ? [0.92, 0.9, 0.86]
      : kind === "suv"
        ? [1.06, 1.2, 1.12]
        : kind === "van"
          ? [1.08, 1.28, 1.28]
        : kind === "bus"
            ? [1.15, 1.35, 2.2]
            : kind === "truck"
              ? [1.12, 1.25, 1.9]
            : [1, 1, 1]
  );
}

function createAgentInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}

function updateInstanceCount(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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

function violationPulseIsRed(timestampMs: number): boolean {
  return Math.floor(timestampMs / 160) % 2 === 0;
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

function createPersonIconMaterial(
  fill: string,
  outline: string,
  favorite: boolean,
): THREE.SpriteMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create person marker texture.");

  context.lineJoin = "round";
  context.lineWidth = 8;
  context.strokeStyle = outline;
  context.fillStyle = fill;
  context.beginPath();
  context.arc(64, 58, 43, Math.PI * 0.13, Math.PI * 0.87, true);
  context.lineTo(64, 148);
  context.lineTo(22, 76);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = outline;
  context.beginPath();
  context.arc(64, 48, 13, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.roundRect(42, 65, 44, 36, 16);
  context.fill();

  if (favorite) {
    drawMarkerStar(context, 98, 25, 14, "#fff8d5", outline);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    toneMapped: false,
  });
}

function drawMarkerStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  outline: string,
): void {
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const pointRadius = point % 2 === 0 ? radius : radius * 0.45;
    const pointX = x + Math.cos(angle) * pointRadius;
    const pointY = y + Math.sin(angle) * pointRadius;
    if (point === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.lineWidth = 4;
  context.strokeStyle = outline;
  context.fillStyle = fill;
  context.fill();
  context.stroke();
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
}

function isEntityOverlay(mode: MapOverlayMode): boolean {
  return [
    "profitability",
    "affordability",
    "employment",
    "wellbeing",
    "goods",
  ].includes(mode);
}

function overlayStateSignature(
  mode: MapOverlayMode,
  state: Readonly<SimulationState>,
): string {
  if (mode === "congestion") {
    return `${mode}:${state.roadTraffic
      .map((traffic) => `${traffic.segmentId}:${Math.round(traffic.congestionPercent / 10)}`)
      .join("|")}`;
  }
  if (!isEntityOverlay(mode)) return mode;
  return `${mode}:${state.entities.lastUpdatedDay}`;
}

function entityOverlayScore(
  mode: MapOverlayMode,
  building: Readonly<DetailedBuilding>,
  residents: readonly DetailedPerson[],
  households: readonly DetailedHousehold[],
): number {
  const accounting = building.accounting;
  if (mode === "profitability") {
    const margin = accounting.profit / Math.max(1, accounting.operatingRevenue);
    return clamp((margin + 0.35) / 0.7, 0, 1);
  }
  if (mode === "affordability") {
    if (households.length === 0) return 0.5;
    const averageRentBurden = households.reduce((total, household) =>
      total + building.rentDaily / Math.max(25, household.dailyIncome), 0) / households.length;
    const distressedShare = households.filter((household) =>
      household.financialStatus === "distressed" || household.financialStatus === "crisis"
    ).length / households.length;
    const arrearsShare = households.filter((household) => household.rentArrears > 0).length / households.length;
    const pressure = clamp(
      Math.max(0, averageRentBurden - 0.2) / 0.8 + distressedShare * 0.35 + arrearsShare * 0.25,
      0,
      1,
    );
    return 1 - pressure;
  }
  if (mode === "employment") return clamp(accounting.staffingRatio, 0, 1);
  if (mode === "wellbeing") {
    const happiness = residents.reduce((total, person) => total + person.happiness, 0)
      / Math.max(1, residents.length)
      / 100;
    const leaving = residents.filter((person) => person.migrationStatus !== "staying").length;
    const retention = 1 - clamp(leaving / Math.max(1, residents.length), 0, 1);
    return clamp(happiness * 0.75 + retention * 0.25, 0, 1);
  }
  if (mode === "goods") {
    return clamp(accounting.goodsReceived / Math.max(1, accounting.goodsDemanded), 0, 1);
  }
  return 0.5;
}

function entityOverlayApplies(
  mode: MapOverlayMode,
  building: Readonly<DetailedBuilding>,
  residents: readonly DetailedPerson[],
): boolean {
  if (mode === "profitability") {
    return ["retail", "office", "industrial", "parking"].includes(building.function);
  }
  if (mode === "employment") return building.accounting.requiredWorkers > 0;
  if (mode === "goods") return building.accounting.goodsDemanded > 0;
  if (mode === "wellbeing") return residents.length > 0;
  return mode === "affordability" && building.function === "housing";
}

function scoreColor(value: number, highContrast = false): THREE.Color {
  if (highContrast) return entityScoreColor(value, true);
  return new THREE.Color().setHSL(clamp(value, 0, 1) * 0.32, 0.72, 0.5);
}

function entityScoreColor(value: number, highContrast = false): THREE.Color {
  const normalized = clamp(value, 0, 1);
  if (highContrast) {
    if (normalized <= 0.5) {
      return new THREE.Color("#d55e00").lerp(
        new THREE.Color("#f0e442"),
        normalized * 2,
      );
    }
    return new THREE.Color("#f0e442").lerp(
      new THREE.Color("#0072b2"),
      (normalized - 0.5) * 2,
    );
  }
  if (normalized <= 0.5) {
    return new THREE.Color("#d31845").lerp(
      new THREE.Color("#df9200"),
      normalized * 2,
    );
  }
  return new THREE.Color("#df9200").lerp(
    new THREE.Color("#008d5a"),
    (normalized - 0.5) * 2,
  );
}

function entityOverlayMarkerGeometry(mode: MapOverlayMode): THREE.BufferGeometry {
  if (mode === "profitability") return new THREE.OctahedronGeometry(4.2);
  if (mode === "affordability") return new THREE.TorusGeometry(3.8, 1.3, 8, 16);
  if (mode === "employment") return new THREE.BoxGeometry(6, 6, 6);
  if (mode === "wellbeing") return new THREE.SphereGeometry(4.2, 12, 8);
  return new THREE.ConeGeometry(4.2, 7, 8);
}

function buildingFunctionColor(buildingFunction: EntityBuildingDefinition["function"]): string {
  const colors: Record<EntityBuildingDefinition["function"], string> = {
    housing: "#70b7df",
    retail: "#f0bc58",
    office: "#8fd0b5",
    university: "#d99978",
    library: "#c1a5e6",
    school: "#e8d37c",
    clinic: "#ef8b8b",
    culture: "#d59fc9",
    recreation: "#7ed18d",
    parking: "#a5adb4",
    industrial: "#d09b6f",
  };
  return colors[buildingFunction];
}

function flowColor(kind: BuildingConnectionKind, highContrast = false): string {
  if (kind === "work") return highContrast ? "#56b4e9" : "#00b7ff";
  if (kind === "visit") return highContrast ? "#f0e442" : "#ffb000";
  return highContrast ? "#d55e00" : "#ff5f4a";
}

function flowPoint(
  id: string,
  buildings: ReadonlyMap<string, DetailedBuilding>,
  oppositeId: string,
  from: boolean,
): THREE.Vector3 {
  const building = buildings.get(id);
  if (building) return new THREE.Vector3(building.x, building.height + 6, building.z);
  const opposite = buildings.get(oppositeId);
  if (!opposite) return new THREE.Vector3(from ? -1_050 : 1_050, 22, 0);
  if (id === "outside-work") {
    return new THREE.Vector3(opposite.x > 0 ? 1_100 : -1_100, 24, opposite.z * 0.55);
  }
  return new THREE.Vector3(1_150, 24, opposite.z * 0.6);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  clear(): void {
    this.cells.clear();
    this.items.clear();
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
