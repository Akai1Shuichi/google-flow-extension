# Changelog

Các thay đổi đáng chú ý của Google Flow AI Auto-Generator được ghi theo phiên bản extension trong `manifest.json`.

## [1.0]

- Tạo ảnh lần lượt từ danh sách scene JSON trong Google Flow.
- Hỗ trợ gắn nhân vật theo trường `character` của từng scene.
- Thêm Side Panel để theo dõi tiến độ, dừng xử lý và đổi tên card theo mã scene.
- Thêm kiểm thử Node.js và quy trình phát hành GitHub Release theo tag.

## [1.1]
- Thêm nhiều tham chiếu nhân vật bằng dấu chấm phẩy (`;`) trong trường `character`.
Ví dụ: `"character": "Người chồng; Người vợ"` sẽ tìm và gắn cả hai nhân vật vào prompt.