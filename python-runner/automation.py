#!/usr/bin/env python3
"""Standalone Playwright/CDP host for the extension's exact DOM workflow snapshot.

The isolated JavaScript world intentionally preserves execCommand, synthetic DOM
input events, selectors, JS coercions and delays instead of Playwright auto-waits.
No extension installation, source checkout outside this directory, or Node needed.
"""
import argparse
import asyncio
import json
import math
import os
import shutil
import subprocess
from pathlib import Path
import re
import signal
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PROJECT = re.compile(r"^https://flow\.google\.com/project/[^/?#]+(?:[/?#]|$)")
DEBUG_HELP = '''Mở Chrome bằng profile thử nghiệm riêng, rồi đăng nhập và mở project:
  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-flow-python-test" https://flow.google.com/
Windows PowerShell:
  & "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\\ChromeFlowPythonTest" https://flow.google.com/
macOS:
  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-flow-python-test" https://flow.google.com/
Nếu profile thử nghiệm đã mở, thoát cửa sổ profile đó rồi chạy lại lệnh.
'''

# Matches background.js, including its narrower selector (not the content fallback).
POSITION_EXPRESSION = '''(() => {
  const buttons = document.querySelectorAll('flow-prompt-box flow-generate-icon-button button[aria-label="Start generation"], flow-generate-icon-button button[type="submit"]');
  const button = Array.from(buttons).find(el => !el.disabled && el.getClientRects().length > 0);
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()'''


def load_scenes(path):
    def reject_constant(value):
        raise ValueError(f"JSON không hợp lệ: {value}")
    data = json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=reject_constant)
    scenes = data if isinstance(data, list) else data.get("scenes") if isinstance(data, dict) else None
    if not isinstance(scenes, list):
        raise ValueError("JSON phải là mảng scene hoặc object { scenes: [...] }.")
    if not scenes:
        raise ValueError("Danh sách scenes rỗng.")
    # Do not normalize scene values: JS handles them exactly as content.js does.
    return scenes



def resolve_config(args):
    """CLI flags override config.json; default paths live beside the runner."""
    if args.project_url is None:
        config_path = Path(args.config)
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError(f"Không đọc được cấu hình {config_path}: {exc}") from exc
        if not isinstance(config, dict):
            raise ValueError(f"{config_path} phải là JSON object có project_url.")
        url = config.get("project_url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f"Hãy nhập URL project Google Flow vào project_url trong {config_path}.")
        args.project_url = url.strip()
    project_key(args.project_url)
    return args


def project_key(url):
    if not PROJECT.match(url):
        raise ValueError(f"URL phải là https://flow.google.com/project/...: {url}")
    parts = urlsplit(url)
    return (parts.scheme, parts.netloc, parts.path.split('/')[2])


async def select_page(browser, project_url=None):
    pages = [page for context in browser.contexts for page in context.pages]
    if project_url:
        key = project_key(project_url)
        candidates = [p for p in pages if PROJECT.match(p.url) and project_key(p.url) == key]
        # Prefer the complete URL before falling back to the same project ID.
        exact = [p for p in candidates if p.url == project_url]
        candidates = exact or candidates
    else:
        candidates = [p for p in pages if PROJECT.match(p.url)]
    if not candidates:
        raise ValueError("Không tìm thấy tab project phù hợp. Hãy mở project trong Chrome debug. "
                         "--project-url chọn tab đã mở, không tạo tab mới.")
    if len(candidates) > 1:
        focused = [p for p in candidates if await p.evaluate("document.hasFocus()")]
        if len(focused) == 1:
            return focused[0]
        raise ValueError("Có nhiều tab phù hợp; dùng --project-url hoặc đóng tab trùng:\n" +
                         "\n".join(p.url for p in candidates))
    return candidates[0]



def find_chrome_path():
    for command in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'):
        executable = shutil.which(command)
        if executable:
            return executable
    candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/opt/google/chrome/chrome',
    ]
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        if os.environ.get(variable):
            candidates.append(str(Path(os.environ[variable]) / 'Google/Chrome/Application/chrome.exe'))
    return next((path for path in candidates if Path(path).is_file()), None)


