// content/monsterx-mail.js — Content script for mail.cpacc.us.ci token mailbox pages.

(function attachMonsterxMail(root, factory) {
  const api = factory(root);
  root.MultiPageMonsterxMail = api;
})(typeof self !== 'undefined' ? self : globalThis, function createMonsterxMailModule(root) {
  const CODE_PLACEHOLDER = '------';
  const MONSTERX_RECEIVED_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
  const MONSTERX_RECEIVED_TIME_CLOSE_MS = 2 * 60 * 60 * 1000;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseRawMailTimestamp(value) {
    const source = normalizeText(value);
    if (!source || source === '-') return 0;
    const normalized = source.replace(
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
      (_match, year, month, day, hour, minute, second = '0') => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${
          String(second).padStart(2, '0')
        }`;
      }
    );
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function resolveMonsterxReceivedTimestamp(value, now = Date.now()) {
    const rawTimestamp = parseRawMailTimestamp(value);
    if (!rawTimestamp) return 0;

    const offsetTimestamp = rawTimestamp + MONSTERX_RECEIVED_TIME_OFFSET_MS;
    const rawDistance = Math.abs(now - rawTimestamp);
    const offsetDistance = Math.abs(now - offsetTimestamp);
    if (rawDistance <= MONSTERX_RECEIVED_TIME_CLOSE_MS) {
      return rawTimestamp;
    }
    return offsetDistance < rawDistance ? offsetTimestamp : rawTimestamp;
  }

  function parseMailTimestamp(value) {
    return resolveMonsterxReceivedTimestamp(value);
  }

  function padTimeUnit(value) {
    return String(value).padStart(2, '0');
  }

  function formatLocalTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return [
      date.getFullYear(),
      padTimeUnit(date.getMonth() + 1),
      padTimeUnit(date.getDate()),
    ].join('-')
      + ' '
      + [
        padTimeUnit(date.getHours()),
        padTimeUnit(date.getMinutes()),
        padTimeUnit(date.getSeconds()),
      ].join(':');
  }

  function getAdjustedReceivedAt() {
    const node = document.getElementById('mailReceivedAt');
    const visibleText = normalizeText(node?.textContent || '');
    if (!node || !visibleText || visibleText === '-') {
      return { text: visibleText, timestamp: 0 };
    }

    const savedOriginalText = node.dataset.multipageOriginalReceivedAt || '';
    const savedAdjustedText = savedOriginalText
      ? formatLocalTimestamp(resolveMonsterxReceivedTimestamp(savedOriginalText))
      : '';
    const originalText = savedOriginalText && visibleText === savedAdjustedText
      ? savedOriginalText
      : visibleText;
    const timestamp = resolveMonsterxReceivedTimestamp(originalText);
    const adjustedText = formatLocalTimestamp(timestamp);

    if (adjustedText && visibleText !== adjustedText) {
      node.dataset.multipageOriginalReceivedAt = originalText;
      node.textContent = adjustedText;
    }

    return {
      text: adjustedText || visibleText,
      timestamp,
    };
  }

  function getNodeText(id) {
    return normalizeText(document.getElementById(id)?.textContent || '');
  }

  function getRawOutputPayload() {
    const rawOutput = getNodeText('rawOutput');
    if (!rawOutput || rawOutput === '暂无原始结果') {
      return { rawOutput, payload: null };
    }
    try {
      return { rawOutput, payload: JSON.parse(rawOutput) };
    } catch {
      return { rawOutput, payload: null };
    }
  }

  function getCurrentCodeResult() {
    const code = getNodeText('verificationCode');
    const receivedAt = getAdjustedReceivedAt();
    const { rawOutput, payload } = getRawOutputPayload();
    const data = payload?.data || {};
    return {
      code: code && code !== CODE_PLACEHOLDER ? code : '',
      emailTimestamp: receivedAt.timestamp || Date.now(),
      receivedAtText: receivedAt.text,
      subject: getNodeText('mailSubject'),
      from: getNodeText('mailFrom'),
      state: getNodeText('mailState'),
      hasNewMail: data.has_new_mail === true || /有新邮件/i.test(getNodeText('mailState')),
      rawOutput,
    };
  }

  function setInputValue(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clickElement(element) {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: root }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: root }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: root }));
    element.click();
  }

  async function waitForPageReady(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (document.getElementById('mailboxToken') && document.getElementById('fetchCode')) {
        return;
      }
      await sleep(250);
    }
    throw new Error('monsterx 邮箱页面未就绪。');
  }

  async function waitForFetchResult(previousCode, previousRawOutput, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = getCurrentCodeResult();
      const rawOutput = getNodeText('rawOutput');
      const stateText = current.state;
      if (current.code && (current.code !== previousCode || rawOutput !== previousRawOutput)) {
        return {
          ...current,
          refreshed: true,
        };
      }
      if (/失败|不可用|不正确|failed|invalid/i.test(`${stateText} ${rawOutput}`)) {
        throw new Error(stateText || rawOutput || 'monsterx 邮箱取码失败。');
      }
      await sleep(500);
    }
    return {
      ...getCurrentCodeResult(),
      refreshed: false,
    };
  }

  async function handlePollEmail(step, payload = {}) {
    const token = normalizeText(payload.monsterxMailToken || payload.mailToken || '');
    if (!/^(tok|lmp)_/i.test(token)) {
      throw new Error('monsterx 邮箱 token 无效，请检查 CPA 上传账号第 4 段。');
    }

    await waitForPageReady();
    const input = document.getElementById('mailboxToken');
    const button = document.getElementById('fetchCode');
    setInputValue(input, token);

    const maxAttempts = Math.max(1, Number(payload.maxAttempts) || 5);
    const intervalMs = Math.max(5000, Number(payload.intervalMs) || 5000);
    const filterAfterTimestamp = Number(payload.filterAfterTimestamp) || 0;
    const excludedCodes = new Set((payload.excludeCodes || []).filter(Boolean).map(String));
    let lastResult = null;

    log(`步骤 ${step}：开始在 monsterx 邮箱页面获取验证码（最多 ${maxAttempts} 次）`);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof throwIfStopped === 'function') throwIfStopped();
      const previousCode = getCurrentCodeResult().code;
      const previousRawOutput = getNodeText('rawOutput');
      log(`步骤 ${step}：正在点击 monsterx 获取最新验证码，第 ${attempt}/${maxAttempts} 次`);
      clickElement(button);

      const result = await waitForFetchResult(previousCode, previousRawOutput);
      lastResult = result;
      if (result.code && !excludedCodes.has(result.code)) {
        if (
          filterAfterTimestamp
          && result.emailTimestamp
          && result.emailTimestamp < filterAfterTimestamp
          && !result.refreshed
          && !result.hasNewMail
        ) {
          log(`步骤 ${step}：monsterx 页面当前验证码早于本次请求时间，继续等待新邮件。`, 'info');
        } else {
          if (filterAfterTimestamp && result.emailTimestamp && result.emailTimestamp < filterAfterTimestamp) {
            log(`步骤 ${step}：monsterx 页面已返回新查询结果，忽略接收时间偏差并使用当前验证码。`, 'warn');
          }
          log(`步骤 ${step}：已从 monsterx 邮箱页面获取验证码 ${result.code}`, 'ok');
          return {
            code: result.code,
            emailTimestamp: result.emailTimestamp || Date.now(),
            subject: result.subject,
            from: result.from,
          };
        }
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    if (lastResult?.code) {
      throw new Error('monsterx 邮箱页面只有旧验证码，尚未收到本次登录的新验证码。');
    }
    throw new Error('未在 monsterx 邮箱页面中找到 OpenAI / ChatGPT 验证码。');
  }

  return {
    getCurrentCodeResult,
    handlePollEmail,
    parseMailTimestamp,
  };
});

console.log('[MultiPage:monsterx-mail] Content script loaded on', location.href);

if (
  typeof chrome !== 'undefined'
  && chrome.runtime?.onMessage
  && document.documentElement.getAttribute('data-multipage-monsterx-listener') !== '1'
) {
  document.documentElement.setAttribute('data-multipage-monsterx-listener', '1');
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'POLL_EMAIL') {
      return undefined;
    }

    resetStopState();
    self.MultiPageMonsterxMail.handlePollEmail(message.step, message.payload || {}).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      if (typeof isStopError === 'function' && isStopError(err)) {
        log(`步骤 ${message.step}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`步骤 ${message.step}：monsterx 邮箱页面轮询失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true;
  });
}
