"""Điểm vào của dự án N-Queens (Local Search & Propositional Logic).

  python main.py                 # tự mở cửa sổ giao diện trực quan (mặc định)
  python main.py gui --port 8000
  python main.py experiments     # chạy toàn bộ thực nghiệm, lưu vào results/ rồi tự hiện kết quả
  python main.py sat --n 4 8 12  # chỉ chạy thực nghiệm Glucose3
  python main.py minconflicts --n 8 64 512 --runs 20

Thêm --no-gui vào các lệnh thực nghiệm nếu chỉ muốn xem kết quả trong terminal.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Cho phép chạy từ bất kỳ thư mục nào (python D:\...\main.py)
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Terminal Windows mặc định không phải UTF-8 -> tránh lỗi khi in tiếng Việt / ký hiệu ♛
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

DEFAULT_SAT_N = [4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50]
DEFAULT_MC_N = [8, 16, 32, 64, 128, 256, 512, 1000]
RESULTS = ROOT / "results"


def run_sat(ns):
    from nqueens_solver.experiments import ReportWriter, SATExperiment

    print(f"{'N':>4} {'biến':>6} {'mệnh đề':>9} {'sinh CNF':>10} {'nạp':>8} {'solve':>9}  (ms)")
    rows = SATExperiment(repeats=3).run(
        ns,
        progress=lambda d, t, m: print(f"  … {m} ({d}/{t})", end="\r", flush=True),
    )
    print(" " * 40, end="\r")
    for r in rows:
        print(f"{r['n']:>4} {r['variables']:>6} {r['clauses']:>9} {r['build_ms']:>10.2f} "
              f"{r['load_ms']:>8.2f} {r['solve_ms']:>9.3f}  {'OK' if r['valid'] else 'SAI'}")
    writer = ReportWriter(RESULTS)
    writer.write_csv("sat_results", rows)
    writer.write_json("sat_results", rows)
    return rows


def run_mc(ns, runs, max_steps):
    from nqueens_solver.experiments import MinConflictsExperiment, ReportWriter

    rows = MinConflictsExperiment(runs, max_steps).run(
        ns,
        progress=lambda d, t, m: print(f"  … {m} ({d}/{t})", end="\r", flush=True),
    )
    print(" " * 60, end="\r")
    print(f"{'N':>5} {'thuật toán':<10} {'thành công':>10} {'bước TB':>9} {'thời gian TB (ms)':>18}")
    for r in rows:
        print(f"{r['n']:>5} {r['algorithm']:<10} {100 * r['success_rate']:>9.0f}% "
              f"{r['avg_steps']:>9.1f} {r['avg_time_ms']:>18.2f}")
    writer = ReportWriter(RESULTS)
    writer.write_csv("min_conflicts_results", rows)
    writer.write_json("min_conflicts_results", rows)
    return rows


def _load_saved(name):
    import json

    try:
        return json.loads((RESULTS / f"{name}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def show_gui(tab: str = "", port: int = 8000, open_browser: bool = True) -> None:
    from nqueens_solver.gui.server import serve

    serve(port, open_browser, hash_tab=tab)


def main() -> None:
    parser = argparse.ArgumentParser(description="N-Queens: SAT (Glucose3) & Min-Conflicts")
    sub = parser.add_subparsers(dest="cmd")

    gui = sub.add_parser("gui", help="mở giao diện")
    gui.add_argument("--port", type=int, default=8000)
    gui.add_argument("--no-browser", action="store_true", help="không tự mở cửa sổ")

    sat = sub.add_parser("sat", help="thực nghiệm Glucose3")
    sat.add_argument("--n", type=int, nargs="+", default=DEFAULT_SAT_N)
    sat.add_argument("--no-gui", action="store_true", help="không tự hiện kết quả trên giao diện")

    mc = sub.add_parser("minconflicts", help="thực nghiệm Min-Conflicts")
    mc.add_argument("--n", type=int, nargs="+", default=DEFAULT_MC_N)
    mc.add_argument("--runs", type=int, default=20)
    mc.add_argument("--max-steps", type=int, default=100_000)
    mc.add_argument("--no-gui", action="store_true", help="không tự hiện kết quả trên giao diện")

    exp = sub.add_parser("experiments", help="chạy tất cả thực nghiệm và xuất báo cáo")
    exp.add_argument("--runs", type=int, default=20)
    exp.add_argument("--no-gui", action="store_true", help="không tự hiện kết quả trên giao diện")

    args = parser.parse_args()
    cmd = args.cmd or "gui"

    if cmd == "gui":
        show_gui("", getattr(args, "port", 8000), not getattr(args, "no_browser", False))
        return

    from nqueens_solver.experiments import ReportWriter

    if cmd == "sat":
        rows = run_sat(args.n)
        ReportWriter(RESULTS).write_markdown(rows, _load_saved("min_conflicts_results"))
    elif cmd == "minconflicts":
        rows = run_mc(args.n, args.runs, args.max_steps)
        ReportWriter(RESULTS).write_markdown(_load_saved("sat_results"), rows)
    elif cmd == "experiments":
        print("== Glucose3 ==")
        sat_rows = run_sat(DEFAULT_SAT_N)
        print("\n== Min-Conflicts ==")
        mc_rows = run_mc(DEFAULT_MC_N, args.runs, 100_000)
        ReportWriter(RESULTS).write_markdown(sat_rows, mc_rows)

    print(f"\nĐã lưu kết quả vào {RESULTS} (xem report.md)")
    if not args.no_gui:
        show_gui("exp")


if __name__ == "__main__":
    main()
