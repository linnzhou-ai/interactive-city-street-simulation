import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  ScenarioSettings,
  SignalPhase,
  SimulationState,
} from "../models/types";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const METERS_PER_DEGREE_LONGITUDE =
  METERS_PER_DEGREE_LATITUDE * Math.cos((PENN_CENTER.latitude * Math.PI) / 180);
const ROAD_HEIGHT = 0.08;
const ROAD_WIDTH = 15;
const MAJOR_ROAD_WIDTH = 22;
const SIDEWALK_WIDTH = 6;
const WORLD_SIZE = 5_200;

interface MovingAgent {
  object: THREE.Group;
  route: WorldRoute;
  progress: number;
  direction: 1 | -1;
  speed: number;
}

interface WorldRoute {
  start: THREE.Vector3;
  end: THREE.Vector3;
  axis: DistrictFeature["axis"];
}

interface SignalLamp {
  material: THREE.MeshStandardMaterial;
  axis: DistrictFeature["axis"];
}

type EnvironmentStatusHandler = (mode: EnvironmentMode, detail: string) => void;

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.5, 7_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly features = PENN_ROAD_GRAPH;
  private readonly featureMeshes = new Map<string, THREE.Mesh>();
  private readonly selectableRoads: THREE.Mesh[] = [];
  private readonly designGroup = new THREE.Group();
  private readonly analysisGroup = new THREE.Group();
  private readonly trafficGroup = new THREE.Group();
  private readonly pedestrianGroup = new THREE.Group();
  private readonly vehicleAgents: MovingAgent[] = [];
  private readonly pedestrianAgents: MovingAgent[] = [];
  private readonly signalLamps: SignalLamp[] = [];
  private readonly flyKeys = new Set<string>();
  private selectionHandler: ((feature: DistrictFeature) => void) | null = null;
  private selectedFeatureId: string | null = null;
  private buildMode = true;
  private cameraMode: CameraMode = "orbit";
  private flySpeedScale = 1;
  private flyYaw = 0;
  private flyPitch = -0.55;
  private looking = false;
  private lastPointer = new THREE.Vector2();
  private pointerDown = new THREE.Vector2();
  private lastElapsedSeconds = 0;
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
    this.scene.fog = new THREE.FogExp2("#a9c3c8", 0.00038);

    this.camera.position.set(720, 720, 920);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(-90, 0, 70);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 2_700;
    this.controls.maxPolarAngle = Math.PI / 2.04;

    this.scene.add(this.designGroup, this.analysisGroup, this.trafficGroup, this.pedestrianGroup);
    this.buildLightingAndSky();
    this.buildGround();
    this.buildRoadsAndSidewalks();
    this.buildDistrictArchitecture();
    this.buildLandmarks();
    this.buildTreesAndStreetFurniture();
    this.buildParkedCars();
    this.buildSignals();
    this.buildMovingVehicles();
    this.buildPedestrians();
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

  setEnvironmentStatusHandler(handler: EnvironmentStatusHandler): void {
    handler("rendered", "Standalone Three.js urban district");
  }

  setBuildMode(enabled: boolean): void {
    this.buildMode = enabled;
    this.updateFeatureHighlights();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.flyKeys.clear();
    this.looking = false;
    this.controls.enabled = mode === "orbit";
    this.canvas.style.cursor = mode === "orbit" ? "grab" : "crosshair";
    if (mode === "fly") {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      this.flyYaw = Math.atan2(-direction.x, -direction.z);
      this.flyPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      this.applyFlyRotation();
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

  render(
    state: Readonly<SimulationState>,
    settings: Readonly<ScenarioSettings>,
  ): void {
    const now = performance.now();
    const frameSeconds = Math.min((now - this.lastFrameTimestamp) / 1000, 0.1);
    this.lastFrameTimestamp = now;
    this.updateFlyCamera(frameSeconds);

    const elapsedDelta = state.elapsedSeconds - this.lastElapsedSeconds;
    if (elapsedDelta < 0) this.resetAgents();
    else if (state.running && elapsedDelta > 0) {
      this.advanceAgents(this.vehicleAgents, elapsedDelta, state.signalPhase, false);
      this.advanceAgents(this.pedestrianAgents, elapsedDelta, state.signalPhase, true);
    }
    this.lastElapsedSeconds = state.elapsedSeconds;

    const vehicleCount = settings.vehicleVolume * 14;
    const pedestrianCount = settings.pedestrianVolume * 18;
    this.vehicleAgents.forEach((agent, index) => {
      agent.object.visible = index < vehicleCount;
    });
    this.pedestrianAgents.forEach((agent, index) => {
      agent.object.visible = index < pedestrianCount;
    });
    this.updateSignals(state.signalPhase);

    if (this.cameraMode === "orbit") this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private buildLightingAndSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4_800, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color("#5f91b5") },
          bottomColor: { value: new THREE.Color("#d8ddd0") },
        },
        vertexShader:
          "varying vec3 vWorldPosition; void main(){ vec4 p=modelMatrix*vec4(position,1.0); vWorldPosition=p.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition).y; float f=pow(max(h,0.0),0.55); gl_FragColor=vec4(mix(bottomColor,topColor,f),1.0); }",
      }),
    );
    this.scene.add(sky);

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
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const campusLawn = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 350),
      this.materials.campusGrass,
    );
    campusLawn.rotation.x = -Math.PI / 2;
    campusLawn.position.set(-70, 0.015, 140);
    campusLawn.receiveShadow = true;
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
      lawn.position.set(x, 0.02, z);
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
        sidewalk.position.y = 0.15;
        sidewalk.rotation.y = angle;
        sidewalk.receiveShadow = true;
        this.scene.add(sidewalk);
      }

      const centerLine = box(
        length * 0.96,
        0.025,
        feature.name === "Market Street" ? 0.3 : 0.2,
        this.materials.yellowLine,
      );
      centerLine.position.copy(center);
      centerLine.position.y = 0.14;
      centerLine.rotation.y = angle;
      this.scene.add(centerLine);

      if (width >= MAJOR_ROAD_WIDTH) {
        for (const laneOffset of [-width * 0.25, width * 0.25]) {
          const laneLine = box(length * 0.94, 0.02, 0.14, this.materials.whiteLine);
          laneLine.position.copy(center).addScaledVector(normal, laneOffset);
          laneLine.position.y = 0.15;
          laneLine.rotation.y = angle;
          this.scene.add(laneLine);
        }
      }
    }

    for (const feature of this.features.filter(
      (candidate) => candidate.kind === "intersection",
    )) {
      const position = geoToWorld(feature.path[0]);
      if (position.length() > 930) continue;
      this.addCrosswalk(position.x, position.z);
    }
  }

  private addCrosswalk(x: number, z: number): void {
    for (let index = -3; index <= 3; index += 1) {
      const stripeA = box(1.35, 0.025, 6.2, this.materials.whiteLine);
      stripeA.position.set(x + index * 2.25, 0.18, z - 10.5);
      const stripeB = stripeA.clone();
      stripeB.position.z = z + 10.5;
      const stripeC = box(6.2, 0.025, 1.35, this.materials.whiteLine);
      stripeC.position.set(x - 10.5, 0.18, z + index * 2.25);
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
        paving.position.set(blockCenter.x, 0.15, blockCenter.z);
        paving.receiveShadow = true;
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

    this.addDistantSkyline(rng);
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
    for (const [index, feature] of this.features
      .filter((candidate) => candidate.kind === "intersection")
      .entries()) {
      const position = geoToWorld(feature.path[0]);
      if (Math.hypot(position.x, position.z) > 930) continue;
      const group = new THREE.Group();
      group.position.set(position.x + 8.5, 0.25, position.z + 8.5);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.24, 6.8, 9),
        this.materials.streetMetal,
      );
      pole.position.y = 3.4;
      pole.castShadow = true;
      const housing = box(1.1, 2.25, 0.85, this.materials.signalHousing);
      housing.position.set(0, 6.1, 0);
      const lampMaterial = new THREE.MeshStandardMaterial({
        color: "#54db84",
        emissive: "#158948",
        emissiveIntensity: 2,
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), lampMaterial);
      lamp.position.set(0, 6.1, 0.48);
      group.add(pole, housing, lamp);
      this.signalLamps.push({
        material: lampMaterial,
        axis: index % 2 === 0 ? "x" : "z",
      });
      this.scene.add(group);
    }
  }

  private buildMovingVehicles(): void {
    const routes = createWorldRoutes();
    const colors = ["#de5948", "#2f6e8a", "#e1b24f", "#ece7da", "#33443e", "#824d75"];
    for (let index = 0; index < 42; index += 1) {
      const route = routes[index % routes.length];
      const car = createCar(colors[index % colors.length]);
      this.trafficGroup.add(car);
      this.vehicleAgents.push({
        object: car,
        route,
        progress: (index * 0.137) % 1,
        direction: index % 3 === 0 ? -1 : 1,
        speed: 0.012 + (index % 5) * 0.0016,
      });
    }
    this.resetAgents();
  }

  private buildPedestrians(): void {
    const routes = createPedestrianRoutes();
    const colors = ["#236f75", "#b65a4b", "#d4a646", "#735483", "#39684e"];
    for (let index = 0; index < 54; index += 1) {
      const route = routes[index % routes.length];
      const person = createPerson(colors[index % colors.length], index % 4);
      this.pedestrianGroup.add(person);
      this.pedestrianAgents.push({
        object: person,
        route,
        progress: (index * 0.173) % 1,
        direction: index % 2 === 0 ? 1 : -1,
        speed: 0.004 + (index % 4) * 0.0005,
      });
    }
    this.resetAgents();
  }

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerDown.set(event.clientX, event.clientY);
      if (this.cameraMode !== "fly") return;
      this.looking = true;
      this.lastPointer.set(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
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
      if (this.cameraMode === "fly") {
        this.looking = false;
        this.canvas.releasePointerCapture(event.pointerId);
        return;
      }
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
          5,
        );
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => {
      if (this.cameraMode !== "fly" || isTypingTarget(event.target)) return;
      if (isFlyKey(event.code)) {
        event.preventDefault();
        this.flyKeys.add(event.code);
      }
    });
    window.addEventListener("keyup", (event) => this.flyKeys.delete(event.code));
    window.addEventListener("blur", () => this.flyKeys.clear());
  }

  private pickFeature(event: PointerEvent): void {
    if (!this.buildMode || this.cameraMode !== "orbit") return;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.selectableRoads, false)[0];
    const featureId = hit?.object.userData.featureId as string | undefined;
    if (!featureId) return;
    const feature = this.features.find((candidate) => candidate.id === featureId);
    if (feature) this.selectionHandler?.(feature);
  }

  private updateFlyCamera(deltaSeconds: number): void {
    if (this.cameraMode !== "fly") return;
    const altitude = Math.max(2, this.camera.position.y);
    const baseSpeed =
      altitude < 12 ? 7 : altitude < 120 ? 7 + altitude * 0.3 : Math.min(520, 38 + altitude * 0.42);
    const boost = this.flyKeys.has("ShiftLeft") || this.flyKeys.has("ShiftRight") ? 4 : 1;
    const distance = baseSpeed * this.flySpeedScale * boost * deltaSeconds;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    if (this.flyKeys.has("KeyW")) this.camera.position.addScaledVector(forward, distance);
    if (this.flyKeys.has("KeyS")) this.camera.position.addScaledVector(forward, -distance);
    if (this.flyKeys.has("KeyA")) this.camera.position.addScaledVector(right, -distance);
    if (this.flyKeys.has("KeyD")) this.camera.position.addScaledVector(right, distance);
    if (this.flyKeys.has("KeyE")) this.camera.position.y += distance;
    if (this.flyKeys.has("KeyQ")) this.camera.position.y = Math.max(2.2, this.camera.position.y - distance);
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
        0.22,
        this.materials.editedAsphalt,
      );
      overlay.position.y = 0.18;
      this.designGroup.add(overlay);
      const line = createSegmentMesh(feature, 0.22, 0.03, this.materials.yellowLine);
      line.position.y = 0.34;
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
        lane.position.y = 0.35;
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
        walk.position.y = 0.18;
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
      stripe.position.set(x + index * 2.25, 0.36, z);
      group.add(stripe);
    }
  }

  private advanceAgents(
    agents: MovingAgent[],
    deltaSeconds: number,
    phase: SignalPhase,
    pedestrians: boolean,
  ): void {
    for (const agent of agents) {
      const green = pedestrians
        ? phase === "pedestrians"
        : (agent.route.axis === "x" && phase === "east-west") ||
          (agent.route.axis === "z" && phase === "north-south");
      const intersections = 10;
      const scaled = agent.progress * intersections;
      const nearSignal = Math.abs(scaled - Math.round(scaled)) < 0.018;
      if (green || !nearSignal) {
        agent.progress = wrapProgress(
          agent.progress + agent.direction * agent.speed * deltaSeconds,
        );
      }
      this.placeAgent(agent, pedestrians);
    }
  }

  private placeAgent(agent: MovingAgent, pedestrian: boolean): void {
    const position = agent.route.start.clone().lerp(agent.route.end, agent.progress);
    if (pedestrian) {
      const direction = agent.route.end.clone().sub(agent.route.start).normalize();
      const normal = new THREE.Vector3(-direction.z, 0, direction.x);
      position.addScaledVector(normal, ROAD_WIDTH / 2 + 4.3);
    }
    agent.object.position.set(position.x, pedestrian ? 0.28 : 0.25, position.z);
    const directionVector = agent.route.end.clone().sub(agent.route.start).multiplyScalar(agent.direction);
    agent.object.rotation.y = Math.atan2(directionVector.x, directionVector.z);
  }

  private resetAgents(): void {
    for (const agent of this.vehicleAgents) this.placeAgent(agent, false);
    for (const agent of this.pedestrianAgents) this.placeAgent(agent, true);
  }

  private updateSignals(phase: SignalPhase): void {
    for (const lamp of this.signalLamps) {
      const green =
        (lamp.axis === "x" && phase === "east-west") ||
        (lamp.axis === "z" && phase === "north-south");
      lamp.material.color.set(green ? "#58df89" : "#ff5d56");
      lamp.material.emissive.set(green ? "#168b47" : "#a32222");
    }
  }

  private nearLandmark(x: number, z: number, radius: number): boolean {
    return PENN_LANDMARKS.some((landmark) => {
      const position = geoToWorld(landmark);
      return Math.hypot(position.x - x, position.z - z) < radius;
    });
  }

  private addDistantSkyline(rng: () => number): void {
    for (let index = 0; index < 170; index += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = 1_250 + rng() * 1_150;
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
        Math.cos(angle) * radius,
        height / 2,
        Math.sin(angle) * radius,
      );
      building.rotation.y = rng() * Math.PI;
      this.scene.add(building);
    }
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
    lawn: new THREE.MeshStandardMaterial({ color: "#76976c", roughness: 1 }),
    campusGrass: new THREE.MeshStandardMaterial({ color: "#87a978", roughness: 1 }),
    blockPaving: new THREE.MeshStandardMaterial({ color: "#b7b3a3", roughness: 0.96 }),
    asphalt: new THREE.MeshStandardMaterial({ color: "#2c3337", roughness: 0.92 }),
    editedAsphalt: new THREE.MeshStandardMaterial({ color: "#242b2e", roughness: 0.88 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: "#c7c5ba", roughness: 0.94 }),
    yellowLine: new THREE.MeshStandardMaterial({ color: "#f1ca56", roughness: 0.75 }),
    whiteLine: new THREE.MeshStandardMaterial({ color: "#f1efe8", roughness: 0.8 }),
    bikeLane: new THREE.MeshStandardMaterial({ color: "#2ca79f", roughness: 0.84 }),
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

