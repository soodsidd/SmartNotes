/**
 * Custom Next.js server for smart-notes.
 * - Hosts the Next app on PORT (default 3002)
 * - Serves the vault folder under /vault/* (static images for pasted assets)
 * - Routes /api/chat/* + Socket.IO to @repo/cli-chat (floating chat bubble)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse } = require('url');
const next = require('next');
const { Server: SocketIOServer } = require('socket.io');
const { createChatModule } = require('@repo/cli-chat');
const {
  loadAgentSettings,
  handleAgentSettingsRequest,
} = require('./server/agent-settings');
const { migrateVaultToHtml } = require('./server/vault-migrate');
const { resolveVaultAssetAbsolutePath } = require('./server/vault-asset-path');
const { resolveVaultRoot } = require('./server/vault-root');
const {
  buildVaultAssetEtag,
  formatHttpDate,
  shouldRespondNotModified,
  parseSingleByteRange,
} = require('./server/vault-asset-http');
const {
  handleJupyterProxyRequest,
  handleJupyterProxyUpgrade,
} = require('./server/jupyter-proxy');
const { startCompanionLogFormBridge } = require('./server/companion-log-form-bridge');
const { createCompanionAppChannel } = require('./server/companion-app-channel');

// AV preview injects NODE_ENV=production for runtimeMode projects while still
// running `npm run dev`. Next dev webpack loaders (next-flight-css-loader) must
// see NODE_ENV=development during compile or global CSS is emitted raw.
if (process.env.npm_lifecycle_event === "dev") {
  process.env.NODE_ENV = "development";
}

const dev =
  process.env.npm_lifecycle_event === "dev" || process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '3002', 10);
// Development servers must never compile into production `.next` (that is what
// `npm run build` / `start:stable` own). Default to `.next-dev`; Playwright E2E
// overrides to `.next-e2e` so release gates cannot wipe a live production bundle.
if (dev && !process.env.SMART_NOTES_NEXT_DIST_DIR) {
  process.env.SMART_NOTES_NEXT_DIST_DIR = ".next-dev";
}
const nextDistDir = process.env.SMART_NOTES_NEXT_DIST_DIR || '.next';

function prepareDevArtifacts() {
  if (!dev) return;

  const cacheLock = acquireDevCacheLock();
  const clearDevCache = process.env.SMART_NOTES_CLEAR_DEV_CACHE === "1";
  if (cacheLock.acquired && clearDevCache) {
    const nextDir = path.join(__dirname, nextDistDir);
    if (fs.existsSync(nextDir)) {
      try {
        fs.rmSync(nextDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        console.log(`[smart-notes] cleared stale ${nextDistDir} cache`);
      } catch (error) {
        console.warn(`[smart-notes] skipped ${nextDistDir} cache clear:`, error);
      }
    }
  } else if (cacheLock.acquired) {
    console.log(`[smart-notes] preserving ${nextDistDir} cache for fast preview restart`);
  } else if (cacheLock.ownerPid) {
    console.log(`[smart-notes] skipped ${nextDistDir} cache clear; dev server ${cacheLock.ownerPid} owns the cache`);
  }

  // E2E sets SMART_NOTES_SKIP_SW_GENERATE=1 so release runs do not rewrite the
  // tracked public/service-worker.js (BUILD_ID stamp) while production is live.
  if (process.env.SMART_NOTES_SKIP_SW_GENERATE !== "1") {
    const sw = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'generate-service-worker.mjs')], {
      cwd: __dirname,
      stdio: 'inherit',
      windowsHide: true,
    });

    if (sw.status !== 0) {
      console.warn('[smart-notes] service worker generation failed; continuing dev startup');
    }
  }

  const fonts = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'sync-pdf-fonts.mjs')], {
    cwd: __dirname,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (fonts.status !== 0) {
    console.warn('[smart-notes] PDF font sync failed; continuing (text PDFs may paint blank)');
  }
}

const devCacheLockPath = path.join(__dirname, '.smart-notes-dev-cache.lock');
let ownsDevCacheLock = false;

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDevCacheLock() {
  try {
    return JSON.parse(fs.readFileSync(devCacheLockPath, 'utf8'));
  } catch {
    return null;
  }
}

function acquireDevCacheLock() {
  while (true) {
    try {
      const fd = fs.openSync(devCacheLockPath, 'wx');
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })
      );
      fs.closeSync(fd);
      ownsDevCacheLock = true;
      return { acquired: true, ownerPid: process.pid };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        console.warn(`[smart-notes] could not acquire ${nextDistDir} cache lock:`, error);
        return { acquired: false, ownerPid: null };
      }

      const lock = readDevCacheLock();
      const ownerPid = Number(lock && lock.pid);
      if (isPidAlive(ownerPid)) {
        return { acquired: false, ownerPid };
      }

      try {
        fs.rmSync(devCacheLockPath, { force: true });
      } catch (removeError) {
        console.warn(`[smart-notes] could not remove stale ${nextDistDir} cache lock:`, removeError);
        return { acquired: false, ownerPid: null };
      }
    }
  }
}

function releaseDevCacheLock() {
  if (!ownsDevCacheLock) return;

  const lock = readDevCacheLock();
  if (Number(lock && lock.pid) === process.pid) {
    try {
      fs.rmSync(devCacheLockPath, { force: true });
    } catch {
      // Nothing actionable during process shutdown.
    }
  }
}

process.once('exit', releaseDevCacheLock);
process.once('SIGINT', () => {
  releaseDevCacheLock();
  process.exit(130);
});
process.once('SIGTERM', () => {
  releaseDevCacheLock();
  process.exit(143);
});

const vaultResolution = resolveVaultRoot({ baseDir: __dirname });
const VAULT_ROOT = vaultResolution.root;
// Force API getVaultRoot() onto the same tree as /vault/* static serving so a
// worktree preview cannot write uploads into one vault while serving from
// another (SN-148 split-brain 404).
process.env.SMART_NOTES_VAULT = VAULT_ROOT;
if (vaultResolution.source === 'primary-repo') {
  console.log(`[smart-notes] using primary-repo vault at ${VAULT_ROOT}`);
} else if (vaultResolution.source === 'e2e-vault') {
  console.log(`[smart-notes] using worktree e2e vault at ${VAULT_ROOT}`);
}
const chatRuntimeDir = process.env.CLI_CHAT_RUNTIME_DIR
  ? path.resolve(process.env.CLI_CHAT_RUNTIME_DIR)
  : path.join(os.homedir(), '.cli-chat', 'dev-workspace', 'smart-notes');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
};

prepareDevArtifacts();

function serveVaultAsset(req, res) {
  // /vault/<Notebook>/<Section>/<Page>.assets/<file>
  // SN-148: emit Content-Length + validators so client cache:"no-cache"
  // can revalidate with 304, percent progress has a total, and future
  // range-aware openers can request byte slices.
  const decoded = decodeURIComponent(parse(req.url).pathname);
  const rel = decoded.replace(/^\/vault\/?/, '');
  const full = resolveVaultAssetAbsolutePath(VAULT_ROOT, rel);
  const allowedRoot = rel.startsWith('+')
    ? resolveVaultAssetAbsolutePath(VAULT_ROOT, rel.split('/')[0])
    : VAULT_ROOT;

  if (!full.startsWith(allowedRoot + path.sep) && full !== allowedRoot) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }

    const etag = buildVaultAssetEtag(st);
    const lastModified = formatHttpDate(st.mtimeMs);
    const ext = path.extname(full).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    // Conditional GET: browser may cache, but must revalidate.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Accept-Ranges', 'bytes');

    if (shouldRespondNotModified(req, { etag, lastModifiedMs: st.mtimeMs })) {
      res.statusCode = 304;
      return res.end();
    }

    const range = parseSingleByteRange(req.headers.range, st.size);
    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(chunkSize));
      return fs.createReadStream(full, { start, end }).pipe(res);
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(st.size));
    fs.createReadStream(full).pipe(res);
  });
}

const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Run migration in the background — it's safe because it only converts legacy
  // .md files and the server can serve existing .html pages immediately.
  migrateVaultToHtml(VAULT_ROOT).catch((error) => {
    console.warn('[smart-notes] vault migration failed:', error);
  });

  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    if (parsedUrl.pathname === '/_dev/screens') {
      parsedUrl.pathname = '/dev-screens';
      req.url = `/dev-screens${parsedUrl.search || ''}`;
    }

    if (parsedUrl.pathname.startsWith('/vault/')) {
      return serveVaultAsset(req, res);
    }

    if (parsedUrl.pathname.startsWith('/api/jupyter/proxy/')) {
      return handleJupyterProxyRequest(req, res);
    }

    if (parsedUrl.pathname === '/api/agent-settings') {
      return handleAgentSettingsRequest(req, res, chatRuntimeDir);
    }

    if (parsedUrl.pathname.startsWith('/api/chat/')) {
      return chat.handleRequest(req, res);
    }

    return handle(req, res, parsedUrl);
  });

  server.on('upgrade', (req, socket, head) => {
    if (handleJupyterProxyUpgrade(req, socket, head)) {
      return;
    }
  });

  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
    path: '/socket.io/'
  });

  // Expose io to Next.js API routes via a process-global so the aiSpliceCommit
  // handler can emit file_updated events for multi-tab synchronisation.
  global._smartNotesIo = io;

  // SN-203: companion→app delivery coordinator. The `app_send` vault tool (running
  // in the Next API route) reads this global to broadcast a companion.deliver
  // request and collect running-instance acks. Ephemeral; nothing is queued.
  const companionAppChannel = createCompanionAppChannel({ io });
  global._smartNotesCompanionAppChannel = companionAppChannel;
  io.on('connection', (socket) => {
    companionAppChannel.attach(socket);
  });

  function getSystemPrompt() {
    return loadAgentSettings(chatRuntimeDir).systemPrompt;
  }

  const workspaceBridgeTools = new Set([
    'workspace_source_list',
    'workspace_source_read',
    'workspace_source_create',
    'workspace_source_edit',
    'workspace_annotations_get',
    'workspace_annotations_put',
  ]);
  const deepWorkBridges = new Map();

  async function invokeCompanionTool(tool, args) {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : 0;
    if (!boundPort) throw new Error('Smart Notes server is not listening.');
    let endpoint = `http://127.0.0.1:${boundPort}/api/agent/vault`;
    let method = 'POST';
    let body = { tool, args };
    if (tool === 'workspace_source_list' || tool === 'workspace_source_read' || tool === 'workspace_annotations_get') {
      const route = tool === 'workspace_annotations_get' ? 'annotations' : 'source';
      const query = new URLSearchParams({ workspace: String(args.workspace || '') });
      if (tool === 'workspace_source_list') {
        query.set('operation', 'list');
        if (args.maxCount !== undefined) query.set('maxCount', String(args.maxCount));
      } else {
        query.set('path', String(args.path || ''));
        if (tool === 'workspace_source_read' && args.maxBytes !== undefined) {
          query.set('maxBytes', String(args.maxBytes));
        }
      }
      endpoint = `http://127.0.0.1:${boundPort}/api/workspace/${route}?${query}`;
      method = 'GET';
      body = undefined;
    } else if (
      tool === 'workspace_source_create' ||
      tool === 'workspace_source_edit' ||
      tool === 'workspace_annotations_put'
    ) {
      endpoint = `http://127.0.0.1:${boundPort}/api/workspace/${
        tool === 'workspace_annotations_put' ? 'annotations' : 'source'
      }`;
      method = tool === 'workspace_source_create' ? 'POST' : 'PUT';
      body = args;
    }
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    return { ok: response.ok, status: response.status, ...payload };
  }

  async function resolveDeepWorkTurn(capability) {
    for (const [token, registeredBridge] of deepWorkBridges) {
      if (registeredBridge.expiresAt <= Date.now()) {
        registeredBridge.bridge.close();
        deepWorkBridges.delete(token);
      }
    }
    const record = global.__smartNotesDeepWorkCapabilities__?.get(capability);
    if (!record || record.expiresAt <= Date.now()) return null;
    let registered = deepWorkBridges.get(capability);
    if (!registered) {
      const capabilityHash = crypto.createHash('sha256').update(capability).digest('hex');
      const bridge = startCompanionLogFormBridge({
        rootDir: path.join(__dirname, '.smart-notes-companion-log-form-bridge', 'deep-work', capabilityHash),
        invokeTool: invokeCompanionTool,
        allowedTools: workspaceBridgeTools,
        authorizeTool: (_tool, args) => args.workspace === capability,
      });
      registered = { bridge, expiresAt: record.expiresAt };
      deepWorkBridges.set(capability, registered);
    }
    const ready = await registered.bridge.ready;
    const rootHash = crypto.createHash('sha256').update(record.realRoot).digest('hex').slice(0, 32);
    return {
      scopeKey: `deep-work:${rootHash}`,
      workingDirectory: __dirname,
      companionBridgeRoot: ready.rootDir,
    };
  }

  const chat = createChatModule(server, io, {
    workingDirectory: __dirname,
    uploadDir: chatRuntimeDir,
    stateDir: chatRuntimeDir,
    sandbox: 'editor',
    // Resolved lazily after listen so port 0 / AV dynamic previews propagate
    // the actual bound port to companion guidance and provider child env.
    boundPort: () => {
      const address = server.address();
      return address && typeof address === 'object' ? address.port : 0;
    },
    resolveDeepWorkTurn,
    systemPrompt: getSystemPrompt,
    welcomeMessage:
      'Hi! Ask me about your notes. Vault writes save on disk immediately; click Reload in the editor to view updates.'
  });

  server.listen(port, hostname, () => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : port;
    global._smartNotesListenPort = boundPort;
    console.log(`\n  Smart Notes — http://${hostname}:${boundPort}`);
    console.log(`  Vault       — ${VAULT_ROOT}`);
    console.log(`  Chat API    — /api/chat/* (sandbox: ${JSON.stringify(chat.getSandboxConfig())})\n`);

    const bridge = startCompanionLogFormBridge({
      rootDir: path.join(__dirname, '.smart-notes-companion-log-form-bridge'),
      invokeTool: invokeCompanionTool,
    });
    bridge.ready
      .then(() => console.log('  Companion vault bridge — ready'))
      .catch((error) => console.warn('[smart-notes] companion vault bridge unavailable:', error));
  });
}).catch((err) => {
  console.error('[smart-notes] next prepare failed:', err);
  process.exit(1);
});
