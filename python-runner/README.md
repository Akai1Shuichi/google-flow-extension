# Google Flow — Python runner đối chiếu extension

Runner độc lập dùng **Python 3.10+ và Playwright Python**, không cần cài extension hay Node.js để chạy. Python quản lý JSON, tab, tiến độ, dừng, CDP và kết quả ảnh; `workflow.js` giữ nguyên bản sao của `../content.js`. Logic gửi prompt vẫn thực thi bằng JavaScript trong isolated world của tab. `flow_results.py` bổ sung ánh xạ từng request tạo ảnh sang scene, đổi tên card theo media ID và tải ảnh gốc. Có thể sao chép riêng thư mục này ra ngoài repo để chạy.

## Cài đặt

```bash
Linux/macOS:
cd python-runner
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

windows Cmd:
```
cd python-runner
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

Windows: tạo venv bằng `py -3 -m venv .venv`, kích hoạt bằng `.venv\Scripts\Activate.ps1`. Sau khi kích hoạt, dùng `python` trong mọi lệnh dưới đây. Không cần `playwright install` vì runner kết nối Chrome đã cài sẵn.

## Đăng nhập lần đầu

Điền URL project vào `config.json`, sau đó chạy:

```bash
cd python-runner
source .venv/bin/activate
python automation login
```

Runner ưu tiên kết nối Chrome qua CDP `http://127.0.0.1:9222`. Nếu cổng local chưa chạy (ECONNREFUSED), runner tự tìm và mở Chrome thông thường bằng subprocess, có remote debugging và profile **`python-runner/chrome_data/`**. Đăng nhập Google trong cửa sổ đó, mở project rồi nhấn Enter ở terminal. Lệnh `login` không đọc scenes, không tạo ảnh và không đổi tên. Khi hoàn tất, Chrome vẫn mở; profile lưu phiên đăng nhập cho các lần sau. Bạn có thể cần đăng nhập lại khi Google hết hạn phiên.

Sau đó chỉ cần:

```bash
python automation generate
# hoặc:
python automation rename
```

`generate` mặc định gửi các prompt lần lượt trong khi ảnh vẫn render song song, chờ kết quả rồi đổi tên card và tải ảnh gốc theo `id` trong JSON. Một ảnh có tên `SC01`; nhiều ảnh có tên `SC01_1`, `SC01_2`, ... theo thứ tự trong response của chính request đó. Đuôi file giữ đúng định dạng tải về (`.jpg`, `.png`, ...), không ép thành PNG.

```powershell
python automation generate --no-download              # Chỉ đổi tên card trên Flow
python automation generate --output-dir D:\Images     # Chọn nơi lưu ảnh
python automation generate --generation-timeout 300   # Chờ response tối đa 300 giây sau khi gửi xong
python automation generate --submit-only              # Luồng cũ: chỉ gửi prompt
```

Mỗi lần chạy tạo một thư mục riêng trong `output/<run-id>/` và bảng ánh xạ `results/<run-id>.json`, tránh ghi đè ảnh của lần trước. Bảng ánh xạ chứa scene ID, media ID, tên, trạng thái và đường dẫn file; không lưu token, cookies hoặc URL ảnh có chữ ký. `--results-dir` thay nơi lưu bảng ánh xạ.

Runner quan sát request `batchexecute` chứa RPC tạo ảnh `ogiZ0b`, kiểm tra project/prompt của scene đang gửi và gắn **chính request object đó** với scene trước khi chuyển sang prompt tiếp theo. Response trả về media ID dùng để định vị card bằng `data-media-id`, nên prompt trùng và ảnh hoàn tất lệch thứ tự không làm đảo tên. Không tự gọi lại API nội bộ. Nếu Google đổi schema, trả lỗi hoặc không có đủ ID, runner báo lỗi và giữ bảng ánh xạ; không đoán theo thứ tự card. Khi timeout, response đến muộn không được đưa lại vào danh sách đổi tên.

