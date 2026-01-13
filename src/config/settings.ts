import "dotenv/config";

export interface ApiConfig {
  kalshiApiKey: string;
  kalshiBaseUrl: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  openaiBaseUrl: string;
  openrouterBaseUrl: string;
}

export interface EnsembleModelEntry {
  provider: "openrouter";
  role: string;
  weight: number;
}

export interface EnsembleConfig {
  enabled: boolean;
  models: Record<string, EnsembleModelEntry>;
  minModelsForConsensus: number;
  disagreementThreshold: number;
  parallelRequests: boolean;
  debateEnabled: boolean;
  calibrationTracking: boolean;
  maxEnsembleCost: number;
}

export interface SentimentConfig {
  enabled: boolean;
  rssFeeds: string[];
  sentimentModel: string;
  cacheTtlMinutes: number;
  maxArticlesPerSource: number;
  relevanceThreshold: number;
}

export interface TradingConfig {
  maxPositionSizePct: number;
  maxDailyLossPct: number;
  maxPositions: number;
  minBalance: number;

  minVolume: number;
  maxTimeToExpiryDays: number;

  minConfidenceToTrade: number;
  categoryConfidenceAdjustments: Record<string, number>;

  scanIntervalSeconds: number;

  primaryModel: string;
  fallbackModel: string;
  aiTemperature: number;
  aiMaxTokens: number;

  defaultPositionSize: number;
  positionSizeMultiplier: number;

  useKellyCriterion: boolean;
  kellyFraction: number;
  maxSinglePosition: number;

  liveTradingEnabled: boolean;
  paperTradingMode: boolean;

  marketScanInterval: number;
  positionCheckInterval: number;
  maxTradesPerHour: number;
  runIntervalMinutes: number;
  numProcessorWorkers: number;

  preferredCategories: string[];
  excludedCategories: string[];

  enableHighConfidenceStrategy: boolean;
  highConfidenceThreshold: number;
  highConfidenceMarketOdds: number;
  highConfidenceExpiryHours: number;

  maxAnalysisCostPerDecision: number;
  minConfidenceThreshold: number;

  dailyAiBudget: number;
  maxAiCostPerDecision: number;
  analysisCooldownHours: number;
  maxAnalysesPerMarketPerDay: number;

  dailyAiCostLimit: number;
  enableDailyCostLimiting: boolean;
  sleepWhenLimitReached: boolean;

  minVolumeForAiAnalysis: number;
  excludeLowLiquidityCategories: string[];

  marketMakingAllocation?: number;
  directionalAllocation?: number;
  arbitrageAllocation?: number;
  maxVolatility?: number;
  maxCorrelation?: number;
  maxDrawdown?: number;
  maxSectorExposure?: number;
  targetSharpe?: number;
  targetReturn?: number;
  minTradeEdge?: number;
  profitThreshold?: number;
  lossThreshold?: number;
  rebalanceHours?: number;
}

export interface LoggingConfig {
  level: string;
  file: string;
  enableFileLogging: boolean;
  enableConsoleLogging: boolean;
}

export interface Settings {
  api: ApiConfig;
  trading: TradingConfig;
  logging: LoggingConfig;
  ensemble: EnsembleConfig;
  sentiment: SentimentConfig;

  marketMakingAllocation: number;
  directionalAllocation: number;
  arbitrageAllocation: number;

  useRiskParity: boolean;
  rebalanceHours: number;
  minPositionSize: number;
  maxOpportunitiesPerBatch: number;

  maxVolatility: number;
  maxCorrelation: number;
  maxDrawdown: number;
  maxSectorExposure: number;

  targetSharpe: number;
  targetReturn: number;
  minTradeEdge: number;
  minConfidenceForLargeSize: number;

  useDynamicExits: boolean;
  profitThreshold: number;
  lossThreshold: number;
  confidenceDecayThreshold: number;
  maxHoldTimeHours: number;
  volatilityAdjustment: boolean;

  enableMarketMaking: boolean;
  minSpreadForMaking: number;
  maxInventoryRisk: number;
  orderRefreshMinutes: number;
  maxOrdersPerMarket: number;

  minVolumeForAnalysis: number;
  minVolumeForMarketMaking: number;
  minPriceMovement: number;
  maxBidAskSpread: number;
  minConfidenceLongTerm: number;

  skipNewsForLowVolume: boolean;
  newsSearchVolumeThreshold: number;

  beastModeEnabled: boolean;
  fallbackToLegacy: boolean;
  performanceMonitoring: boolean;

  crossMarketArbitrage: boolean;
  multiModelEnsemble: boolean;
  sentimentAnalysis: boolean;
  websocketStreaming: boolean;
  optionsStrategies: boolean;
  algorithmicExecution: boolean;

  validate(): boolean;
}

const truthy = (v: string | undefined): boolean => (v ?? "").toLowerCase() === "true";

