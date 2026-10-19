/* Shared, dependency-free mapping of observed Flow image RPCs to scene IDs.
 * Wire positions observed 2026-10-19. Never replay generation requests.
 */
((root) => {
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  function sceneNames(scenes) {
    if (!Array.isArray(scenes) || !scenes.length) throw new Error('Danh sách scenes rỗng.');
    const names = scenes.map((scene, index) => {
      if (!scene || typeof scene !== 'object') throw new Error(`Scene ${index + 1} không hợp lệ.`);
      const name = String(scene.id || `SC${index + 1}`);
      if (name !== name.trim() || !name.trim() || name.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
          /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
        throw new Error(`ID không dùng được làm tên file: ${name}`);
      }
      if (typeof scene.prompt !== 'string' || !scene.prompt.trim()) throw new Error(`${name}: prompt rỗng hoặc không hợp lệ.`);
      return name;
    });
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) throw new Error('ID scene bị trùng.');
    return names;
  }
  function parseImageRequest(request, projectId, prompt) {
    try {
      const url = new URL(request.url);
      if (url.origin !== 'https://flow.google.com' || request.method !== 'POST' ||
          url.pathname !== '/_/AiSandboxAngularFrontend/data/batchexecute') return null;
      const calls = JSON.parse(new URLSearchParams(request.postData).get('f.req')).flat()
        .filter(call => call[0] === 'ogiZ0b');
      if (calls.length !== 1) return null;
      const rows = JSON.parse(calls[0][1])[1];
      return rows.length && rows.every(r => r[7][5] === projectId && r[8][0][0][0].trim() === prompt.trim()) ? rows.length : null;
    } catch { return null; }
  }
  function parseImageResponse(text, expected) {
    const payloads = [];
    for (const line of text.split('\n')) {
      let rows;
      try { rows = JSON.parse(line); } catch { continue; }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === 'ogiZ0b') {
          try { payloads.push(JSON.parse(row[2])); }
          catch { throw new Error('Flow trả lỗi hoặc schema ảnh đã thay đổi.'); }
        }
      }
    }
    const rows = payloads.length === 1 ? payloads[0]?.[0] : null;
    if (!Array.isArray(rows) || rows.length !== expected ||
        rows.some(r => !UUID.test(r?.[0])) || new Set(rows.map(r => r[0])).size !== expected) {
      throw new Error('Không lấy đủ media ID; không tự đoán ảnh theo thứ tự.');
    }
    return rows.map(row => ({ mediaId: row[0] }));
  }
  class Batch {
    constructor(scenes, projectId, runId) {
      const names = sceneNames(scenes);
      this.projectId = projectId;
      this.runId = runId;
      this.scenes = scenes.map((s, i) => ({ sceneId: names[i], sceneIndex: i,
        prompt: s.prompt.trim(), status: 'queued', outputs: [] }));
      this.requests = new Map();
      this.active = null;
      this.next = 0;
      this.stopped = false;
    }
    begin(index) {
      if (this.stopped || !Number.isInteger(index) || index !== this.next || this.active !== null || !this.scenes[index]) {
        throw new Error('Thứ tự scene không hợp lệ; dừng để tránh gán nhầm ảnh.');
      }
      this.active = index;
      this.scenes[index].status = 'submitting';
    }
    observe(requestId, request) {
      if (this.active === null || this.stopped) return false;
      const scene = this.scenes[this.active];
      const expected = parseImageRequest(request, this.projectId, scene.prompt);
      if (!expected) return false;
      if (this.requests.has(requestId)) return false;
      scene.expected = expected;
      scene.status = 'submitted';
      this.requests.set(requestId, this.active);
      this.active = null;
      this.next++;
      return true;
    }
    fail(index, message) {
      const scene = this.scenes[index];
      if (!scene || ['completed', 'stopped', 'error'].includes(scene.status)) return;
      scene.status = 'error'; scene.error = message;
      if (this.active === index) this.active = null;
    }
    reply(requestId, status, text) {
      const scene = this.scenes[this.requests.get(requestId)];
      if (!scene || scene.status !== 'submitted' || this.stopped) return;
      try {
        if (status !== 200) throw new Error(`Flow trả HTTP ${status}.`);
        scene.outputs = parseImageResponse(text, scene.expected).map((output, i, all) => ({
          ...output, name: all.length === 1 ? scene.sceneId : `${scene.sceneId}_${i + 1}`, status: 'ready'
        }));
        scene.status = 'ready';
      } catch (error) { scene.status = 'error'; scene.error = error.message; scene.outputs = []; }
    }
    expire() {
      for (const scene of this.scenes) if (['submitting', 'submitted'].includes(scene.status)) {
        this.fail(scene.sceneIndex, 'Hết thời gian chờ ảnh; kiểm tra lại Flow.');
      }
    }
    validateAssignments() {
      const names = new Map(), ids = new Map();
      for (const scene of this.scenes) for (const output of scene.outputs) {
        for (const [map, key] of [[names, output.name.toLowerCase()], [ids, output.mediaId]]) {
          if (map.has(key)) {
            this.fail(scene.sceneIndex, 'Tên ảnh hoặc media ID trùng giữa các scene.');
            this.fail(map.get(key), 'Tên ảnh hoặc media ID trùng giữa các scene.');
          } else map.set(key, scene.sceneIndex);
        }
      }
    }
    stop() {
      this.stopped = true;
      this.active = null;
      for (const scene of this.scenes) if (!['completed', 'error'].includes(scene.status)) scene.status = 'stopped';
    }
    snapshot() {
      return { runId: this.runId, projectId: this.projectId, stopped: this.stopped,
        scenes: this.scenes.map(({ prompt, ...scene }) => ({ ...scene })) };
    }
  }
  const api = { Batch, sceneNames, parseImageRequest, parseImageResponse };
  root.FlowBatchCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
