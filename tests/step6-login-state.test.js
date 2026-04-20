const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

const bundle = [
  extractFunction('inspectLoginAuthState'),
  extractFunction('normalizeStep6Snapshot'),
].join('\n');

function createApi(overrides = {}) {
  return new Function(`
const location = {
  href: ${JSON.stringify(overrides.href || 'https://auth.openai.com/log-in')},
  pathname: ${JSON.stringify(overrides.pathname || '/log-in')},
};

function getLoginTimeoutErrorPageState() {
  return ${JSON.stringify(overrides.retryState || null)};
}

function getVerificationCodeTarget() {
  return ${JSON.stringify(overrides.verificationTarget || null)};
}

function getLoginPasswordInput() {
  return ${JSON.stringify(overrides.passwordInput || null)};
}

function getLoginEmailInput() {
  return ${JSON.stringify(overrides.emailInput || null)};
}

function findOneTimeCodeLoginTrigger() {
  return ${JSON.stringify(overrides.switchTrigger || null)};
}

function getLoginSubmitButton() {
  return ${JSON.stringify(overrides.submitButton || null)};
}

function getPageTextSnapshot() {
  return ${JSON.stringify(overrides.pageText || '')};
}

function getEmailsFromText(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((email) => email.trim().toLowerCase()).filter(Boolean)));
}

function isVerificationPageStillVisible() {
  return ${JSON.stringify(Boolean(overrides.verificationVisible))};
}

function isAddPhonePageReady() {
  return ${JSON.stringify(Boolean(overrides.addPhonePage))};
}

function isStep8Ready() {
  return ${JSON.stringify(Boolean(overrides.consentReady))};
}

function isOAuthConsentPage() {
  return ${JSON.stringify(Boolean(overrides.oauthConsentPage))};
}

${bundle}

return {
  inspectLoginAuthState,
  normalizeStep6Snapshot,
};
`)();
}

{
  const api = createApi({
    emailInput: { id: 'email' },
    submitButton: { id: 'submit' },
    oauthConsentPage: true,
    consentReady: true,
  });

  const snapshot = api.inspectLoginAuthState();
  assert.strictEqual(
    snapshot.state,
    'email_page',
    '第六步在 /log-in 页应优先识别为邮箱页'
  );
}

{
  const api = createApi({
    oauthConsentPage: true,
    consentReady: true,
  });

  const snapshot = api.normalizeStep6Snapshot({
    state: 'oauth_consent_page',
    url: 'https://auth.openai.com/authorize',
  });

  assert.strictEqual(snapshot.state, 'unknown', '第六步应忽略 oauth_consent_page 状态');
}

assert.ok(
  !extractFunction('inspectLoginAuthState').includes("state: 'oauth_consent_page'"),
  'inspectLoginAuthState 不应再产出 oauth_consent_page 状态'
);

console.log('step6 login state tests passed');
