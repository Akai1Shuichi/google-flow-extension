# Phát hành Google Flow AI Auto-Generator

Workflow tại `.github/workflows/build.yml` chạy test và tạo GitHub Release khi đẩy tag dạng `v*`. GitHub tự cung cấp **Source code (zip)** trong Release; extension không cần build riêng cho từng hệ điều hành.

Trước khi tạo tag, cập nhật phiên bản trong `manifest.json` và thêm mục `## [phiên bản]` tương ứng vào `CHANGELOG.md`. Ví dụ tag `v1.0` sẽ dùng ghi chú dưới mục `## [1.0]`.

```bash
git add manifest.json CHANGELOG.md .github/workflows/build.yml README.md run.md
git commit -m "Prepare v1.0 release"
git push origin master

git tag -a v1.0 -m "Google Flow AI v1.0"
git push origin v1.0
```

Sau khi workflow hoàn tất, mở GitHub Release của tag để xem ghi chú và tải **Source code (zip)**. Giải nén ZIP rồi dùng **Load unpacked** trong Chrome với thư mục chứa `manifest.json`.

Nếu cần chạy lại workflow cho cùng tag, dùng **Run workflow** trên GitHub Actions và nhập tag đã tồn tại vào `release_tag`. Workflow sẽ cập nhật ghi chú của Release hiện có theo changelog trong tag đó.
