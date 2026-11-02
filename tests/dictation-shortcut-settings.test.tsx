/**
 * @jest-environment jsdom
 *
 * SN-407: push-to-talk dictation key (hold to talk, release to insert;
 * configurable, default Caps Lock) + configurable silence auto-stop for the
 * tap-to-toggle mic.
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { DICTATION_SHORTCUT, KEYBOARD_SHORTCUTS } from "@/lib/app-settings";
import {
  DICTATION_PTT_DEFAULT_KEY,
  DICTATION_PTT_OFF,
  DICTATION_PTT_STORAGE_KEY,
  DICTATION_SILENCE_DEFAULT_SECONDS,
  DICTATION_SILENCE_OPTIONS,
  DICTATION_SILENCE_STORAGE_KEY,
  readDictationPttKey,
  readDictationSilenceSeconds,
  writeDictationPttKey,
  writeDictationSilenceSeconds,
} from "@/lib/speech/dictation-settings";
import { dictationKeyLabel, pushToTalkAction, validatePttKey } from "@/lib/speech/dictation-shortcut";
import { SilenceDetector } from "@/lib/speech/silence-detector";
import {
  PTT_RELEASED_EARLY_MESSAGE,
  useDictation,
  useDictationPushToTalk,
  type DictationController,
} from "@/hooks/use-dictation";
import { DictationPttKeySetting } from "@/components/dictation-ptt-key-setting";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sameOrigin } = require("../server/windows-caps-bridge");

const mockSockets: Array<{
  handlers: Record<string, (value: any) => void>;
  emit: jest.Mock;
  deliver: (event: string, value: any) => void;
}> = [];
jest.mock("socket.io-client", () => ({
  io: jest.fn(() => {
    const handlers: Record<string, (value: any) => void> = {};
    const socket = { handlers, emit: jest.fn(), disconnect: jest.fn(),
      on: jest.fn((event: string, handler: (value: any) => void) => { handlers[event] = handler; }),
      deliver: (event: string, value: any) => handlers[event]?.(value),
    };
    mockSockets.push(socket);
    return socket;
  }),
}));

type MockRecorder = {
  options: { silenceSeconds?: number };
  start: jest.Mock;
  stop: jest.Mock;
  cancel: jest.Mock;
};
const recorderInstances: MockRecorder[] = [];
/** When set, recorder.start() waits for this promise (mic still opening). */
let startGate: Promise<void> | null = null;

jest.mock("@/lib/speech/recorder", () => {
  class DictationCaptureError extends Error {}
  class DictationRecorder {
    start = jest.fn(async () => {
      if (startGate) await startGate;
    });
    stop = jest.fn(async () => ({ pcm16: new Int16Array(32000), sampleRate: 16000, durationSeconds: 2 }));
    cancel = jest.fn(async () => undefined);
    constructor(public options: { silenceSeconds?: number }) {
      recorderInstances.push(this as never);
    }
  }
  return { DictationRecorder, DictationCaptureError };
});

const caps = { key: "CapsLock", code: "CapsLock", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
const idle = { boundKey: "CapsLock", phase: "idle", hasPendingClip: false, holding: false, inScope: true, enabled: true };

describe("Windows Caps bridge origin guard", () => {
  const peer = (origin: string, host: string) => ({ handshake: { headers: { origin, host } } });
  it("accepts direct sockets and only the verified Inspect origin in dev", () => {
    expect(sameOrigin(peer("http://127.0.0.1:57079", "127.0.0.1:57079"))).toBe(true);
    const prior = process.env.npm_lifecycle_event;
    try {
      process.env.npm_lifecycle_event = "dev";
      const inspect = "http://127.0.0.1:57202";
      expect(sameOrigin(peer(inspect, "127.0.0.1:57079"), inspect)).toBe(true);
      expect(sameOrigin(peer("http://127.0.0.1:57203", "127.0.0.1:57079"), inspect)).toBe(false);
      expect(sameOrigin(peer(inspect, "127.0.0.1:57079"))).toBe(false);
      expect(sameOrigin(peer("https://other.example", "127.0.0.1:57079"), inspect)).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.npm_lifecycle_event;
      else process.env.npm_lifecycle_event = prior;
    }
    expect(sameOrigin(peer("http://127.0.0.1:57202", "127.0.0.1:57079"), "http://127.0.0.1:57202")).toBe(false);
  });
});

(process.platform === "win32" ? it : it.skip)("keeps swallowing a physical Caps Lock hold after DISARM, then passes the next outside-app press", () => {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "..", "scripts", "windows-caps-bridge.ps1"), "-SelfTest"], { encoding: "utf8" });
  expect(output).toContain("Caps Lock disarm transitions passed");
});

