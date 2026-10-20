# Nhiều shop trên app dropship — thiết kế

Ngày 2026-10-20. Trạng thái: **đã được chủ app duyệt (2026-10-20)**, kèm một yêu cầu thêm: có chỗ trên web để tự đặt tên shop.

## Vì sao làm

Chủ app có nhiều shop Shopee (hiện 2, hiếm khi thêm). Mỗi shop là một bộ thông tin độc lập hoàn toàn: Google Sheet riêng, Apps Script riêng, danh sách SKU riêng, nhóm Zalo riêng, đơn riêng. Nghiệp vụ thì giống hệt nhau. Hiện app chỉ phục vụ **một** shop (một database, một mã bí mật Apps Script, một cấu hình Zalo). Cần chuyển qua lại giữa các shop trên cùng một trang web, mỗi shop chạy y như app cũ, không lẫn dữ liệu.

## Mục tiêu

- Ô chọn shop ở header dashboard. Chọn shop nào thì mọi trang (Báo cáo đối soát, Đơn hàng, Đơn hoàn huỷ, Đóng đơn, Nhận đơn huỷ, Đối soát thanh toán) chỉ hiện và chỉ ghi dữ liệu của shop đó.
- Mỗi shop có đủ bộ tính năng như hiện tại: đồng bộ từ Google Sheet, đọc nhóm Zalo, cảnh báo đơn quá hạn, tạo Excel gửi kho, đối soát.
- Shop đầu tiên là dữ liệu đang chạy hôm nay. Không mất gì, Apps Script đang chạy không phải sửa.
- Thêm shop mới bằng một lệnh do Claude chạy, không cần giao diện.
- Có một chỗ trên web để chủ app tự đặt và đổi tên từng shop (trang Tài khoản, mục "Tên shop"). Tên mặc định khi mới tạo: "Shop 1", "Shop 2"…

## Không làm (non-goals)

- Không phân quyền theo shop: ai đăng nhập cũng vào được mọi shop.
- Không có trang web để **thêm** shop (thêm shop = nhắn Claude) và không sửa link/mã bí mật trên web. Chỉ **đổi tên** là làm được trên web.
- Không có báo cáo gộp nhiều shop.
- Không khác nghiệp vụ giữa các shop: sửa logic là sửa cho tất cả.
- Không đụng trang sorter (`shopee-pdf-sorter`) và thuật toán xếp phiếu.
- Không có Zalo bridge riêng cho từng shop: cả hai shop dùng chung một tài khoản Zalo và một bridge (`ZALO_BRIDGE_URL`/`ZALO_BRIDGE_SECRET`), chỉ khác nhóm.

## Điều tệ nhất có thể xảy ra (anti-goals)

Làm xong "chạy được" mà vẫn coi là hỏng nếu:

1. **Dữ liệu shop này xuất hiện hoặc bị ghi vào shop kia.** Ví dụ sửa nhầm đơn #123 của shop B trong khi mình đang nhìn đơn #123 của shop A. Đây là rủi ro lớn nhất.
2. Sau deploy, Apps Script của shop đầu ngừng đẩy được dữ liệu, hoặc mất dữ liệu shop đầu.
3. Lỗi ở một shop (Zalo bridge trả lỗi, nhóm bị xoá) làm bộ đọc Zalo của shop kia ngừng chạy.

## Người dùng thấy gì

- Header luôn ghi **tên shop đang xem** để không ai làm nhầm mà không biết. Bấm vào tên mở danh sách các shop, chọn shop khác thì trang tải lại ở **cùng mục** (ví dụ đang ở Đơn hàng thì sang Đơn hàng của shop mới), bỏ các bộ lọc cũ. *(Mình chọn.)*
- Trình duyệt nhớ shop vừa chọn (cookie, 1 năm). Lần đầu vào, hoặc khi shop đã nhớ không còn nữa, vào shop đầu tiên trong danh sách. *(Mình chọn.)*
- Một shop mới chưa có dữ liệu thì mọi trang trống như app mới cài. Không cần xử lý riêng.
- Tên hiển thị của mỗi shop do chủ app tự đặt ở trang Tài khoản, mục "Tên shop" (mỗi shop một ô nhập và nút Lưu). Chưa đặt thì hiện "Shop 1", "Shop 2". Đổi tên có hiệu lực ngay ở ô chọn shop. Tên không được trống, tối đa 40 ký tự, không trùng tên shop khác (không phân biệt hoa thường). *(Mình chọn.)*

## Dùng chung và riêng

