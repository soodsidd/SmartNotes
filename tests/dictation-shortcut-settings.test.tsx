/**
 * @jest-environment jsdom
 *
 * SN-407: dictation keyboard shortcut + configurable silence auto-stop.
 */

import * as React from "react";
import { act, render } from "@testing-library/react";

import { COMMENT_SHORTCUT, DICTATION_SHORTCUT, KEYBOARD_SHORTCUTS } from "@/lib/app-settings";
import {
  DICTATION_SILENCE_DEFAULT_SECONDS,
  DICTATION_SILENCE_OPTIONS,
  DICTATION_SILENCE_STORAGE_KEY,
  readDictationSilenceSeconds,
  writeDictationSilenceSeconds,
} from "@/lib/speech/dictation-settings";
import { dictationShortcutAction, isDictationShortcut } from "@/lib/speech/dictation-shortcut";
import { SilenceDetector } from "@/lib/speech/silence-detector";
import { useDictation, useDictationShortcut, type DictationController } from "@/hooks/use-dictation";

const recorderInstances: Array<{ options: { silenceSeconds?: number }; start: jest.Mock; stop: jest.Mock }> = [];

jest.mock("@/lib/speech/recorder", () => {
  class DictationCaptureError extends Error {}
  class DictationRecorder {
    start = jest.fn(async () => undefined);
    stop = jest.fn(async () => ({ pcm16: new Int16Array(32000), sampleRate: 16000, durationSeconds: 2 }));
    cancel = jest.fn(async () => undefined);
    constructor(public options: { silenceSeconds?: number }) {
      recorderInstances.push(this as never);
    }
  }
  return { DictationRecorder, DictationCaptureError };
});

const shortcut = { key: " ", code: "Space", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };

function keydown(target: EventTarget, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  recorderInstances.length = 0;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: "hello" }) })) as unknown as typeof fetch;
});

describe("dictation shortcut matcher", () => {
  it("matches Ctrl+Shift+Space and Cmd+Shift+Space only", () => {
    expect(isDictationShortcut(shortcut)).toBe(true);
    expect(isDictationShortcut({ ...shortcut, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isDictationShortcut({ ...shortcut, code: undefined })).toBe(true);
    expect(isDictationShortcut({ ...shortcut, shiftKey: false })).toBe(false); // Ctrl+Space (IME switch)
    expect(isDictationShortcut({ ...shortcut, ctrlKey: false })).toBe(false); // Shift+Space while typing
    expect(isDictationShortcut({ ...shortcut, altKey: true })).toBe(false);
    expect(isDictationShortcut({ ...shortcut, key: "M", code: "KeyM" })).toBe(false); // comment shortcut
    expect(isDictationShortcut({ ...shortcut, repeat: true })).toBe(false);
  });

  it("is documented in the settings shortcut list and does not collide with another shortcut", () => {
    expect(KEYBOARD_SHORTCUTS).toContain(DICTATION_SHORTCUT);
    const keys = KEYBOARD_SHORTCUTS.map((item) => item.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DICTATION_SHORTCUT.keys).not.toBe(COMMENT_SHORTCUT.keys);
  });

  it("decides stop / start / consume / ignore", () => {
    const base = { phase: "idle", hasPendingClip: false, inScope: true, enabled: true };
    expect(dictationShortcutAction(shortcut, base)).toBe("start");
    expect(dictationShortcutAction(shortcut, { ...base, inScope: false })).toBe("ignore");
    expect(dictationShortcutAction(shortcut, { ...base, phase: "recording", inScope: false })).toBe("stop");
    expect(dictationShortcutAction(shortcut, { ...base, phase: "transcribing" })).toBe("consume");
    expect(dictationShortcutAction(shortcut, { ...base, hasPendingClip: true })).toBe("consume");
    expect(dictationShortcutAction(shortcut, { ...base, enabled: false })).toBe("consume");
    expect(dictationShortcutAction({ ...shortcut, shiftKey: false }, base)).toBe("ignore");
  });
});

describe("dictation silence-timeout setting", () => {
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
  });
});