async def connect_browser(playwright, args):
    try:
        browser = await playwright.chromium.connect_over_cdp(args.cdp_url, timeout=args.connect_timeout)
        print(f"[CHROME] Đã kết nối CDP {args.cdp_url}", flush=True)
        return browser
    except Exception as exc:
        initial_error = exc
    endpoint = urlsplit(args.cdp_url)
    # Only launch for a refused local HTTP endpoint; never launch for auth,
    # protocol errors, remote servers or websocket URLs.
    if (args.no_launch or 'ECONNREFUSED' not in str(initial_error) or
            endpoint.scheme != 'http' or endpoint.hostname not in ('127.0.0.1', 'localhost') or
            endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment):
        raise RuntimeError(f"Không kết nối được CDP {args.cdp_url}: {initial_error}\n{DEBUG_HELP}") from initial_error
    executable = args.chrome_path or find_chrome_path()
    if not executable:
        raise RuntimeError("Không tìm thấy Chrome. Cài Google Chrome hoặc truyền --chrome-path /path/to/chrome.")
    profile = Path(args.profile_dir).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    command = [str(executable), f'--remote-debugging-port={endpoint.port or 80}',
               f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check', args.project_url]
    print(f"[CHROME] Tự mở Chrome; profile đăng nhập: {profile}", flush=True)
    launch_options = {"start_new_session": True} if os.name != 'nt' else {
        "creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    }
    log_path = ROOT / 'chrome.log'
    with log_path.open('ab') as log:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, **launch_options)
    # Keep the Popen object alive without owning/terminating the browser on exit.
    _chrome_processes.append(process)
    deadline = asyncio.get_running_loop().time() + max(args.connect_timeout, 1000) / 1000
    error = initial_error
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.5)
        try:
            return await playwright.chromium.connect_over_cdp(args.cdp_url, timeout=1000)
        except Exception as exc:
            error = exc
            if process.poll() is not None:
                break
    raise RuntimeError(f"Đã thử mở Chrome nhưng CDP chưa sẵn sàng: {error}. "
                       f"Xem {log_path}. Nếu profile {profile} đang mở không có debug, "
                       "hãy đóng các cửa sổ của profile đó rồi chạy lại. Chrome vẫn được giữ mở.")


_chrome_processes = []



async def wait_for_enter(prompt):
    """Wait for interactive input without blocking CDP or Ctrl+C handling."""
    import threading
    loop = asyncio.get_running_loop()
    done = loop.create_future()
    print(prompt, end='', flush=True)

    def deliver(line, error):
        if not done.done():
            if error:
                done.set_exception(error)
            elif not line:
                done.set_exception(EOFError())
            else:
                done.set_result(None)

    def read():
        line, error = None, None
        try:
            line = sys.stdin.readline()
        except Exception as exc:
            error = exc
        try:
            loop.call_soon_threadsafe(deliver, line, error)
        except RuntimeError:
            pass  # The CLI was cancelled and its loop has already closed.

    # Not an executor worker: cancellation must not wait for stdin at shutdown.
    threading.Thread(target=read, daemon=True).start()
    await done


