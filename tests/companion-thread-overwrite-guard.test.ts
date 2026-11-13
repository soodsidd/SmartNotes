/**
 * A page's Companion conversation must never be replaced by an unrelated one
 * (incident 2026-11-13: a Deep Work chat was saved over AI/Drones pages).
 * Server: saveCompanionSessions refuses a write whose messages share nothing
 * with the stored thread. Client: in-memory transcript saves are gated on the
 * transcript's thread binding.
 */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { VaultError } from "@/server/vault/errors";
import {
  findReplacedCompanionThreads,
  readCompanionSessions,
  saveCompanionSessions,
} from "@/server/vault/pages";

const msg = (id: string, role = "user", content = id) => ({ id, role, content });

let vaultRoot: string;
const saved = { vault: process.env.SMART_NOTES_VAULT, state: process.env.SMART_NOTES_STATE_DIR };

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn-companion-guard-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "sn-companion-guard-state-"));
  await fs.mkdir(path.join(vaultRoot, "AI", "Drones"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, "AI", "Drones", "drone-research.html"), "<p>Drones</p>");
});

afterEach(async () => {
  process.env.SMART_NOTES_VAULT = saved.vault;
  process.env.SMART_NOTES_STATE_DIR = saved.state;
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

const PAGE = "AI/Drones/drone-research.html";

describe("findReplacedCompanionThreads", () => {
  it("flags only scopes whose stored and incoming messages share nothing", () => {
    const existing = { whole: { messages: [msg("u1"), msg("a1", "assistant")] }, page_tree: { messages: [msg("t1")] } };
    expect(findReplacedCompanionThreads(existing, { whole: { messages: [msg("x1"), msg("x2", "assistant")] } })).toEqual(["whole"]);
    expect(findReplacedCompanionThreads(existing, { whole: { messages: [msg("u1"), msg("a1", "assistant"), msg("u2")] } })).toEqual([]);
    expect(findReplacedCompanionThreads(existing, { whole: { messages: [] } })).toEqual([]);
    expect(findReplacedCompanionThreads({}, { whole: { messages: [msg("x1")] } })).toEqual([]);
  });

  it("matches legacy messages without ids by role and content", () => {
    const existing = { whole: { messages: [{ role: "user", content: "hello" }] } };
    expect(findReplacedCompanionThreads(existing, { whole: { messages: [{ role: "user", content: "hello" }, msg("a")] } })).toEqual([]);
    expect(findReplacedCompanionThreads(existing, { whole: { messages: [{ role: "user", content: "other" }] } })).toEqual(["whole"]);
  });
});

describe("saveCompanionSessions overwrite guard", () => {
  it("refuses to replace a page's conversation with an unrelated one and keeps the original", async () => {
    await saveCompanionSessions(PAGE, { whole: { messages: [msg("u1"), msg("a1", "assistant")] } });
    await expect(
      saveCompanionSessions(PAGE, { whole: { messages: [msg("lelab-u"), msg("lelab-a", "assistant")] } })
    ).rejects.toMatchObject({ code: "COMPANION_THREAD_CONFLICT", status: 409 });
    const after = await readCompanionSessions(PAGE);
    expect((after.scopes.whole as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("allows appending, trimming to the message cap, adding scopes, and clearing", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => msg(`m${i}`));
    await saveCompanionSessions(PAGE, { whole: { messages: fifty } });
    // Rolling cap: oldest two dropped, two new appended.
    await saveCompanionSessions(PAGE, { whole: { messages: [...fifty.slice(2), msg("m50"), msg("m51")] } });
    // A different scope may start fresh alongside.
    await saveCompanionSessions(PAGE, {
      whole: { messages: [...fifty.slice(2), msg("m50"), msg("m51")] },
      page_tree: { messages: [msg("t1")] },
    });
    // Clearing a scope (removed from the map), then starting a new chat there.
    await saveCompanionSessions(PAGE, { page_tree: { messages: [msg("t1")] } });
    await saveCompanionSessions(PAGE, { whole: { messages: [msg("new")] }, page_tree: { messages: [msg("t1")] } });
    const after = await readCompanionSessions(PAGE);
    expect((after.scopes.whole as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual(["new"]);
  });

  it("is a VaultError so the API answers 409 instead of 500", async () => {
    await saveCompanionSessions(PAGE, { whole: { messages: [msg("u1")] } });
    await expect(saveCompanionSessions(PAGE, { whole: { messages: [msg("x")] } })).rejects.toBeInstanceOf(VaultError);
  });
});

describe("client transcript saves are gated on thread binding", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"), "utf8");

  it("defines the binding check", () => {
    expect(src).toMatch(/const isTranscriptBoundTo = \(path: string, scopeKey: string\) =>\s*aiMessagesBindingKeyRef\.current === `\$\{path\}::\$\{scopeKey\}`/);
  });

  it("every save of the in-memory transcript checks the binding first", () => {
    // Saves of aiMessagesRef.current / aiMessages state / the debounced snapshot.
    const saves = [...src.matchAll(/saveCompanionThread\(([^,]+), ([^,]+), (aiMessagesRef\.current|aiMessages|snapshot)\)/g)];
    expect(saves.length).toBeGreaterThanOrEqual(4);
    for (const save of saves) {
      const before = src.slice(Math.max(0, (save.index ?? 0) - 400), save.index);
      expect(before).toContain("isTranscriptBoundTo(");
    }
  });
});
