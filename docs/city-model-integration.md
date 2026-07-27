# City model integration

The long-term engine accepts a `CitySectionDefinition` from
`src/models/cityTypes.ts`. Geometry is intentionally limited to district bounds
and link endpoints; detailed buildings can remain in a separate renderer.

## Required input

Each city section supplies:

- A stable section id, name, start year, tax rate, and starting budget.
- Shared power, water, and waste capacities.
- District ids, map coordinates, dimensions, primary zoning, terrain slope, and
  maximum permitted floor area.
- Starting housing, commercial, industrial, and civic floor area.
- Starting population, jobs, income, land value, and goods-production capacity.
- Links between district ids with distance and daily road, transit, and freight
  capacity.

`validateCitySectionDefinition()` rejects duplicate ids, missing link endpoints,
self-links, negative capacities, and invalid district values before a run begins.

## Running external data

```ts
import { Simulation } from "../src/core/simulation";
import type { CitySectionDefinition } from "../src/models/cityTypes";

const partnerModel: CitySectionDefinition = loadPartnerModel();
const simulation = new Simulation({ timeHorizon: "year" }, partnerModel);

simulation.start();
simulation.update(10);
const result = simulation.getState().city;
```

The engine can also run without the browser:

```ts
import { advanceCitySection } from "../src/core/cityEngine";
import { createCitySectionState } from "../src/core/cityModel";

const initial = createCitySectionState(partnerModel);
const oneYear = advanceCitySection(initial, 365, {
  roadCapacityScale: 1.05,
  utilityCapacityScale: 0.98,
  zoningStrictness: 1.1,
  transitServiceScale: 1.2,
}).state;
```

## Update behavior

Every completed model day updates these feedback loops in order:

1. Match the regional labor force to available jobs.
2. Calculate district trips, mode share, network capacity, and congestion.
3. Allocate power, water, and waste capacity by demand and district priority.
4. Produce, consume, import, export, and store goods.
5. Update household satisfaction, migration, demographics, and housing pressure.
6. Apply zoning, terrain, service, and floor-area constraints to development.
7. Adjust jobs, land value, rent, tax revenue, maintenance, and city balance.
8. Record weekly and calendar-boundary timeline snapshots.

The engine is deterministic: identical input, policy, and elapsed days produce the
same output regardless of whether days are submitted individually or as a batch.
