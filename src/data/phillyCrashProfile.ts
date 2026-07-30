export interface PhillyCrashRiskProfile {
  trafficMultiplier: number;
  pedestrianMultiplier: number;
  period:
    | "am-peak"
    | "midday"
    | "pm-peak"
    | "evening"
    | "night";
}

interface CrashPeriod {
  period: PhillyCrashRiskProfile["period"];
  startHour: number;
  endHour: number;
  allInjurySharePercent: number;
  pedestrianInjurySharePercent: number;
}

// Philadelphia Vision Zero Pedestrian Safety Action Plan, Figure 25.
// Source: PennDOT Crash Tables, Philadelphia, 2014–2018.
// Shares exclude the report's unknown-time category and are normalized by
// each period's duration so the multipliers represent relative crashes/hour.
export const PHILLY_CRASH_PROFILE_SOURCE =
  "https://www.phila.gov/media/20211008084341/OTIS-Pedestrian-safety-action-plan-May-2021.pdf";

const CRASH_PERIODS: readonly CrashPeriod[] = [
  {
    period: "am-peak",
    startHour: 6,
    endHour: 10,
    allInjurySharePercent: 16,
    pedestrianInjurySharePercent: 17,
  },
  {
    period: "midday",
    startHour: 10,
    endHour: 15,
    allInjurySharePercent: 24,
    pedestrianInjurySharePercent: 22,
  },
  {
    period: "pm-peak",
    startHour: 15,
    endHour: 19,
    allInjurySharePercent: 26,
    pedestrianInjurySharePercent: 31,
  },
  {
    period: "evening",
    startHour: 19,
    endHour: 24,
    allInjurySharePercent: 20,
    pedestrianInjurySharePercent: 21,
  },
  {
    period: "night",
    startHour: 0,
    endHour: 6,
    allInjurySharePercent: 11,
    pedestrianInjurySharePercent: 6,
  },
] as const;

const KNOWN_ALL_INJURY_SHARE = CRASH_PERIODS.reduce(
  (sum, period) => sum + period.allInjurySharePercent,
  0,
);
const KNOWN_PEDESTRIAN_INJURY_SHARE = CRASH_PERIODS.reduce(
  (sum, period) => sum + period.pedestrianInjurySharePercent,
  0,
);

export function getPhillyCrashRiskProfile(
  hourValue: number,
): PhillyCrashRiskProfile {
  const hour = ((hourValue % 24) + 24) % 24;
  const period =
    CRASH_PERIODS.find(
      (candidate) =>
        hour >= candidate.startHour && hour < candidate.endHour,
    ) ?? CRASH_PERIODS[CRASH_PERIODS.length - 1];
  const duration = period.endHour - period.startHour;
  return {
    period: period.period,
    trafficMultiplier: roundTwo(
      (period.allInjurySharePercent / duration) /
        (KNOWN_ALL_INJURY_SHARE / 24),
    ),
    pedestrianMultiplier: roundTwo(
      (period.pedestrianInjurySharePercent / duration) /
        (KNOWN_PEDESTRIAN_INJURY_SHARE / 24),
    ),
  };
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
