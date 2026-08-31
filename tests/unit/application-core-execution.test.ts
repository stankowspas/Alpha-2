import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationCore } from "@alpha/ai-core";
import type { GenerationInput, ModelAdapter, ModelCapabilities } from "@alpha/models";

class FakeModel implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 4096,
    thinkingSupport: true,
    structuredOutputSupport: false,
    toolCallSupport: false,
    stopTokens: [],
    modelId: "fake-model"
  };
  readonly loaded = true;
  taskGenerations = 0;

  constructor(private readonly chunks: string[] = ["Test answer"]) {}

  async load(): Promise<void> {}
  async unload(): Promise<void> {}

  async *generate(_input: GenerationInput): AsyncIterable<string> {
    this.taskGenerations += 1;
    for (const chunk of this.chunks) yield chunk;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("ApplicationCore model-only execution", () => {
  it("runs exactly one MODEL step and finalizes it", async () => {
    const model = new FakeModel(["New ", "answer"]);
    const streamed: string[] = [];
    const core = new ApplicationCore(model);

    const result = await core.generate({
      text: "Write a short title.",
      mode: "FAST",
      depth: "LOW",
      onAnswerToken: (token) => streamed.push(token)
    });

    expect(model.taskGenerations).toBe(1);
    expect(result.taskPlan.steps).toHaveLength(1);
    expect(result.taskPlan.steps[0]?.kind).toBe("MODEL");
    expect(result.taskPlan.steps[0]?.status).toBe("COMPLETE");
    expect(result.publishable).toBe(true);
    expect(result.finalizationStatus).toBe("TASK_COMPLETE");
    expect(result.answer).toBe("New answer");
    expect(streamed.join("")).toBe("New answer");
    expect(result.citations?.citations ?? []).toEqual([]);
  });

  it("does not auto-route calculation, weather, or current-web wording", async () => {
    const fakeFetch = vi.fn(async () => { throw new Error("fetch must not be called"); });
    vi.stubGlobal("fetch", fakeFetch);

    for (const text of [
      "2 + 2",
      "What is the weather in Sofia?",
      "What is the latest OpenAI news today?"
    ]) {
      const model = new FakeModel(["Model response"]);
      const core = new ApplicationCore(model);
      const result = await core.generate({ text, mode: "FAST", depth: "LOW" });

      expect(result.taskPlan.steps.map((step) => step.kind)).toEqual(["MODEL"]);
      expect(model.taskGenerations).toBe(1);
      expect(result.publishable).toBe(true);
    }

    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("keeps a multi-part request in one MODEL step", async () => {
    const model = new FakeModel(["Combined response"]);
    const core = new ApplicationCore(model);
    const text = "Give one idea, then a second idea, and compare them.";

    const result = await core.generate({ text, mode: "FAST", depth: "LOW" });

    expect(result.taskPlan.steps).toHaveLength(1);
    expect(result.taskPlan.steps[0]?.goal).toBe(text);
    expect(result.taskPlan.steps[0]?.kind).toBe("MODEL");
    expect(model.taskGenerations).toBe(1);
    expect(result.answer).toBe("Combined response");
  });
});
