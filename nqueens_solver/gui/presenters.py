"""Chuyển kết quả solver thành JSON "từng bước" cho giao diện web hiển thị."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from nqueens_solver.core.cnf import ConstraintGroup, NQueensCNF
    from nqueens_solver.core.min_conflicts import MinConflictsResult, MinConflictsSolver
    from nqueens_solver.core.sat_solver import GlucoseQueensSolver
else:
    from ..core.cnf import ConstraintGroup, NQueensCNF
    from ..core.min_conflicts import MinConflictsResult, MinConflictsSolver
    from ..core.sat_solver import GlucoseQueensSolver


def _fmt_clause(clause: List[int]) -> str:
    return " ∨ ".join(f"x{v}" if v > 0 else f"¬x{-v}" for v in clause)


def _fmt_cells(cnf: NQueensCNF, clause: List[int]) -> str:
    return ",  ".join(f"x{abs(v)} = x({cnf.vars.cell(abs(v))[0]},{cnf.vars.cell(abs(v))[1]})" for v in clause)


def _sample(cnf: NQueensCNF, group: ConstraintGroup) -> Dict:
    """Chọn một đường tiêu biểu (dài nhất) và vài mệnh đề mẫu."""
    if not group.lines:
        return {"lines": [], "clauses": []}
    line = max(group.lines, key=len)
    shown = line if len(line) <= 12 else line[:12]
    idx = group.lines.index(line)
    if group.key.endswith("_alo"):
        clauses = [group.clauses[idx]]
    else:
        wanted = {cnf.vars.var(*c) for c in line}
        clauses = [c for c in group.clauses if abs(c[0]) in wanted and abs(c[1]) in wanted][:4]
    return {
        "lines": [[list(c) for c in line]],
        "clauses": [
            {"text": _fmt_clause(c if len(c) <= 8 else c[:8]) + (" ∨ …" if len(c) > 8 else ""),
             "cells": _fmt_cells(cnf, c[:4]) + (", …" if len(c) > 4 else "")}
            for c in clauses
        ],
        "shown": [list(c) for c in shown],
    }


def sat_trace(n: int) -> Dict:
    solver = GlucoseQueensSolver()
    res = solver.solve(n, keep_cnf=True)
    cnf = res.cnf
    steps: List[Dict] = []

    steps.append(
        {
            "title": "Bước 1 · Gán biến logic cho từng ô",
            "text": (
                f"Mỗi ô (r, c) của bàn cờ {n}×{n} ứng với một biến mệnh đề x(r,c): True nếu ô có hậu, "
                f"False nếu ô trống. Đánh số biến v = r·N + c + 1, tổng cộng {res.num_vars} biến "
                "(số ghi trên mỗi ô)."
            ),
            "labels": True,
            "lines": [],
            "samples": [],
            "added": 0,
            "total": 0,
            "queens": [],
        }
    )

    running = 0
    for i, g in enumerate(cnf.groups, start=2):
        running += g.count
        smp = _sample(cnf, g)
        steps.append(
            {
                "title": f"Bước {i} · {g.title}",
                "text": g.description,
                "logic": g.logic,
                "labels": n <= 10,
                "lines": smp["lines"],
                "samples": smp["clauses"],
                "added": g.count,
                "total": running,
                "queens": [],
                "num_lines": len(g.lines),
            }
        )

    steps.append(
        {
            "title": "Bước 7 · Công thức CNF hoàn chỉnh",
            "text": (
                f"Hội (∧) của {res.num_clauses} mệnh đề trên {res.num_vars} biến. "
                f"Sinh CNF mất {1000 * res.build_time:.2f} ms, nạp vào Glucose3 mất {1000 * res.load_time:.2f} ms."
            ),
            "labels": False,
            "lines": [],
            "samples": [],
            "added": 0,
            "total": res.num_clauses,
            "queens": [],
        }
    )

    queens = sorted([list(q) for q in res.board.queens]) if res.board else []
    steps.append(
        {
            "title": "Bước 8 · Glucose3 giải CNF",
            "text": (
                f"Kết quả: {'SATISFIABLE' if res.satisfiable else 'UNSATISFIABLE'} sau "
                f"{1000 * res.solve_time:.3f} ms. Các biến mang giá trị True trong mô hình "
                "được giải mã thành vị trí các quân hậu."
                if res.satisfiable
                else "Công thức không thoả mãn: bài toán không có nghiệm."
            ),
            "labels": False,
            "lines": [],
            "samples": [],
            "added": 0,
            "total": res.num_clauses,
            "queens": queens,
        }
    )
    steps.append(
        {
            "title": "Bước 9 · Kiểm tra nghiệm độc lập",
            "text": (
                f"Bàn cờ có {len(queens)} hậu, số cặp tấn công nhau = "
                f"{res.board.attacking_pairs() if res.board else '—'} → "
                f"{'nghiệm hợp lệ ✓' if res.valid else 'không hợp lệ ✗'}."
            ),
            "labels": False,
            "lines": [],
            "samples": [],
            "added": 0,
            "total": res.num_clauses,
            "queens": queens,
        }
    )

    return {
        "n": n,
        "summary": {
            "variables": res.num_vars,
            "clauses": res.num_clauses,
            "expected_clauses": NQueensCNF.expected_clause_count(n),
            "build_ms": 1000 * res.build_time,
            "load_ms": 1000 * res.load_time,
            "solve_ms": 1000 * res.solve_time,
            "satisfiable": res.satisfiable,
            "valid": res.valid,
            "groups": [{"key": g.key, "title": g.title, "count": g.count} for g in cnf.groups],
        },
        "steps": steps,
    }


def mc_trace(res: MinConflictsResult) -> Dict:
    events = []
    for e in res.events:
        if e[0] == "move":
            events.append(["m", e[1], e[2], e[3], e[4]])
        else:
            events.append(["r", e[1], e[2]])
    return {
        "algorithm": res.algorithm,
        "n": res.n,
        "solved": res.solved,
        "steps": res.steps,
        "restarts": res.restarts,
        "time_ms": 1000 * res.time_s,
        "init_cols": res.init_cols,
        "init_total": res.init_conflicts,
        "final_total": res.final_conflicts,
        "events": events,
        "truncated": res.truncated,
    }


def min_conflicts_compare(n: int, seed: int, max_steps: int) -> Dict:
    out = {}
    for key, solver in (
        ("standard", MinConflictsSolver.standard(max_steps)),
        ("heuristic", MinConflictsSolver.heuristic(max_steps)),
    ):
        out[key] = mc_trace(solver.solve(n, seed=seed, record=True))
    return out


if __name__ == "__main__":
    from nqueens_solver.gui.server import serve

    serve()