function key(type: "keydown" | "keyup", target: EventTarget, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent(type, { key: "F8", code: "F8", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  recorderInstances.length = 0;
  startGate = null;
  mockSockets.length = 0;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: "hello" }) })) as unknown as typeof fetch;
});

describe("pushToTalkAction (press / hold / release lifecycle)", () => {
  it("keydown presses, auto-repeat is swallowed, keyup releases", () => {
    expect(pushToTalkAction("keydown", caps, idle)).toBe("press");
    const held = { ...idle, phase: "recording", holding: true };
    expect(pushToTalkAction("keydown", { ...caps, repeat: true }, held)).toBe("consume");
    // Even a non-repeat duplicate keydown while held never restarts.
    expect(pushToTalkAction("keydown", caps, held)).toBe("consume");
    // Release works wherever focus went.
    expect(pushToTalkAction("keyup", caps, { ...held, inScope: false })).toBe("release");
    expect(pushToTalkAction("keyup", caps, idle)).toBe("ignore");
  });

  it("is not a toggle: a second press while a tap recording runs does not stop it", () => {
    expect(pushToTalkAction("keydown", caps, { ...idle, phase: "recording" })).toBe("consume");
  });

  it("busy / pending-retry / disabled swallow the key; out of scope ignores it", () => {
    expect(pushToTalkAction("keydown", caps, { ...idle, phase: "transcribing" })).toBe("consume");
    expect(pushToTalkAction("keydown", caps, { ...idle, hasPendingClip: true })).toBe("consume");
    expect(pushToTalkAction("keydown", caps, { ...idle, enabled: false })).toBe("consume");
    expect(pushToTalkAction("keydown", caps, { ...idle, inScope: false })).toBe("ignore");
    expect(pushToTalkAction("keydown", { ...caps, repeat: true }, idle)).toBe("consume");
  });

  it("matches only the bound key, ignores chords, and does nothing when off", () => {
    expect(pushToTalkAction("keydown", { ...caps, code: "KeyA", key: "a" }, idle)).toBe("ignore");
    expect(pushToTalkAction("keydown", { ...caps, ctrlKey: true }, idle)).toBe("ignore");
    expect(pushToTalkAction("keydown", caps, { ...idle, boundKey: DICTATION_PTT_OFF })).toBe("ignore");
    const f8 = { ...caps, key: "F8", code: "F8" };
    expect(pushToTalkAction("keydown", f8, { ...idle, boundKey: "F8" })).toBe("press");
    expect(pushToTalkAction("keydown", caps, { ...idle, boundKey: "F8" })).toBe("ignore");
    // A right-hand modifier key sets its own flag; that is not a chord.
    const rctrl = { ...caps, key: "Control", code: "ControlRight", ctrlKey: true };
    expect(pushToTalkAction("keydown", rctrl, { ...idle, boundKey: "ControlRight" })).toBe("press");
  });
});

