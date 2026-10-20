# Kế hoạch cải thiện hệ thống trước khi bàn giao

Cập nhật: 21/10/2026.

Thực hiện theo thứ tự bên dưới. Đánh dấu `[x]` khi công việc đã được kiểm tra và có bằng chứng hoàn thành. Một giai đoạn chỉ được tính là hoàn tất khi đạt điều kiện nghiệm thu của giai đoạn đó.

## Hiện trạng và cách theo dõi

- Đã có đăng nhập, đăng xuất và phân quyền quản trị/lễ tân; bảo vệ hồ sơ khách khi đặt bằng email trùng; giới hạn và lưu số khách; nhận/trả phòng và ghi nhận thu/hoàn tiền cơ bản.
- Lần rà soát gần nhất: 15/15 kiểm thử tự động đạt trên dữ liệu RAM. Kết quả này chưa chứng minh hệ thống sẵn sàng vận hành thực tế.
- Cập nhật mục 1: Docker Engine đã khởi động, 10 container đang chạy, PostgreSQL chấp nhận kết nối; website, Grafana và Prometheus phản hồi HTTP 200. Chưa thay thế kiểm thử toàn bộ hệ thống và phục hồi dữ liệu.
- Tiến độ bên dưới chỉ tính các hạng mục cải thiện mới; không có nghĩa là dự án hiện tại chưa có chức năng.
- Chưa ấn định thời hạn. Điền người phụ trách và ngày dự kiến sau khi chốt phạm vi với khách hàng.

## Bảng tiến độ tổng thể

| Bước | Giai đoạn | Trạng thái | Phụ trách | Ngày dự kiến | Ngày hoàn tất |
| --- | --- | --- | --- | --- | --- |
| 1 | Chốt phạm vi và bảo vệ dữ liệu | Chờ nghiệm thu: xác nhận phạm vi | — | — | — |
| 2 | Bảo vệ luồng đặt phòng công khai | Chưa bắt đầu | — | — | — |
| 3 | Quản lý tài khoản nhân viên | Chưa bắt đầu | — | — | — |
| 4 | Bảo vệ môi trường triển khai | Chưa bắt đầu | — | — | — |
| 5 | Giữ nguyên lịch sử đặt phòng | Chưa bắt đầu | — | — | — |
| 6 | Hoàn thiện nghiệp vụ lưu trú | Chưa bắt đầu | — | — | — |
| 7 | Thanh toán và đối soát | Chưa bắt đầu | — | — | — |
| 8 | Sao lưu và khôi phục tự động | Chưa bắt đầu | — | — | — |
| 9 | Giám sát và vận hành | Chưa bắt đầu | — | — | — |
| 10 | Kiểm thử nghiệm thu và bàn giao | Chưa bắt đầu | — | — | — |

Trạng thái sử dụng: **Chưa bắt đầu → Đang thực hiện → Chờ nghiệm thu → Hoàn tất**. Nếu bị chặn, ghi rõ nguyên nhân và việc cần giải quyết trong mục nhật ký.

## 1. Chốt phạm vi và bảo vệ dữ liệu hiện tại

**Mục tiêu:** Có điểm khôi phục và phạm vi thống nhất trước khi thay đổi hệ thống.

- [x] Chốt hệ thống dùng nội bộ hay mở đặt phòng công khai trên Internet: chủ dự án chọn lễ tân quản lý nội bộ và khách đặt phòng công khai ngày 21/10/2026.
- [ ] Chốt các nghiệp vụ bắt buộc, vai trò sử dụng và kịch bản nghiệm thu với khách hàng.
- [x] Khởi động Docker và ghi nhận trạng thái các dịch vụ hiện tại.
- [x] Sao lưu cơ sở dữ liệu trước khi sửa; lưu bản sao ở vị trí an toàn ngoài mã nguồn.
- [x] Kiểm tra `.gitignore`; bổ sung quy tắc loại trừ file nhạy cảm và kiểm tra các bí mật cục bộ đã biết trong file dự kiến đưa vào Git.
- [x] Rà soát các bí mật cục bộ đã biết trước khi đưa mã nguồn vào Git; tạo commit `d2fffee` và tag `baseline-before-improvements-20261021` trong kho ứng dụng.

**Điều kiện hoàn thành:** Có bản sao lưu, phiên bản mã nguồn ban đầu và danh sách yêu cầu nghiệm thu được khách hàng xác nhận.

