// SN-363 manual Lab walkthrough (Fast, Slow, Edit) against an isolated dev server with real JupyterLab.
// Usage: start `node server.js` (NODE_ENV=development, SMART_NOTES_VAULT=<wt>/.e2e-vault) then
// `SN363_BASE=http://127.0.0.1:3263 node e2e/evidence/SN-363/walkthrough.cjs`.
const { chromium } = require('../../../node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.SN363_BASE || 'http://127.0.0.1:3263';
const root = path.resolve(__dirname, '../../..');
const evidence = __dirname;
const title = 'SN-363 Lab';
const pagePath = `Personal Notebook/Quick Notes/${title}.html`;
const vaultPage = path.join(root, '.e2e-vault', ...pagePath.split('/'));
const workDir = vaultPage.replace(/\.html$/, '.jupyter');
const captured = [];
const answers = ['Answer 1: sum adds the list.', 'Answer 2: totals values.', 'sum(v for v in values)', '# total of values'];

function seed() {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(vaultPage, `---\ntitle: ${title}\nnote_type: jupyter\n---\n`, 'utf8');
  fs.writeFileSync(path.join(workDir, 'notebook.ipynb'), JSON.stringify({
    nbformat: 4, nbformat_minor: 5,
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
    cells: [
      { cell_type: 'markdown', id: 'md-0', metadata: {}, source: ['# Load data'] },
      { cell_type: 'code', id: 'code-1', metadata: {}, execution_count: null, outputs: [], source: ['values = [1, 2, 3]\n', 'total = sum(values)'] },
    ],
  }), 'utf8');
}

async function main() {
  seed();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  page.on('pageerror', (error) => console.log('pageerror:', error.message, String(error.stack || '').split(String.fromCharCode(10)).slice(0, 4).join(' | ')));
  try {
    await page.route('**/api/chat/send', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      captured.push(body);
      const answer = answers[captured.length - 1] ?? `Answer ${captured.length}`;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turn_id: body.turn_id }) });
      setTimeout(() => void page.evaluate(({ turnId, answer }) => {
        const bridge = window.__testChatBridge;
        bridge?.injectChatEvent({ turn_id: turnId, seq: 0, type: 'token', payload: { text: answer.slice(0, 6) } });
        bridge?.injectChatEvent({ turn_id: turnId, seq: 1, type: 'token', payload: { text: answer.slice(6) } });
        bridge?.injectChatEvent({ turn_id: turnId, seq: 2, type: 'done', payload: { status: 'completed' } });
      }, { turnId: body.turn_id, answer }).catch(console.error), 400);
    });
    await page.goto(`${base}/?page=${encodeURIComponent(pagePath)}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const frame = page.frameLocator(`iframe[title="Jupyter notebook: ${title}"]`);
    const code = frame.locator('.jp-CodeCell .cm-content').first();
    await code.waitFor({ timeout: 180000 });
    await page.waitForTimeout(2000);
    const popup = page.getByTestId('ask-companion-popover');

    async function selectSum() {
      await code.locator('.cm-line').nth(1).click();
      await code.press('End');
      for (let i = 0; i < 'sum(values)'.length; i++) await code.press('Shift+ArrowLeft');
      await page.getByTestId('jupyter-inline-ai-overlay').waitFor({ timeout: 20000 });
      await page.getByTestId('jupyter-inline-ask').click();
      await popup.waitFor();
    }
    async function openSidebarAndCheck(text) {
      await popup.getByRole('button', { name: 'Open in Companion →' }).click();
      await page.getByText(text).last().waitFor({ timeout: 30000 });
    }

    // Fast (default): Explain the selection.
    await selectSum();
    console.log('Popover snippet:', await popup.locator('blockquote').innerText(), '| target:', await popup.locator('.inline-ai-target').innerText());
    console.log('Fast default:', await popup.getByRole('button', { name: 'Fast' }).getAttribute('aria-pressed'));
    await popup.getByRole('button', { name: 'Explain' }).click();
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText(answers[0]).waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(evidence, 'fast.png') });
    await openSidebarAndCheck(answers[0]);
    await page.screenshot({ path: path.join(evidence, 'fast-sidebar.png') });

    // Slow: Summarize the same selection.
    await selectSum();
    await popup.getByRole('button', { name: 'Slow' }).click();
    await popup.getByRole('button', { name: 'Summarize' }).click();
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText(answers[1]).waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(evidence, 'slow.png') });
    await openSidebarAndCheck(answers[1]);
    console.log('Fast + Slow answers both in the one sidebar transcript:',
      await page.getByText(answers[0]).count() > 0, await page.getByText(answers[1]).count() > 0);
    await page.screenshot({ path: path.join(evidence, 'slow-sidebar.png') });

    // Edit: replace the live selection.
    await selectSum();
    await popup.getByRole('button', { name: 'Edit' }).click();
    await popup.getByRole('textbox').fill('Use a generator expression');
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText('Inserted into the page.').waitFor({ timeout: 30000 });
    console.log('Cell after Edit (replace selection):', JSON.stringify(await code.innerText()));
    await page.screenshot({ path: path.join(evidence, 'edit-selection.png') });
    await popup.getByRole('button', { name: 'Close Companion popover' }).click();

    // Edit: insert at the caret via SN-249 Alt+Right-click (no selection).
    console.log('Lab frame width:', await page.locator(`iframe[title="Jupyter notebook: ${title}"]`).evaluate((el) => el.getBoundingClientRect().width));
    await code.locator('.cm-line').nth(0).click();
    await code.press('End');
    const line = await code.locator('.cm-line').nth(0).boundingBox();
    await code.locator('.cm-line').nth(0).click({ button: 'right', modifiers: ['Alt'], position: { x: Math.max(4, line.width - 4), y: line.height / 2 } });
    await page.getByTestId('jupyter-inline-ai-overlay').waitFor({ timeout: 20000 });
    await page.getByTestId('jupyter-inline-ask').click();
    await popup.waitFor();
    console.log('Caret target:', await popup.locator('.inline-ai-target').innerText());
    await popup.getByRole('button', { name: 'Edit' }).click();
    await popup.getByRole('textbox').fill('Add a short comment');
    await popup.getByRole('button', { name: 'Ask', exact: true }).click();
    await popup.getByText('Inserted into the page.').waitFor({ timeout: 30000 });
    console.log('Cell after Edit (insert at caret):', JSON.stringify(await code.innerText()));
    await page.screenshot({ path: path.join(evidence, 'edit-caret.png') });

    console.log('Requests:', JSON.stringify(captured.map((body) => ({
      provider: body.provider ?? body.providerId, model: body.model, thread: body.thread_key ?? body.threadKey,
      jupyterSurface: body.message?.includes('"surface":"jupyter"'),
      snippet: body.message?.includes('sum(values)'), cellWindow: body.message?.includes('# Cell 1 (markdown)'),
      edit: body.message?.includes('Edit mode:'),
    })), null, 1));
    console.log('Request keys:', Object.keys(captured[0] || {}).join(','));
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
