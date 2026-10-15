jest.mock("@/server/ai/jupyter-fast-lane", () => ({ sendJupyterFastLaneMessage: jest.fn() }));
import { POST } from "@/app/api/companion/fast-lane/send/stream/route";
import { sendJupyterFastLaneMessage } from "@/server/ai/jupyter-fast-lane";
const context = { surface: "text", target: "Selection", text: "Target", pageText: "Page", tableText: "" };
const request = (body: unknown) => new Request("http://localhost/api/companion/fast-lane/send/stream", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => jest.clearAllMocks());
it("streams shared fast-lane output for bounded page context", async () => {
  jest.mocked(sendJupyterFastLaneMessage).mockImplementation(async (_, __, options) => {
    options?.onText?.("Answer");
    return { text: "Answer", sessionId: "s", ttftMs: 1, durationMs: 2 };
  });
  const response = await POST(request({ path: "Notes/page.html", message: "Explain", inlineContext: context }));
  const stream = await response.text();
  expect(stream).toContain("event: delta"); expect(stream).toContain("event: done");
  expect(sendJupyterFastLaneMessage).toHaveBeenCalledWith("Notes/page.html", expect.stringContaining('"pageText":"Page"'), expect.objectContaining({ context: null }));
});
it.each([{ ...context, text: "x".repeat(16001) }, { ...context, tools: true }, null])("rejects malformed context before calling the provider", async inlineContext => {
  const response = await POST(request({ path: "Notes/page.html", message: "Explain", inlineContext }));
  expect(response.status).toBe(400); expect(sendJupyterFastLaneMessage).not.toHaveBeenCalled();
});
