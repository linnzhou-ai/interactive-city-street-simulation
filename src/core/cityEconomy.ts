import type {
  CityDistrictDefinition,
  CityDistrictState,
  CityGoodsMarketState,
  ExternalMarketDefinition,
  ExternalMarketState,
  GoodsBasket,
  GoodType,
} from "../models/cityTypes";

export const GOODS: GoodType[] = ["food", "consumerGoods", "industrialMaterials"];
export const BASE_GOODS_PRICES: GoodsBasket = {
  food: 8,
  consumerGoods: 22,
  industrialMaterials: 14,
};

const GOODS_WEIGHT: GoodsBasket = {
  food: 1,
  consumerGoods: 0.7,
  industrialMaterials: 1.6,
};
const TRUCK_CAPACITY = 28;

export interface DistrictTransportCapacity {
  road: number;
  transit: number;
  freight: number;
}

interface CityEconomyInput {
  districts: readonly CityDistrictState[];
  externalMarkets: readonly ExternalMarketState[];
  previousMarket: Readonly<CityGoodsMarketState>;
  transportCapacity: ReadonlyMap<string, DistrictTransportCapacity>;
  elapsedDays: number;
}

interface CityEconomyResult {
  districts: CityDistrictState[];
  externalMarkets: ExternalMarketState[];
  market: CityGoodsMarketState;
}

interface WorkingDistrict {
  district: CityDistrictState;
  availableGoods: GoodsBasket;
  demand: GoodsBasket;
  produced: GoodsBasket;
  employedResidents: number;
  averageWageDaily: number;
  householdIncomeDaily: number;
  disposableIncomeDaily: number;
  rentPaidDaily: number;
  utilityReliability: number;
  capacity: DistrictTransportCapacity;
}

export function emptyGoodsBasket(): GoodsBasket {
  return { food: 0, consumerGoods: 0, industrialMaterials: 0 };
}

export function createInitialGoodsMarket(): CityGoodsMarketState {
  return {
    prices: { ...BASE_GOODS_PRICES },
    demandDaily: emptyGoodsBasket(),
    localSupplyDaily: emptyGoodsBasket(),
    fulfilledDaily: emptyGoodsBasket(),
    importsDaily: emptyGoodsBasket(),
    exportsDaily: emptyGoodsBasket(),
    unmetDemandDaily: emptyGoodsBasket(),
    consumerPriceIndex: 100,
    localSupplyPercent: 100,
    importDependencePercent: 0,
    transportCostDaily: 0,
  };
}

export function createExternalMarketState(definition: ExternalMarketDefinition): ExternalMarketState {
  return {
    ...definition,
    goodsPrices: { ...definition.goodsPrices },
    goodsSupplyDaily: { ...definition.goodsSupplyDaily },
    goodsDemandDaily: { ...definition.goodsDemandDaily },
    importsDaily: emptyGoodsBasket(),
    exportsDaily: emptyGoodsBasket(),
    transportCostDaily: 0,
    freightTripsDaily: 0,
    inboundCommutersDaily: 0,
    outboundCommutersDaily: 0,
  };
}

export function resolveProductionCapacity(definition: CityDistrictDefinition): GoodsBasket {
  const defaults: Record<CityDistrictDefinition["primaryZone"], GoodsBasket> = {
    residential: { food: 0.65, consumerGoods: 0.25, industrialMaterials: 0.1 },
    commercial: { food: 0.3, consumerGoods: 0.55, industrialMaterials: 0.15 },
    industrial: { food: 0.05, consumerGoods: 0.35, industrialMaterials: 0.6 },
    civic: { food: 0.25, consumerGoods: 0.45, industrialMaterials: 0.3 },
    park: { food: 0.8, consumerGoods: 0.15, industrialMaterials: 0.05 },
  };
  const profile = { ...defaults[definition.primaryZone], ...definition.productionProfile };
  const profileTotal = sum(GOODS.map((good) => Math.max(0, profile[good])));
  return mapGoods((good) => definition.goodsProductionCapacity * Math.max(0, profile[good]) / Math.max(1, profileTotal));
}

