if (typeof importScripts === 'function') importScripts('batch-core.js', 'batch-background.js');

// Cho phép mở Side Panel khi click vào Action icon của Extension
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

console.log("[Flow AI Background] Đã cấu hình Side Panel cho Extension.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "TRUSTED_GENERATE_CLICK") return;

  (async () => {
    const tabId = sender.tab?.id;
    const flowProject = /^https:\/\/flow\.google\.com\/project\/[^/?#]+(?:[/?#]|$)/;
    const target = { tabId };
    let attached = false;
    let error = null;
    let mouseDown = false;
    const batchSession = globalThis.FlowBatchBackground?.sessions.get(tabId);
    const checkBatch = () => {
      if (batchSession && (batchSession.core.stopped || !batchSession.attached ||
          globalThis.FlowBatchBackground.sessions.get(tabId) !== batchSession)) throw new Error('Batch đã dừng hoặc mất kết nối.');
    };

    try {
      const tab = tabId == null ? null : await chrome.tabs.get(tabId);
      if (!tab || !flowProject.test(tab.url || "") || !flowProject.test(sender.url || "")) {
        throw new Error("Chỉ có thể tạo ảnh trong tab project Google Flow.");
      }
      if (batchSession) {
        if (request.runId !== batchSession.core.runId || !batchSession.attached) throw new Error('Phiên batch không còn hợp lệ.');
        batchSession.core.begin(request.sceneIndex);
      } else {
        if (request.runId) throw new Error('Phiên batch đã mất; dừng để tránh gán nhầm ảnh.');
        await chrome.debugger.attach(target, "1.3");
        attached = true;
      }
      // Đọc lại tọa độ sau khi attach vì thanh thông báo debugger có thể đổi viewport.
      const position = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: `(() => {
          const buttons = document.querySelectorAll('flow-prompt-box flow-generate-icon-button button[aria-label="Start generation"], flow-generate-icon-button button[type="submit"]');
          const button = Array.from(buttons).find(el => !el.disabled && el.getClientRects().length > 0);
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
        returnByValue: true
      });
      const { x, y } = position?.result?.value || {};
      checkBatch();
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        throw new Error("Không tìm thấy nút Tạo ảnh đang bật sau khi kết nối tab.");
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1
      });
      mouseDown = true;
      checkBatch();
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: 1
      });
      mouseDown = false;
      if (batchSession) await globalThis.FlowBatchBackground.waitForRequest(batchSession, request.sceneIndex);
    } catch (err) {
      error = err;
      if (batchSession) {
        batchSession.core.fail(request.sceneIndex, err.message);
        await globalThis.FlowBatchBackground.persist(batchSession);
      }
    } finally {
      if (mouseDown) {
        // Release outside the Generate button if Stop arrived while pressed.
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: 0, y: 0, button: 'left', clickCount: 1
        }).catch(() => {});
      }
      if (attached) {
        try { await chrome.debugger.detach(target); }
        catch (err) { error ||= err; }
      }
    }

    sendResponse(error ? { ok: false, error: error.message } : { ok: true });
  })();

  return true;
});