**Bằng chứng và tài liệu:** [Mốc ban đầu, trạng thái Docker và bản sao dữ liệu](hotel-booking/docs/MOC-BAN-DAU.md); [phạm vi và checklist nghiệm thu](hotel-booking/docs/PHAM-VI-VA-NGHIEM-THU.md). Ứng dụng có kho Git riêng trong `hotel-booking`; không phải toàn bộ ứng dụng chưa được Git quản lý. Hình thức sử dụng đã chốt; nghiệp vụ chi tiết và checklist nghiệm thu vẫn chờ chủ dự án/khách hàng xác nhận.

## 2. Ngăn đặt phòng giả và giữ phòng vô thời hạn

**Mục tiêu:** Đơn chưa xác minh không thể chiếm lịch phòng vô thời hạn hoặc liên kết sai hồ sơ khách.

- [ ] Thống nhất cách xác nhận: xác minh liên hệ, lễ tân duyệt hoặc đặt cọc theo chính sách khách sạn.
- [ ] Thêm trạng thái chờ xác nhận và quy tắc chuyển sang đã xác nhận.
- [ ] Thêm thời hạn giữ phòng và tác vụ giải phóng đơn hết hạn.
- [ ] Giới hạn tạo đơn; chống gửi lặp và xử lý yêu cầu tạo đơn bị gửi lại.
- [ ] Không coi email do người đặt tự nhập là bằng chứng sở hữu hồ sơ khách hàng.
- [ ] Kiểm thử nhiều yêu cầu đồng thời, xác nhận sát thời điểm hết hạn và đặt lại sau khi phòng được giải phóng.

**Điều kiện hoàn thành:** Đơn chưa xác nhận hết hạn giải phóng phòng; không xác nhận vượt tồn phòng; email trùng không tự cấp quyền hoặc liên kết sai hồ sơ.

## 3. Hoàn thiện quản lý tài khoản nhân viên

**Mục tiêu:** Mỗi người dùng tài khoản riêng và có thể thu hồi quyền truy cập.

- [ ] Thêm giao diện quản trị tạo tài khoản và cấp vai trò.
- [ ] Thêm đổi mật khẩu và quy trình đặt lại mật khẩu an toàn.
- [ ] Thêm khóa/mở tài khoản và thu hồi phiên đăng nhập.
- [ ] Quy định thao tác nào lễ tân được thực hiện, thao tác nào cần quản trị duyệt.
- [ ] Ghi nhận người thực hiện các thao tác quan trọng.
- [ ] Kiểm thử gọi API trực tiếp để bảo đảm quyền được kiểm tra ở backend.

**Điều kiện hoàn thành:** Tài khoản bị khóa mất quyền truy cập; nhân viên không tự nâng quyền; thao tác truy được đúng người thực hiện.

## 4. Bảo vệ môi trường triển khai

**Mục tiêu:** Bảo vệ kết nối, thông tin đăng nhập và quyền cơ sở dữ liệu.

- [ ] Cấu hình tên miền, HTTPS, chuyển hướng HTTP và gia hạn chứng chỉ tự động.
- [ ] Bật cookie `Secure` và kiểm tra cấu hình proxy trên môi trường HTTPS thực tế.
- [ ] Tách tài khoản PostgreSQL cho ứng dụng, migration và giám sát; cấp quyền tối thiểu.
- [ ] Tách và quản lý bí mật theo môi trường; thay thông tin khởi tạo khi bàn giao.
- [ ] Hạn chế truy cập pgAdmin, Grafana, Prometheus và `/metrics` theo nhu cầu vận hành.
- [ ] Rà soát quyền container và các mount nhạy cảm như Docker socket.
- [ ] Kiểm thử triển khai mới và nâng cấp với các tài khoản cơ sở dữ liệu đã tách quyền.

**Điều kiện hoàn thành:** Truy cập chính thức qua HTTPS; ứng dụng không dùng tài khoản quản trị cơ sở dữ liệu; dịch vụ nội bộ không công khai ngoài phạm vi cho phép.

## 5. Giữ nguyên lịch sử đặt phòng

**Mục tiêu:** Thay đổi danh mục phòng không làm sai lệch đơn cũ.

