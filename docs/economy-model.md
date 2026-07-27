# Economy model

The city-section economy is a deterministic daily feedback model. It is designed
for comparing scenarios and explaining why traffic changes, not for predicting
real prices or investment returns.

## Accounts and markets

- Households receive wages or senior income, pay rent, and buy food and consumer
  goods from their available cash. Higher prices reduce requested quantities.
- Businesses hire from the resident labor force and bounded outside commuters.
  Their output depends on staffed jobs, utility reliability, congestion, and
  district production capacity. Consumer-goods output also needs industrial
  materials from inventory.
- District production and inventory supply the city first. Remaining shortages
  can be imported only from configured markets with available goods and freight
  capacity. Surpluses can be exported only where a configured market has demand.
- Import prices include a delivery charge based on distance, cargo weight, and
  city congestion. Scarcity raises the local clearing price; stored inventory and
  added local production can reduce import dependence later.

The model tracks household income, spending and wealth; business revenue, costs
and profit; prices and unmet demand by good; and import, export, inventory, and
transport costs. Money and goods are separate: paying for an import does not make
its physical delivery instantaneous or unlimited.

## Generated movement

There are no direct vehicle, pedestrian, or freight demand settings. Daily trips
come from economic activity:

- employed residents and outside workers generate commute trips;
- household purchases generate shopping and pedestrian trips;
- local distribution, imports, and exports generate freight trips;
- road and transit capacity then determine mode share and congestion.

The street simulation displays a bounded representative sample of these daily
flows. Long horizons still advance in daily steps, so a year run captures the
same feedback loops as 365 individual one-day runs without creating every trip as
an on-screen agent.

## Deliberate limits

The engine uses three broad goods and aggregate district households and firms.
It does not attempt household-by-household preference estimation, financial
markets, detailed tax law, construction supply chains, or a calibrated regional
equilibrium. Those additions would require local survey, parcel, travel, and
business data that this project does not have.
