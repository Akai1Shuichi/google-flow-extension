(() => {
  let isRunning = false;
  let shouldStop = false;

  console.log("[Flow AI Auto] Content script đã sẵn sàng.");

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PING") {
      sendResponse({ status: "PONG" });
      return true;
    } else if (request.action === "START_GENERATION") {
      if (isRunning) {
        sendResponse({ status: "ALREADY_RUNNING" });
        return true;
      }
      shouldStop = false;
      isRunning = true;
      sendResponse({ status: "STARTED" });
      runWorkflow(request.data);
      return true;
    } else if (request.action === "STOP_GENERATION") {
      shouldStop = true;
      isRunning = false;
      sendResponse({ status: "STOPPING" });
      return true;
    } else if (request.action === "START_RENAME") {
      if (isRunning) {
        sendResponse({ status: "ALREADY_RUNNING" });
        return true;
      }
      shouldStop = false;
      isRunning = true;
      sendResponse({ status: "STARTED" });
      runRenameWorkflow(request.data);
      return true;
    }
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (el) => !!el && el.getClientRects().length > 0;

  function updateProgress(current, total, text, status = "RUNNING", error = null) {
    chrome.runtime.sendMessage({
      action: "PROGRESS_UPDATE",
      data: { current, total, text, status, error }
    }).catch(() => {});
  }

  // --- Step 1: Chọn chế độ Image trong ô prompt ---
  async function selectImagesTab() {
    console.log("[Flow AI Auto] Bước 1: Chọn chế độ Image...");
    const promptBox = document.querySelector("flow-prompt-box, flow-base-prompt-box");
    if (promptBox) {
      const controls = Array.from(promptBox.querySelectorAll('button, [role="button"]'));
      const label = (el) => (el.getAttribute("aria-label") || el.innerText || "").trim();
      const modeControl = controls.find(el => /^(?:image|images)$/i.test(label(el)));
      if (modeControl) {
        console.log("[Flow AI Auto] Chế độ Image đã được chọn.");
        return true;
      }

      // Flow mới mở bộ chọn Image/Video khi nhấp vào tên model.
      const modelControl = controls.find(el =>
        /(?:nano banana|veo|model|video)/i.test(`${label(el)} ${el.innerText || ""}`) &&
        isVisible(el) && !el.disabled
      );
      if (modelControl) {
        modelControl.click();
        await sleep(300);
        const modeGroup = document.querySelector(
          'flow-prompt-box-settings flow-toggles[aria-label="Mode"], .settings-content-overlay flow-toggles[aria-label="Mode"]'
        );
        const imageRadio = Array.from(modeGroup?.querySelectorAll('[role="radio"]') || []).find(el =>
          /^(?:image|images)$/i.test((el.querySelector('.toggle-text')?.textContent || el.innerText?.split('\n').pop() || '').trim())
        );
        if (imageRadio) {
          if (imageRadio.getAttribute('aria-checked') !== 'true') {
            imageRadio.click();
            await sleep(300);
          }
          const settings = document.querySelector('flow-prompt-box-settings, .settings-content-overlay');
          if (isVisible(settings)) modelControl.click();
          console.log("[Flow AI Auto] Đã chọn chế độ Image trong Settings.");
          return true;
        }
        const choices = document.querySelectorAll(
          '[role="menuitem"], [role="option"], .cdk-overlay-pane button, .cdk-overlay-pane mat-option, [role="menu"] button'
        );
        const imageChoice = Array.from(choices).find(el =>
          /^image(?:\s|$)/i.test((el.innerText || el.getAttribute("aria-label") || "").trim()) &&
          isVisible(el)
        );
        if (!imageChoice) {
          throw new Error("Đã mở menu model nhưng không tìm thấy lựa chọn Image trên Google Flow.");
        }
        imageChoice.click();
        await sleep(300);
        console.log("[Flow AI Auto] Đã chọn Image trong menu model.");
        return true;
      }
    }

    // Giao diện cũ dùng tab Images ở thanh bên.
    const listItems = Array.from(document.querySelectorAll("mat-list-item"));
    for (const item of listItems) {
      const text = item.innerText || "";
      if (/images/i.test(text)) {
        item.click();
        console.log("[Flow AI Auto] Đã click tab Images.");
        await sleep(1000);
        return true;
      }
    }
    throw new Error("Không tìm thấy bộ chọn Image trong ô prompt hoặc tab Images trên Google Flow.");
  }

  // --- Step 2: Cài đặt Settings (16:9, x1, image mode) ---
  async function configureSettings(targetRatio = "16:9", targetCount = "x1") {
    console.log("[Flow AI Auto] Bước 2: Cài đặt Settings...");
    let overlay = document.querySelector("flow-prompt-box-settings, .settings-content-overlay");
    const trigger = document.querySelector('button[aria-label="Settings trigger"]');

    if (!overlay && trigger) {
      trigger.click();
      await sleep(600);
      overlay = document.querySelector("flow-prompt-box-settings, .settings-content-overlay");
    }

    if (overlay) {
      // 1. Image mode inside .variant-emphasized
      const imgToggle = overlay.querySelector('.variant-emphasized mat-button-toggle, .variant-emphasized button');
      if (imgToggle && /image/i.test(imgToggle.innerText)) {
        imgToggle.click();
        await sleep(250);
      }

      // 2. Aspect Ratio (16:9, 1:1, etc.)
      const ratioToggles = overlay.querySelectorAll('flow-toggles[aria-label="Aspect ratio"] mat-button-toggle, mat-button-toggle');
      for (const btn of ratioToggles) {
        if (btn.innerText && btn.innerText.includes(targetRatio)) {
          btn.click();
          await sleep(200);
          break;
        }
      }

      // 3. Output count (x1, x2, x4)
      const countToggles = overlay.querySelectorAll('flow-toggles[aria-label="Output count"] mat-button-toggle, mat-button-toggle');
      for (const btn of countToggles) {
        if (btn.innerText && btn.innerText.includes(targetCount)) {
          btn.click();
          await sleep(200);
          break;
        }
      }

      // Đóng panel settings
      if (trigger) {
        trigger.click();
      } else {
        document.body.click();
      }
      await sleep(500);
      console.log("[Flow AI Auto] Đã cấu hình settings xong.");
    }
  }

  // --- Chọn nhân vật từ flow-add-menu-side-nav hoặc @tag ---
  async function selectCharacter(editor, charName) {
    if (!charName) return;
    console.log(`[Flow AI Auto] Bắt đầu tìm và chọn nhân vật "${charName}"...`);

    // Cách 1: Thử tìm trong flow-add-menu-side-nav
    let sideNav = document.querySelector("flow-add-menu-side-nav");

    // Nếu sideNav chưa mở hoặc chưa hiển thị, tìm nút mở Add/Character (chỉ tìm trong flow-prompt-box)
    if (!isVisible(sideNav)) {
      const promptBox = document.querySelector("flow-prompt-box, flow-base-prompt-box");
      if (promptBox) {
        const buttons = promptBox.querySelectorAll("button");
        for (const btn of buttons) {
          // Bỏ qua nút tạo ảnh
          if (btn.closest("flow-generate-icon-button")) continue;

          const txt = (btn.innerText || btn.getAttribute("aria-label") || "").toLowerCase();
          const hasAddIcon = Array.from(btn.querySelectorAll("mat-icon")).some(icon => (icon.innerText || "").trim().toLowerCase() === "add");

          if (hasAddIcon || txt.includes("add") || txt.includes("character")) {
            if (isVisible(btn)) {
              btn.click();
              await sleep(600);
              sideNav = document.querySelector("flow-add-menu-side-nav");
              if (isVisible(sideNav)) break;
            }
          }
        }
      }
    }

    if (sideNav) {
      // 1. Click vào item / tab "Characters" bên trong side-nav
      let charTabClicked = false;
      const allElements = Array.from(sideNav.querySelectorAll('*'));
      for (const el of allElements) {
        const text = (el.innerText || "").trim().toLowerCase();
        if ((text === "characters" || text === "character") && el.children.length === 0) {
          el.click();
          console.log("[Flow AI Auto] Đã click vào mục Characters trong side-nav.");
          charTabClicked = true;
          await sleep(600);
          break;
        }
      }

      if (!charTabClicked) {
        const anyCharTab = Array.from(sideNav.querySelectorAll('[role="tab"], mat-list-item, button, .menu-item')).find(el => 
          /characters?/i.test(el.innerText || "")
        );
        if (anyCharTab) {
          anyCharTab.click();
          console.log("[Flow AI Auto] Đã click tab Character:", anyCharTab.innerText);
          await sleep(600);
        }
      }

      // 2. Tìm phần tử chứa .asset-title có tên trùng khớp với charName
      let matchedAsset = null;
      // Quét trong sideNav trước, sau đó quét toàn document
      const assetTitles = sideNav.querySelectorAll(".asset-title, [class*='asset-title'], flow-asset-item, .character-name");

      for (const at of assetTitles) {
        const titleText = (at.innerText || "").trim();
        if (titleText.toLowerCase() === charName.toLowerCase() || titleText.toLowerCase().includes(charName.toLowerCase())) {
          matchedAsset = at;
          break;
        }
      }

      // Nếu chưa thấy trong sideNav, quét rộng ra toàn page
      if (!matchedAsset) {
        const globalTitles = document.querySelectorAll(".asset-title, [class*='asset-title']");
        for (const at of globalTitles) {
          const titleText = (at.innerText || "").trim();
          if (titleText.toLowerCase() === charName.toLowerCase() || titleText.toLowerCase().includes(charName.toLowerCase())) {
            matchedAsset = at;
            break;
          }
        }
      }

      if (matchedAsset) {
        console.log(`[Flow AI Auto] Tìm thấy asset-title "${matchedAsset.innerText.trim()}", đang click chọn...`);
        // Click vào asset hoặc phần tử cha clickable của nó
        const clickTarget = matchedAsset.closest("button, mat-card, flow-asset-item, .asset-card, .mat-mdc-card") || matchedAsset;
        clickTarget.click();
        await sleep(600);
        console.log(`[Flow AI Auto] Đã chọn thành công nhân vật "${charName}" qua side-nav!`);
        return true;
      } else {
        console.log(`[Flow AI Auto] Chưa thấy asset-title nào khớp "${charName}" trong side-nav, chuyển sang fallback @tag.`);
      }
    }

    // Cách 2: Fallback gõ @charName trong editor
    console.log(`[Flow AI Auto] Fallback: Gõ @${charName} vào ô prompt...`);
    editor.focus();
    await sleep(200);
    document.execCommand("insertText", false, `@${charName}`);
    await sleep(800);

    const candidates = document.querySelectorAll(
      '.tag-search-popup button, .tag-search-popup [role="option"], mat-option, .dropdown-item, flow-character-item'
    );
    let matchedOption = null;
    for (const opt of candidates) {
      if ((opt.innerText || "").toLowerCase().includes(charName.toLowerCase())) {
        matchedOption = opt;
        break;
      }
    }

    if (matchedOption) {
      matchedOption.click();
      console.log(`[Flow AI Auto] Đã chọn tag "${charName}" từ popup.`);
    } else {
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      editor.dispatchEvent(enterEvent);
      console.log("[Flow AI Auto] Nhấn Enter chọn tag từ popup.");
    }
    await sleep(400);
    return true;
  }

  // --- Gửi Scene prompt ---
  async function processScene(editor, scene, index, total) {
    const sceneId = scene.id || `SC${index + 1}`;
    const prompt = (scene.prompt || "").trim();
    const characterName = (scene.character || "").trim();

    updateProgress(index + 1, total, `Đang xử lý ${sceneId} (${index + 1}/${total})...`);
    console.log(`[Flow AI Auto] Bắt đầu Scene ${sceneId}: character="${characterName}", prompt=${prompt.substring(0, 60)}...`);

    // Flow mới giữ ingredient ngoài editor; Clear prompt xóa cả chữ và chip.
    const clearPrompt = document.querySelector('flow-prompt-box button[aria-label="Clear prompt"], flow-base-prompt-box button[aria-label="Clear prompt"]');
    if (isVisible(clearPrompt)) {
      clearPrompt.click();
      await sleep(200);
      editor = document.querySelector('.ProseMirror[contenteditable="true"]') || editor;
    }

    // Clear ô nhập cũ nếu có
    editor.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(300);

    // Xóa các tag/chip nhân vật cũ nếu còn tồn tại trong prompt box
    try {
      const removeButtons = document.querySelectorAll(
        'flow-prompt-box button[aria-label*="Remove" i], flow-prompt-box [aria-label*="Delete" i], flow-prompt-box .mat-mdc-chip-remove, flow-prompt-box flow-chip-remove, flow-chip button'
      );
      for (const btn of removeButtons) {
        if (isVisible(btn)) {
          btn.click();
          await sleep(200);
        }
      }
    } catch (e) {}

    // Chọn nhân vật qua side-nav / tag nếu scene có trường character
    if (characterName) {
      console.log(`[Flow AI Auto] Scene ${sceneId} có nhân vật "${characterName}", đang gắn thẻ...`);
      await selectCharacter(editor, characterName);
    } else {
      console.log(`[Flow AI Auto] Scene ${sceneId} không có nhân vật (character="").`);
    }

    // Chèn nội dung prompt (nếu có tag nhân vật thì thêm 1 khoảng trắng phía trước)
    editor = document.querySelector('.ProseMirror[contenteditable="true"]') || editor;
    editor.focus();
    const textToInsert = characterName ? (" " + prompt) : prompt;
    document.execCommand("insertText", false, textToInsert);
    await sleep(600);

    // Bấm nút Submit / Tạo ảnh
    let submitButton = null;
    const submitSelectors = [
      'flow-generate-icon-button button',
      'flow-generate-icon-button',
      'flow-base-prompt-box flow-generate-icon-button button',
      'flow-prompt-box button[aria-label*="Generate" i]',
      'flow-base-prompt-box button[aria-label*="Generate" i]',
      'flow-prompt-box button[aria-label*="Create" i]',
      'button[aria-label="Run" i]'
    ];

    updateProgress(index + 1, total, `Đang chờ nút Tạo ảnh cho ${sceneId}...`);
    for (let attempt = 0; attempt < 20 && !submitButton && !shouldStop; attempt++) {
      for (const sel of submitSelectors) {
        try {
          const elements = document.querySelectorAll(sel);
          for (const el of elements) {
            const btn = el.tagName.toLowerCase() === "button" ? el : el.querySelector("button") || el;
            if (btn && !btn.disabled && isVisible(btn)) {
              submitButton = btn;
              console.log(`[Flow AI Auto] Nút tạo ảnh đã sẵn sàng qua selector: ${sel}`);
              break;
            }
          }
          if (submitButton) break;
        } catch (e) {}
      }
      if (!submitButton) await sleep(200);
    }

    if (!submitButton) {
      throw new Error(`Không tìm thấy nút Generate khả dụng để tạo ảnh cho Scene ${sceneId}.`);
    }

    // Flow bỏ qua HTMLElement.click() tổng hợp. Debugger gửi sự kiện chuột thật vào tab.
    const rect = submitButton.getBoundingClientRect();
    const response = await chrome.runtime.sendMessage({
      action: "TRUSTED_GENERATE_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
    if (!response?.ok) {
      throw new Error(`Không bấm được nút Tạo ảnh cho ${sceneId}: ${response?.error || "không rõ nguyên nhân"}`);
    }

    let accepted = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const currentEditor = document.querySelector('.ProseMirror[contenteditable="true"]');
      if (!currentEditor || !(currentEditor.innerText || '').trim()) {
        accepted = true;
        break;
      }
      await sleep(200);
    }
    if (!accepted) {
      throw new Error(`Flow chưa nhận lệnh tạo ảnh cho Scene ${sceneId}; prompt vẫn còn trong ô nhập.`);
    }

    console.log(`[Flow AI Auto] Hoàn tất gửi Scene ${sceneId}! Chờ 4s cho Google Flow sinh card...`);
    await sleep(4000);
  }

  // --- Toàn bộ Workflow ---
  async function runWorkflow({ scenes }) {
    try {
      updateProgress(0, scenes.length, "Đang chọn chế độ Image...");
      await selectImagesTab();
      if (shouldStop) { updateProgress(0, scenes.length, "Đã dừng.", "STOPPED"); isRunning = false; return; }

      // Tìm editor ProseMirror
      let editor = document.querySelector('.ProseMirror[contenteditable="true"]');
      if (!editor) {
        // Chờ 2 giây thử lại
        await sleep(2000);
        editor = document.querySelector('.ProseMirror[contenteditable="true"]');
      }

      if (!editor) {
        throw new Error("Không tìm thấy ô nhập prompt (.ProseMirror) trên Google Flow. Hãy kiểm tra lại trang!");
      }

      for (let i = 0; i < scenes.length; i++) {
        if (shouldStop) {
          updateProgress(i, scenes.length, "Người dùng đã bấm dừng.", "STOPPED");
          isRunning = false;
          return;
        }

        await processScene(editor, scenes[i], i, scenes.length);
      }

      updateProgress(scenes.length, scenes.length, "Hoàn thành toàn bộ!", "COMPLETED");
    } catch (err) {
      console.error("[Flow AI Auto] Lỗi workflow:", err);
      updateProgress(0, scenes.length, "Lỗi: " + err.message, "ERROR", err.message);
    } finally {
      isRunning = false;
      shouldStop = false;
    }
  }

  // --- Đổi tên Cards theo ID Scenes ---
  async function runRenameWorkflow({ scenes }) {
    try {
      if (!scenes || scenes.length === 0) {
        throw new Error("Không có danh sách scenes để đổi tên.");
      }

      const searchInput = document.querySelector('input.search-input');
      if (!searchInput) {
        throw new Error("Không tìm thấy ô tìm kiếm 'input.search-input' trên trang Google Flow!");
      }

      let totalRenamed = 0;
      updateProgress(0, scenes.length, "Bắt đầu tiến trình đổi tên cards...");

      for (let idx = 0; idx < scenes.length; idx++) {
        if (shouldStop) {
          updateProgress(idx, scenes.length, "Đã dừng tiến trình đổi tên.", "STOPPED");
          isRunning = false;
          return;
        }

        const scene = scenes[idx];
        const sceneId = scene.id || `SC${idx + 1}`;
        const prompt = (scene.prompt || "").trim();

        if (!prompt) continue;

        updateProgress(idx + 1, scenes.length, `Đang tìm: "${prompt.substring(0, 25)}..." (${idx + 1}/${scenes.length})`);
        console.log(`[Flow AI Auto] Đang tìm kiếm prompt scene ${sceneId}: "${prompt}"`);

        // 1. Nhập prompt vào ô search-input bằng execCommand
        searchInput.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, prompt);
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await sleep(1500);

        // 2. Tìm danh sách card kết quả
        const tiles = Array.from(document.querySelectorAll('flow-grid-tile-container'));
        console.log(`[Flow AI Auto] Tìm thấy ${tiles.length} card cho prompt "${prompt}"`);

        for (let i = 0; i < tiles.length; i++) {
          if (shouldStop) break;
          const newName = i === 0 ? sceneId : `${sceneId}_${i}`;
          const tile = tiles[i];

          try {
            // Hover lên tile
            tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await sleep(200);

            // Bấm nút More options
            const moreBtn = tile.querySelector('button[aria-label="More options"]');
            if (moreBtn) {
              moreBtn.click();
              await sleep(400);

              // Tìm nút Rename trong menu
              const menuButtons = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
              const renameBtn = menuButtons.find(b => (b.innerText || "").toLowerCase().includes("rename"));
              if (renameBtn) {
                renameBtn.click();
                await sleep(400);

                // Điền tên mới vào ô input
                const editInput = document.querySelector('input.editable-text-input.editing, .footer-left input');
                if (editInput) {
                  editInput.focus();
                  document.execCommand('selectAll', false, null);
                  document.execCommand('delete', false, null);
                  document.execCommand('insertText', false, newName);
                  editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  editInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  console.log(`[Flow AI Auto] Đã đổi tên card ${i + 1} thành "${newName}"`);
                  totalRenamed++;
                  await sleep(600);
                }
              } else {
                document.body.click();
              }
            }
          } catch (e) {
            console.error(`[Flow AI Auto] Lỗi đổi tên card ${i + 1}:`, e);
          }
        }

        // 3. Xóa ô search
        const clearBtn = document.querySelector('button[aria-label="Clear search input"]');
        if (clearBtn) {
          clearBtn.click();
        } else {
          searchInput.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
        await sleep(800);
      }

      updateProgress(scenes.length, scenes.length, `🎉 Đã đổi tên thành công ${totalRenamed} card!`, "COMPLETED");
    } catch (err) {
      console.error("[Flow AI Auto] Lỗi rename:", err);
      updateProgress(0, scenes.length, "Lỗi đổi tên: " + err.message, "ERROR", err.message);
    } finally {
      isRunning = false;
      shouldStop = false;
    }
  }
})();
