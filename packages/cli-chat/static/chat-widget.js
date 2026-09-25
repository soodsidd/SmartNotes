/**
 * chat-widget.js — Self-contained floating chat widget with SPA navigation.
 * Pages load inside an iframe; the chat widget lives in the top frame and
 * persists across all page navigations. Uses SocketIO + /api/chat/send to
 * stream LLM responses via local CLI.
 *
 * Include on any page: <script src="/api/chat/static/chat-widget.js"></script>
 *
 * Optional config (set before loading):
 *   window.CHAT_WIDGET_CONFIG = {
 *     welcomeMessage: 'Ask me anything!',
 *     hideSettingsButton: true,
 *     hidePageContextControl: true,
 *   };
 *
 * Set window.PAGE_CONTEXT to provide page context (no user data).
 */
(function () {
  'use strict';

  var _cfg = window.CHAT_WIDGET_CONFIG || {};
  var WELCOME_MSG = _cfg.welcomeMessage || 'Ask me anything! I can help with your project.';
  var DISABLE_SPA = !!_cfg.disableSpa;
  var HIDE_SETTINGS_BUTTON = !!_cfg.hideSettingsButton;
  var HIDE_PAGE_CONTEXT_CONTROL = !!_cfg.hidePageContextControl;
  var settingsCache = {};
  var providerCatalog = {};
  var projectCatalog = [];
  var PROVIDER_SETTINGS = {
    claude: { modelKey: 'claudeModel', effortKey: '', supportsEffort: false },
    ghcopilot: { modelKey: 'ghcopilotModel', effortKey: 'ghcopilotEffort', supportsEffort: true },
    codex: { modelKey: 'codexModel', effortKey: 'codexEffort', supportsEffort: true },
  };
  var WIDGET_HOST_ID = 'cw-shadow-host';
  var WIDGET_SINGLETON_KEY = '__CW_WIDGET_SINGLETON__';
  var PENDING_SEED_KEY = 'rr_chat_seed';
  var widgetHost = null;
  var widgetShadow = null;
  var widgetRoot = null;
  var widgetReady = false;
  var widgetSingleton = null;

  function rootById(id) {
    return widgetShadow ? widgetShadow.querySelector('#' + id) : document.getElementById(id);
  }

  function rootQuery(selector) {
    return widgetShadow ? widgetShadow.querySelector(selector) : document.querySelector(selector);
  }

  function storePendingSeed(seed) {
    try { localStorage.setItem(PENDING_SEED_KEY, seed || ''); } catch (_) {}
  }

  function takePendingSeed() {
    try {
      var seed = localStorage.getItem(PENDING_SEED_KEY) || '';
      localStorage.removeItem(PENDING_SEED_KEY);
      return seed;
    } catch (_) {
      return '';
    }
  }

  // ==================================================================
  // IFRAME GUEST MODE — runs inside the SPA content iframe
  // ==================================================================
  if (window !== window.top) {
    try {
      if (window.frameElement && window.frameElement.id === 'cw-frame') {
        const ensureViewportMeta = () => {
          let viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
          }
          const content = viewport.getAttribute('content') || '';
          const parts = content.split(',').map(part => part.trim()).filter(Boolean);
          const nextParts = parts.filter(part => !/^viewport-fit=/i.test(part));
          if (!nextParts.some(part => /^width=/i.test(part))) nextParts.unshift('width=device-width');
          if (!nextParts.some(part => /^initial-scale=/i.test(part))) nextParts.push('initial-scale=1');
          nextParts.push('viewport-fit=cover');
          viewport.setAttribute('content', nextParts.join(', '));
        };

        ensureViewportMeta();

        // Post page info to parent on load
        const postInfo = () => window.top.postMessage({
          type: 'cw-page',
          url: location.pathname + location.search,
          title: document.title,
          context: window.PAGE_CONTEXT || ''
        }, location.origin);

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', postInfo);
        } else {
          postInfo();
        }

        // Intercept internal link clicks (capture phase)
        document.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
          const a = e.target.closest('a[href]');
          if (!a || a.target === '_blank') return;
          try {
            const u = new URL(a.href, location.origin);
            if (u.origin !== location.origin) return;
            if (u.pathname + u.search === location.pathname + location.search) return;
            e.preventDefault();
            e.stopPropagation();
            window.top.postMessage({
              type: 'cw-nav', url: u.pathname + u.search
            }, location.origin);
          } catch (_) {}
        }, true);
      }
    } catch (_) {}
    return; // Never build widget inside any iframe
  }

  widgetSingleton = window[WIDGET_SINGLETON_KEY] || null;
  if (widgetSingleton && (widgetSingleton.loading || widgetSingleton.bootstrapped)) {
    if (typeof widgetSingleton.toggle === 'function') {
      window.CW_TOGGLE = widgetSingleton.toggle;
    }
    return;
  }
  widgetSingleton = widgetSingleton || {};
  widgetSingleton.loading = true;
  widgetSingleton.bootstrapped = false;
  window[WIDGET_SINGLETON_KEY] = widgetSingleton;

  // ==================================================================
  // TOP FRAME — Chat widget + SPA iframe shell
  // ==================================================================

  // ---- Inject CSS ----
  const STYLES = `
  /* SPA iframe */
  #cw-frame {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    border: none; z-index: 1; display: none;
    background: var(--bg, #0d1117);
  }

  /* Chat FAB */
  .cw-fab {
    position: fixed; bottom: 5rem; right: 1.5rem; z-index: 9990;
    width: 50px; height: 50px; border-radius: 50%;
    background: var(--accent, #8ecae6); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); transition: transform 0.15s, box-shadow 0.15s;
  }
  .cw-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.5); }
  .cw-fab svg { width: 24px; height: 24px; fill: #fff; }

  /* Panel */
  .cw-panel {
    position: fixed; bottom: 9rem; right: 1.5rem; z-index: 9991;
    width: 400px; max-width: calc(100vw - 2rem); height: 520px; max-height: calc(100vh - 7rem); max-height: calc(100dvh - 7rem);
    background: var(--bg, #0d1117); border: 1px solid var(--border, #30363d);
    border-radius: 12px; display: none; flex-direction: column;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5); overflow: hidden; font-family: inherit;
  }
  .cw-panel.open { display: flex; }
  .cw-panel.cw-dragging { user-select: none; }
  .cw-hard-hidden { display: none !important; }

  /* Header */
  .cw-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.7rem 1rem; border-bottom: 1px solid var(--border, #30363d);
    background: var(--surface, #161b22); flex-shrink: 0;
  }
  .cw-header-title {
    font-size: 0.88rem; font-weight: 600; color: var(--text, #e6edf3); cursor: grab;
    min-width: 0; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cw-header-title:active { cursor: grabbing; }
    .cw-header-right { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex-shrink: 0; }
  .cw-provider-sel {
    font-size: 0.75rem; padding: 0.2rem 0.4rem;
    background: var(--bg, #0d1117); color: var(--text, #e6edf3);
    border: 1px solid var(--border, #30363d); border-radius: 4px;
      width: 7.5rem; min-width: 7.5rem; max-width: 7.5rem; flex: 0 0 7.5rem;
  }
  .cw-close-btn {
    background: none; border: none; color: var(--text-muted, #8b949e);
    cursor: pointer; font-size: 1.2rem; line-height: 1; padding: 0 0.2rem;
    flex-shrink: 0;
  }
  .cw-close-btn:hover { color: var(--text, #e6edf3); }

  /* Context toggle */
  .cw-ctx-bar {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 1rem; border-bottom: 1px solid var(--border, #30363d);
    font-size: 0.75rem; color: var(--text-muted, #8b949e); flex-shrink: 0;
  }
  .cw-ctx-bar label { cursor: pointer; display: flex; align-items: center; gap: 0.35rem; }
  .cw-ctx-bar input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
  .cw-ctx-page { opacity: 0.7; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cw-settings-panel .cw-ctx-bar {
    padding: 0; border-bottom: none;
  }
  .cw-settings-panel .cw-ctx-page {
    flex: 1 1 auto; min-width: 0; max-width: 100%;
  }

  /* Messages */
  .cw-messages {
    flex: 1; overflow-y: auto; padding: 0.8rem 1rem;
    display: flex; flex-direction: column; gap: 0.6rem;
    -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  }
  .cw-msg { display: flex; flex-direction: column; max-width: 90%; }
  .cw-msg.user { align-self: flex-end; }
  .cw-msg.assistant { align-self: flex-start; }
  .cw-msg.system { align-self: center; }
  .cw-bubble {
    padding: 0.55rem 0.8rem; border-radius: 10px; font-size: 0.88rem;
    line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word;
    max-width: 100%; min-width: 0;
  }
  .cw-msg.user .cw-bubble {
    background: var(--accent, #8ecae6); color: #0d1117; border-bottom-right-radius: 3px;
  }
  .cw-msg.assistant .cw-bubble {
    background: var(--surface, #161b22); color: var(--text, #e6edf3);
    border: 1px solid var(--border, #30363d); border-bottom-left-radius: 3px;
  }
  .cw-msg.system .cw-bubble {
    background: none; color: var(--text-muted, #8b949e); font-size: 0.78rem;
    font-style: italic;
  }
  .cw-bubble pre {
    background: #0d1117; border: 1px solid var(--border, #30363d);
    border-radius: 6px; padding: 0.6rem 0.8rem; overflow-x: auto;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 0.82rem;
    margin: 0.4rem 0; line-height: 1.4; max-width: 100%;
    -webkit-overflow-scrolling: touch;
  }
  .cw-bubble code {
    font-family: 'Consolas', 'Monaco', monospace; font-size: 0.84rem;
    background: rgba(110,118,129,0.2); padding: 0.1em 0.35em; border-radius: 3px;
    word-break: break-word;
  }
  .cw-bubble pre code { background: none; padding: 0; }
  .cw-bubble p { margin: 0.3em 0; }
  .cw-bubble p:first-child { margin-top: 0; }
  .cw-bubble p:last-child { margin-bottom: 0; }
  .cw-bubble ul, .cw-bubble ol { margin: 0.3em 0; padding-left: 1.3em; }
  .cw-bubble strong { font-weight: 700; }
  .cw-bubble em { font-style: italic; }

  /* Typing indicator */
  .cw-typing { display: flex; gap: 4px; padding: 0.6rem 0.8rem; align-items: center; }
  .cw-typing-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-muted, #8b949e); animation: cwBounce 1.4s ease-in-out infinite;
  }
  .cw-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .cw-typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes cwBounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }

  /* Input */
  .cw-input-area {
    display: flex; flex-direction: column; padding: 0.6rem 0.8rem;
    border-top: 1px solid var(--border, #30363d); flex-shrink: 0;
    background: var(--surface, #161b22); gap: 0.4rem;
  }
  .cw-attachments {
    display: flex; flex-wrap: wrap; gap: 0.4rem;
  }
  .cw-attach-thumb {
    position: relative; width: 48px; height: 48px; border-radius: 6px;
    border: 1px solid var(--border, #30363d); overflow: hidden;
    background: var(--bg, #0d1117);
  }
  .cw-attach-thumb img {
    width: 100%; height: 100%; object-fit: cover;
  }
  .cw-attach-remove {
    position: absolute; top: -4px; right: -4px; width: 16px; height: 16px;
    border-radius: 50%; background: #e94560; color: #fff; border: none;
    font-size: 10px; line-height: 16px; text-align: center; cursor: pointer;
    padding: 0;
  }
  .cw-link-preview {
    font-size: 0.75rem; background: var(--bg, #0d1117); border: 1px solid var(--border, #30363d);
    border-radius: 6px; padding: 0.3rem 0.6rem; color: var(--text-muted, #8b949e);
    display: flex; align-items: center; gap: 0.4rem; max-width: 100%;
  }
  .cw-link-preview .cw-link-url {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
  }
  .cw-link-preview .cw-link-status { flex-shrink: 0; }
  .cw-input-row {
    display: flex; gap: 0.4rem; align-items: flex-end;
  }
  .cw-input {
    flex: 1; resize: none; border: 1px solid var(--border, #30363d);
    background: var(--bg, #0d1117); color: var(--text, #e6edf3);
    border-radius: 8px; padding: 0.5rem 0.7rem; font-size: 0.88rem;
    font-family: inherit; line-height: 1.4; min-height: 38px; max-height: 120px;
    outline: none;
  }
  .cw-input:focus { border-color: var(--accent, #8ecae6); }
  .cw-input::placeholder { color: var(--text-muted, #8b949e); }
  .cw-attach-btn {
    background: none; border: 1px solid var(--border, #30363d); border-radius: 8px;
    width: 38px; height: 38px; cursor: pointer; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0;
    color: var(--text-muted, #8b949e); transition: color 0.15s, border-color 0.15s;
  }
  .cw-attach-btn:hover { color: var(--text, #e6edf3); border-color: var(--text-muted, #8b949e); }
  .cw-attach-btn svg { width: 18px; height: 18px; }
  .cw-send-btn {
    background: var(--accent, #8ecae6); color: #0d1117; border: none; border-radius: 8px;
    width: 38px; height: 38px; cursor: pointer; display: flex;
    align-items: center; justify-content: center; flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .cw-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .cw-send-btn svg { width: 18px; height: 18px; fill: #0d1117; }
  .cw-send-btn.cw-stop { background: #f85149; }
  .cw-send-btn.cw-stop svg { fill: #fff; }

  /* New conversation button */
  .cw-new-btn {
    background: none; border: none; color: var(--text-muted, #8b949e);
    cursor: pointer; font-size: 0.85rem; padding: 0.1rem 0.3rem;
    border-radius: 4px;
  }
  .cw-new-btn:hover { color: var(--text, #e6edf3); background: var(--surface, #161b22); }
  .cw-new-btn { display: none; }

  /* Header "New" pill button */
  .cw-new-chat-header {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.32rem 0.65rem;
    border-radius: 999px; border: 1px solid var(--accent, #8ecae6);
    background: transparent; color: var(--accent, #8ecae6);
    font: inherit; font-size: 0.78rem; font-weight: 600;
    cursor: pointer; touch-action: manipulation; flex-shrink: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .cw-new-chat-header svg { width: 12px; height: 12px; fill: currentColor; }
  .cw-new-chat-header:hover {
    background: var(--accent, #8ecae6); color: #0d1117;
  }

  /* Settings gear button */
  .cw-settings-btn {
    background: none; border: none; color: var(--text-muted, #8b949e);
    cursor: pointer; font-size: 0.85rem; padding: 0.1rem 0.3rem; border-radius: 4px;
  }
  .cw-settings-btn:hover { color: var(--text, #e6edf3); }
  .cw-settings-btn svg { width: 14px; height: 14px; fill: currentColor; vertical-align: middle; }

  /* Usage panel */
  .cw-usage-btn {
    background: none; border: none; color: var(--text-muted, #8b949e);
    cursor: pointer; font-size: 0.85rem; padding: 0.1rem 0.3rem; border-radius: 4px;
  }
  .cw-usage-btn:hover { color: var(--text, #e6edf3); }
  .cw-usage-btn svg { width: 14px; height: 14px; fill: currentColor; vertical-align: middle; }
  .cw-usage-panel {
    display: none; flex-direction: column; gap: 0.55rem;
    padding: 0.6rem 1rem; border-bottom: 1px solid var(--border, #30363d);
    background: var(--surface, #161b22); font-size: 0.78rem;
    color: var(--text, #e6edf3); flex-shrink: 0;
  }
  .cw-usage-panel.open { display: flex; }
  .cw-usage-row {
    display: flex; flex-direction: column; gap: 0.2rem;
  }
  .cw-usage-label {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.75rem;
  }
  .cw-usage-label-left { color: var(--text, #e6edf3); font-weight: 500; }
  .cw-usage-label-right { color: var(--text-muted, #8b949e); font-size: 0.7rem; }
  .cw-usage-bar {
    height: 4px; background: var(--border, #30363d); border-radius: 2px;
    overflow: hidden;
  }
  .cw-usage-bar-fill {
    height: 100%; border-radius: 2px; transition: width 0.3s ease;
    background: var(--accent, #8ecae6);
  }
  .cw-usage-bar-fill.warn { background: #f59e0b; }
  .cw-usage-bar-fill.danger { background: #ef4444; }
  .cw-usage-divider {
    border: none; border-top: 1px solid var(--border, #30363d); margin: 0.15rem 0;
  }
  .cw-usage-footer {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.7rem; color: var(--text-muted, #8b949e);
  }
  .cw-usage-providers {
    display: flex; gap: 0.5rem; flex-wrap: wrap;
  }
  .cw-usage-provider-tag {
    background: var(--bg, #0d1117); border: 1px solid var(--border, #30363d);
    border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 0.68rem;
  }

  /* Settings panel */
  .cw-settings-panel {
    display: none; flex-direction: column; gap: 0.5rem;
    padding: 0.6rem 1rem; border-bottom: 1px solid var(--border, #30363d);
    background: var(--surface, #161b22); font-size: 0.78rem;
    color: var(--text, #e6edf3); flex-shrink: 0;
  }
  .cw-settings-panel.open { display: flex; }
  .cw-settings-row { display: flex; align-items: center; gap: 0.5rem; }
  .cw-settings-row label { flex: 0 0 50px; color: var(--text-muted, #8b949e); font-size: 0.75rem; }
  .cw-settings-row select,
  .cw-settings-row input {
    flex: 1; font-size: 0.75rem; padding: 0.25rem 0.4rem;
    background: var(--bg, #0d1117); color: var(--text, #e6edf3);
    border: 1px solid var(--border, #30363d); border-radius: 4px;
  }
  .cw-settings-toggle-row label {
    flex: 1; display: flex; align-items: center; gap: 0.45rem;
    color: var(--text, #e6edf3);
  }
  .cw-settings-toggle-row input[type="checkbox"] { margin: 0; }
  .cw-settings-toggle-row span { color: var(--text-muted, #8b949e); }
  .cw-settings-divider {
    border: none; border-top: 1px solid var(--border, #30363d); margin: 0.15rem 0;
  }
  .cw-settings-section-head {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    color: var(--text, #e6edf3); font-weight: 600;
  }
  .cw-settings-link {
    background: none; border: none; color: var(--accent, #8ecae6);
    cursor: pointer; padding: 0; font: inherit;
  }
  .cw-settings-link:hover { color: var(--text, #e6edf3); }
  .cw-sessions-list {
    display: flex; flex-direction: column; gap: 0.45rem;
    max-height: 220px; overflow-y: auto; overscroll-behavior: contain;
  }
  .cw-session-row {
    width: 100%; border: 1px solid var(--border, #30363d); border-radius: 8px;
    background: var(--bg, #0d1117); color: var(--text, #e6edf3);
    padding: 0.52rem 0.7rem 0.58rem; text-align: left; cursor: pointer;
    display: grid; grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem; align-content: start;
  }
  .cw-session-row:hover { border-color: var(--accent, #8ecae6); }
  .cw-session-row.active {
    border-color: var(--accent, #8ecae6);
    box-shadow: 0 0 0 1px rgba(142, 202, 230, 0.28);
  }
  .cw-session-top {
    display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: start; gap: 0.5rem;
    width: 100%;
  }
  .cw-session-main {
    min-width: 0;
    display: grid;
    gap: 0.16rem;
  }
  .cw-session-title {
    --cw-session-title-lines: 2;
    font-size: 0.78rem; font-weight: 600; color: var(--text, #e6edf3);
    min-width: 0; line-height: 1.28;
    min-height: calc(1em * 1.28 * var(--cw-session-title-lines));
    max-height: calc(1em * 1.28 * var(--cw-session-title-lines));
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--cw-session-title-lines);
    line-clamp: var(--cw-session-title-lines);
    overflow-wrap: anywhere;
  }
  .cw-session-meta {
    min-width: 0;
    font-size: 0.68rem; color: var(--text-muted, #8b949e);
    line-height: 1.2;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cw-session-status {
    flex-shrink: 0; align-self: start;
    border-radius: 999px; padding: 0.1rem 0.45rem;
    border: 1px solid var(--border, #30363d); color: var(--text-muted, #8b949e);
    font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .cw-session-status.running { color: #7dd3fc; border-color: rgba(125, 211, 252, 0.45); }
  .cw-session-status.completed { color: #86efac; border-color: rgba(134, 239, 172, 0.4); }
  .cw-session-status.cancelled,
  .cw-session-status.interrupted { color: #fcd34d; border-color: rgba(252, 211, 77, 0.4); }
  .cw-session-status.failed { color: #fca5a5; border-color: rgba(252, 165, 165, 0.4); }
  .cw-session-empty {
    font-size: 0.72rem; color: var(--text-muted, #8b949e);
    padding: 0.2rem 0;
  }
  .cw-resume-pill {
    display: none; align-items: center; gap: 0.35rem;
    margin: 0.55rem 1rem 0; padding: 0.18rem 0.55rem;
    border: 1px solid var(--border, #30363d); border-radius: 999px;
    background: var(--bg, #0d1117); color: var(--text-muted, #8b949e);
    font-size: 0.68rem; width: fit-content;
  }
  .cw-resume-pill.open { display: inline-flex; }

  /* Empty state */
  .cw-empty-state {
    display: flex; flex-direction: column; align-items: stretch;
    gap: 0.85rem; padding: 1.4rem 0.5rem 0.6rem;
    animation: cw-empty-fade 220ms ease-out;
  }
  @keyframes cw-empty-fade {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .cw-empty-greeting {
    font-size: 1.05rem; font-weight: 600; color: var(--text, #e6edf3);
    text-align: center;
  }
  .cw-empty-sub {
    font-size: 0.82rem; color: var(--text-muted, #8b949e);
    text-align: center; margin-top: -0.35rem; line-height: 1.4;
  }
  .cw-empty-chips {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem;
    margin-top: 0.5rem;
  }
  .cw-empty-chip {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem;
    padding: 0.7rem 0.8rem;
    background: var(--surface, #161b22);
    border: 1px solid var(--border, #30363d);
    border-radius: 12px; cursor: pointer;
    color: var(--text, #e6edf3); text-align: left;
    transition: border-color 120ms ease, transform 120ms ease, background 120ms ease;
    font: inherit; min-height: 64px;
    touch-action: manipulation;
  }
  .cw-empty-chip:hover {
    border-color: var(--accent, #8ecae6);
    background: var(--bg, #0d1117);
    transform: translateY(-1px);
  }
  .cw-empty-chip:active { transform: translateY(0); }
  .cw-empty-chip-title {
    font-size: 0.82rem; font-weight: 600; color: var(--text, #e6edf3);
  }
  .cw-empty-chip-body {
    font-size: 0.74rem; color: var(--text-muted, #8b949e); line-height: 1.35;
  }
  .cw-sidebar {
    position: absolute; top: 0; left: 0; bottom: 0;
    width: 280px; max-width: 84%;
    background: var(--surface, #161b22);
    border-right: 1px solid var(--border, #30363d);
    transform: translateX(-100%);
    transition: transform 180ms ease;
    z-index: 12;
    display: flex; flex-direction: column;
    padding: 0.7rem 0.7rem 0.9rem;
    box-shadow: 4px 0 20px rgba(0,0,0,0.35);
  }
  .cw-sidebar.open { transform: translateX(0); }
  .cw-sidebar-backdrop {
    position: absolute; inset: 0;
    background: rgba(0,0,0,0.45);
    opacity: 0; pointer-events: none;
    transition: opacity 180ms ease;
    z-index: 11;
  }
  .cw-sidebar-backdrop.open { opacity: 1; pointer-events: auto; }
  .cw-sidebar-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.5rem; margin-bottom: 0.7rem;
  }
  .cw-sidebar-title {
    font-size: 0.95rem; font-weight: 600; color: var(--text, #e6edf3);
  }
  .cw-sidebar-close {
    background: none; border: none; color: var(--text-muted, #8b949e);
    cursor: pointer; padding: 0; width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px; touch-action: manipulation;
  }
  .cw-sidebar-close:hover { color: var(--text, #e6edf3); background: var(--bg, #0d1117); }
  .cw-sidebar-close svg { width: 16px; height: 16px; fill: currentColor; }
  .cw-sidebar-new-btn {
    display: flex; align-items: center; justify-content: center; gap: 0.45rem;
    width: 100%; padding: 0.55rem 0.7rem; margin-bottom: 0.85rem;
    background: var(--accent, #8ecae6); color: #0d1117;
    border: none; border-radius: 8px; cursor: pointer;
    font-size: 0.85rem; font-weight: 600; touch-action: manipulation;
  }
  .cw-sidebar-new-btn:hover { filter: brightness(1.05); }
  .cw-sidebar-new-btn svg { width: 14px; height: 14px; fill: currentColor; }
  .cw-sidebar-section-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.5rem; padding: 0.1rem 0.15rem; margin-bottom: 0.45rem;
    color: var(--text, #e6edf3); font-size: 0.78rem; font-weight: 600;
  }
  .cw-sidebar .cw-sessions-list {
    flex: 1; max-height: none; overflow-y: auto; overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .cw-sidebar-toggle {
    background: none; border: 1px solid transparent; color: var(--text-muted, #8b949e);
    cursor: pointer; width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 8px; padding: 0; flex-shrink: 0;
    touch-action: manipulation;
  }
  .cw-sidebar-toggle:hover { color: var(--text, #e6edf3); background: var(--bg, #0d1117); }
  .cw-sidebar-toggle svg { width: 16px; height: 16px; fill: currentColor; }

  /* Keep chat typography independent from host-page root font sizes. */
  .cw-panel {
    font-size: 16px;
  }
  .cw-header-title {
    font-size: 16px;
  }
  .cw-provider-sel {
    font-size: 15px;
  }
  .cw-close-btn {
    font-size: 22px;
  }
  .cw-ctx-bar,
  .cw-link-preview,
  .cw-settings-panel,
  .cw-usage-panel,
  .cw-usage-label,
  .cw-usage-label-right,
  .cw-usage-footer,
  .cw-usage-provider-tag,
  .cw-settings-row label,
  .cw-settings-row select,
  .cw-settings-row input {
    font-size: 14px;
  }
  .cw-bubble,
  .cw-input {
    font-size: 16px;
  }
  .cw-msg.system .cw-bubble,
  .cw-bubble pre {
    font-size: 14px;
  }
  .cw-bubble code {
    font-size: 15px;
  }
  .cw-new-chat-header,
  .cw-new-btn,
  .cw-settings-btn,
  .cw-usage-btn,
  .cw-sidebar-section-head {
    font-size: 14px;
  }
  .cw-empty-greeting {
    font-size: 20px;
  }
  .cw-empty-sub,
  .cw-empty-chip-title {
    font-size: 16px;
  }
  .cw-empty-chip-body,
  .cw-session-title,
  .cw-sidebar-new-btn {
    font-size: 15px;
  }
  .cw-session-meta,
  .cw-session-status,
  .cw-session-empty,
  .cw-resume-pill {
    font-size: 13px;
  }
  .cw-sidebar-title {
    font-size: 16px;
  }

  /* ---- Mobile responsive ---- */
  @media (max-width: 600px) {
    .cw-panel {
      font-size: 16px;
    }
    .cw-fab {
      width: 56px; height: 56px; bottom: 1rem; right: 1rem;
    }
    .cw-fab svg { width: 26px; height: 26px; }
    .cw-panel.cw-mobile-fullscreen {
      --cw-bg: #000;
      --cw-surface: #000;
      --cw-text: #f4f4f4;
      --cw-text-muted: #b4b4b4;
      --cw-border: #2f2f2f;
      --cw-accent: #fff;
      width: 100%; height: 100vh; height: 100dvh;
      max-width: 100%; max-height: 100vh; max-height: 100dvh;
      bottom: 0; right: 0; left: 0; top: 0;
      border-radius: 0; border: none;
      background: #000;
    }
    .cw-panel.open ~ .cw-fab { display: none; }
    .cw-header {
      flex-wrap: nowrap;
      align-items: center;
      gap: 0.2rem;
      padding: calc(0.55rem + env(safe-area-inset-top, 0px)) 0.75rem 0.55rem;
      min-height: calc(58px + env(safe-area-inset-top, 0px));
      background: #000;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .cw-header-title {
      display: block;
      flex: 1 1 auto;
      font-size: 21px;
      line-height: 1.1;
      font-weight: 650;
      cursor: default;
      color: #fff;
    }
    .cw-header-right {
      flex: 0 1 auto;
      width: auto;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: flex-end;
      gap: 0.15rem;
      min-width: 0;
    }
    .cw-provider-sel {
      order: 0;
      flex: 0 0 106px;
      width: 106px;
      min-width: 94px;
      max-width: 106px;
      min-height: 40px;
      font-size: 16px;
      padding: 0.35rem 0.55rem;
      border-radius: 999px;
      background: #1f1f1f;
      border-color: #343434;
      color: #f2f2f2;
    }
    .cw-settings-row label,
    .cw-settings-panel,
    .cw-usage-panel,
    .cw-usage-label,
    .cw-usage-label-right,
    .cw-usage-footer,
    .cw-usage-provider-tag,
    .cw-ctx-bar,
    .cw-resume-pill,
    .cw-link-preview,
    .cw-msg.system .cw-bubble {
      font-size: 14px;
    }
    .cw-header-right,
    .cw-session-title,
    .cw-session-meta,
    .cw-session-status,
    .cw-empty-chip-title,
    .cw-empty-chip-body,
    .cw-empty-sub,
    .cw-sidebar-section-head {
      font-size: 15px;
    }
    .cw-settings-row select,
    .cw-settings-row input,
    .cw-input {
      font-size: 16px;
    }
    .cw-settings-row select,
    .cw-settings-row input {
      min-height: 44px;
      padding: 0.55rem 0.7rem;
    }
    .cw-new-btn,
    .cw-settings-btn,
    .cw-usage-btn,
    .cw-close-btn,
    .cw-attach-btn,
    .cw-send-btn {
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cw-settings-link,
    .cw-session-row {
      min-height: 44px;
    }
    .cw-session-row {
      padding: 0.64rem 0.8rem 0.84rem;
      gap: 0.14rem;
    }
    .cw-usage-btn {
      display: none;
    }
    .cw-new-btn {
      display: none;
    }
    .cw-close-btn {
      font-size: 1.45rem;
      color: #f5f5f5;
    }
    .cw-settings-btn,
    .cw-sidebar-toggle {
      color: #f5f5f5;
    }
    .cw-attach-btn, .cw-send-btn {
      width: 44px; height: 44px;
    }
    .cw-settings-btn:hover,
    .cw-sidebar-toggle:hover,
    .cw-close-btn:hover {
      background: #1f1f1f;
    }
    .cw-ctx-bar {
      padding: 0.25rem 0.65rem;
      gap: 0.35rem;
    }
    .cw-ctx-bar label {
      flex: 0 1 auto;
      min-width: 0;
    }
    .cw-ctx-page {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 14px;
    }
    .cw-ctx-bar.cw-ctx-empty {
      display: none;
    }
    .cw-input {
      min-height: 44px; font-size: 17px;
      padding: 0.62rem 0.55rem;
      background: transparent;
      border: none;
      color: #f4f4f4;
      line-height: 1.38;
    }
    .cw-input:focus { border-color: transparent; }
    .cw-input::placeholder { color: #c7c7c7; }
    .cw-session-meta,
    .cw-session-status {
      font-size: 13px;
    }
    .cw-session-top {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.45rem;
      align-items: start;
    }
    .cw-session-main {
      gap: 0.1rem;
    }
    .cw-session-meta,
    .cw-session-status,
    .cw-empty-chip-body,
    .cw-empty-sub {
      font-size: 14px;
      line-height: 1.45;
    }
    .cw-empty-chip-title,
    .cw-session-title,
    .cw-sidebar-section-head {
      line-height: 1.35;
    }
    .cw-session-title {
      --cw-session-title-lines: 2;
      line-height: 1.22;
      min-height: calc(1em * 1.22 * var(--cw-session-title-lines));
      max-height: calc(1em * 1.22 * var(--cw-session-title-lines));
    }
    .cw-session-status {
      justify-self: start;
      margin-top: 0.08rem;
    }
    .cw-input-area {
      padding: 0.55rem 0.85rem calc(0.72rem + env(safe-area-inset-bottom, 0px));
      border-top: none;
      background: #000;
      gap: 0.45rem;
    }
    .cw-input-row {
      align-items: flex-end;
      gap: 0.15rem;
      padding: 0.28rem;
      border-radius: 28px;
      background: #242424;
      border: 1px solid #303030;
      box-shadow: 0 10px 28px rgba(0,0,0,0.35);
    }
    .cw-attach-btn {
      border: none;
      border-radius: 50%;
      background: transparent;
      color: #f1f1f1;
    }
    .cw-attach-btn:hover {
      background: #333;
      color: #fff;
      border-color: transparent;
    }
    .cw-send-btn {
      border-radius: 50%;
      background: #f4f4f4;
      color: #000;
    }
    .cw-send-btn svg {
      width: 20px; height: 20px; fill: #000;
    }
    .cw-send-btn:disabled {
      opacity: 0.5;
      background: #5d5d5d;
    }
    .cw-bubble {
      font-size: 18px;
      line-height: 1.55;
      padding: 0.2rem 0;
      border-radius: 0;
    }
    .cw-messages {
      padding: 1.1rem 1.28rem 0.85rem;
      gap: 1.05rem;
      background: #000;
    }
    .cw-msg {
      max-width: 100%;
    }
    .cw-msg.assistant {
      align-self: stretch;
    }
    .cw-msg.assistant .cw-bubble {
      background: transparent;
      border: none;
      color: #f4f4f4;
    }
    .cw-msg.user {
      max-width: 84%;
    }
    .cw-msg.user .cw-bubble {
      padding: 0.72rem 1rem;
      border-radius: 22px;
      background: #2f2f2f;
      color: #f4f4f4;
      border-bottom-right-radius: 6px;
    }
    .cw-msg.system .cw-bubble {
      font-size: 15px;
      line-height: 1.45;
      color: #b4b4b4;
    }
    .cw-bubble pre,
    .cw-bubble code { font-size: 15px; }
    .cw-bubble pre {
      background: #151515;
      border-color: #303030;
      border-radius: 10px;
    }
    .cw-bubble code {
      background: #1f1f1f;
    }
    .cw-ctx-bar {
      padding: 0.4rem 0.8rem;
      flex-wrap: wrap;
      row-gap: 0.25rem;
    }
    .cw-ctx-page {
      flex: 1 0 100%;
      max-width: 100%;
      padding-left: 1.7rem;
      white-space: normal;
      line-height: 1.35;
    }
    .cw-attach-remove {
      top: -8px; right: -8px; width: 28px; height: 28px;
      font-size: 14px; line-height: 28px;
      transform: translate(35%, -35%);
    }
    .cw-sidebar {
      width: 84%; max-width: 320px;
      padding: calc(0.7rem + env(safe-area-inset-top, 0px)) 0.85rem 0.9rem;
      background: #111;
      border-right-color: #303030;
    }
    .cw-sidebar-toggle {
      width: 40px; height: 40px;
    }
    .cw-sidebar-new-btn {
      padding: 0.7rem 0.85rem; font-size: 15px;
    }
    .cw-sidebar-title { font-size: 16px; }
    .cw-empty-chips { grid-template-columns: 1fr; }
    .cw-empty-chip {
      min-height: 56px;
      padding: 0.75rem 0.9rem;
      border-radius: 16px;
      background: #1f1f1f;
      border-color: #303030;
    }
    .cw-empty-chip:hover {
      background: #262626;
      border-color: #444;
    }
    .cw-empty-greeting { font-size: 22px; }
    .cw-new-chat-header {
      display: none;
    }
    .cw-panel.cw-keyboard-open .cw-header {
      padding: calc(0.35rem + env(safe-area-inset-top, 0px)) 0.6rem 0.35rem;
      gap: 0.15rem;
      min-height: calc(50px + env(safe-area-inset-top, 0px));
    }
    .cw-panel.cw-keyboard-open .cw-header-right {
      gap: 0.1rem;
    }
    .cw-panel.cw-keyboard-open .cw-provider-sel {
      min-height: 38px;
      padding: 0.32rem 0.5rem;
    }
    .cw-panel.cw-keyboard-open .cw-ctx-bar,
    .cw-panel.cw-keyboard-open .cw-resume-pill {
      display: none;
    }
    .cw-panel.cw-keyboard-open .cw-messages {
      padding: 0.7rem 1rem 0.6rem;
      gap: 0.75rem;
    }
    .cw-panel.cw-keyboard-open .cw-input-area {
      padding-top: 0.42rem;
      padding-bottom: calc(0.55rem + env(safe-area-inset-bottom, 0px));
    }
  }
  `;

  const HOST_STYLES = `
  :host {
    --cw-bg: #0d1117;
    --cw-surface: #161b22;
    --cw-text: #e6edf3;
    --cw-text-muted: #8b949e;
    --cw-border: #30363d;
    --cw-accent: #8ecae6;
    --cw-font-sans: system-ui, sans-serif;
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9990;
    -webkit-text-size-adjust: 100%;
  }
  #cw-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    font-family: var(--cw-font-sans, system-ui, sans-serif);
    color: var(--cw-text, #e6edf3);
  }
  #cw-root * { box-sizing: border-box; }
  #cw-frame, .cw-fab, .cw-panel { pointer-events: auto; }
  `;

  function buildScopedStyles() {
    return (HOST_STYLES + STYLES)
      .replaceAll('var(--bg,', 'var(--cw-bg,')
      .replaceAll('var(--surface,', 'var(--cw-surface,')
      .replaceAll('var(--text,', 'var(--cw-text,')
      .replaceAll('var(--text-muted,', 'var(--cw-text-muted,')
      .replaceAll('var(--border,', 'var(--cw-border,')
      .replaceAll('var(--accent,', 'var(--cw-accent,')
      .replaceAll('font-family: inherit;', 'font-family: var(--cw-font-sans, system-ui, sans-serif);');
  }

  function ensureWidgetHost() {
    if (widgetShadow) return;
    widgetHost = document.createElement('div');
    widgetHost.id = WIDGET_HOST_ID;
    widgetShadow = widgetHost.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = buildScopedStyles();
    widgetRoot = document.createElement('div');
    widgetRoot.id = 'cw-root';
    widgetShadow.appendChild(styleEl);
    widgetShadow.appendChild(widgetRoot);
    document.body.appendChild(widgetHost);
  }

  // ---- Ensure SocketIO ----
  function ensureSocketIO(cb) {
    if (typeof io !== 'undefined') return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  // ---- Minimal Markdown renderer ----
  function renderMd(text) {
    let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}</code></pre>`);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/^### (.+)$/gm, '<strong>$1</strong>');
    s = s.replace(/^## (.+)$/gm, '<strong>$1</strong>');
    s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>');
    s = s.replace(/\n{2,}/g, '</p><p>');
    s = s.replace(/(?<!<\/pre>)\n(?!<)/g, '<br>');
    return '<p>' + s + '</p>';
  }

  // ---- localStorage helpers ----
  const BOOTSTRAP_PREFIX = 'cw_';
  var SYNTHETIC_TOOL_TRANSCRIPT_RE = /^\s*\[tool:\s*[^\]]+\]/i;
  let LS_PREFIX = BOOTSTRAP_PREFIX;  // updated once agent/appId is fetched
  function scopedLsKey(prefix, name) { return prefix + name; }
  function lsKey(name) { return LS_PREFIX + name; }
  function getScopedStorage(prefix, name) {
    try { return localStorage.getItem(scopedLsKey(prefix, name)); } catch (_) { return null; }
  }
  function setScopedStorage(prefix, name, value) {
    try { localStorage.setItem(scopedLsKey(prefix, name), value); } catch (_) {}
  }
  function mirrorBootstrapState(name, value) {
    setScopedStorage(LS_PREFIX, name, value);
    if (LS_PREFIX !== BOOTSTRAP_PREFIX) setScopedStorage(BOOTSTRAP_PREFIX, name, value);
  }

  function applyStorageScope(scopeId, options) {
    options = options || {};
    var trimmedScope = String(scopeId || '').trim();
    var nextPrefix = trimmedScope ? 'cw_' + trimmedScope + '_' : BOOTSTRAP_PREFIX;
    if (nextPrefix === LS_PREFIX) return false;

    var currentMessages = Array.isArray(chatHistory) ? getPersistedHistory() : [];
    var currentOpen = loadPanelState();
    var currentPosition = loadPosition();
    var migrateMessages = options.migrateMessages !== false;
    var migrateOpenState = options.migrateOpenState !== false;
    var migratePosition = options.migratePosition !== false;

    if (migrateMessages && currentMessages.length && !getScopedStorage(nextPrefix, 'messages')) {
      setScopedStorage(nextPrefix, 'messages', JSON.stringify(currentMessages));
    }
    if (migrateOpenState && currentOpen && getScopedStorage(nextPrefix, 'open') == null) {
      setScopedStorage(nextPrefix, 'open', '1');
    }
    if (migratePosition && currentPosition && !getScopedStorage(nextPrefix, 'position')) {
      setScopedStorage(nextPrefix, 'position', JSON.stringify(currentPosition));
    }

    LS_PREFIX = nextPrefix;
    chatHistory = loadMessages();
    restoreMessages();
    return true;
  }

  function saveMessages() {
    var persistedHistory = getPersistedHistory();
    mirrorBootstrapState('messages', JSON.stringify(persistedHistory));
    // Persist to server for cross-device access (fire-and-forget)
    fetch('/api/chat/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: persistedHistory,
        projectId: settingsCache.projectId || '',
      }),
    }).catch(function() {});
  }
  function loadMessages() {
    try {
      const scoped = getScopedStorage(LS_PREFIX, 'messages');
      if (scoped) return sanitizeHistoryEntries(JSON.parse(scoped) || []);
      return [];
    } catch (_) { return []; }
  }
  function createHistoryEntry(role, content, extra) {
    var entry = { role: role, content: String(content || '') };
    if (extra && typeof extra === 'object') Object.assign(entry, extra);
    return entry;
  }
  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return createHistoryEntry('system', entry == null ? '' : String(entry));
    }
    return createHistoryEntry(entry.role || 'system', entry.content || '', entry);
  }
  function isLegacyVerboseTraceEntry(entry) {
    var content = String(entry && entry.content || '');
    if ((entry && entry.role) !== 'system') return false;
    return content.indexOf('_Thinking_:') === 0 ||
      content === '_Thinking…_' ||
      content.indexOf('▶ **') === 0 ||
      content.indexOf('Tool result from **') === 0;
  }
  function isVerboseTraceEntry(entry) {
    var normalized = normalizeHistoryEntry(entry);
    return normalized.verboseTrace === true ||
      normalized.eventType === 'thinking' ||
      normalized.eventType === 'tool_call' ||
      normalized.eventType === 'tool_result' ||
      (normalized.eventType === 'status' && !isPersistentStatusEntry(normalized)) ||
      isLegacyVerboseTraceEntry(normalized);
  }
  function isSyntheticToolTranscriptEntry(entry) {
    var normalized = normalizeHistoryEntry(entry);
    if (normalized.role !== 'assistant' && normalized.role !== 'system') return false;
    return SYNTHETIC_TOOL_TRANSCRIPT_RE.test(String(normalized.content || '').trim());
  }

  function isPersistentStatusEntry(entry) {
    var code = String(entry && (entry.code || entry.statusCode) || '');
    var kind = String(entry && entry.kind || '');
    return code === 'cancelled' ||
      code === 'interrupted' ||
      code === 'idle_warning' ||
      code === 'idle_timeout' ||
      kind === 'cancelled' ||
      kind === 'interrupted' ||
      kind === 'idle_warning' ||
      kind === 'timeout';
  }
  function shouldRenderHistoryEntry(entry) {
    return settingsCache.verbose !== false || !isVerboseTraceEntry(entry);
  }
  function appendHistoryEntry(entry) {
    chatHistory.push(entry);
    saveMessages();
    return chatHistory.length - 1;
  }
  function sanitizeHistoryEntries(entries) {
    return (entries || [])
      .map(normalizeHistoryEntry)
      .filter(function(entry) {
        return !isVerboseTraceEntry(entry) && !isSyntheticToolTranscriptEntry(entry);
      });
  }
  function getPersistedHistory() {
    return sanitizeHistoryEntries(chatHistory);
  }
  function getConversationHistory() {
    return getPersistedHistory()
      .filter(function(entry) {
        return entry.role === 'user' || entry.role === 'assistant';
      })
      .map(function(entry) {
        return { role: entry.role, content: entry.content };
      });
  }
  function getLiveInsertBeforeEl() {
    if (streamBubble && streamBubble.parentElement) return streamBubble.parentElement;
    return rootById('cw-typing');
  }
  function savePanelState(open) {
    mirrorBootstrapState('open', open ? '1' : '0');
  }
  function loadPanelState() {
    try {
      const scoped = getScopedStorage(LS_PREFIX, 'open');
      if (scoped != null) return scoped === '1';
      if (LS_PREFIX !== BOOTSTRAP_PREFIX) return getScopedStorage(BOOTSTRAP_PREFIX, 'open') === '1';
      return false;
    } catch (_) { return false; }
  }
  function savePosition(pos) {
    mirrorBootstrapState('position', JSON.stringify(pos));
  }
  function loadPosition() {
    try {
      const scoped = getScopedStorage(LS_PREFIX, 'position');
      if (scoped) return JSON.parse(scoped);
      if (LS_PREFIX !== BOOTSTRAP_PREFIX) {
        const bootstrap = getScopedStorage(BOOTSTRAP_PREFIX, 'position');
        if (bootstrap) return JSON.parse(bootstrap);
      }
      return null;
    } catch (_) { return null; }
  }
  function applyPosition(panel, pos) {
    // Skip saved position on mobile (panel is always fullscreen)
    if (window.innerWidth <= 600) return;
    // Use left/top positioning when a saved position exists
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    const maxX = window.innerWidth - 40;
    const maxY = window.innerHeight - 40;
    panel.style.left = Math.max(0, Math.min(pos.x, maxX)) + 'px';
    panel.style.top = Math.max(0, Math.min(pos.y, maxY)) + 'px';
  }
  function resetPanelGeometry(panel) {
    panel.style.left = '';
    panel.style.right = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.height = '';
    panel.style.width = '';
  }
  function applyMobilePanelLayout(panel) {
    const isMobile = window.innerWidth <= 600;
    panel.classList.toggle('cw-mobile-fullscreen', isMobile);
    const input = rootById('cw-input');
    const keyboardOpen = !!(
      isMobile &&
      panel.classList.contains('open') &&
      input &&
      (widgetRoot.activeElement === input || input.matches(':focus'))
    );
    panel.classList.toggle('cw-keyboard-open', keyboardOpen);
    if (input) {
      input.placeholder = isMobile
        ? 'Type a message…'
        : 'Type a message… (paste images or URLs)';
    }
    if (!isMobile) {
      resetPanelGeometry(panel);
      const savedPos = loadPosition();
      if (savedPos) applyPosition(panel, savedPos);
      return;
    }

    panel.style.left = '0px';
    panel.style.right = '0px';
    panel.style.bottom = 'auto';
    panel.style.width = '100%';

    const viewport = window.visualViewport;
    if (viewport) {
      panel.style.top = viewport.offsetTop + 'px';
      panel.style.height = viewport.height + 'px';
    } else {
      panel.style.top = '0px';
      panel.style.height = window.innerHeight + 'px';
    }
  }
  function setupDrag(panel) {
    const header = panel.querySelector('.cw-header');
    let dragging = false, startX, startY, startLeft, startTop;
    let touchDragBound = false;

    // Skip drag on mobile (panel is fullscreen)
    const isMobile = () => window.innerWidth <= 600;

    function dragStart(x, y) {
      if (isMobile()) return false;
      dragging = true;
      panel.classList.add('cw-dragging');
      const rect = panel.getBoundingClientRect();
      startX = x;
      startY = y;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      return true;
    }

    function dragMove(x, y) {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      let newX = Math.max(0, Math.min(startLeft + dx, window.innerWidth - 60));
      let newY = Math.max(0, Math.min(startTop + dy, window.innerHeight - 60));
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
    }

    function dragEnd() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('cw-dragging');
      savePosition({ x: parseInt(panel.style.left), y: parseInt(panel.style.top) });
      if (touchDragBound) {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.removeEventListener('touchcancel', onTouchEnd);
        touchDragBound = false;
      }
    }

    function onTouchMove(e) {
      if (!dragging || !e.touches.length) return;
      const t = e.touches[0];
      dragMove(t.clientX, t.clientY);
      e.preventDefault();
    }

    function onTouchEnd() {
      dragEnd();
    }

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, select')) return;
      if (dragStart(e.clientX, e.clientY)) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => dragMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', dragEnd);

    header.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, select')) return;
      const t = e.touches[0];
      if (dragStart(t.clientX, t.clientY)) {
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: true });
        document.addEventListener('touchcancel', onTouchEnd, { passive: true });
        touchDragBound = true;
        e.preventDefault();
      }
    }, { passive: false });
  }

  // ---- State ----
  let socket = null;
  let chatHistory = loadMessages();
  let activeChatId = null;
  let activeStreamSeq = -1;
  let activeTurnFailed = false;
  let streamBuffer = '';
  let streamBubble = null;
  let isStreaming = false;
  let resumePending = false;
  let iframeActive = false;
  let frame = null;
  let originalEls = [];
  let pendingImages = [];  // [{path, name, dataUrl}, ...]
  let pendingLinkContent = '';  // Fetched URL content
  let sessionListCache = [];
  let activeSessionId = null;
  let sessionsLoading = false;

  // ---- Build ----
  function init() { ensureSocketIO(() => build()); }

  function build() {
    if (widgetReady) return;
    ensureWidgetHost();

    // --- SPA iframe element (hidden until first navigation) ---
    if (!DISABLE_SPA) {
      frame = document.createElement('iframe');
      frame.id = 'cw-frame';
      widgetRoot.appendChild(frame);

      // Track original page elements (everything that isn't ours)
      originalEls = [...document.body.children].filter(el => el !== widgetHost);
    }

    // --- FAB ---
    const fab = document.createElement('button');
    fab.id = 'cw-fab';
    fab.className = 'cw-fab';
    fab.title = 'Ask AI';
    fab.setAttribute('aria-label', 'Open chat');
    fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>`;
    fab.onclick = togglePanel;
    widgetRoot.appendChild(fab);

    // --- Panel ---
    const panel = document.createElement('div');
    panel.className = 'cw-panel';
    panel.id = 'cw-panel';
    panel.innerHTML = `
      <div class="cw-sidebar-backdrop" id="cw-sidebar-backdrop"></div>
      <aside class="cw-sidebar" id="cw-sidebar" aria-hidden="true">
        <div class="cw-sidebar-head">
          <span class="cw-sidebar-title">Chat history</span>
          <button class="cw-sidebar-close" id="cw-sidebar-close" type="button" aria-label="Close history">
            <svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>
          </button>
        </div>
        <button class="cw-sidebar-new-btn" id="cw-sidebar-new" type="button" aria-label="Start new chat">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          <span>New Chat</span>
        </button>
        <div class="cw-sidebar-section-head">
          <span>Past conversations</span>
          <button type="button" class="cw-settings-link" id="cw-refresh-sessions">Refresh</button>
        </div>
        <div class="cw-sessions-list" id="cw-sessions-list">
          <div class="cw-session-empty">No saved sessions yet.</div>
        </div>
      </aside>
      <div class="cw-header">
        <button class="cw-sidebar-toggle" id="cw-sidebar-toggle" type="button" aria-label="Open chat history" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
        </button>
        <span class="cw-header-title">Ask AI</span>
        <div class="cw-header-right">
          <button class="cw-new-chat-header" id="cw-new-chat-header" type="button" title="New chat">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>New</span>
          </button>
          <button class="cw-new-btn" title="New conversation" id="cw-new-btn">⟳</button>
          <button class="cw-usage-btn" title="Usage" id="cw-usage-btn"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg></button>
          <button class="cw-settings-btn${HIDE_SETTINGS_BUTTON ? ' cw-hard-hidden' : ''}" title="Settings" id="cw-settings-btn" aria-hidden="${HIDE_SETTINGS_BUTTON ? 'true' : 'false'}"><svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.48.48 0 0 0 13.92 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.72 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg></button>
          <select class="cw-provider-sel" id="cw-provider"></select>
          <button class="cw-close-btn" id="cw-close">&times;</button>
        </div>
      </div>
      <div class="cw-settings-panel" id="cw-settings-panel">
        <div class="cw-settings-row" id="cw-setting-project-row" style="display:none;">
          <label>Project</label>
          <select id="cw-setting-project"></select>
        </div>
        <div class="cw-settings-row">
          <label>Model</label>
          <select id="cw-setting-model"></select>
        </div>
        <div class="cw-settings-row" id="cw-setting-effort-row">
          <label>Effort</label>
          <select id="cw-setting-effort">
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra High</option>
          </select>
        </div>
        <div class="cw-settings-row cw-settings-toggle-row" id="cw-setting-verbose-row">
          <label>
            <input type="checkbox" id="cw-setting-verbose" checked>
            <span>Verbose events</span>
          </label>
        </div>
        <hr class="cw-settings-divider">
        <div class="cw-settings-row cw-settings-toggle-row cw-ctx-bar${HIDE_PAGE_CONTEXT_CONTROL ? ' cw-hard-hidden' : ''}" aria-hidden="${HIDE_PAGE_CONTEXT_CONTROL ? 'true' : 'false'}">
          <label>
            <input type="checkbox" id="cw-ctx-check">
            <span>Include page context</span>
          </label>
          <span class="cw-ctx-page" id="cw-ctx-page"></span>
        </div>
      </div>
      <div class="cw-usage-panel" id="cw-usage-panel">
        <div class="cw-usage-row">
          <div class="cw-usage-label">
            <span class="cw-usage-label-left">5-hour limit</span>
            <span class="cw-usage-label-right" id="cw-usage-rolling-info">—</span>
          </div>
          <div class="cw-usage-bar"><div class="cw-usage-bar-fill" id="cw-usage-rolling-bar" style="width:0%"></div></div>
        </div>
        <div class="cw-usage-row">
          <div class="cw-usage-label">
            <span class="cw-usage-label-left">Daily</span>
            <span class="cw-usage-label-right" id="cw-usage-daily-info">—</span>
          </div>
          <div class="cw-usage-bar"><div class="cw-usage-bar-fill" id="cw-usage-daily-bar" style="width:0%"></div></div>
        </div>
        <div class="cw-usage-row">
          <div class="cw-usage-label">
            <span class="cw-usage-label-left">Weekly · all providers</span>
            <span class="cw-usage-label-right" id="cw-usage-weekly-info">—</span>
          </div>
          <div class="cw-usage-bar"><div class="cw-usage-bar-fill" id="cw-usage-weekly-bar" style="width:0%"></div></div>
        </div>
        <hr class="cw-usage-divider">
        <div class="cw-usage-footer">
          <div class="cw-usage-providers" id="cw-usage-providers"></div>
          <span id="cw-usage-model-info">—</span>
        </div>
      </div>
      <div class="cw-resume-pill" id="cw-resume-pill">Reconnecting…</div>
      <div class="cw-messages" id="cw-messages"></div>
      <div class="cw-input-area">
        <div class="cw-attachments" id="cw-attachments"></div>
        <div class="cw-input-row">
          <button class="cw-attach-btn" id="cw-attach" title="Attach image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <textarea class="cw-input" id="cw-input" placeholder="Type a message… (paste images or URLs)" rows="1" enterkeyhint="send" autocapitalize="sentences" autocorrect="on" spellcheck="true" inputmode="text"></textarea>
          <button class="cw-send-btn" id="cw-send" title="Send">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <input type="file" id="cw-file-input" accept="image/*" multiple style="display:none;">
      </div>`;
    widgetRoot.appendChild(panel);

    // Restore saved position
    const savedPos = loadPosition();
    if (savedPos) applyPosition(panel, savedPos);
    applyMobilePanelLayout(panel);

    // Wire events
    rootById('cw-close').onclick = togglePanel;
    rootById('cw-send').onclick = function() {
      if (isStreaming) { cancelStreaming(); } else { sendMessage(); }
    };
    rootById('cw-new-btn').onclick = newConversation;
    var headerNewBtn = rootById('cw-new-chat-header');
    if (headerNewBtn) headerNewBtn.onclick = newConversation;
    rootById('cw-settings-btn').onclick = toggleSettings;
    rootById('cw-usage-btn').onclick = toggleUsage;
    rootById('cw-sidebar-toggle').onclick = function() { toggleSidebar(); };
    rootById('cw-sidebar-close').onclick = function() { closeSidebar(); };
    rootById('cw-sidebar-backdrop').onclick = function() { closeSidebar(); };
    rootById('cw-sidebar-new').onclick = function() {
      closeSidebar();
      newConversation();
    };
    panel.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var sidebar = rootById('cw-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          e.stopPropagation();
          closeSidebar();
        }
      }
    });
    setupDrag(panel);

    const input = rootById('cw-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', autoResize);
    input.addEventListener('focus', () => applyMobilePanelLayout(panel));
    input.addEventListener('blur', () => {
      window.setTimeout(() => applyMobilePanelLayout(panel), 120);
    });

    // Image attach button
    rootById('cw-attach').onclick = () => rootById('cw-file-input').click();
    rootById('cw-file-input').addEventListener('change', handleFileSelect);

    // Paste handler — images from clipboard + URL detection
    input.addEventListener('paste', handlePaste);

    // URL detection on input
    input.addEventListener('input', () => { autoResize(); detectUrl(); });

    // Page context (initial page)
    updatePageContext(window.PAGE_CONTEXT || '');

    // Restore panel open state
    if (loadPanelState()) panel.classList.add('open');

    // Restore messages
    restoreMessages();

    // Load providers
    loadProviders();

    // Load agent info (updates header title if custom agent is active)
    loadAgent();

    // Load saved settings and wire change handlers
    loadSettings();
    rootById('cw-setting-project').addEventListener('change', saveSettings);
    rootById('cw-setting-model').addEventListener('change', saveSettings);
    rootById('cw-setting-effort').addEventListener('change', saveSettings);
    rootById('cw-setting-verbose').addEventListener('change', saveSettings);
    rootById('cw-refresh-sessions').addEventListener('click', () => loadSessions(true));

    // Reset auth when provider changes
    rootById('cw-provider').addEventListener('change', () => {
      authVerified = false;
      applyProviderSettingsUi();
      saveSettings();
    });

    // SocketIO for chat streaming
    socket = io({
      transports: ['websocket', 'polling'],
      reconnectionDelay: 250,
      reconnectionDelayMax: 1000,
      timeout: 5000,
    });
  socket.on('connect', onSocketConnect);
  socket.on('disconnect', onSocketDisconnect);
  socket.on('chat_resume_ack', onResumeAck);
    socket.on('chat_event', onTurnEvent);

    document.addEventListener('visibilitychange', onVisibilityResume);
  window.addEventListener('pagehide', onPageHideTrace);
    window.addEventListener('pageshow', onLifecycleResume);
    window.addEventListener('online', onLifecycleResume);
  window.addEventListener('offline', onOfflineTrace);

    // --- SPA navigation ---
    if (!DISABLE_SPA) setupNavigation();

    // --- Mobile keyboard handling ---
    if (window.visualViewport) {
      const syncViewport = () => applyMobilePanelLayout(panel);
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('resize', () => applyMobilePanelLayout(panel));

    widgetReady = true;
    widgetSingleton.loading = false;
    widgetSingleton.bootstrapped = true;
    applyPendingSeed();
  }

  // ---- SPA Navigation ----
  function setupNavigation() {
    // Intercept link clicks on the initial (top-frame) page
    document.addEventListener('click', (e) => {
      if (iframeActive) return; // original content is hidden
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank') return;
      try {
        const u = new URL(a.href, location.origin);
        if (u.origin !== location.origin) return;
        if (u.pathname + u.search === location.pathname + location.search) return;
        e.preventDefault();
        spaNavigate(u.pathname + u.search);
      } catch (_) {}
    }, true);

    // Messages from iframe
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      const d = e.data;
      if (d.type === 'cw-nav') {
        spaNavigate(d.url);
      } else if (d.type === 'cw-page') {
        document.title = d.title;
        updatePageContext(d.context);
        // Sync URL for JS-initiated iframe navigations (reloads, redirects)
        const current = location.pathname + location.search;
        if (d.url !== current) {
          history.replaceState({ cw: true }, '', d.url);
        }
      }
    });

    // Back/forward
    window.addEventListener('popstate', () => {
      activateIframe();
      frame.src = location.pathname + location.search;
    });
  }

  function activateIframe() {
    if (iframeActive) return;
    originalEls.forEach(el => el.style.display = 'none');
    frame.style.display = 'block';
    iframeActive = true;
  }

  function spaNavigate(url) {
    activateIframe();
    frame.src = url;
    history.pushState({ cw: true }, '', url);
  }

  // ---- Page context display ----
  function updatePageContext(context) {
    const bar = rootQuery('.cw-ctx-bar');
    const el = rootById('cw-ctx-page');
    const cb = rootById('cw-ctx-check');
    if (!el || !cb || !bar) return;
    if (HIDE_PAGE_CONTEXT_CONTROL) {
      cb.checked = false;
    }
    bar.classList.toggle('cw-ctx-empty', !context);
    if (context) {
      el.textContent = context;
      el.title = context;
      cb.disabled = false;
    } else {
      el.textContent = '(no context for this page)';
      el.title = '';
      cb.checked = false;
      cb.disabled = true;
    }
    window._cwCurrentContext = context || '';
  }

  // ---- Panel toggle ----
  function togglePanel(forceOpen) {
    const panel = rootById('cw-panel');
    if (!panel) return;
    if (typeof forceOpen === 'boolean') panel.classList.toggle('open', forceOpen);
    else panel.classList.toggle('open');
    const isOpen = panel.classList.contains('open');
    applyMobilePanelLayout(panel);
    savePanelState(isOpen);
    if (isOpen) {
      const input = rootById('cw-input');
      if (input) input.focus();
    }
  }

  function openChatWithSeed(seed) {
    const value = (seed || '').trim();
    if (!value) return togglePanel(true);
    if (!widgetReady) {
      storePendingSeed(value);
      return;
    }
    const panel = rootById('cw-panel');
    if (!panel) {
      storePendingSeed(value);
      return;
    }
    togglePanel(true);
    let attempts = 0;
    const tryFill = () => {
      attempts += 1;
      const input = rootById('cw-input');
      if (!input) {
        if (attempts < 20) setTimeout(tryFill, 50);
        else storePendingSeed(value);
        return;
      }
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    };
    tryFill();
  }

  function applyPendingSeed() {
    const pending = takePendingSeed();
    if (pending) openChatWithSeed(pending);
  }

  // Expose toggle and seed helpers for host apps.
  window.CW_TOGGLE = togglePanel;
  widgetSingleton.toggle = togglePanel;
  window.rrToggleChat = function() { togglePanel(); };
  window.rrClearChat = newConversation;
  window.rrSeedChat = openChatWithSeed;

  function autoResize() {
    const el = rootById('cw-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ---- Providers ----
  async function loadProviders() {
    try {
      const res = await fetch('/api/chat/providers');
      const data = await res.json();
      const sel = rootById('cw-provider');
      providerCatalog = {};
      sel.innerHTML = '';
      data.providers.forEach(p => {
        providerCatalog[p.id] = p;
        if (!p.installed) return;
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
      if (data.default) {
        const wanted = Array.from(sel.options).find(o => o.value === data.default);
        if (wanted) sel.value = data.default;
      }
      if (sel.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No CLI found';
        sel.appendChild(opt);
      }
      applyProviderSettingsUi();
    } catch (e) {
      console.warn('Could not load chat providers', e);
    }
  }

  function rebuildModelSuggestions(provider, currentValue) {
    var modelEl = rootById('cw-setting-model');
    if (!modelEl) return;
    var providerInfo = providerCatalog[provider] || {};
    var values = Array.isArray(providerInfo.models) ? providerInfo.models.slice() : [];
    if (currentValue) values.unshift(currentValue);
    var seen = {};
    modelEl.innerHTML = '';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default';
    modelEl.appendChild(defaultOpt);
    values.forEach(function(value) {
      var normalized = String(value || '').trim();
      if (!normalized) return;
      var key = normalized.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      var opt = document.createElement('option');
      opt.value = normalized;
      opt.textContent = normalized;
      modelEl.appendChild(opt);
    });
  }

  function rebuildProjectOptions(currentValue) {
    var projectEl = rootById('cw-setting-project');
    var projectRow = rootById('cw-setting-project-row');
    if (!projectEl || !projectRow) return;
    if (!Array.isArray(projectCatalog) || projectCatalog.length === 0) {
      projectEl.innerHTML = '';
      projectRow.style.display = 'none';
      return;
    }

    projectRow.style.display = 'flex';
    projectEl.innerHTML = '';
    projectCatalog.forEach(function(project) {
      var opt = document.createElement('option');
      opt.value = String(project.id || '');
      opt.textContent = String(project.name || project.id || '');
      if (project.repoRoot) opt.title = String(project.repoRoot);
      projectEl.appendChild(opt);
    });

    if (currentValue) {
      var wanted = Array.from(projectEl.options).find(function(option) {
        return option.value === currentValue;
      });
      if (wanted) projectEl.value = currentValue;
    }
    if (!projectEl.value && projectEl.options.length > 0) projectEl.value = projectEl.options[0].value;
  }

  async function loadServerHistory() {
    try {
      var hres = await fetch('/api/chat/history');
      var hdata = await hres.json();
      if (hdata.messages && hdata.messages.length > 0) {
        if (hdata.messages.length >= chatHistory.length) {
          chatHistory = hdata.messages;
          try { localStorage.setItem(lsKey('messages'), JSON.stringify(chatHistory)); } catch (_) {}
          restoreMessages();
        }
      }
      if (hdata.active_turns && hdata.active_turns.length > 0) {
        primeResumableTurn(hdata.active_turns[0]);
      }
    } catch (_) {}
  }

  // ---- Agent ----
  async function loadAgent(options) {
    options = options || {};
    try {
      const res = await fetch('/api/chat/agent');
      const data = await res.json();
      applyStorageScope(data.stateScopeId || data.appId || '', options);
      if (data.active && data.name) {
        var title = rootQuery('.cw-header-title');
        if (title) title.textContent = data.name;
      }
      await loadServerHistory();
    } catch (e) {
      // Agent endpoint may not exist on older backends
    }
  }

  // ---- Settings ----
  function toggleSettings() {
    var panel = rootById('cw-settings-panel');
    var isOpen = !panel.classList.contains('open');
    panel.classList.toggle('open', isOpen);
  }

  // ---- Sidebar (Past conversations) ----
  function toggleSidebar(forceOpen) {
    var sidebar = rootById('cw-sidebar');
    if (!sidebar) return;
    var isOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : !sidebar.classList.contains('open');
    var backdrop = rootById('cw-sidebar-backdrop');
    var toggleBtn = rootById('cw-sidebar-toggle');
    sidebar.classList.toggle('open', isOpen);
    if (backdrop) backdrop.classList.toggle('open', isOpen);
    sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      loadSessions(true);
      var newBtn = rootById('cw-sidebar-new');
      if (newBtn) { try { newBtn.focus({ preventScroll: true }); } catch (_) { newBtn.focus(); } }
    } else if (toggleBtn) {
      try { toggleBtn.focus({ preventScroll: true }); } catch (_) { toggleBtn.focus(); }
    }
  }
  function closeSidebar() { toggleSidebar(false); }

  function applyProviderSettingsUi() {
    var provider = rootById('cw-provider')?.value || '';
    var meta = PROVIDER_SETTINGS[provider] || PROVIDER_SETTINGS.ghcopilot;
    var modelEl = rootById('cw-setting-model');
    var effortEl = rootById('cw-setting-effort');
    var effortRow = rootById('cw-setting-effort-row');
    var verboseEl = rootById('cw-setting-verbose');
    var currentModel = String(settingsCache[meta.modelKey] || '');
    var supportsEffort = meta.supportsEffort && !(provider === 'ghcopilot' && currentModel.trim().toLowerCase() === 'auto');
    rebuildModelSuggestions(provider, currentModel || modelEl?.value || '');
    if (modelEl) modelEl.value = currentModel;
    if (effortEl) effortEl.value = supportsEffort && meta.effortKey ? (settingsCache[meta.effortKey] || '') : '';
    if (verboseEl) verboseEl.checked = settingsCache.verbose !== false;
    if (effortRow) effortRow.style.display = supportsEffort ? 'flex' : 'none';
  }

  async function loadSettings() {
    try {
      var res = await fetch('/api/chat/settings');
      var data = await res.json();
      settingsCache = data || {};
      projectCatalog = Array.isArray(settingsCache.projects) ? settingsCache.projects.slice() : [];
      rebuildProjectOptions(settingsCache.projectId || '');
      applyProviderSettingsUi();
      restoreMessages();
    } catch (_) {}
  }

  async function saveSettings() {
    var provider = rootById('cw-provider').value;
    var model = rootById('cw-setting-model').value.trim();
    var effort = rootById('cw-setting-effort').value;
    var verbose = !!rootById('cw-setting-verbose').checked;
    var projectEl = rootById('cw-setting-project');
    var projectId = projectEl ? String(projectEl.value || '').trim() : '';
    var previousProjectId = String(settingsCache.projectId || '');
    var previousVerbose = settingsCache.verbose !== false;
    var meta = PROVIDER_SETTINGS[provider] || PROVIDER_SETTINGS.ghcopilot;
    var supportsEffort = meta.supportsEffort && !(provider === 'ghcopilot' && model.toLowerCase() === 'auto');
    if (!supportsEffort) effort = '';
    var payload = { defaultProvider: provider, verbose: verbose };
    if (projectId) payload.projectId = projectId;
    payload[meta.modelKey] = model;
    if (meta.effortKey) payload[meta.effortKey] = effort;
    settingsCache.defaultProvider = provider;
    settingsCache[meta.modelKey] = model;
    if (meta.effortKey) settingsCache[meta.effortKey] = effort;
    settingsCache.verbose = verbose;
    settingsCache.projectId = projectId;
    if (previousVerbose !== verbose) restoreMessages();
    try {
      var response = await fetch('/api/chat/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var updated = await response.json();
      if (updated && updated.config) {
        settingsCache = updated.config;
        projectCatalog = Array.isArray(settingsCache.projects) ? settingsCache.projects.slice() : projectCatalog;
        rebuildProjectOptions(settingsCache.projectId || projectId);
        applyProviderSettingsUi();
      }
      if (projectId !== previousProjectId) {
        await loadAgent({ migrateMessages: false });
      }
    } catch (_) {}
  }

  function formatSessionTimestamp(ts) {
    var value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return '';
    try {
      return new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (_) {
      return '';
    }
  }

  function formatSessionStatus(session) {
    if (!session) return 'saved';
    if (session.active || session.status === 'running') return 'live';
    return String(session.status || 'saved');
  }

  function renderSessions(sessions) {
    var list = rootById('cw-sessions-list');
    if (!list) return;
    sessionListCache = Array.isArray(sessions) ? sessions : [];
    list.innerHTML = '';
    if (!sessionListCache.length) {
      var empty = document.createElement('div');
      empty.className = 'cw-session-empty';
      empty.textContent = 'No saved sessions yet.';
      list.appendChild(empty);
      return;
    }

    sessionListCache.forEach(function(session) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cw-session-row' + (session.turn_id === activeSessionId ? ' active' : '');
      row.addEventListener('click', function() { restoreSession(session.turn_id); closeSidebar(); });

      var top = document.createElement('div');
      top.className = 'cw-session-top';

      var main = document.createElement('div');
      main.className = 'cw-session-main';

      var title = document.createElement('div');
      title.className = 'cw-session-title';
      title.textContent = session.preview || session.request_message || 'Untitled session';

      var meta = document.createElement('div');
      meta.className = 'cw-session-meta';
      meta.textContent = [session.provider || '', formatSessionTimestamp(session.updated_at)].filter(Boolean).join(' · ');

      var status = document.createElement('span');
      status.className = 'cw-session-status ' + String(session.status || 'saved');
      status.textContent = formatSessionStatus(session);

      main.appendChild(title);
      top.appendChild(main);
      top.appendChild(status);
      row.appendChild(top);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  async function loadSessions(force) {
    var list = rootById('cw-sessions-list');
    if (!list) return;
    if (sessionsLoading && !force) return;
    sessionsLoading = true;
    if (force || !sessionListCache.length) {
      list.innerHTML = '<div class="cw-session-empty">Loading recent sessions…</div>';
    }
    try {
      var res = await fetch('/api/chat/sessions');
      var data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load sessions');
      renderSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (_) {
      list.innerHTML = '<div class="cw-session-empty">Could not load recent sessions.</div>';
    } finally {
      sessionsLoading = false;
    }
  }

  async function restoreSession(turnId) {
    if (!turnId) return;
    // Only cancel if we're streaming a DIFFERENT turn. Restoring the same
    // running turn we're already attached to (e.g. on a second device) must
    // not kill it.
    if (isStreaming && activeChatId && activeChatId !== turnId) cancelStreaming();
    try {
      var res = await fetch('/api/chat/sessions/' + encodeURIComponent(turnId));
      var data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load session');

      var session = data.session && typeof data.session === 'object' ? data.session : {};
      var isLiveTurn = session.status === 'running';

      if (!isLiveTurn) {
        await fetch('/api/chat/reset-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(function() {});
      }

      activeSessionId = session.turn_id || turnId;
      if (isLiveTurn) {
        var requestMessage = session.request_message || '';
        if (!requestMessage && Array.isArray(data.messages)) {
          var requestEntry = data.messages.find(function(entry) {
            return entry && entry.role === 'user' && entry.content;
          });
          requestMessage = requestEntry && requestEntry.content ? String(requestEntry.content) : '';
        }
        chatHistory = requestMessage ? [{ role: 'user', content: requestMessage }] : [];
      } else {
        chatHistory = Array.isArray(data.messages) ? data.messages : [];
      }
      saveMessages();
      restoreMessages();
      renderSessions(sessionListCache);

      pendingImages = [];
      pendingLinkContent = '';
      lastDetectedUrl = '';
      renderAttachments();
      clearLinkPreview();

      isStreaming = false;
      streamBuffer = '';
      streamBubble = null;
      activeChatId = null;
      resetActiveTurnState();
      setSendButtonStop(false);
      setResumePill(false, '');

      if (isLiveTurn) {
        primeResumableTurn(session);
      }

      var settingsPanel = rootById('cw-settings-panel');
      if (settingsPanel) settingsPanel.classList.remove('open');
      var input = rootById('cw-input');
      if (input) input.focus();
    } catch (e) {
      addMessage('system', 'Could not restore session: ' + e.message);
    }
  }

  // ---- Usage ----
  // Soft caps for percentage bars (messages per window)
  var USAGE_CAPS = { rolling: 40, daily: 80, weekly: 400 };

  function toggleUsage() {
    var panel = rootById('cw-usage-panel');
    var wasOpen = panel.classList.contains('open');
    panel.classList.toggle('open');
    if (!wasOpen) loadUsage();
  }

  async function loadUsage() {
    try {
      var res = await fetch('/api/chat/usage');
      var data = await res.json();
      renderUsage(data);
    } catch (e) {
      console.warn('Could not load usage stats', e);
    }
  }

  function renderUsage(data) {
    // Rolling 5-hour
    var rollingPct = Math.min(100, Math.round((data.rolling.count / USAGE_CAPS.rolling) * 100));
    var rollingBar = rootById('cw-usage-rolling-bar');
    rollingBar.style.width = rollingPct + '%';
    rollingBar.className = 'cw-usage-bar-fill' + (rollingPct > 80 ? ' danger' : rollingPct > 50 ? ' warn' : '');
    rootById('cw-usage-rolling-info').textContent =
      data.rolling.count + ' msgs · ' + rollingPct + '%' +
      (data.rolling.resetsInH > 0 ? ' · resets ' + data.rolling.resetsInH + 'h' : '');

    // Daily
    var dailyPct = Math.min(100, Math.round((data.daily.count / USAGE_CAPS.daily) * 100));
    var dailyBar = rootById('cw-usage-daily-bar');
    dailyBar.style.width = dailyPct + '%';
    dailyBar.className = 'cw-usage-bar-fill' + (dailyPct > 80 ? ' danger' : dailyPct > 50 ? ' warn' : '');
    rootById('cw-usage-daily-info').textContent =
      data.daily.count + ' msgs · ' + dailyPct + '%' +
      (data.daily.resetsInH > 0 ? ' · resets ' + data.daily.resetsInH + 'h' : '');

    // Weekly
    var weeklyPct = Math.min(100, Math.round((data.weekly.count / USAGE_CAPS.weekly) * 100));
    var weeklyBar = rootById('cw-usage-weekly-bar');
    weeklyBar.style.width = weeklyPct + '%';
    weeklyBar.className = 'cw-usage-bar-fill' + (weeklyPct > 80 ? ' danger' : weeklyPct > 50 ? ' warn' : '');
    rootById('cw-usage-weekly-info').textContent =
      data.weekly.count + ' msgs · ' + weeklyPct + '%' +
      (data.weekly.resetsInD > 0 ? ' · resets ' + data.weekly.resetsInD + 'd' : '');

    // Provider tags
    var providerEl = rootById('cw-usage-providers');
    providerEl.innerHTML = '';
    var providers = data.providers || {};
    Object.keys(providers).forEach(function(p) {
      var tag = document.createElement('span');
      tag.className = 'cw-usage-provider-tag';
      tag.textContent = p + ': ' + providers[p];
      providerEl.appendChild(tag);
    });
    if (Object.keys(providers).length === 0) {
      providerEl.innerHTML = '<span class="cw-usage-provider-tag">No usage yet</span>';
    }

    // Model info
    var modelParts = [];
    if (data.currentModel) modelParts.push(data.currentModel);
    if (data.currentEffort) modelParts.push(data.currentEffort);
    if (data.appId) modelParts.push(data.appId);
    rootById('cw-usage-model-info').textContent =
      modelParts.length ? modelParts.join(' · ') : '—';
  }

  // ---- Messages ----
  function resetActiveTurnState() {
    activeStreamSeq = -1;
    activeTurnFailed = false;
  }

  function setResumePill(open, text) {
    var pill = rootById('cw-resume-pill');
    if (!pill) return;
    pill.textContent = text || 'Reconnecting…';
    pill.classList.toggle('open', !!open);
    resumePending = !!open;
  }

  function sendTraceEvent(name, detail, preferBeacon) {
    var payload = JSON.stringify({
      event: name || 'event',
      turn_id: activeChatId || '',
      socket_id: socket && socket.id ? socket.id : '',
      detail: detail && typeof detail === 'object' ? detail : {},
    })
    try {
      if (preferBeacon && navigator.sendBeacon) {
        // iOS Safari rejects Blobs with non-CORS-safelisted MIME types in sendBeacon.
        // Use the default text/plain so the call never throws on the phone.
        navigator.sendBeacon('/api/chat/trace-event', new Blob([payload]))
        return
      }
      fetch('/api/chat/trace-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: !!preferBeacon,
      }).catch(function() {})
    } catch (_) {}
  }

  // ---- Global client error breadcrumbs ----
  // Capture every uncaught error and rejected promise so we can see iOS Safari errors
  // (e.g. "the string did not match the expected pattern") in the server-side trace log.
  try {
    window.addEventListener('error', function (event) {
      try {
        var err = event && event.error;
        sendTraceEvent('window_error', {
          message: String((event && event.message) || (err && err.message) || event || ''),
          filename: String((event && event.filename) || ''),
          lineno: (event && typeof event.lineno === 'number') ? event.lineno : -1,
          colno: (event && typeof event.colno === 'number') ? event.colno : -1,
          stack: err && err.stack ? String(err.stack).slice(0, 2000) : '',
        })
      } catch (_) {}
    })
    window.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event && event.reason
        sendTraceEvent('unhandled_rejection', {
          message: String((reason && reason.message) || reason || ''),
          stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : '',
        })
      } catch (_) {}
    })
  } catch (_) {}

  // Safe JSON-from-Response helper: avoids the iOS Safari
  // "the string did not match the expected pattern" exception that res.json()
  // throws when the body is empty or HTML (e.g. while the server is restarting).
  async function readJsonSafe(res, label) {
    var status = res && typeof res.status === 'number' ? res.status : -1
    var ok = !!(res && res.ok)
    var text = ''
    try { text = await res.text() } catch (e) {
      sendTraceEvent('fetch_body_read_failed', {
        label: String(label || ''), status: status, message: String((e && e.message) || e),
      })
      return { ok: false, status: status, data: null, parseError: 'read_failed', text: '' }
    }
    if (!text) {
      sendTraceEvent('fetch_empty_body', { label: String(label || ''), status: status })
      return { ok: ok, status: status, data: null, parseError: 'empty', text: '' }
    }
    try {
      return { ok: ok, status: status, data: JSON.parse(text), parseError: null, text: text }
    } catch (e) {
      sendTraceEvent('fetch_json_parse_failed', {
        label: String(label || ''),
        status: status,
        message: String((e && e.message) || e),
        body_preview: text.slice(0, 200),
      })
      return { ok: false, status: status, data: null, parseError: 'parse', text: text }
    }
  }

  function requestResume() {
    if (!socket || !socket.connected || !activeChatId) return;
    setResumePill(true, 'Reconnecting…');
    sendTraceEvent('resume_request', { last_seq: activeStreamSeq, resume_pending: resumePending })
    socket.emit('chat_resume', {
      resume: {
        turn_id: activeChatId,
        last_seq: activeStreamSeq,
      },
    });
  }

  function applyCompletedSessionSnapshot(turnId, data) {
    if (!turnId || !data) return false;
    var session = data.session && typeof data.session === 'object' ? data.session : {};
    var messages = Array.isArray(data.messages) ? data.messages : [];
    if ((session.turn_id || turnId) !== turnId) return false;
    if (!messages.length) return false;

    activeSessionId = session.turn_id || turnId;
    chatHistory = messages;
    saveMessages();
    restoreMessages();
    renderSessions(sessionListCache);

    setResumePill(false, '');
    removeTypingIndicator();
    isStreaming = false;
    streamBuffer = '';
    streamBubble = null;
    activeChatId = null;
    setSendButtonStop(false);
    resetActiveTurnState();

    var input = rootById('cw-input');
    if (input) input.focus();
    return true;
  }

  async function syncCompletedTurnSnapshot(turnId) {
    if (!turnId) return false;
    try {
      var res = await fetch('/api/chat/sessions/' + encodeURIComponent(turnId));
      var result = await readJsonSafe(res, 'session_detail');
      if (!result.ok || !result.data || result.data.error) return false;
      var session = result.data.session && typeof result.data.session === 'object' ? result.data.session : {};
      if ((session.turn_id || turnId) !== turnId) return false;
      if (session.status === 'running') return false;
      return applyCompletedSessionSnapshot(turnId, result.data);
    } catch (_) {
      return false;
    }
  }

  function resumeOrSyncCompletedTurn(forceReplay) {
    if (!activeChatId || !isStreaming) return;
    var turnId = activeChatId;
    syncCompletedTurnSnapshot(turnId).then(function(recovered) {
      if (recovered) return;
      if (activeChatId !== turnId || !isStreaming) return;
      requestResumeOrReconnect(forceReplay);
    }).catch(function() {
      if (activeChatId !== turnId || !isStreaming) return;
      requestResumeOrReconnect(forceReplay);
    });
  }

  function requestResumeOrReconnect(forceReplay) {
    if (!socket || !activeChatId || !isStreaming) return;
    if (socket.connected) {
      if (forceReplay || resumePending) requestResume();
      return;
    }
    setResumePill(true, 'Reconnecting…');
    sendTraceEvent('resume_reconnect_attempt', { force_replay: !!forceReplay, socket_connected: false })
    try {
      if (typeof socket.connect === 'function') socket.connect();
    } catch (_) {}
  }

  function primeResumableTurn(summary) {
    if (!summary || !summary.turn_id) return;
    if (activeChatId && activeChatId !== summary.turn_id && isStreaming) return;

    activeChatId = summary.turn_id;
    isStreaming = true;
    streamBuffer = '';
    streamBubble = null;
    resetActiveTurnState();
    removeTypingIndicator();
    addTypingIndicator();
    setSendButtonStop(true);
    setResumePill(true, 'Reconnecting…');

    requestResumeOrReconnect(true);
  }

  function onSocketConnect() {
    sendTraceEvent('socket_connect', { is_streaming: !!isStreaming, active_turn_id: activeChatId || '' })
    if (isStreaming && activeChatId) resumeOrSyncCompletedTurn(false);
    else setResumePill(false, '');
  }

  function onSocketDisconnect(reason) {
    sendTraceEvent('socket_disconnect', { reason: String(reason || '') })
    if (isStreaming && activeChatId) setResumePill(true, 'Reconnecting…');
  }

  function onVisibilityResume() {
    sendTraceEvent('document_visibility', { state: document.visibilityState }, document.visibilityState !== 'visible')
    if (document.visibilityState !== 'visible') return;
    resumeOrSyncCompletedTurn(true);
  }

  function onLifecycleResume(event) {
    sendTraceEvent('lifecycle_resume', {
      type: event && event.type ? event.type : '',
      persisted: !!(event && event.persisted),
    })
    resumeOrSyncCompletedTurn(true);
  }

  function onPageHideTrace(event) {
    sendTraceEvent('pagehide', { persisted: !!(event && event.persisted) }, true)
  }

  function onOfflineTrace() {
    sendTraceEvent('network_offline', {})
  }

  async function onResumeAck(data) {
    if (!data || data.turn_id !== activeChatId) return;
    sendTraceEvent('resume_ack', {
      status: data.status || '',
      replayed: typeof data.replayed === 'number' ? data.replayed : -1,
      last_seq: typeof data.last_seq === 'number' ? data.last_seq : -1,
    })
    setResumePill(false, '');
    if (data.status === 'missing') {
      handleStreamError('Could not resume this turn. The server no longer has its event log.');
      activeChatId = null;
      resetActiveTurnState();
      return;
    }
    if (data.status && data.status !== 'running') {
      await syncCompletedTurnSnapshot(data.turn_id);
    }
  }

  function truncateEventText(text, maxLen) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
  }

  function shouldHandleTurnEvent(event) {
    if (!event || event.turn_id !== activeChatId) return false;
    if (typeof event.seq === 'number') {
      if (event.seq <= activeStreamSeq) return false;
      activeStreamSeq = event.seq;
    }
    return true;
  }

  function appendAssistantChunk(text) {
    if (!text) return;
    removeTypingIndicator();
    streamBuffer += text;
    if (!streamBubble) {
      streamBubble = addMessage('assistant', '');
    }
    streamBubble.innerHTML = renderMd(streamBuffer);
    const msgs = rootById('cw-messages');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function commitStreamBuffer(options) {
    options = options || {};
    if (!streamBuffer) return null;
    var content = streamBuffer;
    if (options.suffix) content += options.suffix;
    var historyIndex = appendHistoryEntry(createHistoryEntry('assistant', content));
    if (streamBubble && streamBubble.parentElement) {
      var wrap = streamBubble.parentElement;
      wrap.dataset.historyIndex = String(historyIndex);
      streamBubble.innerHTML = renderMd(content);
    }
    streamBuffer = '';
    streamBubble = null;
    return historyIndex;
  }

  function addEventNote(text, meta) {
    if (!text) return;
    commitStreamBuffer();
    var entry = createHistoryEntry('system', text, meta || null);
    var historyIndex = appendHistoryEntry(entry);
    if (!shouldRenderHistoryEntry(entry)) return;
    removeTypingIndicator();
    addMessage(entry, '', {
      beforeEl: getLiveInsertBeforeEl(),
      historyIndex: historyIndex,
    });
  }

  function formatTurnEventNote(type, payload) {
    if (type === 'thinking') {
      const text = truncateEventText(payload.text || payload.message || 'Thinking…', 400);
      return text ? `_Thinking_: ${text}` : '_Thinking…_';
    }
    if (type === 'tool_call') {
      const name = payload.name || 'tool';
      const detail = truncateEventText(payload.detail || '', 160);
      return `▶ **${name}**${detail ? `: \`${detail}\`` : ''}`;
    }
    if (type === 'tool_result') {
      const name = payload.name || 'tool';
      const content = truncateEventText(payload.content || payload.result || '', 400);
      return content ? `Tool result from **${name}**\n\n${content}` : `Tool result from **${name}**`;
    }
    if (type === 'status') {
      const message = truncateEventText(payload.message || payload.text || '', 240);
      return message ? `_${message}_` : '';
    }
    return '';
  }

  function finishStreaming(status) {
    setResumePill(false, '');
    removeTypingIndicator();
    if (streamBuffer) {
      commitStreamBuffer();
    } else if (status === 'failed' && !activeTurnFailed) {
      addMessage('system', 'The assistant failed to respond. Check your CLI configuration in Settings.');
    }
    isStreaming = false;
    streamBuffer = '';
    streamBubble = null;
    activeChatId = null;
    setSendButtonStop(false);
    resetActiveTurnState();
    rootById('cw-input').focus();
  }

  function handleStreamError(message) {
    setResumePill(false, '');
    removeTypingIndicator();
    addMessage('system', 'Error: ' + (message || 'Unknown error'));
    activeTurnFailed = true;
    isStreaming = false;
    setSendButtonStop(false);
  }

  function addMessage(role, content, options) {
    options = options || {};
    var entry = typeof role === 'object'
      ? normalizeHistoryEntry(role)
      : createHistoryEntry(role, content, options.entryMeta || null);
    if (options.skipIfHidden && !shouldRenderHistoryEntry(entry)) return null;
    const msgs = rootById('cw-messages');
    const empty = msgs.querySelector('#cw-empty');
    if (empty) empty.remove();
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg ' + entry.role;
    if (entry.verboseTrace) wrap.dataset.verboseTrace = '1';
    if (entry.eventType) wrap.dataset.eventType = entry.eventType;
    if (typeof options.historyIndex === 'number') wrap.dataset.historyIndex = String(options.historyIndex);
    const bubble = document.createElement('div');
    bubble.className = 'cw-bubble';
    if (entry.role === 'assistant' || entry.role === 'system') {
      bubble.innerHTML = renderMd(entry.content);
    } else {
      bubble.textContent = entry.content;
    }
    wrap.appendChild(bubble);
    if (options.beforeEl && options.beforeEl.parentElement === msgs) msgs.insertBefore(wrap, options.beforeEl);
    else msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return bubble;
  }

  function restoreMessages() {
    const msgs = rootById('cw-messages');
    msgs.innerHTML = '';
    streamBubble = null;
    var visibleCount = 0;
    if (chatHistory.length > 0) {
      chatHistory.forEach(function(message, index) {
        var entry = normalizeHistoryEntry(message);
        if (!shouldRenderHistoryEntry(entry)) return;
        visibleCount += 1;
        addMessage(entry, '', { historyIndex: index });
      });
    }
    if (visibleCount === 0 && !isStreaming) {
      renderEmptyState();
    }
    if (isStreaming) {
      if (streamBuffer) streamBubble = addMessage('assistant', streamBuffer);
      else addTypingIndicator();
    }
  }

  function renderEmptyState() {
    const msgs = rootById('cw-messages');
    if (!msgs) return;
    const STARTERS = [
      { title: 'Summarize this page', body: 'give me the gist in plain language.' },
      { title: 'Explain a concept', body: 'walk me through it like I\u2019m new to the topic.' },
      { title: 'Draft a reply', body: 'help me write a clear, polite response.' },
      { title: 'Brainstorm ideas', body: 'suggest options for what I\u2019m working on.' },
    ];
    const wrap = document.createElement('div');
    wrap.className = 'cw-empty-state';
    wrap.id = 'cw-empty';
    var greeting = document.createElement('div');
    greeting.className = 'cw-empty-greeting';
    greeting.textContent = 'How can I help today?';
    var sub = document.createElement('div');
    sub.className = 'cw-empty-sub';
    sub.textContent = WELCOME_MSG;
    var chips = document.createElement('div');
    chips.className = 'cw-empty-chips';
    STARTERS.forEach(function(starter) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cw-empty-chip';
      var t = document.createElement('span');
      t.className = 'cw-empty-chip-title';
      t.textContent = starter.title;
      var b = document.createElement('span');
      b.className = 'cw-empty-chip-body';
      b.textContent = starter.body;
      chip.appendChild(t);
      chip.appendChild(b);
      chip.addEventListener('click', function() {
        var input = rootById('cw-input');
        if (!input) return;
        input.value = starter.title + ' \u2014 ' + starter.body;
        try { autoResize(); } catch (_) {}
        try { detectUrl(); } catch (_) {}
        input.focus();
      });
      chips.appendChild(chip);
    });
    wrap.appendChild(greeting);
    wrap.appendChild(sub);
    wrap.appendChild(chips);
    msgs.appendChild(wrap);
  }

  function addTypingIndicator() {
    const msgs = rootById('cw-messages');
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg assistant';
    wrap.id = 'cw-typing';
    wrap.innerHTML = '<div class="cw-typing"><div class="cw-typing-dot"></div><div class="cw-typing-dot"></div><div class="cw-typing-dot"></div></div>';
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = rootById('cw-typing');
    if (el) el.remove();
  }

  // ---- Image & URL Handling ----
  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(f => uploadImage(f));
    e.target.value = '';
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadImage(file);
        return;
      }
    }
  }

  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/chat/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) {
        addMessage('system', 'Upload failed: ' + data.error);
        return;
      }
      // Create local preview
      const reader = new FileReader();
      reader.onload = (ev) => {
        pendingImages.push({ path: data.path, name: data.name, dataUrl: ev.target.result });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    } catch (err) {
      addMessage('system', 'Upload failed: ' + err.message);
    }
  }

  function renderAttachments() {
    const container = rootById('cw-attachments');
    container.innerHTML = '';
    pendingImages.forEach((img, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'cw-attach-thumb';
      thumb.innerHTML = `<img src="${img.dataUrl}" alt="${img.name}" title="${img.name}">` +
        `<button class="cw-attach-remove" data-idx="${idx}">&times;</button>`;
      container.appendChild(thumb);
    });
    // Link preview
    if (pendingLinkContent) {
      const el = rootById('cw-link-preview');
      if (el) el.style.display = 'flex';
    }
    // Remove buttons
    container.querySelectorAll('.cw-attach-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        pendingImages.splice(parseInt(btn.dataset.idx), 1);
        renderAttachments();
      };
    });
  }

  // URL detection
  let linkFetchTimeout = null;
  let lastDetectedUrl = '';

  function detectUrl() {
    const text = rootById('cw-input').value;
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) {
      clearLinkPreview();
      return;
    }
    const url = urlMatch[0];
    if (url === lastDetectedUrl) return;
    lastDetectedUrl = url;
    pendingLinkContent = '';

    clearTimeout(linkFetchTimeout);
    linkFetchTimeout = setTimeout(() => fetchUrl(url), 600);
  }

  async function fetchUrl(url) {
    const container = rootById('cw-attachments');
    // Show loading indicator
    let preview = rootById('cw-link-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'cw-link-preview';
      preview.id = 'cw-link-preview';
      container.appendChild(preview);
    }
    preview.style.display = 'flex';
    preview.innerHTML = `<span class="cw-link-status">⏳</span><span class="cw-link-url">${url}</span>`;

    try {
      const res = await fetch('/api/chat/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.error) {
        preview.innerHTML = `<span class="cw-link-status" style="color:#e94560;">✗</span><span class="cw-link-url">${url}</span>`;
        return;
      }
      pendingLinkContent = data.content;
      const chars = data.content.length;
      preview.innerHTML = `<span class="cw-link-status" style="color:#4ade80;">✓</span><span class="cw-link-url">${url}</span><span style="flex-shrink:0;">${Math.round(chars/1000)}k chars</span>`;
    } catch (err) {
      preview.innerHTML = `<span class="cw-link-status" style="color:#e94560;">✗</span><span class="cw-link-url">${url} — ${err.message}</span>`;
    }
  }

  function clearLinkPreview() {
    lastDetectedUrl = '';
    pendingLinkContent = '';
    const el = rootById('cw-link-preview');
    if (el) el.remove();
  }

  // ---- Auth check ----
  let authVerified = false;

  async function checkAuth(provider) {
    try {
      var authUrl = '/api/chat/auth?provider=' + encodeURIComponent(provider);
      try {
        authUrl = new URL(authUrl, window.location.href).toString();
      } catch (_) {}
      const res = await fetch(authUrl);
      let data = null;
      try {
        data = await res.json();
      } catch (_) {}
      if (data && data.ok) {
        authVerified = true;
        return true;
      }
      if (data && data.error) {
        addMessage('system',
          'Authentication required: ' + data.error +
          '\n\nOpen the **Terminal** page and run the login command, then try again.'
        );
        return false;
      }
    } catch (_) {}

    authVerified = true;
    return true;
  }

  // ---- Send / Receive ----
  async function sendMessage() {
    const input = rootById('cw-input');
    const message = input.value.trim();
    if (!message || isStreaming) return;

    const provider = rootById('cw-provider').value;
    if (!provider) {
      addMessage('system', 'No CLI provider available. Install Claude CLI, GitHub Copilot CLI, or Codex CLI, then check Settings.');
      return;
    }

    // Check auth on first send (or after provider change)
    if (!authVerified) {
      const ok = await checkAuth(provider);
      if (!ok) return;
    }

    // Display message with attachment indicators
    let displayMsg = message;
    if (pendingImages.length) {
      displayMsg += '\n📎 ' + pendingImages.map(i => i.name).join(', ');
    }
    if (pendingLinkContent) {
      displayMsg += '\n🔗 Link content attached';
    }
    addMessage('user', displayMsg);
    activeSessionId = null;
    renderSessions(sessionListCache);
    appendHistoryEntry(createHistoryEntry('user', displayMsg));
    input.value = '';
    autoResize();

    addTypingIndicator();
    isStreaming = true;
    resetActiveTurnState();
    streamBuffer = '';
    setSendButtonStop(true);

    const includeCtx = !HIDE_PAGE_CONTEXT_CONTROL && rootById('cw-ctx-check').checked;
    const pageContext = includeCtx ? (window._cwCurrentContext || '') : '';

    // Gather attachments
    const images = pendingImages.map(i => ({ path: i.path, name: i.name }));
    const linkContent = pendingLinkContent;

    // Clear attachments
    pendingImages = [];
    pendingLinkContent = '';
    lastDetectedUrl = '';
    renderAttachments();
    clearLinkPreview();
    var conversationHistory = getConversationHistory();

    sendTraceEvent('chat_send_dispatch', {
      prompt_chars: message.length,
      image_count: images.length,
      has_link_content: !!linkContent,
      provider: provider || '',
      history_messages: Math.max(0, conversationHistory.length - 1),
    })
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: conversationHistory.slice(0, -1),
          page_context: pageContext,
          provider,
          projectId: settingsCache.projectId || '',
          images,
          link_content: linkContent,
        }),
      });
      const result = await readJsonSafe(res, 'chat_send')
      sendTraceEvent('chat_send_response', {
        status: result.status,
        ok: result.ok,
        parse_error: result.parseError || '',
        has_turn_id: !!(result.data && (result.data.turn_id || result.data.chat_id)),
        has_error: !!(result.data && result.data.error),
      })
      if (!result.data) {
        removeTypingIndicator();
        var hint = result.parseError === 'empty'
          ? 'The server didn\u2019t respond \u2014 it may be restarting. Tap send to retry.'
          : 'Couldn\u2019t reach the server (HTTP ' + result.status + '). Tap send to retry.';
        addMessage('system', hint);
        isStreaming = false;
        setSendButtonStop(false);
        return;
      }
      const data = result.data
      if (data.error) {
        removeTypingIndicator();
        addMessage('system', 'Error: ' + data.error);
        isStreaming = false;
        setSendButtonStop(false);
        return;
      }
      activeChatId = data.turn_id || data.chat_id;
    } catch (e) {
      sendTraceEvent('chat_send_exception', {
        message: String((e && e.message) || e),
        stack: e && e.stack ? String(e.stack).slice(0, 1500) : '',
      })
      removeTypingIndicator();
      addMessage('system', 'Error: ' + (e && e.message ? e.message : e));
      isStreaming = false;
      setSendButtonStop(false);
    }
  }

  function onTurnEvent(event) {
    if (!shouldHandleTurnEvent(event)) return;
    try {
      sendTraceEvent('chat_event_received', {
        type: String(event && event.type || ''),
        seq: typeof event.seq === 'number' ? event.seq : -1,
        turn_id: String(event && event.turn_id || ''),
      })
    } catch (_) {}
    const payload = event.payload || {};

    if (event.type === 'token') {
      appendAssistantChunk(payload.text || '');
      return;
    }

    if (event.type === 'thinking' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'status') {
      var isVerboseStatus = event.type === 'status' && !isPersistentStatusEntry(payload);
      addEventNote(formatTurnEventNote(event.type, payload), {
        eventType: event.type,
        verboseTrace: event.type === 'thinking' || event.type === 'tool_call' || event.type === 'tool_result' || isVerboseStatus,
        turnId: event.turn_id || '',
        provider: payload.provider || '',
        source: payload.source || '',
        code: payload.code || '',
        kind: payload.kind || '',
      });
      return;
    }

    if (event.type === 'error') {
      handleStreamError(payload.message || 'Unknown error');
      return;
    }

    if (event.type === 'done') {
      finishStreaming(payload.status || 'completed');
    }
  }

  function newConversation() {
    setResumePill(false, '');
    if (isStreaming && activeChatId) {
      fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: activeChatId }),
      }).catch(() => {});
    }
    // Clear server-side provider session so the next message starts fresh
    fetch('/api/chat/reset-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
    activeSessionId = null;
    renderSessions(sessionListCache);
    chatHistory = [];
    saveMessages();
    isStreaming = false;
    resetActiveTurnState();
    streamBuffer = '';
    streamBubble = null;
    activeChatId = null;
    pendingImages = [];
    pendingLinkContent = '';
    lastDetectedUrl = '';
    renderAttachments();
    clearLinkPreview();
    setSendButtonStop(false);
    restoreMessages();
  }

  // ---- Stop / interrupt helpers ----
  var SEND_SVG = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var STOP_SVG = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  function setSendButtonStop(stop) {
    var btn = rootById('cw-send');
    if (stop) {
      btn.innerHTML = STOP_SVG;
      btn.title = 'Stop';
      btn.classList.add('cw-stop');
      btn.disabled = false;
    } else {
      btn.innerHTML = SEND_SVG;
      btn.title = 'Send';
      btn.classList.remove('cw-stop');
      btn.disabled = false;
    }
  }

  function cancelStreaming() {
    if (!isStreaming || !activeChatId) return;
    setResumePill(false, '');
    fetch('/api/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel: activeChatId }),
    }).catch(() => {});
    removeTypingIndicator();
    // Keep whatever was streamed so far
    if (streamBuffer) {
      commitStreamBuffer({ suffix: '\n\n*(interrupted)*' });
    }
    isStreaming = false;
    resetActiveTurnState();
    streamBuffer = '';
    streamBubble = null;
    activeChatId = null;
    setSendButtonStop(false);
    rootById('cw-input').focus();
  }

  // ---- Init on DOM ready ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
