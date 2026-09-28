# Push Tag Để Build & Release

Workflow GitHub Actions tại `.github/workflows/build.yml` sẽ build **Editor Video App** trên Windows, macOS và Linux khi nhận tag có dạng `v*`.

```bash
git add .
git commit -m "Mô tả thay đổi"
git push origin master

# Tạo tag phát hành (ví dụ v1.1)
git tag -a v1.0 -m "Google Flow AI v1.0"

# Push tag để kích hoạt build và tạo GitHub Release
git push origin v1.0
```

Sau khi workflow hoàn tất, các gói ZIP cho ba hệ điều hành sẽ có trong GitHub Release của tag đó.

## Push Lại Tag

Khi cần build lại cùng một phiên bản (ví dụ `v1.0`) sau khi đã sửa code, xoá tag cũ ở cả máy local và GitHub, rồi tạo lại tag. Thay `v1.0` bằng đúng phiên bản cần phát hành:

```bash
# Xoá tag cũ ở local và remote
git tag -d v1.0
git push origin --delete v1.0

# Tạo lại tag tại commit hiện tại và push để kích hoạt workflow lần nữa
git tag -a v1.0 -m "Google Flow AI v1.0"
git push origin v1.0
```