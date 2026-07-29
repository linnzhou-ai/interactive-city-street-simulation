import * as THREE from "three";
import type {
  BuildingKind,
  ExpansionRoad,
  ExpansionStreetObject,
  ExpansionStreetObjectKind,
  MapOverlayMode,
  PlacedBuilding,
  RoadTrafficSnapshot,
} from "../models/types";
import {
  EXPANSION_GRID_SIZE,
  EXPANSION_WORLD_LIMIT,
  expansionBuildingFootprint,
  expansionBuildingSize,
  isBuildingRoadAdjacent,
  projectPointToRoad,
  resolveRoadsideBuilding,
  roadJunctions,
  snapRoadPoint,
} from "../core/expansionLayout";
import type {
  RoadJunction,
  RoadProjection,
} from "../core/expansionLayout";

const GRID_SIZE = EXPANSION_GRID_SIZE;
const WORLD_LIMIT = EXPANSION_WORLD_LIMIT;
const CORE_PADDING = 10;
const SURFACE_HEIGHT = 0.11;

export interface ExpansionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlacementResult {
  valid: boolean;
  reason: string;
}

export interface ExpansionBuilderHandlers {
  placeBuilding?: (x: number, z: number) => void;
  selectBuilding?: (id: string | null) => void;
  moveBuilding?: (
    id: string,
    x: number,
    z: number,
    rotation: number,
    finished: boolean,
  ) => void;
  createRoad?: (road: Omit<ExpansionRoad, "id">) => void;
  selectRoad?: (id: string | null) => void;
  placeStreetObject?: (
    object: Omit<ExpansionStreetObject, "id">,
  ) => void;
  erase?: (
    target: "road" | "street-object" | "building",
    id: string,
  ) => void;
  status?: (
    message: string,
    tone?: "info" | "success" | "warning" | "error",
  ) => void;
}

interface HitTarget {
  type: "road" | "street-object" | "building";
  id: string;
}

