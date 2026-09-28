document.addEventListener("DOMContentLoaded", () => {
  const scenesJsonArea = document.getElementById("scenesJson");
  const downloadSampleBtn = document.getElementById("downloadSampleBtn");
  const fileInput = document.getElementById("fileInput");
  const jsonError = document.getElementById("jsonError");
  const progressSection = document.getElementById("progressSection");
  const progressBar = document.getElementById("progressBar");
  const statusText = document.getElementById("statusText");
  const startBtn = document.getElementById("startBtn");
  const renameBtn = document.getElementById("renameBtn");
  const stopBtn = document.getElementById("stopBtn");

  // Sample data definition
  const SAMPLE_SCENES = [
    {
      "id": "SC01",
      "character": "Người que",
      "character_info": "Nhân vật người que, đầu tròn, tay chân nét đơn theo ảnh tham chiếu.",
      "prompt": "Dùng ảnh đính kèm làm tham chiếu nhân vật, giữ nguyên thiết kế, đầu tròn và tay chân nét đơn. Nhân vật cúi bên đống than trong hang đá, vẻ tập trung, nhìn xuống than. Trung cảnh nhìn nghiêng, vách đá nâu phía sau, vài đốm than đỏ yếu dưới lớp tro xám; ánh sáng xanh nhạt từ cửa hang bên phải. Minh họa 2D viền đen, màu phẳng, tỷ lệ 16:9. Một nhân vật, một thời điểm chính. Không chữ, phụ đề, logo hoặc watermark.",
      "subtitle_ids": [1, 2]
    },
    {
      "id": "SC02",
      "character": "",
      "character_info": "",
      "prompt": "Cận cảnh đống than trong hang đá, vài đốm đỏ yếu dưới lớp tro xám và một làn khói mỏng, không có ngọn lửa. Vách đá nâu phía sau, ánh sáng xanh nhạt từ bên phải. Minh họa 2D viền đen, màu phẳng, tỷ lệ 16:9. Không đưa nhân vật trong ảnh tham chiếu vào cảnh này, kể cả khi ảnh đó được đính kèm. Không chữ, phụ đề, logo hoặc watermark.",
      "subtitle_ids": [3]
    }
  ];

  // Load cached settings
  chrome.storage.local.get(["savedJson"], (res) => {
    if (res.savedJson && !res.savedJson.includes("Nội dung prompt đầy đủ của cảnh SC01")) {
      scenesJsonArea.value = res.savedJson;
    } else {
      scenesJsonArea.value = JSON.stringify(SAMPLE_SCENES, null, 2);
    }
  });

  // Handle sample file download
  if (downloadSampleBtn) {
    downloadSampleBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(SAMPLE_SCENES, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scenes_sample.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Handle file upload
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          scenesJsonArea.value = JSON.stringify(parsed, null, 2);
        } else if (parsed.scenes && Array.isArray(parsed.scenes)) {
          scenesJsonArea.value = JSON.stringify(parsed.scenes, null, 2);
        } else {
          scenesJsonArea.value = event.target.result;
        }
        jsonError.textContent = "";
        saveState();
      } catch (err) {
        jsonError.textContent = "File JSON không hợp lệ: " + err.message;
      }
    };
    reader.readAsText(file);
  });

  // Save settings on change
  function saveState() {
    chrome.storage.local.set({
      savedJson: scenesJsonArea.value
    });
  }

  scenesJsonArea.addEventListener("input", saveState);

  // Parse scenes from textarea
  function getScenesList() {
    jsonError.textContent = "";
    const raw = scenesJsonArea.value.trim();
    if (!raw) {
      jsonError.textContent = "Vui lòng nhập danh sách Scenes dạng JSON.";
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      let list = [];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed.scenes && Array.isArray(parsed.scenes)) {
        list = parsed.scenes;
      } else {
        jsonError.textContent = "JSON phải là mảng các scene [ {id, prompt, character} ] hoặc object { scenes: [...] }";
        return null;
      }

      if (list.length === 0) {
        jsonError.textContent = "Danh sách scenes rỗng.";
        return null;
      }
      return list;
    } catch (e) {
      jsonError.textContent = "Lỗi cú pháp JSON: " + e.message;
      return null;
    }
  }

  // Tìm tab Google Flow đang mở
  async function findGoogleFlowTab() {
    // 1. Kiểm tra tab đang active trong cửa sổ hiện tại
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes("flow.google.com")) {
      return activeTab;
    }

    // 2. Tìm trong tất cả các tab của tất cả cửa sổ
    const tabs = await chrome.tabs.query({ url: "*://flow.google.com/*" });
    if (tabs && tabs.length > 0) {
      return tabs[0];
    }

    return null;
  }

  // Đảm bảo content.js đã được chèn vào tab (tránh lỗi Could not establish connection)
  async function ensureContentScriptInjected(tabId) {
    try {
      // Gửi ping thử
      const pong = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "PING" }, (resp) => {
          if (chrome.runtime.lastError || !resp) {
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });

      if (!pong) {
        console.log("[SidePanel] Đang chèn content.js vào tab...");
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"]
        });
        // Chờ 300ms sau khi inject
        await new Promise(r => setTimeout(r, 300));
      }
      return true;
    } catch (e) {
      console.error("[SidePanel] Lỗi inject content.js:", e);
      return false;
    }
  }

  // Start automation
  startBtn.addEventListener("click", async () => {
    const scenes = getScenesList();
    if (!scenes) return;

    jsonError.textContent = "";
    statusText.textContent = "Đang tìm tab Google Flow...";
    progressSection.style.display = "flex";
    progressBar.style.width = "0%";

    const tab = await findGoogleFlowTab();
    if (!tab) {
      jsonError.textContent = "Không tìm thấy tab Google Flow nào đang mở! Hãy mở tab https://flow.google.com/project/... rồi thử lại.";
      progressSection.style.display = "none";
      return;
    }

    // Focus vào tab Google Flow đó
    await chrome.tabs.update(tab.id, { active: true });

    statusText.textContent = "Đang kết nối tới trang Google Flow...";
    const ready = await ensureContentScriptInjected(tab.id);
    if (!ready) {
      jsonError.textContent = "Không thể kết nối vào tab Google Flow. Vui lòng bấm F5 lại trang Google Flow rồi thử lại!";
      progressSection.style.display = "none";
      return;
    }

    startBtn.style.display = "none";
    if (renameBtn) renameBtn.style.display = "none";
    stopBtn.style.display = "block";
    statusText.textContent = "Đang khởi động tiến trình...";

    chrome.tabs.sendMessage(tab.id, {
      action: "START_GENERATION",
      data: {
        scenes: scenes
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        jsonError.textContent = "Lỗi gửi lệnh: " + chrome.runtime.lastError.message;
        resetUI();
      }
    });
  });

  // Rename cards manually
  if (renameBtn) {
    renameBtn.addEventListener("click", async () => {
      const scenes = getScenesList();
      if (!scenes) return;

      jsonError.textContent = "";
      statusText.textContent = "Đang tìm tab Google Flow...";
      progressSection.style.display = "flex";
      progressBar.style.width = "0%";

      const tab = await findGoogleFlowTab();
      if (!tab) {
        jsonError.textContent = "Không tìm thấy tab Google Flow nào đang mở! Hãy mở tab https://flow.google.com/project/... rồi thử lại.";
        progressSection.style.display = "none";
        return;
      }

      await chrome.tabs.update(tab.id, { active: true });

      statusText.textContent = "Đang kết nối tới trang Google Flow...";
      const ready = await ensureContentScriptInjected(tab.id);
      if (!ready) {
        jsonError.textContent = "Không thể kết nối vào tab Google Flow. Vui lòng bấm F5 lại trang Google Flow rồi thử lại!";
        progressSection.style.display = "none";
        return;
      }

      startBtn.style.display = "none";
      renameBtn.style.display = "none";
      stopBtn.style.display = "block";
      statusText.textContent = "Đang bắt đầu tìm kiếm và đổi tên card...";

      chrome.tabs.sendMessage(tab.id, {
        action: "START_RENAME",
        data: {
          scenes: scenes
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          jsonError.textContent = "Lỗi gửi lệnh: " + chrome.runtime.lastError.message;
          resetUI();
        }
      });
    });
  }

  // Stop automation
  stopBtn.addEventListener("click", async () => {
    const tab = await findGoogleFlowTab();
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "STOP_GENERATION" });
    }
    statusText.textContent = "Đã gửi lệnh dừng...";
    setTimeout(resetUI, 1200);
  });

  // Lắng nghe cập nhật tiến trình từ content.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "PROGRESS_UPDATE") {
      const { current, total, text, status } = message.data;
      const pct = Math.round((current / total) * 100);
      progressBar.style.width = `${pct}%`;
      statusText.textContent = text || `Scene ${current}/${total}`;

      if (status === "COMPLETED") {
        statusText.textContent = text || `🎉 Hoàn thành ${total}/${total} scenes!`;
        progressBar.style.width = "100%";
        setTimeout(resetUI, 3500);
      } else if (status === "STOPPED") {
        statusText.textContent = "⏹ Đã dừng tiến trình.";
        setTimeout(resetUI, 2000);
      } else if (status === "ERROR") {
        statusText.textContent = "❌ Lỗi: " + (message.data.error || "Không xác định");
        resetUI();
      }
    }
  });

  function resetUI() {
    startBtn.style.display = "block";
    if (renameBtn) renameBtn.style.display = "block";
    stopBtn.style.display = "none";
  }
});
