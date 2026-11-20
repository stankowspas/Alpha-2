import { describe, expect, it } from "vitest";
import {
  activeDiscussionModels, availableSummarySpeaker, buildSummaryMessages, buildTurnMessages,
  canResumeDiscussion, createDiscussionSession, isProviderQuotaError, markModelQuotaLimited,
  DISCUSSION_PARTICIPANTS, roundSpeakers, summarySpeaker,
  type DiscussionEntry, type DiscussionSession,
} from "../../apps/web/src/app/discussion-engine";

const topic = "Може ли AI да притежава съзнание?";
function session(mode: DiscussionSession["mode"] = "discussion"): DiscussionSession {
  return {
    id: "test", topic, mode, participation: "autonomous", master: "gpt-oss-120b",
    maxRounds: 2, roundIndex: 0, speakerIndex: 0, status: "paused",
    entries: [], createdAt: "2026-11-20T00:00:00.000Z",
  };
}

describe("Provider quota fallback", () => {
  const available = {
    gemma4: true,
    "gpt-oss-120b": true,
    "gemini-flash-lite": true,
  };

  it("recognizes the existing Groq free quota error and other explicit 429/rate limits", () => {
    for (const message of [
      "Groq: безплатната квота или лимитът на заявки е достигнат. Не е направен платен резервен опит.",
      "Groq: Rate limit reached, please retry later.",
      "HTTP 429 Too Many Requests",
      "Gemini quota exceeded: RESOURCE_EXHAUSTED",
    ]) {
      expect(isProviderQuotaError(new Error(message))).toBe(true);
    }
  });

  it("does not skip providers on unrelated failures or voluntary aborts", () => {
    for (const message of [
      "Cloudflare AI върна HTTP 500",
      "NetworkError: Failed to fetch",
      "AbortError",
      "Invalid API key",
      "Model is offline",
    ]) {
      expect(isProviderQuotaError(new Error(message))).toBe(false);
    }
  });

  it("marks only exhausted models and keeps remaining providers without duplicates", () => {
    const first = markModelQuotaLimited(session(), "gpt-oss-120b");
    const duplicate = markModelQuotaLimited(first, "gpt-oss-120b");
    expect(duplicate.limitedModels).toEqual(["gpt-oss-120b"]);
    expect(activeDiscussionModels(duplicate, available)).toEqual(["gemma4", "gemini-flash-lite"]);
    expect(duplicate.speakerIndex).toBe(0);
    expect(duplicate.entries).toEqual([]);
  });

  it("lets two available models summarize when the selected Master is exhausted", () => {
    const original = session("master");
    const limited = markModelQuotaLimited(original, original.master);
    expect(activeDiscussionModels(limited, available)).toEqual(["gemma4", "gemini-flash-lite"]);
    expect(availableSummarySpeaker(limited, available)).toBe("gemma4");
    const slavePrompt = buildTurnMessages(limited, "gemma4", 1)[0].content;
    expect(slavePrompt).toContain("отпаднал");
    expect(slavePrompt).not.toContain("Изпълни възложената");
    expect(original.limitedModels).toBeUndefined();
  });

  it("falls back from Gemma 4 for synthesis and stops only when no models remain", () => {
    const one = markModelQuotaLimited(session(), "gemma4");
    expect(availableSummarySpeaker(one, available)).toBe("gpt-oss-120b");
    const two = markModelQuotaLimited(one, "gpt-oss-120b");
    expect(availableSummarySpeaker(two, available)).toBe("gemini-flash-lite");
    const three = markModelQuotaLimited(two, "gemini-flash-lite");
    expect(activeDiscussionModels(three, available)).toEqual([]);
    expect(availableSummarySpeaker(three, available)).toBeUndefined();
  });

  it("supports provider status unavailability and older sessions with no excluded list", () => {
    const partial = { ...available, "gpt-oss-120b": false };
    expect(activeDiscussionModels(session(), partial)).toEqual(["gemma4", "gemini-flash-lite"]);
    const other = { ...available, gemma4: false, "gpt-oss-120b": false };
    expect(availableSummarySpeaker(session(), other)).toBe("gemini-flash-lite");
  });
});

