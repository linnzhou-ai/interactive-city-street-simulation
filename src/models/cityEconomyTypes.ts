export type ZoneType =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "park";

export interface HouseholdExpenseLedger {
  housing: number;
  goods: number;
  transport: number;
  healthcare: number;
  education: number;
  recreation: number;
  taxes: number;
  total: number;
}
