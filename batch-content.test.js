const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const [moreLabel, renameLabel] of [['More options', 'Rename'], ['Tùy chọn khác', 'Đổi tên'], ['Tuỳ chọn khác', 'Đổi tên']]) {
  test(`renames a generated card using ${moreLabel} / ${renameLabel}`, async () => {
    let title = 'Original';
    let menuOpen = false;
    const messages = [];
    const more = { click() { menuOpen = true; } };
    const menu = { innerText: renameLabel, querySelector() { return null; }, click() { menuOpen = false; } };
    const input = { focus() {}, getClientRects() { return [{}]; }, dispatchEvent(event) {
      if (event.key === 'Enter') title = this.value;
    } };
    const tile = {
      scrollIntoView() {}, dispatchEvent() {},
      getAttribute() { return title; },
      querySelectorAll() { return [{ getAttribute() { return 'media-1'; } }]; },
      querySelector(selector) {
        if (selector.includes(`aria-label="${moreLabel}"`)) return more;
        return null;
      }
    };
    const document = {
      body: { click() {} },
      querySelectorAll(selector) {
        if (selector === 'flow-grid-tile-container') return [tile];
        if (selector.includes('menuitem')) return menuOpen ? [menu] : [];
        if (selector.includes('input.editable-text-input')) return [input];
        return [];
      }
    };
    const batch = { scenes: [{ sceneId: 'SC01', sceneIndex: 0, status: 'ready', outputs: [{ mediaId: 'media-1', name: 'SC01' }] }] };
    const context = {
      document, console,
      chrome: { runtime: { async sendMessage(message) { messages.push(message); return { ok: true, runId: 'run-1', batch }; } } },
      setTimeout(callback) { setImmediate(callback); },
      // Advancing time also makes a missing localized selector fail promptly.
      Date: { now: (() => { let now = 0; return () => now += 1000; })() },
      MouseEvent: class {}, Event: class {}, KeyboardEvent: class { constructor(_type, fields) { Object.assign(this, fields); } },
      HTMLInputElement: class { set value(value) { this.value = value; } }
    };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/batch-content.js`, 'utf8'), context);
    await context.FlowExtensionResults.start([{ id: 'SC01', prompt: 'Một cảnh' }]);
    await context.FlowExtensionResults.finish(() => {}, () => false);
    assert.equal(title, 'SC01');
    assert.ok(messages.some(message => message.action === 'FLOW_BATCH_OUTPUT' && message.status === 'renamed'));
  });
}
