import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  DesignElement,
  GridCellDesign,
  GridSignalDesign,
  IntersectionLayout,
  SimulationState,
} from "../models/types";
import { BUILD_CELL_SIZE, BUILD_GRID_SIZE } from "../models/types";

const ROAD_WIDTH = 8;
const ROUTE_LENGTH = 36;
type RoadArm = "north" | "east" | "south" | "west";

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly vehicle = new THREE.Group();
  private readonly pedestrian = new THREE.Group();
  private readonly vehicleSignals: THREE.MeshStandardMaterial[] = [];
  private readonly pedestrianSignals: THREE.MeshStandardMaterial[] = [];
  private readonly designGroups: Record<DesignElement, THREE.Group> = {
    lane: new THREE.Group(),
    "white-lane": new THREE.Group(),
    asphalt: new THREE.Group(),
    sidewalk: new THREE.Group(),
    crosswalk: new THREE.Group(),
    signal: new THREE.Group(),
  };
  private readonly roadArms = createRoadArmGroups();
  private readonly crosswalkArms = createRoadArmGroups();
  private readonly buildGridGroup = new THREE.Group();
  private readonly buildGridHelper = new THREE.GridHelper(
    BUILD_GRID_SIZE * BUILD_CELL_SIZE,
    BUILD_GRID_SIZE,
    "#75e4c4",
    "#8aa99c",
  );
  private intersectionLayout: IntersectionLayout = "four-way";
  private layoutRotation = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color("#b9d4df");
    this.scene.fog = new THREE.Fog("#b9d4df", 38, 78);

    this.camera.position.set(18, 18, 20);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 64;
    this.controls.maxPolarAngle = Math.PI / 2.08;

    this.buildLighting();
    this.buildCity();
    this.buildVehicle();
    this.buildPedestrian();
  }

  setDesignElementVisible(element: DesignElement, visible: boolean): void {
    this.designGroups[element].visible = visible;
  }

  setBuildMode(enabled: boolean): void {
    this.buildGridHelper.visible = enabled;
    this.vehicle.visible = !enabled;
    this.pedestrian.visible = !enabled;
  }

  setGridDesign(
    cells: readonly GridCellDesign[],
    signals: readonly GridSignalDesign[] = [],
  ): void {
    this.clearBuildGrid();
    for (const group of Object.values(this.designGroups)) {
      group.visible = false;
    }

    for (const cell of cells) {
      this.buildGridCell(cell);
    }
    this.addAutomaticStopLines(cells);
    for (const signal of signals) {
      this.buildGridSignal(signal);
    }
  }

  setIntersectionLayout(layout: IntersectionLayout): void {
    this.intersectionLayout = layout;
    this.layoutRotation = 0;
    this.updateIntersectionLayout();
  }

  rotateIntersection(): void {
    this.layoutRotation = (this.layoutRotation + 1) % 4;
    this.updateIntersectionLayout();
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.camera.aspect = bounds.width / Math.max(bounds.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(bounds.width, bounds.height, false);
  }

  render(state: Readonly<SimulationState>): void {
    this.vehicle.position.x = -ROUTE_LENGTH / 2 + state.vehicle.progress * ROUTE_LENGTH;
    this.pedestrian.position.z = -5.6 + state.pedestrian.progress * 11.2;

    const vehiclesGo = state.signalPhase === "vehicles";
    for (const material of this.vehicleSignals) {
      material.color.set(vehiclesGo ? "#55df88" : "#ff5e57");
      material.emissive.set(vehiclesGo ? "#168b47" : "#a52424");
    }
    for (const material of this.pedestrianSignals) {
      material.color.set(vehiclesGo ? "#ff5e57" : "#55df88");
      material.emissive.set(vehiclesGo ? "#a52424" : "#168b47");
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private buildLighting(): void {
    const hemisphere = new THREE.HemisphereLight("#e8f6ff", "#486247", 2.3);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight("#fff3d7", 4.2);
    sun.position.set(16, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    this.scene.add(sun);
  }

  private buildCity(): void {
    const ground = mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: "#7fa875", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    for (const group of Object.values(this.designGroups)) {
      this.scene.add(group);
    }
    this.buildGridHelper.position.y = 0.58;
    this.buildGridHelper.visible = false;
    this.scene.add(this.buildGridHelper);
    this.scene.add(this.buildGridGroup);

    for (const group of Object.values(this.roadArms)) {
      this.designGroups.lane.add(group);
    }
    for (const group of Object.values(this.crosswalkArms)) {
      this.designGroups.crosswalk.add(group);
    }

    this.addBox(0, 0.05, 0, ROAD_WIDTH, 0.1, ROAD_WIDTH, "#29343a", true, this.designGroups.lane);
    this.addBox(0, 0.05, -22, ROAD_WIDTH, 0.1, 36, "#29343a", true, this.roadArms.north);
    this.addBox(22, 0.05, 0, 36, 0.1, ROAD_WIDTH, "#29343a", true, this.roadArms.east);
    this.addBox(0, 0.05, 22, ROAD_WIDTH, 0.1, 36, "#29343a", true, this.roadArms.south);
    this.addBox(-22, 0.05, 0, 36, 0.1, ROAD_WIDTH, "#29343a", true, this.roadArms.west);

    this.addSidewalk(-13, -13, 16, 16);
    this.addSidewalk(13, -13, 16, 16);
    this.addSidewalk(-13, 13, 16, 16);
    this.addSidewalk(13, 13, 16, 16);
    this.addRoadMarkings();
    this.addCrosswalks();
    this.addBuildings();
    this.addSignals();
    this.updateIntersectionLayout();
  }

  private addSidewalk(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, 0.18, z, width, 0.36, depth, "#c7c8be", true, this.designGroups.sidewalk);
    this.addBox(
      x,
      0.39,
      z,
      width - 0.8,
      0.08,
      depth - 0.8,
      "#93af82",
      true,
      this.designGroups.sidewalk,
    );
  }

  private addRoadMarkings(): void {
    for (let offset = -36; offset <= 36; offset += 4) {
      if (Math.abs(offset) < 5) continue;
      const horizontalArm = offset < 0 ? this.roadArms.west : this.roadArms.east;
      const verticalArm = offset < 0 ? this.roadArms.north : this.roadArms.south;
      this.addBox(
        offset,
        0.12,
        0,
        2,
        0.03,
        0.12,
        "#f6ca55",
        false,
        horizontalArm,
      );
      this.addBox(
        0,
        0.12,
        offset,
        0.12,
        0.03,
        2,
        "#f6ca55",
        false,
        verticalArm,
      );
    }
  }

  private addCrosswalks(): void {
    for (let index = -4; index <= 4; index += 1) {
      this.addBox(
        index * 0.78,
        0.13,
        -5.2,
        0.44,
        0.025,
        1.8,
        "#f2efe6",
        false,
        this.crosswalkArms.north,
      );
      this.addBox(
        index * 0.78,
        0.13,
        5.2,
        0.44,
        0.025,
        1.8,
        "#f2efe6",
        false,
        this.crosswalkArms.south,
      );
      this.addBox(
        -5.2,
        0.13,
        index * 0.78,
        1.8,
        0.025,
        0.44,
        "#f2efe6",
        false,
        this.crosswalkArms.west,
      );
      this.addBox(
        5.2,
        0.13,
        index * 0.78,
        1.8,
        0.025,
        0.44,
        "#f2efe6",
        false,
        this.crosswalkArms.east,
      );
    }
  }

  private updateIntersectionLayout(): void {
    const visibleArms = new Set<RoadArm>();

    if (this.intersectionLayout === "four-way") {
      for (const arm of roadArmNames) visibleArms.add(arm);
    } else if (this.intersectionLayout === "t-junction") {
      const missingArms: RoadArm[] = ["south", "west", "north", "east"];
      const missingArm = missingArms[this.layoutRotation];
      for (const arm of roadArmNames) {
        if (arm !== missingArm) visibleArms.add(arm);
      }
    } else if (this.layoutRotation % 2 === 0) {
      visibleArms.add("east");
      visibleArms.add("west");
    } else {
      visibleArms.add("north");
      visibleArms.add("south");
    }

    for (const arm of roadArmNames) {
      const visible = visibleArms.has(arm);
      this.roadArms[arm].visible = visible;
      this.crosswalkArms[arm].visible = visible;
    }
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
    housing.castShadow = true;
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
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
      this.buildGridGroup.remove(child);
    }
  }

  private addBuildings(): void {
    const buildings = [
      [-16, -15, 6, 9, 7, "#d37b67"],
      [-10, -16, 4, 6, 5, "#e1b56f"],
      [14, -15, 8, 12, 7, "#8ba8b8"],
      [15, 14, 7, 8, 8, "#d8a066"],
      [-15, 15, 9, 11, 6, "#8e9f83"],
      [-10, 11, 4, 5, 4, "#cf8273"],
    ] as const;

    for (const [x, z, width, height, depth, color] of buildings) {
      this.addBox(x, height / 2 + 0.4, z, width, height, depth, color);
      const roof = this.addBox(x, height + 0.75, z, width * 0.82, 0.7, depth * 0.82, "#46555a");
      roof.castShadow = true;
    }

    const treePositions = [
      [-7, -9],
      [8, -11],
      [9, 9],
      [-8, 9],
      [20, 8],
      [-21, -7],
    ] as const;
    for (const [x, z] of treePositions) this.addTree(x, z);
  }

  private addTree(x: number, z: number): void {
    const trunk = mesh(
      new THREE.CylinderGeometry(0.18, 0.26, 2, 10),
      new THREE.MeshStandardMaterial({ color: "#75513c" }),
    );
    trunk.position.set(x, 1.35, z);
    trunk.castShadow = true;
    this.scene.add(trunk);

    const crown = mesh(
      new THREE.IcosahedronGeometry(1.25, 1),
      new THREE.MeshStandardMaterial({ color: "#3f8457", roughness: 0.9 }),
    );
    crown.position.set(x, 2.8, z);
    crown.castShadow = true;
    this.scene.add(crown);
  }

  private addSignals(): void {
    const positions = [
      [-5.2, -5.2],
      [5.2, 5.2],
    ] as const;

    for (const [x, z] of positions) {
      const pole = mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 3.4, 12),
        new THREE.MeshStandardMaterial({ color: "#263238", metalness: 0.35 }),
      );
      pole.position.set(x, 1.9, z);
      pole.castShadow = true;
      this.designGroups.signal.add(pole);

      this.addSignalLight(x, 3.35, z, this.vehicleSignals, 0.28);
      this.addSignalLight(x + (x < 0 ? 0.5 : -0.5), 2.45, z, this.pedestrianSignals, 0.2);
    }
  }

  private addSignalLight(
    x: number,
    y: number,
    z: number,
    materials: THREE.MeshStandardMaterial[],
    radius = 0.28,
  ): void {
    const housing = this.addBox(
      x,
      y,
      z,
      0.72,
      1.05,
      0.5,
      "#162126",
      true,
      this.designGroups.signal,
    );
    housing.castShadow = true;
    const material = new THREE.MeshStandardMaterial({
      color: "#ff5e57",
      emissive: "#a52424",
      emissiveIntensity: 1.2,
    });
    const lamp = mesh(new THREE.SphereGeometry(radius, 18, 14), material);
    lamp.position.set(x, y, z + (z < 0 ? 0.28 : -0.28));
    this.designGroups.signal.add(lamp);
    materials.push(material);
  }

  private buildVehicle(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: "#ef5a45",
      roughness: 0.35,
      metalness: 0.08,
    });
    const body = mesh(new THREE.BoxGeometry(2.6, 0.72, 1.25), bodyMaterial);
    body.position.y = 0.65;
    body.castShadow = true;
    this.vehicle.add(body);

    const cabin = mesh(
      new THREE.BoxGeometry(1.25, 0.58, 1.08),
      new THREE.MeshStandardMaterial({ color: "#bdd9df", roughness: 0.18 }),
    );
    cabin.position.set(-0.15, 1.26, 0);
    cabin.castShadow = true;
    this.vehicle.add(cabin);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#151a1c", roughness: 0.8 });
    for (const x of [-0.85, 0.85]) {
      for (const z of [-0.68, 0.68]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.18, 16), wheelMaterial);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.34, z);
        this.vehicle.add(wheel);
      }
    }

    this.vehicle.position.set(-ROUTE_LENGTH / 2, 0.12, 1.75);
    this.scene.add(this.vehicle);
  }

  private buildPedestrian(): void {
    const clothing = new THREE.MeshStandardMaterial({ color: "#156f73" });
    const skin = new THREE.MeshStandardMaterial({ color: "#d9a477" });

    const body = mesh(new THREE.CapsuleGeometry(0.25, 0.65, 5, 10), clothing);
    body.position.y = 1.15;
    body.castShadow = true;
    this.pedestrian.add(body);

    const head = mesh(new THREE.SphereGeometry(0.24, 16, 12), skin);
    head.position.y = 1.9;
    head.castShadow = true;
    this.pedestrian.add(head);

    this.pedestrian.position.set(-5.2, 0.12, -5.6);
    this.scene.add(this.pedestrian);
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

function mesh<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
  geometry: TGeometry,
  material: TMaterial,
): THREE.Mesh<TGeometry, TMaterial> {
  return new THREE.Mesh(geometry, material);
}

const roadArmNames: RoadArm[] = ["north", "east", "south", "west"];

function createRoadArmGroups(): Record<RoadArm, THREE.Group> {
  return {
    north: new THREE.Group(),
    east: new THREE.Group(),
    south: new THREE.Group(),
    west: new THREE.Group(),
  };
}
