# SN-406 rework 1 — editor dictation discoverability + desktop

Owner report: "Editor space doesn't have dictation… shouldn't be hidden behind the + icon… I need the dictation tool on desktop as well."

## Diagnosis (live, not from source)
- `before-probe.json` (worktree preview) and `prod-probe.json` (production :3002, build 8342fa3): the desktop
  toolbar mic *was* rendered, visible and hit-testable at 800–1920 px. Not a stale build, wrong page type,
  overflow or z-index problem.
- `before-1440.png`: it was an unlabeled 26 px grey glyph sitting flush against the Insert "+" dropdown with no
  separator, so it read as part of the "+" group. On phones the format bar had **no** mic at all (only the
  bottom-right FAB), so looking in the toolbar found only "+".
- Side note (not changed): the service worker serves navigations from cache first and shows the SN-85 update
  banner. The first load of a tab after a deploy can still show the previous build until the banner is accepted.

## Fix
- Desktop: labeled, accent-tinted **Dictate** button in its own separated group before "+"; reads **Stop** while
  recording (`after-1440-toolbar.png`, `after-1440-editor-recording.png`).
- Phone: icon-only mic directly in the condensed format bar, left of "+"; the FAB remains as a thumb-zone shortcut
  (`after-360.png`, `after-390.png`).
- Status line is device-neutral: "Listening m:ss · stops after 10 s of silence".

## Live verification (real audio via fake mic, long-clip.wav)
- `desktop-walkthrough.json` (1440×900): toolbar Dictate visible without opening any menu, parent is `format-bar`,
  auto-stops on silence, transcript inserted **at a mid-text caret** (between FIRST-PART and SECOND-PART);
  Companion composer mic visible next to Send and appends to the draft. No console errors.
- `phone-toolbar-mic.json` (iPhone 13): phone toolbar mic, parent `format-bar-mobile`, records, auto-stops, appends
  after existing text. No console errors.
- `after-probe.json`: mic visible and hit-testable at 1920/1440/1280/1024/800/390/360 px; no format-bar overflow.

Scripts: `desktop-probe.mjs <url> <tag>`, `desktop-walkthrough.mjs <url>`, `phone-toolbar-mic.mjs <url>`.
