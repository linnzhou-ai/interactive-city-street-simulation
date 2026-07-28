import type { DistrictFeature, GeoPoint } from "../models/types";

export const PENN_CENTER = { longitude: -75.1936, latitude: 39.9522 };

export const PENN_LANDMARKS = [
  { name: "College Hall", longitude: -75.1936, latitude: 39.9519, kind: "college-hall" },
  {
    name: "Fisher Fine Arts Library",
    longitude: -75.1924,
    latitude: 39.9514,
    kind: "fisher",
  },
  { name: "Huntsman Hall", longitude: -75.1981, latitude: 39.9532, kind: "huntsman" },
  { name: "Van Pelt Library", longitude: -75.1934, latitude: 39.9526, kind: "van-pelt" },
  { name: "Penn Museum", longitude: -75.1917, latitude: 39.9493, kind: "museum" },
  {
    name: "Franklin Field",
    longitude: -75.1894,
    latitude: 39.9501,
    kind: "franklin-field",
  },
  {
    name: "Amy Gutmann Hall",
    longitude: -75.1911,
    latitude: 39.9552,
    kind: "gutmann",
  },
  { name: "Houston Hall", longitude: -75.1939, latitude: 39.9509, kind: "houston" },
  {
    name: "Penn Engineering",
    longitude: -75.1906,
    latitude: 39.9528,
    kind: "engineering",
  },
  {
    name: "Penn Medicine",
    longitude: -75.193,
    latitude: 39.9474,
    kind: "medicine",
  },
] as const;

export const PENN_AVENUES = [
  { name: "30th Street", short: "30", longitude: -75.1854 },
  { name: "31st Street", short: "31", longitude: -75.1871 },
  { name: "32nd Street", short: "32", longitude: -75.1887 },
  { name: "33rd Street", short: "33", longitude: -75.1902 },
  { name: "34th Street", short: "34", longitude: -75.1923 },
  { name: "36th Street", short: "36", longitude: -75.1961 },
  { name: "38th Street", short: "38", longitude: -75.2001 },
  { name: "40th Street", short: "40", longitude: -75.2042 },
  { name: "42nd Street", short: "42", longitude: -75.2084 },
  { name: "44th Street", short: "44", longitude: -75.2125 },
  { name: "45th Street", short: "45", longitude: -75.2146 },
] as const;

export const PENN_STREETS = [
  { name: "Market Street", slug: "market", latitude: 39.9557 },
  { name: "Chestnut Street", slug: "chestnut", latitude: 39.9537 },
  { name: "Walnut Street", slug: "walnut", latitude: 39.95245 },
  { name: "Sansom Street", slug: "sansom", latitude: 39.95145 },
  { name: "Spruce Street", slug: "spruce", latitude: 39.94945 },
  { name: "Pine Street", slug: "pine", latitude: 39.94825 },
  { name: "Baltimore Avenue", slug: "baltimore", latitude: 39.9464 },
  { name: "Woodland Avenue", slug: "woodland", latitude: 39.9449 },
  { name: "South Street", slug: "south", latitude: 39.9437 },
] as const;

export const PENN_ROAD_GRAPH: readonly DistrictFeature[] = createDistrictFeatures();

function createDistrictFeatures(): DistrictFeature[] {
  const features: DistrictFeature[] = [];
  for (const street of PENN_STREETS) {
    for (let index = 0; index < PENN_AVENUES.length - 1; index += 1) {
      const start = PENN_AVENUES[index];
      const end = PENN_AVENUES[index + 1];
      features.push({
        id: `${street.slug}-${start.short}-${end.short}`,
        kind: "street",
        name: street.name,
        description: `Between ${start.name} and ${end.name}`,
        axis: "x",
        path: [
          { longitude: start.longitude, latitude: street.latitude },
          { longitude: end.longitude, latitude: street.latitude },
        ],
      });
    }
  }
  for (const avenue of PENN_AVENUES) {
    for (let index = 0; index < PENN_STREETS.length - 1; index += 1) {
      const start = PENN_STREETS[index];
      const end = PENN_STREETS[index + 1];
      features.push({
        id: `${avenue.short}-${start.slug}-${end.slug}`,
        kind: "street",
        name: avenue.name,
        description: `Between ${start.name} and ${end.name}`,
        axis: "z",
        path: [
          { longitude: avenue.longitude, latitude: start.latitude },
          { longitude: avenue.longitude, latitude: end.latitude },
        ],
      });
    }
  }
  for (const avenue of PENN_AVENUES) {
    for (const street of PENN_STREETS) {
      features.push({
        id: `${avenue.short}-${street.slug}`,
        kind: "intersection",
        name: `${avenue.name.replace(" Street", "")} & ${street.name.replace(" Street", "")}`,
        description: `Signalized intersection at ${avenue.name} and ${street.name}`,
        axis: "x",
        path: [{ longitude: avenue.longitude, latitude: street.latitude }],
      });
    }
  }
  return features;
}

export function offsetGeographicPath(
  path: readonly GeoPoint[],
  axis: DistrictFeature["axis"],
  offset: number,
): GeoPoint[] {
  return path.map((point) => ({
    ...point,
    longitude: point.longitude + (axis === "z" ? offset : 0),
    latitude: point.latitude + (axis === "x" ? offset : 0),
  }));
}
