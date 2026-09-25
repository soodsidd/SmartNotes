const BRIDGE_PATH = 'smart-notes-focus-bridge.js';

// This source runs inside the same-origin JupyterLab frame. It uses Lab's
// public shell/notebook/editor models plus browser selection geometry to send
// bounded live context to Smart Notes. Host answers are applied to the live
// shared model in one undoable transaction; this bridge never writes an
// .ipynb file on disk directly.
const JUPYTER_FOCUS_BRIDGE_SOURCE = String.raw`(() => {
  'use strict';

  const SOURCE = 'smart-notes-jupyter-focus';
  const HOST_SOURCE = 'smart-notes-jupyter-host';
  const VERSION = 2;
  const MAX_WAIT_ATTEMPTS = 300;
  const RETRY_MS = 100;
  const MAX_CONTEXT_CELLS = 5;
  const MAX_CELL_SOURCE_BYTES = 12 * 1024;
  const MAX_EMITTED_SOURCE_BYTES = 7 * 1024;
  // SN-250: raised from 48 KiB to make room for the active cell's bounded execution outputs.
  const MAX_CONTEXT_BYTES = 64 * 1024;
  const MAX_ANSWER_BYTES = 48 * 1024;
  const MAX_SELECTION_RECTS = 32;
  // SN-250: at most this many of the active cell's most recent execution outputs are kept (errors always kept).
  const MAX_OUTPUT_ITEMS = 3;
  const MAX_OUTPUT_BYTES = 2 * 1024;
  let currentDisposers = [];
  let reportTimer = 0;
  let lastPayload = '';
  const modelRevisions = new WeakMap();

  const connect = (signal, handler, bucket = currentDisposers) => {
    if (!signal || typeof signal.connect !== 'function') return;
    signal.connect(handler);
    bucket.push(() => {
      try { signal.disconnect(handler); } catch {}
    });
  };

  const disposeCurrent = () => {
    for (const dispose of currentDisposers.splice(0)) dispose();
  };

  const byteLength = (value) => {
    let bytes = 0;
    for (const character of String(value)) {
      const codePoint = character.codePointAt(0) || 0;
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
  };

  const truncateUtf8 = (value, maxBytes) => {
    const text = typeof value === 'string' ? value : String(value || '');
    if (byteLength(text) <= maxBytes) return { source: text, truncated: false };
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (byteLength(text.slice(0, mid)) <= maxBytes) low = mid;
      else high = mid - 1;
    }
    let source = text.slice(0, low);
    if (/[\uD800-\uDBFF]$/.test(source)) source = source.slice(0, -1);
    return { source, truncated: true };
  };

  // A source fingerprint plus a monotonic live-model revision makes captured
  // targets conflict-aware, including change-then-revert races.
  const sourceRevision = (value) => {
    const text = typeof value === 'string' ? value : String(value || '');
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
    }
    return text.length + ':' + first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
  };

  const modelRevision = (model) => {
    if (!model || (typeof model !== 'object' && typeof model !== 'function')) return 0;
    return modelRevisions.get(model) || 0;
  };

  const bumpModelRevision = (model) => {
    if (!model || (typeof model !== 'object' && typeof model !== 'function')) return;
    modelRevisions.set(model, modelRevision(model) + 1);
  };

  const normalizeWorkspacePath = (value) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 1024 || /[\u0000-\u001f\u007f]/.test(text)) return null;
    const normalized = text.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return null;
    if (normalized.split('/').some((part) => part === '..' || part === '.')) return null;
    return normalized;
  };

  const normalizePosition = (editor, value) => {
    if (!value || !Number.isInteger(value.line) || !Number.isInteger(value.column)) return null;
    try {
      const offset = editor.getOffsetAt(value);
      if (!Number.isInteger(offset) || offset < 0) return null;
      return { line: value.line, column: value.column, offset };
    } catch {
      return null;
    }
  };

  const rectFromDomRect = (rect) => {
    if (!rect) return null;
    const x = Number(rect.x === undefined ? rect.left : rect.x);
    const y = Number(rect.y === undefined ? rect.top : rect.y);
    const width = Number(rect.width === undefined ? Number(rect.right) - Number(rect.left) : rect.width);
    const height = Number(rect.height === undefined ? Number(rect.bottom) - Number(rect.top) : rect.height);
    if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
    return { x, y, width, height, top: y, right: x + width, bottom: y + height, left: x };
  };

  const selectionRects = (editor, selection) => {
    const rects = [];
    try {
      const browserSelection = window.getSelection && window.getSelection();
      if (browserSelection && browserSelection.rangeCount > 0) {
        if (!browserSelection.isCollapsed) {
          const rangeRects = browserSelection.getRangeAt(0).getClientRects();
          for (let index = 0; index < rangeRects.length && rects.length < MAX_SELECTION_RECTS; index += 1) {
            const rect = rectFromDomRect(rangeRects[index]);
            if (rect) rects.push(rect);
          }
        } else {
          // SN-252: getClientRects() is often empty for a collapsed caret, but
          // getBoundingClientRect() still yields a line-height box the host can
          // use to place Write code / Answer comment without a text selection.
          const caretRect = rectFromDomRect(browserSelection.getRangeAt(0).getBoundingClientRect());
          if (caretRect) rects.push(caretRect);
        }
      }
    } catch {}
    if (rects.length) return rects;
    const position = (selection && selection.start)
      || (editor && typeof editor.getCursorPosition === 'function' ? editor.getCursorPosition() : null);
    if (!position || !editor || typeof editor.getCoordinateForPosition !== 'function') return rects;
    try {
      const start = editor.getCoordinateForPosition(position);
      const end = selection && selection.end ? editor.getCoordinateForPosition(selection.end) : start;
      if (!start || !end) return rects;
      const left = Math.min(Number(start.left), Number(end.left));
      const top = Math.min(Number(start.top), Number(end.top));
      const right = Math.max(Number(start.right), Number(end.right));
      const bottom = Math.max(Number(start.bottom), Number(end.bottom));
      const rect = rectFromDomRect({ left, top, right, bottom, width: right - left, height: bottom - top });
      if (rect) rects.push(rect);
    } catch {}
    return rects;
  };

  const editorSnapshot = (editor) => {
    if (!editor || typeof editor.getCursorPosition !== 'function') {
      return { caret: null, selection: null, selectionRects: [] };
    }
    try {
      const caret = normalizePosition(editor, editor.getCursorPosition());
      const rawSelection = typeof editor.getSelection === 'function' ? editor.getSelection() : null;
      const start = normalizePosition(editor, rawSelection && rawSelection.start);
      const end = normalizePosition(editor, rawSelection && rawSelection.end);
      const selection = start && end ? { start, end } : null;
      return { caret, selection, selectionRects: selectionRects(editor, rawSelection) };
    } catch {
      return { caret: null, selection: null, selectionRects: [] };
    }
  };

  const cellSource = (model) => {
    try {
      if (model && model.sharedModel && typeof model.sharedModel.getSource === 'function') {
        const source = model.sharedModel.getSource();
        return typeof source === 'string' ? source : '';
      }
      if (model && model.value && typeof model.value.text === 'string') return model.value.text;
    } catch {}
    return '';
  };

  const cellKind = (model) => {
    const value = model && (model.type || model.cell_type);
    return value === 'code' || value === 'markdown' || value === 'raw' ? value : 'unknown';
  };

  // SN-250: bounded active-cell execution outputs. Mirrors the nbformat
  // reading in src/server/vault/jupyter-notebook.ts (stream/error/rich-text
  // extraction, image mime omission) so live and saved-notebook context agree
  // on shape, but stays byte-bounded like the rest of this bridge.
  const outputSourceText = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'string' ? entry : String(entry || ''))).join('');
    return '';
  };

  const outputMimeText = (data) => {
    if (!data || typeof data !== 'object') return '';
    const plain = data['text/plain'];
    if (typeof plain === 'string') return plain;
    if (Array.isArray(plain)) return plain.map((entry) => (typeof entry === 'string' ? entry : String(entry || ''))).join('');
    const imageMime = Object.keys(data).find((key) => key.indexOf('image/') === 0);
    return imageMime ? '[' + imageMime + ' output omitted]' : '';
  };

  const rawCellOutputs = (model) => {
    const list = [];
    try {
      const area = model && model.outputs;
      if (area && typeof area.length === 'number') {
        for (let index = 0; index < area.length; index += 1) {
          const output = typeof area.get === 'function' ? area.get(index) : null;
          const json = output && typeof output.toJSON === 'function' ? output.toJSON() : output;
          if (json && typeof json === 'object') list.push(json);
        }
      }
    } catch {}
    return list;
  };

  // Errors are always kept (execution normally halts at the first one); the
  // remaining budget is filled with the most recent non-error outputs so a
  // traceback is never pushed out by earlier stdout.
  const selectRecentOutputs = (raw, maxItems) => {
    const errors = raw.filter((output) => output && output.output_type === 'error');
    const others = raw.filter((output) => !output || output.output_type !== 'error');
    const keep = others.slice(-Math.max(0, maxItems - errors.length));
    const keepSet = new Set(errors.concat(keep));
    return raw.filter((output) => keepSet.has(output));
  };

  const cellOutputsSnapshot = (model) => {
    const raw = rawCellOutputs(model);
    if (!raw.length) return { outputs: [], outputsTruncated: false };
    const selected = selectRecentOutputs(raw, MAX_OUTPUT_ITEMS);
    const outputs = selected.map((output) => {
      const outputType = typeof output.output_type === 'string' ? output.output_type : 'output';
      let text = '';
      if (outputType === 'stream') {
        text = outputSourceText(output.text);
      } else if (outputType === 'error') {
        const traceback = outputSourceText(output.traceback);
        const summary = [output.ename, output.evalue].filter((entry) => typeof entry === 'string').join(': ');
        text = traceback || summary;
      } else if (outputType === 'execute_result' || outputType === 'display_data') {
        text = outputMimeText(output.data);
      }
      const bounded = truncateUtf8(text, MAX_OUTPUT_BYTES);
      return { kind: outputType, text: bounded.source, truncated: bounded.truncated };
    });
    return { outputs, outputsTruncated: raw.length > selected.length };
  };

  const contentSnapshot = (content, isNotebook, editor, activeCellIndex, editorState) => {
    if (isNotebook) {
      const widgets = Array.isArray(content.widgets) ? content.widgets : [];
      if (activeCellIndex === null || !widgets.length) {
        return {
          activeCellSource: null,
          activeCellSourceStart: 0,
          activeCellSourceTruncated: false,
          activeCellOutputs: [],
          activeCellOutputsTruncated: false,
          cells: [],
          windowTruncated: false
        };
      }
      const start = Math.max(0, Math.min(activeCellIndex - Math.floor(MAX_CONTEXT_CELLS / 2), widgets.length - MAX_CONTEXT_CELLS));
      const selected = widgets.slice(start, start + MAX_CONTEXT_CELLS);
      const cells = selected.map((cell, offset) => {
        const model = cell && cell.model;
        const bounded = truncateUtf8(cellSource(model), Math.min(MAX_CELL_SOURCE_BYTES, MAX_EMITTED_SOURCE_BYTES));
        return {
          index: start + offset,
          id: model && typeof model.id === 'string' ? model.id : null,
          kind: cellKind(model),
          source: bounded.source,
          sourceTruncated: bounded.truncated
        };
      });
      const activeCell = cells.find((cell) => cell.index === activeCellIndex) || null;
      // Outputs are only ever gathered for the active cell (never neighbours),
      // and only for code cells — markdown/raw cells never have outputs.
      const activeWidget = widgets[activeCellIndex];
      const activeOutputs = activeCell && activeCell.kind === 'code' && activeWidget
        ? cellOutputsSnapshot(activeWidget.model)
        : { outputs: [], outputsTruncated: false };
      const snapshot = {
        activeCellSource: activeCell ? activeCell.source : null,
        activeCellSourceStart: 0,
        activeCellSourceTruncated: activeCell ? activeCell.sourceTruncated : false,
        activeCellOutputs: activeOutputs.outputs,
        activeCellOutputsTruncated: activeOutputs.outputsTruncated,
        cells,
        windowTruncated: widgets.length > cells.length
      };
      return byteLength(JSON.stringify(snapshot)) <= MAX_CONTEXT_BYTES
        ? snapshot
        : {
          activeCellSource: null,
          activeCellSourceStart: 0,
          activeCellSourceTruncated: true,
          activeCellOutputs: [],
          activeCellOutputsTruncated: true,
          cells: [],
          windowTruncated: true
        };
    }
    if (editor && editor.model) {
      const fullSource = cellSource(editor.model);
      const center = editorState && editorState.selection
        ? Math.floor((editorState.selection.start.offset + editorState.selection.end.offset) / 2)
        : editorState && editorState.caret
          ? editorState.caret.offset
          : 0;
      // Reserve worst-case UTF-8 space before the caret so it remains inside
      // the emitted window even when every preceding character is four bytes.
      const radius = Math.floor(MAX_EMITTED_SOURCE_BYTES / 4);
      const start = Math.max(0, center - radius);
      const bounded = truncateUtf8(fullSource.slice(start), Math.min(MAX_CELL_SOURCE_BYTES, MAX_EMITTED_SOURCE_BYTES));
      return {
        activeCellSource: bounded.source,
        activeCellSourceStart: start,
        activeCellSourceTruncated: start > 0 || bounded.truncated,
        activeCellOutputs: [],
        activeCellOutputsTruncated: false,
        cells: [],
        windowTruncated: false
      };
    }
    return null;
  };

  const currentParts = (app) => {
    const shell = app && app.shell;
    const widget = shell && shell.currentWidget;
    const content = widget && widget.content;
    const contextPath = widget && widget.context && widget.context.path;
    const shellPath = shell && shell.currentPath;
    const workspacePath = normalizeWorkspacePath(
      typeof contextPath === 'string' && contextPath
        ? contextPath
        : typeof shellPath === 'string' && shellPath
          ? shellPath
          : null
    );
    const isNotebook = Boolean(content && typeof content.activeCellIndex === 'number' && 'activeCell' in content);
    const activeCell = isNotebook ? content.activeCell : null;
    const editor = isNotebook
      ? activeCell && activeCell.editor
      : content && content.editor
        ? content.editor
        : null;
    const activeCellIndex = isNotebook && Number.isInteger(content.activeCellIndex) && content.activeCellIndex >= 0
      ? content.activeCellIndex
      : null;
    const activeCellId = activeCell && activeCell.model && typeof activeCell.model.id === 'string'
      ? activeCell.model.id
      : null;
    return { shell, widget, content, workspacePath, isNotebook, activeCell, editor, activeCellIndex, activeCellId };
  };

  const focusSnapshot = (app) => {
    const parts = currentParts(app);
    const editorState = editorSnapshot(parts.editor);
    const activeModel = parts.activeCell && parts.activeCell.model
      ? parts.activeCell.model
      : parts.editor && parts.editor.model;
    const activeSource = cellSource(activeModel);
    // SN-257: report the document's dirty/clean state so the Deep Work toolbar
    // can reflect save state without a separate polling mechanism.
    const isDirty = Boolean(
      parts.widget && parts.widget.context && parts.widget.context.model &&
      parts.widget.context.model.dirty
    );
    return {
      workspacePath: parts.workspacePath,
      documentKind: parts.isNotebook ? 'notebook' : parts.editor ? 'file' : parts.widget ? 'other' : null,
      activeCellIndex: parts.activeCellIndex,
      activeCellId: parts.activeCellId,
      sourceRevision: activeModel ? sourceRevision(activeSource) : null,
      modelRevision: activeModel && activeModel.sharedModel
        ? modelRevision(activeModel.sharedModel)
        : null,
      isDirty,
      caret: editorState.caret,
      selection: editorState.selection,
      selectionRects: editorState.selectionRects,
      content: contentSnapshot(parts.content, parts.isNotebook, parts.editor, parts.activeCellIndex, editorState)
    };
  };

  const post = (envelope) => window.parent.postMessage(envelope, window.location.origin);

  const scheduleReport = (app) => {
    window.clearTimeout(reportTimer);
    reportTimer = window.setTimeout(() => report(app), 0);
  };

  const report = (app) => {
    const envelope = { source: SOURCE, version: VERSION, kind: 'focus', focus: focusSnapshot(app) };
    const serialized = JSON.stringify(envelope);
    if (serialized === lastPayload) return;
    lastPayload = serialized;
    post(envelope);
  };

  const samePosition = (a, b) => Boolean(a && b && a.line === b.line && a.column === b.column && a.offset === b.offset);
  const validTargetPosition = (value, sourceLength) => Boolean(
    value && Number.isInteger(value.line) && value.line >= 0 && Number.isInteger(value.column) && value.column >= 0 &&
    Number.isInteger(value.offset) && value.offset >= 0 && value.offset <= sourceLength
  );

  const applyAnswer = (app, message) => {
    const requestId = message && typeof message.requestId === 'string' ? message.requestId.trim() : '';
    const answer = message && typeof message.answer === 'string' ? message.answer : null;
    const target = message && message.target;
    const parts = currentParts(app);
    let reason = null;
    if (!requestId || requestId.length > 200) reason = 'Invalid request id.';
    else if (answer === null || byteLength(answer) > MAX_ANSWER_BYTES) reason = 'Answer exceeds the bridge size limit.';
    else if (!target || normalizeWorkspacePath(target.workspacePath) !== parts.workspacePath) reason = 'The focused Jupyter document changed.';
    else if (target.activeCellIndex !== parts.activeCellIndex || target.activeCellId !== parts.activeCellId) reason = 'The active Jupyter cell changed.';

    const model = parts.activeCell && parts.activeCell.model
      ? parts.activeCell.model
      : parts.editor && parts.editor.model;
    const sharedModel = model && model.sharedModel;
    const source = cellSource(model);
    if (!reason && (typeof target.sourceRevision !== 'string' || target.sourceRevision !== sourceRevision(source))) {
      reason = 'The live Jupyter source changed after this AI target was captured.';
    }
    if (!reason && (!Number.isInteger(target.modelRevision) || target.modelRevision !== modelRevision(sharedModel))) {
      reason = 'The live Jupyter model changed after this AI target was captured.';
    }
    let start = null;
    let end = null;
    if (!reason && target.selection && validTargetPosition(target.selection.start, source.length) && validTargetPosition(target.selection.end, source.length)) {
      start = Math.min(target.selection.start.offset, target.selection.end.offset);
      end = Math.max(target.selection.start.offset, target.selection.end.offset);
    } else if (!reason && validTargetPosition(target.caret, source.length)) {
      start = target.caret.offset;
      end = target.caret.offset;
    } else if (!reason) {
      reason = 'The target selection is no longer valid.';
    }
    if (!reason && (!sharedModel || typeof sharedModel.transact !== 'function' || typeof sharedModel.updateSource !== 'function')) {
      reason = 'The live Jupyter document does not expose an undoable shared model.';
    }

    if (!reason) {
      try {
        // One shared-model transaction is one Jupyter undo step. No filesystem
        // call exists in this path; normal Jupyter save/autosave remains owner.
        sharedModel.transact(() => sharedModel.updateSource(start, end, answer), true);
      } catch {
        reason = 'Jupyter rejected the live document update.';
      }
    }
    const focus = focusSnapshot(app);
    post({
      source: SOURCE,
      version: VERSION,
      kind: 'apply-answer-result',
      result: { requestId, ok: !reason, reason },
      focus
    });
    if (!reason) scheduleReport(app);
  };

  // SN-257: the host speaks in a deliberately small semantic vocabulary. Lab
  // command ids stay inside this injected, pinned-version bridge so an outer
  // frame can never turn postMessage into arbitrary command execution.
  const DEEP_WORK_COMMANDS = {
    'save': ['docmanager:save'],
    'run-selection': ['fileeditor:run-code'],
    'run-file': ['fileeditor:run-all'],
    'open-console': ['fileeditor:create-console', 'notebook:create-console'],
    'format-document': ['lsp:formatting', 'lsp:format-document'],
    'format-selection': ['lsp:formatting', 'lsp:format-selection'],
    'run-cell': ['notebook:run-cell'],
    'run-all': ['notebook:run-all-cells'],
    'interrupt-kernel': ['notebook:interrupt-kernel'],
    'restart-kernel': ['notebook:restart-kernel'],
    'select-kernel': ['notebook:change-kernel'],
    'open-terminal': ['terminal:create-new'],
    'new-notebook': ['notebook:create-new'],
    'reload-files': ['filebrowser:refresh'],
    // SN-270: reload only the focused document from disk, in place. The
    // outer frame uses this instead of remounting the Jupyter view, which
    // would tear down the Deep Work session, its capability, and the root.
    'reload-document': ['docmanager:reload'],
    'open-settings': ['settingeditor:open'],
    'manage-kernels': ['running:show-panel', 'running:show'],
    'focus-file': ['docmanager:open']
  };

  // SN-270: refusal text for a reload whose target lost focus before the
  // command reached the frame. Shared by the queue-time and execute-time
  // checks so the owner sees one consistent explanation.
  const FOCUS_CHANGED_REASON = 'The focused document changed, so it was not reloaded from disk.';

  const dispatchCommand = async (app, message) => {
    const requestId = message && typeof message.requestId === 'string' ? message.requestId.trim() : '';
    const semantic = message && typeof message.command === 'string' ? message.command : '';
    const candidates = DEEP_WORK_COMMANDS[semantic];
    // SN-270: both path-addressed commands normalize here. reload-document
    // must name its target so the reload cannot land on a document the owner
    // switched to after the host queued the command.
    const pathAddressed = semantic === 'focus-file' || semantic === 'reload-document';
    const focusPath = pathAddressed ? normalizeWorkspacePath(message && message.path) : null;
    const focusLine = message && Number.isInteger(message.line) && message.line >= 1 && message.line <= 10000000
      ? message.line
      : null;
    let reason = null;
    if (!requestId || requestId.length > 200) reason = 'Invalid request id.';
    else if (!candidates) reason = 'This Deep Work command is not allowed.';
    else if (pathAddressed && !focusPath) reason = 'The requested file path is not safe.';
    else if (!app.commands || typeof app.commands.execute !== 'function') reason = 'JupyterLab commands are unavailable.';

    // SN-270: two guards, in this order, evaluated as late as possible.
    //
    // 1. Identity. docmanager:reload acts on whatever is focused *at
    //    execution time*, and this command is queued in the host frame and
    //    delivered asynchronously. If the owner switched tabs in between, the
    //    focused document is no longer the one the write landed on, and
    //    reloading it would discard an unrelated document's state for an edit
    //    it never received. Re-read the live focus here - not from the queued
    //    message, not from an earlier snapshot - and refuse on any mismatch.
    // 2. Dirty. An external (Companion) write must never silently discard the
    //    owner's unsaved cells. This check stays *after* the identity check so
    //    a mismatch is always reported as a focus change rather than being
    //    masked by the dirty state of some other document.
    if (!reason && semantic === 'reload-document') {
      const parts = currentParts(app);
      const model = parts.widget && parts.widget.context && parts.widget.context.model;
      if (!parts.widget || !parts.workspacePath) {
        reason = 'No Jupyter document is open to reload.';
      } else if (parts.workspacePath !== focusPath) {
        reason = FOCUS_CHANGED_REASON;
      } else if (model && model.dirty) {
        reason = 'This document has unsaved changes, so it was not reloaded from disk.';
      }
    }

    if (!reason) {
      const commandId = candidates.find((candidate) =>
        typeof app.commands.hasCommand !== 'function' || app.commands.hasCommand(candidate)
      );
      if (!commandId) {
        reason = 'This command is unavailable in the managed JupyterLab profile.';
      } else {
        try {
          const result = semantic === 'focus-file'
            ? await app.commands.execute(commandId, { path: focusPath })
            : await app.commands.execute(commandId);
          // Keep terminals in the durable bottom panel while creation and
          // lifecycle remain owned by JupyterLab's terminal command.
          if (semantic === 'open-terminal' && result && result.id && app.shell && typeof app.shell.add === 'function') {
            app.shell.add(result, 'down', { rank: 100 });
            if (typeof app.shell.activateById === 'function') app.shell.activateById(result.id);
          }
          if (semantic === 'focus-file' && focusLine) {
            const openedEditor = result && result.content && result.content.editor;
            if (openedEditor && typeof openedEditor.setCursorPosition === 'function') {
              openedEditor.setCursorPosition({ line: focusLine - 1, column: 0 });
            }
          }
        } catch {
          reason = 'JupyterLab could not complete the command.';
        }
      }
    }

    post({
      source: SOURCE,
      version: VERSION,
      kind: 'command-result',
      result: { requestId, command: semantic, ok: !reason, reason },
      focus: focusSnapshot(app)
    });
    if (!reason) scheduleReport(app);
  };

  const bindCurrentWidget = (app) => {
    disposeCurrent();
    const parts = currentParts(app);
    const content = parts.content;
    const context = parts.widget && parts.widget.context;
    connect(context && context.pathChanged, () => scheduleReport(app));

    const bindEditor = (editor) => {
      connect(editor && editor.model && editor.model.selections && editor.model.selections.changed,
        () => scheduleReport(app));
      const model = editor && editor.model;
      const sharedModel = model && model.sharedModel;
      connect(sharedModel && sharedModel.changed, () => {
        bumpModelRevision(sharedModel);
        scheduleReport(app);
      });
    };

    // SN-257: bind the document's dirty-state signal so a save (which clears
    // dirty) triggers a re-report and the toolbar reflects the updated state.
    // context.model.stateChanged fires on any state transition including dirty.
    connect(context && context.model && context.model.stateChanged, () => scheduleReport(app));

    if (parts.isNotebook) {
      connect(content.activeCellChanged, () => bindCurrentWidget(app));
      connect(content.selectionChanged, () => scheduleReport(app));
      connect(content.model && content.model.cells && content.model.cells.changed, () => bindCurrentWidget(app));
      bindEditor(parts.activeCell && parts.activeCell.editor);
      // SN-250: re-execution replaces the output area without necessarily
      // touching contentChanged (source text), so bind separately or a fresh
      // traceback/stdout would not reach the next fast-lane report.
      connect(
        parts.activeCell && parts.activeCell.model && parts.activeCell.model.outputs && parts.activeCell.model.outputs.changed,
        () => scheduleReport(app)
      );
      const widgets = Array.isArray(content.widgets) ? content.widgets : [];
      const start = parts.activeCellIndex === null
        ? 0
        : Math.max(0, Math.min(parts.activeCellIndex - Math.floor(MAX_CONTEXT_CELLS / 2), widgets.length - MAX_CONTEXT_CELLS));
      for (const cell of widgets.slice(start, start + MAX_CONTEXT_CELLS)) {
        connect(cell && cell.model && cell.model.contentChanged, () => scheduleReport(app));
      }
    } else {
      bindEditor(parts.editor);
    }
    scheduleReport(app);
  };

  const start = (app) => {
    const shellDisposers = [];
    const rebind = () => bindCurrentWidget(app);
    connect(app.shell && app.shell.currentChanged, rebind, shellDisposers);
    connect(app.shell && app.shell.currentPathChanged, rebind, shellDisposers);
    connect(app.shell && app.shell.activeChanged, rebind, shellDisposers);

    // Companion AI must not steal JupyterLab's native menus (file browser New
    // File, cell actions, etc.). Plain right-click always belongs to Lab.
    // Alt+Right-click (Option on macOS) inside a code editor / notebook cell
    // opens the host inline-AI overlay instead.
    const isCodeEditorContextTarget = (target) => {
      if (!target || typeof target.closest !== 'function') return false;
      return Boolean(target.closest([
        '.cm-editor',
        '.CodeMirror',
        '.jp-Editor',
        '.jp-FileEditorCodeWrapper',
        '.jp-Notebook .jp-Cell',
        '.jp-CodeCell',
        '.jp-MarkdownCell',
        '.jp-RawCell',
        '[data-jp-code-mirror]'
      ].join(',')));
    };
    const onContextMenu = (event) => {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      const coarsePointer = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      if (coarsePointer || window.innerWidth < 768) return;
      if (!event.altKey) return;
      if (!isCodeEditorContextTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      post({
        source: SOURCE,
        version: VERSION,
        kind: 'contextmenu',
        contextmenu: { x: event.clientX, y: event.clientY },
        focus: focusSnapshot(app)
      });
    };
    const onScroll = () => post({ source: SOURCE, version: VERSION, kind: 'dismiss-overlay', reason: 'scroll' });
    // SN-252: caret-only "send this comment to the fast lane and append code
    // below it" chord. Ctrl/Cmd+Alt+Enter is unclaimed by CodeMirror's
    // edit-mode bindings and by Jupyter's own execute/insert shortcuts
    // (Shift+Enter, Ctrl+Enter, Alt+Enter alone are all command-mode or plain
    // Enter, not this exact combo), so it has no native meaning to preempt.
    // The bridge does not decide whether the caret line is actually a
    // natural-language comment — it always forwards a fresh focus snapshot
    // and lets the host (single source of truth for comment detection,
    // findJupyterNaturalLanguageComment) decide and no-op when it isn't.
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.key !== 'Enter' || event.shiftKey) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      post({
        source: SOURCE,
        version: VERSION,
        kind: 'keybinding',
        keybinding: { binding: 'comment-append' },
        focus: focusSnapshot(app)
      });
    };
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.source !== HOST_SOURCE || message.version !== VERSION) return;
      if (message.kind === 'apply-answer') applyAnswer(app, message);
      else if (message.kind === 'command') void dispatchCommand(app, message);
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
    bindCurrentWidget(app);
    window.addEventListener('pagehide', () => {
      disposeCurrent();
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('message', onMessage);
      for (const dispose of shellDisposers.splice(0)) dispose();
    }, { once: true });
  };

  const waitForApp = (attempt = 0) => {
    const app = window.jupyterapp;
    if (app && app.shell) {
      Promise.resolve(app.restored).then(() => start(app));
      return;
    }
    if (attempt < MAX_WAIT_ATTEMPTS) {
      window.setTimeout(() => waitForApp(attempt + 1), RETRY_MS);
    }
  };

  waitForApp();
})();
`;

function bridgeRequestPath(session) {
  return `${session.proxyBasePath}${BRIDGE_PATH}`;
}

function isBridgeRequest(pathname, session) {
  return pathname === bridgeRequestPath(session);
}

function injectFocusBridge(html, session) {
  if (typeof html !== 'string' || html.includes(BRIDGE_PATH)) return html;
  const tag = `<script src="${bridgeRequestPath(session)}"></script>`;
  const bodyIndex = html.toLowerCase().lastIndexOf('</body>');
  return bodyIndex >= 0 ? `${html.slice(0, bodyIndex)}${tag}${html.slice(bodyIndex)}` : `${html}${tag}`;
}

module.exports = {
  BRIDGE_PATH,
  JUPYTER_FOCUS_BRIDGE_SOURCE,
  bridgeRequestPath,
  injectFocusBridge,
  isBridgeRequest,
};
