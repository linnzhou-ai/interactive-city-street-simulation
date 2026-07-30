import type { VehicleKind } from "../models/types";

const VEHICLE_LENGTH_METERS: Readonly<Record<VehicleKind, number>> = {
  compact: 3.7,
  sedan: 4.4,
  suv: 4.65,
  van: 5.05,
  bus: 8.6,
  truck: 7.4,
};

export function vehicleLengthMeters(kind: VehicleKind): number {
  return VEHICLE_LENGTH_METERS[kind];
}