export function advanceCityEconomy(input: CityEconomyInput): CityEconomyResult {
  const elapsedDays = input.elapsedDays;
  const externalMarkets = input.externalMarkets.map(resetExternalMarket);
  const totalLabor = sum(input.districts.map((district) => district.laborForce));
  const totalJobs = sum(input.districts.map((district) => district.jobs));
  const localWorkers = Math.min(totalLabor, totalJobs);
  const outboundCommuters = allocateCommuters(
    externalMarkets,
    Math.max(0, totalLabor - localWorkers),
    "outboundCommutersDaily",
    true,
  );
  const inboundCommuters = allocateCommuters(
    externalMarkets,
    Math.max(0, totalJobs - localWorkers),
    "inboundCommutersDaily",
    false,
  );
  const residentEmploymentRatio = totalLabor > 0
    ? clamp01((localWorkers + outboundCommuters) / totalLabor)
    : 1;
  const workplaceFillRatio = totalJobs > 0
    ? clamp01((localWorkers + inboundCommuters) / totalJobs)
    : 1;

  const working = input.districts.map((district): WorkingDistrict => {
    const utilityReliability = average(Object.values(district.utilityCoverage));
    const capacity = input.transportCapacity.get(district.id) ?? { road: 1, transit: 0, freight: 0 };
    const accessReliability = clamp(1 - district.congestionPercent / 450, 0.78, 1);
    const employedResidents = district.laborForce * residentEmploymentRatio * accessReliability;
    const vacancyRate = district.jobs > 0 ? Math.max(0, district.jobs - district.laborForce) / district.jobs : 0;
    const averageWageDaily = (district.averageIncome / 260) * clamp(
      0.88 + vacancyRate * 0.24 + utilityReliability * 0.08 - district.congestionPercent / 900,
      0.72,
      1.35,
    );
    const householdIncomeDaily = employedResidents * averageWageDaily + district.seniors * 34;
    const availableCash = district.householdWealth + householdIncomeDaily * elapsedDays;
    const rentDue = district.households * district.rentIndex * 52 * elapsedDays;
    const rentPaidDaily = Math.min(availableCash, rentDue) / Math.max(elapsedDays, 1e-9);
    const disposableIncomeDaily = Math.max(0, householdIncomeDaily - rentPaidDaily);
    const previousPrices = input.previousMarket.prices;
    const demand: GoodsBasket = {
      food: Math.min(
        district.population * 0.3,
        (availableCash * 0.15) / Math.max(1, previousPrices.food),
      ) * priceResponse(BASE_GOODS_PRICES.food, previousPrices.food),
      consumerGoods: Math.min(
        district.population * 0.085 * clamp(district.averageIncome / 55_000, 0.65, 1.5),
        (availableCash * 0.11) / Math.max(1, previousPrices.consumerGoods),
      ) * priceResponse(BASE_GOODS_PRICES.consumerGoods, previousPrices.consumerGoods),
      industrialMaterials: (
        district.commercialFloorArea / 90 + district.industrialFloorArea / 55
      ) * clamp(utilityReliability, 0.35, 1.1),
    };
    const laborUtilization = district.laborForce > 0 ? employedResidents / district.laborForce : 1;
    const productionUtilization = clamp01(laborUtilization * utilityReliability * accessReliability);
    const plannedConsumerGoods = district.productionCapacity.consumerGoods * productionUtilization * elapsedDays;
    const materialsNeeded = plannedConsumerGoods * 0.28;
    const materialsAvailable = district.goodsInventory.industrialMaterials;
    const consumerInputCoverage = materialsNeeded > 0
      ? clamp(materialsAvailable / materialsNeeded, 0.25, 1)
      : 1;
    const produced: GoodsBasket = {
      food: district.productionCapacity.food * productionUtilization * elapsedDays,
      consumerGoods: plannedConsumerGoods * consumerInputCoverage,
      industrialMaterials: district.productionCapacity.industrialMaterials * productionUtilization * elapsedDays,
    };
    const materialsUsed = Math.min(materialsAvailable, produced.consumerGoods * 0.28);
    const availableGoods: GoodsBasket = {
      food: district.goodsInventory.food + produced.food,
      consumerGoods: district.goodsInventory.consumerGoods + produced.consumerGoods,
      industrialMaterials: district.goodsInventory.industrialMaterials - materialsUsed + produced.industrialMaterials,
    };
    return {
      district,
      availableGoods,
      demand: mapGoods((good) => Math.max(0, demand[good] * elapsedDays)),
      produced,
      employedResidents,
      averageWageDaily,
      householdIncomeDaily,
      disposableIncomeDaily,
      rentPaidDaily,
      utilityReliability,
      capacity,
    };
  });

  const demandDaily = totalBasket(working.map((entry) => entry.demand));
  const localSupplyDaily = totalBasket(working.map((entry) => entry.availableGoods));
  const importsDaily = emptyGoodsBasket();
  const exportsDaily = emptyGoodsBasket();
  const fulfilledDaily = emptyGoodsBasket();
  const unmetDemandDaily = emptyGoodsBasket();
  const prices = emptyGoodsBasket();
  const remainingFreight = new Map(externalMarkets.map((market) => [market.id, market.freightCapacityDaily * elapsedDays]));
  let transportCostDaily = 0;

  for (const good of GOODS) {
    const localUsed = Math.min(demandDaily[good], localSupplyDaily[good]);
    let deficit = Math.max(0, demandDaily[good] - localUsed);
    let importValue = 0;
    const importSources = [...externalMarkets].sort(
      (left, right) => landedPrice(left, good, input.districts) - landedPrice(right, good, input.districts),
    );
    for (const market of importSources) {
      if (deficit <= 1e-9) break;
      const capacity = remainingFreight.get(market.id) ?? 0;
      const available = market.goodsSupplyDaily[good] * elapsedDays;
      const imported = Math.min(deficit, available, capacity / GOODS_WEIGHT[good]);
      if (imported <= 0) continue;
      const deliveryCost = transportCostPerUnit(market, good, input.districts);
      market.importsDaily[good] += imported;
      market.transportCostDaily += imported * deliveryCost;
      remainingFreight.set(market.id, capacity - imported * GOODS_WEIGHT[good]);
      importsDaily[good] += imported;
      importValue += imported * (market.goodsPrices[good] + deliveryCost);
      transportCostDaily += imported * deliveryCost;
      deficit -= imported;
    }

    const surplus = Math.max(0, localSupplyDaily[good] - demandDaily[good] * 1.12);
    let exportRemaining = surplus;
    const exportBuyers = [...externalMarkets].sort(
      (left, right) => netExportPrice(right, good, input.districts) - netExportPrice(left, good, input.districts),
    );
    for (const market of exportBuyers) {
      if (exportRemaining <= 1e-9) break;
      const capacity = remainingFreight.get(market.id) ?? 0;
      const wanted = market.goodsDemandDaily[good] * elapsedDays;
      const exported = Math.min(exportRemaining, wanted, capacity / GOODS_WEIGHT[good]);
      if (exported <= 0) continue;
      const deliveryCost = transportCostPerUnit(market, good, input.districts);
      market.exportsDaily[good] += exported;
      market.transportCostDaily += exported * deliveryCost;
      remainingFreight.set(market.id, capacity - exported * GOODS_WEIGHT[good]);
      exportsDaily[good] += exported;
      transportCostDaily += exported * deliveryCost;
      exportRemaining -= exported;
    }

    fulfilledDaily[good] = localUsed + importsDaily[good];
    unmetDemandDaily[good] = Math.max(0, demandDaily[good] - fulfilledDaily[good]);
    const scarcity = demandDaily[good] > 0 ? unmetDemandDaily[good] / demandDaily[good] : 0;
    const localPrice = BASE_GOODS_PRICES[good] * clamp(
      0.84 + 0.28 * demandDaily[good] / Math.max(1, localSupplyDaily[good]),
      0.76,
      1.55,
    );
    const targetPrice = fulfilledDaily[good] > 0
      ? (localUsed * localPrice + importValue) / fulfilledDaily[good] * (1 + scarcity * 0.45)
      : BASE_GOODS_PRICES[good] * 1.8;
    prices[good] = input.previousMarket.prices[good] * 0.65 + targetPrice * 0.35;
  }

  for (const market of externalMarkets) {
    const weightedFlow = sum(GOODS.map((good) =>
      (market.importsDaily[good] + market.exportsDaily[good]) * GOODS_WEIGHT[good],
    ));
    market.freightTripsDaily = weightedFlow / TRUCK_CAPACITY;
    market.transportCostDaily /= Math.max(elapsedDays, 1e-9);
  }

  const localUsed = mapGoods((good) => Math.min(demandDaily[good], localSupplyDaily[good]));
  const totalFreightTrips = sum(externalMarkets.map((market) => market.freightTripsDaily)) +
    sum(GOODS.map((good) => localUsed[good] * GOODS_WEIGHT[good])) * crossDistrictShare(working, localSupplyDaily) / TRUCK_CAPACITY;

  const districts = working.map((entry) => {
    const districtDemandTotal = sumBasket(entry.demand);
    const cityDemandTotal = sumBasket(demandDaily);
    const districtSupplyTotal = sumBasket(entry.availableGoods);
    const citySupplyTotal = sumBasket(localSupplyDaily);
    const demandShare = districtDemandTotal / Math.max(1, cityDemandTotal);
    const supplyShare = districtSupplyTotal / Math.max(1, citySupplyTotal);
    const goodsConsumedByType = mapGoods((good) =>
      fulfilledDaily[good] * entry.demand[good] / Math.max(1, demandDaily[good]),
    );
    const goodsImportedByType = mapGoods((good) =>
      importsDaily[good] * entry.demand[good] / Math.max(1, demandDaily[good]),
    );
    const goodsExportedByType = mapGoods((good) =>
      exportsDaily[good] * entry.availableGoods[good] / Math.max(1, localSupplyDaily[good]),
    );
    const goodsInventory = mapGoods((good) => {
      const localDraw = localUsed[good] * entry.availableGoods[good] / Math.max(1, localSupplyDaily[good]);
      return Math.max(0, entry.availableGoods[good] - localDraw - goodsExportedByType[good]);
    });
    const householdSpendingDaily = (
      goodsConsumedByType.food * prices.food +
      goodsConsumedByType.consumerGoods * prices.consumerGoods
    ) / Math.max(elapsedDays, 1e-9);
    const householdCash = entry.district.householdWealth + entry.householdIncomeDaily * elapsedDays;
    const householdWealth = Math.max(
      0,
      householdCash - entry.rentPaidDaily * elapsedDays - householdSpendingDaily * elapsedDays,
    );
    const workplaceWorkers = entry.district.jobs * workplaceFillRatio;
    const wageBill = workplaceWorkers * entry.averageWageDaily;
    const materialsCost = goodsConsumedByType.industrialMaterials * prices.industrialMaterials / Math.max(elapsedDays, 1e-9);
    const outputRevenue = wageBill * (1.16 + entry.utilityReliability * 0.18);
    const goodsRevenue = householdSpendingDaily + materialsCost;
    const exportRevenue = sum(GOODS.map((good) =>
      goodsExportedByType[good] * prices[good],
    )) / Math.max(elapsedDays, 1e-9);
    const businessRevenueDaily = outputRevenue + goodsRevenue + exportRevenue;
    const businessRent = (entry.district.commercialFloorArea + entry.district.industrialFloorArea) * entry.district.rentIndex * 0.035;
    const allocatedTransportCost = transportCostDaily * (demandShare + supplyShare) / 2;
    const businessCostsDaily = wageBill + materialsCost + businessRent + allocatedTransportCost;
    const businessProfitDaily = businessRevenueDaily - businessCostsDaily;
    const districtExternalCommuters = (
      outboundCommuters * entry.district.laborForce / Math.max(1, totalLabor) +
      inboundCommuters * entry.district.jobs / Math.max(1, totalJobs)
    );
    const commuteTripsDaily = (entry.employedResidents + districtExternalCommuters) * 1.82;
    const goodsCoverage = districtDemandTotal > 0 ? sumBasket(goodsConsumedByType) / districtDemandTotal : 1;
    const shoppingTripsDaily = entry.district.households * (0.22 + goodsCoverage * 0.18);
    const density = entry.district.population / Math.max(1, entry.district.width * entry.district.depth);
    const walkShare = clamp(0.16 + density * 0.035 - entry.district.congestionPercent / 700, 0.12, 0.52);
    const pedestrianTripsDaily = shoppingTripsDaily * walkShare + commuteTripsDaily * 0.07;
    const freightTripsDaily = totalFreightTrips * (supplyShare + demandShare) / 2;
    return {
      ...entry.district,
      employedResidents: round(entry.employedResidents),
      averageWageDaily: round(entry.averageWageDaily),
      householdWealth: round(householdWealth),
      householdIncomeDaily: round(entry.householdIncomeDaily),
      householdSpendingDaily: round(householdSpendingDaily),
      disposableIncomeDaily: round(entry.disposableIncomeDaily),
      businessRevenueDaily: round(businessRevenueDaily),
      businessCostsDaily: round(businessCostsDaily),
      businessProfitDaily: round(businessProfitDaily),
      goodsInventory: mapGoods((good) => round(goodsInventory[good])),
      goodsDemandByType: mapGoods((good) => round(entry.demand[good] / Math.max(elapsedDays, 1e-9))),
      goodsProducedByType: mapGoods((good) => round(entry.produced[good] / Math.max(elapsedDays, 1e-9))),
      goodsConsumedByType: mapGoods((good) => round(goodsConsumedByType[good] / Math.max(elapsedDays, 1e-9))),
      goodsImportedByType: mapGoods((good) => round(goodsImportedByType[good] / Math.max(elapsedDays, 1e-9))),
      goodsExportedByType: mapGoods((good) => round(goodsExportedByType[good] / Math.max(elapsedDays, 1e-9))),
      goodsProducedDaily: round(sumBasket(entry.produced) / Math.max(elapsedDays, 1e-9)),
      goodsConsumedDaily: round(sumBasket(goodsConsumedByType) / Math.max(elapsedDays, 1e-9)),
      goodsImportedDaily: round(sumBasket(goodsImportedByType) / Math.max(elapsedDays, 1e-9)),
      goodsExportedDaily: round(sumBasket(goodsExportedByType) / Math.max(elapsedDays, 1e-9)),
      commuteTripsDaily: round(commuteTripsDaily),
      shoppingTripsDaily: round(shoppingTripsDaily),
      pedestrianTripsDaily: round(pedestrianTripsDaily),
      freightTripsDaily: round(freightTripsDaily),
      externalCommutersDaily: round(districtExternalCommuters),
    };
  });

  const fulfilledTotal = sumBasket(fulfilledDaily);
  const demandTotal = sumBasket(demandDaily);
  const importTotal = sumBasket(importsDaily);
  const market: CityGoodsMarketState = {
    prices: mapGoods((good) => round(prices[good])),
    demandDaily: mapGoods((good) => round(demandDaily[good] / Math.max(elapsedDays, 1e-9))),
    localSupplyDaily: mapGoods((good) => round(localSupplyDaily[good] / Math.max(elapsedDays, 1e-9))),
    fulfilledDaily: mapGoods((good) => round(fulfilledDaily[good] / Math.max(elapsedDays, 1e-9))),
    importsDaily: mapGoods((good) => round(importsDaily[good] / Math.max(elapsedDays, 1e-9))),
    exportsDaily: mapGoods((good) => round(exportsDaily[good] / Math.max(elapsedDays, 1e-9))),
    unmetDemandDaily: mapGoods((good) => round(unmetDemandDaily[good] / Math.max(elapsedDays, 1e-9))),
    consumerPriceIndex: round(100 * average([
      prices.food / BASE_GOODS_PRICES.food,
      prices.consumerGoods / BASE_GOODS_PRICES.consumerGoods,
    ])),
    localSupplyPercent: round(100 * sumBasket(localUsed) / Math.max(1, fulfilledTotal)),
    importDependencePercent: round(100 * importTotal / Math.max(1, fulfilledTotal)),
    transportCostDaily: round(transportCostDaily / Math.max(elapsedDays, 1e-9)),
  };
  if (demandTotal <= 0) market.localSupplyPercent = 100;
  return { districts, externalMarkets, market };
}

