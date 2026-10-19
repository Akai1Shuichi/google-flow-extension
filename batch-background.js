/* Owns the extension's debugger session. No generation API replay. */
(() => {
  const sessions = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const project = url => /^https:\/\/flow\.google\.com\/project\/([^/?#]+)/.exec(url || '')?.[1];
  async function senderTab(sender) {
    const tab = sender.tab?.id == null ? null : await chrome.tabs.get(sender.tab.id);
    if (!tab || !project(tab.url) || project(tab.url) !== project(sender.url)) {
      throw new Error('Chỉ chạy batch trong đúng tab project Google Flow.');
    }
    return tab;
  }
  function persist(session) {
    const snapshot = session.core.snapshot();
    // Serialize writes so a slower earlier write cannot replace the final result.
    session.saving = (session.saving || Promise.resolve()).catch(() => {}).then(() =>
      chrome.storage.local.set({ flowLastBatch: snapshot }));
    return session.saving;
  }
  async function waitForRequest(session, index) {
    const deadline = Date.now() + 30000;
    while (session.core.scenes[index]?.status === 'submitting' && !session.core.stopped && Date.now() < deadline) await sleep(100);
    const scene = session.core.scenes[index];
    if (!scene || !['submitted', 'ready'].includes(scene.status)) {
      throw new Error(scene?.error || 'Không thấy request tạo ảnh; đã dừng để tránh gán nhầm.');
    }
    await persist(session);
  }
  function sessionFor(tab, runId) {
    const session = sessions.get(tab.id);
    if (!session || session.core.runId !== runId || session.core.projectId !== project(tab.url)) {
      throw new Error('Không tìm thấy phiên batch. Hãy tải lại trang trước khi chạy mới.');
    }
    return session;
  }
  async function end(session, stopped = false) {
    if (stopped) session.core.stop();
    // Unfinished records remain distinguishable from completed records.
    for (const scene of session.core.scenes) if (!['completed', 'error', 'stopped'].includes(scene.status)) scene.status = stopped ? 'stopped' : 'interrupted';
    await persist(session);
    if (session.attached) {
      session.attached = false;
      await chrome.debugger.detach({ tabId: session.tabId }).catch(() => {});
    }
    sessions.delete(session.tabId);
    return session.core.snapshot();
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const session = sessions.get(source.tabId);
    if (!session || source.sessionId || session.core.stopped) return;
    const core = session.core;
    (async () => {
      if ((method === 'Page.frameNavigated' && !params.frame.parentId) ||
          (method === 'Page.navigatedWithinDocument' && params.frameId === session.frameId && project(params.url) !== core.projectId)) {
        core.stop();
        await end(session, true);
      } else if (method === 'Network.requestWillBeSent') {
        let request = params.request;
        if (core.active !== null && request.method === 'POST' && request.url.includes('/data/batchexecute') && !request.postData) {
          const body = await chrome.debugger.sendCommand(source, 'Network.getRequestPostData', { requestId: params.requestId });
          request = { ...request, postData: body.postData };
        }
        if (core.observe(params.requestId, request)) await persist(session);
      } else if (core.requests.has(params.requestId)) {
        if (method === 'Network.responseReceived') session.statuses.set(params.requestId, params.response.status);
        if (method === 'Network.loadingFailed') {
          core.fail(core.requests.get(params.requestId), 'Request tạo ảnh bị ngắt.');
          await persist(session);
        }
        if (method === 'Network.loadingFinished') {
          const body = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
          core.reply(params.requestId, session.statuses.get(params.requestId), body.base64Encoded ? atob(body.body) : body.body);
          await persist(session);
        }
      }
    })().catch(async error => {
      const index = core.requests.get(params.requestId) ?? core.active;
      if (index !== null && index !== undefined) core.fail(index, error.message);
      await persist(session).catch(() => {});
    });
  });
  chrome.debugger.onDetach.addListener(source => {
    const session = sessions.get(source.tabId);
    if (!session || !session.attached) return;
    session.attached = false;
    for (const scene of session.core.scenes) if (['submitting', 'submitted', 'queued', 'ready'].includes(scene.status)) {
      session.core.fail(scene.sceneIndex, 'Mất kết nối debugger; không xác định được ảnh.');
    }
    persist(session).catch(console.error);
  });
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request.action?.startsWith('FLOW_BATCH_')) return;
    (async () => {
      const tab = await senderTab(sender);
      if (request.action === 'FLOW_BATCH_START') {
        if (sessions.has(tab.id)) {
          const previous = sessions.get(tab.id);
          if (previous.attached && previous.core.projectId === project(tab.url)) throw new Error('Tab này đang có batch chạy.');
          await end(previous);
        }
        const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
        const core = new FlowBatchCore.Batch(request.scenes, project(tab.url), runId);
        const session = { core, tabId: tab.id, attached: false, statuses: new Map() };
        sessions.set(tab.id, session);
        try {
          await chrome.debugger.attach({tabId: tab.id}, '1.3');
          session.attached = true;
          const tree = await chrome.debugger.sendCommand({tabId: tab.id}, 'Page.getFrameTree');
          session.frameId = tree.frameTree?.frame.id;
          await chrome.debugger.sendCommand({tabId: tab.id}, 'Network.enable', { maxTotalBufferSize: 50000000, maxResourceBufferSize: 10000000 });
          await chrome.debugger.sendCommand({tabId: tab.id}, 'Page.enable');
          await persist(session);
        } catch (error) { await end(session); throw error; }
        return { ok: true, runId };
      }
      const session = sessionFor(tab, request.runId);
      const core = session.core;
      if (request.action === 'FLOW_BATCH_STATUS') return { ok: true, batch: core.snapshot() };
      if (request.action === 'FLOW_BATCH_FREEZE') {
        core.expire(); core.validateAssignments(); await persist(session);
        return { ok: true, batch: core.snapshot() };
      }
      if (request.action === 'FLOW_BATCH_STOP') {
        core.stop(); await persist(session);
        return { ok: true };
      }
      if (request.action === 'FLOW_BATCH_END') return { ok: true, batch: await end(session, !!request.stopped) };
      const scene = core.scenes.find(s => s.outputs.some(o => o.mediaId === request.mediaId));
      const output = scene?.outputs.find(o => o.mediaId === request.mediaId);
      if (!output || core.stopped || !['ready', 'completed'].includes(scene.status)) throw new Error('Không có ảnh hợp lệ cho thao tác này.');
      if (request.action === 'FLOW_BATCH_OUTPUT') {
        if (!['renamed', 'error'].includes(request.status)) throw new Error('Trạng thái output không hợp lệ.');
        output.status = request.status;
        if (request.status === 'error') { output.error = String(request.error || 'Không xử lý được ảnh.').slice(0, 400); scene.error = output.error; }
      } else throw new Error('Lệnh batch không được hỗ trợ.');
      if (scene.outputs.some(o => o.status === 'error')) scene.status = 'error';
      else if (scene.outputs.every(o => o.status === 'renamed')) scene.status = 'completed';
      await persist(session);
      return { ok: true, output: core.snapshot().scenes[scene.sceneIndex].outputs.find(o => o.mediaId === output.mediaId) };
    })().then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  globalThis.FlowBatchBackground = { sessions, persist, waitForRequest };
})();
