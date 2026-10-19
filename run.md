# Push Tag Để Phát Hành Extension

Workflow `.github/workflows/build.yml` chạy kiểm thử Node.js và tạo GitHub Release khi nhận tag `v*`. Extension không cần build. GitHub cung cấp **Source code (zip)** trong Release; giải nén rồi dùng **Load unpacked** trong Chrome.

## Chuẩn bị phiên bản

Phiên bản trong `manifest.json`, tiêu đề trong `CHANGELOG.md` và tag phải khớp nhau. Ví dụ, manifest có `"version": "1.4.0"` thì changelog cần mục `## [1.4.0]` có nội dung và tag là `v1.4.0`.

Commit toàn bộ thay đổi code cần phát hành, rồi chạy từ thư mục dự án bằng PowerShell:

```powershell
# Lấy phiên bản từ manifest và kiểm tra ghi chú trước khi tạo tag
$releaseVersion = (Get-Content -Raw manifest.json | ConvertFrom-Json).version
$releaseTag = "v$releaseVersion"
node -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version; const lines = fs.readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/); const start = lines.indexOf(`## [${version}]`); if (start < 0) throw new Error(`Missing changelog section for ${version}`); const next = lines.findIndex((line, index) => index > start && /^## \[/.test(line)); if (!lines.slice(start + 1, next < 0 ? undefined : next).join("\n").trim()) throw new Error(`Empty changelog section for ${version}`); console.log(`Release notes OK: v${version}`);'
if ($LASTEXITCODE -ne 0) { throw 'Hãy cập nhật CHANGELOG.md trước khi phát hành.' }

node --test *.test.js
if ($LASTEXITCODE -ne 0) { throw 'Kiểm thử thất bại.' }

git add manifest.json CHANGELOG.md README.md run.md
git commit -m "Prepare release $releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'Commit thất bại; kiểm tra trạng thái Git trước khi tiếp tục.' }
git push origin master
if ($LASTEXITCODE -ne 0) { throw 'Push branch thất bại.' }
git tag -a $releaseTag -m "Google Flow AI $releaseTag"
if ($LASTEXITCODE -ne 0) { throw 'Tạo tag thất bại; kiểm tra tag đã tồn tại hay chưa.' }
git push origin $releaseTag
```

Khi phát hành phiên bản mới, cập nhật manifest, README và thêm mục changelog tương ứng trước khi tạo tag.

## Khi gặp lỗi `Missing changelog section for 1.2`

Tag `v1.2` yêu cầu đúng mục `## [1.2]` trong changelog tại commit được tag. Mục `## [1.4.0]` hoặc `## [1.5.0]` không thay thế cho mục này.

Nếu muốn phát hành phiên bản hiện tại trong manifest, dùng tag tương ứng theo hướng dẫn trên. Nếu cần giữ tên `v1.2`, phải chuẩn bị manifest và changelog cho đúng phiên bản `1.2` trước khi tag.

Workflow checkout commit của tag, nên sửa changelog trên `master` rồi bấm **Re-run jobs** cho tag cũ vẫn đọc nội dung cũ. Chạy thủ công với `release_tag` cũng checkout tag đó. Để phát hành bản sửa, tạo tag phiên bản mới tại commit đã sửa. Chỉ thay thế tag cũ khi chắc chắn chưa có người dùng dựa vào tag đó.
