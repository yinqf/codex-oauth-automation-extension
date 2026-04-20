// content/ms-lqqq-mail.js — Content script for ms.lqqq.cc mailbox pages.

(function attachMsLqqqMail(root, factory) {
  const api = factory(root);
  root.MultiPageMsLqqqMail = api;
})(typeof self !== 'undefined' ? self : globalThis, function createMsLqqqMailModule(root) {
  const MS_LQQQ_PREFIX = '[MultiPage:ms-lqqq-mail]';
  const OPENAI_SENDER_PATTERN = /openai|chatgpt|noreply@tm\.openai\.com/i;
  const OPENAI_SUBJECT_PATTERN = /openai|chatgpt|code|代码|验证码|verification|verify|login/i;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function extractVerificationCode(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;

    const patterns = [
      /(?:openai|chatgpt)[^0-9]{0,40}(?:代码|code)[^0-9]{0,20}(\d{6})/i,
      /(?:代码|验证码)[^0-9]{0,20}(\d{6})/i,
      /code\s*(?:is|为|:|：)?\s*(\d{6})/i,
      /\b(\d{6})\b/,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function parseMailTimestamp(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;

    let match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const [, year, month, day, hour, minute, second = '0'] = match;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0
      ).getTime();
    }

    match = normalized.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const [, year, month, day, hour, minute, second = '0'] = match;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0
      ).getTime();
    }

    return null;
  }

  function isVisibleElement(element) {
    if (!element) return false;
    const style = root.getComputedStyle ? root.getComputedStyle(element) : null;
    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { width: 1, height: 1 };
    return (!style || (style.display !== 'none' && style.visibility !== 'hidden'))
      && rect.width > 0
      && rect.height > 0;
  }

  function getActionText(element) {
    return normalizeText([
      element?.textContent,
      element?.value,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].filter(Boolean).join(' '));
  }

  function clickElement(element) {
    if (!element) return;
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: root }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: root }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: root }));
    element.click();
  }

  function findRefreshButton() {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    return buttons.find((button) => isVisibleElement(button) && /刷新|refresh/i.test(getActionText(button))) || null;
  }

  function findMailCards() {
    const viewButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((button) => isVisibleElement(button) && /查看|view|open/i.test(getActionText(button)));
    const cards = [];
    const seen = new Set();

    for (const button of viewButtons) {
      const card = button.closest('[class*="card"], .card, li, tr, article, section, div');
      if (!card || seen.has(card)) continue;
      const text = normalizeText(card.textContent || '');
      if (!text || !OPENAI_SUBJECT_PATTERN.test(text)) continue;
      seen.add(card);
      cards.push({ card, button, text });
    }

    if (!cards.length) {
      const candidates = Array.from(document.querySelectorAll('[class*="card"], .card, li, tr, article, section'));
      for (const card of candidates) {
        if (!isVisibleElement(card) || seen.has(card)) continue;
        const text = normalizeText(card.textContent || '');
        if (!text || !OPENAI_SUBJECT_PATTERN.test(text)) continue;
        seen.add(card);
        cards.push({ card, button: null, text });
      }
    }

    return cards;
  }

  function getMatchingCodeFromText(text, payload = {}) {
    const senderMatches = (payload.senderFilters || []).some((filter) => {
      return String(filter || '').trim() && normalizeText(text).toLowerCase().includes(String(filter).toLowerCase());
    });
    const subjectMatches = (payload.subjectFilters || []).some((filter) => {
      return String(filter || '').trim() && normalizeText(text).toLowerCase().includes(String(filter).toLowerCase());
    });
    if (!senderMatches && !subjectMatches && !OPENAI_SENDER_PATTERN.test(text) && !OPENAI_SUBJECT_PATTERN.test(text)) {
      return null;
    }

    const code = extractVerificationCode(text);
    if (!code) return null;

    const excluded = new Set((payload.excludeCodes || []).filter(Boolean));
    if (excluded.has(code)) return null;

    return code;
  }

  function findVerificationCodeInList(payload = {}) {
    const filterAfterTimestamp = Number(payload.filterAfterTimestamp) || 0;
    const cards = findMailCards()
      .map((entry) => ({
        ...entry,
        timestamp: parseMailTimestamp(entry.text),
      }))
      .sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));

    for (const entry of cards) {
      if (filterAfterTimestamp && entry.timestamp && entry.timestamp < filterAfterTimestamp) {
        continue;
      }
      const code = getMatchingCodeFromText(entry.text, payload);
      if (code) {
        return { code, entry };
      }
    }

    return null;
  }

  async function findVerificationCodeFromDetails(payload = {}) {
    const cards = findMailCards();
    for (const entry of cards) {
      if (!entry.button) continue;
      clickElement(entry.button);
      await sleep(1200);
      const pageText = normalizeText(document.body?.innerText || document.documentElement?.innerText || '');
      const code = getMatchingCodeFromText(pageText, payload);
      if (code) {
        return { code, entry };
      }
    }
    return null;
  }

  async function handlePollEmail(step, payload = {}) {
    const maxAttempts = Math.max(1, Number(payload.maxAttempts) || 5);
    const intervalMs = Math.max(500, Number(payload.intervalMs) || 3000);
    log(`步骤 ${step}：开始轮询 ms.lqqq 邮箱（最多 ${maxAttempts} 次）`);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof throwIfStopped === 'function') throwIfStopped();
      log(`步骤 ${step}：正在检查 ms.lqqq 邮箱，第 ${attempt}/${maxAttempts} 次`);

      const refreshButton = findRefreshButton();
      if (refreshButton) {
        clickElement(refreshButton);
        await sleep(1000);
      }

      const listResult = findVerificationCodeInList(payload);
      if (listResult?.code) {
        log(`步骤 ${step}：已从 ms.lqqq 邮件列表获取验证码 ${listResult.code}`, 'ok');
        return {
          code: listResult.code,
          emailTimestamp: listResult.entry?.timestamp || Date.now(),
        };
      }

      const detailResult = await findVerificationCodeFromDetails(payload);
      if (detailResult?.code) {
        log(`步骤 ${step}：已从 ms.lqqq 邮件详情获取验证码 ${detailResult.code}`, 'ok');
        return {
          code: detailResult.code,
          emailTimestamp: detailResult.entry?.timestamp || Date.now(),
        };
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    throw new Error('未在 ms.lqqq 邮箱中找到新的 OpenAI / ChatGPT 验证码。');
  }

  return {
    extractVerificationCode,
    findVerificationCodeInList,
    handlePollEmail,
    parseMailTimestamp,
  };
});

console.log('[MultiPage:ms-lqqq-mail] Content script loaded on', location.href);

if (
  typeof chrome !== 'undefined'
  && chrome.runtime?.onMessage
  && document.documentElement.getAttribute('data-multipage-ms-lqqq-listener') !== '1'
) {
  document.documentElement.setAttribute('data-multipage-ms-lqqq-listener', '1');
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'POLL_EMAIL') {
      return undefined;
    }

    resetStopState();
    self.MultiPageMsLqqqMail.handlePollEmail(message.step, message.payload || {}).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      if (typeof isStopError === 'function' && isStopError(err)) {
        log(`步骤 ${message.step}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`步骤 ${message.step}：ms.lqqq 邮箱轮询失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true;
  });
}
