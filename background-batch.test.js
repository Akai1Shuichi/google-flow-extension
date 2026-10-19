const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
function event() { const callbacks = []; return { addListener(fn) { callbacks.push(fn); }, emit(...args) { callbacks.forEach(fn => fn(...args)); } }; }
function harness() {
  const sender = { tab: { id: 42, url: 'https://flow.google.com/project/example' }, url: 'https://flow.google.com/project/example' };
  const onEvent = event(), onDetach = event(), onMessage = event(), onDeterminingFilename = event();
  const actions = [], saved = {}, bodies = new Map(); let seq = 0;
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} }, runtime: { id: 'extension', onMessage },
    tabs: { get: async () => sender.tab },
    storage: { local: { set: async value => Object.assign(saved, structuredClone(value)) } },
    debugger: { onEvent, onDetach,
      attach: async () => actions.push('attach'), detach: async () => actions.push('detach'),
      async sendCommand(target, method, params = {}) {
        actions.push(method);
        if (method === 'Runtime.evaluate') return { result: { value: { x: 100, y: 100 } } };
        if (method === 'Page.getFrameTree') return {frameTree:{frame:{id:'main'}}};
        if (method === 'Network.getResponseBody') return { body: bodies.get(params.requestId) };
        if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
          const row = []; row[7] = []; row[7][5] = 'example'; row[8] = [[['same']]];
          onEvent.emit(target, 'Network.requestWillBeSent', { requestId: 'r' + ++seq, request: {
            url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute', method: 'POST',
            postData: new URLSearchParams({'f.req': JSON.stringify([[['ogiZ0b', JSON.stringify([null, [row]])]]])}).toString()
          } });
        }
        return {};
      }
    },
    downloads: { onDeterminingFilename, onChanged: event(),
      download: async () => 1, search: async () => [{id: 1, state: 'complete', filename: 'Flow/run/SC01.jpg'}], cancel: async () => {} }
  };
  const context = vm.createContext({ chrome, console: {log(){},error(){}}, URL, URLSearchParams,
    setTimeout, clearTimeout, crypto: webcrypto, atob: s => Buffer.from(s, 'base64').toString(),
    importScripts: (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), context)) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
  async function send(message, from = sender) {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No response: ' + message.action)), 1500);
      onMessage.emit(message, from, value => { clearTimeout(timer); resolve(value); });
    });
  }
  async function complete(id, mediaId) {
    const row = [mediaId]; row[6] = [[]]; row[6][0][13] = `https://flow-content.google/image/${mediaId}?Signature=secret`;
    bodies.set(id, ")]}'\n\n123\n" + JSON.stringify([['wrb.fr', 'ogiZ0b', JSON.stringify([[row], []])]]));
    onEvent.emit({tabId: 42}, 'Network.responseReceived', { requestId: id, response: {status: 200} });
    onEvent.emit({tabId: 42}, 'Network.loadingFinished', { requestId: id });
    await new Promise(resolve => setImmediate(resolve));
  }
  return { send, actions, saved, onEvent, onDetach, complete, onDeterminingFilename, chrome, sender };
}

test('extension keeps one debugger session and maps out-of-order results to originating clicks', async () => {
  const h = harness();
  const start = await h.send({action: 'FLOW_BATCH_START', scenes: [{id:'SC01',prompt:'same'}, {id:'SC02',prompt:'same'}]});
  assert.equal(start.ok, true);
  for (let sceneIndex = 0; sceneIndex < 2; sceneIndex++) {
    assert.equal((await h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex})).ok, true);
  }
  await h.complete('r2', B); await h.complete('r1', A);
  const status = await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId});
  assert.deepEqual(JSON.parse(JSON.stringify(status.batch.scenes.map(s => s.outputs.map(o => [o.mediaId,o.name])))), [[[A,'SC01']],[[B,'SC02']]]);
  await h.send({action:'FLOW_BATCH_END',runId:start.runId});
  assert.equal(h.actions.filter(a => a === 'attach').length, 1);
  assert.equal(h.actions.filter(a => a === 'detach').length, 1);
  assert.equal(JSON.stringify(h.saved).includes('Signature'), false);
});

