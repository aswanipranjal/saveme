const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../extension/options.js'), 'utf8');

async function checkConnection(responses) {
  const elements = new Map();
  const values = { pat: 'test-token', owner: 'owner', repo: 'repo', branch: 'feature/bookmarks', 'file-path': 'bookmarks.json' };
  const calls = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        value: values[id] || '', disabled: false,
        addEventListener(event, handler) { this[event] = handler; },
      });
      return elements.get(id);
    },
  };
  vm.runInNewContext(source, {
    document, chrome: { storage: { sync: { get: async () => ({}) } } },
    setTimeout() {},
    async fetch(url, options) {
      calls.push({ url, options });
      const response = responses[calls.length - 1];
      assert.ok(response, 'Unexpected API request');
      if (response instanceof Error) throw response;
      return { ok: response.status >= 200 && response.status < 300, ...response,
        json: async () => response.body || {} };
    },
  });
  await document.getElementById('test-btn').click();
  assert.equal(document.getElementById('test-btn').disabled, false);
  return { calls, status: document.getElementById('status') };
}

test('success requires a real Contents write probe, with no file or commit update', async () => {
  const { calls, status } = await checkConnection([{ status: 200 }, { status: 200 }, { status: 201 }]);
  assert.equal(status.className, 'ok');
  assert.match(status.textContent, /write access verified/);
  assert.match(calls[1].url, /branches\/feature%2Fbookmarks$/);
  assert.equal(calls[2].url, 'https://api.github.com/repos/owner/repo/git/blobs');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    content: 'File Bookmarks write-access check\n', encoding: 'utf-8',
  });
});

test('read-only token fails even when repository permissions report push access', async () => {
  const { status } = await checkConnection([
    { status: 200, body: { permissions: { push: true } } },
    { status: 200 },
    { status: 403, body: { message: 'Resource not accessible by personal access token' } },
  ]);
  assert.equal(status.className, 'err');
  assert.match(status.textContent, /Contents: read & write/);
});

for (const code of [404, 409, 422, 429, 500]) {
  test(`write probe ${code} cannot produce a success`, async () => {
    const { status } = await checkConnection([{ status: 200 }, { status: 200 }, { status: code }]);
    assert.equal(status.className, 'err');
    assert.match(status.textContent, new RegExp(`Write access not verified \\(${code}\\)`));
  });
}

test('invalid authentication stops before the write probe', async () => {
  const { calls, status } = await checkConnection([{ status: 401 }]);
  assert.equal(calls.length, 1);
  assert.match(status.textContent, /Auth failed/);
});

test('missing branch stops before the write probe', async () => {
  const { calls, status } = await checkConnection([{ status: 200 }, { status: 404 }]);
  assert.equal(calls.length, 2);
  assert.match(status.textContent, /Branch .* not found/);
});

test('network failure during the probe restores the button and reports failure', async () => {
  const { status } = await checkConnection([{ status: 200 }, { status: 200 }, new Error('Failed to fetch')]);
  assert.equal(status.className, 'err');
  assert.match(status.textContent, /Network error/);
});
