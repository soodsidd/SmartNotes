import fs from "node:fs";
import path from "node:path";
import { normalizeAppManifest } from "@/lib/app-contract";

export const JOB_INBOX_TEMPLATE_ID = "job-inbox";
export const JOB_STATUSES = ["New", "Skipped", "Archived", "Promoted", "Applied", "Interview", "Offer", "Rejected", "Closed", "Declined"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobInboxManifest = normalizeAppManifest({
  version: 1,
  enabled: true,
  template: { id: JOB_INBOX_TEMPLATE_ID, version: 1 },
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

const ui = String.raw`
<style>
:root{color-scheme:light;--background:#fff;--foreground:#0d0d0d;--surface:#fff;--muted-foreground:#8e8ea0;--border:#e6e6eb;--accent:oklch(.58 .09 195);--radius-sm:6px;font-family:'Hanken Grotesk',system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--background:#1e1e1e;--foreground:#ececec;--surface:#1e1e1e;--muted-foreground:#8a8a90;--border:#333;--accent:oklch(.74 .10 192)}}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:14px 'Hanken Grotesk',system-ui,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}button,select,input,textarea{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}button{cursor:pointer;min-height:44px;padding:.5rem .75rem}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{padding:1rem}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}.toolbar h1{font-size:1.25rem;margin:0 auto 0 0}.muted{color:var(--muted-foreground)}.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm)}table{border-collapse:collapse;min-width:900px;width:100%}th,td{text-align:left;padding:.625rem;border-bottom:1px solid var(--border);vertical-align:top}th{position:sticky;top:0;background:var(--surface)}th button{border:0;min-height:32px;padding:0;background:transparent;font-weight:600}th input,th select{display:block;width:100%;min-width:100px;min-height:36px;margin-top:.35rem;padding:.3rem}th .range{display:flex;gap:.25rem}th .range input{min-width:65px;width:50%}tr:hover{background:color-mix(in srgb,var(--accent) 7%,var(--background))}td button{min-height:36px}.panel{position:fixed;right:0;top:0;bottom:0;width:min(440px,100vw);background:var(--background);border-left:1px solid var(--border);box-shadow:0 0 20px color-mix(in srgb,var(--foreground) 15%,transparent);overflow:auto;padding:1rem;z-index:10}.panel[hidden]{display:none}.panel-head{display:flex;align-items:center;gap:.5rem}.panel-head h2{margin:0 auto 0 0;font-size:1.2rem}.panel label{display:block;margin:1rem 0 .35rem;font-weight:600}.panel select,.panel textarea,.panel input[type=number]{width:100%;padding:.5rem;min-height:44px}input[type=checkbox]{width:20px;height:20px;min-height:0;margin:0;accent-color:var(--accent)}th input[type=checkbox]{display:inline-block;width:20px;min-width:0;margin:0}.panel textarea{min-height:120px}.jd{white-space:pre-wrap;line-height:1.5}.panel a{color:var(--accent);word-break:break-all}.empty{padding:2rem;text-align:center}.error{color:var(--foreground);border:1px solid var(--border);padding:.75rem;margin-bottom:.5rem}
@media(max-width:680px){.app{padding:.5rem}.toolbar{gap:.35rem}.toolbar h1{width:100%}.panel{width:100vw}table{min-width:0}[data-col=source],[data-col=postedAt]{display:none}th input,th select{min-width:70px}}
</style>
<main class="app"><div class="toolbar"><h1>Job Inbox</h1><select id="views" aria-label="Saved view"><option value="">All postings</option></select><button id="save-view">Save view</button><button id="delete-view" disabled>Delete view</button><select id="bulk-status" aria-label="Set selected status"><option value="">Set selected status…</option></select><button id="ask-companion">Ask companion about selected</button><span id="count" class="muted"></span></div><div id="error" role="alert"></div><div class="table-wrap"><table aria-label="Job postings"><thead id="head"></thead><tbody id="body"></tbody></table></div><div id="empty" class="empty" hidden>No job postings match this view.</div></main>
<aside id="panel" class="panel" hidden aria-label="Posting details"><div class="panel-head"><h2 id="panel-title"></h2><button id="close-panel" aria-label="Close details">Close</button></div><p id="panel-source" class="muted"></p><a id="panel-link" target="_blank" rel="noreferrer"></a><label for="panel-status">Status</label><select id="panel-status"></select><label for="panel-score">Score</label><input id="panel-score" type="number" min="0" max="100"><label for="panel-notes">Notes</label><textarea id="panel-notes"></textarea><button id="save-details">Save changes</button><button id="promote">Promote</button><label><input id="run-fit" type="checkbox" checked> Run Fit analysis</label><button id="application" hidden>Open application</button><h3>Job description</h3><div id="panel-jd" class="jd"></div></aside>
`;

const controller = String.raw`
const $=id=>document.getElementById(id), statusList=${JSON.stringify(JOB_STATUSES)};
let postings=[],views=[],sorting=[],filters=[],selected={},openId=null,currentView='';
const statusSelect=(element,placeholder=false)=>{element.replaceChildren();if(placeholder)element.add(new Option('Set selected status…',''));statusList.forEach(s=>element.add(new Option(s,s)))};
statusSelect($('bulk-status'),true);statusSelect($('panel-status'));
const textFilter=(row,id,value)=>String(row.getValue(id)||'').toLowerCase().includes(String(value).toLowerCase());
const rangeFilter=(row,id,value)=>{const n=row.getValue(id);if(!n)return !value?.from&&!value?.to;const x=id==='score'?Number(n):Date.parse(String(n));const from=value?.from? id==='score'?Number(value.from):Date.parse(value.from):null;const to=value?.to? id==='score'?Number(value.to):Date.parse(value.to)+86400000:null;return(from===null||x>=from)&&(to===null||x<=to)};
const columns=[{id:'select',header:'Select',enableSorting:false,enableColumnFilter:false},{accessorKey:'company',header:'Company',filterFn:textFilter},{accessorKey:'role',header:'Role',filterFn:textFilter},{accessorKey:'status',header:'Status',filterFn:'equalsString'},{accessorKey:'source',header:'Source',filterFn:textFilter},{accessorKey:'postedAt',header:'Posted',filterFn:rangeFilter},{accessorKey:'score',header:'Score',filterFn:rangeFilter}];
const table=createTable({data:[],columns,getRowId:r=>r.id,state:{sorting,columnFilters:filters,rowSelection:selected},enableMultiSort:true,enableRowSelection:true,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getFilteredRowModel:getFilteredRowModel(),onSortingChange:up=>{sorting=typeof up==='function'?up(sorting):up;sync()},onColumnFiltersChange:up=>{filters=typeof up==='function'?up(filters):up;sync()},onRowSelectionChange:up=>{selected=typeof up==='function'?up(selected):up;sync()}});
function sync(){table.setOptions(o=>({...o,data:postings.map(r=>({id:r.id,...r.values,createdAt:r.createdAt})),state:{sorting,columnFilters:filters,rowSelection:selected}}));renderRows()}
function cell(tag,text){const e=document.createElement(tag);e.textContent=String(text??'');return e}
const headRefresh=[];const currentFilter=id=>filters.find(f=>f.id===id)?.value;
const keepValue=(e,v)=>{if(document.activeElement!==e)e.value=v??''};
const onTyped=(e,apply)=>{let timer;e.oninput=()=>{clearTimeout(timer);timer=setTimeout(apply,200)};e.onchange=()=>{clearTimeout(timer);apply()}};
function makeFilter(c){const id=c.id;if(id==='status'){const e=document.createElement('select');e.setAttribute('aria-label','Filter status');e.add(new Option('All statuses',''));statusList.forEach(s=>e.add(new Option(s,s)));e.onchange=()=>c.setFilterValue(e.value||undefined);headRefresh.push(()=>keepValue(e,currentFilter(id)));return e}if(id==='postedAt'||id==='score'){const wrap=document.createElement('div');wrap.className='range';for(const side of ['from','to']){const e=document.createElement('input');e.type=id==='score'?'number':'date';e.placeholder=side;e.setAttribute('aria-label',id+' '+side);const apply=()=>{const next={...(currentFilter(id)||{}),[side]:e.value};c.setFilterValue(next.from||next.to?next:undefined)};if(id==='score')onTyped(e,apply);else e.onchange=apply;headRefresh.push(()=>keepValue(e,currentFilter(id)?.[side]));wrap.append(e)}return wrap}const e=document.createElement('input');e.type='search';e.placeholder='Filter';e.setAttribute('aria-label','Filter '+id);onTyped(e,()=>{if((currentFilter(id)||'')!==e.value)c.setFilterValue(e.value||undefined)});headRefresh.push(()=>keepValue(e,currentFilter(id)));return e}
// The header is built once and only refreshed: rebuilding it would remove a
// focused filter input while its blur-triggered change event is running.
function renderHead(){if(!headRefresh.length){const tr=document.createElement('tr');for(const c of table.getAllLeafColumns()){const th=document.createElement('th');th.dataset.col=c.id;if(c.id==='select'){const e=document.createElement('input');e.type='checkbox';e.setAttribute('aria-label','Select all matching');e.onchange=()=>{for(const row of table.getRowModel().rows)row.toggleSelected(e.checked)};headRefresh.push(()=>{e.checked=table.getIsAllRowsSelected()});th.append(e)}else{const b=document.createElement('button');b.onclick=event=>c.toggleSorting(undefined,event.shiftKey);headRefresh.push(()=>{const dir=table.getColumn(c.id).getIsSorted();b.textContent=c.columnDef.header+(dir==='asc'?' ↑':dir==='desc'?' ↓':'');th.setAttribute('aria-sort',dir==='asc'?'ascending':dir==='desc'?'descending':'none')});th.append(b,makeFilter(c))}tr.append(th)}$('head').replaceChildren(tr)}for(const refresh of headRefresh)refresh()}
function renderRows(){renderHead();const rows=table.getRowModel().rows;const body=document.createDocumentFragment();for(const row of rows){const tr=document.createElement('tr');const v=row.original;for(const c of table.getAllLeafColumns()){const td=document.createElement('td');td.dataset.col=c.id;if(c.id==='select'){const e=document.createElement('input');e.type='checkbox';e.setAttribute('aria-label','Select '+(v.role||v.title));e.checked=row.getIsSelected();e.onchange=()=>row.toggleSelected(e.checked);td.append(e)}else if(c.id==='company'||c.id==='role'){const b=cell('button',row.getValue(c.id)||v.title||'—');b.onclick=()=>openPanel(v.id);td.append(b)}else td.textContent=String(row.getValue(c.id)||'—');tr.append(td)}body.append(tr)}$('body').replaceChildren(body);$('empty').hidden=rows.length!==0;$('count').textContent=rows.length+' shown · '+Object.keys(selected).length+' selected'}
async function all(tableId){const out=[];for(let offset=0;;offset+=20){const data=await smartNotesApp.query(tableId,{limit:20,offset});out.push(...data.rows);if(data.rows.length<20)break}return out}
async function load(){try{[postings,views]=await Promise.all([all('postings'),all('views')]);$('error').textContent='';renderViews();sync();if(openId)openPanel(openId)}catch(e){$('error').textContent=e.message}}
function renderViews(){const select=$('views');select.replaceChildren(new Option('All postings',''));for(const v of views)select.add(new Option(v.values.name,v.id));select.value=currentView;$('delete-view').disabled=!currentView}
$('views').onchange=()=>{currentView=$('views').value;const view=views.find(v=>v.id===currentView);try{const s=view?JSON.parse(view.values.state):{};sorting=s.sorting||[];filters=s.filters||[]}catch{sorting=[];filters=[]}renderViews();sync()};
$('save-view').onclick=async()=>{const name=prompt('View name');if(!name?.trim())return;try{const r=await smartNotesApp.add('views',{name:name.trim(),state:JSON.stringify({sorting,filters})});currentView=r.row.id;await load()}catch(e){$('error').textContent=e.message}};
$('delete-view').onclick=async()=>{if(!currentView)return;try{await smartNotesApp.delete('views',currentView);currentView='';await load()}catch(e){$('error').textContent=e.message}};
$('bulk-status').onchange=async()=>{const status=$('bulk-status').value;if(!status)return;try{for(const id of Object.keys(selected)){const row=postings.find(p=>p.id===id);if(row)await smartNotesApp.update('postings',id,{...row.values,status})}selected={};$('bulk-status').value='';await load()}catch(e){$('error').textContent=e.message}};
$('ask-companion').onclick=async()=>{const ids=Object.keys(selected);if(!ids.length){$('error').textContent='Select one or more postings first.';return}try{await smartNotesApp.companion.send({text:'Help me triage these selected Job Inbox postings. Use job_inbox_query for these IDs; you may update status or notes with job_inbox_update when I ask.',payload:{postingIds:ids}})}catch(e){$('error').textContent=e.message}};
function openPanel(id){const row=postings.find(p=>p.id===id);if(!row)return;openId=id;const v=row.values;$('panel').hidden=false;$('panel-title').textContent=[v.company,v.role].filter(Boolean).join(' — ')||v.title;$('panel-source').textContent=v.source+' · '+new Date(row.createdAt).toLocaleDateString()+' · '+(v.enrichmentStatus||'pending');$('panel-link').textContent=v.sourceUrl||'';$('panel-link').href=v.sourceUrl||'#';$('panel-link').hidden=!v.sourceUrl;$('panel-status').value=v.status;$('panel-score').value=v.score??'';$('panel-notes').value=v.notes||'';$('panel-jd').textContent=v.jd||'No description available.';$('application').hidden=!v.applicationId;$('application').textContent=v.applicationId?'Open application: '+(v.applicationPath||v.applicationId):'';$('promote').disabled=!!v.applicationId}
$('close-panel').onclick=()=>{$('panel').hidden=true;openId=null};
$('application').onclick=async()=>{const row=postings.find(p=>p.id===openId);if(!row?.values.applicationId)return;try{await smartNotesApp.jobInbox.openApplication(row.values.applicationId)}catch(e){$('error').textContent=e.message}};
$('save-details').onclick=async()=>{const row=postings.find(p=>p.id===openId);if(!row)return;try{await smartNotesApp.update('postings',row.id,{...row.values,status:$('panel-status').value,score:$('panel-score').value?Number($('panel-score').value):null,notes:$('panel-notes').value});await load()}catch(e){$('error').textContent=e.message}};
$('promote').onclick=async()=>{if(!openId)return;const button=$('promote');button.disabled=true;try{const result=await smartNotesApp.jobInbox.promote(openId,$('run-fit').checked);await load();if(result.warning)$('error').textContent=result.warning}catch(e){$('error').textContent=e.message;button.disabled=false}};
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
