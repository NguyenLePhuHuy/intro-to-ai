"""Máy chủ web cục bộ (chỉ dùng thư viện chuẩn) phục vụ giao diện trực quan.

Khi chạy, giao diện được mở tự động trong một cửa sổ ứng dụng riêng
(Edge/Chrome ở chế độ --app: không thanh địa chỉ, không cần bấm vào port nào).
Đóng cửa sổ là chương trình tự kết thúc.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from nqueens_solver.experiments.reporting import ReportWriter
    from nqueens_solver.experiments.runner import MinConflictsExperiment, SATExperiment
    from nqueens_solver.gui.presenters import min_conflicts_compare, sat_trace
else:
    from ..experiments.reporting import ReportWriter
    from ..experiments.runner import MinConflictsExperiment, SATExperiment
    from .presenters import min_conflicts_compare, sat_trace

STATIC_DIR = Path(__file__).parent / "static"
RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}

# Giới hạn để giao diện luôn phản hồi nhanh
LIMITS = {
    "sat_trace_n": 60,
    "mc_trace_n": 200,
    "mc_max_steps": 200_000,
    "exp_sat_n": 80,
    "exp_mc_n": 5000,
    "exp_runs": 100,
}


class JobManager:
    """Chạy thực nghiệm nền và cho phép giao diện hỏi tiến độ."""

    def __init__(self) -> None:
        self._jobs: Dict[str, Dict] = {}
        self._lock = threading.Lock()

    def start(self, kind: str, params: Dict) -> str:
        job_id = uuid.uuid4().hex[:8]
        job = {
            "id": job_id,
            "kind": kind,
            "status": "running",
            "done": 0,
            "total": 1,
            "message": "Đang khởi động…",
            "rows": [],
            "error": None,
            "files": [],
        }
        with self._lock:
            self._jobs[job_id] = job
        threading.Thread(target=self._run, args=(job, kind, params), daemon=True).start()
        return job_id

    def get(self, job_id: str) -> Optional[Dict]:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def busy(self) -> bool:
        with self._lock:
            return any(j["status"] == "running" for j in self._jobs.values())

    def _run(self, job: Dict, kind: str, params: Dict) -> None:
        def progress(done: int, total: int, message: str) -> None:
            job.update(done=done, total=total, message=message)

        try:
            writer = ReportWriter(RESULTS_DIR)
            if kind == "sat":
                rows = SATExperiment(repeats=params["repeats"]).run(params["ns"], progress)
                files = [writer.write_csv("sat_results", rows), writer.write_json("sat_results", rows)]
                writer.write_markdown(rows, _load_rows("min_conflicts_results"))
            else:
                exp = MinConflictsExperiment(params["runs"], params["max_steps"])
                rows = exp.run(params["ns"], progress)
                files = [
                    writer.write_csv("min_conflicts_results", rows),
                    writer.write_json("min_conflicts_results", rows),
                ]
                writer.write_markdown(_load_rows("sat_results"), rows)
            job.update(
                rows=rows,
                status="done",
                message="Hoàn tất",
                files=[str(p.relative_to(RESULTS_DIR.parent)) for p in files],
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            job.update(status="error", error=str(exc))


JOBS = JobManager()


def _load_rows(name: str) -> List[Dict]:
    """Đọc kết quả thực nghiệm đã lưu (nếu có) trong results/."""
    path = RESULTS_DIR / f"{name}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _int(body: Dict, key: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(body.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"'{key}' phải là số nguyên")
    if not lo <= value <= hi:
        raise ValueError(f"'{key}' phải nằm trong [{lo}, {hi}]")
    return value


def _int_list(body: Dict, key: str, lo: int, hi: int) -> List[int]:
    raw = body.get(key)
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"'{key}' phải là danh sách số nguyên")
    try:
        values = [int(v) for v in raw]
    except (TypeError, ValueError):
        raise ValueError(f"'{key}' chỉ được chứa số nguyên")
    if any(v < lo or v > hi for v in values) or len(values) > 40:
        raise ValueError(f"Mỗi giá trị của '{key}' phải nằm trong [{lo}, {hi}] (tối đa 40 giá trị)")
    return values


# ---------------------------------------------------------------------------
# Tự tắt khi người dùng đóng cửa sổ giao diện
# ---------------------------------------------------------------------------
class Lifecycle:
    """Trang web gửi 'bye' khi bị đóng; nếu sau vài giây không có trang nào
    kết nối lại (ví dụ chỉ là tải lại trang) thì máy chủ tự dừng."""

    GRACE_S = 4.0

    def __init__(self) -> None:
        self.enabled = True
        self.httpd: Optional[ThreadingHTTPServer] = None
        self._last_seen = time.monotonic()
        self._lock = threading.Lock()

    def touch(self) -> None:
        with self._lock:
            self._last_seen = time.monotonic()

    def bye(self) -> None:
        if not self.enabled:
            return
        bye_at = time.monotonic()

        def check() -> None:
            with self._lock:
                reconnected = self._last_seen > bye_at + 0.05
            if not reconnected and not JOBS.busy() and self.httpd:
                print("  Cửa sổ giao diện đã đóng → tự động dừng chương trình.")
                threading.Thread(target=self.httpd.shutdown, daemon=True).start()

        threading.Timer(self.GRACE_S, check).start()


LIFE = Lifecycle()


class Handler(BaseHTTPRequestHandler):
    server_version = "NQueensLab/2.0"

    def log_message(self, fmt: str, *args) -> None:  # giữ terminal gọn
        pass

    # ----- tiện ích ------------------------------------------------------
    def _send(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status: int, data) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    # ----- GET -----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0].split("#")[0]
        if path != "/api/bye":
            LIFE.touch()
        if path.startswith("/api/jobs/"):
            job = JOBS.get(path.rsplit("/", 1)[-1])
            return self._json(200, job) if job else self._json(404, {"error": "Không tìm thấy tác vụ"})
        if path == "/api/limits":
            return self._json(200, LIMITS)
        if path == "/api/ping":
            return self._json(200, {"ok": True})
        if path == "/api/results":
            return self._json(200, {"sat": _load_rows("sat_results"), "mc": _load_rows("min_conflicts_results")})
        name = "index.html" if path in ("/", "") else path.lstrip("/")
        static_root = STATIC_DIR.resolve()
        target = (STATIC_DIR / name).resolve()
        if static_root not in target.parents or not target.is_file():
            return self._json(404, {"error": "Not found"})
        self._send(200, target.read_bytes(), CONTENT_TYPES.get(target.suffix, "application/octet-stream"))

    # ----- POST ----------------------------------------------------------
    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/api/bye":
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length:
                self.rfile.read(length)
            LIFE.bye()
            return self._json(200, {"ok": True})
        LIFE.touch()
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/sat":
                n = _int(body, "n", 8, 4, LIMITS["sat_trace_n"])
                return self._json(200, sat_trace(n))
            if path == "/api/minconflicts":
                n = _int(body, "n", 8, 4, LIMITS["mc_trace_n"])
                seed = _int(body, "seed", 1, 0, 10 ** 9)
                max_steps = _int(body, "max_steps", 5000, 10, LIMITS["mc_max_steps"])
                return self._json(200, min_conflicts_compare(n, seed, max_steps))
            if path == "/api/experiments/sat":
                params = {
                    "ns": _int_list(body, "ns", 4, LIMITS["exp_sat_n"]),
                    "repeats": _int(body, "repeats", 3, 1, 10),
                }
                return self._json(200, {"job": JOBS.start("sat", params)})
            if path == "/api/experiments/minconflicts":
                params = {
                    "ns": _int_list(body, "ns", 4, LIMITS["exp_mc_n"]),
                    "runs": _int(body, "runs", 20, 1, LIMITS["exp_runs"]),
                    "max_steps": _int(body, "max_steps", 100_000, 100, 1_000_000),
                }
                return self._json(200, {"job": JOBS.start("mc", params)})
            return self._json(404, {"error": "Not found"})
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})
        except ImportError as exc:
            return self._json(500, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._json(500, {"error": f"Lỗi nội bộ: {exc}"})


# ---------------------------------------------------------------------------
# Mở cửa sổ giao diện
# ---------------------------------------------------------------------------
def _find_free_port(start: int = 8000) -> int:
    """Tìm cổng chưa dùng bắt đầu từ start."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return 0  # để hệ điều hành tự chọn


