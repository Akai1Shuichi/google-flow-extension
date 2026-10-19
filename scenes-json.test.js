const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const input = `[
  {"id":"SC01","character":"Người que; tên nhân vật 2","prompt":"Hang đá, ánh sáng xanh.",},
  {"id":"SC02","character":"","prompt":"Không có nhân vật.",}
]`;

for (const page of ['popup', 'sidepanel']) {
  function loadPage() {
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          value: '', textContent: '', style: {},
          addEventListener(event, handler) { this[event] = handler; }
        });
        return elements.get(id);
      },
      addEventListener(event, handler) { handler(); }
    };
    const context = vm.createContext({ document, console,
      chrome: {
        storage: { local: { get(keys, callback) { callback({}); }, set() {} } },
        runtime: { onMessage: { addListener() {} } },
        tabs: { query: async () => [] }
      },
      FileReader: class {
        readAsText(file) { this.onload({ target: { result: file.text } }); }
      }
    });
    const html = fs.readFileSync(`${page}.html`, 'utf8');
    for (const [, source] of html.matchAll(/<script src="([^"]+)"/g)) {
      vm.runInContext(fs.readFileSync(source, 'utf8'), context);
    }
    return id => document.getElementById(id);
  }

  test(`${page} starts parsing pasted scenes with only id, character, prompt and trailing commas`, async () => {
    const el = loadPage();
    el('scenesJson').value = input;
    await el('startBtn').click();
    assert.match(el('jsonError').textContent, /Google Flow/);
    assert.doesNotMatch(el('jsonError').textContent, /JSON/);
  });

  test(`${page} imports trailing commas without changing prompt text or extra fields`, () => {
    const el = loadPage();
    const prompt = 'Dấu ,} và ,] cùng "trích dẫn" và \\ vẫn giữ nguyên';
    const scene = { id: 'SC01', character: '', prompt, extra: [1, 2] };
    const text = `{"scenes":[${JSON.stringify(scene).slice(0, -1)},},],}`;
    el('fileInput').change({ target: { files: [{ text }] } });
    assert.equal(el('jsonError').textContent, '');
    assert.deepEqual(JSON.parse(el('scenesJson').value), [scene]);
  });

  test(`${page} still reports incomplete JSON`, async () => {
    const el = loadPage();
    el('scenesJson').value = '[{"id":"SC01","prompt":';
    await el('startBtn').click();
    assert.match(el('jsonError').textContent, /JSON/);
  });
}