async def prepare_page(browser, args):
    key = project_key(args.project_url)
    candidates = [page for context in browser.contexts for page in context.pages
                  if PROJECT.match(page.url) and project_key(page.url) == key]
    if candidates:
        page = await select_page(browser, args.project_url)
    else:
        if not browser.contexts:
            raise RuntimeError("Chrome không có browser context để mở trang đăng nhập.")
        context = browser.contexts[0]
        # Reuse the startup tab / login redirect, without replacing unrelated tabs.
        page = next((p for p in context.pages if p.url == 'about:blank' or
                     urlsplit(p.url).hostname in ('flow.google.com', 'accounts.google.com')), None)
        page = page or await context.new_page()
        print(f"[TAB] Đang mở project: {args.project_url}", flush=True)
        await page.goto(args.project_url, wait_until='domcontentloaded', timeout=30000)
        await page.wait_for_timeout(2000)
    await page.bring_to_front()
    ready_selector = 'input.search-input' if args.command == 'rename' else '.ProseMirror[contenteditable="true"]'
    needs_login = not PROJECT.match(page.url) or not await page.query_selector(ready_selector)
    if args.command == 'login' or needs_login:
        print("[LOGIN] Đăng nhập Google trong cửa sổ Chrome và mở project Flow. "
              "Phiên đăng nhập được Chrome lưu trong profile riêng.", flush=True)
        try:
            await wait_for_enter("Sau khi đăng nhập và thấy giao diện project, nhấn Enter tại đây để tiếp tục: ")
        except EOFError as exc:
            raise RuntimeError("Cần đăng nhập thủ công: chạy python automation login trong terminal tương tác.") from exc
        # Login can open another tab. Prefer the requested project when present.
        pages = [p for c in browser.contexts for p in c.pages]
        if any(PROJECT.match(p.url) and project_key(p.url) == key for p in pages):
            page = await select_page(browser, args.project_url)
        else:
            if page.is_closed():
                page = await browser.contexts[0].new_page()
            await page.goto(args.project_url, wait_until='domcontentloaded', timeout=30000)
            await page.wait_for_timeout(2000)
        if not PROJECT.match(page.url) or project_key(page.url) != key:
            raise RuntimeError("Chưa vào được project yêu cầu sau đăng nhập; hãy kiểm tra tài khoản và URL.")
    return page


class Runner:
    def __init__(self, page):
        self.page = page
        self.session = None
        self.context_id = None
        self.done = asyncio.get_running_loop().create_future()
        self.tasks = set()
        self.stop_requested = False
        self.results = None

    async def evaluate(self, expression, value=False):
        result = await self.session.send("Runtime.evaluate", {
            "expression": expression, "contextId": self.context_id, "returnByValue": value,
        })
        if "exceptionDetails" in result:
            detail = result["exceptionDetails"]
            raise RuntimeError(detail.get("exception", {}).get("description", detail.get("text")))
        return result.get("result", {}).get("value")

    async def install(self):
        self.session = await self.page.context.new_cdp_session(self.page)
        self.session.on("Runtime.bindingCalled", self._binding)
        await self.session.send("Runtime.enable")
        tree = await self.session.send("Page.getFrameTree")
        world = await self.session.send("Page.createIsolatedWorld", {
            "frameId": tree["frameTree"]["frame"]["id"],
            "worldName": "flow-python-runner",
        })
        self.context_id = world["executionContextId"]
        def context_destroyed(event):
            if event.get("executionContextId") == self.context_id and not self.done.done():
                self.done.set_exception(RuntimeError("Document của tab đích đã thay đổi; workflow bị gián đoạn."))
        self.session.on("Runtime.executionContextDestroyed", context_destroyed)
        self.session.on("Runtime.executionContextsCleared", lambda *_: context_destroyed({
            "executionContextId": self.context_id,
        }))
        await self.session.send("Runtime.addBinding", {
            "name": "__flowPythonEmit", "executionContextId": self.context_id,
        })
        snapshot = (ROOT / "workflow.js").read_text(encoding="utf-8")
        adapter = (ROOT / "bridge.js").read_text(encoding="utf-8")
        # The snapshot is a function body; chrome and console are lexical shims.
        await self.evaluate(adapter.replace("/* WORKFLOW_SNAPSHOT */", snapshot))

    def _binding(self, event):
        if event.get("name") != "__flowPythonEmit" or event.get("executionContextId") != self.context_id:
            return
        task = asyncio.create_task(self._message(json.loads(event["payload"])))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        task.add_done_callback(self._task_finished)

    def _task_finished(self, task):
        if not task.cancelled() and task.exception() and not self.done.done():
            self.done.set_exception(task.exception())

    async def _message(self, message):
        kind = message["kind"]
        if kind == "log":
            print(f'[{message["level"]}] ' + " ".join(message["args"]), flush=True)
        elif kind == "progress":
            data = message["data"]
            if self.results and data['status'] == 'COMPLETED':
                print('[SUBMITTED] Đã gửi toàn bộ prompt; đang chờ ảnh hoàn tất.', flush=True)
            else:
                print(f'[{data["status"]} {data["current"]}/{data["total"]}] {data["text"]}', flush=True)
            if data.get("error"):
                print(f'Lỗi cụ thể: {data["error"]}', file=sys.stderr, flush=True)
            if data["status"] in ("COMPLETED", "STOPPED", "ERROR") and not self.done.done():
                self.done.set_result(data)
        elif kind == "trusted-click":
            response = (await self.results.click(message.get('sceneIndex'), self.trusted_generate_click)
                        if self.results else await self.trusted_generate_click())
            await self.evaluate(f'globalThis.__flowRunner.reply({message["id"]}, {json.dumps(response)});')

    async def trusted_generate_click(self):
        session = None
        error = None
        try:
            if not PROJECT.match(self.page.url):
                raise ValueError("Chỉ có thể tạo ảnh trong tab project Google Flow.")
            session = await self.page.context.new_cdp_session(self.page)
            position = await session.send("Runtime.evaluate", {
                "expression": POSITION_EXPRESSION, "returnByValue": True,
            })
            coordinates = position.get("result", {}).get("value") or {}
            x, y = coordinates.get("x"), coordinates.get("y")
            if any(isinstance(v, bool) or not isinstance(v, (float, int)) or
                   not math.isfinite(v) or v < 0 for v in (x, y)):
                raise ValueError("Không tìm thấy nút Tạo ảnh đang bật sau khi kết nối tab.")
            for kind in ("mousePressed", "mouseReleased"):
                await session.send("Input.dispatchMouseEvent", {
                    "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1,
                })
        except Exception as exc:
            error = str(exc)
        finally:
            if session:
                try:
                    await session.detach()
                except Exception as exc:
                    error = error or str(exc)
        return {"ok": False, "error": error} if error else {"ok": True}

    async def run(self, action, scenes):
        request = json.dumps({"action": action, "data": {"scenes": scenes}}, ensure_ascii=True)
        response = await self.evaluate(f'globalThis.__flowRunner.dispatch({request})', True)
        if response.get("status") != "STARTED":
            raise RuntimeError(f"Workflow từ chối bắt đầu: {response}")
        return await self.done

    async def run_generation(self, scenes):
        result = await self.run("START_GENERATION", scenes)
        if self.results and result['status'] in ('COMPLETED', 'ERROR') and not self.stop_requested:
            await self.results.finish(lambda: self.stop_requested)
            if result['status'] == 'COMPLETED' and not self.stop_requested:
                print(f'[COMPLETED {len(scenes)}/{len(scenes)}] Đã tạo và đặt tên ảnh.', flush=True)
        return result

    async def run_rename(self, scenes):
        return await self.run("START_RENAME", scenes)

    async def stop(self):
        self.stop_requested = True
        print("[STOP] Đã gửi lệnh dừng; chờ thao tác hiện tại tới điểm kiểm tra dừng.", flush=True)
        await self.evaluate('globalThis.__flowRunner.dispatch({action: "STOP_GENERATION"})')

    async def detach(self):
        # No Browser.close, Context.close, Page.close or Browser.close CDP command.
        if self.results:
            await self.results.close(stopped=self.stop_requested)
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)
        if self.session:
            await self.session.detach()


