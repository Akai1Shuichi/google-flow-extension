# Changelog

Các thay đổi đáng chú ý của Google Flow AI Auto-Generator được ghi theo phiên bản extension trong `manifest.json`.

## [1.4.0]

- Ghép ánh xạ scene → request → media ID vào extension, giữ render song song và đổi đúng tên khi prompt trùng hoặc kết quả về lệch thứ tự.
- Tự đổi tên đúng card theo media ID sau khi tạo; không tự tải ảnh về máy.
- Lưu ánh xạ/trạng thái cục bộ, xử lý timeout, dừng, mất debugger và chuyển project; không lưu token hoặc URL có chữ ký.
- Bổ sung kiểm thử core/background và kiểm thử extension thật trong Chromium với dữ liệu HTTPS local.

## [1.0]

- Tạo ảnh lần lượt từ danh sách scene JSON trong Google Flow.
- Hỗ trợ gắn nhân vật theo trường `character` của từng scene.
- Thêm Side Panel để theo dõi tiến độ, dừng xử lý và đổi tên card theo mã scene.
- Thêm kiểm thử Node.js và quy trình phát hành GitHub Release theo tag.

## [1.1]
- Thêm nhiều tham chiếu nhân vật bằng dấu chấm phẩy (`;`) trong trường `character`.
Ví dụ: `"character": "Người chồng; Người vợ"` sẽ tìm và gắn cả hai nhân vật vào prompt.
