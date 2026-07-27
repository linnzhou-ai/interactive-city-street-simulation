import type { Point, SimulationState } from "../models/types";

const COLORS = {
  background: "#dce7df",
  road: "#26343b",
  roadEdge: "#3d4c52",
  lane: "#f5d260",
  sidewalk: "#bcc8bf",
  crosswalk: "#f4f0e7",
  vehicle: "#f15b42",
  pedestrian: "#1d6f72",
  pedestrianSignal: "#3bc48d",
  vehicleSignal: "#f4c95d",
};

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D rendering is not supported.");
    }
    this.context = context;
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    this.width = bounds.width;
    this.height = bounds.height;
    this.canvas.width = Math.round(bounds.width * pixelRatio);
    this.canvas.height = Math.round(bounds.height * pixelRatio);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  render(state: Readonly<SimulationState>): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawStreet();
    this.drawSignals(state);
    this.drawVehicle(state.vehicle.progress);
    this.drawPedestrian(state.pedestrian.progress);
  }

  private drawStreet(): void {
    const ctx = this.context;
    const roadWidth = Math.min(this.width, this.height) * 0.31;
    const horizontalTop = (this.height - roadWidth) / 2;
    const verticalLeft = (this.width - roadWidth) / 2;

    ctx.fillStyle = COLORS.sidewalk;
    ctx.fillRect(0, horizontalTop - 24, this.width, roadWidth + 48);
    ctx.fillRect(verticalLeft - 24, 0, roadWidth + 48, this.height);

    ctx.fillStyle = COLORS.road;
    ctx.fillRect(0, horizontalTop, this.width, roadWidth);
    ctx.fillRect(verticalLeft, 0, roadWidth, this.height);

    ctx.strokeStyle = COLORS.roadEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, horizontalTop, this.width, roadWidth);
    ctx.strokeRect(verticalLeft, 0, roadWidth, this.height);

    ctx.strokeStyle = COLORS.lane;
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    ctx.moveTo(0, this.height / 2);
    ctx.lineTo(this.width, this.height / 2);
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2, this.height);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawCrosswalk(verticalLeft - 4, horizontalTop + 14, roadWidth + 8, true);
  }

  private drawCrosswalk(x: number, y: number, length: number, vertical: boolean): void {
    const ctx = this.context;
    ctx.fillStyle = COLORS.crosswalk;
    const stripeCount = 7;
    const stripeGap = length / stripeCount;
    for (let index = 0; index < stripeCount; index += 1) {
      if (vertical) {
        ctx.fillRect(x + index * stripeGap, y, stripeGap * 0.55, 22);
      }
    }
  }

  private drawSignals(state: Readonly<SimulationState>): void {
    const ctx = this.context;
    const roadWidth = Math.min(this.width, this.height) * 0.31;
    const x = (this.width - roadWidth) / 2 - 17;
    const y = (this.height - roadWidth) / 2 - 17;

    ctx.fillStyle = "#162127";
    ctx.beginPath();
    ctx.roundRect(x - 5, y - 5, 22, 22, 6);
    ctx.fill();
    ctx.fillStyle =
      state.signalPhase === "vehicles" ? COLORS.vehicleSignal : COLORS.pedestrianSignal;
    ctx.beginPath();
    ctx.arc(x + 6, y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawVehicle(progress: number): void {
    const start: Point = { x: -30, y: this.height / 2 + 22 };
    const end: Point = { x: this.width + 30, y: this.height / 2 + 22 };
    const point = interpolate(start, end, progress);
    const ctx = this.context;

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = COLORS.vehicle;
    ctx.beginPath();
    ctx.roundRect(-17, -10, 34, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#dcecf0";
    ctx.fillRect(-8, -7, 13, 14);
    ctx.restore();
  }

  private drawPedestrian(progress: number): void {
    const roadWidth = Math.min(this.width, this.height) * 0.31;
    const x = (this.width - roadWidth) / 2 + progress * roadWidth;
    const y = (this.height - roadWidth) / 2 + 25;
    const ctx = this.context;

    ctx.fillStyle = COLORS.pedestrian;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.pedestrian;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 19);
    ctx.moveTo(x, y + 11);
    ctx.lineTo(x - 7, y + 16);
    ctx.moveTo(x, y + 11);
    ctx.lineTo(x + 7, y + 16);
    ctx.moveTo(x, y + 19);
    ctx.lineTo(x - 6, y + 27);
    ctx.moveTo(x, y + 19);
    ctx.lineTo(x + 6, y + 27);
    ctx.stroke();
  }
}

function interpolate(start: Point, end: Point, progress: number): Point {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}