describe("AI discussion scheduling", () => {
  it("allows explicit resumption after a stopped or failed provider request", () => {
    for (const status of ["stopped", "error", "paused", "waiting"] as const) {
      expect(canResumeDiscussion(status)).toBe(true);
    }
    expect(canResumeDiscussion("finished")).toBe(false);
  });
  it("uses all three available providers in each of the four peer modes", () => {
    for (const mode of ["discussion", "debate", "expert", "review"] as const) {
      expect(roundSpeakers(mode, "gpt-oss-120b")).toEqual(DISCUSSION_PARTICIPANTS);
    }
  });

  it("lets any model be the master and reviews after both slaves", () => {
    for (const master of DISCUSSION_PARTICIPANTS) {
      const speakers = roundSpeakers("master", master);
      expect(speakers).toHaveLength(4);
      expect(speakers[0]).toBe(master);
      expect(speakers[3]).toBe(master);
      expect(speakers.slice(1, 3).sort()).toEqual(
        DISCUSSION_PARTICIPANTS.filter(id => id !== master).sort(),
      );
      expect(summarySpeaker("master", master)).toBe(master);
    }
  });

  it("keeps the default summary moderator fixed outside master mode", () => {
    expect(summarySpeaker("discussion", "gemini-flash-lite")).toBe("gemma4");
  });
});

describe("AI discussion prompting", () => {
  it("includes topic, round, selected participant and prior contributions", () => {
    const s = session();
    const entry: DiscussionEntry = {
      id: "one", author: "model", modelId: "gemma4", round: 1,
      content: "Предишно мнение", createdAt: s.createdAt,
    };
    s.entries = [entry];
    const [message] = buildTurnMessages(s, "gpt-oss-120b", 1);
    expect(message.role).toBe("user");
    expect(message.content).toContain(topic);
    expect(message.content.slice(0, 400).trim()).toBe(`Тема: ${topic}`);
    expect(message.content.slice(0, 400)).not.toContain("AI дискусия");
    expect(message.content).toContain("GPT-OSS 120B");
    expect(message.content).toContain("Предишно мнение");
    expect(message.content).toContain("кръг 1 от 2");
  });

  it("keeps initial expert analysis independent", () => {
    const s = session("expert");
    s.entries = [{
      id: "other", author: "model", modelId: "gemma4", round: 1,
      content: "Не трябва да се споделя", createdAt: s.createdAt,
    }];
    const first = buildTurnMessages(s, "gpt-oss-120b", 1)[0].content;
    expect(first).toContain("независим");
    expect(first).not.toContain("Не трябва да се споделя");
    s.roundIndex = 1;
    const later = buildTurnMessages(s, "gpt-oss-120b", 1)[0].content;
    expect(later).toContain("Не трябва да се споделя");
  });

  it("assigns, executes and reviews tasks for master / slave", () => {
    const s = session("master");
    const initial = buildTurnMessages(s, "gpt-oss-120b", 0)[0].content;
    expect(initial).toContain("Разпредели две конкретни");
    const slave = buildTurnMessages(s, "gemma4", 1)[0].content;
    expect(slave).toContain("Изпълни възложената");
    const review = buildTurnMessages(s, "gpt-oss-120b", 3)[0].content;
    expect(review).toContain("Оцени отговорите");
  });

  it("assigns distinct debate positions", () => {
    const s = session("debate");
    expect(buildTurnMessages(s, "gemma4", 0)[0].content).toContain("В ПОДКРЕПА");
    expect(buildTurnMessages(s, "gpt-oss-120b", 1)[0].content).toContain("ПРОТИВ");
    expect(buildTurnMessages(s, "gemini-flash-lite", 2)[0].content).toContain("модератор");
  });

  it("includes user interventions and source links in later rounds", () => {
    const s = session("review");
    s.entries = [
      { id: "p", author: "model", modelId: "gemma4", content: "Проверим факт", round: 1,
        createdAt: s.createdAt, sources: [{ title: "Source", url: "https://example.org/source" }] },
      { id: "u", author: "user", content: "Провери източника!", round: 2, createdAt: s.createdAt },
    ];
    s.roundIndex = 1;
    const text = buildTurnMessages(s, "gemini-flash-lite", 2)[0].content;
    expect(text).toContain("Провери източника!");
    expect(text).toContain("https://example.org/source");
  });

  it("produces a final summary request that does not invent consensus", () => {
    const s = session("debate");
    s.entries = [{ id: "x", author: "model", modelId: "gemma4", round: 1,
      content: "Спорен аргумент", createdAt: s.createdAt }];
    const [message] = buildSummaryMessages(s);
    expect(message.content).toContain("Спорен аргумент");
    expect(message.content.slice(0, 400).trim()).toBe(`Тема: ${topic}`);
    expect(message.content).toContain("не са постигнали");
  });

  it("bounds rounds to 1–5 without changing the requested mode", () => {
    const minimal = createDiscussionSession(topic, "master", "participatory", "gemma4", 0);
    const maximal = createDiscussionSession(topic, "review", "autonomous", "gemma4", 20);
    expect(minimal.maxRounds).toBe(1);
    expect(maximal.maxRounds).toBe(5);
    expect(minimal.mode).toBe("master");
    expect(minimal.participation).toBe("participatory");
  });
});
