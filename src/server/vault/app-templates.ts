import { normalizeAppManifest, type AppManifest } from "@/lib/app-contract";
import type { NoteType } from "./types";
import { VaultError } from "./errors";

export const APP_TEMPLATE_CATALOG_VERSION = 1 as const;

export interface AppTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  noteType: Extract<NoteType, "app" | "design">;
  source: string;
  manifest?: AppManifest;
}

const baseStyles = `<style>
:root{color-scheme:light;--background:#ffffff;--foreground:#0d0d0d;--surface:#ffffff;--muted-foreground:#8e8ea0;--border:#e6e6eb;--accent:oklch(0.58 0.09 195);--radius-sm:6px;font-family:'Hanken Grotesk',system-ui,sans-serif}@media(prefers-color-scheme:dark){:root{color-scheme:dark;--background:#1e1e1e;--foreground:#ececec;--surface:#1e1e1e;--muted-foreground:#8a8a90;--border:#333333;--accent:oklch(0.74 0.10 192)}}body{margin:0;padding:1rem;background:var(--background);color:var(--foreground)}
main{max-width:48rem;margin:auto}button,input,select,textarea{font:inherit}button{min-height:2.75rem;padding:.5rem .75rem}
.row{display:flex;align-items:center;gap:.75rem;padding:.625rem 0;border-bottom:1px solid var(--border)}
.muted{color:var(--muted-foreground)}.toolbar{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}.grow{flex:1}.done{text-decoration:line-through;color:var(--muted-foreground)}
</style>`;

const blankSource = `${baseStyles}<main><h1>Blank App</h1><p class="muted">Customize this maintained template in Develop → Source.</p></main>`;

const checklistSource = `${baseStyles}
<main><h1>Action Checklist</h1><div class="toolbar"><select id="filter" aria-label="Filter items"><option value="visible">Visible</option><option value="all">All</option><option value="open">Open</option><option value="done">Done</option></select></div><div id="items" aria-live="polite">Loading…</div></main>
<script>
const table='items',settingsTable='settings',host=document.querySelector('#items'),filter=document.querySelector('#filter');let rows=[],settingsRow=null;
const show=r=>filter.value==='all'||(filter.value==='visible'&&!r.values.hidden)||(filter.value==='open'&&!r.values.hidden&&!r.values.checked)||(filter.value==='done'&&!r.values.hidden&&r.values.checked);
function render(){host.replaceChildren(...rows.filter(show).map(row=>{const line=document.createElement('div');line.className='row';const check=document.createElement('input');check.type='checkbox';check.checked=!!row.values.checked;check.setAttribute('aria-label','Complete '+row.values.text);check.onchange=async()=>{await smartNotesApp.update(table,row.id,{...row.values,checked:check.checked});await load()};const text=document.createElement('span');text.className='grow'+(row.values.checked?' done':'');text.textContent=row.values.text;const hide=document.createElement('button');hide.textContent=row.values.hidden?'Show':'Hide';hide.onclick=async()=>{await smartNotesApp.update(table,row.id,{...row.values,hidden:!row.values.hidden});await load()};line.append(check,text,hide);return line}));if(!host.childNodes.length)host.textContent='No matching items.'}
async function load(){try{const [result,settings]=await Promise.all([smartNotesApp.query(table,{limit:200}),smartNotesApp.query(settingsTable,{limit:1})]);rows=result.rows;settingsRow=settings.rows[0]||null;filter.value=settingsRow?.values.value||'visible';render()}catch(error){host.textContent=error.message}}filter.onchange=async()=>{render();try{settingsRow?await smartNotesApp.update(settingsTable,settingsRow.id,{value:filter.value}):await smartNotesApp.add(settingsTable,{value:filter.value});await load()}catch(error){host.textContent=error.message}};load();
</script>`;

const customLogSource = `${baseStyles}
<main><h1>Custom Log App</h1><form id="entry-form" class="toolbar"><input id="entry" class="grow" required placeholder="New entry"><button>Add</button></form><div id="entries" aria-live="polite">Loading…</div></main>
<script>
const table='entries',host=document.querySelector('#entries'),form=document.querySelector('#entry-form'),input=document.querySelector('#entry');
async function load(){try{const result=await smartNotesApp.query(table);host.replaceChildren(...result.rows.slice().reverse().map(row=>{const line=document.createElement('div');line.className='row';const text=document.createElement('span');text.className='grow';text.textContent=row.values.entry;const del=document.createElement('button');del.textContent='Delete';del.onclick=async()=>{await smartNotesApp.delete(table,row.id);await load()};line.append(text,del);return line}));if(!host.childNodes.length)host.textContent='No entries yet.'}catch(error){host.textContent=error.message}}
form.onsubmit=async event=>{event.preventDefault();await smartNotesApp.add(table,{entry:input.value,notes:''});input.value='';await load()};load();
</script>`;

const designSource = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${baseStyles}<style>.canvas{max-width:60rem;margin:auto;padding:2rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}</style></head><body><main class="canvas"><h1>Design Page</h1><p>Customize this maintained visual artifact in Source.</p></main></body></html>`;

const templates: AppTemplate[] = [
  {
    id: "blank-app", version: 1, name: "Blank App", noteType: "app",
    description: "Minimal sandboxed app with no attached data.", source: blankSource,
    manifest: normalizeAppManifest({ version: 1, enabled: true, template: { id: "blank-app", version: 1 }, tables: [] }),
  },
  {
    id: "action-checklist", version: 1, name: "Action Checklist", noteType: "app",
    description: "Persistent checklist with check, hide, and filter controls.", source: checklistSource,
    manifest: normalizeAppManifest({
      version: 1, enabled: true, template: { id: "action-checklist", version: 1 },
      tables: [{ id: "items", name: "Checklist items", kind: "app", schema: { fields: [
        { id: "text", name: "Action", type: "text", required: true },
        { id: "checked", name: "Checked", type: "boolean" },
        { id: "hidden", name: "Hidden", type: "boolean" },
      ] } }, { id: "settings", name: "Checklist settings", kind: "app", schema: { fields: [
        { id: "value", name: "Selected filter", type: "select", required: true, options: ["visible", "all", "open", "done"] },
      ] } }],
    }),
  },
  {
    id: "design-page", version: 1, name: "Design Page", noteType: "design",
    description: "Self-contained raw HTML/CSS visual artifact without app data access.", source: designSource,
  },
  {
    id: "custom-log-app", version: 1, name: "Custom Log App", noteType: "app",
    description: "Generic app over a Log-shaped JSON table; may attach an existing Log page.", source: customLogSource,
    manifest: normalizeAppManifest({
      version: 1, enabled: true, template: { id: "custom-log-app", version: 1 },
      tables: [{ id: "entries", name: "Entries", kind: "app", schema: { fields: [
        { id: "entry", name: "Entry", type: "text", required: true },
        { id: "notes", name: "Notes", type: "text" },
      ] } }],
    }),
  },
];

export function listAppTemplates() {
  return templates.map(({ source: _source, manifest: _manifest, ...template }) => template);
}

export function getAppTemplate(id: unknown): AppTemplate {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new VaultError("INVALID_APP_TEMPLATE", "A valid template id is required.", 400);
  }
  const template = templates.find((candidate) => candidate.id === id);
  if (!template) throw new VaultError("APP_TEMPLATE_NOT_FOUND", `Unknown App template: ${id}`, 404);
  return template;
}