function allocateCommuters(
  markets: ExternalMarketState[],
  requested: number,
  field: "inboundCommutersDaily" | "outboundCommutersDaily",
  requireExternalJobs: boolean,
): number {
  let remaining = requested;
  let allocated = 0;
  for (const market of [...markets].sort((left, right) => left.distanceKm - right.distanceKm)) {
    const available = requireExternalJobs
      ? Math.min(market.commuterCapacityDaily, market.externalJobs)
      : market.commuterCapacityDaily;
    const commuters = Math.min(remaining, available);
    market[field] = commuters;
    allocated += commuters;
    remaining -= commuters;
    if (remaining <= 0) break;
  }
  return allocated;
}

function resetExternalMarket(market: ExternalMarketState): ExternalMarketState {
  return {
    ...market,
    goodsPrices: { ...market.goodsPrices },
    goodsSupplyDaily: { ...market.goodsSupplyDaily },
    goodsDemandDaily: { ...market.goodsDemandDaily },
    importsDaily: emptyGoodsBasket(),
    exportsDaily: emptyGoodsBasket(),
    transportCostDaily: 0,
    freightTripsDaily: 0,
    inboundCommutersDaily: 0,
    outboundCommutersDaily: 0,
  };
}

function priceResponse(basePrice: number, currentPrice: number): number {
  return clamp((basePrice / Math.max(1, currentPrice)) ** 0.45, 0.6, 1.2);
}

