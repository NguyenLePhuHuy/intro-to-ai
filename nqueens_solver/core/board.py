"""Bàn cờ N x N và việc kiểm tra nghiệm độc lập với các solver."""
from __future__ import annotations

from collections import Counter
from typing import Iterable, List, Sequence, Set, Tuple

Square = Tuple[int, int]


class Board:
    """Tập các ô (hàng, cột) đang có quân hậu trên bàn cờ N x N."""

    def __init__(self, n: int, queens: Iterable[Square] = ()):
        if n < 1:
            raise ValueError("N phải >= 1")
        self.n = n
        self.queens: Set[Square] = set(queens)

    # ----- factory -------------------------------------------------------
    @classmethod
    def from_columns(cls, cols: Sequence[int]) -> "Board":
        """cols[r] = cột của quân ở hàng r (biểu diễn mỗi hàng một quân)."""
        return cls(len(cols), ((r, c) for r, c in enumerate(cols) if c >= 0))

    @classmethod
    def from_model(cls, n: int, model: Iterable[int]) -> "Board":
        """Giải mã mô hình của SAT solver: biến dương v -> ô (r, c)."""
        queens = []
        for v in model:
            if 0 < v <= n * n:
                queens.append(divmod(v - 1, n))
        return cls(n, queens)

    # ----- kiểm tra ------------------------------------------------------
    def attacking_pairs(self) -> int:
        """Số cặp hậu tấn công nhau (cùng hàng / cột / đường chéo)."""
        lines = [Counter(), Counter(), Counter(), Counter()]
        for r, c in self.queens:
            lines[0][r] += 1
            lines[1][c] += 1
            lines[2][r - c] += 1
            lines[3][r + c] += 1
        return sum(k * (k - 1) // 2 for counter in lines for k in counter.values())

    def is_solution(self) -> bool:
        return len(self.queens) == self.n and self.attacking_pairs() == 0

    def to_columns(self) -> List[int]:
        cols = [-1] * self.n
        for r, c in self.queens:
            cols[r] = c
        return cols

    def render(self, queen: str = "Q", empty: str = ".") -> str:
        return "\n".join(
            " ".join(queen if (r, c) in self.queens else empty for c in range(self.n))
            for r in range(self.n)
        )

    def __repr__(self) -> str:  # pragma: no cover
        return f"Board(n={self.n}, queens={len(self.queens)})"


if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    sample = Board.from_columns([3, 6, 2, 7, 1, 4, 0, 5])
    print(f"Bàn cờ mẫu N=8 (hợp lệ: {sample.is_solution()}):\n{sample.render()}")
    from nqueens_solver.gui.server import serve

    serve(hash_tab="sat")