**Riêng từng shop** (mọi bảng dữ liệu nghiệp vụ hiện có): đơn (`orders`), đơn đã giao, đơn huỷ/giao thất bại/hoàn, sản phẩm, bản ghi thanh toán và các lô thanh toán, nhật ký đồng bộ, các lô đối soát, cấu hình nhóm Zalo (`zalo_watch_config` với con trỏ tin nhắn đã đọc), nhật ký xác nhận Zalo, file Excel/PDF vận đơn, nhật ký nhận đơn huỷ, trạng thái đồng bộ nhận đơn huỷ, danh sách SKU chính (`sku_mappings`).

**Dùng chung:** tài khoản đăng nhập (`users`, kèm lựa chọn số phiếu/trang A4 của từng tài khoản), cookie phiên đăng nhập, Zalo bridge, và **danh bạ shop**.

**Danh bạ shop** là bảng mới dùng chung. Mỗi shop có: mã ngắn (slug), tên hiển thị, chỗ chứa dữ liệu của nó, mã bí mật webhook (lưu dạng băm, chỉ hiện đúng một lần khi tạo), link sheet SKU (trống = dùng `SKU_SHEET_URL` mặc định như hiện nay).

## Hành vi cần đạt

### Tách dữ liệu *(mình chọn)*

Tách ở tầng database, không phải bằng cột `shop_id` trên từng dòng. Mỗi shop có ngăn dữ liệu riêng (một schema Postgres riêng trong cùng một database; người xây có thể chọn database riêng nếu thấy hợp hơn, miễn là việc tách do kết nối database đảm bảo, không do câu truy vấn nhớ lọc). Lý do: app có khoảng 90 chỗ gọi Prisma, và mọi khoá unique hiện có (như `shopeeOrderId` + `categoryName`) chỉ đúng trong phạm vi một shop; chỉ cần sót một câu lọc là đơn hai shop lẫn nhau. Với 2 shop thì tách hẳn là an toàn nhất.

Hệ quả cần giữ:

- Bảng dùng chung (`users`, danh bạ shop) không bị truy cập nhầm qua kết nối của một shop, và ngược lại.
- Dữ liệu hiện tại **không di chuyển**: nó thành shop đầu tại chỗ đang nằm. Shop thứ hai và các shop sau nằm trong ngăn riêng mới. *(Mình chọn, vì không đụng dữ liệu đang chạy là cách ít rủi ro nhất.)*
- Mọi migration mới phải chạy trên **tất cả** shop. Các bước deploy (`prisma migrate deploy`) phải lo việc này, và tài liệu `DEPLOY_VPS.md` cập nhật theo.

### Biết đang ở shop nào

- Trên web: shop đang xem lấy từ cookie lựa chọn. Mọi chỗ đọc/ghi dữ liệu nghiệp vụ phải biết rõ shop. **Ở môi trường production không có "shop mặc định ngầm"**: thiếu thông tin shop thì báo lỗi, không đoán.
- Môi trường test và dev: mặc định về shop đầu tiên để 628 test hiện có (dùng một Postgres thật, không có ngữ cảnh web) không phải sửa hàng loạt. Test mới chứng minh được cách ly (xem mục Kiểm thử).

### Không ghi nhầm khi mở hai tab *(rủi ro #1)*

Người dùng có thể mở tab shop A, rồi sang tab khác đổi sang shop B. Cookie đổi theo, tab A (cũ) vẫn hiện dữ liệu shop A.

- Mọi yêu cầu **ghi** từ trang (sửa đơn, quét mã nhận đơn huỷ, xác nhận tay, upload đối soát, đổi nhóm Zalo...) phải mang theo shop mà trang đó được hiển thị cho, và server **từ chối** nếu khác shop hiện tại trong cookie. Thông báo cho người dùng: tab này đang ở shop khác, hãy tải lại trang.
- Mọi đường dẫn tải về nhận diện một dòng bằng số (ví dụ `/api/waybills/[logId]/[kind]`, xuất báo cáo) cũng phải gắn shop và không bao giờ tra sang shop khác. Số id chỉ có nghĩa trong phạm vi một shop.
- Cách làm cụ thể (tham số, header, đường dẫn) để người xây chọn.

### Webhook từ Apps Script

- Vẫn là một địa chỉ `/api/sync/webhook`. Shop được nhận ra bằng mã bí mật gửi kèm (`X-Sync-Secret`): mỗi shop một mã. Mã không khớp shop nào: 401 như hiện nay.
- Mã bí mật hiện tại (`SYNC_WEBHOOK_SECRET`) tiếp tục là mã của shop đầu mà không cần đổi gì ở Apps Script. Người xây chọn cách (đọc từ env hay ghi vào danh bạ khi khởi tạo); yêu cầu là script đang chạy hôm nay vẫn đẩy được ngay sau deploy.
- So sánh mã theo cách chống dò thời gian (constant-time).
- Dữ liệu đẩy vào chỉ chạm shop của mã đó.

