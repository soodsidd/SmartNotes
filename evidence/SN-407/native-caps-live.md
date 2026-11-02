# SN-407 Windows Caps Lock live check — 2026-11-02

Ran `node evidence/SN-407/ptt-live.mjs http://127.0.0.1:52435` against the registered preview on an unlocked Windows desktop. The script used OS-level `keybd_event` input, a headed Playwright Chromium window, a fake microphone playing `evidence/SN-406/long-clip.wav`, and the real local transcription engine. This run completed successfully before the final focus-disarm and error-reporting changes. Screenshots: `ptt-CapsLock-after.png`, `ptt-F8-after.png`.

| Binding | OS Caps Lock before/after | Browser bound-key events | Result |
|---|---|---|---|
| Caps Lock | on / on | 0 down, 0 up (native hook suppressed 250 repeats) | Release inserted the speech transcript after existing note text; typing `abc` afterward produced `ABC`, matching the initial on state. |
| F8, set through Settings | on / on | 1 down, 250 repeats, 1 up | Release inserted the speech transcript; typing `abc` afterward produced `ABC`. |

There were no page errors. The scratch notebook was deleted (HTTP 200). An earlier failed harness attempt had toggled Caps Lock from its original off state before the WebSocket Origin fix; after this successful run, I measured the state and restored it to off. The native hook did not require any injected state repair. A later check against the restarted preview could not send keys because the desktop had locked (`GetForegroundWindow` returned null); `ptt-live-locked-attempt.json` records that limit. The outside-Smart-Notes normal-toggle scenario in the revised harness still needs an unlocked desktop.

The final registered Inspect proxy returned HTTP 200 and delivered `dictation:caps-bridge { ready: true }` over its WebSocket after the loopback proxy Origin fix. The named dictation catalog regression then passed as `reg-mvzmlzeg-8e7c38`.
