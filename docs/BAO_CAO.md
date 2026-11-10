# Báo cáo Task 1 — N-Queens: Local Search & Propositional Logic

## 1. Mô hình hoá bằng logic mệnh đề (Requirement 1)

### 1.1 Thành phần của bài toán

| Thành phần | Định nghĩa |
|---|---|
| Biến mệnh đề | `x(r,c)` với 0 ≤ r,c < N. `x(r,c) = True` ⇔ ô (r,c) có hậu. Có N² biến, đánh số `v = r·N + c + 1`. |
| Mô hình (model) | Một phép gán True/False cho N² biến, tương ứng một cách đặt quân lên bàn cờ. |
| Công thức | Hội (∧) của các ràng buộc; nghiệm của bài toán là mô hình thoả mãn công thức. |
| Literal / mệnh đề | `x` hoặc `¬x`; mệnh đề là phép tuyển (∨) các literal. CNF là hội các mệnh đề. |

### 1.2 Các ràng buộc

Hai hậu tại a=(r₁,c₁), b=(r₂,c₂) tấn công nhau ⇔ r₁=r₂ (hàng) hoặc c₁=c₂ (cột) hoặc r₁−c₁=r₂−c₂ (chéo chính) hoặc r₁+c₁=r₂+c₂ (chéo phụ).

1. **Mỗi hàng có ít nhất một hậu:** `x(r,0) ∨ x(r,1) ∨ … ∨ x(r,N−1)` — N mệnh đề.
2. **Mỗi hàng nhiều nhất một hậu:** `¬x(a) ∨ ¬x(b)` với mọi cặp a≠b cùng hàng.
3. **Mỗi cột nhiều nhất một hậu:** tương tự, cho mọi cặp cùng cột.
4. **Mỗi đường chéo chính nhiều nhất một hậu:** tương tự, cho mọi cặp cùng r−c.
5. **Mỗi đường chéo phụ nhiều nhất một hậu:** tương tự, cho mọi cặp cùng r+c.

Từ (1) và (2) mỗi hàng có đúng một hậu, nên có N hậu; kết hợp (3) mỗi cột cũng đúng một hậu. Không cần ràng buộc "ít nhất một" cho cột hay đường chéo.

### 1.3 Thuật toán phát hiện ràng buộc (`ConstraintDiscoverer`)

Cách ngây thơ xét mọi cặp ô và kiểm tra điều kiện tấn công tốn O(N⁴). Thay vào đó:

1. Duyệt mỗi ô (r,c) đúng một lần.
2. Đưa ô vào 4 nhóm theo 4 *khoá đường*: `r`, `c`, `r−c`, `r+c` (dùng bảng băm).
3. Mỗi nhóm có ≥ 2 ô là một tập các ô đôi một tấn công nhau, nên chỉ cần sinh ràng buộc "nhiều nhất một" cho từng nhóm.

Độ phức tạp thu thập nhóm O(N²); phần sinh mệnh đề tốn thời gian tỉ lệ với số mệnh đề đầu ra. Đã kiểm thử: tập cặp ô sinh ra **đúng bằng** tập cặp tấn công theo phép liệt kê brute-force với N = 2…7 (`tests/test_core.py`).

### 1.4 Chuyển về CNF

* Ràng buộc "ít nhất một" đã ở dạng CNF (một mệnh đề các literal dương).
* Ràng buộc "nhiều nhất một" trên tập S được mã hoá theo cặp (pairwise): với mọi {a,b} ⊆ S, `¬(x_a ∧ x_b)`. Theo luật De Morgan, `¬(x_a ∧ x_b) ≡ ¬x_a ∨ ¬x_b` — một mệnh đề CNF có đúng 2 literal. (Tương đương với phép kéo theo `x_a → ¬x_b`.)
* CNF cuối cùng là hội của tất cả các mệnh đề này. Mỗi mệnh đề được biểu diễn thành danh sách số nguyên (DIMACS), ví dụ `[-1, -2]` là `¬x1 ∨ ¬x2`, rồi nạp vào Glucose3.

**Số mệnh đề** (công thức đóng, chương trình đối chiếu với số mệnh đề thực tế sinh ra):

```
#clauses(N) = N + 2·N·C(N,2) + 2·[ C(N,2) + 2·Σ_{L=1}^{N−1} C(L,2) ]
```

Ví dụ N=4: 80, N=8: 736, N=12: 2608. Số mệnh đề tăng theo O(N³), số biến là N².

## 2. Glucose3 (Requirement 2)

