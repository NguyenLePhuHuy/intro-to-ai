"""Xuất kết quả thực nghiệm ra CSV / JSON / Markdown."""
from __future__ import annotations

import csv
import json
import platform
import sys
from pathlib import Path
from typing import Dict, List


class ReportWriter:
    def __init__(self, out_dir: Path):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def write_csv(self, name: str, rows: List[Dict]) -> Path:
        path = self.out_dir / f"{name}.csv"
        if rows:
            with path.open("w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
        return path

    def write_json(self, name: str, rows: List[Dict]) -> Path:
        path = self.out_dir / f"{name}.json"
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    @staticmethod
    def environment() -> str:
        return f"Python {sys.version.split()[0]} · {platform.platform()} · {platform.processor() or platform.machine()}"

    def write_markdown(self, sat_rows: List[Dict], mc_rows: List[Dict]) -> Path:
        lines = ["# Kết quả thực nghiệm N-Queens", "", f"Môi trường: {self.environment()}", ""]
        if sat_rows:
            lines += [
                "## 1. Glucose3 (PySAT)",
                "",
                "| N | Số biến | Số mệnh đề CNF | Sinh CNF (ms) | Nạp (ms) | Solve (ms) | Tổng (ms) | Nghiệm hợp lệ |",
                "|---:|---:|---:|---:|---:|---:|---:|:---:|",
            ]
            for r in sat_rows:
                lines.append(
                    f"| {r['n']} | {r['variables']} | {r['clauses']} | {r['build_ms']:.2f} | "
                    f"{r['load_ms']:.2f} | {r['solve_ms']:.2f} | {r['total_ms']:.2f} | "
                    f"{'✓' if r['valid'] else '✗'} |"
                )
            lines.append("")
        if mc_rows:
            lines += [
                "## 2. Min-Conflicts chuẩn vs heuristic",
                "",
                "| N | Thuật toán | Tỉ lệ thành công | Số bước TB | Số bước trung vị | Thời gian TB (ms) | Restart TB |",
                "|---:|:---|---:|---:|---:|---:|---:|",
            ]
            for r in mc_rows:
                lines.append(
                    f"| {r['n']} | {r['algorithm']} | {100 * r['success_rate']:.0f}% | "
                    f"{r['avg_steps']:.1f} | {r['median_steps']:.1f} | {r['avg_time_ms']:.2f} | "
                    f"{r['avg_restarts']:.2f} |"
                )
            lines.append("")
        path = self.out_dir / "report.md"
        path.write_text("\n".join(lines), encoding="utf-8")
        return path


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from nqueens_solver.gui.server import serve

    serve(hash_tab="exp")
