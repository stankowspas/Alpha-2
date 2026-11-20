import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscussionRoom } from "../../apps/web/src/app/DiscussionRoom";
import { CloudflareGemmaAdapter } from "../../apps/web/src/app/cloudflare-gemma";
import { UI_LANGUAGES, UI_MESSAGES } from "../../apps/web/src/i18n";
import type { DiscussionSession } from "../../apps/web/src/app/discussion-engine";

const saved: DiscussionSession = {
  id: "copy-discussion", topic: "Копиране на реплики", mode: "discussion",
  participation: "participatory", master: "gemma4", maxRounds: 1,
  roundIndex: 1, speakerIndex: 0, status: "finished",
  createdAt: "2026-11-20T00:00:00.000Z",
  entries: [
    { id: "user-1", author: "user", content: "Моят въпрос\nна втори ред", round: 1,
      createdAt: "2026-11-20T00:00:00.000Z" },
    { id: "model-1", author: "model", modelId: "gpt-oss-120b",
      content: "Отговор на модела", round: 1, createdAt: "2026-11-20T00:00:01.000Z" },
    { id: "summary-1", author: "model", modelId: "gemma4", summary: true,
      content: "Финален извод", round: 1, createdAt: "2026-11-20T00:00:02.000Z" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("Discussion copy UI", () => {
  it("offers the copy action for user, AI and final synthesis entries in every locale", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "alpha2-discussion-active-v1" ? JSON.stringify(saved) : null,
    });
    const adapter = {
      availableModels: { gemma4: true, "gpt-oss-120b": true, "gemini-flash-lite": true },
      searchAvailable: false,
    } as CloudflareGemmaAdapter;

    for (const { code } of UI_LANGUAGES) {
      const html = renderToStaticMarkup(createElement(DiscussionRoom, {
        adapter, modelReady: true, webSearchMode: "off", locale: code,
        sidebarContainer: null, onSidebarNavigate: () => {}, onBack: () => {},
      }));
      expect((html.match(/class="message-copy"/g) || []).length, code).toBe(3);
      expect(html).toContain(UI_MESSAGES[code].copyMessage);
      expect(html).toContain("Моят въпрос");
      expect(html).toContain("Отговор на модела");
      expect(html).toContain("Финален извод");
    }
  });
});