def _app_browsers() -> List[str]:
    """Các trình duyệt hỗ trợ chế độ cửa sổ ứng dụng (--app)."""
    candidates: List[str] = []
    if sys.platform.startswith("win"):
        for env in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if not base:
                continue
            candidates += [
                os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
                os.path.join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            ]
    elif sys.platform == "darwin":
        candidates += [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
    for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    return [c for c in candidates if c and os.path.isfile(c)]


def open_window(url: str) -> str:
    """Mở giao diện trong cửa sổ ứng dụng; nếu không có Edge/Chrome thì dùng trình duyệt mặc định."""
    for exe in _app_browsers():
        try:
            subprocess.Popen(
                [exe, f"--app={url}", "--new-window", "--window-size=1440,920", "--no-first-run"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return "app"
        except OSError:
            continue
    webbrowser.open(url)
    return "browser"


def serve(port: int = 8000, open_browser: bool = True, hash_tab: str = "", auto_exit: bool = True) -> None:
    port = _find_free_port(port)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/" + (f"#{hash_tab}" if hash_tab else "")
    LIFE.httpd = httpd
    LIFE.enabled = auto_exit and open_browser

    print("\n  ♛ N-Queens Lab đã khởi động.")
    if open_browser:
        threading.Timer(0.12, lambda: open_window(url)).start()
        print("  → Đang tự động mở cửa sổ giao diện thành phẩm...")
        print("  Đóng cửa sổ giao diện hoặc nhấn Ctrl+C để thoát.\n")
    else:
        print(f"  Địa chỉ: {url}   (Ctrl+C để dừng)\n")
    try:
        httpd.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        print("\n  Đã dừng.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    serve()
