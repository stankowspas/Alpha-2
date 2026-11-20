import { afterEach, describe, expect, it, vi } from "vitest";
import { copyChatText } from "../../apps/web/src/app/chat-copy";
import { UI_LANGUAGES, UI_MESSAGES } from "../../apps/web/src/i18n";

afterEach(() => vi.unstubAllGlobals());

describe("Chat message clipboard", () => {
  it("copies the exact text, including Unicode and line breaks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const content = "Съобщение от AI\nс втори ред €";
    expect(await copyChatText(content)).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(content);
  });

  it("uses the legacy clipboard method when Clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const field = {
      value: "", readOnly: false, style: { position: "", left: "", top: "" },
      select: vi.fn(), remove: vi.fn(),
    };
    const execCommand = vi.fn().mockReturnValue(true);
    const appendChild = vi.fn();
    const focus = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(field), execCommand,
      activeElement: { focus }, body: { appendChild },
    });
    expect(await copyChatText("Моят въпрос")).toBe(true);
    expect(field.value).toBe("Моят въпрос");
    expect(field.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(field.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("does not falsely claim success when copying is blocked", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", undefined);
    expect(await copyChatText("Text")).toBe(false);
  });

  it("has copy, success and failure labels in all 15 supported languages", () => {
    for (const { code } of UI_LANGUAGES) {
      const messages = UI_MESSAGES[code];
      for (const key of ["copyMessage", "copied", "copyFailed"] as const) {
        expect(messages[key].trim().length, `${code} missing ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