export const settings: Settings = {
  api: {
    kalshiApiKey: process.env.KALSHI_API_KEY ?? "",
    kalshiBaseUrl: "https://api.elections.kalshi.com",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
  },

  trading: {
    maxPositionSizePct: 3.0,
    maxDailyLossPct: 10.0,
    maxPositions: 10,
    minBalance: 100.0,

    minVolume: 500.0,
    maxTimeToExpiryDays: 14,

    minConfidenceToTrade: 0.45,
    categoryConfidenceAdjustments: {
      sports: 0.9,
      economics: 1.15,
      politics: 1.05,
      default: 1.0,
    },

    scanIntervalSeconds: 60,

    primaryModel: "anthropic/claude-sonnet-4.5",
    fallbackModel: "deepseek/deepseek-v3.2",
    aiTemperature: 0,
    aiMaxTokens: 8000,

    defaultPositionSize: 3.0,
    positionSizeMultiplier: 1.0,

    useKellyCriterion: true,
    kellyFraction: 0.25,
    maxSinglePosition: 0.03,

    liveTradingEnabled: truthy(process.env.LIVE_TRADING_ENABLED),
    paperTradingMode: !truthy(process.env.LIVE_TRADING_ENABLED),

    marketScanInterval: 30,
    positionCheckInterval: 15,
    maxTradesPerHour: 20,
    runIntervalMinutes: 10,
    numProcessorWorkers: 5,

    preferredCategories: [],
    excludedCategories: [],

    enableHighConfidenceStrategy: true,
    highConfidenceThreshold: 0.95,
    highConfidenceMarketOdds: 0.9,
    highConfidenceExpiryHours: 24,

    maxAnalysisCostPerDecision: 0.15,
    minConfidenceThreshold: 0.45,

    dailyAiBudget: 10.0,
    maxAiCostPerDecision: 0.08,
    analysisCooldownHours: 3,
    maxAnalysesPerMarketPerDay: 4,

    dailyAiCostLimit: parseFloat(process.env.DAILY_AI_COST_LIMIT ?? "10.0"),
    enableDailyCostLimiting: true,
    sleepWhenLimitReached: true,

    minVolumeForAiAnalysis: 200.0,
    excludeLowLiquidityCategories: [],
  },

  logging: {
    level: process.env.LOG_LEVEL ?? "info",
    file: "logs/trading_system.log",
    enableFileLogging: true,
    enableConsoleLogging: true,
  },

  ensemble: {
    enabled: true,
    models: {
      "anthropic/claude-sonnet-4.5": { provider: "openrouter", role: "lead_analyst", weight: 0.3 },
      "google/gemini-3.1-pro": { provider: "openrouter", role: "forecaster", weight: 0.3 },
      "openai/gpt-5.4": { provider: "openrouter", role: "risk_manager", weight: 0.2 },
      "deepseek/deepseek-v3.2": { provider: "openrouter", role: "bull_researcher", weight: 0.1 },
      "x-ai/grok-4.1-fast": { provider: "openrouter", role: "bear_researcher", weight: 0.1 },
    },
    minModelsForConsensus: 3,
    disagreementThreshold: 0.25,
    parallelRequests: true,
    debateEnabled: true,
    calibrationTracking: true,
    maxEnsembleCost: 0.5,
  },

  sentiment: {
    enabled: true,
    rssFeeds: [
      "https://feeds.reuters.com/reuters/topNews",
      "https://feeds.reuters.com/reuters/businessNews",
      "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      "https://feeds.bbci.co.uk/news/business/rss.xml",
    ],
    sentimentModel: "google/gemini-3.1-flash-lite-preview",
    cacheTtlMinutes: 30,
    maxArticlesPerSource: 10,
    relevanceThreshold: 0.3,
  },

  marketMakingAllocation: 0.4,
  directionalAllocation: 0.5,
  arbitrageAllocation: 0.1,

  useRiskParity: true,
  rebalanceHours: 6,
  minPositionSize: 5.0,
  maxOpportunitiesPerBatch: 50,

  maxVolatility: 0.4,
  maxCorrelation: 0.7,
  maxDrawdown: 0.15,
  maxSectorExposure: 0.3,

  targetSharpe: 0.3,
  targetReturn: 0.15,
  minTradeEdge: 0.08,
  minConfidenceForLargeSize: 0.5,

  useDynamicExits: true,
  profitThreshold: 0.2,
  lossThreshold: 0.15,
  confidenceDecayThreshold: 0.25,
  maxHoldTimeHours: 240,
  volatilityAdjustment: true,

  enableMarketMaking: true,
  minSpreadForMaking: 0.01,
  maxInventoryRisk: 0.15,
  orderRefreshMinutes: 15,
  maxOrdersPerMarket: 4,

  minVolumeForAnalysis: 200.0,
  minVolumeForMarketMaking: 500.0,
  minPriceMovement: 0.02,
  maxBidAskSpread: 0.15,
  minConfidenceLongTerm: 0.45,

  skipNewsForLowVolume: true,
  newsSearchVolumeThreshold: 1000.0,

  beastModeEnabled: true,
  fallbackToLegacy: true,
  performanceMonitoring: true,

  crossMarketArbitrage: false,
  multiModelEnsemble: true,
  sentimentAnalysis: true,
  websocketStreaming: true,
  optionsStrategies: false,
  algorithmicExecution: false,

  validate(): boolean {
    if (!this.api.kalshiApiKey) throw new Error("KALSHI_API_KEY environment variable is required");
    if (this.trading.maxPositionSizePct <= 0 || this.trading.maxPositionSizePct > 100) {
      throw new Error("maxPositionSizePct must be between 0 and 100");
    }
    if (this.trading.minConfidenceToTrade <= 0 || this.trading.minConfidenceToTrade > 1) {
      throw new Error("minConfidenceToTrade must be between 0 and 1");
    }
    return true;
  },
};
