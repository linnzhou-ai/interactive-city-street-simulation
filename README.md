# Interactive City Street Simulation

A browser-based city-section systems simulator for testing how small operating
and policy differences compound across days, weeks, months, and years.

The project's core workflow is:

1. Configure transit, signals, road capacity, utilities, zoning policy, district
   production, and the city's links to outside markets.
2. Let household work and shopping, business production, and physical goods
   deliveries generate passenger and freight demand.
3. Run the connected population, mobility, economy, land-use, utility, and
   municipal-finance model over days, weeks, months, or years.
4. Keep the original street agents as a bounded detail layer for traffic behavior.
5. Compare historical population, output, congestion, service, housing, value,
   and budget outcomes.

The model is deterministic and data-driven. A partner city can replace the demo
districts and links without changing the engine. Its outputs support scenario
comparison; they are not engineering or financial forecasts.

See [PROJECT_PROPOSAL.md](PROJECT_PROPOSAL.md) for the full scope, milestones,
team responsibilities, success criteria, and fallback plan.

## Development

Install a supported Node.js version, then run:

```bash
pnpm install
pnpm dev
```

Before opening a pull request, verify the complete foundation:

```bash
pnpm check
```

The application uses Vite, TypeScript, Three.js, Graphology, Vitest, and ESLint.
See [docs/architecture.md](docs/architecture.md) for subsystem boundaries and
team ownership. See [docs/city-model-integration.md](docs/city-model-integration.md)
for the input contract used by an external city model and
[docs/economy-model.md](docs/economy-model.md) for the economic update rules.