### Bộ đọc Zalo (`zalo-poller`) và cảnh báo quá hạn

- Mỗi vòng quét lần lượt qua mọi shop trong danh bạ: đọc cấu hình nhóm, con trỏ tin nhắn, xử lý xác nhận "Đã in…", nhận đơn huỷ, cảnh báo quá hạn **của shop đó**. Cảnh báo quá hạn gửi về nhóm của đúng shop.
- Lỗi ở một shop được ghi log kèm tên shop và **không chặn** các shop còn lại.
- Thêm shop mới thì poller tự nhận ở vòng sau, không phải khởi động lại. Bộ đọc tính danh sách shop lại mỗi vòng.
- Bridge Zalo dùng chung (env như cũ).

### Danh sách SKU

Bộ nhớ đệm danh sách SKU (`lib/skus.ts`, đang là một biến dùng chung toàn app) phải tách theo shop: mỗi shop có bản sao, link, thời điểm đồng bộ riêng. Chu trình làm tươi (mỗi ngày + khi gặp SKU lạ, tối đa 10 phút/lần) giữ nguyên trong từng shop.

### Thêm shop mới

Một lệnh chạy trên VPS (Claude chạy), nhận tên shop và link sheet SKU (nếu có). Lệnh: tạo ngăn dữ liệu, chạy toàn bộ migration trên ngăn đó, ghi vào danh bạ, in ra **mã bí mật webhook** để dán vào Script Properties của Apps Script shop mới. Chạy lại lệnh cho cùng một shop không được làm hỏng dữ liệu đã có. Việc cài Apps Script lên hai file Google Sheet của shop mới là việc của chủ app, theo `google-apps-script/README.md` (README cần cập nhật: mỗi shop một `SYNC_SECRET` riêng).

## Ràng buộc

- Stack giữ nguyên: Next.js 14, Prisma, Postgres, Docker Compose trên VPS 110.172.29.21, mã nguồn `trungthongtcdn/shopee-dropship`.
- Đường vào và `middleware.ts` (phiên đăng nhập) giữ nguyên; không đưa Prisma vào Edge middleware.
- Các route handler hiện được test bằng cách gọi trực tiếp với `NextRequest`, không qua ngữ cảnh request của Next (xem `getUserFromRequest`). Cách chọn shop phải chạy được ở cả hai kiểu đó.
- Trước khi deploy phải backup database (`pg_dump`). Chỉ deploy khi chủ app nói "deploy".
- Phải tiếp tục dùng chung các module `lib/waybill/*` với sorter; không đổi hợp đồng của chúng.

## Kiểm thử

- 628 test hiện có vẫn qua (bằng mặc định về shop đầu ở môi trường test).
- Test cách ly mới, tối thiểu: dữ liệu ghi vào shop A không thấy được ở shop B qua (a) webhook, (b) sửa đơn, (c) tải file vận đơn, (d) vòng quét Zalo; tab ở shop cũ gửi yêu cầu ghi thì bị từ chối; production không có shop thì báo lỗi chứ không đoán.
- Kiểm tra trên bản chạy thật sau deploy: đồng bộ thử một lô cho shop đầu bằng mã cũ, xác nhận dữ liệu cũ còn nguyên; tạo shop thứ hai, đẩy thử một dòng bằng mã mới, xác nhận shop đầu không thấy dòng đó.

## Cần chủ app trả lời

Không còn câu hỏi nào. Tên shop do chủ app tự đặt trên web.

## Để người xây quyết

Cách cụ thể chọn shop trong từng đường vào (cookie + tham số/header/đường dẫn), kiểu tách (schema hay database), cách giữ mã bí mật của shop đầu, cách tránh để bảng dùng chung nằm thừa trong ngăn riêng của shop mới, cấu trúc lệnh thêm shop, cách chạy migration cho mọi shop khi deploy.

## Mình tự chọn (để chủ app soát)

- Tách dữ liệu bằng ngăn riêng trong database, không dùng cột `shop_id`.
- Dữ liệu hiện tại không di chuyển, thành shop đầu tại chỗ.
- Đổi shop thì ở lại cùng mục, bỏ bộ lọc cũ; trình duyệt nhớ shop 1 năm.
- Mã bí mật shop lưu dạng băm, hiện đúng một lần.
- Thêm shop bằng lệnh Claude chạy trên VPS, không có giao diện.
- Chỗ đặt tên shop nằm ở trang Tài khoản (đã có sẵn, gồm cả quản lý tài khoản dùng chung), không tạo trang mới.
- Từ chối ghi khi tab đang ở shop khác (chống ghi nhầm), thay vì tự đổi sang shop của tab.
