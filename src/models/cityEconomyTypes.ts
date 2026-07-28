export type ZoneType =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "park";

export type UtilityKind = "power" | "water" | "waste";

export interface HouseholdExpenseLedger {
  housing: number;
  goods: number;
  utilities: number;
  transport: number;
  healthcare: number;
  education: number;
  recreation: number;
  taxes: number;
  total: number;
}
