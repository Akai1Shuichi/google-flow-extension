const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

async function runGeneration({ menu = true, submit = true, imageLabel = 'Image', basePrompt = false, modelAriaLabel = 'Nano Banana Pro', liveRadio = null, existingIngredient = false, fixedPrompt = false, editorReplacedAfterCharacter = false, submitDelayChecks = 0, character, assetMenu = false, locale = 'en', directAttachment = false, attachmentFails = false, attachmentDelayChecks = 0, previewByLabel = false, scenePrompt = 'A red kite' } = {}) {
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
  const imageRadio = element('choose-image-radio', locale === 'vi' ? 'image\nHình ảnh' : 'image\nImage');
  imageRadio.getAttribute = key => key === 'aria-checked' ? String(liveRadio) : null;
  const modeGroup = { querySelectorAll: () => [imageRadio] };
  const generate = element('generate', 'Generate');
  if (submitDelayChecks) {
    let checks = 0;
    Object.defineProperty(generate, 'disabled', { get() { return ++checks <= submitDelayChecks; } });
  }
  const clearPrompt = element('clear-prompt', 'Clear prompt');
  let ingredientCount = 0;
  let pendingAttachment = 0;
  const attach = () => {
    if (attachmentFails) return;
    if (attachmentDelayChecks) pendingAttachment = attachmentDelayChecks;
    else ingredientCount++;
  };
  const assetTitles = ['Người chồng', 'Người vợ', 'Người tóc rối mặc da thú', 'Caveman'].map(name => ({
    innerText: name,
    closest() { return { click() { actions.push(`select-asset:${name}`); if (directAttachment) attach(); } }; }
  }));
  const addToPrompt = element('add-to-prompt', locale === 'vi' ? 'Thêm vào câu lệnh' : 'Add to prompt');
  addToPrompt.click = () => { actions.push('add-to-prompt'); attach(); };
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
      if (assetMenu && selector.includes('detail-add-to-prompt-btn')) return previewByLabel ? null : addToPrompt;
      if (selector.includes('button[aria-label="Clear prompt"]')) return existingIngredient && (locale === 'en' || selector.includes('button.clear-button') || selector.includes('Xoá câu lệnh')) ? clearPrompt : null;
      if (selector.includes('flow-toggles[aria-label="Mode"]')) return menuOpen && liveRadio !== null ? modeGroup : null;
      if (selector === 'flow-prompt-box-settings, .settings-content-overlay') return menuOpen && liveRadio !== null ? { offsetParent: fixedPrompt ? null : {}, getClientRects() { return [{}]; } } : null;
      if (selector.includes('flow-prompt-box') && !selector.includes('button') && !selector.includes('contenteditable')) return promptBox;
      if (selector.includes('ProseMirror') || selector.includes('contenteditable')) return currentEditor;
      return null;
    },
    querySelectorAll(selector) {
      if (assetMenu && previewByLabel && selector.includes('flow-add-menu-asset-preview button')) return [element('wrong-preview-button', 'Close'), addToPrompt];
      if (assetMenu && selector.includes('.chip-container')) {
        if (pendingAttachment && --pendingAttachment === 0) ingredientCount++;
        if (locale === 'vi' && selector.includes('[aria-label="Ingredient"]')) return [];
        return Array(ingredientCount).fill({});
      }
      if (assetMenu && selector.includes('.asset-title')) return assetTitles;
      if (selector.includes('mat-list-item')) return [];
      if (selector.includes('role="menuitem"') || selector.includes('role="option"') || selector.includes('cdk-overlay-pane')) return menu ? [image] : [];
      if (selector.includes('flow-generate-icon-button')) return [];
      if ((selector.includes('aria-label*="Generate"') && locale === 'en' || selector.includes('aria-label*="Tạo"') && locale === 'vi') && (!basePrompt || selector.includes('flow-base-prompt-box'))) return submit ? [generate] : [];
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
  listener({ action: 'START_GENERATION', data: { scenes: [{ id: 'SC01', prompt: scenePrompt, character: character ?? (editorReplacedAfterCharacter ? 'X' : '') }] } }, {}, () => {});
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

for (const character of ['Người chồng; Người vợ', 'Người chồng, Người vợ', ' ; Người chồng, ; Người vợ ;, ']) {
  test(`attaches each character before inserting the prompt: ${character}`, async () => {
    const { actions, updates } = await runGeneration({ character });
    assert.deepEqual(actions.filter(action => action.startsWith('insert:@')), [
      'insert:@Người chồng', 'insert:@Người vợ'
    ]);
    assert.ok(actions.includes('insert:@Người chồng'), actions.join(', '));
    assert.ok(actions.includes('insert:@Người vợ'), actions.join(', '));
    assert.ok(actions.indexOf('insert:@Người chồng') < actions.indexOf('insert:@Người vợ'), actions.join(', '));
    assert.ok(actions.indexOf('insert:@Người vợ') < actions.indexOf('insert: A red kite'), actions.join(', '));
    assert.equal(updates.at(-1).status, 'COMPLETED');
  });

  test(`adds both Flow character assets through the preview button: ${character}`, async () => {
    const { actions, updates } = await runGeneration({ character, assetMenu: true });
    assert.deepEqual(actions.filter(action => action.startsWith('select-asset:')), [
      'select-asset:Người chồng', 'select-asset:Người vợ'
    ]);
    assert.equal(actions.filter(action => action === 'add-to-prompt').length, 2);
    assert.equal(updates.at(-1).status, 'COMPLETED');
  });
}

for (const [locale, character] of [['vi', 'Người tóc rối mặc da thú'], ['en', 'Caveman']]) {
  test(`recognizes attached reference chips on ${locale} Flow`, async () => {
    const { actions, updates } = await runGeneration({ assetMenu: true, locale, character });
    assert.equal(updates.at(-1).status, 'COMPLETED');
    assert.ok(actions.includes('insert: A red kite'));
  });

  test(`does not click Add again after direct attachment on ${locale} Flow`, async () => {
    const { actions, updates } = await runGeneration({ assetMenu: true, locale, character, directAttachment: true });
    assert.equal(updates.at(-1).status, 'COMPLETED');
    assert.equal(actions.includes('add-to-prompt'), false);
  });
}

test('waits for a delayed ingredient chip before sending a prompt', async () => {
  const { actions, updates } = await runGeneration({ assetMenu: true, character: 'Caveman', attachmentDelayChecks: 4 });
  assert.equal(updates.at(-1).status, 'COMPLETED');
  assert.equal(actions.filter(a => a === 'add-to-prompt').length, 1);
});

test('does not generate when the selected asset never attaches', async () => {
  const { actions, updates } = await runGeneration({ assetMenu: true, locale: 'vi', character: 'Người tóc rối mặc da thú', attachmentFails: true });
  assert.equal(updates.at(-1).status, 'ERROR');
  assert.equal(actions.some(a => a.startsWith('trusted-generate:')), false);
});

test('selects the Vietnamese image menu item', async () => {
  const { updates } = await runGeneration({ imageLabel: 'Hình ảnh\nNano Banana Pro', locale: 'vi' });
  assert.equal(updates.at(-1).status, 'COMPLETED');
});

test('selects the Vietnamese image radio', async () => {
  const { actions, updates } = await runGeneration({ liveRadio: false, menu: false, locale: 'vi' });
  assert.equal(updates.at(-1).status, 'COMPLETED');
  assert.ok(actions.includes('choose-image-radio'));
});

for (const locale of ['en', 'vi']) {
  test(`finds the ${locale} Add to prompt button by label without clicking other preview controls`, async () => {
    const { actions, updates } = await runGeneration({ assetMenu: true, previewByLabel: true, locale, character: 'Caveman' });
    assert.equal(updates.at(-1).status, 'COMPLETED');
    assert.equal(actions.includes('wrong-preview-button'), false);
    assert.ok(actions.includes('add-to-prompt'));
  });
}

test('clears a previous prompt on Vietnamese Flow', async () => {
  const { actions, updates } = await runGeneration({ locale: 'vi', existingIngredient: true });
  assert.equal(updates.at(-1).status, 'COMPLETED');
  assert.ok(actions.includes('clear-prompt'));
});

test('matches decomposed Vietnamese character names and preserves the Vietnamese prompt', async () => {
  const { actions, updates } = await runGeneration({ locale: 'vi', assetMenu: true, character: 'Người tóc rối mặc da thú'.normalize('NFD'), scenePrompt: 'Người tóc rối cầm cá.' });
  assert.equal(updates.at(-1).status, 'COMPLETED');
  assert.ok(actions.includes('select-asset:Người tóc rối mặc da thú'));
  assert.ok(actions.includes('insert: Người tóc rối cầm cá.'));
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
