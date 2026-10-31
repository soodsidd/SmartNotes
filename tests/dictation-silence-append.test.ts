/**
 * @jest-environment jsdom
 *
 * SN-406: silence auto-stop and append-not-replace for dictation.
 */

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";

import { DICTATION_SILENCE_SECONDS, SilenceDetector } from "@/lib/speech/silence-detector";
import { appendTranscript, insertTranscriptIntoEditor, spacedInsertion } from "@/lib/speech/dictation-text";

const RATE = 48_000;
const BLOCK = 2048;

function block(amplitude: number): Float32Array {
  const out = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i += 1) out[i] = amplitude * Math.sin(i / 3);
  return out;
}

/** Feed `seconds` of audio; returns the elapsed second at which the detector fired, or null. */
function feed(detector: SilenceDetector, seconds: number, amplitude: number): number | null {
  const blocks = Math.ceil((seconds * RATE) / BLOCK);
  for (let i = 0; i < blocks; i += 1) {
    if (detector.push(block(amplitude))) return detector.elapsedSeconds();
  }
  return null;
}

describe("SilenceDetector (10 s auto-stop)", () => {
  it("uses a 10 second window", () => {
    expect(DICTATION_SILENCE_SECONDS).toBe(10);
  });

  it("stops after 10 s when nobody speaks", () => {
    const detector = new SilenceDetector(RATE);
    const firedAt = feed(detector, 12, 0.001);
    expect(firedAt).not.toBeNull();
    expect(firedAt!).toBeGreaterThanOrEqual(10);
    expect(firedAt!).toBeLessThan(10.1);
  });

  it("keeps recording while speech continues, and stops 10 s after the last word", () => {
    const detector = new SilenceDetector(RATE);
    expect(feed(detector, 30, 0.2)).toBeNull(); // 30 s of continuous speech
    expect(feed(detector, 9.8, 0.0005)).toBeNull(); // 9.8 s pause: still recording
    const firedAt = feed(detector, 1, 0.0005);
    expect(firedAt).not.toBeNull();
    expect(firedAt! - 30).toBeGreaterThanOrEqual(10);
    expect(firedAt! - 30).toBeLessThan(10.1);
  });

  it("restarts the window whenever speech resumes inside a pause", () => {
    const detector = new SilenceDetector(RATE);
    expect(feed(detector, 8, 0.0005)).toBeNull();
    expect(feed(detector, 0.5, 0.2)).toBeNull();
    expect(feed(detector, 9.5, 0.0005)).toBeNull();
    expect(detector.silentSeconds()).toBeLessThan(10);
  });
});

describe("composer append (never replace)", () => {
  it("appends to existing text with a single separating space", () => {
    expect(appendTranscript("", "hello world")).toBe("hello world");
    expect(appendTranscript("Existing draft", "hello")).toBe("Existing draft hello");
    expect(appendTranscript("Line one\n", "next")).toBe("Line one\nnext");
    expect(appendTranscript("trailing ", "  padded  ")).toBe("trailing padded");
    expect(appendTranscript("keep me", "   ")).toBe("keep me");
  });

  it("pads inline insertions so words never run together", () => {
    expect(spacedInsertion("Hello", "world", "big")).toBe(" big ");
    expect(spacedInsertion("Hello ", ".", "there")).toBe("there");
    expect(spacedInsertion("", "", "solo")).toBe("solo");
  });
});

describe("editor insertion at caret (never replace)", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ extensions: [StarterKit], content: "<p>Alpha beta</p><p>Gamma</p>" });
  });
  afterEach(() => editor.destroy());

  it("inserts at the caret", () => {
    // caret right after "Alpha"
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    expect(insertTranscriptIntoEditor(editor, "dictated", true)).toBe(true);
    expect(editor.getText()).toBe("Alpha dictated beta\n\nGamma");
  });

  it("keeps a selected range and inserts after it instead of replacing it", () => {
    // select "beta"
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 11)));
    insertTranscriptIntoEditor(editor, "added", true);
    expect(editor.getText()).toBe("Alpha beta added\n\nGamma");
  });

  it("appends at the end of the page when no caret was placed", () => {
    insertTranscriptIntoEditor(editor, "the end", false);
    expect(editor.getText()).toBe("Alpha beta\n\nGamma the end");
  });

  it("treats transcript text literally (no HTML parsing)", () => {
    insertTranscriptIntoEditor(editor, "<b>x</b> & y", false);
    expect(editor.getText()).toContain("<b>x</b> & y");
  });

  it("moves the caret after the inserted text so consecutive dictations chain", () => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    insertTranscriptIntoEditor(editor, "one", true);
    insertTranscriptIntoEditor(editor, "two", true);
    expect(editor.getText()).toBe("Alpha one two beta\n\nGamma");
  });
});
