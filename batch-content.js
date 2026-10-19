/* Runs only in the extension's isolated content world. */
(() => {
  if (globalThis.FlowExtensionResults) return;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let runId = null;
  async function send(action, data = {}) {
    const result = await chrome.runtime.sendMessage({ action, runId, ...data });
    if (!result?.ok) throw new Error(result?.error || 'Không nhận được phản hồi từ extension.');
    return result;
  }
  function checkStop(stopped) { if (stopped()) throw new Error('Đã dừng tiến trình.'); }
  async function waitFor(find, stopped, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      checkStop(stopped);
      const value = find();
      if (value) return value;
      await sleep(100);
    }
    throw new Error('Hết thời gian chờ giao diện Flow.');
  }
  function tileFor(mediaId) {
    return [...document.querySelectorAll('flow-grid-tile-container')].find(tile =>
      [...tile.querySelectorAll('[data-media-id]')].some(image => image.getAttribute('data-media-id') === mediaId));
  }
  async function findTile(mediaId, stopped) {
    const visibleTile = tileFor(mediaId);
    if (visibleTile) return visibleTile;
    const viewport = document.querySelector('cdk-virtual-scroll-viewport.tiles-container');
    const scroller = document.querySelector('.page-container.cdk-virtual-scrollable') || viewport;
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'instant' });
    return waitFor(() => {
      const tile = tileFor(mediaId);
      if (tile) return tile;
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + Math.max(100, scroller.clientHeight * .8), behavior: 'instant' });
    }, stopped);
  }
  async function rename(mediaId, name, stopped) {
    const tile = await findTile(mediaId, stopped);
    tile.scrollIntoView({block: 'center'});
    tile.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
    tile.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    const more = await waitFor(() => tile.querySelector('button[aria-label="More options"]'), stopped);
    more.click();
    const menu = await waitFor(() => [...document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]')]
      .find(button => (button.querySelector('.label')?.textContent || button.innerText || '').trim() === 'Rename'), stopped);
    menu.click();
    const input = await waitFor(() => [...document.querySelectorAll('input.editable-text-input.editing, .footer-left input')]
      .find(element => element.getClientRects().length), stopped);
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, name);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
    await waitFor(() => {
      const current = tileFor(mediaId);
      return current && (current.getAttribute('aria-label') === name ||
        current.querySelector('.footer-title')?.textContent.trim() === name);
    }, stopped);
  }
  async function finish(progress, stopped) {
    const deadline = Date.now() + 180000;
    let batch;
    while (Date.now() < deadline) {
      checkStop(stopped);
      batch = (await send('FLOW_BATCH_STATUS')).batch;
      const pending = batch.scenes.filter(scene => ['submitted', 'submitting'].includes(scene.status)).length;
      if (!pending) break;
      progress(0, batch.scenes.length, `Đã gửi prompt. Đang chờ ${pending} lượt tạo ảnh hoàn tất...`);
      await sleep(500);
    }
    checkStop(stopped);
    // Freeze pending results before any rename: late responses cannot enter later.
    batch = (await send('FLOW_BATCH_FREEZE')).batch;
    const errors = [];
    for (const scene of batch.scenes) {
      checkStop(stopped);
      if (scene.status === 'error') { errors.push(`${scene.sceneId}: ${scene.error}`); continue; }
      if (scene.status !== 'ready') continue;
      for (const output of scene.outputs) {
        checkStop(stopped);
        progress(scene.sceneIndex + 1, batch.scenes.length, `Đang đặt tên: ${output.name}`);
        try {
          await rename(output.mediaId, output.name, stopped);
          await send('FLOW_BATCH_OUTPUT', {mediaId: output.mediaId, status: 'renamed'});
        } catch (error) {
          checkStop(stopped);
          errors.push(`${output.name}: ${error.message}`);
          await send('FLOW_BATCH_OUTPUT', {mediaId: output.mediaId, status: 'error', error: error.message}).catch(() => {});
          document.body.click();
          break;
        }
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  }
  globalThis.FlowExtensionResults = {
    async start(scenes) {
      const result = await send('FLOW_BATCH_START', {scenes});
      runId = result.runId;
    },
    clickMeta(sceneIndex) { return {runId, sceneIndex}; },
    finish,
    async stop() { if (runId) await send('FLOW_BATCH_STOP'); },
    async end(stopped) {
      if (!runId) return;
      try { await send('FLOW_BATCH_END', {stopped}); }
      finally { runId = null; }
    }
  };
})();
