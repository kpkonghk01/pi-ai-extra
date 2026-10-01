
export interface MonthlyUsageData {
  inputTokens: number;
  outputImages: number;
  totalCostUSD: number;
  totalCostHKD: number;
  requestCount: number;
  lastUpdated: number;
  /** Images from models without a known price; not included in the cost totals. */
  unpricedImages?: number;
}

export interface UsageHistory {
  [yearMonth: string]: MonthlyUsageData;
}

const STORAGE_KEY = 'og_collage_usage_history';

// Estimates only: prices come from GET /api/image-models (see shared/imageModels.ts estimateCostUsd).
const HKD_EXCHANGE_RATE = 7.8;

export const UsageService = {
  // Get the current YYYY-MM string (e.g., "2023-10")
  getCurrentMonthKey: (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  // Load entire history
  getHistory: (): UsageHistory => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error("Failed to load usage history", e);
      return {};
    }
  },

  // Get specific month data, init if not exists
  getMonthData: (yearMonth: string): MonthlyUsageData => {
    const history = UsageService.getHistory();
    if (!history[yearMonth]) {
      return {
        inputTokens: 0,
        outputImages: 0,
        totalCostUSD: 0,
        totalCostHKD: 0,
        requestCount: 0,
        lastUpdated: Date.now()
      };
    }
    return history[yearMonth];
  },

  // Record an estimated transaction. costUsd is null when the model's price is unknown.
  trackTransaction: (inputTokens: number, outputImages: number, costUsd: number | null) => {
    const history = UsageService.getHistory();
    const currentKey = UsageService.getCurrentMonthKey();
    const current = history[currentKey] ?? UsageService.getMonthData(currentKey);
    const txCostUSD = costUsd ?? 0;
    const updated: MonthlyUsageData = {
      ...current,
      inputTokens: current.inputTokens + inputTokens,
      outputImages: current.outputImages + outputImages,
      totalCostUSD: current.totalCostUSD + txCostUSD,
      totalCostHKD: current.totalCostHKD + txCostUSD * HKD_EXCHANGE_RATE,
      requestCount: current.requestCount + 1,
      lastUpdated: Date.now(),
      unpricedImages: (current.unpricedImages ?? 0) + (costUsd === null ? outputImages : 0),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...history, [currentKey]: updated }));
    } catch (e) {
      console.error("Failed to save usage history", e);
    }
  },

  // Helper to format currency
  formatHKD: (amount: number): string => {
    return new Intl.NumberFormat('en-HK', {
      style: 'currency',
      currency: 'HKD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  },
  
  // Helper to calculate tokens for a standard request (used in App.tsx estimation)
  calculateEstimatedTokens: (numImages: number, textLength: number): number => {
      const INPUT_IMAGE_TOKENS = 258;
      const INPUT_TEXT_TOKEN_RATIO = 0.25;
      return Math.ceil((numImages * INPUT_IMAGE_TOKENS) + (textLength * INPUT_TEXT_TOKEN_RATIO));
  }
};
