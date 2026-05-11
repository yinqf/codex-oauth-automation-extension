(function attachBackgroundCpaUploadFlow(root, factory) {
  root.MultiPageBackgroundCpaUploadFlow = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundCpaUploadFlowModule() {
  function createCpaUploadFlow(deps = {}) {
    const {
      addLog,
      executeStepAndWait,
      getPanelMode,
      getState,
      isStopError,
      setEmailState,
      setState,
      setStepStatus,
      throwIfStopped,
    } = deps;

    const ACCOUNT_LINE_SEPARATOR = '----';
    const MS_LQQQ_PROVIDER = 'ms-lqqq';
    const MS_LQQQ_BASE_URL = 'https://ms.lqqq.cc/web';
    const MONSTERX_MAIL_PROVIDER = 'monsterx-mail';
    const MONSTERX_MAIL_BASE_URL = 'https://mail.cpacc.us.ci';

    function normalizeCredential(value) {
      return String(value || '').trim();
    }

    function buildMsLqqqMailUrl(email, mailPassword) {
      return `${MS_LQQQ_BASE_URL}/${email}${ACCOUNT_LINE_SEPARATOR}${mailPassword}`;
    }

    function isMonsterxMailToken(value) {
      return /^(tok|lmp)_/i.test(normalizeCredential(value));
    }

    function parseCpaUploadAccountLine(line, index = 0) {
      const rawLine = String(line || '').trim();
      if (!rawLine) {
        return null;
      }

      const parts = rawLine.split(ACCOUNT_LINE_SEPARATOR).map((part) => part.trim());
      if ((parts.length !== 3 && parts.length !== 4) || parts.slice(0, 3).some((part) => !part)) {
        throw new Error(`第 ${index + 1} 行格式错误，应为：Codex邮箱----Codex密码----邮箱密码，或 Codex邮箱----Codex密码----refreshToken----邮箱取件token`);
      }

      const [email, password, mailPasswordOrRefreshToken, mailToken] = parts;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`第 ${index + 1} 行邮箱格式无效：${email}`);
      }

      if (parts.length === 4 && isMonsterxMailToken(mailToken)) {
        return {
          lineNumber: index + 1,
          rawLine,
          email,
          password,
          refreshToken: mailPasswordOrRefreshToken,
          mailProvider: MONSTERX_MAIL_PROVIDER,
          mailToken,
          mailBaseUrl: MONSTERX_MAIL_BASE_URL,
        };
      }

      return {
        lineNumber: index + 1,
        rawLine,
        email,
        password,
        mailProvider: MS_LQQQ_PROVIDER,
        mailPassword: mailPasswordOrRefreshToken,
        mailUrl: buildMsLqqqMailUrl(email, mailPasswordOrRefreshToken),
      };
    }

    function parseCpaUploadAccountsText(text) {
      return String(text || '')
        .split(/\r?\n/)
        .map((line, index) => parseCpaUploadAccountLine(line, index))
        .filter(Boolean);
    }

    async function resetCpaUploadRuntimeState(account) {
      const stepStatusUpdates = {};
      for (const step of [7, 8, 9, 10]) {
        stepStatusUpdates[step] = 'pending';
      }

      await setState({
        cpaUploadRunning: true,
        cpaUploadCurrentLine: account.lineNumber,
        cpaUploadCurrentEmail: account.email,
        oauthUrl: null,
        localhostUrl: null,
        lastLoginCode: null,
        loginVerificationRequestedAt: null,
        oauthConsentReady: false,
        oauthFlowDeadlineAt: null,
        password: account.password,
        mailProvider: account.mailProvider || MS_LQQQ_PROVIDER,
        msLqqqMailPassword: account.mailProvider === MONSTERX_MAIL_PROVIDER ? '' : account.mailPassword,
        msLqqqMailUrl: account.mailProvider === MONSTERX_MAIL_PROVIDER ? '' : account.mailUrl,
        monsterxMailBaseUrl: account.mailProvider === MONSTERX_MAIL_PROVIDER ? account.mailBaseUrl : '',
        monsterxMailToken: account.mailProvider === MONSTERX_MAIL_PROVIDER ? account.mailToken : '',
        monsterxMailRefreshToken: account.mailProvider === MONSTERX_MAIL_PROVIDER ? account.refreshToken : '',
      });
      await setEmailState(account.email);
      for (const [step, status] of Object.entries(stepStatusUpdates)) {
        await setStepStatus(Number(step), status);
      }
    }

    async function runSingleCpaUploadAccount(account, totalCount) {
      await addLog(
        `CPA 上传：开始处理第 ${account.lineNumber}/${totalCount} 行：${account.email}`,
        'info'
      );
      await resetCpaUploadRuntimeState(account);

      throwIfStopped();
      await executeStepAndWait(7, 1200);
      throwIfStopped();
      await executeStepAndWait(8, 1200);
      throwIfStopped();
      await executeStepAndWait(9, 1200);
      throwIfStopped();
      await executeStepAndWait(10, 0);
      await addLog(`CPA 上传：第 ${account.lineNumber} 行 ${account.email} 已成功回填 CPA。`, 'ok');
    }

    async function runCpaUploadBatch(payload = {}) {
      const initialState = await getState();
      if (getPanelMode(initialState) !== 'cpa') {
        throw new Error('CPA 独立上传只支持 CPA 面板模式，请先把来源切换为 CPA 面板。');
      }

      const accountsText = String(payload.accountsText || initialState.cpaUploadAccountsText || '').trim();
      const accounts = parseCpaUploadAccountsText(accountsText);

      if (!initialState.vpsUrl) {
        throw new Error('缺少 CPA 地址，请先在侧边栏填写 CPA 地址。');
      }
      if (!initialState.vpsPassword) {
        throw new Error('缺少 CPA 管理密钥，请先在侧边栏填写管理密钥。');
      }
      if (!accounts.length) {
        throw new Error('请先填写 CPA 上传账号，每行格式：Codex邮箱----Codex密码----邮箱密码，可带第 4 段 refreshToken（会忽略）');
      }

      await addLog(`CPA 上传：开始批量处理 ${accounts.length} 个 Codex 账号。`, 'info');
      const success = [];
      const failed = [];

      try {
        for (const account of accounts) {
          try {
            await runSingleCpaUploadAccount(account, accounts.length);
            success.push(account.email);
          } catch (err) {
            if (typeof isStopError === 'function' && isStopError(err)) {
              throw err;
            }
            const message = err?.message || String(err || '未知错误');
            failed.push({
              lineNumber: account.lineNumber,
              email: account.email,
              error: message,
            });
            await addLog(`CPA 上传：第 ${account.lineNumber} 行 ${account.email} 失败：${message}`, 'error');
          }
        }

        await addLog(`CPA 上传：批量完成，成功 ${success.length} 个，失败 ${failed.length} 个。`, failed.length ? 'warn' : 'ok');
        return {
          ok: failed.length === 0,
          total: accounts.length,
          success,
          failed,
        };
      } finally {
        await setState({
          cpaUploadRunning: false,
          cpaUploadCurrentLine: null,
          cpaUploadCurrentEmail: null,
          oauthFlowDeadlineAt: null,
        });
      }
    }

    return {
      buildMsLqqqMailUrl,
      isMonsterxMailToken,
      parseCpaUploadAccountLine,
      parseCpaUploadAccountsText,
      runCpaUpload: runCpaUploadBatch,
      runCpaUploadBatch,
    };
  }

  return {
    createCpaUploadFlow,
  };
});