ID phải duy nhất, dùng được làm tên file trên Windows. ID thiếu/rỗng dùng `SC1`, `SC2`, ...; ID trùng hoặc không hợp lệ bị từ chối trước khi gửi prompt. Runner cuộn danh sách CDK để tìm card chưa được dựng trong DOM khi batch dài, vẫn kiểm tra đúng media ID. Giữ project ở chế độ xem có các ảnh vừa tạo, xóa bộ lọc tìm kiếm và tránh thao tác thủ công hoặc chạy extension đồng thời trong lúc runner hoạt động.

Hai lệnh cũng tự mở Chrome khi cần. Nếu chưa thấy giao diện project, runner nhắc đăng nhập/mở project rồi nhấn Enter. Dữ liệu tài khoản chỉ lưu trong profile Chrome, không xuất cookies ra JSON. Thư mục `chrome_data/` và `chrome.log` đã được bỏ qua trong Git. Cách mở Chrome và lưu profile dựa trên `google_flow_automation.py` mà bạn cung cấp; runner không tải extension và không dùng persistent context do Playwright sở hữu, để giữ Chrome mở khi Python kết thúc.

Tùy chọn:

```bash
python automation login --profile-dir /path/to/profile-rieng
python automation login --chrome-path /path/to/google-chrome
python automation rename --no-launch
```

`--profile-dir` chỉ áp dụng khi runner tự mở Chrome; nếu đã kết nối được CDP thì dùng profile của Chrome đang nghe cổng đó. Không tự khởi động Chrome cho địa chỉ CDP từ xa, websocket URL hoặc lỗi giao thức/xác thực. Nếu profile đã mở mà không có cờ debug, đóng các cửa sổ thuộc profile đó rồi chạy lại; runner không tự tắt Chrome. Chi tiết lỗi khởi động nằm trong `chrome.log`.

## Mở Chrome debug thủ công (tùy chọn)

Linux:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-flow-python-test" https://flow.google.com/
```

macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-flow-python-test" https://flow.google.com/
```

Windows PowerShell:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\ChromeFlowPythonTest" https://flow.google.com/
```

Đăng nhập trong profile thử nghiệm rồi mở project `https://flow.google.com/project/...`. Nếu profile thử nghiệm đã chạy mà thiếu cờ debug, thoát các cửa sổ của profile đó rồi mở lại bằng lệnh trên. Kiểm tra `http://127.0.0.1:9222/json/version` trả JSON. Có thể dùng `--no-launch` để chỉ kết nối Chrome đã mở sẵn; lỗi sẽ kèm lệnh hướng dẫn mở Chrome.

Tắt luồng tự động của extension khi so sánh để hai tiến trình không cùng sửa ô prompt. Chạy `generate` thực sự gửi lệnh tạo ảnh; `rename` thực sự đổi tên các card tìm được.

## Chạy nhanh bằng hai file JSON

1. Thay nội dung `sample.json` bằng danh sách scene của bạn.
2. Nhập URL project đang mở trong Chrome debug vào `config.json`:

```json
{
  "project_url": "https://flow.google.com/project/ID_DU_AN_CUA_BAN"
}
```

Sau khi cài dependencies và kích hoạt venv (Chrome được tự mở nếu cần):

```bash
cd python-runner
python automation generate
python automation rename
```

Chỉ chạy một lệnh tùy chức năng cần dùng. `automation` là file chạy tắt cho `automation.py`; cả hai cách đều hoạt động. Hai file mặc định được tìm cạnh script, không phụ thuộc thư mục làm việc hiện tại. `config.json` ban đầu để trống URL: phải điền project thật trước khi chạy. Runner báo rõ nếu URL chưa được nhập.

## Các tham số tùy chọn

```bash
python automation.py --help
python automation.py generate --help
python automation.py rename --help

# Lệnh trần tương đương generate với sample.json và config.json cạnh script:
python automation.py

python automation.py generate --input sample.json --project-url 'https://flow.google.com/project/PROJECT_ID'
python automation.py rename --input sample.json --project-url 'https://flow.google.com/project/PROJECT_ID'

# Cổng / timeout kết nối khác (milliseconds):
python automation.py generate --input /path/to/scenes.json --cdp-url http://127.0.0.1:9333 --connect-timeout 15000
```