export class ExpansionBuilder {
  private readonly group = new THREE.Group();
  private readonly roadGroup = new THREE.Group();
  private readonly objectGroup = new THREE.Group();
  private readonly buildingGroup = new THREE.Group();
  private readonly boundaryGroup = new THREE.Group();
  private readonly guideGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private buildings: PlacedBuilding[] = [];
  private roads: ExpansionRoad[] = [];
  private objects: ExpansionStreetObject[] = [];
  private handlers: ExpansionBuilderHandlers = {};
  private enabled = false;
  private selectionEnabled = false;
  private roadDrawEnabled = false;
  private buildingPlacementEnabled = false;
  private eraseEnabled = false;
  private streetObjectTool: ExpansionStreetObjectKind | null = null;
  private roadStart: THREE.Vector3 | null = null;
  private draggingBuildingId: string | null = null;
  private selectedBuildingId: string | null = null;
  private selectedRoadId: string | null = null;
  private roadTraffic = new Map<string, RoadTrafficSnapshot>();
  private roadAnalysisMode: MapOverlayMode = "none";
  private roadAnalysisSignature = "";
  private highlightedRoadIds = new Set<string>();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly coreBounds: ExpansionBounds,
  ) {
    this.group.name = "user-expansion";
    this.group.add(
      this.roadGroup,
      this.objectGroup,
      this.buildingGroup,
      this.boundaryGroup,
      this.guideGroup,
    );
    this.boundaryGroup.add(createExpansionBoundaryGuide(this.coreBounds));
    this.boundaryGroup.visible = false;
    scene.add(this.group);
  }

  setHandlers(handlers: ExpansionBuilderHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.boundaryGroup.visible = enabled;
    this.guideGroup.visible = enabled;
    if (!enabled) {
      this.roadStart = null;
      this.draggingBuildingId = null;
      this.clearGuides();
    }
  }

  setSelectionEnabled(enabled: boolean): void {
    this.selectionEnabled = enabled;
  }

  setRoadAnalysis(
    mode: MapOverlayMode,
    traffic: readonly RoadTrafficSnapshot[],
  ): void {
    const signature = `${mode}:${traffic
      .filter((snapshot) => this.roads.some((road) => road.id === snapshot.segmentId))
      .map((snapshot) => `${snapshot.segmentId}:${Math.round(snapshot.congestionPercent / 5)}`)
      .join("|")}`;
    if (signature === this.roadAnalysisSignature) return;
    this.roadAnalysisSignature = signature;
    this.roadAnalysisMode = mode;
    this.roadTraffic = new Map(traffic.map((snapshot) => [snapshot.segmentId, snapshot]));
    this.setRoads(this.roads);
  }

  setHighlightedRoads(ids: readonly string[]): void {
    const next = new Set(ids);
    if (
      next.size === this.highlightedRoadIds.size
      && [...next].every((id) => this.highlightedRoadIds.has(id))
    ) return;
    this.highlightedRoadIds = next;
    this.setRoads(this.roads);
  }

  setRoadDrawEnabled(enabled: boolean): void {
    this.roadDrawEnabled = enabled;
    if (!enabled) {
      this.roadStart = null;
      this.clearGuides();
    }
  }

  setBuildingPlacementEnabled(enabled: boolean): void {
    this.buildingPlacementEnabled = enabled;
  }

  setStreetObjectTool(tool: ExpansionStreetObjectKind | null): void {
    this.streetObjectTool = tool;
  }

  setEraseEnabled(enabled: boolean): void {
    this.eraseEnabled = enabled;
  }

  setBuildings(buildings: readonly PlacedBuilding[]): void {
    this.buildings = buildings.map((building) => ({ ...building }));
    clearGroup(this.buildingGroup);
    for (const building of this.buildings) {
      const nearest = this.roads
        .map((road) => projectPointToRoad(road, building.x, building.z))
        .sort((left, right) => left.distance - right.distance)[0];
      this.buildingGroup.add(createBuildingMesh(
        building,
        building.id === this.selectedBuildingId,
        nearest,
      ));
    }
  }

  setRoads(roads: readonly ExpansionRoad[]): void {
    this.roads = roads.map((road) => ({ ...road }));
    clearGroup(this.roadGroup);
    for (const road of this.roads) {
      this.roadGroup.add(createRoadMesh(
        road,
        road.id === this.selectedRoadId || this.highlightedRoadIds.has(road.id),
        this.roadAnalysisMode === "congestion"
          ? this.roadTraffic.get(road.id)?.congestionPercent
          : undefined,
      ));
    }
    for (const junction of roadJunctions(this.roads)) {
      this.roadGroup.add(createRoadJunctionMesh(junction));
    }
    this.setBuildings(this.buildings);
  }

  setStreetObjects(objects: readonly ExpansionStreetObject[]): void {
    this.objects = objects.map((object) => ({ ...object }));
    clearGroup(this.objectGroup);
    for (const object of this.objects) {
      this.objectGroup.add(createStreetObjectMesh(object));
    }
  }

  setSelectedBuilding(id: string | null): void {
    this.selectedBuildingId = id;
    this.setBuildings(this.buildings);
  }

  setSelectedRoad(id: string | null): void {
    this.selectedRoadId = id;
    this.setRoads(this.roads);
  }

  validateBuildingPlacement(
    building: Readonly<PlacedBuilding>,
    ignoreId: string | null = building.id,
  ): PlacementResult {
    const geometry = this.validateBuildingGeometry(building, ignoreId);
    if (!geometry.valid) return geometry;
    if (!isBuildingRoadAdjacent(building, this.roads)) {
      return {
        valid: false,
        reason: "Buildings must occupy a grid parcel directly beside a user-built road.",
      };
    }
    return { valid: true, reason: "" };
  }

  resolveBuildingPlacement(
    building: Readonly<PlacedBuilding>,
  ): PlacedBuilding | null {
    return resolveRoadsideBuilding(
      building,
      this.roads,
      (candidate) => this.validateBuildingGeometry(candidate, building.id).valid,
    );
  }

  private validateBuildingGeometry(
    building: Readonly<PlacedBuilding>,
    ignoreId: string | null,
  ): PlacementResult {
    const footprint = buildingFootprint(building);
    if (
      Math.abs(building.x) > WORLD_LIMIT ||
      Math.abs(building.z) > WORLD_LIMIT
    ) {
      return { valid: false, reason: "Building is outside the expansion boundary." };
    }
    if (overlapsBounds(footprint, expandedBounds(this.coreBounds, CORE_PADDING))) {
      return { valid: false, reason: "The original city is protected." };
    }
    if (
      this.roads.some((road) =>
        rotatedRectIntersectsRoad(footprint, road, 5),
      )
    ) {
      return { valid: false, reason: "Building overlaps a road or sidewalk." };
    }
    if (
      this.buildings.some(
        (candidate) =>
          candidate.id !== ignoreId &&
          overlapsBounds(footprint, buildingFootprint(candidate)),
      )
    ) {
      return { valid: false, reason: "Building overlaps another building." };
    }
    return { valid: true, reason: "" };
  }

  validateRoad(road: Readonly<Omit<ExpansionRoad, "id">>): PlacementResult {
    const length = Math.hypot(road.endX - road.startX, road.endZ - road.startZ);
    if (length < GRID_SIZE) {
      return { valid: false, reason: "Road must span at least one grid cell." };
    }
    if (
      [road.startX, road.startZ, road.endX, road.endZ].some(
        (value) => Math.abs(value) > WORLD_LIMIT,
      )
    ) {
      return { valid: false, reason: "Road is outside the expansion boundary." };
    }
    const roadBounds = segmentBounds(road, road.width / 2);
    const protectedCore = expandedBounds(this.coreBounds, CORE_PADDING);
    if (
      pointInsideBounds(road.startX, road.startZ, protectedCore) &&
      pointInsideBounds(road.endX, road.endZ, protectedCore)
    ) {
      return { valid: false, reason: "The original city streets are protected." };
    }
    if (
      this.buildings.some((building) =>
        rotatedRectIntersectsRoad(buildingFootprint(building), road, 5),
      )
    ) {
      return { valid: false, reason: "Road overlaps a placed building." };
    }
    if (
      this.roads.some((candidate) => {
        const sameStart =
          Math.hypot(
            candidate.startX - road.startX,
            candidate.startZ - road.startZ,
          ) < 2;
        const sameEnd =
          Math.hypot(
            candidate.endX - road.endX,
            candidate.endZ - road.endZ,
          ) < 2;
        const reverseStart =
          Math.hypot(
            candidate.endX - road.startX,
            candidate.endZ - road.startZ,
          ) < 2;
        const reverseEnd =
          Math.hypot(
            candidate.startX - road.endX,
            candidate.startZ - road.endZ,
          ) < 2;
        return (sameStart && sameEnd) || (reverseStart && reverseEnd);
      })
    ) {
      return { valid: false, reason: "That expansion road already exists." };
    }
    if (!roadBounds) return { valid: false, reason: "Invalid road geometry." };
    return { valid: true, reason: "" };
  }

  validateRoadRemoval(id: string): PlacementResult {
    const remainingRoads = this.roads.filter((road) => road.id !== id);
    const disconnectedBuildings = this.buildings.filter(
      (building) =>
        isBuildingRoadAdjacent(building, this.roads)
        && !isBuildingRoadAdjacent(building, remainingRoads),
    );
    if (disconnectedBuildings.length > 0) {
      return {
        valid: false,
        reason: `${disconnectedBuildings.length} roadside building${disconnectedBuildings.length === 1 ? "" : "s"} would lose road access. Move or remove them first.`,
      };
    }
    return { valid: true, reason: "" };
  }

  resolveStreetObjectPlacement(
    x: number,
    z: number,
    kind: ExpansionStreetObjectKind,
  ): Omit<ExpansionStreetObject, "id"> | null {
    const road = nearestRoad(this.roads, x, z);
    if (!road || road.distance > road.road.width / 2 + 5) return null;
    const dx = road.road.endX - road.road.startX;
    const dz = road.road.endZ - road.road.startZ;
    const rotation = Math.atan2(dx, dz) + (kind === "crosswalk" ? Math.PI / 2 : 0);
    return {
      kind,
      x: snap(road.x),
      z: snap(road.z),
      rotation,
    };
  }

  isCrosswalkSupported(x: number, z: number): boolean {
    return this.resolveStreetObjectPlacement(x, z, "crosswalk") !== null;
  }

  pointerDown(clientX: number, clientY: number): boolean {
    if (!this.enabled) return false;
    if (
      this.eraseEnabled
      || this.roadDrawEnabled
      || this.streetObjectTool !== null
      || this.buildingPlacementEnabled
    ) return true;
    const hit = this.pickTarget(clientX, clientY);
    if (hit?.type !== "building") return false;
    this.draggingBuildingId = hit.id;
    this.handlers.selectBuilding?.(hit.id);
    return true;
  }

  pointerMove(clientX: number, clientY: number): boolean {
    if (!this.enabled || !this.draggingBuildingId) return false;
    const point = this.groundPoint(clientX, clientY);
    const building = this.buildings.find(
      (candidate) => candidate.id === this.draggingBuildingId,
    );
    if (!point || !building) return true;
    const candidate = {
      ...building,
      x: point.x,
      z: point.z,
    };
    const resolved = this.resolveBuildingPlacement(candidate);
    if (resolved && this.validateBuildingPlacement(resolved, building.id).valid) {
      building.x = resolved.x;
      building.z = resolved.z;
      building.rotation = resolved.rotation;
      this.setBuildings(this.buildings);
      this.handlers.moveBuilding?.(
        building.id,
        building.x,
        building.z,
        building.rotation,
        false,
      );
    }
    return true;
  }

  pointerUp(clientX: number, clientY: number, clicked: boolean): boolean {
    if (!this.enabled && !this.selectionEnabled) return false;
    if (this.draggingBuildingId) {
      const building = this.buildings.find(
        (candidate) => candidate.id === this.draggingBuildingId,
      );
      if (building) {
        this.handlers.moveBuilding?.(
          building.id,
          building.x,
          building.z,
          building.rotation,
          true,
        );
      }
      this.draggingBuildingId = null;
      return true;
    }
    if (!clicked) return false;
    const hit = this.pickTarget(clientX, clientY);
    if (this.eraseEnabled) {
      if (hit) {
        this.handlers.erase?.(hit.type, hit.id);
      } else {
        this.handlers.status?.(
          "Bulldoze only works on user-built roads, objects, and buildings.",
          "warning",
        );
      }
      return true;
    }
    const point = this.groundPoint(clientX, clientY);
    if (this.roadDrawEnabled) {
      if (!point) {
        this.handlers.status?.("Click visible ground to draw a road.", "error");
        return true;
      }
      const snappedPoint = snapRoadPoint(point.x, point.z, this.roads);
      const snapped = new THREE.Vector3(snappedPoint.x, 0, snappedPoint.z);
      if (!this.roadStart) {
        this.roadStart = snapped;
        this.showRoadStart(snapped);
        this.handlers.status?.(
          "Road start set. Click the endpoint; the road will snap horizontally or vertically.",
        );
      } else {
        const dx = Math.abs(snapped.x - this.roadStart.x);
        const dz = Math.abs(snapped.z - this.roadStart.z);
        const end =
          dx >= dz
            ? new THREE.Vector3(snapped.x, 0, this.roadStart.z)
            : new THREE.Vector3(this.roadStart.x, 0, snapped.z);
        const road = {
          startX: this.roadStart.x,
          startZ: this.roadStart.z,
          endX: end.x,
          endZ: end.z,
          width: 16,
          laneDelta: 0 as const,
          bikeLane: false,
          widenedSidewalk: false,
          laneDirection: "two-way" as const,
        };
        const validation = this.validateRoad(road);
        if (validation.valid) {
          this.handlers.createRoad?.(road);
        } else {
          this.handlers.status?.(validation.reason, "error");
        }
        this.roadStart = null;
        this.clearGuides();
      }
      return true;
    }
    if (this.streetObjectTool) {
      if (!point) {
        this.handlers.status?.("Click a user-built road to place this object.", "error");
        return true;
      }
      const placement = this.resolveStreetObjectPlacement(
        point.x,
        point.z,
        this.streetObjectTool,
      );
      if (placement) {
        this.handlers.placeStreetObject?.(placement);
      } else {
        this.handlers.status?.(
          "Crosswalks and traffic signals must be placed directly on a user-built road.",
          "error",
        );
      }
      return true;
    }
    if (this.buildingPlacementEnabled) {
      if (point) {
        this.handlers.placeBuilding?.(point.x, point.z);
      } else {
        this.handlers.status?.("Click visible expansion ground to place a building.", "error");
      }
      return true;
    }
    if (hit?.type === "building") {
      this.handlers.selectBuilding?.(hit.id);
      return true;
    }
    if (hit?.type === "road") {
      this.handlers.selectRoad?.(hit.id);
      return true;
    }
    return false;
  }

  cancelPendingRoad(): void {
    this.roadStart = null;
    this.clearGuides();
  }

  get isDragging(): boolean {
    return this.draggingBuildingId !== null;
  }

  get isEditing(): boolean {
    return this.enabled && (
      this.eraseEnabled
      || this.roadDrawEnabled
      || this.streetObjectTool !== null
      || this.buildingPlacementEnabled
    );
  }

  selectAt(clientX: number, clientY: number): boolean {
    if (!this.selectionEnabled) return false;
    const hit = this.pickTarget(clientX, clientY);
    if (hit?.type === "building") {
      this.handlers.selectBuilding?.(hit.id);
      return true;
    }
    if (hit?.type === "road") {
      this.handlers.selectRoad?.(hit.id);
      return true;
    }
    return false;
  }

  private groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, point)
      ? point
      : null;
  }

  private pickTarget(clientX: number, clientY: number): HitTarget | null {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      [this.objectGroup, this.buildingGroup, this.roadGroup],
      true,
    );
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && object !== this.group) {
        const type = object.userData.expansionType as HitTarget["type"] | undefined;
        const id = object.userData.expansionId as string | undefined;
        if (type && id) return { type, id };
        object = object.parent;
      }
    }
    return null;
  }

  private showRoadStart(point: THREE.Vector3): void {
    this.clearGuides();
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(4, 6, 24),
      new THREE.MeshBasicMaterial({
        color: "#58d7bd",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(point.x, SURFACE_HEIGHT + 0.12, point.z);
    this.guideGroup.add(marker);
  }

  private clearGuides(): void {
    clearGroup(this.guideGroup);
  }
}

function createExpansionBoundaryGuide(coreBounds: ExpansionBounds): THREE.Group {
  const guide = new THREE.Group();
  guide.name = "expansion-build-area-guide";
  const protectedBounds = expandedBounds(coreBounds, CORE_PADDING);
  const guideDepth = 180;
  const width = protectedBounds.maxX - protectedBounds.minX;
  const depth = protectedBounds.maxZ - protectedBounds.minZ;
  const material = new THREE.MeshBasicMaterial({
    color: "#65d8b8",
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const addBand = (
    bandWidth: number,
    bandDepth: number,
    x: number,
    z: number,
  ): void => {
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(bandWidth, bandDepth),
      material,
    );
    band.rotation.x = -Math.PI / 2;
    band.position.set(x, SURFACE_HEIGHT + 0.03, z);
    band.renderOrder = 2;
    guide.add(band);
  };
  const addGrid = (
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ): void => {
    const points: THREE.Vector3[] = [];
    for (let x = Math.ceil(minX / GRID_SIZE) * GRID_SIZE; x <= maxX; x += GRID_SIZE) {
      points.push(
        new THREE.Vector3(x, SURFACE_HEIGHT + 0.05, minZ),
        new THREE.Vector3(x, SURFACE_HEIGHT + 0.05, maxZ),
      );
    }
    for (let z = Math.ceil(minZ / GRID_SIZE) * GRID_SIZE; z <= maxZ; z += GRID_SIZE) {
      points.push(
        new THREE.Vector3(minX, SURFACE_HEIGHT + 0.05, z),
        new THREE.Vector3(maxX, SURFACE_HEIGHT + 0.05, z),
      );
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: "#8fdac6",
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    grid.renderOrder = 2;
    guide.add(grid);
  };
  const outerMinX = protectedBounds.minX - guideDepth;
  const outerMaxX = protectedBounds.maxX + guideDepth;
  const outerMinZ = protectedBounds.minZ - guideDepth;
  const outerMaxZ = protectedBounds.maxZ + guideDepth;
  addBand(
    width + guideDepth * 2,
    guideDepth,
    (protectedBounds.minX + protectedBounds.maxX) / 2,
    protectedBounds.minZ - guideDepth / 2,
  );
  addBand(
    width + guideDepth * 2,
    guideDepth,
    (protectedBounds.minX + protectedBounds.maxX) / 2,
    protectedBounds.maxZ + guideDepth / 2,
  );
  addBand(
    guideDepth,
    depth,
    protectedBounds.minX - guideDepth / 2,
    (protectedBounds.minZ + protectedBounds.maxZ) / 2,
  );
  addGrid(outerMinX, outerMaxX, outerMinZ, protectedBounds.minZ);
  addGrid(outerMinX, outerMaxX, protectedBounds.maxZ, outerMaxZ);
  addGrid(outerMinX, protectedBounds.minX, protectedBounds.minZ, protectedBounds.maxZ);
  addGrid(protectedBounds.maxX, outerMaxX, protectedBounds.minZ, protectedBounds.maxZ);
  addBand(
    guideDepth,
    depth,
    protectedBounds.maxX + guideDepth / 2,
    (protectedBounds.minZ + protectedBounds.maxZ) / 2,
  );

  const outlinePoints = [
    new THREE.Vector3(protectedBounds.minX, SURFACE_HEIGHT + 0.08, protectedBounds.minZ),
    new THREE.Vector3(protectedBounds.maxX, SURFACE_HEIGHT + 0.08, protectedBounds.minZ),
    new THREE.Vector3(protectedBounds.maxX, SURFACE_HEIGHT + 0.08, protectedBounds.maxZ),
    new THREE.Vector3(protectedBounds.minX, SURFACE_HEIGHT + 0.08, protectedBounds.maxZ),
  ];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(outlinePoints),
    new THREE.LineBasicMaterial({
      color: "#f0c875",
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  outline.renderOrder = 3;
  guide.add(outline);
  return guide;
}

function createRoadMesh(
  road: ExpansionRoad,
  selected: boolean,
  congestionPercent?: number,
): THREE.Group {
  const group = targetGroup("road", road.id);
  const dx = road.endX - road.startX;
  const dz = road.endZ - road.startZ;
  const length = Math.hypot(dx, dz);
  const centerX = (road.startX + road.endX) / 2;
  const centerZ = (road.startZ + road.endZ) / 2;
  const heading = Math.atan2(dx, dz);
  const congestionColor = congestionPercent === undefined
    ? null
    : new THREE.Color().setHSL(
        (1 - Math.min(100, Math.max(0, congestionPercent)) / 100) * 0.32,
        0.72,
        0.47,
      );
  const roadSurface = box(
    road.width,
    0.18,
    length + 0.8,
    new THREE.MeshStandardMaterial({
      color: selected ? "#44595a" : congestionColor ?? "#2c3337",
      roughness: 0.97,
    }),
  );
  roadSurface.position.set(centerX, SURFACE_HEIGHT, centerZ);
  roadSurface.rotation.y = heading;
  roadSurface.receiveShadow = true;
  group.add(roadSurface);

  const sidewalkWidth = road.widenedSidewalk ? 5.5 : 3.5;
  const sideOffset = road.width / 2 + sidewalkWidth / 2;
  for (const side of [-1, 1]) {
    const sidewalk = box(
      sidewalkWidth,
      0.25,
      length + 0.8,
      new THREE.MeshStandardMaterial({ color: "#c7c5ba", roughness: 0.94 }),
    );
    sidewalk.position.set(
      centerX + Math.cos(heading) * sideOffset * side,
      SURFACE_HEIGHT + 0.08,
      centerZ - Math.sin(heading) * sideOffset * side,
    );
    sidewalk.rotation.y = heading;
    sidewalk.receiveShadow = true;
    group.add(sidewalk);
    const curb = box(
      0.35,
      0.34,
      length + 0.8,
      new THREE.MeshStandardMaterial({ color: "#ddd9cf", roughness: 0.94 }),
    );
    curb.position.set(
      centerX + Math.cos(heading) * (road.width / 2 + 0.18) * side,
      SURFACE_HEIGHT + 0.13,
      centerZ - Math.sin(heading) * (road.width / 2 + 0.18) * side,
    );
    curb.rotation.y = heading;
    group.add(curb);
  }

  const yellowMaterial = new THREE.MeshBasicMaterial({ color: "#f1ca56" });
  const whiteMaterial = new THREE.MeshBasicMaterial({ color: "#f1efe8" });
  if ((road.laneDirection ?? "two-way") === "two-way") {
    addRoadLine(group, centerX, centerZ, heading, length, -0.18, 0.13, yellowMaterial);
    addRoadLine(group, centerX, centerZ, heading, length, 0.18, 0.13, yellowMaterial);
  } else {
    addDashedRoadLine(group, centerX, centerZ, heading, length, 0, whiteMaterial);
  }
  const travelLaneCount = Math.max(1, Math.min(4, 2 + (road.laneDelta ?? 0)));
  for (let divider = 1; divider < travelLaneCount; divider += 1) {
    const offset = -road.width / 2 + road.width * divider / travelLaneCount;
    if (Math.abs(offset) < 0.5 && (road.laneDirection ?? "two-way") === "two-way") {
      continue;
    }
    addDashedRoadLine(
      group,
      centerX,
      centerZ,
      heading,
      length,
      offset,
      whiteMaterial,
    );
  }
  for (const edgeOffset of [-road.width / 2 + 0.55, road.width / 2 - 0.55]) {
    addRoadLine(group, centerX, centerZ, heading, length, edgeOffset, 0.1, whiteMaterial);
  }
  if (road.bikeLane) {
    const bikeLane = box(
      2.3,
      0.03,
      Math.max(1, length - 1),
      new THREE.MeshBasicMaterial({ color: "#2ca79f", transparent: true, opacity: 0.9 }),
    );
    bikeLane.position.set(
      centerX + Math.cos(heading) * (road.width / 2 - 1.7),
      SURFACE_HEIGHT + 0.115,
      centerZ - Math.sin(heading) * (road.width / 2 - 1.7),
    );
    bikeLane.rotation.y = heading;
    group.add(bikeLane);
  }
  return group;
}

function createRoadJunctionMesh(junction: Readonly<RoadJunction>): THREE.Group {
  const group = new THREE.Group();
  const size = (junction.radius + 4.2) * 2;
  const surface = new THREE.Mesh(
    new THREE.BoxGeometry(size, 0.2, size),
    new THREE.MeshStandardMaterial({ color: "#2c3337", roughness: 0.92 }),
  );
  surface.position.set(junction.x, SURFACE_HEIGHT + 0.02, junction.z);
  surface.receiveShadow = true;
  group.add(surface);
  return group;
}

function addRoadLine(
  group: THREE.Group,
  centerX: number,
  centerZ: number,
  heading: number,
  length: number,
  lateralOffset: number,
  width: number,
  material: THREE.Material,
): void {
  const line = box(width, 0.035, Math.max(1, length - 1), material);
  line.position.set(
    centerX + Math.cos(heading) * lateralOffset,
    SURFACE_HEIGHT + 0.125,
    centerZ - Math.sin(heading) * lateralOffset,
  );
  line.rotation.y = heading;
  group.add(line);
}

function addDashedRoadLine(
  group: THREE.Group,
  centerX: number,
  centerZ: number,
  heading: number,
  length: number,
  lateralOffset: number,
  material: THREE.Material,
): void {
  const dashCount = Math.max(1, Math.floor(length / 14));
  for (let index = 0; index < dashCount; index += 1) {
    const along = -length / 2 + ((index + 0.5) * length) / dashCount;
    const dash = box(0.12, 0.035, Math.min(5.5, length / dashCount * 0.55), material);
    dash.position.set(
      centerX + Math.sin(heading) * along + Math.cos(heading) * lateralOffset,
      SURFACE_HEIGHT + 0.13,
      centerZ + Math.cos(heading) * along - Math.sin(heading) * lateralOffset,
    );
    dash.rotation.y = heading;
    group.add(dash);
  }
}

function createStreetObjectMesh(object: ExpansionStreetObject): THREE.Group {
  const group = targetGroup("street-object", object.id);
  group.position.set(object.x, SURFACE_HEIGHT + 0.18, object.z);
  group.rotation.y = object.rotation;
  if (object.kind === "crosswalk") {
    const material = new THREE.MeshBasicMaterial({ color: "#f4f1e7" });
    for (let index = -4; index <= 4; index += 1) {
      const stripe = box(1.1, 0.035, 8, material);
      stripe.position.x = index * 1.65;
      group.add(stripe);
    }
  } else {
    const pole = box(
      0.45,
      5.8,
      0.45,
      new THREE.MeshStandardMaterial({ color: "#202925", roughness: 0.8 }),
    );
    pole.position.y = 2.9;
    const signal = box(
      1.2,
      2.7,
      0.9,
      new THREE.MeshStandardMaterial({ color: "#18201d", roughness: 0.7 }),
    );
    signal.position.set(0, 5.2, 0);
    const red = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshBasicMaterial({ color: "#f05a4a" }),
    );
    red.position.set(0, 5.75, 0.47);
    group.add(pole, signal, red);
  }
  return group;
}

function createBuildingMesh(
  building: PlacedBuilding,
  selected: boolean,
  nearestRoad?: Readonly<RoadProjection>,
): THREE.Group {
  const group = targetGroup("building", building.id);
  const size = buildingSize(building.kind);
  const height = Math.max(4, building.floors * 3.2);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: building.color,
    roughness: 0.78,
  });
  const parcel = box(
    size.width + 5,
    0.16,
    size.depth + 5,
    new THREE.MeshStandardMaterial({ color: "#9fa79d", roughness: 1 }),
  );
  parcel.position.y = SURFACE_HEIGHT + 0.02;
  parcel.receiveShadow = true;
  const body = box(size.width, height, size.depth, wallMaterial);
  body.position.y = height / 2 + 0.15;
  body.castShadow = true;
  body.receiveShadow = true;
  const roof = box(
    size.width + 0.6,
    0.55,
    size.depth + 0.6,
    new THREE.MeshStandardMaterial({
      color: selected ? "#58d7bd" : darken(building.color, 0.55),
      roughness: 0.85,
    }),
  );
  roof.position.y = height + 0.42;
  group.add(parcel, body, roof);

  if (nearestRoad) {
    const worldDx = nearestRoad.x - building.x;
    const worldDz = nearestRoad.z - building.z;
    const cosine = Math.cos(building.rotation);
    const sine = Math.sin(building.rotation);
    const localDx = worldDx * cosine - worldDz * sine;
    const localDz = worldDx * sine + worldDz * cosine;
    const distance = Math.hypot(localDx, localDz);
    const directionX = distance > 0 ? localDx / distance : 0;
    const directionZ = distance > 0 ? localDz / distance : 1;
    const buildingEdge = Math.abs(directionX) * size.width / 2
      + Math.abs(directionZ) * size.depth / 2;
    const sidewalkEdge = nearestRoad.road.width / 2
      + (nearestRoad.road.widenedSidewalk ? 5.5 : 3.5);
    const pathLength = Math.max(1.5, distance - buildingEdge - sidewalkEdge);
    const path = box(
      3,
      0.12,
      pathLength,
      new THREE.MeshStandardMaterial({ color: "#d0d4cc", roughness: 1 }),
    );
    const centerDistance = buildingEdge + pathLength / 2;
    path.position.set(
      directionX * centerDistance,
      SURFACE_HEIGHT + 0.12,
      directionZ * centerDistance,
    );
    path.rotation.y = Math.atan2(directionX, directionZ);
    group.add(path);
  }

  const windowMaterial = new THREE.MeshBasicMaterial({
    color: building.kind === "industrial" ? "#9fc5c2" : "#d8e5c5",
  });
  const visibleFloors = Math.min(building.floors, 12);
  for (let floor = 0; floor < visibleFloors; floor += 1) {
    const y = 2.1 + floor * (height - 2) / Math.max(1, visibleFloors);
    for (const side of [-1, 1]) {
      const windows = box(size.width * 0.62, 0.65, 0.08, windowMaterial);
      windows.position.set(0, y, side * (size.depth / 2 + 0.045));
      group.add(windows);
    }
  }
  group.position.set(building.x, 0, building.z);
  group.rotation.y = building.rotation;
  return group;
}

function targetGroup(type: HitTarget["type"], id: string): THREE.Group {
  const group = new THREE.Group();
  group.userData.expansionType = type;
  group.userData.expansionId = id;
  return group;
}

function buildingSize(kind: BuildingKind): { width: number; depth: number } {
  return expansionBuildingSize(kind);
}

function buildingFootprint(
  building: Readonly<PlacedBuilding>,
): ExpansionBounds {
  return expansionBuildingFootprint(building);
}

function rotatedRectIntersectsRoad(
  footprint: ExpansionBounds,
  road: Readonly<Omit<ExpansionRoad, "id">>,
  padding: number,
): boolean {
  return overlapsBounds(footprint, segmentBounds(road, road.width / 2 + padding));
}

function segmentBounds(
  road: Readonly<Omit<ExpansionRoad, "id">>,
  padding: number,
): ExpansionBounds {
  return {
    minX: Math.min(road.startX, road.endX) - padding,
    maxX: Math.max(road.startX, road.endX) + padding,
    minZ: Math.min(road.startZ, road.endZ) - padding,
    maxZ: Math.max(road.startZ, road.endZ) + padding,
  };
}

function nearestRoad(
  roads: readonly ExpansionRoad[],
  x: number,
  z: number,
): { road: ExpansionRoad; x: number; z: number; distance: number } | null {
  let nearest: { road: ExpansionRoad; x: number; z: number; distance: number } | null =
    null;
  for (const road of roads) {
    const dx = road.endX - road.startX;
    const dz = road.endZ - road.startZ;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared === 0) continue;
    const t = THREE.MathUtils.clamp(
      ((x - road.startX) * dx + (z - road.startZ) * dz) / lengthSquared,
      0,
      1,
    );
    const projectedX = road.startX + dx * t;
    const projectedZ = road.startZ + dz * t;
    const distance = Math.hypot(x - projectedX, z - projectedZ);
    if (!nearest || distance < nearest.distance) {
      nearest = { road, x: projectedX, z: projectedZ, distance };
    }
  }
  return nearest;
}

function expandedBounds(bounds: ExpansionBounds, padding: number): ExpansionBounds {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minZ: bounds.minZ - padding,
    maxZ: bounds.maxZ + padding,
  };
}

function overlapsBounds(a: ExpansionBounds, b: ExpansionBounds): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

function pointInsideBounds(x: number, z: number, bounds: ExpansionBounds): boolean {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    z >= bounds.minZ &&
    z <= bounds.maxZ
  );
}

function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function darken(color: string, factor: number): string {
  const parsed = new THREE.Color(color);
  parsed.multiplyScalar(factor);
  return `#${parsed.getHexString()}`;
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}
