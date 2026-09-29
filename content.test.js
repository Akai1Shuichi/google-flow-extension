const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

async function runGeneration({ menu = true, submit = true, imageLabel = 'Image', basePrompt = false, modelAriaLabel = 'Nano Banana Pro', liveRadio = null, existingIngredient = false, fixedPrompt = false, editorReplacedAfterCharacter = false, submitDelayChecks = 0, character, assetMenu = false } = {}) {
  const actions = [];
  const updates = [];
  let listener;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const element = (name, label = '') => ({
    tagName: 'BUTTON', innerText: label, offsetParent: fixedPrompt ? null : {}, disabled: false,
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: 100, top: 200, width: 40, height: 40 }; },
    getAttribute: key => key === 'aria-label' ? label : null,
    click() { actions.push(name); },
    closest() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  });
  const trigger = element('open-model-menu', 'Nano Banana Pro');
  trigger.getAttribute = key => key === 'aria-label' ? modelAriaLabel : null;
  let menuOpen = false;
  trigger.click = () => { actions.push(menuOpen ? 'close-model-menu' : 'open-model-menu'); menuOpen = !menuOpen; };
  const image = element('choose-image', imageLabel);
  const imageRadio = element('choose-image-radio', 'image\nImage');
  imageRadio.getAttribute = key => key === 'aria-checked' ? String(liveRadio) : null;
  const modeGroup = { querySelectorAll: () => [imageRadio] };
  const generate = element('generate', 'Generate');
  if (submitDelayChecks) {
    let checks = 0;
    Object.defineProperty(generate, 'disabled', { get() { return ++checks <= submitDelayChecks; } });
  }
  const clearPrompt = element('clear-prompt', 'Clear prompt');
  let ingredientCount = 0;
  const assetTitles = ['Người chồng', 'Người vợ'].map(name => ({
    innerText: name,
    closest() { return { click() { actions.push(`select-asset:${name}`); } }; }
  }));
  const addToPrompt = element('add-to-prompt');
  addToPrompt.click = () => { actions.push('add-to-prompt'); ingredientCount++; };
  const sideNav = { getClientRects() { return [{}]; }, querySelectorAll() { return []; } };
  const promptBox = {
    querySelectorAll(selector) {
      if (selector === 'button' || selector.includes('button')) return [trigger, generate];
      return [];
    },
    querySelector() { return null; }
  };
  let activeEditor;
  const editor = {
    offsetParent: {},
    innerText: '',
    focus() { activeEditor = editor; actions.push('focus-editor'); },
    dispatchEvent() { actions.push('editor-key'); },
    getAttribute() { return 'true'; }
  };
  const nextEditor = {
    innerText: '',
    focus() { activeEditor = nextEditor; actions.push('focus-new-editor'); },
    dispatchEvent() { actions.push('editor-key'); }
  };
  let currentEditor = editor;
  const document = {
    body: { click() {} },
    querySelector(selector) {
      if (assetMenu && selector === 'flow-add-menu-side-nav') return sideNav;
      if (assetMenu && selector.includes('detail-add-to-prompt-btn')) return addToPrompt;
      if (selector.includes('button[aria-label="Clear prompt"]')) return existingIngredient ? clearPrompt : null;
      if (selector.includes('flow-toggles[aria-label="Mode"]')) return menuOpen && liveRadio !== null ? modeGroup : null;
      if (selector === 'flow-prompt-box-settings, .settings-content-overlay') return menuOpen && liveRadio !== null ? { offsetParent: fixedPrompt ? null : {}, getClientRects() { return [{}]; } } : null;
      if (selector.includes('flow-prompt-box') && !selector.includes('button') && !selector.includes('contenteditable')) return promptBox;
      if (selector.includes('ProseMirror') || selector.includes('contenteditable')) return currentEditor;
      return null;
    },
    querySelectorAll(selector) {
      if (assetMenu && selector.includes('.chip-container[aria-label="Ingredient"]')) return Array(ingredientCount).fill({});
      if (assetMenu && selector.includes('.asset-title')) return assetTitles;
      if (selector.includes('mat-list-item')) return [];
      if (selector.includes('role="menuitem"') || selector.includes('role="option"') || selector.includes('cdk-overlay-pane')) return menu ? [image] : [];
      if (selector.includes('flow-generate-icon-button')) return [];
      if (selector.includes('aria-label*="Generate"') && (!basePrompt || selector.includes('flow-base-prompt-box'))) return submit ? [generate] : [];
      if (selector.includes('aria-label="Run"')) return [];
      return [];
    },
    execCommand(command, _show, value) {
      if (command === 'insertText') {
        actions.push(`${activeEditor === currentEditor ? 'insert' : 'insert-stale'}:${value}`);
        if (activeEditor) activeEditor.innerText += value;
        if (editorReplacedAfterCharacter && value === '@X') currentEditor = nextEditor;
      }
      return true;
    }
  };
  const chrome = { runtime: {
    onMessage: { addListener(callback) { listener = callback; } },
    sendMessage(message) {
      if (message.action === 'TRUSTED_GENERATE_CLICK') {
        actions.push(`trusted-generate:${message.x},${message.y}`);
        currentEditor.innerText = '';
        return Promise.resolve({ ok: true });
      }
      updates.push(message.data);
      if (message.data.status === 'COMPLETED' || message.data.status === 'ERROR') resolveDone();
      return Promise.resolve();
    }
  } };
  vm.runInNewContext(source, { document, chrome, console: { log() {}, error() {} },
    setTimeout: callback => setImmediate(callback), KeyboardEvent: class {} });
  listener({ action: 'START_GENERATION', data: { scenes: [{ id: 'SC01', prompt: 'A red kite', character: character ?? (editorReplacedAfterCharacter ? 'X' : '') }] } }, {}, () => {});
  await done;
  return { actions, updates };
}

