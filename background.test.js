const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

async function sendGenerateClick(sender) {
  const actions = [];
  let listener;
  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { async get() { return sender.tab; } },
    debugger: {
      async attach(target, version) { actions.push(['attach', target.tabId, version]); },
      async sendCommand(_target, method, params) {
        actions.push([method, params.type, params.x, params.y]);
        if (method === 'Runtime.evaluate') return { result: { value: { x: 300, y: 400 } } };
      },
      async detach(target) { actions.push(['detach', target.tabId]); }
    }
  };
  vm.runInNewContext(source, { chrome, console: { log() {}, error() {} } });
  let response;
  const keepOpen = listener({ action: 'TRUSTED_GENERATE_CLICK' }, sender, value => { response = value; });
  for (let i = 0; i < 10 && !response; i++) await new Promise(resolve => setImmediate(resolve));
  return { actions, response, keepOpen };
}

test('sends one trusted mouse click to the requesting Flow project tab', async () => {
  const { actions, response, keepOpen } = await sendGenerateClick({
    tab: { id: 42, url: 'https://flow.google.com/project/example' },
    url: 'https://flow.google.com/project/example'
  });
  assert.equal(keepOpen, true);
  assert.equal(response.ok, true);
  assert.deepEqual(actions.map(item => item[0]), ['attach', 'Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'detach']);
  assert.deepEqual(actions[2].slice(1), ['mousePressed', 300, 400]);
  assert.deepEqual(actions[3].slice(1), ['mouseReleased', 300, 400]);
});

test('rejects generate clicks outside a Flow project', async () => {
  const { actions, response } = await sendGenerateClick({ tab: { id: 42, url: 'https://example.com/' }, url: 'https://example.com/' });
  assert.equal(response.ok, false);
  assert.equal(actions.length, 0);
});
