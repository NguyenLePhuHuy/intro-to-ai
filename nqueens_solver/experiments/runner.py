"""Chạy thực nghiệm: (1) Glucose3 theo N tăng dần, (2) Min-Conflicts chuẩn vs heuristic."""
from __future__ import annotations

import statistics
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from nqueens_solver.core.min_conflicts import MinConflictsSolver
    from nqueens_solver.core.sat_solver import GlucoseQueensSolver
else:
    from ..core.min_conflicts import MinConflictsSolver
    from ..core.sat_solver import GlucoseQueensSolver

Progress = Optional[Callable[[int, int, str], None]]


class SATExperiment:
    """Với mỗi N: số biến, số mệnh đề CNF, thời gian sinh CNF / nạp / giải."""

    def __init__(self, repeats: int = 3):
        self.repeats = repeats
        self.solver = GlucoseQueensSolver()

    def run(self, ns: Sequence[int], progress: Progress = None) -> List[Dict]:
        rows: List[Dict] = []
        for i, n in enumerate(ns):
            if n < 4:
                raise ValueError("Đề bài yêu cầu N >= 4")
            results = [self.solver.solve(n) for _ in range(self.repeats)]
            first = results[0]
            rows.append(
                {
                    "n": n,
                    "variables": first.num_vars,
                    "clauses": first.num_clauses,
                    "build_ms": 1000 * statistics.mean(r.build_time for r in results),
                    "load_ms": 1000 * statistics.mean(r.load_time for r in results),
                    "solve_ms": 1000 * statistics.mean(r.solve_time for r in results),
                    "total_ms": 1000 * statistics.mean(r.total_time for r in results),
                    "satisfiable": first.satisfiable,
                    "valid": all(r.valid for r in results),
                }
            )
            if progress:
                progress(i + 1, len(ns), f"SAT N={n}")
        return rows


class MinConflictsExperiment:
    """So sánh Min-Conflicts chuẩn với bản có heuristic trên cùng bộ seed."""

    def __init__(self, runs: int = 20, max_steps: int = 100_000, base_seed: int = 2024):
        self.runs = runs
        self.max_steps = max_steps
        self.base_seed = base_seed

    def algorithms(self) -> Dict[str, MinConflictsSolver]:
        return {
            "standard": MinConflictsSolver.standard(self.max_steps),
            "heuristic": MinConflictsSolver.heuristic(self.max_steps),
        }

    def run(self, ns: Sequence[int], progress: Progress = None) -> List[Dict]:
        rows: List[Dict] = []
        algos = self.algorithms()
        total = len(ns) * len(algos)
        done = 0
        for n in ns:
            for key, solver in algos.items():
                results = [solver.solve(n, seed=self.base_seed + k) for k in range(self.runs)]
                ok = [r for r in results if r.solved]
                steps = [r.steps for r in results]
                rows.append(
                    {
                        "n": n,
                        "algorithm": key,
                        "runs": self.runs,
                        "success_rate": len(ok) / self.runs,
                        "avg_steps": statistics.mean(steps),
                        "median_steps": statistics.median(steps),
                        "avg_time_ms": 1000 * statistics.mean(r.time_s for r in results),
                        "avg_restarts": statistics.mean(r.restarts for r in results),
                        "avg_init_conflicts": statistics.mean(r.init_conflicts for r in results),
                        "valid": all(r.board.is_solution() for r in ok),
                    }
                )
                done += 1
                if progress:
                    progress(done, total, f"Min-Conflicts N={n} ({key})")
        return rows


if __name__ == "__main__":
    from nqueens_solver.gui.server import serve

    serve(hash_tab="exp")
