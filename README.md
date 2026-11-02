# Lớp Học Vui Nhộn – website + trang quản trị

```
public/            Website (index.html), trang admin (admin/), ảnh (assets/)
netlify/functions/ API đăng nhập, lưu trò chơi và cài đặt (Netlify Functions + Blobs)
netlify.toml       Cấu hình Netlify
```

## Triển khai lên Netlify
Trang admin cần chạy Netlify Functions, nên **không dùng kéo-thả thư mục**. Chọn một trong hai cách:

**Cách 1 – GitHub (khuyên dùng):** đẩy thư mục này lên một repo GitHub → Netlify › Add new site › Import from Git. Netlify tự đọc `netlify.toml` (không cần nhập build command).

**Cách 2 – Netlify CLI:**
```
npm i -g netlify-cli
npm install
netlify deploy --prod
```

## Bắt buộc: đặt biến môi trường
Site configuration › Environment variables, thêm 3 biến rồi **deploy lại**:

| Biến | Ý nghĩa |
|---|---|
| `ADMIN_USERNAME` | Tên đăng nhập admin (mặc định `admin`) |
| `ADMIN_PASSWORD` | Mật khẩu ban đầu |
| `JWT_SECRET` | Chuỗi ngẫu nhiên dài ≥ 32 ký tự, giữ bí mật |

Sau khi vào `/admin`, nên đổi mật khẩu ở tab **Tài khoản** (mật khẩu mới được băm và lưu riêng, thay cho biến môi trường).

## Dùng admin
- `/admin`: đăng nhập → **Trò chơi** (thêm/sửa/ẩn/xóa, ảnh bìa, hình nền, code), **Giao diện** (tên trang, logo, banner, màu), **Tài khoản**.
- Code trò chơi chạy trong khung cách ly (`sandbox`), có sẵn `LHVN.students`, `LHVN.pick(arr)`, `LHVN.toast(text)`.
- Dùng cùng mã (id) với trò chơi có sẵn (vd. `co-caro`) để thay thế trò “Sắp ra mắt”.

## Chạy thử trên máy
`npm install` → `netlify dev` (tạo file `.env` với 3 biến ở trên).