`--config path/to/config.json` chọn file cấu hình khác. `--input` ghi đè file scene mặc định; `--project-url` ghi đè URL trong cấu hình (khi có cờ này không cần đọc config).

`--project-url` ưu tiên chọn tab đã mở; nếu chưa có tab project tương ứng, runner mở project để bạn đăng nhập. Ưu tiên URL trùng hoàn toàn, sau đó cùng project ID (cho phép khác query/hash). Không truyền cờ URL: tự đọc `project_url` từ `config.json`. Khi có nhiều tab của cùng project, ưu tiên URL trùng hoàn toàn, rồi tab có `document.hasFocus()`; nếu vẫn mơ hồ thì báo lỗi. Python không có API tương đương `chrome.tabs.query({active:true,currentWindow:true})`; đây là khác biệt có chủ ý ở tầng chọn tab. Runner đưa tab được chọn ra trước.

Dữ liệu nhận mảng scene hoặc object `{"scenes": [...]}` giống Side Panel. `generate` mặc định kiểm tra thêm ID để đặt tên file an toàn; `--submit-only` và `rename` giữ cách xử lý đầu vào cũ. `prompt` dùng `(scene.prompt || "").trim()`; `character` được ép chuỗi, tách `;`, trim và bỏ tên rỗng. Trường bổ sung như `character_info`, `subtitle_ids`, `motion`, `start_at`, `end_at` giữ trong dữ liệu nhưng workflow không sử dụng.

Mẫu có ba scene với nhân vật khác nhau, gồm scene không có nhân vật. Tạo asset tên **Robot Lam**, **Robot Cam** trong project thử nghiệm hoặc thay tên trong JSON bằng asset đã có. Runner không tự tạo asset; asset thiếu khi side-nav tồn tại sẽ báo lỗi giống extension.

Ctrl+C gửi `STOP_GENERATION`, chờ điểm kiểm tra dừng hiện có khi gửi prompt. Khi đang chờ kết quả, runner kiểm tra dừng mỗi 200ms; thao tác đổi tên/tải đang thực hiện kết thúc hoặc hết timeout trước khi thoát. Không rollback lượt tạo đã gửi. Bảng ánh xạ giữ kết quả đã có và đánh dấu các scene chưa hoàn tất là `stopped`; lần chạy bị ngắt ngoài ý muốn dùng `interrupted`. Không tự tiếp tục hoặc gửi lại lượt tạo. CLI trả mã 130 nếu đã nhận Ctrl+C, 1 nếu lỗi, 0 nếu hoàn thành. Chrome và các tab vẫn mở.

## Luồng thực tế đã xác định

- `manifest.json`: MV3, background `background.js`, content script `content.js` trên `https://flow.google.com/*`, giao diện `sidepanel.html`.
- Background gọi `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`. Không có `action.default_popup`; `popup.html`/`popup.js` còn trong repo nhưng không được manifest gắn vào action.
- Side Panel đọc/dán/upload JSON, lưu `savedJson`, tìm/focus tab, ping rồi inject `content.js` nếu cần (chờ 300ms sau inject). Hai nút gọi `START_GENERATION` và `START_RENAME`; nút dừng gọi `STOP_GENERATION`.
- Generation: chọn Image một lần → tìm ProseMirror (thiếu thì đợi 2000ms và thử lại một lần) → từng scene theo thứ tự. **`configureSettings()` không được gọi**: không tự chọn tỷ lệ hay output count, không có subcommand settings.
- Từng scene: xóa prompt/chip → gắn từng character → chèn prompt → tìm nút tạo → đọc lại tọa độ và gửi mousePressed/mouseReleased → ghi nhận request của scene → chờ editor trống → chờ 4000ms. Sau khi gửi xong, Python thu kết quả, kiểm tra ánh xạ, đổi tên theo media ID và tải ảnh. `COMPLETED` chỉ in sau khi các bước đó thành công; `--submit-only` chỉ xác nhận đã gửi prompt như trước.
- Lệnh `rename` cũ vẫn độc lập: tìm bằng prompt và đổi tên tất cả card trong kết quả theo thứ tự DOM. Lệnh này có thể khớp cả ảnh cũ khi prompt trùng. `generate` dùng `flow_results.py` để đổi tên đúng kết quả của từng request, không gọi hàm tìm theo prompt này.

