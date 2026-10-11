const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('the lyrics CLI is a directly executable Unix launcher', { skip: process.platform === 'win32' }, () => {
  const cli = path.join(__dirname, '..', 'cli.js');
  assert.equal(fs.readFileSync(cli, 'utf8').split('\n')[0], '#!/usr/bin/env node');
  const result = spawnSync(cli, [], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: riff lyrics/);
});
