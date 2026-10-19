const test = require('node:test');
const assert = require('node:assert/strict');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const rpcUrl = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
function request(prompt = 'same', project = 'project') {
  const row = []; row[7] = []; row[7][5] = project; row[8] = [[[prompt]]];
  return { url: rpcUrl, method: 'POST', postData: new URLSearchParams({
    'f.req': JSON.stringify([[['ogiZ0b', JSON.stringify([null, [row, row]]), null, 'generic']]])
  }).toString() };
}
function response(ids) {
  const rows = ids.map(id => {
    const row = [id, null, 'entity']; row[6] = [[]];
    row[6][0][13] = `https://flow-content.google/image/${id}?Signature=secret`;
    return row;
  });
  return ")]}'\n\n123\n" + JSON.stringify([['wrb.fr', 'ogiZ0b', JSON.stringify([rows, []]), null]]);
}

test('batch maps identical prompts by request IDs when completion and DOM order differ', () => {
  const { Batch } = require('./batch-core.js');
  const batch = new Batch([{ id: 'SC01', prompt: 'same' }, { id: 'SC02', prompt: 'same' }], 'project', 'run');
  batch.begin(0); assert.equal(batch.observe('request-a', request()), true);
  batch.begin(1); assert.equal(batch.observe('request-b', request()), true);
  batch.reply('request-b', 200, response([C, D]));
  batch.reply('request-a', 200, response([A, B]));
  assert.deepEqual(batch.snapshot().scenes.map(s => s.outputs.map(o => [o.mediaId, o.name])), [
    [[A, 'SC01_1'], [B, 'SC01_2']], [[C, 'SC02_1'], [D, 'SC02_2']]
  ]);
  assert.equal(JSON.stringify(batch.snapshot()).includes('secret'), false);
});

test('unrelated RPC, project or prompt cannot claim the armed scene', () => {
  const { Batch } = require('./batch-core.js');
  const batch = new Batch([{ id: 'SC01', prompt: 'same' }], 'project', 'run');
  batch.begin(0);
  assert.equal(batch.observe('other', request('different')), false);
  assert.equal(batch.observe('other', request('same', 'other')), false);
  assert.equal(batch.observe('mine', request()), true);
});

test('partial, duplicate and malformed media results fail closed', () => {
  const { Batch } = require('./batch-core.js');
  for (const body of [response([A]), response([A, A]), 'unknown']) {
    const batch = new Batch([{ id: 'SC01', prompt: 'same' }], 'project', 'run');
    batch.begin(0); batch.observe('a', request()); batch.reply('a', 200, body);
    assert.equal(batch.snapshot().scenes[0].status, 'error');
    assert.deepEqual(batch.snapshot().scenes[0].outputs, []);
  }
});

test('late responses cannot resurrect stopped or timed-out assignments', () => {
  const { Batch } = require('./batch-core.js');
  for (const stop of [true, false]) {
    const batch = new Batch([{ id: 'SC01', prompt: 'same' }], 'project', 'run');
    batch.begin(0); batch.observe('a', request());
    if (stop) batch.stop(); else batch.expire();
    batch.reply('a', 200, response([A, B]));
    assert.equal(batch.snapshot().scenes[0].status, stop ? 'stopped' : 'error');
    assert.deepEqual(batch.snapshot().scenes[0].outputs, []);
  }
});

test('duplicate output names or media IDs across scenes block every conflicting assignment', () => {
  const { Batch } = require('./batch-core.js');
  const batch = new Batch([{ id: 'SC01', prompt: 'same' }, { id: 'SC02', prompt: 'same' }], 'project', 'run');
  batch.begin(0); batch.observe('a', request()); batch.begin(1); batch.observe('b', request());
  batch.reply('a', 200, response([A, B])); batch.reply('b', 200, response([A, C]));
  batch.validateAssignments();
  assert.deepEqual(batch.snapshot().scenes.map(s => s.status), ['error', 'error']);
});

test('invalid, duplicate IDs and empty prompts are rejected before a paid click', () => {
  const { Batch } = require('./batch-core.js');
  for (const scenes of [[{ id: '../escape', prompt: 'x' }], [{ id: 'CON', prompt: 'x' }],
    [{ id: 'A', prompt: 'x' }, { id: 'a', prompt: 'x' }], [{ id: 'A', prompt: '' }]]) {
    assert.throws(() => new Batch(scenes, 'project', 'run'));
  }
});

module.exports = { request, response, rpcUrl, A, B, C, D };
