const http = require('http');
const fs = require('fs');
const path = require('path');
const { parse } = require('url');
const {
  JUPYTER_FOCUS_BRIDGE_SOURCE,
  injectFocusBridge,
  isBridgeRequest,
} = require('./jupyter-focus-bridge');

const REGISTRY_KEY = '__smartNotesJupyterSessions__';
const PROXY_PREFIX = '/api/jupyter/proxy/';

function parseProxyRequestUrl(url) {
  const parsed = parse(url || '');
  const pathname = parsed.pathname || '';
  if (!pathname.startsWith(PROXY_PREFIX)) {
    return null;
  }

  const remainder = pathname.slice(PROXY_PREFIX.length);
  const slashIndex = remainder.indexOf('/');
  const encodedProxyId = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
  if (!encodedProxyId) {
    return null;
  }

  try {
    return {
      proxyId: decodeURIComponent(encodedProxyId),
      pathname,
    };
  } catch {
    return null;
  }
}

function getRegistry() {
  const registry = global[REGISTRY_KEY];
  return registry instanceof Map ? registry : null;
}

function getProxySession(proxyId) {
  const registry = getRegistry();
  if (!registry) {
    return null;
  }

  for (const session of registry.values()) {
    if (session && session.proxyId === proxyId && session.status !== 'stopped') {
      return session;
    }
  }

  return null;
}

