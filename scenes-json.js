// Accept trailing commas from pasted scene lists without touching string contents.
globalThis.FlowScenesJson = {
  parse(text) {
    let normalized = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        normalized += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      if (char === ',') {
        let next = i + 1;
        while (/[\t\n\r ]/.test(text[next] || '\0')) next++;
        if (text[next] === '}' || text[next] === ']') continue;
      }
      normalized += char;
    }
    return JSON.parse(normalized);
  }
};