test('debugger detach fails pending scene instead of reporting completion', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  await h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex:0});
  h.onDetach.emit({tabId:42}, 'canceled_by_user');
  const status = await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId});
  assert.equal(status.batch.scenes[0].status, 'error');
});

test('batch rejects non-Flow senders before attaching debugger', async () => {
  const h = harness();
  const result = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]},
    {tab:{id:42,url:'https://example.com'},url:'https://example.com'});
  assert.equal(result.ok, false);
  assert.equal(h.actions.includes('attach'), false);
});

test('stop while locating the Generate button prevents another paid click', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  const original = h.chrome.debugger.sendCommand;
  let resume;
  h.chrome.debugger.sendCommand = async (...args) => {
    if (args[1] === 'Runtime.evaluate') return await new Promise(resolve => { resume = resolve; });
    return original(...args);
  };
  const click = h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex:0});
  await new Promise(resolve => setImmediate(resolve));
  await h.send({action:'FLOW_BATCH_STOP',runId:start.runId});
  resume({result:{value:{x:100,y:100}}});
  assert.equal((await click).ok, false);
  assert.equal(h.actions.includes('Input.dispatchMouseEvent'), false);
});

test('renamed cards complete without downloading', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  await h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex:0});
  await h.complete('r1', A);
  await h.send({action:'FLOW_BATCH_OUTPUT',runId:start.runId,mediaId:A,status:'renamed'});
  const status = await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId});
  assert.equal(status.batch.scenes[0].status, 'completed');
  assert.equal((await h.send({action:'FLOW_BATCH_DOWNLOAD',runId:start.runId,mediaId:A})).ok, false);
});

test('a batch never downloads images even when an old caller requests it', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}],download:true});
  await h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex:0});
  await h.complete('r1', A);
  await h.send({action:'FLOW_BATCH_OUTPUT',runId:start.runId,mediaId:A,status:'renamed'});
  assert.equal((await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId})).batch.scenes[0].status, 'completed');
  assert.equal((await h.send({action:'FLOW_BATCH_DOWNLOAD',runId:start.runId,mediaId:A})).ok, false);
});

test('main-frame reload ends the old session so the tab can start again', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  await h.send({action:'TRUSTED_GENERATE_CLICK',runId:start.runId,sceneIndex:0});
  h.onEvent.emit({tabId:42}, 'Page.frameNavigated', {frame:{url:h.sender.url}});
  await new Promise(resolve => setImmediate(resolve));
  const next = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC02',prompt:'same'}]});
  assert.equal(next.ok, true);
  assert.notEqual(next.runId, start.runId);
});

test('SPA project change ends the batch while iframe history changes do not', async () => {
  const h = harness();
  const start = await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  h.onEvent.emit({tabId:42}, 'Page.navigatedWithinDocument', {frameId:'child',url:'https://example.com/iframe'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId})).ok, true);
  h.onEvent.emit({tabId:42}, 'Page.navigatedWithinDocument', {frameId:'main',url:'https://flow.google.com/project/other'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.send({action:'FLOW_BATCH_STATUS',runId:start.runId})).ok, false);
  assert.equal(h.saved.flowLastBatch.stopped, true);
});

test('restart waits for the old debugger detach and old cleanup cannot delete the new session', async () => {
  const h = harness();
  await h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC01',prompt:'same'}]});
  let resume;
  h.chrome.debugger.detach = () => new Promise(resolve => { resume = resolve; });
  h.onEvent.emit({tabId:42}, 'Page.navigatedWithinDocument', {frameId:'main',url:'https://flow.google.com/project/other'});
  await new Promise(resolve => setImmediate(resolve));
  h.sender.tab.url = h.sender.url = 'https://flow.google.com/project/other';
  const starting = h.send({action:'FLOW_BATCH_START',scenes:[{id:'SC02',prompt:'same'}]});
  await new Promise(resolve => setImmediate(resolve));
  const attachedBeforeOldDetach = h.actions.filter(action => action === 'attach').length;
  resume();
  const next = await starting;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attachedBeforeOldDetach, 1);
  assert.equal(next.ok, true);
  assert.equal((await h.send({action:'FLOW_BATCH_STATUS',runId:next.runId})).ok, true);
});