## Bảng đối chiếu

| Extension đang gọi | Python / bản DOM đóng gói | Hành vi giữ nguyên |
|---|---|---|
| `sidepanel.js:getScenesList` | `load_scenes` | Mảng hoặc object scenes, không rỗng; không chuẩn hóa từng scene |
| `findGoogleFlowTab`, `tabs.update` | `connect_browser`, `prepare_page`, `select_page` | Ưu tiên CDP/tab đã mở; hỗ trợ tự mở Chrome, project và đăng nhập theo yêu cầu bổ sung |
| `ensureContentScriptInjected`, PING | `Runner.install`, `bridge.js` | Tạo isolated world, gắn snapshot; không cần extension messaging/inject retry |
| `START_GENERATION → runWorkflow` | `Runner.run_generation → Runner.run` → `workflow.js:runWorkflow` | Chọn Image, editor retry, thứ tự scene, fail-fast |
| `selectImagesTab` | `workflow.js:selectImagesTab` | Image hiện có → model/settings radio/menu → tab Images cũ; chờ 300/1000ms |
| `processScene` | `workflow.js:processScene` | Clear 200ms, xóa editor 300ms, remove chip 200ms/chip, chèn prompt 600ms |
| `selectCharacter` | `workflow.js:selectCharacter` | Asset tên khớp không phân biệt hoa/thường; preview Add; kiểm tra chip tăng; side-nav lỗi thì không fallback @ |
| `selectCharacter` fallback @ | cùng hàm DOM | Chỉ khi không có side-nav; focus 200ms, gõ @ chờ 800ms, chọn option hoặc Enter tổng hợp, đợi 400ms; không thêm kiểm tra chip |
| Chờ Generate | `workflow.js:processScene` | Đúng thứ tự 7 selector, tối đa 20 vòng × 200ms; bỏ qua lỗi selector |
| `TRUSTED_GENERATE_CLICK` background | `Runner.trusted_generate_click` | Kiểm tra URL project, session CDP tạm, đọc lại tọa độ bằng selector của background, mousePressed/Released, detach trong finally |
| Chờ prompt được nhận | `workflow.js:processScene` | Tối đa 20 vòng × 200ms; editor biến mất hoặc rỗng là thành công; thêm 4000ms sau gửi |
| `START_RENAME → runRenameWorkflow` | `Runner.run_rename` → `workflow.js:runRenameWorkflow` | Search 1500ms, hover 200ms, More 400ms, Rename 400ms, Enter 600ms, xóa search 800ms |
| Hậu tố đổi tên | cùng hàm DOM | Card đầu `id`, tiếp theo `id_1`, `id_2`; không tìm được nút/input thì bỏ qua như gốc |
| Lỗi rename từng card | cùng hàm DOM, log qua `Runner._message` | Log rồi tiếp tục; lỗi ngoài vòng card dừng workflow |
| `PROGRESS_UPDATE` / console | `bridge.js` → `Runner._message` | In từng bước, scene/character, trạng thái và lỗi cụ thể |
| `STOP_GENERATION` | `Runner.stop` | Cùng cờ và vị trí kiểm tra dừng; không cắt ngang tác vụ đã gửi |

`workflow.js` vẫn chứa hàm `configureSettings` do là snapshot nguyên byte; hàm đó vẫn không được gọi. Snapshot không tự đọc mã extension lúc chạy: sau khi extension thay đổi cần rà lại luồng và cập nhật snapshot có chủ ý. Test so sánh byte sẽ phát hiện sự lệch này khi chạy trong repo.

## Phần không thể chuyển 1:1 từ Extension API

