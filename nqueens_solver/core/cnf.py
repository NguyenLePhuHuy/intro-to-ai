"""Mô hình hoá N-Queens bằng logic mệnh đề và sinh các mệnh đề CNF.

Quy ước biến: x(r, c) = True  <=>  ô (r, c) có quân hậu.
Chỉ số biến (1-based, theo yêu cầu của DIMACS / PySAT): v = r * N + c + 1.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import chain, combinations
from typing import Dict, Iterator, List, Tuple

Square = Tuple[int, int]
Clause = List[int]


class VariableMap:
    """Ánh xạ hai chiều giữa ô (r, c) và số hiệu biến logic."""

    def __init__(self, n: int):
        self.n = n

    def var(self, r: int, c: int) -> int:
        return r * self.n + c + 1

    def cell(self, v: int) -> Square:
        return divmod(v - 1, self.n)

    @property
    def num_vars(self) -> int:
        return self.n * self.n


class ConstraintDiscoverer:
    """Thuật toán phát hiện ràng buộc.

    Hai quân hậu tại a=(r1,c1) và b=(r2,c2) tấn công nhau khi và chỉ khi chúng
    nằm trên cùng một "đường": cùng hàng (r1=r2), cùng cột (c1=c2), cùng đường
    chéo chính (r1-c1 = r2-c2) hoặc cùng đường chéo phụ (r1+c1 = r2+c2).

    Thay vì xét mọi cặp ô (O(N^4)), ta duyệt mỗi ô đúng một lần (O(N^2)) và
    gom ô vào 4 loại "khoá đường": r, c, r-c, r+c. Mỗi nhóm gồm các ô chung
    khoá chính là một tập ô đôi một tấn công nhau -> sinh ràng buộc cho nhóm.
    """

    def discover(self, n: int) -> Dict[str, List[List[Square]]]:
        rows: List[List[Square]] = [[] for _ in range(n)]
        cols: List[List[Square]] = [[] for _ in range(n)]
        diag: Dict[int, List[Square]] = {}
        anti: Dict[int, List[Square]] = {}
        for r in range(n):
            for c in range(n):
                cell = (r, c)
                rows[r].append(cell)
                cols[c].append(cell)
                diag.setdefault(r - c, []).append(cell)
                anti.setdefault(r + c, []).append(cell)
        return {
            "row": rows,
            "col": cols,
            "diag": [diag[k] for k in sorted(diag)],
            "anti": [anti[k] for k in sorted(anti)],
        }

    @staticmethod
    def attacks(a: Square, b: Square) -> bool:
        """Kiểm tra trực tiếp hai ô có tấn công nhau không (dùng để đối chiếu)."""
        return (
            a != b
            and (a[0] == b[0] or a[1] == b[1] or a[0] - a[1] == b[0] - b[1] or a[0] + a[1] == b[0] + b[1])
        )


@dataclass
class ConstraintGroup:
    """Một nhóm mệnh đề CNF cùng loại ràng buộc."""

    key: str
    title: str
    logic: str
    description: str
    clauses: List[Clause] = field(default_factory=list)
    lines: List[List[Square]] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.clauses)


class NQueensCNF:
    """Công thức CNF đầy đủ của bài toán N-Queens.

    Ràng buộc:
      1. Mỗi hàng có ít nhất một hậu          : (x_r0 ∨ x_r1 ∨ ... ∨ x_r,N-1)
      2. Mỗi hàng có nhiều nhất một hậu       : ¬x_a ∨ ¬x_b  với a, b cùng hàng
      3. Mỗi cột có nhiều nhất một hậu        : tương tự
      4. Mỗi đường chéo chính nhiều nhất một  : tương tự
      5. Mỗi đường chéo phụ nhiều nhất một    : tương tự
    Từ (1) và (3): có đúng N hậu, mỗi hàng đúng một hậu và mỗi cột đúng một hậu.
    "Nhiều nhất một" được mã hoá theo cặp (pairwise): ¬(a ∧ b) ≡ ¬a ∨ ¬b (De Morgan).
    """

    def __init__(self, n: int):
        if n < 1:
            raise ValueError("N phải >= 1")
        self.n = n
        self.vars = VariableMap(n)
        self.groups: List[ConstraintGroup] = []
        self._build()

    # ----- xây dựng ------------------------------------------------------
    def _build(self) -> None:
        lines = ConstraintDiscoverer().discover(self.n)
        self.groups = [
            self._at_least_one(
                "row_alo", "Mỗi hàng có ít nhất 1 hậu", lines["row"]
            ),
            self._at_most_one(
                "row_amo", "Mỗi hàng có nhiều nhất 1 hậu", lines["row"], "hàng"
            ),
            self._at_most_one(
                "col_amo", "Mỗi cột có nhiều nhất 1 hậu", lines["col"], "cột"
            ),
            self._at_most_one(
                "diag_amo", "Mỗi đường chéo chính có nhiều nhất 1 hậu", lines["diag"], "đường chéo chính (r - c không đổi)"
            ),
            self._at_most_one(
                "anti_amo", "Mỗi đường chéo phụ có nhiều nhất 1 hậu", lines["anti"], "đường chéo phụ (r + c không đổi)"
            ),
        ]

    def _at_least_one(self, key: str, title: str, lines: List[List[Square]]) -> ConstraintGroup:
        clauses = [[self.vars.var(r, c) for r, c in line] for line in lines]
        return ConstraintGroup(
            key=key,
            title=title,
            logic="x(r,0) ∨ x(r,1) ∨ … ∨ x(r,N-1)",
            description=(
                "Với mỗi hàng, ít nhất một ô trong hàng chứa hậu. Đây đã là một mệnh đề "
                "dạng CNF (một phép tuyển các literal dương) nên không cần biến đổi thêm."
            ),
            clauses=clauses,
            lines=[list(line) for line in lines],
        )

    def _at_most_one(
        self, key: str, title: str, lines: List[List[Square]], line_name: str
    ) -> ConstraintGroup:
        clauses: List[Clause] = []
        kept: List[List[Square]] = []
        for line in lines:
            if len(line) < 2:
                continue
            kept.append(list(line))
            for a, b in combinations(line, 2):
                clauses.append([-self.vars.var(*a), -self.vars.var(*b)])
        return ConstraintGroup(
            key=key,
            title=title,
            logic="x(a) → ¬x(b)  ≡  ¬x(a) ∨ ¬x(b)",
            description=(
                f"Hai ô bất kỳ cùng một {line_name} không được đồng thời có hậu: "
                "¬(x_a ∧ x_b). Áp dụng luật De Morgan ta được mệnh đề tuyển ¬x_a ∨ ¬x_b, "
                "mỗi cặp ô sinh đúng một mệnh đề CNF."
            ),
            clauses=clauses,
            lines=kept,
        )

    # ----- truy cập ------------------------------------------------------
    @property
    def num_vars(self) -> int:
        return self.vars.num_vars

    @property
    def num_clauses(self) -> int:
        return sum(g.count for g in self.groups)

    def iter_clauses(self) -> Iterator[Clause]:
        return chain.from_iterable(g.clauses for g in self.groups)

    def group(self, key: str) -> ConstraintGroup:
        for g in self.groups:
            if g.key == key:
                return g
        raise KeyError(key)

    # ----- công thức đóng ------------------------------------------------
    @staticmethod
    def expected_clause_count(n: int) -> int:
        """Số mệnh đề theo công thức: dùng để đối chiếu với quá trình sinh."""
        c2 = lambda k: k * (k - 1) // 2  # noqa: E731
        rows_cols = 2 * n * c2(n)
        one_diag_family = c2(n) + 2 * sum(c2(length) for length in range(1, n))
        return n + rows_cols + 2 * one_diag_family


if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    cnf = NQueensCNF(8)
    print(f"N=8: {cnf.num_vars} biến, {cnf.num_clauses} mệnh đề CNF (công thức: {NQueensCNF.expected_clause_count(8)})")
    from nqueens_solver.gui.server import serve

    serve(hash_tab="sat")
