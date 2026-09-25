import {
  buildCompanionAppMessagePrompt,
  COMPANION_APP_MESSAGE_MAX_PAYLOAD_CHARS,
} from "@/lib/ai-sidebar";

describe("SN-203 buildCompanionAppMessagePrompt", () => {
  it("combines the app text with a fenced payload context block", () => {
    const prompt = buildCompanionAppMessagePrompt({
      text: "Is this workout balanced?",
      payload: { squat: 100, bench: 80 },
      appTitle: "Workout Tracker",
    });
    expect(prompt).toContain("Is this workout balanced?");
    expect(prompt).toContain('Context from the "Workout Tracker" app:');
    expect(prompt).toContain("```json");
    expect(prompt).toContain('"squat": 100');
  });

  it("caps an oversized payload", () => {
    const payload = { blob: "a".repeat(COMPANION_APP_MESSAGE_MAX_PAYLOAD_CHARS + 500) };
    const prompt = buildCompanionAppMessagePrompt({ text: "review", payload });
    expect(prompt).toContain("[payload truncated]");
    expect(prompt.length).toBeLessThan(COMPANION_APP_MESSAGE_MAX_PAYLOAD_CHARS + 400);
  });

  it("omits the payload block when there is no payload", () => {
    const prompt = buildCompanionAppMessagePrompt({ text: "just advice please", payload: null });
    expect(prompt).toBe("just advice please");
    expect(prompt).not.toContain("```json");
  });

  it("always returns a non-empty prompt so the injected turn runs", () => {
    expect(buildCompanionAppMessagePrompt({ text: "", payload: null, appTitle: "Tracker" })).toBe(
      'Message from the "Tracker" app.'
    );
    expect(buildCompanionAppMessagePrompt({ text: "  ", payload: undefined })).toBe(
      "Message from the running app."
    );
  });
});
