import { companionPointerFromLiveTurn } from "@/lib/ai-sidebar";

describe("companionPointerFromLiveTurn (Deep Work reattach without a durable pointer)", () => {
  const transcript = [
    { id: "user-1", role: "user", content: "earlier question" },
    { id: "assistant-1", role: "assistant", content: "earlier answer" },
    { id: "user-2", role: "user", content: "Run the long detector review" },
    { id: "assistant-2", role: "assistant", content: "I'll check the detector" },
  ];

  it("returns null when the server reports no live turn on the thread", () => {
    expect(companionPointerFromLiveTurn([], transcript)).toBeNull();
    expect(companionPointerFromLiveTurn(undefined, transcript)).toBeNull();
    expect(companionPointerFromLiveTurn([{ turn_id: "" }], transcript)).toBeNull();
  });

  it("anchors the existing assistant bubble that followed the turn's user message", () => {
    expect(
      companionPointerFromLiveTurn(
        [{ turn_id: "t-1", created_at: 1000, request_message: "Run the long detector review" }],
        transcript
      )
    ).toEqual({ turnId: "t-1", assistantMessageId: "assistant-2", lastSeq: -1, startedAt: 1000 });
  });

  it("falls back to a fresh assistant bubble when the transcript lacks the turn", () => {
    expect(
      companionPointerFromLiveTurn([{ turn_id: "t-9", created_at: 5, request_message: "not in transcript" }], transcript)
    ).toMatchObject({ turnId: "t-9", assistantMessageId: "assistant-t-9", lastSeq: -1 });
  });

  it("prefers the newest live turn", () => {
    const pointer = companionPointerFromLiveTurn(
      [
        { turn_id: "old", created_at: 1, request_message: "earlier question" },
        { turn_id: "new", created_at: 2, request_message: "Run the long detector review" },
      ],
      transcript
    );
    expect(pointer?.turnId).toBe("new");
    expect(pointer?.assistantMessageId).toBe("assistant-2");
  });
});
