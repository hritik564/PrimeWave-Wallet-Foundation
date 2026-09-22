const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveStaticFilePath } = require('./serve.js');

function withStaticRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-static-test-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'index.js'), 'ok');
  fs.writeFileSync(path.join(root, 'nested', 'file.js'), 'nested');
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('static path resolution serves normal and nested files', () => {
  withStaticRoot((root) => {
    assert.equal(
      resolveStaticFilePath(root, '/index.js'),
      path.join(root, 'index.js'),
    );
    assert.equal(
      resolveStaticFilePath(root, '/nested/file.js'),
      path.join(root, 'nested', 'file.js'),
    );
  });
});

test('static path resolution rejects traversal, encoded traversal, and sibling escapes', () => {
  withStaticRoot((root) => {
    const sibling = `${root}-sibling`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'file.js'), 'sibling');
    assert.equal(resolveStaticFilePath(root, '/../secret'), null);
    assert.equal(resolveStaticFilePath(root, '/%2e%2e/secret'), null);
    assert.equal(
      resolveStaticFilePath(root, `/../${path.basename(sibling)}/file.js`),
      null,
    );
    assert.equal(
      resolveStaticFilePath(root, '/etc/passwd'),
      path.join(root, 'etc', 'passwd'),
    );
    fs.rmSync(sibling, { recursive: true, force: true });
  });
});

test('static path resolution rejects symlink escapes when supported', (t) => {
  withStaticRoot((root) => {
    const link = path.join(root, 'outside');
    try {
      fs.symlinkSync('/etc', link, 'dir');
    } catch {
      t.skip('symlinks are not available in this test environment');
      return;
    }
    assert.equal(resolveStaticFilePath(root, '/outside/passwd'), null);
  });
});