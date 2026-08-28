import { describe, expect, it } from "vitest";
import { calculateFromText, evaluateExpression } from "@alpha/tools";

describe("deterministic calculator", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(evaluateExpression("2 + 3 * 4").value).toBe(14);
  });

  it("supports parentheses and powers", () => {
    expect(evaluateExpression("(2 + 3)^2").value).toBe(25);
  });

  it("supports Bulgarian percentage phrasing", () => {
    const result = calculateFromText("Изчисли 17.5% от 4382");
    expect(result.value).toBeCloseTo(766.85, 10);
  });

  it("supports decimal comma", () => {
    expect(calculateFromText("1,5 + 2,25").value).toBeCloseTo(3.75, 10);
  });

  it("rejects division by zero", () => {
    expect(() => evaluateExpression("10 / 0")).toThrow(/нула/u);
  });

  it("rejects executable text instead of evaluating it", () => {
    expect(() => evaluateExpression("globalThis.alert(1)")).toThrow(/Неподдържани символи/u);
  });
});
