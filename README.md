# Interactive City Street Simulation

A browser-based, street-scale systems simulator for testing how operating
conditions affect mobility, daily routines, local commerce, development, and
infrastructure capacity.

The project’s core workflow is:

1. Configure travel demand, freight, transit, signals, road capacity, utilities,
   and zoning policy.
2. Run individual resident schedules and multimodal trips through the street.
3. Observe employment, production, consumption, freight, land value, and growth.
4. Review live traffic, safety, service, economic, and household metrics.

The model is deterministic and street-scale. It represents the feedback loops
needed for scenario comparison, but its outputs are not engineering forecasts.

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
team ownership.