- [ ] Lưu bản chụp tên phòng, loại phòng, đơn giá và các khoản tính tiền khi đặt/xác nhận.
- [ ] Thống nhất cách xử lý đơn cũ thiếu thông tin lịch sử; không tự suy diễn dữ liệu chưa từng được lưu.
- [ ] Ưu tiên ngừng kinh doanh phòng thay vì xóa phòng có lịch sử.
- [ ] Điều chỉnh giao diện và truy vấn để hiển thị thông tin lịch sử từ đơn.
- [ ] Kiểm thử đổi tên, đổi giá và ngừng kinh doanh phòng sau khi đã có đơn.

**Điều kiện hoàn thành:** Thông tin và giá trị đơn cũ không đổi khi danh mục phòng thay đổi; vẫn tra cứu được lịch sử.

## 6. Hoàn thiện nghiệp vụ lưu trú

**Mục tiêu:** Lễ tân xử lý được các tình huống đã thống nhất trong phạm vi bàn giao.

- [ ] Chốt giờ nhận/trả phòng và chính sách trả sớm, trả muộn, hủy, khách không đến.
- [ ] Bổ sung đổi phòng và gia hạn, kèm kiểm tra lịch trống và chênh lệch tiền.
- [ ] Bổ sung xử lý khách không đến và giải phóng phòng theo chính sách.
- [ ] Bổ sung phụ thu/dịch vụ nếu thuộc phạm vi khách hàng yêu cầu.
- [ ] Thêm trạng thái chờ dọn, đang dọn và sẵn sàng; kiểm soát nhận khách sau trả phòng.
- [ ] Kiểm thử đổi phòng, gia hạn, dọn phòng và đặt phòng đồng thời.

**Điều kiện hoàn thành:** Các kịch bản lưu trú được khách hàng chốt đều xử lý được; không trùng lịch và không nhận khách vào phòng chưa sẵn sàng.

## 7. Hoàn thiện thanh toán và đối soát

**Mục tiêu:** Thu, hoàn và sửa sai có kiểm soát, đối chiếu được với thực tế.

- [ ] Chốt các phương thức thanh toán và cách xác nhận tiền đã nhận.
- [ ] Thêm phiếu thu/hoàn có mã riêng và thông tin người thực hiện.
- [ ] Thêm quy trình điều chỉnh sai sót và hoàn tiền sau trả phòng khi cần; có lý do và quyền duyệt.
- [ ] Giữ nguyên giao dịch gốc; ghi giao dịch điều chỉnh thay vì sửa/xóa lịch sử tiền.
- [ ] Bổ sung đối soát theo ngày/ca, tổng thu, tổng hoàn và công nợ.
- [ ] Kiểm thử mất kết nối, gửi lại yêu cầu, hai nhân viên thao tác đồng thời và thay đổi tiền do gia hạn/phụ thu.

**Điều kiện hoàn thành:** Báo cáo khớp sổ giao dịch; yêu cầu gửi lại không ghi nhận tiền hai lần; sửa sai có dấu vết và đúng quyền.

## 8. Tự động sao lưu và kiểm chứng khôi phục

**Mục tiêu:** Có thể phục hồi sau khi mất máy chủ, volume hoặc dữ liệu bị hỏng.

- [ ] Chốt lượng dữ liệu tối đa có thể mất (RPO) và thời gian khôi phục mục tiêu (RTO).
- [ ] Tự động sao lưu theo lịch phù hợp, có kiểm tra kết quả và dung lượng.
- [ ] Lưu bản sao ngoài máy chủ; mã hóa và hạn chế người có quyền truy cập.
- [ ] Đặt thời gian lưu giữ và cơ chế dọn bản sao cũ.
- [ ] Thử khôi phục vào cơ sở dữ liệu riêng; kiểm tra đơn, khách hàng, tài khoản và giao dịch.
- [ ] Viết hướng dẫn khôi phục và ghi nhận thời gian phục hồi thực tế.

**Điều kiện hoàn thành:** Khôi phục thử thành công; đáp ứng RPO/RTO đã thống nhất; bản sao vẫn truy cập được khi máy chủ chính không hoạt động.

## 9. Hoàn thiện giám sát và vận hành

**Mục tiêu:** Phát hiện sự cố sớm và có người chịu trách nhiệm xử lý.