async def run_cli(args):
    args.command = args.command or 'generate'
    args = resolve_config(args)
    if not math.isfinite(args.generation_timeout) or args.generation_timeout <= 0:
        raise ValueError('--generation-timeout phải là số giây dương hữu hạn.')
    scenes = None if args.command == "login" else load_scenes(args.input)
    if args.command == 'generate' and not args.submit_only:
        from flow_results import scene_names
        scene_names(scenes)  # Validate IDs before sending any paid generation.
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("Chưa cài Playwright: python -m pip install -r requirements.txt") from exc
    playwright = await async_playwright().start()
    runner = None
    stop_task = None
    loop = asyncio.get_running_loop()
    installed_signal = False
    try:
        browser = await connect_browser(playwright, args)
        page = await prepare_page(browser, args)
        if args.command == "login":
            print("[LOGIN] Đã mở project. Bạn có thể chạy generate hoặc rename; Chrome vẫn mở.", flush=True)
            return 0
        print(f"[TAB] {page.url}", flush=True)
        await page.bring_to_front()
        runner = Runner(page)
        await runner.install()
        if args.command == 'generate' and not args.submit_only:
            from flow_results import BatchResults
            runner.results = BatchResults(page, scenes, args.results_dir,
                None if args.no_download else args.output_dir, timeout=args.generation_timeout)

        def request_stop():
            nonlocal stop_task
            if stop_task is None:
                stop_task = asyncio.create_task(runner.stop())
                stop_task.add_done_callback(runner._task_finished)
        try:
            loop.add_signal_handler(signal.SIGINT, request_stop)
            installed_signal = True
        except NotImplementedError:
            # Windows event loops do not implement add_signal_handler.
            old_handler = signal.signal(signal.SIGINT, lambda *_: loop.call_soon_threadsafe(request_stop))
        page.on("close", lambda *_: runner.done.done() or runner.done.set_exception(RuntimeError("Tab đích đã đóng.")))
        browser.on("disconnected", lambda *_: runner.done.done() or runner.done.set_exception(RuntimeError("Chrome đã ngắt kết nối.")))
        result = await (runner.run_rename(scenes) if args.command == "rename" else runner.run_generation(scenes))
        if stop_task:
            await stop_task
        return 130 if runner.stop_requested else 1 if result["status"] == "ERROR" else 0
    finally:
        if installed_signal:
            loop.remove_signal_handler(signal.SIGINT)
        elif 'old_handler' in locals():
            signal.signal(signal.SIGINT, old_handler)
        if runner:
            try:
                await runner.detach()
            except Exception as exc:
                print(f"[Ngắt CDP] {exc}", file=sys.stderr)
        await playwright.stop()


