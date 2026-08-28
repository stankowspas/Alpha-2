import { describe, expect, it } from "vitest";
import { getDepthBudget } from "../../packages/reasoning/src/index";

describe("Response Depth Controller", () => {
  it("increases resource budgets from LOW to HIGH", () => {
    const low = getDepthBudget("LOW");
    const medium = getDepthBudget("MEDIUM");
    const high = getDepthBudget("HIGH");

    expect(low.maxOutputTokens).toBeLessThan(medium.maxOutputTokens);
    expect(medium.maxOutputTokens).toBeLessThan(high.maxOutputTokens);
    expect(high.verificationPasses).toBeGreaterThanOrEqual(medium.verificationPasses);
  });
});
