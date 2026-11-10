"""Giải N-Queens bằng SAT solver Glucose3 (thư viện PySAT)."""
from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from nqueens_solver.core.board import Board
    from nqueens_solver.core.cnf import NQueensCNF
else:
    from .board import Board
    from .cnf import NQueensCNF


@dataclass
class SATResult:
    n: int
    satisfiable: bool
    num_vars: int
    num_clauses: int
    build_time: float  # giây: sinh công thức CNF
    load_time: float   # giây: nạp mệnh đề vào Glucose3
    solve_time: float  # giây: Glucose3.solve()
    board: Optional[Board] = None
    valid: bool = False  # nghiệm đã được kiểm tra độc lập
    cnf: Optional[NQueensCNF] = None  # chỉ giữ lại khi keep_cnf=True

    @property
    def total_time(self) -> float:
        return self.build_time + self.load_time + self.solve_time


class GlucoseQueensSolver:
    """Sinh CNF -> nạp vào Glucose3 -> solve -> giải mã mô hình thành bàn cờ."""

    name = "Glucose3"

    def __init__(self) -> None:
        try:
            from pysat.solvers import Glucose3  # noqa: F401
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Chưa cài PySAT. Hãy chạy:  pip install python-sat"
            ) from exc

    def solve(self, n: int, keep_cnf: bool = False) -> SATResult:
        from pysat.solvers import Glucose3

        t0 = time.perf_counter()
        cnf = NQueensCNF(n)
        build_time = time.perf_counter() - t0

        t1 = time.perf_counter()
        solver = Glucose3(bootstrap_with=cnf.iter_clauses())
        load_time = time.perf_counter() - t1
        try:
            t2 = time.perf_counter()
            sat = solver.solve()
            solve_time = time.perf_counter() - t2
            model = solver.get_model() if sat else None
        finally:
            solver.delete()

        board = Board.from_model(n, model) if model else None
        return SATResult(
            n=n,
            satisfiable=bool(sat),
            num_vars=cnf.num_vars,
            num_clauses=cnf.num_clauses,
            build_time=build_time,
            load_time=load_time,
            solve_time=solve_time,
            board=board,
            valid=bool(board and board.is_solution()),
            cnf=cnf if keep_cnf else None,
        )


if __name__ == "__main__":
    res = GlucoseQueensSolver().solve(8)
    print(
        f"Glucose3 N=8: {res.num_vars} biến, {res.num_clauses} mệnh đề CNF, "
        f"solve={1000 * res.solve_time:.3f} ms, hợp lệ={res.valid}"
    )
    if res.board:
        print(res.board.render())
    from nqueens_solver.gui.server import serve

    serve(hash_tab="sat")
