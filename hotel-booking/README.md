# Quản lý đặt phòng khách sạn

Ứng dụng Node.js/Express/EJS, PostgreSQL và Docker Compose. Giao diện tiếng Việt cho khách đặt phòng công khai và nhân viên quản lý nội bộ. Phiên bản hiện tại: `1.0.0-rc.1`.

## Chức năng

- Tìm phòng theo ngày, hạng và sức chứa; máy chủ tính giá và kiểm tra trùng lịch.
- Đơn công khai chờ lễ tân xác minh/duyệt trong thời gian giữ phòng 2 giờ; đơn nhân viên tạo được xác nhận ngay.
- Hồ sơ khách không bị ghi đè bởi email trùng; lưu riêng liên hệ và số khách trong đơn.
- Quản lý phòng, khách hàng, đặt/nhận/trả phòng, đổi phòng, gia hạn, phụ thu và dọn phòng.
- Thu/hoàn tiền mặt, chuyển khoản, ví điện tử bằng xác nhận thủ công; phiếu có mã và lịch sử nhân viên thực hiện.
- Sửa sai/thu hoàn sau trả phòng do lễ tân lập yêu cầu và quản trị duyệt; giữ nguyên giao dịch gốc.
- Đối soát theo ngày Việt Nam, công nợ hiện tại và biên bản chênh lệch.
- Tài khoản riêng cho nhân viên: đổi mật khẩu, mật khẩu tạm, khóa/mở và thu hồi phiên.

Quản trị quản lý danh mục/tài khoản và xóa hồ sơ theo quyền. Lễ tân xử lý lưu trú, thu/hoàn thông thường; không tự nâng quyền hoặc duyệt sửa sai của mình. API kiểm tra quyền và CSRF ở backend.

Nhận phòng từ 14:00, trả trước 12:00 giờ Việt Nam. Trả sớm không tự giảm tiền; phí trả muộn nhập có lý do. Phòng phải sẵn sàng trước nhận khách. Thông tin phòng/giá lịch sử và sổ tiền được giữ khi danh mục thay đổi.

## Cài đặt trên Windows

Cần Docker Desktop chạy Linux containers/WSL 2, Docker Compose, Node.js 24 trên máy vận hành và Internet để tải image/dependency lần đầu.

Mở PowerShell trong thư mục `hotel-booking`:

```powershell
Copy-Item .env.example .env
notepad .env
```

Thay các giá trị `CHANGE_ME` bằng mật khẩu riêng; `SESSION_SECRET` ngẫu nhiên ít nhất 32 ký tự. Mật khẩu tài khoản khởi tạo cần 12–128 ký tự. Không chia sẻ `.env` hoặc `secrets` lên GitHub.

```powershell
cd backend
npm.cmd ci
cd ..
docker compose config --quiet
node backend/scripts/secure-deploy.cjs
```

Quy trình chuẩn bị bí mật, sao lưu, chạy migration bằng tài khoản riêng, cấp quyền ứng dụng rồi khởi động dịch vụ. PostgreSQL không công bố cổng ra máy ngoài. Cài mới mặc định `SEED_DEMO_DATA=false`, không nạp phòng/khách/đơn mẫu: quản trị nhập danh mục phòng trước khi sử dụng.

Tài khoản ban đầu lấy từ `STAFF_ADMIN_USERNAME`/`STAFF_ADMIN_PASSWORD` và `STAFF_RECEPTION_USERNAME`/`STAFF_RECEPTION_PASSWORD`. Chỉ tạo khi username chưa tồn tại; sửa `.env` không tự đổi mật khẩu hoặc mở khóa tài khoản đã lưu. Dùng trang Nhân viên để quản lý tài khoản.

## Địa chỉ

| Thành phần | Địa chỉ |
|---|---|
| Website | http://localhost |
| Đăng nhập | http://localhost/login |
| pgAdmin | http://localhost:5050 |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Hòm cảnh báo cục bộ | http://localhost:9094 |

Các cổng mặc định chỉ bind localhost. `/live` kiểm tra tiến trình; `/ready` và `/health` truy vấn DB thực, trả 503 khi không phục vụ được. `/metrics` chỉ cho giám sát nội bộ có token.

## Chạy, dừng và cập nhật

```powershell
docker compose up -d --wait
docker compose ps
docker compose stop
```

Sau khi sửa mã, dùng `node backend/scripts/secure-deploy.cjs` để build/cập nhật theo đúng thứ tự migration và quyền. Không dùng `docker compose down -v` khi có dữ liệu cần giữ.

Chạy giao diện riêng khi phát triển:

```powershell
cd backend
npm.cmd ci
npm.cmd run dev
```

Mở http://localhost:5000. Development có thể dùng RAM khi chưa có DB; dữ liệu RAM mất khi khởi động lại. Production bắt buộc PostgreSQL.

## Cấu trúc mã

| Nội dung | Vị trí |
|---|---|
| Trang và thành phần giao diện chung | `backend/views/pages`, `backend/views/partials` |
| JavaScript riêng từng trang | `backend/public/js/pages` |
| CSS | `backend/public/css` |
| Routes API và trang | `backend/src/routes` |
| Tài khoản/phân quyền | `backend/src/auth` |
| Đặt phòng/lưu trú/lịch sử | `backend/src/bookings` |
| Phiếu, duyệt và đối soát | `backend/src/finance` |
| Triển khai/sao lưu | `backend/scripts` |
| Nginx và giám sát | `nginx`, `prometheus`, `grafana`, `loki`, `alloy`, `alertmanager` |

Trang `/system` đã được loại bỏ. Sửa một trang từ template và module của trang đó; giao diện dùng ES modules và event listener để tương thích CSP.

## Sao lưu và vận hành

```powershell
node backend/scripts/backup.cjs
docker compose logs --tail 100 backend
docker compose logs --tail 100 postgres
```

Bản sao SQL nằm trong `backups`, có thông tin nhạy cảm: giữ bản sao ngoài máy và phục hồi vào DB riêng để kiểm chứng. Khôi phục cần đúng role/bí mật, nạp bằng `psql -v ON_ERROR_STOP=1`, cấp lại quyền và đối chiếu dữ liệu. Không khôi phục đè DB đang có giao dịch mới mà chưa xử lý chênh lệch.

Ứng dụng dùng quyền DB hạn chế; migration dùng tài khoản riêng. Alloy đọc log backend qua volume, không có Docker socket; Loki giữ 7 ngày. Log Docker tối đa 10 MB × 3 file/container, log app 5 MB × 5 file. Có cảnh báo dịch vụ/DB, lỗi HTTP, đĩa và sao lưu lỗi/cũ. cAdvisor là profile tùy chọn có quyền host, mặc định tắt.

Trên Windows, có thể cài bộ đo ổ dự án theo phút, chạy khi người dùng đăng nhập:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/windows/install-host-observer.ps1
```

## Trước khi vận hành công khai

Hiện dùng để chạy thử localhost; cần xử lý/đánh giá các CVE image hạ tầng đã phát hiện, cấu hình tên miền/HTTPS thật và cookie Secure, thay bí mật khởi tạo, chốt sao lưu ngoài máy/RPO/RTO, người nhận cảnh báo và người hỗ trợ. Công cụ cùng máy không tự báo được khi toàn máy ngừng hoạt động.

Thanh toán kiểm tra thủ công, chưa có cổng thanh toán hoặc hóa đơn điện tử. Chưa có đối soát theo ca hay công nợ cuối ngày quá khứ. Kết quả kỹ thuật không thay nghiệm thu của khách hàng.
