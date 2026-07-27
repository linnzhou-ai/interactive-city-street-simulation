import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SimulationState } from "../models/types";

const ROAD_WIDTH = 8;
const ROUTE_LENGTH = 36;

export class ThreeRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly vehicle = new THREE.Group();
  private readonly pedestrian = new THREE.Group();
  private readonly vehicleSignals: THREE.MeshStandardMaterial[] = [];
  private readonly pedestrianSignals: THREE.MeshStandardMaterial[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.controls.maxDistance = 42;
    this.controls.maxPolarAngle = Math.PI / 2.08;

    this.buildLighting();
    this.buildCity();
    this.buildVehicle();
    this.buildPedestrian();
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

    this.addBox(0, 0.04, 0, 80, 0.08, ROAD_WIDTH, "#29343a");
    this.addBox(0, 0.05, 0, ROAD_WIDTH, 0.1, 80, "#29343a");

    this.addSidewalk(-13, -13, 16, 16);
    this.addSidewalk(13, -13, 16, 16);
    this.addSidewalk(-13, 13, 16, 16);
    this.addSidewalk(13, 13, 16, 16);
    this.addRoadMarkings();
    this.addCrosswalks();
    this.addBuildings();
    this.addSignals();
  }

  private addSidewalk(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, 0.18, z, width, 0.36, depth, "#c7c8be");
    this.addBox(x, 0.39, z, width - 0.8, 0.08, depth - 0.8, "#93af82");
  }

  private addRoadMarkings(): void {
    for (let offset = -36; offset <= 36; offset += 4) {
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
      this.scene.add(pole);

      this.addSignalLight(x, 3.35, z, this.vehicleSignals);
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
    const housing = this.addBox(x, y, z, 0.72, 1.05, 0.5, "#162126");
    housing.castShadow = true;
    const material = new THREE.MeshStandardMaterial({
      color: "#ff5e57",
      emissive: "#a52424",
      emissiveIntensity: 1.2,
    });
    const lamp = mesh(new THREE.SphereGeometry(radius, 18, 14), material);
    lamp.position.set(x, y, z + (z < 0 ? 0.28 : -0.28));
    this.scene.add(lamp);
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
