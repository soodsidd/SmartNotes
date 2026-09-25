const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function makeBootId() {
  return `${Date.now().toString(36)}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

function safeJsonStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, function replacer(key, current) {
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function') return `[Function ${current.name || 'anonymous'}]`;
    if (typeof current === 'symbol') return String(current);
    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        stack: current.stack,
      };
    }
    if (current && typeof current === 'object') {
      if (seen.has(current)) return '[Circular]';
      seen.add(current);
    }
    return current;
  });
}

function rotateIfTooLarge(filePath, maxBytes) {
  try {
    if (!fs.existsSync(filePath)) return;
    const size = fs.statSync(filePath).size;
    if (size <= maxBytes) return;
    const ext = path.extname(filePath) || '.log';
    const base = filePath.slice(0, filePath.length - ext.length);
    const rotated = `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;
    fs.renameSync(filePath, rotated);
  } catch {
    // best effort
  }
}

function createTraceLogger(options = {}) {
  const dir = path.resolve(options.dir || process.cwd());
  const filePath = path.resolve(options.filePath || path.join(dir, options.fileName || 'chat-trace.jsonl'));
  const bootId = String(options.bootId || makeBootId());
  const component = String(options.component || 'trace');
  const baseFields = options.baseFields && typeof options.baseFields === 'object'
    ? { ...options.baseFields }
    : {};
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? Math.floor(options.maxBytes)
    : DEFAULT_MAX_BYTES;

  ensureDir(path.dirname(filePath));

  function writeLine(record) {
    rotateIfTooLarge(filePath, maxBytes);
    fs.appendFileSync(filePath, `${safeJsonStringify(record)}\n`, 'utf8');
  }

  function log(event, fields = {}) {
    const record = {
      ts: new Date().toISOString(),
      boot_id: bootId,
      pid: process.pid,
      component,
      event: String(event || 'event'),
      ...baseFields,
      ...(fields && typeof fields === 'object' ? fields : { value: fields }),
    };
    writeLine(record);
    return record;
  }

  return {
    log,
    child(childFields = {}, overrides = {}) {
      return createTraceLogger({
        dir,
        filePath,
        bootId,
        component: overrides.component || component,
        maxBytes,
        baseFields: {
          ...baseFields,
          ...(childFields && typeof childFields === 'object' ? childFields : {}),
        },
      });
    },
    getBootId() {
      return bootId;
    },
    getFilePath() {
      return filePath;
    },
  };
}

module.exports = {
  createTraceLogger,
};