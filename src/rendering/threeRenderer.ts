import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  resolveSubsteppedMovement,
} from "../core/collision";
import { deriveBuildingRole } from "../core/buildingActivity";
import {
  PENN_AVENUES,
  PENN_CENTER,
  PENN_LANDMARKS,
  PENN_ROAD_GRAPH,
  PENN_STREETS,
} from "../data/pennRoadGraph";
import type {
  BuildingKind,
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
  SignalSnapshot,
  SimulationState,
  VehicleKind,
  VehicleSnapshot,
  WeatherMode,
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
const ROAD_MARKING_END_INSET = 15;
const EXPANSION_WORLD_LIMIT = 2_400;
const CORE_PROTECTION_PADDING = 10;
const EXPANSION_GRID_SIZE = 20;
const EXPANSION_CROSSWALK_BAND_LENGTH = 12.25;
const EXPANSION_CROSSWALK_JUNCTION_GAP = 0.8;
const EXPANSION_CROSSWALK_PLACEMENT_RADIUS = 30;
const CORE_BOUNDS = createProtectedCoreBounds();
const ORIGINAL_ROAD_CONNECTORS = createOriginalRoadConnectors();
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
  onMoveStart: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  onMoveEnd: (id: string) => void;
  onPlacementRejected: (reason: string) => void;
}

interface ExpansionRoadInteractionHandlers {
  onStarted: (startX: number, startZ: number) => void;
  onComplete: (
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
  ) => void;
  onCancelled: () => void;
  onRejected: (reason: string) => void;
}

interface ExpansionStreetObjectInteractionHandlers {
  onPlace: (
    kind: ExpansionStreetObjectKind,
    x: number,
    z: number,
    rotation: number,
  ) => void;
  onRejected: (reason: string) => void;
}

interface ExpansionJunction {
  x: number;
  z: number;
  roadIds: Set<string>;
}

interface OriginalRoadConnector {
  x: number;
  z: number;
  side: "min-x" | "max-x" | "min-z" | "max-z";
}

interface BuildingPlacementResult {
  valid: boolean;
  reason: string;
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
  private readonly selectableExpansionRoads: THREE.Mesh[] = [];
  private readonly designGroup = new THREE.Group();
  private readonly analysisGroup = new THREE.Group();
  private readonly trafficGroup = new THREE.Group();
  private readonly pedestrianGroup = new THREE.Group();
  private readonly placedBuildingGroup = new THREE.Group();
  private readonly expansionRoadGroup = new THREE.Group();
  private readonly expansionStreetObjectGroup = new THREE.Group();
  private readonly expansionGuideGroup = new THREE.Group();
  private readonly placedBuildingMeshes = new Map<string, THREE.Group>();
  private readonly placedBuildingData = new Map<string, PlacedBuilding>();
  private readonly expansionRoadData = new Map<string, ExpansionRoad>();
  private readonly expansionStreetObjectData = new Map<
    string,
    ExpansionStreetObject
  >();
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
  private readonly hemisphereLight = new THREE.HemisphereLight(
    "#dff3ff",
    "#536044",
    2.35,
  );
  private readonly sunLight = new THREE.DirectionalLight("#fff3d6", 4.8);
  private readonly rainPoints = createRainPoints();
  private readonly collisionDebugEnabled = new URLSearchParams(window.location.search).has(
    "collisionDebug",
  );
  private selectionHandler: ((feature: DistrictFeature) => void) | null = null;
  private expansionRoadSelectionHandler: ((roadId: string) => void) | null = null;
  private buildingInteractionHandlers: BuildingInteractionHandlers | null = null;
  private expansionRoadInteractionHandlers: ExpansionRoadInteractionHandlers | null =
    null;
  private expansionStreetObjectInteractionHandlers:
    | ExpansionStreetObjectInteractionHandlers
    | null = null;
  private selectedFeatureId: string | null = null;
  private selectedExpansionRoadId: string | null = null;
  private selectedPlacedBuildingId: string | null = null;
  private buildingPlacementEnabled = false;
  private expansionMode = false;
  private expansionRoadDrawEnabled = false;
  private expansionStreetObjectPlacementTool: ExpansionStreetObjectKind | null = null;
  private drawingExpansionRoadStart: THREE.Vector3 | null = null;
  private expansionRoadPreview: THREE.Mesh | null = null;
  private pedestrianMarkersVisible = true;
  private vehicleMarkersVisible = true;
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
    this.controls.rotateSpeed = -0.72;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 2_700;
    this.controls.maxPolarAngle = Math.PI / 2.04;

    this.scene.add(
      this.designGroup,
      this.analysisGroup,
      this.trafficGroup,
      this.pedestrianGroup,
      this.placedBuildingGroup,
      this.expansionRoadGroup,
      this.expansionStreetObjectGroup,
      this.expansionGuideGroup,
      this.rainPoints,
    );
    this.buildLightingAndSky();
    this.buildGround();
    this.buildRoadsAndSidewalks();
    this.buildExpansionProtectionGuide();
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

  setExpansionRoadSelectionHandler(handler: (roadId: string) => void): void {
    this.expansionRoadSelectionHandler = handler;
  }

  setBuildingInteractionHandlers(handlers: BuildingInteractionHandlers): void {
    this.buildingInteractionHandlers = handlers;
  }

  setExpansionRoadInteractionHandlers(
    handlers: ExpansionRoadInteractionHandlers,
  ): void {
    this.expansionRoadInteractionHandlers = handlers;
  }

  setExpansionStreetObjectInteractionHandlers(
    handlers: ExpansionStreetObjectInteractionHandlers,
  ): void {
    this.expansionStreetObjectInteractionHandlers = handlers;
  }

  setExpansionMode(enabled: boolean): void {
    this.expansionMode = enabled;
    this.expansionGuideGroup.visible = enabled && this.buildMode;
    if (!enabled) {
      this.setExpansionRoadDrawEnabled(false);
      this.setExpansionStreetObjectPlacementTool(null);
    }
  }

  setExpansionRoadDrawEnabled(enabled: boolean): void {
    this.expansionRoadDrawEnabled =
      enabled && this.expansionMode && this.buildMode;
    if (!this.expansionRoadDrawEnabled && this.drawingExpansionRoadStart) {
      this.drawingExpansionRoadStart = null;
      this.clearExpansionRoadPreview();
    }
    if (this.cameraMode === "orbit") {
      this.canvas.style.cursor =
        this.expansionRoadDrawEnabled || this.buildingPlacementEnabled
          ? "crosshair"
          : "grab";
    }
  }

  setExpansionStreetObjectPlacementTool(
    tool: ExpansionStreetObjectKind | null,
  ): void {
    this.expansionStreetObjectPlacementTool =
      this.expansionMode && this.buildMode ? tool : null;
    if (this.cameraMode === "orbit") {
      this.canvas.style.cursor =
        this.expansionStreetObjectPlacementTool !== null ? "crosshair" : "grab";
    }
  }

  setBuildingPlacementEnabled(enabled: boolean): void {
    this.buildingPlacementEnabled = enabled;
    if (this.cameraMode === "orbit") {
      this.canvas.style.cursor = enabled ? "crosshair" : "grab";
    }
  }

  setPedestrianMarkersVisible(visible: boolean): void {
    this.pedestrianMarkersVisible = visible;
    setPoolMarkerVisibility(this.pedestrianPool, visible);
  }

  setVehicleMarkersVisible(visible: boolean): void {
    this.vehicleMarkersVisible = visible;
    setPoolMarkerVisibility(this.vehiclePool, visible);
  }