function createWorldRoutes(): WorldRoute[] {
  const routes: WorldRoute[] = [];
  for (const street of PENN_STREETS) {
    routes.push({
      start: geoToWorld({
        longitude: PENN_AVENUES[0].longitude,
        latitude: street.latitude,
      }),
      end: geoToWorld({
        longitude: PENN_AVENUES[PENN_AVENUES.length - 1].longitude,
        latitude: street.latitude,
      }),
      axis: "x",
    });
  }
  for (const avenue of PENN_AVENUES) {
    routes.push({
      start: geoToWorld({
        longitude: avenue.longitude,
        latitude: PENN_STREETS[0].latitude,
      }),
      end: geoToWorld({
        longitude: avenue.longitude,
        latitude: PENN_STREETS[PENN_STREETS.length - 1].latitude,
      }),
      axis: "z",
    });
  }
  return routes;
}

function createPedestrianRoutes(): WorldRoute[] {
  return createWorldRoutes().filter((_, index) => index % 2 === 0 || index < PENN_STREETS.length);
}

function createCar(color: string): THREE.Group {
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
  return group;
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

function wrapProgress(value: number): number {
  return ((value % 1) + 1) % 1;
}

function isFlyKey(code: string): boolean {
  return [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyE",
    "KeyQ",
    "ShiftLeft",
    "ShiftRight",
  ].includes(code);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
