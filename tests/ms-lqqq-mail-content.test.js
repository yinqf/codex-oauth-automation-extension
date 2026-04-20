const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadModule() {
  const source = fs.readFileSync('content/ms-lqqq-mail.js', 'utf8');
  const globalScope = {
    console,
    location: { href: 'https://ms.lqqq.cc/web/user@example.com----mailpass' },
  };
  return new Function(
    'self',
    'location',
    `${source}; return self.MultiPageMsLqqqMail;`
  )(globalScope, globalScope.location);
}

test('ms.lqqq mail content extracts OpenAI and ChatGPT verification codes', () => {
  const api = loadModule();

  assert.equal(api.extractVerificationCode('你的 OpenAI 代码为 380541'), '380541');
  assert.equal(api.extractVerificationCode('Your ChatGPT code is 464086'), '464086');
  assert.equal(api.extractVerificationCode('code: 123456'), '123456');
});

test('ms.lqqq mail content parses timestamp text', () => {
  const api = loadModule();
  const timestamp = api.parseMailTimestamp('2026-04-14 22:30:36');
  const date = new Date(timestamp);

  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 3);
  assert.equal(date.getDate(), 14);
  assert.equal(date.getHours(), 22);
  assert.equal(date.getMinutes(), 30);
  assert.equal(date.getSeconds(), 36);
});
