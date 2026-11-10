# N-Queens Lab — Local Search & Propositional Logic

Bài tập Task 1: giải bài toán N hậu bằng (1) logic mệnh đề + SAT solver **Glucose3** (PySAT) và
(2) **Min-Conflicts** (chuẩn và phiên bản có heuristic đề xuất), kèm giao diện trực quan 60fps tự động hiển thị thành phẩm.

## Cài đặt

```bash
cd nqueens_project
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt        # chỉ cần python-sat
```

Giao diện dùng thư viện chuẩn của Python và tự động mở trong **cửa sổ ứng dụng riêng** (Edge/Chrome `--app`, không thanh địa chỉ, không cần bấm vào port nào; đóng cửa sổ là chương trình tự thoát).

## Chạy (mọi lệnh đều tự động hiện thành phẩm)

```bash
python main.py                              # tự mở cửa sổ giao diện và hiển thị sẵn thành phẩm ở cả 3 tab
python main.py experiments                  # chạy toàn bộ thực nghiệm -> lưu vào results/ -> tự mở bảng & biểu đồ
python main.py sat --n 4 8 12 16            # chạy thực nghiệm Glucose3 -> tự mở bảng & biểu đồ
python main.py minconflicts --n 8 64 512    # chạy thực nghiệm Min-Conflicts -> tự mở bảng & biểu đồ
python -m unittest discover -s tests -v     # chạy 14 unit test
```

> Bạn cũng có thể chạy trực tiếp bất kỳ file `.py` nào (ví dụ `python nqueens_solver/core/sat_solver.py`, `python nqueens_solver/core/min_conflicts.py`, `python nqueens_solver/gui/server.py`) — chương trình sẽ tự động chạy và mở cửa sổ thành phẩm tương ứng.

## Giao diện

| Tab | Nội dung |
|---|---|
| 1 · Logic mệnh đề & SAT | Tự động hiển thị ngay **bàn cờ thành phẩm N = 8 (Bước 9)** cùng banner kết quả và bảng tóm tắt CNF. Bấm **▶ Xem từng bước (1 → 9)** để xem quá trình gán biến → 5 nhóm ràng buộc CNF → Glucose3 giải |
| 2 · Min-Conflicts | Tự động giải và hiển thị **bàn cờ thành phẩm** của bản Chuẩn và Heuristic đặt cạnh nhau; bấm **▶ Phát quá trình** để xem quân hậu trượt mượt 60fps cùng đường nối xung đột và đồ thị giảm xung đột |
| 3 · Thực nghiệm | Tự động nạp và vẽ bảng + 4 biểu đồ từ `results/`; hoặc bấm chạy lại thực nghiệm trực tiếp trên giao diện |

## Cấu trúc (OOP)

```
main.py                         điểm vào (tự động mở cửa sổ thành phẩm)
nqueens_solver/
  core/
    board.py                    Board: kiểm tra nghiệm độc lập
    cnf.py                      VariableMap, ConstraintDiscoverer, ConstraintGroup, NQueensCNF
    sat_solver.py               GlucoseQueensSolver, SATResult
    min_conflicts.py            ConflictState + Strategy: Initializer / VariableSelector / ValueSelector
                                MinConflictsSolver.standard() / .heuristic()
  experiments/                  SATExperiment, MinConflictsExperiment, ReportWriter
  gui/                          server.py (HTTP + cửa sổ ứng dụng tự động), presenters.py, static/ (HTML, CSS, JS)
tests/test_core.py              14 unit test
docs/BAO_CAO.md                 phần lý thuyết cho yêu cầu 1 + mô tả heuristic
results/                        kết quả thực nghiệm (CSV / JSON / Markdown)
```

## Heuristic đề xuất (so với Min-Conflicts chuẩn)

| | Chuẩn | Heuristic |
|---|---|---|
| Khởi tạo | ngẫu nhiên | tham lam: đặt từng hàng vào cột ít xung đột nhất |
| Chọn biến | ngẫu nhiên trong các hậu bị tấn công | hậu bị tấn công **nhiều nhất** |
| Chọn giá trị | cột ít xung đột nhất | như vậy nhưng phải đổi cột và có **tabu** |
| Kẹt | không xử lý | khởi động lại sau 20·N bước không cải thiện |

Chi tiết và cách đọc kết quả xem `docs/BAO_CAO.md`.