- [ ] Tách kiểm tra tiến trình sống và kiểm tra khả năng phục vụ; kiểm tra truy vấn cơ sở dữ liệu.
- [ ] Cấu hình cảnh báo dịch vụ ngừng hoạt động, lỗi tăng, ổ đĩa gần đầy và sao lưu thất bại.
- [ ] Thay Promtail đã hết hỗ trợ bằng thành phần còn được hỗ trợ, ví dụ Grafana Alloy.
- [ ] Cấu hình xoay vòng log, thời gian lưu giữ và hạn chế thông tin khách hàng trong log.
- [ ] Đặt giới hạn tài nguyên phù hợp cho các dịch vụ dựa trên máy triển khai.
- [ ] Bổ sung nhật ký cho thay đổi tài khoản, khách hàng, phòng và giao dịch quan trọng.
- [ ] Kiểm tra Nginx sau khi backend được tạo lại; bảo đảm quy trình cập nhật không giữ địa chỉ upstream cũ.
- [ ] Thử cảnh báo và phân công người nhận/xử lý.

**Điều kiện hoàn thành:** Cảnh báo thử nghiệm đến đúng người; giám sát phát hiện được lỗi cơ sở dữ liệu; log không tăng vô hạn; có hướng dẫn xử lý sự cố.

## 10. Kiểm thử nghiệm thu và bàn giao

**Mục tiêu:** Có bằng chứng hệ thống đáp ứng yêu cầu trên môi trường triển khai thực tế.

- [ ] Chạy lại kiểm thử API, phân quyền, trình duyệt và PostgreSQL trên dữ liệu riêng.
- [ ] Kiểm thử đặt phòng/thanh toán đồng thời và dữ liệu tăng trưởng; bổ sung phân trang, chỉ mục nếu kết quả cho thấy cần thiết.
- [ ] Rà soát phụ thuộc và image đang dùng; xử lý lỗ hổng phù hợp, cố định phiên bản phát hành.
- [ ] Kiểm thử khởi động lại máy chủ, mất kết nối cơ sở dữ liệu và khởi động lại container.
- [ ] Thử quy trình cập nhật, migration, quay lại phiên bản trước và khôi phục dữ liệu.
- [ ] Tách môi trường thử nghiệm khỏi dữ liệu khách thật; loại bỏ dữ liệu mẫu khỏi môi trường bàn giao khi phù hợp.
- [ ] Khách hàng chạy và xác nhận các kịch bản nghiệm thu đã chốt ở bước 1.
- [ ] Chuẩn bị tài liệu sử dụng, cài đặt, cập nhật, sao lưu, khôi phục và xử lý sự cố.
- [ ] Bàn giao tài khoản qua kênh riêng, đánh phiên bản phát hành, thống nhất người hỗ trợ và lập biên bản nghiệm thu.

**Điều kiện hoàn thành:** Các kịch bản bắt buộc đạt; vấn đề còn lại được ghi rõ và khách hàng chấp nhận; triển khai, khôi phục và vận hành có người tiếp nhận.

## Nhật ký cập nhật tiến độ

Mỗi lần cập nhật, ghi công việc thực tế đã làm và bằng chứng như commit, kết quả kiểm thử hoặc biên bản. Không đánh dấu hoàn thành chỉ vì đã viết mã.

| Ngày | Bước | Công việc/kết quả | Bằng chứng | Vướng mắc và việc tiếp theo |
| --- | --- | --- | --- | --- |
| 21/10/2026 | Kế hoạch | Tạo checklist cải thiện theo thứ tự ưu tiên | File `caithien.md` | Bắt đầu bước 1; chưa triển khai các hạng mục mới |
| 21/10/2026 | 1 | Khởi động Docker, kiểm tra dịch vụ, sao lưu ngoài workspace, bổ sung quy tắc Git và kiểm tra file nhạy cảm; lập dự thảo nghiệm thu | `hotel-booking/docs/MOC-BAN-DAU.md`, `hotel-booking/docs/PHAM-VI-VA-NGHIEM-THU.md` | Chờ xác nhận hình thức sử dụng, phạm vi nghiệp vụ và kịch bản nghiệm thu |
| 21/10/2026 | 1 | Chủ dự án chọn lễ tân quản lý nội bộ và khách đặt phòng công khai | Phản hồi của chủ dự án; cập nhật tài liệu phạm vi | Còn chờ chốt nghiệp vụ chi tiết và kịch bản nghiệm thu |
| 21/10/2026 | 1 | Lưu mốc Git cục bộ; kiểm tra nguồn không có phát hiện theo các quy tắc đang áp dụng; chạy lại 15/15 test RAM đạt | Commit `d2fffee`, tag `baseline-before-improvements-20261021` trong `hotel-booking` | Phần kỹ thuật mục 1 đã xong; chưa push, chưa thử khôi phục và chưa có khách hàng duyệt checklist |
