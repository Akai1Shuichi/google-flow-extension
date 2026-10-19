(() => {
  let listener;
  let nextId = 0;
  const pending = new Map();
  let sceneIndex = 0;
  const emit = message => globalThis.__flowPythonEmit(JSON.stringify(message));
  const chrome = {runtime: {
    onMessage: {addListener(callback) { listener = callback; }},
    sendMessage(message) {
      if (message.action === 'TRUSTED_GENERATE_CLICK') {
        const id = ++nextId;
        return new Promise(resolve => {
          pending.set(id, resolve);
          emit({kind: 'trusted-click', id, sceneIndex: sceneIndex++});
        });
      }
      emit({kind: 'progress', data: message.data});
      return Promise.resolve();
    }
  }};
  const console = Object.fromEntries(['log', 'error'].map(level => [level, (...args) =>
    emit({kind: 'log', level, args: args.map(value => String(value))})]));
  /* WORKFLOW_SNAPSHOT */
  globalThis.__flowRunner = {
    dispatch(request) {
      if (request.action === 'START_GENERATION') sceneIndex = 0;
      let response;
      listener(request, {}, value => { response = value; });
      return response;
    },
    reply(id, value) {
      const resolve = pending.get(id);
      pending.delete(id);
      if (resolve) resolve(value);
    }
  };
})();
