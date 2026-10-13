// Seeds an isolated SN-294 fixture vault (.e2e-vault) mirroring fork photos #5/#6.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:')), '..', '..');
const vault = path.join(root, '.e2e-vault');
const state = path.join(root, '.e2e-state');
const paperId = '5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41';
const stamp = '2026-10-12T18:00:00Z';
const fm = (data) => `---\n${Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const reference = `<div data-paper-id="${paperId}" data-type="paper-reference"></div>`;

await fs.rm(vault, { recursive: true, force: true });
await fs.rm(state, { recursive: true, force: true });
await fs.mkdir(path.join(vault, '.bibliography'), { recursive: true });
await fs.mkdir(path.join(vault, 'General', 'Precision Engineering'), { recursive: true });
await fs.mkdir(path.join(vault, 'General', 'Metrology'), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.writeFile(path.join(vault, '.bibliography', `${paperId}.html`), fm({ title: 'deviation', paper_id: paperId, paper_home_notebook: 'General', note_type: 'text', created: stamp, updated: stamp })
  + '<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="/vault/.bibliography/cat--interferoMETER--en-us.pdf">cat--interferoMETER--en-us.pdf</span></span></p>');
await fs.writeFile(path.join(vault, 'General', 'Precision Engineering', 'Test.html'), fm({ title: 'Test', created: stamp, updated: stamp }) + `${reference}<p></p>`);
await fs.writeFile(path.join(vault, 'General', 'Metrology', 'Other reference.html'), fm({ title: 'Other reference', created: stamp, updated: stamp }) + `<p>Second referring page.</p>${reference}<p></p>`);
console.log(`Seeded ${vault} and ${state}`);