function proxyHeaders(req, session) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${session.port}`,
  };

  // Preserve the browser-visible host for Jupyter reverse-proxy awareness so
  // absolute asset/websocket hints follow Tailscale/LAN origins instead of the
  // private loopback port (which mobile clients cannot dial).
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host;
  if (forwardedHost) {
    headers["x-forwarded-host"] = forwardedHost;
  }
  if (!headers["x-forwarded-proto"]) {
    headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  }

  return headers;
}

function proxyHeadersForRequest(req, session, pathname) {
  const headers = proxyHeaders(req, session);
  const labRoot = `${session.proxyBasePath}lab`;
  if (pathname === labRoot || pathname.startsWith(`${labRoot}/`)) {
    // The Lab shell HTML must be decoded so the proxy can add the bridge tag.
    // Assets and API traffic retain normal browser compression negotiation.
    delete headers['accept-encoding'];
  }
  return headers;
}

function rewriteResponseHeaders(headers, session) {
  const nextHeaders = { ...headers };
  const location = nextHeaders.location;
  if (typeof location === 'string') {
    try {
      const resolved = new URL(location, session.baseUrl);
      if (resolved.origin === session.baseUrl) {
        nextHeaders.location = `${resolved.pathname}${resolved.search}`;
      }
    } catch {
      // Preserve malformed upstream headers verbatim.
    }
  }
  return nextHeaders;
}

// SN-256: project-backed workspaces opened read-only (default-branch access,
// or an explicit non-editable request) must not accept writes through the
// proxy even though JupyterLab's own UI would otherwise offer Save/rename/
// delete/new-file/new-terminal actions. This does not attempt to sandbox code
// a kernel or an already-open terminal executes (those run with host
// privileges by design — see docs/plans/project-backed-jupyterlab-deep-work.md);
// it blocks the JupyterLab-mediated write surfaces Smart Notes proxies.
const WRITE_METHODS = new Set(['PUT', 'POST', 'PATCH', 'DELETE']);
const CONTENTS_API_PATTERN = /\/api\/contents(\/|\?|$)/;
const TERMINALS_API_PATTERN = /\/api\/terminals(\/|\?|$)/;
const TERMINALS_WEBSOCKET_PATTERN = /\/terminals\/websocket\//;

function isBlockedReadOnlyRequest(session, method, pathname) {
  if (session.accessMode !== 'read-only') {
    return false;
  }
  if (!WRITE_METHODS.has(method)) {
    return false;
  }
  return CONTENTS_API_PATTERN.test(pathname) || TERMINALS_API_PATTERN.test(pathname);
}

function isBlockedReadOnlyUpgrade(session, pathname) {
  return session.accessMode === 'read-only' && TERMINALS_WEBSOCKET_PATTERN.test(pathname);
}

const CONTENTS_API_PREFIX = '/api/contents';

/**
 * Split the Contents API path (everything after `/api/contents`) into raw
 * filesystem segments, decoding each one. Returns null when the pathname
 * isn't a Contents API request, and [] for the workspace root itself.
 */
function contentsApiSegments(pathname) {
  const withoutQuery = pathname.split('?')[0];
  const markerIndex = withoutQuery.indexOf(CONTENTS_API_PREFIX);
  if (markerIndex === -1) {
    return null;
  }
  const remainder = withoutQuery.slice(markerIndex + CONTENTS_API_PREFIX.length).replace(/^\/+/, '');
  if (!remainder) {
    return [];
  }
  return remainder.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

/**
 * SN-256 residual-risk guard: root-level registration/containment only
 * validates the workspace root itself (see src/server/jupyter/workspace-
 * root.ts). A file *inside* an otherwise-valid project workspace can still be
 * a symlink pointing outside it — e.g. a worktree containing
 * `escape -> C:\Users\<user>\.ssh` — which JupyterLab's Contents API would
 * otherwise happily read or (on an editable workspace) write through. Every
 * Contents API path is walked segment-by-segment from the session's real
 * root and rejected if any segment is a symlink, mirroring the root
 * containment check rather than trusting the OS to sandbox it. Applies to
 * project-backed workspaces only (note-owned `.jupyter` folders are
 * vault-managed content, not an arbitrary host directory).
 */
function isContentsPathSymlinkEscape(session, pathname) {
  if (session.kind !== 'project') {
    return false;
  }
  const segments = contentsApiSegments(pathname);
  if (!segments || segments.length === 0) {
    return false;
  }
  // Reject traversal segments outright, plus any segment that decodes to
  // contain a path separator at all (e.g. a double-encoded `%2F`/`%5C`
  // smuggled past the literal-`/` split above) — no legitimate Contents API
  // filename decodes to one, so this only catches escape attempts.
  if (
    segments.some(
      (segment) => segment === '..' || segment === '.' || segment.includes('/') || segment.includes('\\')
    )
  ) {
    return true;
  }
  let walked = session.folder;
  for (const segment of segments) {
    walked = path.join(walked, segment);
    let stat;
    try {
      stat = fs.lstatSync(walked);
    } catch {
      // Not on disk yet (e.g. a new file/folder about to be created via
      // POST/PUT) — nothing to inspect for a symlink escape.
      return false;
    }
    if (stat.isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

function sendProxyError(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

function sendFocusBridge(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(JUPYTER_FOCUS_BRIDGE_SOURCE));
  res.end(JUPYTER_FOCUS_BRIDGE_SOURCE);
}

function writeInjectedLabResponse(res, proxyRes, session) {
  const chunks = [];
  proxyRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  proxyRes.on('end', () => {
    const html = Buffer.concat(chunks).toString('utf8');
    const body = Buffer.from(injectFocusBridge(html, session), 'utf8');
    const headers = rewriteResponseHeaders(proxyRes.headers, session);
    delete headers['content-encoding'];
    delete headers['content-length'];
    delete headers.etag;
    headers['cache-control'] = 'no-store';
    headers['content-length'] = String(body.length);
    res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, headers);
    res.end(body);
  });
}

function handleJupyterProxyRequest(req, res) {
  const parsed = parseProxyRequestUrl(req.url);
  if (!parsed) {
    return false;
  }

  const session = getProxySession(parsed.proxyId);
  if (!session || session.status !== 'ready') {
    sendProxyError(res, 502, 'Jupyter proxy session is not available.');
    return true;
  }

  if (isBlockedReadOnlyRequest(session, req.method, parsed.pathname)) {
    sendProxyError(res, 403, 'This Ascent Vector workspace is read-only. File and terminal writes are disabled.');
    return true;
  }

  if (isContentsPathSymlinkEscape(session, parsed.pathname)) {
    sendProxyError(res, 403, 'This path escapes the workspace root through a symlink and cannot be opened.');
    return true;
  }

  if (req.method === 'GET' && isBridgeRequest(parsed.pathname, session)) {
    sendFocusBridge(res);
    return true;
  }

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: session.port,
      method: req.method,
      path: req.url,
      headers: proxyHeadersForRequest(req, session, parsed.pathname),
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers['content-type'] || '').toLowerCase();
      const contentEncoding = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
      if (
        req.method === 'GET' &&
        (proxyRes.statusCode || 0) >= 200 &&
        (proxyRes.statusCode || 0) < 300 &&
        contentType.includes('text/html') &&
        (!contentEncoding || contentEncoding === 'identity')
      ) {
        writeInjectedLabResponse(res, proxyRes, session);
        return;
      }
      res.writeHead(
        proxyRes.statusCode || 502,
        proxyRes.statusMessage,
        rewriteResponseHeaders(proxyRes.headers, session)
      );
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      sendProxyError(res, 502, 'Jupyter proxy request failed.');
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
  return true;
}

function writeUpgradeError(socket, statusCode, message) {
  if (socket.destroyed) {
    return;
  }
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
  socket.destroy();
}

function handleJupyterProxyUpgrade(req, socket, head) {
  const parsed = parseProxyRequestUrl(req.url);
  if (!parsed) {
    return false;
  }

  const session = getProxySession(parsed.proxyId);
  if (!session || session.status !== 'ready') {
    writeUpgradeError(socket, 502, 'Bad Gateway');
    return true;
  }

  if (isBlockedReadOnlyUpgrade(session, parsed.pathname)) {
    writeUpgradeError(socket, 403, 'Forbidden');
    return true;
  }

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: session.port,
    method: req.method,
    path: req.url,
    headers: proxyHeaders(req, session),
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const headers = Object.entries(rewriteResponseHeaders(proxyRes.headers, session))
      .flatMap(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map((entry) => `${key}: ${entry}`);
        }
        return value == null ? [] : [`${key}: ${value}`];
      })
      .join('\r\n');

    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n${headers}\r\n\r\n`
    );
    if (proxyHead?.length) {
      socket.write(proxyHead);
    }
    if (head?.length) {
      proxySocket.write(head);
    }
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('response', (proxyRes) => {
    writeUpgradeError(socket, proxyRes.statusCode || 502, proxyRes.statusMessage || 'Bad Gateway');
  });

  proxyReq.on('error', () => {
    writeUpgradeError(socket, 502, 'Bad Gateway');
  });

  proxyReq.end();
  return true;
}

module.exports = {
  PROXY_PREFIX,
  getProxySession,
  handleJupyterProxyRequest,
  handleJupyterProxyUpgrade,
  isBlockedReadOnlyRequest,
  isBlockedReadOnlyUpgrade,
  isContentsPathSymlinkEscape,
  parseProxyRequestUrl,
  rewriteResponseHeaders,
  proxyHeadersForRequest,
};