`GlucoseQueensSolver` thực hiện: sinh CNF → `Glucose3(bootstrap_with=clauses)` → `solve()` → `get_model()` → giải mã các biến dương thành ô (r,c) → kiểm tra nghiệm độc lập bằng `Board.is_solution()`. Với mỗi N (≥ 4) chương trình báo cáo **số biến, số mệnh đề, thời gian sinh CNF, thời gian nạp và thời gian `solve()`** (trung bình của nhiều lần lặp). Kết quả thực tế trên máy của bạn nằm ở `results/sat_results.csv` và `results/report.md` sau khi chạy `python main.py experiments` hoặc dùng tab "Thực nghiệm".

## 3. Min-Conflicts và heuristic (Requirement 3)

### 3.1 Min-Conflicts chuẩn
Biểu diễn mỗi hàng một hậu (biến = hàng, giá trị = cột). Khởi tạo ngẫu nhiên; lặp: chọn ngẫu nhiên một hậu đang bị tấn công, chuyển nó tới cột có ít xung đột nhất (hòa → ngẫu nhiên), dừng khi không còn xung đột hoặc hết số bước tối đa. Số xung đột được cập nhật tăng dần bằng 3 mảng đếm (cột, chéo chính, chéo phụ) nên đánh giá một cột là O(1).

### 3.2 Heuristic đề xuất — ba thành phần độc lập
1. **Khởi tạo tham lam:** duyệt các hàng theo thứ tự ngẫu nhiên, đặt hậu vào cột ít xung đột nhất với các hậu đã đặt. Trạng thái đầu đã gần nghiệm.
2. **Chọn biến theo mức xung đột:** chọn hậu bị tấn công nhiều nhất (hòa → ngẫu nhiên) thay vì ngẫu nhiên, để gỡ "điểm nóng" trước.
3. **Tabu + khởi động lại:** hậu phải đổi cột; không được quay lại cột vừa rời trong `max(3, N/10)` bước; nếu 20·N bước liên tiếp không giảm được tổng xung đột thì khởi tạo tham lam lại. Thành phần này nhằm tránh dao động/kẹt ở cực tiểu địa phương.

### 3.3 Cách đánh giá
Mỗi N chạy nhiều lần, **cùng bộ seed** cho cả hai thuật toán; ghi tỉ lệ thành công, số bước trung bình/trung vị (một bước = một lần gán lại một hậu), thời gian và số lần khởi động lại. Giao diện/CLI xuất CSV, JSON, Markdown.

### 3.4 Kết quả tham khảo (đo trong quá trình phát triển, 60 lần chạy/cấu hình, tối đa 100 000 bước)

Đây là số đo trên máy phát triển (Linux, Python 3.13), **không phải máy Intel i5/macOS của bài nộp**; hãy chạy lại và dùng số liệu của bạn trong báo cáo. Thời gian tuyệt đối sẽ khác, xu hướng nên tương tự.

| N | Số bước TB (chuẩn) | Số bước TB (heuristic) | Ghi chú |
|---:|---:|---:|---|
| 8 | 5083.6 (95% thành công) | 66.8 (100%) | bản chuẩn có lần bị kẹt đến hết 100 000 bước; trung vị 38.5 vs 31.0 |
| 16 | 85.0 | 73.0 | chênh lệch nhỏ |
| 32 | 91.1 | 50.3 | |
| 64 | 108.2 | 50.4 | |
| 128 | 153.8 | 63.0 | |
| 256 | 242.9 | 72.6 | |
| 512 | 405.1 | 73.1 | |
| 1000 | 716.5 | 82.7 | ít hơn ≈ 8.7 lần; thời gian 127 ms → 98 ms |

Phân tích bỏ từng thành phần (ablation) trên cùng dữ liệu:
* **Khởi tạo tham lam** đóng góp chính: số bước gần như không tăng theo N (≈ 50–90 bước cho mọi N ≥ 32).
* **Chọn hậu bị tấn công nhiều nhất** cải thiện thêm khoảng 10–20% khi dùng riêng.
* **Tabu + khởi động lại** hầu như không đổi số bước trung bình ở N lớn nhưng loại bỏ các lần kẹt ở N nhỏ (N=8: từ 92–95% lên 100% thành công).

Lưu ý trung thực: mức tiết kiệm **thời gian** nhỏ hơn mức tiết kiệm số bước (≈ 23% ở N=1000) vì khởi tạo tham lam tốn O(N²) và mỗi bước chọn biến đều quét O(N) hậu. Ở N nhỏ (≤ 16) với ít lần chạy, hai thuật toán có thể không phân biệt được rõ; nên dùng ≥ 20–50 lần chạy và so sánh theo trung vị.
