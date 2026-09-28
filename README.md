# Google Flow AI Auto-Generator

Extension Chrome (Manifest V3) hỗ trợ tạo ảnh theo danh sách scene trong một dự án [Google Flow](https://flow.google.com/). Giao diện điều khiển nằm trong Side Panel; extension cũng có chức năng tìm và đổi tên các card ảnh theo mã scene.

## Cài đặt

1. Mở `chrome://extensions` trong Chrome và bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục dự án này (thư mục chứa `manifest.json`).
3. Mở một dự án trên `https://flow.google.com/project/...`, rồi bấm biểu tượng extension để mở Side Panel.

Không cần cài dependency hoặc chạy bước build.

## Sử dụng

1. Dán danh sách scene vào ô **Dữ liệu Scenes (JSON)**, hoặc chọn **Tải file .json**. Có thể bấm **Tải mẫu JSON** hoặc xem [sample_scenes.json](sample_scenes.json).
2. Bấm **Tạo ảnh**. Extension chọn chế độ Image và lần lượt gửi prompt của từng scene tới Google Flow. Nếu scene có `character`, extension sẽ tìm nhân vật cùng tên trong assets của dự án để gắn vào prompt.
3. Theo dõi tiến độ trong Side Panel; bấm **Dừng lại** để ngừng xử lý các scene tiếp theo.
4. Sau khi tạo ảnh, có thể bấm **Đổi tên Cards** để tìm card theo prompt và đổi tên thành `id` của scene (`SC01`, `SC02`, ...). Nếu một prompt có nhiều card, các card tiếp theo nhận hậu tố `_1`, `_2`, ...

Dữ liệu có thể là một mảng hoặc một object chứa mảng `scenes`:

```json
[
  {
    "id": "SC01",
    "character": "Tên nhân vật trong assets",
    "prompt": "Mô tả ảnh cần tạo"
  },
  {
    "id": "SC02",
    "character": "",
    "prompt": "Một cảnh không có nhân vật"
  }
]
```

`prompt` là nội dung dùng để tạo ảnh và tìm card khi đổi tên. `id` là tên card mong muốn; nếu bỏ trống, extension tự dùng `SC1`, `SC2`, ... `character` có thể để trống. Các trường bổ sung trong file mẫu như `character_info` và `subtitle_ids` được giữ trong JSON nhưng không tham gia thao tác tạo ảnh hoặc đổi tên.

Nội dung JSON đang nhập được lưu cục bộ qua `chrome.storage.local` để có thể mở lại Side Panel mà không phải nhập lại.

## Kiểm tra

Cần Node.js có hỗ trợ `node:test`. Chạy từ thư mục dự án:

```sh
node --test background.test.js content.test.js
```

## Phát hành

Trước khi tạo tag, cập nhật phiên bản trong `manifest.json` và thêm mục `## [phiên bản]` vào [CHANGELOG.md](CHANGELOG.md). Khi đẩy tag tương ứng (ví dụ `v1.3.0`), workflow chạy test và dùng đúng mục changelog đó làm ghi chú GitHub Release. Trong Release, tải **Source code (zip)** do GitHub cung cấp, giải nén và dùng **Load unpacked** với thư mục vừa giải nén. Có thể chạy workflow thủ công với `release_tag` là một tag đã tồn tại.

## Lưu ý

Extension chỉ chạy trên `flow.google.com` và thao tác với giao diện hiện tại của Google Flow. Khi Flow thay đổi giao diện, các thao tác tự động có thể cần được cập nhật. Quyền `debugger` được dùng để gửi cú nhấp chuột tạo ảnh tới tab dự án; Chrome có thể hiển thị thông báo debugger trong lúc đó.