def parser():
    result = argparse.ArgumentParser(description="Đối chiếu workflow Google Flow extension bằng Python/Playwright.")
    commands = result.add_subparsers(dest="command")
    # A bare invocation runs generate with sample.json and config.json.
    def options(target, suppress=False):
        default = argparse.SUPPRESS if suppress else None
        target.add_argument("--input", default=default if suppress else str(ROOT / "sample.json"), help="File JSON scenes (mặc định sample.json cạnh script)")
        target.add_argument("--config", default=default if suppress else str(ROOT / "config.json"), help="File URL project (mặc định config.json cạnh script)")
        target.add_argument("--cdp-url", default=default if suppress else "http://127.0.0.1:9222", help="Địa chỉ Chrome CDP")
        target.add_argument("--project-url", default=default, help="URL project của tab đã mở")
        target.add_argument("--profile-dir", default=default if suppress else str(ROOT / "chrome_data"), help="Profile lưu đăng nhập khi tự mở Chrome")
        target.add_argument("--chrome-path", default=default, help="Đường dẫn Chrome nếu không tự tìm thấy")
        target.add_argument("--no-launch", action="store_true", default=default if suppress else False, help="Chỉ kết nối CDP, không tự mở Chrome")
        target.add_argument("--connect-timeout", type=int, default=default if suppress else 10000, metavar="MS", help="Timeout kết nối CDP, mặc định 10000ms")
        target.add_argument('--submit-only', action='store_true', default=default if suppress else False, help='Chỉ gửi prompt như luồng cũ, không theo dõi/đổi tên/tải ảnh')
        target.add_argument('--no-download', action='store_true', default=default if suppress else False, help='Chỉ đổi tên card trên Flow, không tải file')
        target.add_argument('--output-dir', default=default if suppress else str(ROOT / 'output'), help='Thư mục ảnh tải về; mỗi lần chạy có thư mục riêng')
        target.add_argument('--results-dir', default=default if suppress else str(ROOT / 'results'), help='Thư mục lưu bảng ánh xạ scene và media ID')
        target.add_argument('--generation-timeout', type=float, default=default if suppress else 180, help='Số giây tối đa chờ response tạo ảnh (mặc định 180)')
    options(result)
    for name, help_text in (("generate", "Tạo ảnh theo thứ tự scenes"), ("rename", "Tìm theo prompt và đổi tên cards"), ("login", "Mở Chrome và đăng nhập Google, lưu phiên vào profile")):
        options(commands.add_parser(name, help=help_text), suppress=True)
    return result


def main():
    args = parser().parse_args()
    try:
        return asyncio.run(run_cli(args))
    except KeyboardInterrupt:
        print("\n[STOP] Đã ngắt runner; Chrome vẫn mở.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Lỗi: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