  setPlacedBuildings(buildings: readonly PlacedBuilding[]): void {
    clearGroup(this.placedBuildingGroup);
    this.placedBuildingMeshes.clear();
    this.placedBuildingData.clear();
    for (const building of buildings) {
      const group = this.createPlacedBuilding(building);
      this.placedBuildingData.set(building.id, building);
      this.placedBuildingMeshes.set(building.id, group);
      this.placedBuildingGroup.add(group);
    }
    this.updatePlacedBuildingSelection();
  }

  setExpansionRoads(roads: readonly ExpansionRoad[]): void {
    clearGroup(this.expansionRoadGroup);
    this.selectableExpansionRoads.length = 0;
    this.expansionRoadData.clear();
    for (const road of roads) {
      this.expansionRoadData.set(road.id, { ...road });
    }
    const junctions = findExpansionJunctions(roads);
    for (const road of roads) this.addExpansionRoad(road, junctions);
    for (const junction of junctions) this.addExpansionJunction(junction);
    this.updateExpansionRoadSelection();
  }

  setSelectedExpansionRoad(id: string | null): void {
    this.selectedExpansionRoadId = id;
    this.updateExpansionRoadSelection();
  }

  setExpansionStreetObjects(objects: readonly ExpansionStreetObject[]): void {
    clearGroup(this.expansionStreetObjectGroup);
    this.expansionStreetObjectData.clear();
    for (const object of objects) {
      this.expansionStreetObjectData.set(object.id, { ...object });
      if (object.kind === "crosswalk") {
        this.expansionStreetObjectGroup.add(this.createExpansionCrosswalk(object));
      } else {
        this.expansionStreetObjectGroup.add(this.createExpansionTrafficSignal(object));
      }
    }
  }

