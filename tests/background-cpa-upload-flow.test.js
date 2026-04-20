const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadModule() {
  const source = fs.readFileSync('background/cpa-upload-flow.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundCpaUploadFlow;`)(globalScope);
}

test('background imports cpa upload flow module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /importScripts\([\s\S]*'background\/cpa-upload-flow\.js'/);
});

test('cpa upload flow runs steps 7 through 10 and clears runtime flag', async () => {
  const api = loadModule();
  assert.equal(typeof api?.createCpaUploadFlow, 'function');

  const calls = [];
  let state = {
    panelMode: 'cpa',
    vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
    vpsPassword: 'key',
    cpaUploadAccountsText: 'user@example.com----codex-secret----mail-secret',
  };

  const flow = api.createCpaUploadFlow({
    addLog: async (message, level = 'info') => calls.push(['log', message, level]),
    executeStepAndWait: async (step, delayAfter) => calls.push(['step', step, delayAfter]),
    getPanelMode: (nextState) => nextState.panelMode,
    getState: async () => state,
    setEmailState: async (email) => {
      state = { ...state, email };
      calls.push(['email', email]);
    },
    setState: async (updates) => {
      state = { ...state, ...updates };
      calls.push(['state', updates]);
    },
    setStepStatus: async (step, status) => calls.push(['status', step, status]),
    throwIfStopped: () => {},
  });

  const result = await flow.runCpaUpload();

  assert.deepEqual(result, {
    ok: true,
    total: 1,
    success: ['user@example.com'],
    failed: [],
  });
  assert.deepEqual(
    calls.filter((call) => call[0] === 'step').map((call) => call.slice(1)),
    [[7, 1200], [8, 1200], [9, 1200], [10, 0]]
  );
  assert.equal(state.cpaUploadRunning, false);
  assert.equal(state.oauthFlowDeadlineAt, null);
  assert.equal(state.email, 'user@example.com');
  assert.equal(state.password, 'codex-secret');
  assert.equal(state.mailProvider, 'ms-lqqq');
  assert.equal(state.msLqqqMailPassword, 'mail-secret');
  assert.match(state.msLqqqMailUrl, /^https:\/\/ms\.lqqq\.cc\/web\/user@example\.com----mail-secret$/);
});

test('cpa upload flow requires cpa mode and credentials', async () => {
  const api = loadModule();
  const flow = api.createCpaUploadFlow({
    getPanelMode: () => 'sub2api',
    getState: async () => ({
      panelMode: 'sub2api',
      vpsUrl: '',
      vpsPassword: '',
      email: '',
      customPassword: '',
    }),
  });

  await assert.rejects(
    () => flow.runCpaUpload(),
    /只支持 CPA 面板模式/
  );
});

test('cpa upload flow parses multiple account lines', () => {
  const api = loadModule();
  const flow = api.createCpaUploadFlow();
  const accounts = flow.parseCpaUploadAccountsText(`
user1@example.com----pass1----mail1

user2@example.com----pass2----mail2
`);

  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].email, 'user1@example.com');
  assert.equal(accounts[0].password, 'pass1');
  assert.equal(accounts[0].mailPassword, 'mail1');
  assert.equal(accounts[1].lineNumber, 4);
});

test('cpa upload flow accepts and ignores fourth refresh token field', () => {
  const api = loadModule();
  const flow = api.createCpaUploadFlow();
  const [account] = flow.parseCpaUploadAccountsText(
    'user@example.com----codex-pass----mail-pass----rt_should_be_ignored'
  );

  assert.equal(account.email, 'user@example.com');
  assert.equal(account.password, 'codex-pass');
  assert.equal(account.mailPassword, 'mail-pass');
  assert.equal(account.refreshToken, undefined);
  assert.equal(account.mailUrl, 'https://ms.lqqq.cc/web/user@example.com----mail-pass');
});

test('cpa upload flow continues after a failed line', async () => {
  const api = loadModule();
  const calls = [];
  let state = {
    panelMode: 'cpa',
    vpsUrl: 'http://127.0.0.1:8317/management.html#/oauth',
    vpsPassword: 'key',
    cpaUploadAccountsText: [
      'fail@example.com----pass1----mail1',
      'ok@example.com----pass2----mail2',
    ].join('\n'),
  };

  const flow = api.createCpaUploadFlow({
    addLog: async () => {},
    executeStepAndWait: async (step) => {
      calls.push([state.email, step]);
      if (state.email === 'fail@example.com' && step === 8) {
        throw new Error('验证码失败');
      }
    },
    getPanelMode: (nextState) => nextState.panelMode,
    getState: async () => state,
    setEmailState: async (email) => {
      state = { ...state, email };
    },
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    setStepStatus: async () => {},
    throwIfStopped: () => {},
  });

  const result = await flow.runCpaUpload();

  assert.equal(result.ok, false);
  assert.deepEqual(result.success, ['ok@example.com']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].email, 'fail@example.com');
  assert.deepEqual(calls, [
    ['fail@example.com', 7],
    ['fail@example.com', 8],
    ['ok@example.com', 7],
    ['ok@example.com', 8],
    ['ok@example.com', 9],
    ['ok@example.com', 10],
  ]);
});