describe("push-to-talk key setting", () => {
  it("defaults to Caps Lock, persists a rebinding, and falls back on garbage", () => {
    expect(DICTATION_PTT_DEFAULT_KEY).toBe("CapsLock");
    expect(readDictationPttKey()).toBe("CapsLock");
    expect(writeDictationPttKey("F8")).toBe("F8");
    expect(window.localStorage.getItem(DICTATION_PTT_STORAGE_KEY)).toBe("F8");
    expect(readDictationPttKey()).toBe("F8");
    writeDictationPttKey(DICTATION_PTT_OFF);
    expect(readDictationPttKey()).toBe(DICTATION_PTT_OFF);
    window.localStorage.setItem(DICTATION_PTT_STORAGE_KEY, "<script>");
    expect(readDictationPttKey()).toBe("CapsLock");
  });

  it("only allows keys that do not type, edit or navigate", () => {
    expect(validatePttKey({ key: "CapsLock", code: "CapsLock" })).toEqual({ ok: true, code: "CapsLock" });
    expect(validatePttKey({ key: "F8", code: "F8" }).ok).toBe(true);
    expect(validatePttKey({ key: "Control", code: "ControlRight" }).ok).toBe(true);
    for (const [k, code] of [["a", "KeyA"], [" ", "Space"], ["Enter", "Enter"], ["Tab", "Tab"], ["ArrowLeft", "ArrowLeft"], ["Backspace", "Backspace"], ["Control", "ControlLeft"], ["Shift", "ShiftLeft"], ["1", "Digit1"]]) {
      expect(validatePttKey({ key: k, code }).ok).toBe(false);
    }
    expect(dictationKeyLabel("CapsLock")).toBe("Caps Lock");
    expect(dictationKeyLabel("ControlRight")).toBe("Right Ctrl");
  });

  it("is listed in the settings shortcut reference as hold-to-talk", () => {
    expect(KEYBOARD_SHORTCUTS).toContain(DICTATION_SHORTCUT);
    expect(DICTATION_SHORTCUT.keys).toBe("Hold Caps Lock");
  });

  it("settings control: press a key to bind, rejects typing keys, Esc cancels, reset and off", () => {
    render(<DictationPttKeySetting />);
    const capture = screen.getByTestId("settings-dictation-ptt-capture");
    expect(capture).toHaveTextContent("Caps Lock");

    fireEvent.click(capture);
    expect(capture).toHaveTextContent("Press a key");
    act(() => {
      key("keydown", window, { key: "a", code: "KeyA" });
    });
    expect(screen.getByTestId("settings-dictation-ptt-error")).toBeInTheDocument();
    expect(readDictationPttKey()).toBe("CapsLock");
    act(() => {
      key("keydown", window, { key: "F8", code: "F8" });
    });
    expect(capture).toHaveTextContent("F8");
    expect(window.localStorage.getItem(DICTATION_PTT_STORAGE_KEY)).toBe("F8");

    fireEvent.click(capture);
    act(() => {
      key("keydown", window, { key: "Escape", code: "Escape" });
    });
    expect(capture).toHaveTextContent("F8");

    fireEvent.click(screen.getByTestId("settings-dictation-ptt-reset"));
    expect(readDictationPttKey()).toBe("CapsLock");
    fireEvent.click(screen.getByTestId("settings-dictation-ptt-off"));
    expect(readDictationPttKey()).toBe(DICTATION_PTT_OFF);
    expect(capture).toHaveTextContent("Off");
  });
});