function landedPrice(
  market: ExternalMarketState,
  good: GoodType,
  districts: readonly CityDistrictState[],
): number {
  return market.goodsPrices[good] + transportCostPerUnit(market, good, districts);
}

function netExportPrice(
  market: ExternalMarketState,
  good: GoodType,
  districts: readonly CityDistrictState[],
): number {
  return market.goodsPrices[good] - transportCostPerUnit(market, good, districts);
}

function transportCostPerUnit(
  market: ExternalMarketState,
  good: GoodType,
  districts: readonly CityDistrictState[],
): number {
  const congestion = weightedAverage(districts, (district) => district.congestionPercent);
  return market.distanceKm * GOODS_WEIGHT[good] * 0.018 * (1 + congestion / 120);
}

function crossDistrictShare(working: readonly WorkingDistrict[], supply: GoodsBasket): number {
  const concentration = sum(working.map((entry) => {
    const share = sumBasket(entry.availableGoods) / Math.max(1, sumBasket(supply));
    return share * share;
  }));
  return clamp(1 - concentration, 0.15, 0.85);
}

function totalBasket(baskets: readonly GoodsBasket[]): GoodsBasket {
  return mapGoods((good) => sum(baskets.map((basket) => basket[good])));
}

function sumBasket(basket: GoodsBasket): number {
  return sum(GOODS.map((good) => basket[good]));
}

function mapGoods(transform: (good: GoodType) => number): GoodsBasket {
  return Object.fromEntries(GOODS.map((good) => [good, transform(good)])) as GoodsBasket;
}

function weightedAverage(
  districts: readonly CityDistrictState[],
  select: (district: CityDistrictState) => number,
): number {
  const population = sum(districts.map((district) => district.population));
  return population > 0
    ? sum(districts.map((district) => select(district) * district.population)) / population
    : 0;
}

function average(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
