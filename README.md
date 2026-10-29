# Google Flow AI Auto-Generator

Extension Chrome (Manifest V3, bản 1.2) tạo ảnh hàng loạt trong [Google Flow](https://flow.google.com/) và tự đổi tên đúng card theo ID scene. Giao diện điều khiển nằm trong Side Panel. Cần Chrome 118 trở lên.

## Cài đặt

1. Mở `chrome://extensions` trong Chrome và bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục dự án này (thư mục chứa `manifest.json`).
3. Mở một dự án trên `https://flow.google.com/project/...`, rồi bấm biểu tượng extension để mở Side Panel.

Không cần cài dependency hoặc chạy bước build.

Nếu đã cài bản cũ, bấm **Reload** extension trong `chrome://extensions`, rồi **F5 tab Flow** và mở lại Side Panel để nhận đầy đủ script mới.

Luồng tạo ảnh và tự đổi tên hỗ trợ giao diện Flow tiếng Anh hoặc tiếng Việt. Tên nhân vật và prompt có thể dùng cả hai ngôn ngữ; giữ dấu tiếng Việt trong tên để khớp đúng asset của dự án. Extension chờ chip ảnh tham chiếu xuất hiện trước khi gửi prompt.

## Sử dụng

1. Dán danh sách scene vào ô **Dữ liệu Scenes (JSON)**, hoặc chọn **Tải file .json**. Có thể bấm **Tải mẫu JSON** hoặc xem [sample_scenes.json](sample_scenes.json).
2. Bấm **Tạo ảnh**. Extension gửi lần lượt từng prompt trong khi các ảnh vẫn render song song. Nếu scene có `character`, extension tìm từng nhân vật trong assets của dự án để gắn vào prompt.
3. Theo dõi tiến độ trong Side Panel; bấm **Dừng lại** để ngừng xử lý các scene tiếp theo.
4. Sau khi gửi xong prompt, extension chờ response của từng request, lấy media ID rồi tự đổi tên đúng card. Một ảnh có tên `SC01`; nhiều ảnh có tên `SC01_1`, `SC01_2`, ... theo thứ tự trong response. Prompt trùng hoặc ảnh hoàn tất ngược thứ tự không làm đảo tên. Danh sách dài được cuộn để tìm đúng media ID.

Dữ liệu có thể là một mảng hoặc một object chứa mảng `scenes`. Chỉ cần các trường `id`, `character`, `prompt`; không bắt buộc `character_info`, `subtitle_ids` hay metadata khác. Ô nhập và tải file đều chấp nhận dấu phẩy thừa cuối object hoặc mảng (ví dụ sau `prompt`):

```json
[
  {
    "id": "SC01",
    "character": "Người chồng; Người vợ",
    "prompt": "Mô tả ảnh cần tạo"
  },
  {
    "id": "SC02",
    "character": "",
    "prompt": "Một cảnh không có nhân vật"
  }
]
```

`prompt` phải là chuỗi không rỗng. `id` là tên card/file mong muốn; nếu bỏ trống, extension tự dùng `SC1`, `SC2`, ... ID phải duy nhất, không chứa ký tự cấm hoặc tên dành riêng của Windows. Các lỗi này được kiểm tra trước khi gửi prompt. `character` có thể để trống, chứa một tên, hoặc chứa nhiều tên ngăn cách bằng dấu chấm phẩy (`;`), dấu phẩy (`,`) hoặc kết hợp cả hai, ví dụ `"character": "Người chồng; Người vợ, Người con"`. Extension bỏ khoảng trắng thừa quanh mỗi tên, bỏ qua tên rỗng và gắn từng asset trùng tên trước khi gửi prompt. Các trường bổ sung như `character_info` và `subtitle_ids` được giữ trong JSON nhưng không tham gia thao tác tạo ảnh hoặc đổi tên.

Nội dung JSON đang nhập được lưu cục bộ qua `chrome.storage.local` để có thể mở lại Side Panel mà không phải nhập lại.

Kết quả lượt chạy gần nhất được lưu trong `chrome.storage.local.flowLastBatch`: scene ID, media ID, tên và trạng thái. Không lưu request body, token, cookies hoặc URL ảnh có chữ ký. Nếu Flow đổi schema, thiếu ID hoặc trả lỗi, extension báo lỗi và giữ ánh xạ; không đoán theo thứ tự card. Chờ response tối đa 180 giây sau khi gửi xong. Dừng không hủy lượt tạo đã gửi trên máy chủ; các scene chưa xử lý hết không bị ghi là hoàn tất.

Nếu kết nối request bị ngắt, extension kiểm tra response và dữ liệu đã nhận qua stream của chính request đó trước khi báo lỗi. Chỉ tiếp tục đổi tên khi HTTP 200 và đã nhận đủ media ID hợp lệ; không gửi lại lệnh tạo ảnh. Nếu thiếu kết quả, thông báo kèm mã lỗi mạng để chẩn đoán.

## Kiểm tra

Cần Node.js có hỗ trợ `node:test`. Chạy từ thư mục dự án:

```sh
node --test *.test.js
```

Test đầy đủ extension: cài Playwright và Chromium, có OpenSSL trong PATH, rồi chạy từ `python-runner`:

```sh
python -m unittest test_extension -v
```

Test nạp extension thật vào Chromium với profile riêng, bấm qua Side Panel, mô phỏng hai prompt trùng trả kết quả ngược thứ tự và xác nhận đổi đúng bốn card mà không tải file về máy. Test không tạo ảnh trên tài khoản Google.

## Phát hành

Trước khi tạo tag, cập nhật phiên bản trong `manifest.json` và thêm mục `## [phiên bản]` vào [CHANGELOG.md](CHANGELOG.md). Khi đẩy tag tương ứng (ví dụ `v1.3.0`), workflow chạy test và dùng đúng mục changelog đó làm ghi chú GitHub Release. Trong Release, tải **Source code (zip)** do GitHub cung cấp, giải nén và dùng **Load unpacked** với thư mục vừa giải nén. Có thể chạy workflow thủ công với `release_tag` là một tag đã tồn tại.

## Lưu ý

Extension thao tác với giao diện hiện tại của Google Flow. Giữ chế độ xem All media/Images, xóa bộ lọc tìm kiếm và tránh thao tác cùng runner Python trong khi chạy. Nếu Flow đổi giao diện hoặc schema RPC, extension cần được cập nhật.

Quyền [debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger) dùng để bấm Generate và quan sát request/response trong suốt batch; Chrome hiển thị thanh thông báo debugger. Đóng DevTools của tab khi chạy để tránh giành phiên debugger. Extension không gọi lại API tạo ảnh.