function Surface({
  id,
  onController,
  enabled = true,
}: {
  id: string;
  onController: (c: DictationController) => void;
  enabled?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const controller = useDictation(() => undefined);
  useDictationShortcut(
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

describe("useDictationShortcut", () => {
  it("starts from inside the surface with the persisted silence timeout, and stops from anywhere", async () => {
    writeDictationSilenceSeconds(5);
    let controller!: DictationController;
    const { getByTestId } = render(<Surface id="editor" onController={(c) => (controller = c)} />);
    const input = getByTestId("editor-input") as HTMLTextAreaElement;

    let outOfScope!: KeyboardEvent;
    await act(async () => {
      outOfScope = keydown(document.body);
    });
    expect(outOfScope.defaultPrevented).toBe(false);
    expect(recorderInstances).toHaveLength(0);

    input.focus();
    let inScope!: KeyboardEvent;
    await act(async () => {
      inScope = keydown(input);
    });
    expect(inScope.defaultPrevented).toBe(true);
    expect(recorderInstances).toHaveLength(1);
    expect(recorderInstances[0].options.silenceSeconds).toBe(5);
    expect(controller.phase).toBe("recording");

    input.blur();
    await act(async () => {
      keydown(document.body);
    });
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it("uses the shorter default timeout when nothing is stored", async () => {
    const { getByTestId } = render(<Surface id="editor" onController={() => undefined} />);
    const input = getByTestId("editor-input");
    input.focus();
    await act(async () => {
      keydown(input);
    });
    expect(recorderInstances[0].options.silenceSeconds).toBe(DICTATION_SILENCE_DEFAULT_SECONDS);
  });

  it("a press while one surface records stops it without starting the focused one", async () => {
    const controllers: Record<string, DictationController> = {};
    const { getByTestId } = render(
      <>
        <Surface id="editor" onController={(c) => (controllers.editor = c)} />
        <Surface id="composer" onController={(c) => (controllers.composer = c)} />
      </>
    );
    const editorInput = getByTestId("editor-input");
    editorInput.focus();
    await act(async () => {
      keydown(editorInput);
    });
    expect(controllers.editor.phase).toBe("recording");

    const composerInput = getByTestId("composer-input");
    composerInput.focus();
    await act(async () => {
      keydown(composerInput);
    });
    expect(recorderInstances).toHaveLength(1);
    expect(recorderInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(controllers.composer.phase).toBe("idle");
  });

  it("does not start a disabled surface but still swallows the key", async () => {
    const { getByTestId } = render(<Surface id="composer" enabled={false} onController={() => undefined} />);
    const input = getByTestId("composer-input");
    input.focus();
    let event!: KeyboardEvent;
    await act(async () => {
      event = keydown(input);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(recorderInstances).toHaveLength(0);
  });
});

describe("note editor shortcut scope (useEditorDictation)", () => {
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

  it("starts only while focus is in the editor, and not when the editor is read-only", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({ element: host, extensions: [StarterKit], content: "<p>Note</p>" });
    let controller!: DictationController;
    render(<EditorHost editor={editor} onController={(c) => (controller = c)} />);

    await act(async () => {
      keydown(document.body);
    });
    expect(recorderInstances).toHaveLength(0);

    // Stub focus instead of focusing ProseMirror for real: jsdom's async
    // selectionchange makes ProseMirror measure ranges (no getClientRects).
    const active = jest.spyOn(document, "activeElement", "get").mockReturnValue(editor.view.dom);
    editor.setEditable(false);
    await act(async () => {
      keydown(editor.view.dom);
    });
    expect(recorderInstances).toHaveLength(0);

    editor.setEditable(true);
    await act(async () => {
      keydown(editor.view.dom);
    });
    expect(recorderInstances).toHaveLength(1);
    expect(controller.phase).toBe("recording");
    active.mockRestore();
    editor.destroy();
    host.remove();
  });
});
