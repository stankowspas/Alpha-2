export type ChatMode = "FAST" | "THINKING";
export type ResponseDepth = "LOW" | "MEDIUM" | "HIGH";

export interface DepthBudget {
  maxOutputTokens: number;
  memoryItems: number;
  evidenceSources: number;
  verificationPasses: number;
}

const budgets: Record<ResponseDepth, DepthBudget> = {
  LOW: { maxOutputTokens: 256, memoryItems: 3, evidenceSources: 2, verificationPasses: 1 },
  MEDIUM: { maxOutputTokens: 640, memoryItems: 6, evidenceSources: 4, verificationPasses: 1 },
  HIGH: { maxOutputTokens: 1200, memoryItems: 10, evidenceSources: 6, verificationPasses: 2 }
};

export function getDepthBudget(depth: ResponseDepth): DepthBudget {
  return budgets[depth];
}