test('selects Image from the model menu before generating a scene', async () => {
  const { actions, updates } = await runGeneration();
  assert.ok(actions.indexOf('open-model-menu') >= 0, actions.join(', '));
  assert.ok(actions.indexOf('choose-image') > actions.indexOf('open-model-menu'), actions.join(', '));
  assert.ok(actions.indexOf('insert:A red kite') > actions.indexOf('choose-image'), actions.join(', '));
  assert.ok(actions.findIndex(action => action.startsWith('trusted-generate:')) > actions.indexOf('insert:A red kite'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('reports an error when the Image choice is unavailable', async () => {
  const { actions, updates } = await runGeneration({ menu: false });
  assert.equal(actions.some(action => action.startsWith('trusted-generate:')), false);
  assert.equal(updates.at(-1).status, 'ERROR');
});

test('does not report completion when the Generate button is missing', async () => {
  const { actions, updates } = await runGeneration({ submit: false });
  assert.equal(actions.some(action => action.startsWith('trusted-generate:')), false);
  assert.equal(updates.at(-1).status, 'ERROR');
});

test('selects Image when the new menu item includes model details', async () => {
  const { actions, updates } = await runGeneration({ imageLabel: 'Image\nNano Banana Pro' });
  assert.ok(actions.includes('choose-image'), actions.join(', '));
  assert.ok(actions.includes('trusted-generate:120,220'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('generates from the base prompt box used by the new UI', async () => {
  const { actions, updates } = await runGeneration({ basePrompt: true });
  assert.ok(actions.includes('trusted-generate:120,220'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('finds the model selector when its aria label hides the model name', async () => {
  const { actions, updates } = await runGeneration({ modelAriaLabel: 'Select generation type' });
  assert.ok(actions.includes('open-model-menu'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('selects Image radio and closes settings on the current Flow UI', async () => {
  const { actions, updates } = await runGeneration({ liveRadio: false, menu: false });
  assert.ok(actions.includes('choose-image-radio'), actions.join(', '));
  assert.ok(actions.includes('close-model-menu'), actions.join(', '));
  assert.ok(actions.indexOf('insert:A red kite') > actions.indexOf('close-model-menu'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('keeps the checked Image mode and closes settings', async () => {
  const { actions, updates } = await runGeneration({ liveRadio: true, menu: false });
  assert.equal(actions.includes('choose-image-radio'), false);
  assert.ok(actions.includes('close-model-menu'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('clears a previous character ingredient before the next scene', async () => {
  const { actions, updates } = await runGeneration({ existingIngredient: true });
  assert.ok(actions.includes('clear-prompt'), actions.join(', '));
  assert.ok(actions.indexOf('clear-prompt') < actions.indexOf('insert:A red kite'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('clicks the visible Start generation button in Flow’s fixed prompt box', async () => {
  const { actions, updates } = await runGeneration({ fixedPrompt: true, liveRadio: true, menu: false });
  assert.ok(actions.includes('open-model-menu'), actions.join(', '));
  assert.ok(actions.includes('trusted-generate:120,220'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('uses the replacement editor after Flow adds an ingredient', async () => {
  const { actions, updates } = await runGeneration({ editorReplacedAfterCharacter: true });
  assert.ok(actions.includes('focus-new-editor'), actions.join(', '));
  assert.ok(actions.includes('insert: A red kite'), actions.join(', '));
  assert.equal(actions.includes('insert-stale: A red kite'), false);
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('attaches each semicolon-separated character before inserting the prompt', async () => {
  const { actions, updates } = await runGeneration({ character: 'Người chồng; Người vợ' });
  assert.ok(actions.includes('insert:@Người chồng'), actions.join(', '));
  assert.ok(actions.includes('insert:@Người vợ'), actions.join(', '));
  assert.ok(actions.indexOf('insert:@Người chồng') < actions.indexOf('insert:@Người vợ'), actions.join(', '));
  assert.ok(actions.indexOf('insert:@Người vợ') < actions.indexOf('insert: A red kite'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('adds both Flow character assets through the preview button', async () => {
  const { actions, updates } = await runGeneration({ character: 'Người chồng; Người vợ', assetMenu: true });
  assert.deepEqual(actions.filter(action => action.startsWith('select-asset:')), [
    'select-asset:Người chồng', 'select-asset:Người vợ'
  ]);
  assert.equal(actions.filter(action => action === 'add-to-prompt').length, 2);
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('waits for Start generation to become enabled before clicking', async () => {
  const { actions, updates } = await runGeneration({ submitDelayChecks: 3 });
  assert.ok(actions.includes('trusted-generate:120,220'), actions.join(', '));
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('sends a trusted click to Flow instead of calling HTMLElement.click', async () => {
  const { actions, updates } = await runGeneration({ fixedPrompt: true, liveRadio: true, menu: false });
  assert.ok(actions.includes('trusted-generate:120,220'), actions.join(', '));
  assert.equal(actions.includes('generate'), false);
  assert.equal(updates.at(-1).status, 'COMPLETED');
});