| Chrome Extension API | Thay thế / giới hạn |
|---|---|
| Action icon, sidePanel, popup, file picker/download Blob | CLI và JSON trên đĩa; không có panel/UI, nút tải mẫu dùng file mẫu đóng gói |
| `chrome.storage.local.savedJson` | Không đọc/ghi kho extension; mỗi lần đọc file `--input` |
| `chrome.tabs` active/currentWindow | Playwright pages + URL + focus; không có tab ID/cửa sổ active tương đương hoàn toàn; chọn/mở project hợp lệ, có bước đăng nhập thủ công |
| Manifest host permission và content script tự inject `document_idle` | CDP có sẵn hoặc tự mở Chrome local bằng profile riêng; cài snapshot khi chạy trong isolated world của main frame; không tự chạy khi mở trang |
| `chrome.runtime.sendMessage` và listener | `bridge.js` + CDP Runtime binding chuyển thông điệp trong cùng workflow tới Python; không giao tiếp với extension thật |
| `chrome.debugger.attach(..., '1.3')` | Session CDP Playwright; không tái tạo bảng thông báo debugger/đổi viewport/quy tắc xung đột debugger của extension; vẫn đọc lại tọa độ sau khi tạo session |
| Extension stop/UI reset timer | Ctrl+C với các checkpoint gốc; không mô phỏng timer reset UI 1200/2000/3500ms hay cache UI |

Các thao tác DOM khác vẫn dùng `.click()`, `execCommand`, `KeyboardEvent`, `MouseEvent` tổng hợp như bản gốc; không thay bằng `locator.fill/click/press` để tránh thêm auto-wait và thay `isTrusted`. Riêng Generate luôn gửi chuột qua CDP. Việc thiết lập bridge và IPC Python thêm một ít độ trễ; các thời gian sleep và giới hạn retry của workflow giữ nguyên.

Profile remote debugging riêng phù hợp với [quy định Chrome từ phiên bản 136](https://developer.chrome.com/blog/remote-debugging-port). Tham khảo chính thức: [Playwright connect_over_cdp](https://playwright.dev/python/docs/api/class-browsertype#browser-type-connect-over-cdp), [CDP sessions](https://playwright.dev/python/docs/api/class-cdpsession), [Playwright.stop](https://playwright.dev/python/docs/api/class-playwright#playwright-stop).

## Xác minh

Yêu cầu gốc dừng ở dòng mở block của mục 7, nên bộ kiểm tra dưới đây được chọn theo các yêu cầu 1–6:

```bash
# Trong python-runner, đã kích hoạt venv:
python -m py_compile automation.py
python automation.py --help
python automation.py generate --help
python automation.py rename --help
python -m unittest -v

# Từ thư mục repo, Node chỉ cần cho test extension hiện có:
node --test background.test.js content.test.js
```

Test Python kiểm tra tự mở Chrome local, lưu phiên giả qua lần khởi động lại, ngắt CDP vẫn giữ Chrome, login, schema, CLI và snapshot nguyên byte. Test batch qua subprocess/CDP mô phỏng prompt trùng, response hoàn tất ngược thứ tự và thứ tự DOM đảo ngược; test unit kiểm tra schema lạ, thiếu/trùng ID, lỗi network/HTTP, timeout, response đến muộn và dừng giữa các output. Các test gửi POSIX SIGINT bị bỏ qua trên Windows vì subprocess không hỗ trợ tín hiệu này; test logic dừng kết quả vẫn chạy. Các test browser mặc định dùng `/usr/bin/google-chrome`; đặt `FLOW_TEST_CHROME` nếu đường dẫn Chrome khác. Test tạo và đóng **Chrome của test**, không kết nối Chrome của người dùng.

Đối chiếu thủ công trên Google Flow thật: dùng cùng file JSON, cùng project/model/settings ban đầu, chạy từng công cụ riêng; kiểm tra nhân vật của từng scene (kể cả scene rỗng), thứ tự prompt, lỗi asset thiếu, tên card/hậu tố và Ctrl+C. Runner không tự thay cấu hình model/tỷ lệ/output. Kết quả fixture không chứng minh UI Google Flow hiện tại hoặc việc sinh ảnh trên tài khoản thật đã hoạt động.
