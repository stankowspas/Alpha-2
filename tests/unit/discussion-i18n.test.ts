import { describe, expect, it } from "vitest";
import { UI_LANGUAGES, UI_MESSAGES } from "../../apps/web/src/i18n";
import { DISCUSSION_MESSAGES } from "../../apps/web/src/app/discussion-i18n";
import { DISCUSSION_MODE_NAMES } from "../../apps/web/src/app/discussion-engine";

describe("Complete AI discussion localization", () => {
  it("has a complete, nonempty dictionary for every supported interface language", () => {
    const codes = UI_LANGUAGES.map(language => language.code);
    expect(Object.keys(DISCUSSION_MESSAGES).sort()).toEqual([...codes].sort());
    const baseKeys = Object.keys(DISCUSSION_MESSAGES.bg).sort();
    const modeKeys = Object.keys(DISCUSSION_MODE_NAMES).sort();

    for (const code of codes) {
      const messages = DISCUSSION_MESSAGES[code];
      expect(Object.keys(messages).sort()).toEqual(baseKeys);
      for (const [key, value] of Object.entries(messages)) {
        if (key === "modeNames") continue;
        expect(typeof value).toBe("string");
        expect((value as string).trim().length, `${code} is missing ${key}`).toBeGreaterThan(0);
      }
      expect(Object.keys(messages.modeNames).sort()).toEqual(modeKeys);
      for (const label of Object.values(messages.modeNames)) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
      expect(UI_MESSAGES[code].you.trim().length).toBeGreaterThan(0);
    }
  });

  it("localizes top navigation and mode menus instead of English fallback", () => {
    const english = DISCUSSION_MESSAGES.en;
    for (const language of UI_LANGUAGES) {
      const code = language.code;
      if (code === "en") continue;
      const t = DISCUSSION_MESSAGES[code];
      expect(t.heading).not.toBe(english.heading);
      expect(t.back).not.toBe(english.back);
      expect(t.new).not.toBe(english.new);
      expect(t.setup).not.toBe(english.setup);
      expect(t.discussionTab).not.toBe(english.discussionTab);
      expect(t.developerWebsite).not.toBe(english.developerWebsite);
      // Cognates can legitimately match English (e.g. French "Discussion").
      // A language still needs a distinct set of localized mode labels.
      const translatedModes = (["discussion", "debate", "expert", "review"] as const)
        .filter(key => t.modeNames[key] !== english.modeNames[key]);
      expect(translatedModes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("preserves stable mode IDs and labels for existing saved sessions", () => {
    for (const locale of UI_LANGUAGES.map(language => language.code)) {
      expect(Object.keys(DISCUSSION_MESSAGES[locale].modeNames)).toEqual(
        Object.keys(DISCUSSION_MODE_NAMES),
      );
    }
  });
});