  resolveExpansionStreetObjectPlacement(
    kind: ExpansionStreetObjectKind,
    x: number,
    z: number,
  ): {
    valid: boolean;
    reason: string;
    x: number;
    z: number;
    rotation: number;
  } {
    if (pointInsideBounds(x, z, CORE_BOUNDS)) {
      return {
        valid: false,
        reason: "Street objects must stay outside the protected original city.",
        x,
        z,
        rotation: 0,
      };
    }
    if (kind === "traffic-signal") {
      return { valid: true, reason: "", x, z, rotation: 0 };
    }
    const roads = [...this.expansionRoadData.values()];
    const junctions = findExpansionJunctions(roads);
    let nearestPlacement: { x: number; z: number; rotation: number } | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const junction of junctions) {
      const connectedRoads = [...junction.roadIds]
        .map((roadId) => this.expansionRoadData.get(roadId))
        .filter((road): road is ExpansionRoad => road !== undefined);
      const junctionWidth =
        Math.max(...connectedRoads.map((road) => expansionRoadWidth(road))) + 1;
      const approachOffset =
        junctionWidth / 2 +
        EXPANSION_CROSSWALK_JUNCTION_GAP +
        EXPANSION_CROSSWALK_BAND_LENGTH / 2;
      for (const direction of junctionDirections(junction, connectedRoads)) {
        const candidate = {
          x:
            junction.x +
            (direction === "west"
              ? -approachOffset
              : direction === "east"
                ? approachOffset
                : 0),
          z:
            junction.z +
            (direction === "north"
              ? -approachOffset
              : direction === "south"
                ? approachOffset
                : 0),
          rotation:
            direction === "west" || direction === "east" ? 0 : Math.PI / 2,
        };
        const distance = Math.hypot(x - candidate.x, z - candidate.z);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPlacement = candidate;
        }
      }
    }
    if (
      !nearestPlacement ||
      nearestDistance > EXPANSION_CROSSWALK_PLACEMENT_RADIUS
    ) {
      return {
        valid: false,
        reason: "Crosswalks can only be placed on an approach to an expansion intersection.",
        x,
        z,
        rotation: 0,
      };
    }
    const overlapsExistingCrosswalk = [...this.expansionStreetObjectData.values()].some(
      (object) =>
        object.kind === "crosswalk" &&
        Math.hypot(
          object.x - nearestPlacement.x,
          object.z - nearestPlacement.z,
        ) < 5,
    );
    if (overlapsExistingCrosswalk) {
      return {
        valid: false,
        reason: "That intersection approach already has a crosswalk.",
        x,
        z,
        rotation: 0,
      };
    }
    return {
      valid: true,
      reason: "",
      ...nearestPlacement,
    };
  }

  validateExpansionRoad(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
  ): BuildingPlacementResult {
    const length = Math.hypot(endX - startX, endZ - startZ);
    if (length < 8) {
      return { valid: false, reason: "Drag at least 8 meters to create a road." };
    }
    if (
      Math.max(Math.abs(startX), Math.abs(startZ), Math.abs(endX), Math.abs(endZ)) >
      EXPANSION_WORLD_LIMIT
    ) {
      return { valid: false, reason: "That road extends beyond the buildable world." };
    }
    if (
      segmentIntersectsProtectedCore(startX, startZ, endX, endZ) &&
      !isValidOriginalRoadConnection(startX, startZ, endX, endZ)
    ) {
      return {
        valid: false,
        reason: "New roads cannot enter or cross the protected original city.",
      };
    }
    for (const building of this.placedBuildingData.values()) {
      const footprint = getBuildingFootprint(building);
      if (
        distanceToSegment(
          building.x,
          building.z,
          startX,
          startZ,
          endX,
          endZ,
        ) <
        Math.hypot(footprint.halfX, footprint.halfZ) + 9.5
      ) {
        return {
          valid: false,
          reason: "Move nearby buildings before drawing a road through this space.",
        };
      }
    }
    return { valid: true, reason: "" };
  }

  validateBuildingPlacement(
    building: PlacedBuilding,
    ignoreBuildingId: string | null = null,
  ): BuildingPlacementResult {
    const footprint = getBuildingFootprint(building);
    const clearance = 2.5;
    const minX = building.x - footprint.halfX - clearance;
    const maxX = building.x + footprint.halfX + clearance;
    const minZ = building.z - footprint.halfZ - clearance;
    const maxZ = building.z + footprint.halfZ + clearance;

    if (
      this.expansionMode &&
      rectanglesOverlap(
        minX,
        maxX,
        minZ,
        maxZ,
        CORE_BOUNDS.minX,
        CORE_BOUNDS.maxX,
        CORE_BOUNDS.minZ,
        CORE_BOUNDS.maxZ,
      )
    ) {
      return {
        valid: false,
        reason: "New buildings must stay outside the protected original city.",
      };
    }

    for (const road of this.expansionRoadData.values()) {
      const footprintRadius = Math.hypot(footprint.halfX, footprint.halfZ);
      if (
        distanceToSegment(
          building.x,
          building.z,
          road.startX,
          road.startZ,
          road.endX,
          road.endZ,
        ) <
        footprintRadius + road.width / 2 + 2
      ) {
        return {
          valid: false,
          reason: "Buildings need a little setback from expansion roads.",
        };
      }
    }

    for (const feature of this.features) {
      if (feature.kind !== "street") continue;
      const roadClearance = roadWidth(feature) / 2;
      for (let index = 0; index < feature.path.length - 1; index += 1) {
        const start = geoToWorld(feature.path[index]);
        const end = geoToWorld(feature.path[index + 1]);
        if (
          maxX >= Math.min(start.x, end.x) - roadClearance &&
          minX <= Math.max(start.x, end.x) + roadClearance &&
          maxZ >= Math.min(start.z, end.z) - roadClearance &&
          minZ <= Math.max(start.z, end.z) + roadClearance
        ) {
          return {
            valid: false,
            reason: "Buildings need clear ground and cannot overlap a street.",
          };
        }
      }
    }

    for (const volume of this.collisionIndex.query(minX, maxX, minZ, maxZ)) {
      if (
        maxX > volume.box.min.x &&
        minX < volume.box.max.x &&
        maxZ > volume.box.min.z &&
        minZ < volume.box.max.z
      ) {
        return {
          valid: false,
          reason: "That space is occupied by an existing building or streetscape object.",
        };
      }
    }

    for (const other of this.placedBuildingData.values()) {
      if (other.id === ignoreBuildingId) continue;
      const otherFootprint = getBuildingFootprint(other);
      if (
        maxX > other.x - otherFootprint.halfX &&
        minX < other.x + otherFootprint.halfX &&
        maxZ > other.z - otherFootprint.halfZ &&
        minZ < other.z + otherFootprint.halfZ
      ) {
        return {
          valid: false,
          reason: "Buildings need space between them and cannot overlap.",
        };
      }
    }

    return { valid: true, reason: "" };
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
    this.expansionGuideGroup.visible = enabled && this.expansionMode;
    if (!enabled) {
      this.setExpansionRoadDrawEnabled(false);
      this.setExpansionStreetObjectPlacementTool(null);
    }
    for (const group of this.placedBuildingMeshes.values()) {
      const marker = group.getObjectByName("building-activity-marker");
      if (marker) marker.visible = !enabled;
      const entrance = group.getObjectByName("building-entrance-glow");
      if (entrance) entrance.visible = !enabled;
    }
    this.updateFeatureHighlights();
  }

  setEnvironment(timeOfDayHours: number, weather: WeatherMode): void {
    const hour = ((timeOfDayHours % 24) + 24) % 24;
    const daylight = THREE.MathUtils.clamp(
      (Math.cos(((hour - 12) / 12) * Math.PI) + 0.15) / 1.15,
      0.04,
      1,
    );
    const night = new THREE.Color("#101b2c");
    const day =
      weather === "fog"
        ? new THREE.Color("#aebdbc")
        : weather === "rain"
          ? new THREE.Color("#71858c")
          : new THREE.Color("#b8cfd0");
    const sky = night.clone().lerp(day, daylight);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(
      sky,
      weather === "fog" ? 0.00105 : weather === "rain" ? 0.00048 : 0.00026,
    );
    this.hemisphereLight.intensity = 0.35 + daylight * 2;
    this.sunLight.intensity =
      (weather === "rain" ? 1.7 : weather === "fog" ? 1.15 : 4.8) * daylight;
    const sunAngle = ((hour - 6) / 12) * Math.PI;
    this.sunLight.position.set(
      Math.cos(sunAngle) * 850,
      180 + Math.sin(sunAngle) * 900,
      470,
    );
    this.renderer.toneMappingExposure = 0.58 + daylight * 0.5;
    this.rainPoints.visible = weather === "rain";
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

    this.syncVehicles(state.vehicles, state.elapsedSeconds);
    this.syncPedestrians(state.pedestrians, state.elapsedSeconds);
    this.updateSignals(state.signals);
    this.updateEnvironmentEffects(frameSeconds, state.elapsedSeconds);

    if (this.cameraMode === "orbit") this.controls.update();
    this.updateCollisionDebug();
    this.renderer.render(this.scene, this.camera);
  }

  private updateEnvironmentEffects(
    frameSeconds: number,
    elapsedSeconds: number,
  ): void {
    if (this.rainPoints.visible) {
      const positions = this.rainPoints.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let index = 0; index < positions.count; index += 1) {
        const nextY = positions.getY(index) - frameSeconds * 115;
        positions.setY(index, nextY < 0 ? 150 + (index % 70) : nextY);
      }
      positions.needsUpdate = true;
    }
    const pulse = 0.42 + (Math.sin(elapsedSeconds * 4) + 1) * 0.18;
    for (const group of this.placedBuildingMeshes.values()) {
      const entrance = group.getObjectByName("building-entrance-glow");
      if (!(entrance instanceof THREE.Mesh)) continue;
      const material = entrance.material as THREE.MeshBasicMaterial;
      material.opacity = pulse;
    }
  }

  private buildLightingAndSky(): void {
    this.scene.add(this.hemisphereLight);

    this.sunLight.position.set(-620, 1_050, 470);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -1_050;
    this.sunLight.shadow.camera.right = 1_050;
    this.sunLight.shadow.camera.top = 1_050;
    this.sunLight.shadow.camera.bottom = -1_050;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 2_500;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.06;
    this.scene.add(this.sunLight);

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

  private buildExpansionProtectionGuide(): void {
    const grid = createExpansionGridOutsideCore();
    this.expansionGuideGroup.add(grid);

    const material = new THREE.MeshBasicMaterial({
      color: "#ffb45f",
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const width = CORE_BOUNDS.maxX - CORE_BOUNDS.minX;
    const depth = CORE_BOUNDS.maxZ - CORE_BOUNDS.minZ;
    const centerX = (CORE_BOUNDS.minX + CORE_BOUNDS.maxX) / 2;
    const centerZ = (CORE_BOUNDS.minZ + CORE_BOUNDS.maxZ) / 2;
    const thickness = 4;
    const north = box(width + thickness, 0.18, thickness, material);
    north.position.set(centerX, 0.44, CORE_BOUNDS.minZ);
    const south = north.clone();
    south.position.z = CORE_BOUNDS.maxZ;
    const west = box(thickness, 0.18, depth + thickness, material);
    west.position.set(CORE_BOUNDS.minX, 0.44, centerZ);
    const east = west.clone();
    east.position.x = CORE_BOUNDS.maxX;
    this.expansionGuideGroup.add(north, south, west, east);

    const connectorMaterial = new THREE.MeshBasicMaterial({
      color: "#7df3cc",
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const connector of ORIGINAL_ROAD_CONNECTORS) {
      const marker = new THREE.Mesh(
        new THREE.CircleGeometry(4.2, 24),
        connectorMaterial,
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(connector.x, 0.42, connector.z);
      this.expansionGuideGroup.add(marker);
      const outward = connectorOutwardVector(connector);
      const guide = createWorldSegmentMesh(
        connector.x,
        connector.z,
        connector.x + outward.x * (CORE_PROTECTION_PADDING + 16),
        connector.z + outward.z * (CORE_PROTECTION_PADDING + 16),
        1.4,
        0.03,
        connectorMaterial,
      );
      guide.position.y = 0.39;
      this.expansionGuideGroup.add(guide);
    }
    this.expansionGuideGroup.visible = false;
  }

  private addExpansionRoad(
    road: ExpansionRoad,
    junctions: readonly ExpansionJunction[],
  ): void {
    const group = new THREE.Group();
    group.userData.expansionRoadId = road.id;
    const width = expansionRoadWidth(road);
    const asphaltMaterial = this.materials.asphalt.clone();
    const asphalt = createWorldSegmentMesh(
      road.startX,
      road.startZ,
      road.endX,
      road.endZ,
      width,
      0.12,
      asphaltMaterial,
    );
    asphalt.name = "expansion-road-surface";
    asphalt.userData.expansionRoadId = road.id;
    asphalt.position.y = RENDER_HEIGHTS.roadSurface;
    asphalt.receiveShadow = true;
    asphalt.userData.walkable = true;
    group.add(asphalt);
    this.selectableExpansionRoads.push(asphalt);

    const connectedJunctions = junctions.filter((junction) =>
      junction.roadIds.has(road.id),
    );
    const visiblePieces = splitRoadAroundJunctions(
      road,
      connectedJunctions,
      width / 2 + 1,
    );
    for (const piece of visiblePieces) {
      const centerLine = createWorldSegmentMesh(
        piece.startX,
        piece.startZ,
        piece.endX,
        piece.endZ,
        0.24,
        0.03,
        this.materials.yellowLine,
        2,
      );
      centerLine.position.y = RENDER_HEIGHTS.roadMarking;
      group.add(centerLine);
    }

    const dx = road.endX - road.startX;
    const dz = road.endZ - road.startZ;
    const length = Math.hypot(dx, dz);
    const nx = length > 0 ? -dz / length : 0;
    const nz = length > 0 ? dx / length : 0;
    if (road.bikeLane) {
      for (const side of [-1, 1]) {
        for (const piece of visiblePieces) {
          const bikeLane = createWorldSegmentMesh(
            piece.startX + nx * (width / 2 - 1.15) * side,
            piece.startZ + nz * (width / 2 - 1.15) * side,
            piece.endX + nx * (width / 2 - 1.15) * side,
            piece.endZ + nz * (width / 2 - 1.15) * side,
            1.7,
            0.025,
            this.materials.bikeLane,
          );
          bikeLane.position.y = RENDER_HEIGHTS.roadMarking + 0.01;
          group.add(bikeLane);
        }
      }
    }
    if (road.widenedSidewalk) {
      const sidewalkOffset = width / 2 + SIDEWALK_WIDTH / 2 + 0.65;
      for (const side of [-1, 1]) {
        for (const piece of visiblePieces) {
          const sidewalk = createWorldSegmentMesh(
            piece.startX + nx * sidewalkOffset * side,
            piece.startZ + nz * sidewalkOffset * side,
            piece.endX + nx * sidewalkOffset * side,
            piece.endZ + nz * sidewalkOffset * side,
            SIDEWALK_WIDTH,
            0.28,
            this.materials.sidewalk,
          );
          sidewalk.position.y = RENDER_HEIGHTS.sidewalkCenter;
          sidewalk.receiveShadow = true;
          sidewalk.userData.walkable = true;
          group.add(sidewalk);
        }
      }
    }
    this.expansionRoadGroup.add(group);
  }

  private addExpansionJunction(junction: ExpansionJunction): void {
    const connectedRoads = Array.from(junction.roadIds)
      .map((id) => this.expansionRoadData.get(id))
      .filter((road): road is ExpansionRoad => road !== undefined);
    if (connectedRoads.length < 2) return;
    const width =
      Math.max(...connectedRoads.map((road) => expansionRoadWidth(road))) + 1;
    const group = new THREE.Group();
    group.userData.expansionJunction = true;

    const asphalt = box(width, 0.08, width, this.materials.asphalt);
    asphalt.position.set(junction.x, 0.12, junction.z);
    asphalt.receiveShadow = true;
    asphalt.userData.walkable = true;
    group.add(asphalt);

    const directions = junctionDirections(junction, connectedRoads);
    const lineOffset =
      width / 2 +
      EXPANSION_CROSSWALK_JUNCTION_GAP +
      EXPANSION_CROSSWALK_BAND_LENGTH +
      1.4;
    for (const direction of directions) {
      const horizontalApproach = direction === "west" || direction === "east";
      const stopLine = box(
        horizontalApproach ? 0.45 : width - 1,
        0.025,
        horizontalApproach ? width - 1 : 0.45,
        this.materials.whiteLine,
      );
      stopLine.position.set(
        junction.x +
          (direction === "west" ? -lineOffset : direction === "east" ? lineOffset : 0),
        RENDER_HEIGHTS.roadMarking + 0.01,
        junction.z +
          (direction === "north" ? -lineOffset : direction === "south" ? lineOffset : 0),
      );
      group.add(stopLine);
    }
    this.expansionRoadGroup.add(group);
  }

  private createExpansionCrosswalk(object: ExpansionStreetObject): THREE.Group {
    const group = new THREE.Group();
    group.position.set(object.x, 0, object.z);
    group.rotation.y = object.rotation;
    group.userData.expansionStreetObjectId = object.id;
    const nearestJunction = findExpansionJunctions([
      ...this.expansionRoadData.values(),
    ]).reduce<ExpansionJunction | null>((nearest, junction) => {
      if (!nearest) return junction;
      return Math.hypot(object.x - junction.x, object.z - junction.z) <
        Math.hypot(object.x - nearest.x, object.z - nearest.z)
        ? junction
        : nearest;
    }, null);
    const crossingSpan = nearestJunction
      ? Math.max(
          ...[...nearestJunction.roadIds]
            .map((roadId) => this.expansionRoadData.get(roadId))
            .filter((road): road is ExpansionRoad => road !== undefined)
            .map((road) => expansionRoadWidth(road)),
          13.5,
        )
      : 13.5;
    for (let index = -3; index <= 3; index += 1) {
      const stripe = box(1.15, 0.025, crossingSpan, this.materials.whiteLine);
      stripe.position.set(index * 1.85, RENDER_HEIGHTS.crosswalk, 0);
      group.add(stripe);
    }
    return group;
  }

  private createExpansionTrafficSignal(object: ExpansionStreetObject): THREE.Group {
    const group = new THREE.Group();
    group.position.set(object.x, 0, object.z);
    group.rotation.y = object.rotation;
    group.userData.expansionStreetObjectId = object.id;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 4.6, 10),
      this.materials.streetMetal,
    );
    pole.position.y = 2.3;
    pole.castShadow = true;
    const housing = box(0.72, 2.05, 0.62, this.materials.streetMetal);
    housing.position.set(0, 4.65, 0);
    housing.castShadow = true;
    group.add(pole, housing);
    const colors = ["#ff352e", "#ffd43b", "#42ef78"] as const;
    colors.forEach((color, index) => {
      const lensMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: index === 0 ? 2.2 : 0.15,
        roughness: 0.35,
      });
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 8),
        lensMaterial,
      );
      lens.scale.z = 0.45;
      lens.position.set(0, 5.25 - index * 0.58, 0.33);
      group.add(lens);
    });
    return group;
  }

  private updateExpansionRoadPreview(start: THREE.Vector3, end: THREE.Vector3): void {
    if (this.expansionRoadPreview) {
      this.expansionGuideGroup.remove(this.expansionRoadPreview);
      this.expansionRoadPreview.geometry.dispose();
      disposeMaterial(this.expansionRoadPreview.material);
    }
    const validation = this.validateExpansionRoad(start.x, start.z, end.x, end.z);
    const preview = createWorldSegmentMesh(
      start.x,
      start.z,
      end.x,
      end.z,
      15,
      0.16,
      new THREE.MeshBasicMaterial({
        color: validation.valid ? "#79f0c9" : "#ff5252",
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    preview.position.y = 0.34;
    this.expansionRoadPreview = preview;
    this.expansionGuideGroup.add(preview);
  }

  private clearExpansionRoadPreview(): void {
    if (!this.expansionRoadPreview) return;
    this.expansionGuideGroup.remove(this.expansionRoadPreview);
    this.expansionRoadPreview.geometry.dispose();
    disposeMaterial(this.expansionRoadPreview.material);
    this.expansionRoadPreview = null;
  }

  private snapExpansionPoint(point: THREE.Vector3): THREE.Vector3 {
    const snapped = point.clone();
    let closestDistance = 18;
    let snappedToEndpoint = false;
    for (const connector of ORIGINAL_ROAD_CONNECTORS) {
      const distance = Math.hypot(
        snapped.x - connector.x,
        snapped.z - connector.z,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        snapped.x = connector.x;
        snapped.z = connector.z;
        snappedToEndpoint = true;
      }
    }
    for (const road of this.expansionRoadData.values()) {
      for (const candidate of [
        [road.startX, road.startZ],
        [road.endX, road.endZ],
      ] as const) {
        const distance = Math.hypot(snapped.x - candidate[0], snapped.z - candidate[1]);
        if (distance < closestDistance) {
          closestDistance = distance;
          snapped.x = candidate[0];
          snapped.z = candidate[1];
          snappedToEndpoint = true;
        }
      }
    }
    if (!snappedToEndpoint) {
      snapped.x = Math.round(snapped.x / EXPANSION_GRID_SIZE) * EXPANSION_GRID_SIZE;
      snapped.z = Math.round(snapped.z / EXPANSION_GRID_SIZE) * EXPANSION_GRID_SIZE;
    }
    snapped.x = THREE.MathUtils.clamp(snapped.x, -EXPANSION_WORLD_LIMIT, EXPANSION_WORLD_LIMIT);
    snapped.z = THREE.MathUtils.clamp(snapped.z, -EXPANSION_WORLD_LIMIT, EXPANSION_WORLD_LIMIT);
    return snapped;
  }

  private snapOrthogonalExpansionEnd(
    start: THREE.Vector3,
    point: THREE.Vector3,
  ): THREE.Vector3 {
    const snapped = this.snapExpansionPoint(point);
    if (Math.abs(snapped.x - start.x) >= Math.abs(snapped.z - start.z)) {
      snapped.z = start.z;
    } else {
      snapped.x = start.x;
    }
    return snapped;
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

      const centerLine = createTrimmedSegmentMesh(
        feature,
        feature.name === "Market Street" ? 0.3 : 0.2,
        0.025,
        this.materials.yellowLine,
        ROAD_MARKING_END_INSET,
      );
      centerLine.position.y = RENDER_HEIGHTS.roadMarking;
      this.scene.add(centerLine);

      if (width >= MAJOR_ROAD_WIDTH) {
        for (const laneOffset of [-width * 0.25, width * 0.25]) {
          const laneLine = createTrimmedSegmentMesh(
            feature,
            0.14,
            0.02,
            this.materials.whiteLine,
            ROAD_MARKING_END_INSET,
          );
          laneLine.position.addScaledVector(normal, laneOffset);
          laneLine.position.y = RENDER_HEIGHTS.roadMarking + 0.01;
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
    const volume = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      [
        material,
        material,
        this.materials.rooftop,
        material,
        material,
        material,
      ],
    );
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
    const { width, depth } = getBuildingDimensions(building.kind);
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
    const entranceGlow = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.8, 28),
      new THREE.MeshBasicMaterial({
        color: "#79f0c9",
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    entranceGlow.name = "building-entrance-glow";
    entranceGlow.rotation.x = -Math.PI / 2;
    entranceGlow.position.set(0, 0.42, depth / 2 + 1.2);
    entranceGlow.visible = !this.buildMode;
    group.add(entranceGlow);

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
    const activityMarker = createBuildingActivityMarker(building);
    activityMarker.name = "building-activity-marker";
    activityMarker.position.y = height + (civic ? 4.8 : 4.2);
    activityMarker.visible = !this.buildMode;
    group.add(selectionRing, activityMarker);
    return group;
  }

  private updatePlacedBuildingSelection(): void {
    for (const [id, group] of this.placedBuildingMeshes) {
      const ring = group.getObjectByName("building-selection-ring");
      if (ring) ring.visible = id === this.selectedPlacedBuildingId;
    }
  }

  private updateExpansionRoadSelection(): void {
    for (const group of this.expansionRoadGroup.children) {
      const roadId =
        typeof group.userData.expansionRoadId === "string"
          ? group.userData.expansionRoadId
          : null;
      const surface = group.getObjectByName("expansion-road-surface");
      if (
        !(surface instanceof THREE.Mesh) ||
        !(surface.material instanceof THREE.MeshStandardMaterial)
      ) {
        continue;
      }
      const selected = roadId === this.selectedExpansionRoadId;
      surface.material.emissive.set(selected ? "#28d8ae" : "#000000");
      surface.material.emissiveIntensity = selected ? 0.7 : 0;
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
      if (
        this.buildMode &&
        this.cameraMode === "orbit" &&
        this.expansionStreetObjectPlacementTool === null
      ) {
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
            this.buildingInteractionHandlers?.onMoveStart(buildingId);
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
      if (this.drawingExpansionRoadStart) {
        this.updatePointerRay(event);
        if (this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)) {
          const end = this.snapOrthogonalExpansionEnd(
            this.drawingExpansionRoadStart,
            this.placementPoint,
          );
          this.updateExpansionRoadPreview(this.drawingExpansionRoadStart, end);
        }
        return;
      }
      if (this.draggingBuildingId) {
        this.updatePointerRay(event);
        const group = this.placedBuildingMeshes.get(this.draggingBuildingId);
        if (group && this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)) {
          const current = this.placedBuildingData.get(this.draggingBuildingId);
          if (!current) return;
          const x = THREE.MathUtils.clamp(
            this.placementPoint.x + this.dragOffset.x,
            -EXPANSION_WORLD_LIMIT,
            EXPANSION_WORLD_LIMIT,
          );
          const z = THREE.MathUtils.clamp(
            this.placementPoint.z + this.dragOffset.z,
            -EXPANSION_WORLD_LIMIT,
            EXPANSION_WORLD_LIMIT,
          );
          const candidate = { ...current, x, z };
          const placement = this.validateBuildingPlacement(
            candidate,
            this.draggingBuildingId,
          );
          if (!placement.valid) {
            this.buildingInteractionHandlers?.onPlacementRejected(placement.reason);
            return;
          }
          group.position.set(x, 0, z);
          this.placedBuildingData.set(candidate.id, candidate);
          this.buildingInteractionHandlers?.onMove(
            this.draggingBuildingId,
            x,
            z,
          );
        }
        return;
      }
      if (this.cameraMode !== "fly" || !this.looking) return;
      const deltaX = event.clientX - this.lastPointer.x;
      const deltaY = event.clientY - this.lastPointer.y;
      this.flyYaw += deltaX * 0.003;
      this.flyPitch = THREE.MathUtils.clamp(
        this.flyPitch + deltaY * 0.003,
        -Math.PI / 2 + 0.04,
        Math.PI / 2 - 0.04,
      );
      this.lastPointer.set(event.clientX, event.clientY);
      this.applyFlyRotation();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      const pointerTravel = Math.hypot(
        event.clientX - this.pointerDown.x,
        event.clientY - this.pointerDown.y,
      );
      if (
        this.buildMode &&
        this.expansionMode &&
        this.expansionRoadDrawEnabled &&
        this.cameraMode === "orbit" &&
        pointerTravel < 5
      ) {
        this.updatePointerRay(event);
        const hitGround = this.raycaster.ray.intersectPlane(
          this.placementPlane,
          this.placementPoint,
        );
        if (!hitGround) return;
        if (!this.drawingExpansionRoadStart) {
          const start = this.snapExpansionPoint(this.placementPoint);
          if (
            pointInsideBounds(start.x, start.z, CORE_BOUNDS) &&
            findOriginalRoadConnector(start.x, start.z) === null
          ) {
            this.expansionRoadInteractionHandlers?.onRejected(
              "Start the road outside the protected original city.",
            );
            return;
          }
          this.drawingExpansionRoadStart = start;
          this.updateExpansionRoadPreview(start, start);
          this.expansionRoadInteractionHandlers?.onStarted(start.x, start.z);
          return;
        }
        const start = this.drawingExpansionRoadStart;
        const end = this.snapOrthogonalExpansionEnd(start, this.placementPoint);
        const validation = this.validateExpansionRoad(start.x, start.z, end.x, end.z);
        if (validation.valid) {
          this.drawingExpansionRoadStart = null;
          this.clearExpansionRoadPreview();
          this.expansionRoadInteractionHandlers?.onComplete(
            start.x,
            start.z,
            end.x,
            end.z,
          );
        } else {
          this.expansionRoadInteractionHandlers?.onRejected(validation.reason);
        }
        return;
      }
      if (this.draggingBuildingId) {
        const completedBuildingId = this.draggingBuildingId;
        this.draggingBuildingId = null;
        this.controls.enabled = true;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        this.buildingInteractionHandlers?.onMoveEnd(completedBuildingId);
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
        event.code === "Escape" &&
        this.drawingExpansionRoadStart &&
        !isTypingTarget(event.target)
      ) {
        this.drawingExpansionRoadStart = null;
        this.clearExpansionRoadPreview();
        this.expansionRoadInteractionHandlers?.onCancelled();
        return;
      }
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
      this.flyYaw += event.movementX * 0.0022;
      this.flyPitch = THREE.MathUtils.clamp(
        this.flyPitch + event.movementY * 0.0022,
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
    if (
      this.expansionMode &&
      this.expansionStreetObjectPlacementTool &&
      this.raycaster.ray.intersectPlane(this.placementPlane, this.placementPoint)
    ) {
      const placement = this.resolveExpansionStreetObjectPlacement(
        this.expansionStreetObjectPlacementTool,
        this.placementPoint.x,
        this.placementPoint.z,
      );
      if (placement.valid) {
        this.expansionStreetObjectInteractionHandlers?.onPlace(
          this.expansionStreetObjectPlacementTool,
          placement.x,
          placement.z,
          placement.rotation,
        );
      } else {
        this.expansionStreetObjectInteractionHandlers?.onRejected(
          placement.reason,
        );
      }
      return;
    }
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
        THREE.MathUtils.clamp(
          this.placementPoint.x,
          -EXPANSION_WORLD_LIMIT,
          EXPANSION_WORLD_LIMIT,
        ),
        THREE.MathUtils.clamp(
          this.placementPoint.z,
          -EXPANSION_WORLD_LIMIT,
          EXPANSION_WORLD_LIMIT,
        ),
      );
      return;
    }
    const expansionRoadHit = this.raycaster.intersectObjects(
      this.selectableExpansionRoads,
      false,
    )[0];
    const expansionRoadId = expansionRoadHit?.object.userData.expansionRoadId;
    if (typeof expansionRoadId === "string") {
      this.expansionRoadSelectionHandler?.(expansionRoadId);
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
      const line = createTrimmedSegmentMesh(
        feature,
        0.22,
        0.03,
        this.materials.yellowLine,
        ROAD_MARKING_END_INSET,
      );
      line.position.y = RENDER_HEIGHTS.selectionSurface + 0.01;
      this.designGroup.add(line);
      if (design.laneDelta === 1) {
        for (const side of [-1, 1]) {
          const laneDivider = createTrimmedOffsetSegmentMesh(
            feature,
            side * 3.25,
            0.14,
            0.025,
            this.materials.whiteLine,
            ROAD_MARKING_END_INSET,
          );
          laneDivider.position.y = RENDER_HEIGHTS.selectionSurface + 0.015;
          this.designGroup.add(laneDivider);
        }
      }
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

  private syncVehicles(
    vehicles: readonly VehicleSnapshot[],
    elapsedSeconds: number,
  ): void {
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
      const violationFlash =
        vehicle.violating && Math.floor(elapsedSeconds * 5) % 2 === 0;
      updateCarAppearance(object, vehicle.color, vehicle.kind, violationFlash);
      setObjectMarkerVisibility(object, this.vehicleMarkersVisible);
    }
  }

  private syncPedestrians(
    pedestrians: readonly PedestrianSnapshot[],
    elapsedSeconds: number,
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
      updatePersonAppearance(
        object,
        pedestrian.color,
        pedestrian.variant,
        pedestrian.waiting,
        pedestrian.violating && Math.floor(elapsedSeconds * 5) % 2 === 0,
      );
      setObjectMarkerVisibility(object, this.pedestrianMarkersVisible);
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

function createProtectedCoreBounds(): SpatialBounds {
  const xs = PENN_AVENUES.map((avenue) =>
    geoToWorld({
      longitude: avenue.longitude,
      latitude: PENN_CENTER.latitude,
    }).x,
  );
  const zs = PENN_STREETS.map((street) =>
    geoToWorld({
      longitude: PENN_CENTER.longitude,
      latitude: street.latitude,
    }).z,
  );
  return {
    minX: Math.min(...xs) - CORE_PROTECTION_PADDING,
    maxX: Math.max(...xs) + CORE_PROTECTION_PADDING,
    minZ: Math.min(...zs) - CORE_PROTECTION_PADDING,
    maxZ: Math.max(...zs) + CORE_PROTECTION_PADDING,
  };
}

function createOriginalRoadConnectors(): OriginalRoadConnector[] {
  const avenueWorldX = PENN_AVENUES.map((avenue) =>
    geoToWorld({
      longitude: avenue.longitude,
      latitude: PENN_CENTER.latitude,
    }).x,
  );
  const streetWorldZ = PENN_STREETS.map((street) =>
    geoToWorld({
      longitude: PENN_CENTER.longitude,
      latitude: street.latitude,
    }).z,
  );
  const minX = Math.min(...avenueWorldX);
  const maxX = Math.max(...avenueWorldX);
  const minZ = Math.min(...streetWorldZ);
  const maxZ = Math.max(...streetWorldZ);
  const connectors: OriginalRoadConnector[] = [];
  for (const z of streetWorldZ) {
    connectors.push(
      { x: minX, z, side: "min-x" },
      { x: maxX, z, side: "max-x" },
    );
  }
  for (const x of avenueWorldX) {
    connectors.push(
      { x, z: minZ, side: "min-z" },
      { x, z: maxZ, side: "max-z" },
    );
  }
  return connectors;
}

function createExpansionGridOutsideCore(): THREE.LineSegments {
  const positions: number[] = [];
  const addLine = (startX: number, startZ: number, endX: number, endZ: number) => {
    positions.push(startX, 0.32, startZ, endX, 0.32, endZ);
  };
  for (
    let x = -EXPANSION_WORLD_LIMIT;
    x <= EXPANSION_WORLD_LIMIT;
    x += EXPANSION_GRID_SIZE
  ) {
    if (x > CORE_BOUNDS.minX && x < CORE_BOUNDS.maxX) {
      addLine(x, -EXPANSION_WORLD_LIMIT, x, CORE_BOUNDS.minZ);
      addLine(x, CORE_BOUNDS.maxZ, x, EXPANSION_WORLD_LIMIT);
    } else {
      addLine(x, -EXPANSION_WORLD_LIMIT, x, EXPANSION_WORLD_LIMIT);
    }
  }
  for (
    let z = -EXPANSION_WORLD_LIMIT;
    z <= EXPANSION_WORLD_LIMIT;
    z += EXPANSION_GRID_SIZE
  ) {
    if (z > CORE_BOUNDS.minZ && z < CORE_BOUNDS.maxZ) {
      addLine(-EXPANSION_WORLD_LIMIT, z, CORE_BOUNDS.minX, z);
      addLine(CORE_BOUNDS.maxX, z, EXPANSION_WORLD_LIMIT, z);
    } else {
      addLine(-EXPANSION_WORLD_LIMIT, z, EXPANSION_WORLD_LIMIT, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const material = new THREE.LineBasicMaterial({
    color: "#6ea99a",
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

function connectorOutwardVector(
  connector: OriginalRoadConnector,
): { x: number; z: number } {
  if (connector.side === "min-x") return { x: -1, z: 0 };
  if (connector.side === "max-x") return { x: 1, z: 0 };
  if (connector.side === "min-z") return { x: 0, z: -1 };
  return { x: 0, z: 1 };
}

function findOriginalRoadConnector(
  x: number,
  z: number,
): OriginalRoadConnector | null {
  return (
    ORIGINAL_ROAD_CONNECTORS.find(
      (connector) => Math.hypot(x - connector.x, z - connector.z) <= 0.75,
    ) ?? null
  );
}

function isValidOriginalRoadConnection(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): boolean {
  return ORIGINAL_ROAD_CONNECTORS.some((connector) => {
    const startMatches =
      Math.hypot(startX - connector.x, startZ - connector.z) <= 0.75;
    const endMatches =
      Math.hypot(endX - connector.x, endZ - connector.z) <= 0.75;
    return (
      (startMatches &&
        connectorAcceptsOutwardPoint(connector, endX, endZ)) ||
      (endMatches &&
        connectorAcceptsOutwardPoint(connector, startX, startZ))
    );
  });
}

function connectorAcceptsOutwardPoint(
  connector: OriginalRoadConnector,
  x: number,
  z: number,
): boolean {
  if (connector.side === "min-x") {
    return x < connector.x - 0.5 && Math.abs(z - connector.z) <= 0.75;
  }
  if (connector.side === "max-x") {
    return x > connector.x + 0.5 && Math.abs(z - connector.z) <= 0.75;
  }
  if (connector.side === "min-z") {
    return z < connector.z - 0.5 && Math.abs(x - connector.x) <= 0.75;
  }
  return z > connector.z + 0.5 && Math.abs(x - connector.x) <= 0.75;
}

function pointInsideBounds(x: number, z: number, bounds: SpatialBounds): boolean {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    z >= bounds.minZ &&
    z <= bounds.maxZ
  );
}

function rectanglesOverlap(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  otherMinX: number,
  otherMaxX: number,
  otherMinZ: number,
  otherMaxZ: number,
): boolean {
  return (
    maxX > otherMinX &&
    minX < otherMaxX &&
    maxZ > otherMinZ &&
    minZ < otherMaxZ
  );
}

function segmentIntersectsProtectedCore(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): boolean {
  if (
    pointInsideBounds(startX, startZ, CORE_BOUNDS) ||
    pointInsideBounds(endX, endZ, CORE_BOUNDS)
  ) {
    return true;
  }
  const edges = [
    [CORE_BOUNDS.minX, CORE_BOUNDS.minZ, CORE_BOUNDS.maxX, CORE_BOUNDS.minZ],
    [CORE_BOUNDS.maxX, CORE_BOUNDS.minZ, CORE_BOUNDS.maxX, CORE_BOUNDS.maxZ],
    [CORE_BOUNDS.maxX, CORE_BOUNDS.maxZ, CORE_BOUNDS.minX, CORE_BOUNDS.maxZ],
    [CORE_BOUNDS.minX, CORE_BOUNDS.maxZ, CORE_BOUNDS.minX, CORE_BOUNDS.minZ],
  ] as const;
  return edges.some(([aX, aZ, bX, bZ]) =>
    segmentsIntersect(startX, startZ, endX, endZ, aX, aZ, bX, bZ),
  );
}

function segmentsIntersect(
  aX: number,
  aZ: number,
  bX: number,
  bZ: number,
  cX: number,
  cZ: number,
  dX: number,
  dZ: number,
): boolean {
  const cross = (
    firstX: number,
    firstZ: number,
    secondX: number,
    secondZ: number,
  ) => firstX * secondZ - firstZ * secondX;
  const abX = bX - aX;
  const abZ = bZ - aZ;
  const cdX = dX - cX;
  const cdZ = dZ - cZ;
  const denominator = cross(abX, abZ, cdX, cdZ);
  if (Math.abs(denominator) < 0.000001) return false;
  const acX = cX - aX;
  const acZ = cZ - aZ;
  const t = cross(acX, acZ, cdX, cdZ) / denominator;
  const u = cross(acX, acZ, abX, abZ) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distanceToSegment(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(pointX - startX, pointZ - startZ);
  const t = THREE.MathUtils.clamp(
    ((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(pointX - (startX + dx * t), pointZ - (startZ + dz * t));
}

function findExpansionJunctions(
  roads: readonly ExpansionRoad[],
): ExpansionJunction[] {
  const junctions = new Map<string, ExpansionJunction>();
  const addJunction = (
    x: number,
    z: number,
    firstRoadId: string,
    secondRoadId: string,
  ) => {
    const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
    const junction = junctions.get(key) ?? {
      x,
      z,
      roadIds: new Set<string>(),
    };
    junction.roadIds.add(firstRoadId);
    junction.roadIds.add(secondRoadId);
    junctions.set(key, junction);
  };

  for (let firstIndex = 0; firstIndex < roads.length; firstIndex += 1) {
    const first = roads[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < roads.length; secondIndex += 1) {
      const second = roads[secondIndex];
      for (const [x, z] of [
        [first.startX, first.startZ],
        [first.endX, first.endZ],
      ] as const) {
        if (
          distanceToSegment(
            x,
            z,
            second.startX,
            second.startZ,
            second.endX,
            second.endZ,
          ) <= 0.25
        ) {
          addJunction(x, z, first.id, second.id);
        }
      }
      for (const [x, z] of [
        [second.startX, second.startZ],
        [second.endX, second.endZ],
      ] as const) {
        if (
          distanceToSegment(
            x,
            z,
            first.startX,
            first.startZ,
            first.endX,
            first.endZ,
          ) <= 0.25
        ) {
          addJunction(x, z, first.id, second.id);
        }
      }

      const firstHorizontal =
        Math.abs(first.endX - first.startX) >=
        Math.abs(first.endZ - first.startZ);
      const secondHorizontal =
        Math.abs(second.endX - second.startX) >=
        Math.abs(second.endZ - second.startZ);
      if (firstHorizontal === secondHorizontal) continue;
      const horizontal = firstHorizontal ? first : second;
      const vertical = firstHorizontal ? second : first;
      const x = vertical.startX;
      const z = horizontal.startZ;
      if (
        x >= Math.min(horizontal.startX, horizontal.endX) - 0.25 &&
        x <= Math.max(horizontal.startX, horizontal.endX) + 0.25 &&
        z >= Math.min(vertical.startZ, vertical.endZ) - 0.25 &&
        z <= Math.max(vertical.startZ, vertical.endZ) + 0.25
      ) {
        addJunction(x, z, first.id, second.id);
      }
    }
  }
  return [...junctions.values()];
}

function splitRoadAroundJunctions(
  road: ExpansionRoad,
  junctions: readonly ExpansionJunction[],
  padding: number,
): Array<Pick<ExpansionRoad, "startX" | "startZ" | "endX" | "endZ">> {
  const dx = road.endX - road.startX;
  const dz = road.endZ - road.startZ;
  const length = Math.hypot(dx, dz);
  if (length <= 0.1) return [];
  const unitX = dx / length;
  const unitZ = dz / length;
  const intervals = junctions
    .map((junction) => {
      const center =
        (junction.x - road.startX) * unitX +
        (junction.z - road.startZ) * unitZ;
      return {
        start: THREE.MathUtils.clamp(center - padding, 0, length),
        end: THREE.MathUtils.clamp(center + padding, 0, length),
      };
    })
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  const visible: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start - cursor > 0.5) {
      visible.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (length - cursor > 0.5) visible.push({ start: cursor, end: length });
  return visible.map((piece) => ({
    startX: road.startX + unitX * piece.start,
    startZ: road.startZ + unitZ * piece.start,
    endX: road.startX + unitX * piece.end,
    endZ: road.startZ + unitZ * piece.end,
  }));
}

function junctionDirections(
  junction: ExpansionJunction,
  roads: readonly ExpansionRoad[],
): Set<"north" | "south" | "east" | "west"> {
  const directions = new Set<"north" | "south" | "east" | "west">();
  for (const road of roads) {
    for (const [x, z] of [
      [road.startX, road.startZ],
      [road.endX, road.endZ],
    ] as const) {
      const dx = x - junction.x;
      const dz = z - junction.z;
      if (Math.abs(dx) > 0.5) directions.add(dx < 0 ? "west" : "east");
      if (Math.abs(dz) > 0.5) directions.add(dz < 0 ? "north" : "south");
    }
  }
  return directions;
}

function worldToGeo(x: number, z: number): GeoPoint {
  return {
    longitude: PENN_CENTER.longitude + x / METERS_PER_DEGREE_LONGITUDE,
    latitude: PENN_CENTER.latitude - z / METERS_PER_DEGREE_LATITUDE,
  };
}

function createWorldSegmentMesh(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  width: number,
  height: number,
  material: THREE.Material,
  endInset = 0,
): THREE.Mesh {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const fullLength = Math.hypot(dx, dz);
  const inset = Math.min(endInset, Math.max(0, fullLength / 2 - 0.1));
  const usableLength = Math.max(0.1, fullLength - inset * 2);
  const object = box(usableLength, height, width, material);
  object.position.set((startX + endX) / 2, height / 2, (startZ + endZ) / 2);
  object.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
  return object;
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

function createTrimmedSegmentMesh(
  feature: DistrictFeature,
  width: number,
  height: number,
  material: THREE.Material,
  endInset: number,
): THREE.Mesh {
  const [start, end] = feature.path.map(geoToWorld);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const inset = Math.min(endInset, Math.max(0, length / 2 - 0.5));
  const unit = direction.clone().normalize();
  const trimmedStart = start.clone().addScaledVector(unit, inset);
  const trimmedEnd = end.clone().addScaledVector(unit, -inset);
  const object = box(trimmedStart.distanceTo(trimmedEnd), height, width, material);
  object.position.copy(trimmedStart).add(trimmedEnd).multiplyScalar(0.5);
  object.position.y = height / 2;
  object.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI / 2;
  return object;
}

function createTrimmedOffsetSegmentMesh(
  feature: DistrictFeature,
  offset: number,
  width: number,
  height: number,
  material: THREE.Material,
  endInset: number,
): THREE.Mesh {
  const object = createTrimmedSegmentMesh(
    feature,
    width,
    height,
    material,
    endInset,
  );
  const [start, end] = feature.path.map(geoToWorld);
  const direction = end.clone().sub(start).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  object.position.addScaledVector(normal, offset);
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

function createGabledRoofGeometry(
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

function getBuildingDimensions(kind: BuildingKind): { width: number; depth: number } {
  if (kind === "industrial") return { width: 24, depth: 19 };
  if (kind === "civic") return { width: 18, depth: 17 };
  if (kind === "commercial") return { width: 17, depth: 15 };
  return { width: 15, depth: 14 };
}

function getBuildingFootprint(
  building: Pick<PlacedBuilding, "kind" | "rotation">,
): { halfX: number; halfZ: number } {
  const { width, depth } = getBuildingDimensions(building.kind);
  const cosine = Math.abs(Math.cos(building.rotation));
  const sine = Math.abs(Math.sin(building.rotation));
  return {
    halfX: (width * cosine + depth * sine) / 2,
    halfZ: (width * sine + depth * cosine) / 2,
  };
}

function createBuildingActivityMarker(building: PlacedBuilding): THREE.Sprite {
  const role = deriveBuildingRole(building);
  const labels: Record<BuildingKind, string> = {
    residential: `${role.residents} residents`,
    commercial: `${role.jobs} jobs · ${role.dailyVisitors} visits`,
    industrial: `${role.jobs} jobs · ${role.dailyFreightTrips} freight`,
    civic: `${role.jobs} jobs · ${role.dailyVisitors} visits`,
  };
  const colors: Record<BuildingKind, string> = {
    residential: "#df8b70",
    commercial: "#75bdd8",
    industrial: "#c8845c",
    civic: "#a69ce2",
  };
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable.");
  context.fillStyle = "rgba(12, 27, 30, 0.9)";
  context.beginPath();
  context.roundRect(8, 8, 496, 112, 28);
  context.fill();
  context.fillStyle = colors[building.kind];
  context.beginPath();
  context.arc(48, 64, 18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4fbf8";
  context.font = "700 30px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.fillText(labels[building.kind], 82, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
    }),
  );
  marker.scale.set(0.16, 0.04, 1);
  marker.renderOrder = 9;
  return marker;
}

function createRainPoints(): THREE.Points<
  THREE.BufferGeometry,
  THREE.PointsMaterial
> {
  const count = 1_600;
  const positions = new Float32Array(count * 3);
  const random = seededRandom(20260728);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 2_400;
    positions[index * 3 + 1] = random() * 190;
    positions[index * 3 + 2] = (random() - 0.5) * 2_400;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#c9e9f4",
      size: 1.35,
      transparent: true,
      opacity: 0.64,
      depthWrite: false,
    }),
  );
  points.visible = false;
  points.frustumCulled = false;
  return points;
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
  const marker = createEntityMarker("#72c8ff");
  marker.position.y = 3.35;
  group.add(marker);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true;
  });
  group.userData.paint = paint;
  group.userData.marker = marker;
  group.userData.markerMaterial = marker.material;
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
  const marker = createEntityMarker("#6ff3ce");
  marker.position.y = 3.15;
  group.add(body, head, marker);
  group.scale.setScalar(1.35);
  group.userData.clothing = clothing;
  group.userData.skin = skin;
  group.userData.marker = marker;
  group.userData.markerMaterial = marker.material;
  return group;
}

function createEntityMarker(color: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: getEntityMarkerTexture(),
    color,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const marker = new THREE.Sprite(material);
  marker.scale.set(0.018, 0.018, 1);
  marker.renderOrder = 8;
  return marker;
}

function setPoolMarkerVisibility(pool: readonly THREE.Group[], visible: boolean): void {
  for (const object of pool) setObjectMarkerVisibility(object, visible);
}

function setObjectMarkerVisibility(object: THREE.Group, visible: boolean): void {
  const marker = object.userData.marker as THREE.Sprite | undefined;
  if (marker) marker.visible = visible;
}

function updateCarAppearance(
  object: THREE.Group,
  color: string,
  kind: VehicleKind,
  violationFlash = false,
): void {
  const paint = object.userData.paint as THREE.MeshStandardMaterial | undefined;
  const markerMaterial = object.userData.markerMaterial as
    | THREE.SpriteMaterial
    | undefined;
  paint?.color.set(violationFlash ? "#ff2020" : color);
  if (paint) {
    paint.emissive.set(violationFlash ? "#ff0000" : "#000000");
    paint.emissiveIntensity = violationFlash ? 1.8 : 0;
  }
  markerMaterial?.color.set(violationFlash ? "#ff2020" : "#72c8ff");
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
  waiting: boolean,
  violationFlash = false,
): void {
  const clothing = object.userData.clothing as
    | THREE.MeshStandardMaterial
    | undefined;
  const skin = object.userData.skin as THREE.MeshStandardMaterial | undefined;
  const markerMaterial = object.userData.markerMaterial as
    | THREE.SpriteMaterial
    | undefined;
  clothing?.color.set(violationFlash ? "#ff2020" : color);
  if (clothing) {
    clothing.emissive.set(violationFlash ? "#ff0000" : "#000000");
    clothing.emissiveIntensity = violationFlash ? 1.8 : 0;
  }
  skin?.color.set(["#d9a477", "#8b5b3f", "#efc6a0", "#70442f"][variant % 4]);
  markerMaterial?.color.set(
    violationFlash ? "#ff2020" : waiting ? "#ffd166" : "#6ff3ce",
  );
}

let entityMarkerTexture: THREE.CanvasTexture | null = null;

function getEntityMarkerTexture(): THREE.CanvasTexture {
  if (entityMarkerTexture) return entityMarkerTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable.");
  context.beginPath();
  context.arc(32, 32, 21, 0, Math.PI * 2);
  context.fillStyle = "rgba(255,255,255,0.95)";
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "rgba(15,35,31,0.75)";
  context.stroke();
  entityMarkerTexture = new THREE.CanvasTexture(canvas);
  entityMarkerTexture.colorSpace = THREE.SRGBColorSpace;
  return entityMarkerTexture;
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

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function expansionRoadWidth(road: ExpansionRoad): number {
  return Math.max(7, road.width + (road.laneDelta ?? 0) * 3.2);
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