describe("dictation silence-timeout setting (tap-to-toggle mic)", () => {
  it("defaults well under SN-406's fixed 10 s", () => {
    expect(readDictationSilenceSeconds()).toBe(DICTATION_SILENCE_DEFAULT_SECONDS);
    expect(DICTATION_SILENCE_DEFAULT_SECONDS).toBeLessThanOrEqual(5);
    expect(DICTATION_SILENCE_OPTIONS).toContain(DICTATION_SILENCE_DEFAULT_SECONDS);
  });

  it("persists, clamps, and ignores garbage", () => {
    expect(writeDictationSilenceSeconds(5)).toBe(5);
    expect(window.localStorage.getItem(DICTATION_SILENCE_STORAGE_KEY)).toBe("5");
    expect(readDictationSilenceSeconds()).toBe(5);
    expect(writeDictationSilenceSeconds(999)).toBe(60);
    expect(writeDictationSilenceSeconds(0)).toBe(1);
    window.localStorage.setItem(DICTATION_SILENCE_STORAGE_KEY, "nope");
    expect(readDictationSilenceSeconds()).toBe(DICTATION_SILENCE_DEFAULT_SECONDS);
  });

  it("the persisted value drives SilenceDetector auto-stop timing", () => {
    const RATE = 48_000;
    const BLOCK = 2048;
    const quiet = new Float32Array(BLOCK).fill(0.0005);
    const firedAt = (seconds: number) => {
      const detector = new SilenceDetector(RATE, seconds);
      for (let i = 0; i < (30 * RATE) / BLOCK; i += 1) if (detector.push(quiet)) return detector.elapsedSeconds();
      return null;
    };
    writeDictationSilenceSeconds(2);
    const two = firedAt(readDictationSilenceSeconds())!;
    writeDictationSilenceSeconds(20);
    const twenty = firedAt(readDictationSilenceSeconds())!;
    expect(two).toBeGreaterThanOrEqual(2);
    expect(two).toBeLessThan(2.1);
    expect(twenty).toBeGreaterThanOrEqual(20);
    expect(twenty).toBeLessThan(20.1);
    // Push-to-talk passes an infinite window: never stops on silence.
    expect(firedAt(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

function Surface({
  id,
  onController,
  onTranscript = () => undefined,
  enabled = true,
}: {
  id: string;
  onController: (c: DictationController) => void;
  onTranscript?: (text: string) => void;
  enabled?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const controller = useDictation(onTranscript);
  useDictationPushToTalk(
    controller,
    React.useCallback((active: Element | null) => Boolean(active && ref.current?.contains(active)), []),
    enabled
  );
  onController(controller);
  return (
    <div ref={ref} data-testid={id}>
      <textarea data-testid={`${id}-input`} />
    </div>
  );
}

describe("useDictationPushToTalk", () => {
  beforeEach(() => writeDictationPttKey("F8"));
  it("Windows Caps Lock uses only native bridge events and releases into the transcript pipeline", async () => {
    writeDictationPttKey("CapsLock");
    const platform = jest.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0)");
    const focused = jest.spyOn(document, "hasFocus").mockReturnValue(true);
    const inserted: string[] = [];
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} onTranscript={(text) => inserted.push(text)} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    expect(mockSockets).toHaveLength(1);
    await act(async () => { key("keydown", input, { key: "CapsLock", code: "CapsLock" }); });
    expect(recorderInstances).toHaveLength(0);
    await act(async () => {
      mockSockets[0].deliver("dictation:caps-bridge", { ready: true });
      mockSockets[0].deliver("dictation:caps-key", "keydown");
    });
    expect(controller.phase).toBe("recording");
    await act(async () => { mockSockets[0].deliver("dictation:caps-key", "keydown"); });
    expect(recorderInstances).toHaveLength(1);
    await act(async () => { mockSockets[0].deliver("dictation:caps-key", "keyup"); });
    expect(inserted).toEqual(["hello"]);
    expect(controller.isHoldingKey()).toBe(false);
    await act(async () => { mockSockets[0].deliver("dictation:caps-key", "keydown"); });
    expect(controller.isHoldingKey()).toBe(true);
    await act(async () => { mockSockets[0].deliver("disconnect", undefined); });
    expect(controller.isHoldingKey()).toBe(false);
    expect(recorderInstances[1].stop).toHaveBeenCalledTimes(1);
    focused.mockRestore();
    platform.mockRestore();
  });
  it("hold starts (no silence auto-stop), repeats are swallowed, release transcribes and inserts", async () => {
    writeDictationSilenceSeconds(2);
    const inserted: string[] = [];
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} onTranscript={(t) => inserted.push(t)} />);
    const input = screen.getByTestId("editor-input");

    let outside!: KeyboardEvent;
    await act(async () => {
      outside = key("keydown", document.body);
    });
    expect(outside.defaultPrevented).toBe(false);
    expect(recorderInstances).toHaveLength(0);
    await act(async () => {
      key("keyup", document.body);
    });

    input.focus();
    let down!: KeyboardEvent;
    await act(async () => {
      down = key("keydown", input);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(recorderInstances).toHaveLength(1);
    expect(recorderInstances[0].options.silenceSeconds).toBe(Number.POSITIVE_INFINITY);
    expect(controller.phase).toBe("recording");
    expect(controller.holding).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      let repeat!: KeyboardEvent;
      await act(async () => {
        repeat = key("keydown", input, { repeat: true });
      });
      expect(repeat.defaultPrevented).toBe(true);
    }
    expect(recorderInstances).toHaveLength(1);
    expect(recorderInstances[0].stop).not.toHaveBeenCalled();

    let up!: KeyboardEvent;
    await act(async () => {
      up = key("keyup", input);
    });
    expect(up.defaultPrevented).toBe(true);
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual(["hello"]);
    expect(controller.phase).toBe("idle");
    expect(controller.notice).toBeNull();
  });

  it("losing window focus mid-hold releases, so the recording is never stuck open", async () => {
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    await act(async () => {
      key("keydown", input);
    });
    expect(controller.phase).toBe("recording");
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe("idle");
    expect(controller.isHoldingKey()).toBe(false);
    // The keyup that arrives later (after alt-tab back) is a no-op.
    await act(async () => {
      key("keyup", input);
    });
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    // And the next hold works normally.
    await act(async () => {
      key("keydown", input);
    });
    expect(recorderInstances).toHaveLength(2);
  });

  it("a hidden tab mid-hold also releases", async () => {
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    await act(async () => {
      key("keydown", input);
    });
    const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(controller.phase).toBe("idle");
  });

  it("release while the microphone is still opening cancels instead of recording forever", async () => {
    let openMic!: () => void;
    startGate = new Promise<void>((resolve) => (openMic = resolve));
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    await act(async () => {
      key("keydown", input);
    });
    expect(controller.phase).toBe("starting");
    await act(async () => {
      key("keyup", input);
    });
    await act(async () => {
      openMic();
    });
    expect(recorderInstances[0].cancel).toHaveBeenCalledTimes(1);
    expect(recorderInstances[0].stop).not.toHaveBeenCalled();
    expect(controller.phase).toBe("idle");
    expect(controller.notice?.message).toBe(PTT_RELEASED_EARLY_MESSAGE);
  });

  it("does not start from browser Caps Lock events without the native bridge", async () => {
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    await act(async () => {
      key("keydown", input, { key: "CapsLock", code: "CapsLock" });
    });
    await act(async () => {
      key("keyup", input, { key: "CapsLock", code: "CapsLock" });
    });
    expect(recorderInstances).toHaveLength(0);
    expect(controller.phase).toBe("idle");
  });

  it("only the focused surface starts, and each releases only its own hold", async () => {
    const controllers: Record<string, DictationController> = {};
    render(
      <>
        <Surface id="editor" onController={(c) => (controllers.editor = c)} />
        <Surface id="composer" onController={(c) => (controllers.composer = c)} />
      </>
    );
    const composerInput = screen.getByTestId("composer-input");
    composerInput.focus();
    await act(async () => {
      key("keydown", composerInput);
    });
    expect(controllers.composer.phase).toBe("recording");
    expect(controllers.editor.phase).toBe("idle");
    expect(recorderInstances).toHaveLength(1);
    // Focus moves to the editor mid-hold; release still stops the composer.
    screen.getByTestId("editor-input").focus();
    await act(async () => {
      key("keyup", screen.getByTestId("editor-input"));
    });
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(controllers.composer.phase).toBe("idle");
    expect(recorderInstances).toHaveLength(1);
  });

  it("does not start a disabled surface but still swallows the key", async () => {
    render(<Surface id="composer" enabled={false} onController={() => undefined} />);
    const input = screen.getByTestId("composer-input");
    input.focus();
    let event!: KeyboardEvent;
    await act(async () => {
      event = key("keydown", input);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(recorderInstances).toHaveLength(0);
  });

  it("follows a rebinding live: the new key works, the old key no longer does", async () => {
    render(<Surface id="editor" onController={() => undefined} />);
    const input = screen.getByTestId("editor-input");
    input.focus();
    act(() => {
      writeDictationPttKey("F9");
    });
    await act(async () => {
      key("keydown", input);
      key("keyup", input);
    });
    expect(recorderInstances).toHaveLength(0);
    await act(async () => {
      key("keydown", input, { key: "F9", code: "F9" });
    });
    expect(recorderInstances).toHaveLength(1);
    await act(async () => {
      key("keyup", input, { key: "F9", code: "F9" });
    });
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it("tap-to-toggle still uses the persisted silence timeout", async () => {
    writeDictationSilenceSeconds(5);
    let controller!: DictationController;
    render(<Surface id="editor" onController={(c) => (controller = c)} />);
    await act(async () => {
      controller.toggle();
    });
    expect(recorderInstances[0].options.silenceSeconds).toBe(5);
    expect(controller.holding).toBe(false);
  });
});

describe("note editor push-to-talk scope (useEditorDictation)", () => {
  beforeEach(() => writeDictationPttKey("F8"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Editor } = require("@tiptap/core");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const StarterKit = require("@tiptap/starter-kit").default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEditorDictation } = require("@/components/editor-dictation");

  function EditorHost({ editor, onController }: { editor: unknown; onController: (c: DictationController) => void }) {
    onController(useEditorDictation(editor));
    return null;
  }

  it("holds only while focus is in an editable editor, release inserts at the caret", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({ element: host, extensions: [StarterKit], content: "<p>Note</p>" });
    let controller!: DictationController;
    render(<EditorHost editor={editor} onController={(c) => (controller = c)} />);

    await act(async () => {
      key("keydown", document.body);
      key("keyup", document.body);
    });
    expect(recorderInstances).toHaveLength(0);

    // Stub focus instead of focusing ProseMirror for real: jsdom's async
    // selectionchange makes ProseMirror measure ranges (no getClientRects).
    const active = jest.spyOn(document, "activeElement", "get").mockReturnValue(editor.view.dom);
    editor.setEditable(false);
    await act(async () => {
      key("keydown", editor.view.dom);
      key("keyup", editor.view.dom);
    });
    expect(recorderInstances).toHaveLength(0);

    editor.setEditable(true);
    await act(async () => {
      key("keydown", editor.view.dom);
    });
    expect(recorderInstances).toHaveLength(1);
    expect(controller.phase).toBe("recording");
    await act(async () => {
      key("keyup", editor.view.dom);
    });
    expect(editor.getText()).toContain("hello");
    expect(editor.getText()).toContain("Note");
    active.mockRestore();
    editor.destroy();
    host.remove();
  });
});
