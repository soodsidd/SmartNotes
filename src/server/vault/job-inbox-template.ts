import fs from "node:fs";
import path from "node:path";
import { normalizeAppManifest } from "@/lib/app-contract";

export const JOB_INBOX_TEMPLATE_ID = "job-inbox";
/** v3: detail-panel Delete for inbox postings. Bump when the maintained source changes. */
export const JOB_INBOX_TEMPLATE_VERSION = 3;
export const JOB_STATUSES = ["New", "Skipped", "Archived", "Promoted", "Applied", "Interview", "Offer", "Rejected", "Closed", "Declined"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobInboxManifest = normalizeAppManifest({
  version: 1,
  enabled: true,
  template: { id: JOB_INBOX_TEMPLATE_ID, version: JOB_INBOX_TEMPLATE_VERSION },
  tables: [
    { id: "postings", name: "Job postings", kind: "app", schema: { fields: [
      { id: "sourceKey", name: "Source key", type: "text", required: true },
      { id: "source", name: "Source", type: "select", required: true, options: ["ingest", "email", "share"] },
      { id: "sourceUrl", name: "Source link", type: "text" },
      { id: "title", name: "Captured title", type: "text", required: true },
      { id: "company", name: "Company", type: "text" },
      { id: "role", name: "Role", type: "text" },
      { id: "jd", name: "Job description", type: "text" },
      { id: "status", name: "Status", type: "select", required: true, options: [...JOB_STATUSES] },
      { id: "score", name: "Score", type: "number" },
      { id: "notes", name: "Notes", type: "text" },
      { id: "postedAt", name: "Posted", type: "date" },
      { id: "enrichmentStatus", name: "Enrichment", type: "select", options: ["pending", "partial", "complete", "failed", "skipped"] },
      { id: "applicationId", name: "Application ID", type: "text" },
      { id: "applicationPath", name: "Application path", type: "text" },
      { id: "fitPagePath", name: "Fit page path", type: "text" },
    ] } },
    { id: "views", name: "Saved grid views", kind: "app", schema: { fields: [
      { id: "name", name: "View name", type: "text", required: true },
      { id: "state", name: "Grid state", type: "text", required: true },
    ] } },
  ],
});

// Lucide (ISC) icon paths, inlined because the sandboxed App frame cannot import packages.
const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
const icons = {
  bookmark: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
  bookmarkPlus: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6"/><path d="M15 10H9"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  filter: svg('<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>'),
  filterX: svg('<path d="M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055"/><path d="m22 3-5 5"/><path d="m17 3 5 5"/>'),
  sort: svg('<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>'),
  listChecks: svg('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
  tag: svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>'),
  sparkles: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>'),
  refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  save: svg('<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>'),
  fileText: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  rocket: svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
};

// Mobile-first (SN-309): card rows at <=640px, the details panel replaces the
// list below 960px and sits beside it above. The frame auto-sizes to content,
// so the panel stays in flow instead of position:fixed over a tall frame.
const ui = String.raw`
<style>
:root{color-scheme:light;--background:#fff;--foreground:#0d0d0d;--surface:#fbfbf9;--secondary:#ececf0;--secondary-foreground:#4d4d57;--muted-foreground:#8e8ea0;--border:#dedee4;--input:#dedee4;--accent:oklch(.58 .09 195);--accent-foreground:#fff;--destructive:oklch(.55 .18 25);--ring:oklch(.58 .09 195);--radius-sm:6px;--radius-md:8px;--table-ribbon-button-size:28px;--table-ribbon-icon-size:16px}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--background:#1e1e1e;--foreground:#ececec;--surface:#1e1e1e;--secondary:#2a2a2a;--secondary-foreground:#b4b4b4;--muted-foreground:#8a8a90;--border:#333;--input:#333;--accent:oklch(.74 .10 192);--accent-foreground:#1e1e1e;--destructive:oklch(.65 .16 25);--ring:oklch(.74 .10 192)}}
@media(pointer:coarse),(max-width:640px){:root{--table-ribbon-button-size:44px}}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;background:var(--background);color:var(--foreground)}
body{padding:8px;font:14px/1.4 'Hanken Grotesk',system-ui,sans-serif;-webkit-text-size-adjust:100%}
button,input,select,textarea,label{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
svg{flex:none;width:var(--table-ribbon-icon-size);height:var(--table-ribbon-icon-size);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.icon{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:var(--table-ribbon-button-size);height:var(--table-ribbon-button-size);padding:0;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--secondary-foreground);cursor:pointer}
.icon:hover:not(:disabled){background:var(--secondary);color:var(--foreground)}
.icon:disabled{opacity:.4;cursor:default}
.icon[aria-pressed=true],.icon[aria-expanded=true]{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.badge{position:absolute;top:0;right:0;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--accent);color:var(--accent-foreground);font-size:11px;font-weight:600;line-height:16px}
.top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.top h1{margin:0;font-size:16px;font-weight:600}
.count{margin-right:auto;color:var(--muted-foreground);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ribbon{display:flex;align-items:center;gap:2px;padding:2px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);scrollbar-width:none}
.ribbon::-webkit-scrollbar{display:none}
.group{display:flex;flex:none;align-items:center;gap:2px}.group+.group{margin-left:3px;padding-left:4px;border-left:1px solid var(--border)}
.pick{position:relative;display:inline-flex;flex:none;align-items:center;gap:4px;height:var(--table-ribbon-button-size);padding:0 2px 0 6px;border-radius:var(--radius-sm);color:var(--secondary-foreground)}
.pick:hover{background:var(--secondary)}.pick.is-active{color:var(--accent)}.pick:focus-within{outline:2px solid var(--ring);outline-offset:-2px}
.pick select{height:100%;max-width:9rem;padding:0 2px;border:0;background:transparent;color:var(--foreground);font-size:12px;cursor:pointer}
.pick select:focus-visible{outline:none}.pick select:disabled{opacity:.5;cursor:default}.pick:has(select:disabled){opacity:.4}.pick:has(select:disabled):hover{background:transparent}
.control{width:100%;min-width:0;height:var(--table-ribbon-button-size);padding:0 8px;border:1px solid var(--input);border-radius:var(--radius-sm);background:var(--background);font-size:12px}
textarea.control{height:auto;min-height:96px;padding:8px;line-height:1.5;resize:vertical}
.save-form{display:flex;align-items:center;gap:4px;margin-top:8px}
.filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
.field{display:flex;flex-direction:column;gap:4px;min-width:0}
.field>span{color:var(--secondary-foreground);font-size:11px;font-weight:600}
.range{display:flex;gap:4px}
.filters-foot{display:flex;grid-column:1/-1;justify-content:flex-end}
.error{display:flex;align-items:center;gap:8px;margin-top:8px;padding:2px 2px 2px 12px;border:1px solid color-mix(in srgb,var(--destructive) 30%,transparent);border-radius:var(--radius-sm);background:color-mix(in srgb,var(--destructive) 5%,transparent);color:var(--destructive);font-size:12px}
.error span{flex:1}
.layout{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:12px}.app-main{min-width:0}
.table-wrap{margin-top:8px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md)}
table{width:100%;border-collapse:collapse}
th,td{padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
th{position:sticky;top:0;z-index:1;background:var(--surface);color:var(--secondary-foreground);font-size:11px;font-weight:600}
th[aria-sort=ascending],th[aria-sort=descending]{color:var(--foreground)}
.sort{display:inline-flex;align-items:center;gap:4px;height:var(--table-ribbon-button-size);margin:0 -4px;padding:0 4px;border:0;border-radius:var(--radius-sm);background:transparent;color:inherit;font-weight:600;cursor:pointer}
.sort:hover{background:var(--secondary);color:var(--foreground)}
.ind{min-width:1ch;color:var(--accent);font-variant-numeric:tabular-nums}
[data-col=select]{width:36px;padding-right:0}
[data-col=score]{text-align:right;font-variant-numeric:tabular-nums}
td[data-col=source],td[data-col=postedAt],td[data-col=role]{color:var(--secondary-foreground)}
tbody tr{cursor:pointer}tbody tr:hover{background:var(--secondary)}
tbody tr.is-selected{background:color-mix(in srgb,var(--accent) 8%,transparent)}
tbody tr[aria-current=true]{box-shadow:inset 2px 0 0 var(--accent)}
.trunc{display:block;max-width:16rem;overflow:hidden;text-overflow:ellipsis}
.open{display:block;max-width:16rem;overflow:hidden;padding:0;border:0;background:none;color:var(--foreground);font-weight:600;text-align:left;text-overflow:ellipsis;cursor:pointer}
.check{display:inline-flex;align-items:center;justify-content:center;width:var(--table-ribbon-button-size);height:var(--table-ribbon-button-size);margin:0 -6px;cursor:pointer}
input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--accent);cursor:pointer}
.chip{display:inline-flex;align-items:center;padding:1px 7px;border:1px solid var(--border);border-radius:999px;color:var(--secondary-foreground);font-size:11px;line-height:1.4;white-space:nowrap}
.chip[data-tone=new]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--foreground)}
.chip[data-tone=active]{border-color:var(--accent);color:var(--accent)}
.empty{padding:32px 16px;color:var(--muted-foreground);text-align:center}
.panel{display:flex;flex-direction:column;min-width:0;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
.panel-head{display:flex;align-items:center;gap:4px;padding:4px;border-bottom:1px solid var(--border)}
.panel-head h2{flex:1;min-width:0;margin:0;font-size:14px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.panel-body{display:flex;flex-direction:column;gap:12px;padding:12px}
.meta{display:flex;flex-wrap:wrap;gap:4px;margin:0}
.link{display:flex;align-items:flex-start;gap:6px;color:var(--secondary-foreground);font-size:12px;overflow-wrap:anywhere;user-select:all}
.fields{display:grid;grid-template-columns:minmax(0,1fr) 6rem;gap:8px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.saved{margin-right:auto;color:var(--muted-foreground);font-size:12px}
.fit{display:inline-flex;align-items:center;gap:6px;height:var(--table-ribbon-button-size);padding:0 8px;border-radius:var(--radius-sm);color:var(--secondary-foreground);font-size:12px;cursor:pointer}
.fit:hover{background:var(--secondary)}
.primary{display:inline-flex;align-items:center;gap:6px;height:var(--table-ribbon-button-size);padding:0 12px;border:0;border-radius:var(--radius-sm);background:var(--accent);color:var(--accent-foreground);font-size:12px;font-weight:600;cursor:pointer}
.primary:disabled{opacity:.5;cursor:default}
.danger{display:inline-flex;align-items:center;gap:6px;height:var(--table-ribbon-button-size);padding:0 12px;border:1px solid color-mix(in srgb,var(--destructive) 35%,transparent);border-radius:var(--radius-sm);background:transparent;color:var(--destructive);font-size:12px;font-weight:600;cursor:pointer}
.danger:hover:not(:disabled){background:color-mix(in srgb,var(--destructive) 10%,transparent)}
.danger[aria-pressed=true]{background:var(--destructive);color:#fff;border-color:var(--destructive)}
.danger:disabled{opacity:.5;cursor:default}
details summary{display:flex;align-items:center;min-height:var(--table-ribbon-button-size);color:var(--secondary-foreground);font-size:11px;font-weight:600;cursor:pointer}
.jd{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
@media(min-width:641px){body{padding:12px;font-size:13px}.filters{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
@media(max-width:640px){
input,select,textarea,.pick select{font-size:16px}
.ribbon{flex-wrap:wrap;row-gap:2px;overflow-x:visible}.group+.group{margin-left:0;padding-left:0;border-left:0}.pick select{max-width:7.5rem}
.pick.compact{justify-content:center;width:var(--table-ribbon-button-size);padding:0}.pick.compact select{position:absolute;inset:0;width:100%;max-width:none;opacity:0}
table,tbody{display:block}thead{display:none}.table-wrap{overflow:visible}
tbody tr{display:grid;grid-template-columns:44px auto auto minmax(0,1fr) auto;grid-template-areas:"sel co co co score" "sel role role role role" "sel status source posted posted";align-items:center;column-gap:8px;row-gap:2px;padding:8px 12px 8px 0;border-bottom:1px solid var(--border)}
tbody tr:last-child{border-bottom:0}
td{display:block;min-width:0;padding:0;border:0;overflow:hidden;text-overflow:ellipsis}
td[data-col=select]{grid-area:sel;display:flex;align-self:stretch;justify-content:center;width:auto}
td[data-col=company]{grid-area:co}td[data-col=role]{grid-area:role}td[data-col=status]{grid-area:status}
td[data-col=source]{grid-area:source;font-size:12px}td[data-col=postedAt]{grid-area:posted;font-size:12px}
td[data-col=score]{grid-area:score;font-weight:600}
.open,.trunc{max-width:100%}.check{width:44px;height:100%;min-height:44px;margin:0}
}
@media(max-width:959px){body.detail-open .app-main{display:none}}
@media(min-width:960px){.layout.has-panel{grid-template-columns:minmax(0,1fr) 420px}}
</style>
<div id="layout" class="layout">
<main class="app-main">
<header class="top"><h1>Job Inbox</h1><span id="count" class="count" aria-live="polite"></span><button id="refresh" type="button" class="icon" aria-label="Refresh" title="Refresh">${icons.refresh}</button></header>
<div class="ribbon" role="toolbar" aria-label="Job Inbox actions">
<span class="group"><label class="pick" title="Saved view">${icons.bookmark}<select id="views" aria-label="Saved view"><option value="">All postings</option></select></label>
<button id="save-view" type="button" class="icon" aria-label="Save current view" title="Save current view">${icons.bookmarkPlus}</button>
<button id="delete-view" type="button" class="icon" aria-label="Delete saved view" title="Delete saved view" disabled>${icons.trash}</button></span>
<span class="group"><button id="toggle-filters" type="button" class="icon" aria-label="Filters" title="Filters" aria-expanded="false" aria-controls="filters">${icons.filter}<span id="filter-badge" class="badge" hidden></span></button>
<label id="sort-pick" class="pick compact" title="Sort">${icons.sort}<select id="sort" aria-label="Sort postings"></select></label></span>
<span class="group"><button id="select-all" type="button" class="icon" aria-label="Select all shown" title="Select all shown" aria-pressed="false">${icons.listChecks}</button>
<label class="pick compact" title="Set status of selected">${icons.tag}<select id="bulk-status" aria-label="Set status of selected" disabled></select></label>
<button id="ask-companion" type="button" class="icon" aria-label="Ask companion about selected" title="Ask companion about selected" disabled>${icons.sparkles}</button></span>
</div>
<form id="save-form" class="save-form" hidden><input id="view-name" class="control" aria-label="View name" placeholder="View name" maxlength="80" autocomplete="off"><button type="submit" class="icon" aria-label="Save view" title="Save view">${icons.check}</button><button id="cancel-save" type="button" class="icon" aria-label="Cancel" title="Cancel">${icons.x}</button></form>
<section id="filters" class="filters" aria-label="Filters" hidden><div class="filters-foot"><button id="clear-filters" type="button" class="icon" aria-label="Clear filters" title="Clear filters">${icons.filterX}</button></div></section>
<div id="error" class="error" role="alert" hidden><span id="error-text"></span><button id="dismiss-error" type="button" class="icon" aria-label="Dismiss" title="Dismiss">${icons.x}</button></div>
<div class="table-wrap"><table aria-label="Job postings"><thead id="head"></thead><tbody id="body"></tbody></table><div id="empty" class="empty" hidden>No job postings match this view.</div></div>
</main>
<aside id="panel" class="panel" aria-labelledby="panel-title" hidden>
<header class="panel-head"><button id="close-panel" type="button" class="icon" aria-label="Close details" title="Close (Esc)">${icons.x}</button><h2 id="panel-title"></h2></header>
<div class="panel-body">
<p id="panel-source" class="meta"></p>
<div id="panel-link-row" class="link">${icons.link}<span id="panel-link"></span></div>
<div class="fields"><label class="field"><span>Status</span><select id="panel-status" class="control"></select></label><label class="field"><span>Score</span><input id="panel-score" class="control" type="number" min="0" max="100" inputmode="numeric"></label></div>
<label class="field"><span>Notes</span><textarea id="panel-notes" class="control" rows="4"></textarea></label>
<div class="actions"><span id="panel-saved" class="saved" aria-live="polite"></span>
<button id="save-details" type="button" class="icon" aria-label="Save changes" title="Save changes">${icons.save}</button>
<button id="application" type="button" class="icon" aria-label="Open application" title="Open application" hidden>${icons.fileText}</button>
<button id="delete-posting" type="button" class="danger" title="Delete this inbox entry" aria-pressed="false">${icons.trash}<span id="delete-label">Delete</span></button>
<label class="fit" title="Run Fit analysis when promoting"><input id="run-fit" type="checkbox" checked>${icons.sparkles}<span>Fit</span></label>
<button id="promote" type="button" class="primary" title="Promote to an application page">${icons.rocket}<span id="promote-label">Promote</span></button></div>
<details open><summary>Job description</summary><div id="panel-jd" class="jd"></div></details>
</div>
</aside>
</div>
`;

const controller = String.raw`
const $=id=>document.getElementById(id), statusList=${JSON.stringify(JOB_STATUSES)}, sourceList=['ingest','email','share'];
const wide=matchMedia('(min-width:960px)');
let postings=[],views=[],sorting=[],filters=[],selected={},openId=null,currentView='',shown={},deleteArmed=false;
const fill=(element,placeholder,list)=>{element.replaceChildren();if(placeholder)element.add(new Option(placeholder,''));list.forEach(s=>element.add(new Option(s,s)))};
fill($('bulk-status'),'Status…',statusList);fill($('panel-status'),null,statusList);
const textFilter=(row,id,value)=>String(row.getValue(id)||'').toLowerCase().includes(String(value).toLowerCase());
const rangeFilter=(row,id,value)=>{const n=row.getValue(id);if(!n)return !value?.from&&!value?.to;const x=id==='score'?Number(n):Date.parse(String(n));const from=value?.from? id==='score'?Number(value.from):Date.parse(value.from):null;const to=value?.to? id==='score'?Number(value.to):Date.parse(value.to)+86400000:null;return(from===null||x>=from)&&(to===null||x<=to)};
const columns=[{id:'select',header:'Select',enableSorting:false,enableColumnFilter:false},{accessorKey:'company',header:'Company',filterFn:textFilter},{accessorKey:'role',header:'Role',filterFn:textFilter},{accessorKey:'status',header:'Status',filterFn:'equalsString'},{accessorKey:'source',header:'Source',filterFn:textFilter},{accessorKey:'postedAt',header:'Posted',filterFn:rangeFilter},{accessorKey:'score',header:'Score',filterFn:rangeFilter}];
const table=createTable({data:[],columns,getRowId:r=>r.id,state:{sorting,columnFilters:filters,rowSelection:selected},enableMultiSort:true,enableRowSelection:true,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getFilteredRowModel:getFilteredRowModel(),onSortingChange:up=>{sorting=typeof up==='function'?up(sorting):up;sync()},onColumnFiltersChange:up=>{filters=typeof up==='function'?up(filters):up;sync()},onRowSelectionChange:up=>{selected=typeof up==='function'?up(selected):up;sync()}});
function sync(){table.setOptions(o=>({...o,data:postings.map(r=>({id:r.id,...r.values,createdAt:r.createdAt})),state:{sorting,columnFilters:filters,rowSelection:selected}}));renderRows()}
function cell(tag,text,className){const e=document.createElement(tag);e.textContent=String(text??'');if(className)e.className=className;return e}
function checkbox(label){const e=document.createElement('input');e.type='checkbox';e.setAttribute('aria-label',label);return e}
const tones={New:'new',Promoted:'active',Applied:'active',Interview:'active',Offer:'active'};
function chip(text,tone){const e=cell('span',text,'chip');if(tone)e.dataset.tone=tone;return e}
const postingName=v=>[v.company,v.role].filter(Boolean).join(' — ')||v.title;
function shortDate(value){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));if(!m)return value?String(value):'—';const year=Number(m[1]);return new Date(year,Number(m[2])-1,Number(m[3])).toLocaleDateString(undefined,year===new Date().getFullYear()?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'})}
function showError(message){$('error-text').textContent=message;$('error').hidden=false}
function clearError(){$('error-text').textContent='';$('error').hidden=true}
$('dismiss-error').onclick=clearError;
const refreshers=[];const currentFilter=id=>filters.find(f=>f.id===id)?.value;
const keepValue=(e,v)=>{if(document.activeElement!==e)e.value=v??''};
const onTyped=(e,apply)=>{let timer;e.oninput=()=>{clearTimeout(timer);timer=setTimeout(apply,200)};e.onchange=()=>{clearTimeout(timer);apply()}};
function control(tag,label){const e=document.createElement(tag);e.className='control';e.setAttribute('aria-label',label);return e}
function makeFilter(c){const id=c.id,name=c.columnDef.header;if(id==='status'||id==='source'){const e=control('select','Filter '+name.toLowerCase());fill(e,id==='status'?'All statuses':'All sources',id==='status'?statusList:sourceList);e.onchange=()=>c.setFilterValue(e.value||undefined);refreshers.push(()=>keepValue(e,currentFilter(id)));return e}if(id==='postedAt'||id==='score'){const wrap=document.createElement('div');wrap.className='range';for(const side of ['from','to']){const e=control('input',name+' '+side);e.type=id==='score'?'number':'date';e.placeholder=id==='score'?(side==='from'?'Min':'Max'):side;if(id==='score')e.inputMode='numeric';const apply=()=>{const next={...(currentFilter(id)||{}),[side]:e.value};c.setFilterValue(next.from||next.to?next:undefined)};if(id==='score')onTyped(e,apply);else e.onchange=apply;refreshers.push(()=>keepValue(e,currentFilter(id)?.[side]));wrap.append(e)}return wrap}const e=control('input','Filter '+name.toLowerCase());e.type='search';e.placeholder='Contains…';onTyped(e,()=>{if((currentFilter(id)||'')!==e.value)c.setFilterValue(e.value||undefined)});refreshers.push(()=>keepValue(e,currentFilter(id)));return e}
// Header and filter controls are built once and only refreshed: rebuilding them
// would remove a focused filter input while its blur-triggered change event runs.
function build(){const tr=document.createElement('tr');const foot=$('filters').firstElementChild;for(const c of table.getAllLeafColumns()){const th=document.createElement('th');th.dataset.col=c.id;th.scope='col';if(c.id==='select'){const e=checkbox('Select all shown');e.onchange=()=>toggleAll(e.checked);refreshers.push(()=>{const rows=table.getRowModel().rows,n=rows.filter(r=>r.getIsSelected()).length;e.checked=n>0&&n===rows.length;e.indeterminate=n>0&&n<rows.length});const wrap=cell('label','','check');wrap.append(e);th.append(wrap)}else{const name=c.columnDef.header;const b=document.createElement('button');b.type='button';b.className='sort';b.title='Sort by '+name.toLowerCase()+' (Shift-click to add)';const ind=cell('span','','ind');ind.setAttribute('aria-hidden','true');b.append(cell('span',name),ind);b.onclick=event=>c.toggleSorting(undefined,event.shiftKey);refreshers.push(()=>{const dir=c.getIsSorted();ind.textContent=dir?(dir==='asc'?'↑':'↓')+(sorting.length>1?String(c.getSortIndex()+1):''):'';th.setAttribute('aria-sort',dir==='asc'?'ascending':dir==='desc'?'descending':'none')});th.append(b);const field=cell('label','','field');field.append(cell('span',name),makeFilter(c));$('filters').insertBefore(field,foot)}tr.append(th)}$('head').replaceChildren(tr)}
build();
function toggleAll(on){for(const row of table.getRowModel().rows)row.toggleSelected(on)}
const sortOptions=[['postedAt','desc','Newest posted'],['postedAt','asc','Oldest posted'],['score','desc','Highest score'],['score','asc','Lowest score'],['company','asc','Company A–Z'],['company','desc','Company Z–A'],['role','asc','Role A–Z'],['status','asc','Status A–Z']];
function renderSort(){const s=$('sort');s.replaceChildren(new Option('Default order',''));for(const [id,dir,label] of sortOptions)s.add(new Option(label,id+':'+dir));let value='';if(sorting.length===1){value=sorting[0].id+':'+(sorting[0].desc?'desc':'asc');if(!sortOptions.some(([id,dir])=>id+':'+dir===value)){s.add(new Option('Custom sort','custom'));value='custom'}}else if(sorting.length>1){s.add(new Option('Custom ('+sorting.length+' columns)','custom'));value='custom'}s.value=value;$('sort-pick').classList.toggle('is-active',sorting.length>0)}
$('sort').onchange=()=>{const v=$('sort').value;if(v==='custom')return;if(!v){sorting=[];sync();return}const [id,dir]=v.split(':');sorting=[{id,desc:dir==='desc'}];sync()};
function renderRows(){for(const refresh of refreshers)refresh();renderSort();const rows=table.getRowModel().rows;const body=document.createDocumentFragment();for(const row of rows){const v=row.original;const tr=document.createElement('tr');tr.dataset.id=v.id;if(row.getIsSelected())tr.classList.add('is-selected');if(v.id===openId)tr.setAttribute('aria-current','true');tr.onclick=event=>{if(!event.target.closest('input,button,label'))openPanel(v.id)};for(const c of table.getAllLeafColumns()){const td=document.createElement('td');td.dataset.col=c.id;const value=c.id==='select'?null:row.getValue(c.id);if(c.id==='select'){const e=checkbox('Select '+postingName(v));e.checked=row.getIsSelected();e.onchange=()=>row.toggleSelected(e.checked);const wrap=cell('label','','check');wrap.append(e);td.append(wrap)}else if(c.id==='company'){const b=cell('button',value||v.title||'—','open');b.type='button';b.title='Open details: '+postingName(v);b.onclick=()=>openPanel(v.id);td.append(b)}else if(c.id==='status')td.append(chip(value||'—',tones[value]));else if(c.id==='postedAt'){td.textContent=shortDate(value);if(value)td.title=String(value)}else if(c.id==='role'){const s=cell('span',value||'—','trunc');if(value)s.title=String(value);td.append(s)}else td.textContent=value===null||value===undefined||value===''?'—':String(value);tr.append(td)}body.append(tr)}$('body').replaceChildren(body);$('empty').hidden=rows.length!==0;const n=Object.keys(selected).length;$('count').textContent=rows.length+' shown'+(n?' · '+n+' selected':'');$('bulk-status').disabled=!n;$('ask-companion').disabled=!n;$('select-all').setAttribute('aria-pressed',String(rows.length>0&&rows.every(r=>r.getIsSelected())));$('filter-badge').textContent=String(filters.length);$('filter-badge').hidden=!filters.length}
async function all(tableId){const out=[];for(let offset=0;;offset+=20){const data=await smartNotesApp.query(tableId,{limit:20,offset});out.push(...data.rows);if(data.rows.length<20)break}return out}
async function load(){try{[postings,views]=await Promise.all([all('postings'),all('views')]);clearError();renderViews();sync();if(openId)openPanel(openId)}catch(e){showError(e.message)}}
function renderViews(){const select=$('views');select.replaceChildren(new Option('All postings',''));for(const v of views)select.add(new Option(v.values.name,v.id));select.value=currentView;$('delete-view').disabled=!currentView}
$('views').onchange=()=>{currentView=$('views').value;const view=views.find(v=>v.id===currentView);try{const s=view?JSON.parse(view.values.state):{};sorting=s.sorting||[];filters=s.filters||[]}catch{sorting=[];filters=[]}renderViews();sync()};
// The frame sandbox has no allow-modals (no window prompts), so the view name is typed inline.
function closeSave(){$('save-form').hidden=true;$('save-view').setAttribute('aria-pressed','false')}
$('save-view').onclick=()=>{if(!$('save-form').hidden){closeSave();return}$('save-form').hidden=false;$('save-view').setAttribute('aria-pressed','true');$('view-name').value='';$('view-name').focus()};
$('cancel-save').onclick=()=>{closeSave();$('save-view').focus()};
$('view-name').onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();closeSave();$('save-view').focus()}};
$('save-form').onsubmit=async event=>{event.preventDefault();const name=$('view-name').value.trim();if(!name){$('view-name').focus();return}try{const r=await smartNotesApp.add('views',{name,state:JSON.stringify({sorting,filters})});currentView=r.row.id;closeSave();await load()}catch(e){showError(e.message)}};
$('delete-view').onclick=async()=>{if(!currentView)return;try{await smartNotesApp.delete('views',currentView);currentView='';await load()}catch(e){showError(e.message)}};
$('toggle-filters').onclick=()=>{const open=$('filters').hidden;$('filters').hidden=!open;$('toggle-filters').setAttribute('aria-expanded',String(open));if(open)$('filters').querySelector('.control')?.focus()};
$('clear-filters').onclick=()=>{filters=[];sync()};
$('select-all').onclick=()=>{const rows=table.getRowModel().rows;toggleAll(!(rows.length&&rows.every(r=>r.getIsSelected())))};
$('refresh').onclick=()=>load();
$('bulk-status').onchange=async()=>{const status=$('bulk-status').value;if(!status)return;try{for(const id of Object.keys(selected)){const row=postings.find(p=>p.id===id);if(row)await smartNotesApp.update('postings',id,{...row.values,status})}selected={};$('bulk-status').value='';await load()}catch(e){showError(e.message)}};
$('ask-companion').onclick=async()=>{const ids=Object.keys(selected);if(!ids.length){showError('Select one or more postings first.');return}try{await smartNotesApp.companion.send({text:'Help me triage these selected Job Inbox postings. Use job_inbox_query for these IDs; you may update status or notes with job_inbox_update when I ask.',payload:{postingIds:ids}})}catch(e){showError(e.message)}};
const rowFor=id=>id?$('body').querySelector('tr[data-id="'+CSS.escape(id)+'"]'):null;
function placePanel(){const panel=$('panel');if(!wide.matches){panel.style.marginTop='';return}const tr=rowFor(openId);const offset=tr?tr.getBoundingClientRect().top-$('layout').getBoundingClientRect().top:0;panel.style.marginTop=Math.max(0,Math.round(offset))+'px'}
function resetDeleteArm(){deleteArmed=false;$('delete-posting').disabled=false;$('delete-posting').setAttribute('aria-pressed','false');$('delete-label').textContent='Delete';$('delete-posting').title='Delete this inbox entry'}
function openPanel(id){const row=postings.find(p=>p.id===id);if(!row)return;const reopened=openId===id&&!$('panel').hidden;openId=id;const v=row.values;
if(!reopened)resetDeleteArm();
$('panel-title').textContent=postingName(v);
$('panel-source').replaceChildren(chip(v.status,tones[v.status]),chip(v.source),chip('Added '+new Date(row.createdAt).toLocaleDateString()),chip('Enrichment: '+(v.enrichmentStatus||'pending')));
$('panel-link').textContent=v.sourceUrl||'';$('panel-link-row').hidden=!v.sourceUrl;
// A refresh keeps the user's unsaved edits but picks up server changes (e.g. Promote) in untouched fields.
const next={'panel-status':v.status,'panel-score':String(v.score??''),'panel-notes':v.notes||''};for(const [field,value] of Object.entries(next)){if(!reopened||$(field).value===shown[field])$(field).value=value}shown=next;if(!reopened)$('panel-saved').textContent='';
$('panel-jd').textContent=v.jd||'No description available.';
$('application').hidden=!v.applicationId;const app=v.applicationId?'Open application: '+(v.applicationPath||v.applicationId):'Open application';$('application').title=app;$('application').setAttribute('aria-label',app);
$('promote').disabled=!!v.applicationId;$('promote-label').textContent=v.applicationId?'Promoted':'Promote';$('run-fit').disabled=!!v.applicationId;
for(const tr of $('body').rows){if(tr.dataset.id===id)tr.setAttribute('aria-current','true');else tr.removeAttribute('aria-current')}
$('panel').hidden=false;$('layout').classList.add('has-panel');document.body.classList.add('detail-open');placePanel();
if(!reopened){$('close-panel').focus({preventScroll:true});if(wide.matches)$('panel').scrollIntoView({block:'nearest'});else{window.scrollTo(0,0);$('panel').scrollIntoView({block:'start'})}}}
function closePanel(){const id=openId;openId=null;resetDeleteArm();$('panel').hidden=true;$('layout').classList.remove('has-panel');document.body.classList.remove('detail-open');for(const tr of $('body').rows)tr.removeAttribute('aria-current');const tr=rowFor(id);if(tr){tr.scrollIntoView({block:'nearest'});tr.querySelector('button.open')?.focus({preventScroll:true})}}
$('close-panel').onclick=closePanel;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('panel').hidden){if(deleteArmed){resetDeleteArm();return}closePanel()}});
wide.addEventListener('change',()=>{if(openId)placePanel()});
$('application').onclick=async()=>{const row=postings.find(p=>p.id===openId);if(!row?.values.applicationId)return;try{await smartNotesApp.jobInbox.openApplication(row.values.applicationId)}catch(e){showError(e.message)}};
$('save-details').onclick=async()=>{const row=postings.find(p=>p.id===openId);if(!row)return;try{await smartNotesApp.update('postings',row.id,{...row.values,status:$('panel-status').value,score:$('panel-score').value?Number($('panel-score').value):null,notes:$('panel-notes').value});$('panel-saved').textContent='';await load();$('panel-saved').textContent='Saved'}catch(e){showError(e.message)}};
$('promote').onclick=async()=>{if(!openId)return;const button=$('promote');button.disabled=true;try{const result=await smartNotesApp.jobInbox.promote(openId,$('run-fit').checked);await load();if(result.warning)showError(result.warning)}catch(e){showError(e.message);button.disabled=false}};
// Frame sandbox has no allow-modals, so Delete is a two-click confirm (arm, then Confirm).
$('delete-posting').onclick=async()=>{if(!openId)return;if(!deleteArmed){deleteArmed=true;$('delete-posting').setAttribute('aria-pressed','true');$('delete-label').textContent='Confirm';$('delete-posting').title='Click again to permanently delete this inbox entry';return}const id=openId;const button=$('delete-posting');button.disabled=true;try{await smartNotesApp.jobInbox.delete(id);delete selected[id];openId=null;resetDeleteArm();$('panel').hidden=true;$('layout').classList.remove('has-panel');document.body.classList.remove('detail-open');await load()}catch(e){showError(e.message);resetDeleteArm()}};
smartNotesApp.companion.onMessage(async message=>{if(message?.action==='refresh')await load()});
load();
`;

/** The checked-in table-core dependency is embedded into the opaque App source. */
export function jobInboxSource(): string {
  const tableCore = fs.readFileSync(path.join(process.cwd(), "node_modules", "@tanstack", "table-core", "build", "lib", "index.esm.js"), "utf8");
  // table-core's ESM build reads process.env.NODE_ENV for dev warnings; the
  // sandboxed App frame has no `process`, so shadow it inside the module scope.
  return `${ui}<script type="module">const process={env:{NODE_ENV:"production"}};\n${tableCore}\n${controller}</script>`;
}
