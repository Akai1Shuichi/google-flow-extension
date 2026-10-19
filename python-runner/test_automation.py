"""Offline tests. Integration tests use a separate headless Chrome, never user tabs."""
import asyncio
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

import automation


class InputTests(unittest.TestCase):
    def load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            path.write_text(json.dumps(value), encoding='utf-8')
            return automation.load_scenes(path)

    def test_input_preserves_scene_values(self):
        scenes = [{'id': 'SC01', 'character': 'A; B', 'prompt': ' x ', 'extra': [1]},
                  {'character': '', 'prompt': 'y'}, {'character': 'B', 'prompt': 'z'}]
        self.assertEqual(self.load(scenes), scenes)
        self.assertEqual(self.load({'scenes': scenes}), scenes)

    def test_invalid_shapes_and_empty_input(self):
        for data in ([], {}, {'scenes': []}, {'scenes': 'bad'}, None):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.load(data)

    def test_cli_default_and_options_on_either_side(self):
        parser = automation.parser()
        self.assertIsNone(parser.parse_args([]).command)
        for argv in (['--input', 'x.json', 'rename'], ['rename', '--input', 'x.json']):
            self.assertEqual(parser.parse_args(argv).input, 'x.json')
        self.assertEqual(parser.parse_args(['--cdp-url', 'http://a', 'generate']).cdp_url, 'http://a')

    def test_default_files_and_config_override(self):
        parser = automation.parser()
        args = parser.parse_args(['rename'])
        self.assertEqual(Path(args.input), automation.ROOT / 'sample.json')
        self.assertEqual(Path(args.config), automation.ROOT / 'config.json')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps({'project_url': ' https://flow.google.com/project/demo '}))
            args = automation.resolve_config(parser.parse_args(['rename', '--config', str(path)]))
            self.assertEqual(args.project_url, 'https://flow.google.com/project/demo')
            path.write_text('{"project_url": ""}')
            with self.assertRaisesRegex(ValueError, 'Hãy nhập URL'):
                automation.resolve_config(parser.parse_args(['generate', '--config', str(path)]))
            args = automation.resolve_config(parser.parse_args([
                'generate', '--config', str(path), '--project-url', 'https://flow.google.com/project/override']))
            self.assertEqual(args.project_url, 'https://flow.google.com/project/override')

    def test_snapshot_is_exact_extension_content(self):
        self.assertEqual((automation.ROOT / 'workflow.js').read_bytes(),
                         (automation.ROOT.parent / 'content.js').read_bytes())



class StartupTests(unittest.IsolatedAsyncioTestCase):
    def args(self, *extra):
        return automation.parser().parse_args(['login', '--project-url',
            'https://flow.google.com/project/login-test', *extra])

    async def test_existing_cdp_is_preferred_without_launch(self):
        args = self.args()
        browser = Mock()
        playwright = Mock()
        playwright.chromium.connect_over_cdp = AsyncMock(return_value=browser)
        with patch('automation.subprocess.Popen') as launch:
            self.assertIs(await automation.connect_browser(playwright, args), browser)
            launch.assert_not_called()

    async def test_refused_local_cdp_launches_chrome_with_persistent_profile(self):
        args = self.args('--profile-dir', '/tmp/flow-profile-test')
        browser = Mock()
        playwright = Mock()
        playwright.chromium.connect_over_cdp = AsyncMock(side_effect=[
            RuntimeError('connect ECONNREFUSED 127.0.0.1:9222'), browser])
        with patch('automation.find_chrome_path', return_value='/usr/bin/google-chrome'), \
             patch('automation.subprocess.Popen') as launch:
            launch.return_value.poll.return_value = None
            self.assertIs(await automation.connect_browser(playwright, args), browser)
            command = launch.call_args.args[0]
            self.assertIn(f'--user-data-dir={Path("/tmp/flow-profile-test").resolve()}', command)
            self.assertIn('--remote-debugging-port=9222', command)
            self.assertIn(args.project_url, command)
            launch.return_value.terminate.assert_not_called()

    async def test_no_launch_reports_connection_failure(self):
        args = self.args('--no-launch')
        playwright = Mock()
        playwright.chromium.connect_over_cdp = AsyncMock(side_effect=RuntimeError('ECONNREFUSED'))
        with patch('automation.subprocess.Popen') as launch:
            with self.assertRaisesRegex(RuntimeError, 'Không kết nối được CDP'):
                await automation.connect_browser(playwright, args)
            launch.assert_not_called()


FIXTURE = '''<!doctype html><meta charset="utf-8">
<flow-prompt-box>
  <button aria-label="Image">Image</button>
  <button aria-label="Clear prompt" onclick="editor.innerText=''; chips.innerHTML=''">Clear</button>
  <div id="chips"></div>
  <div id="editor" class="ProseMirror" contenteditable="true"></div>
  <flow-generate-icon-button><button aria-label="Start generation" type="submit">Generate</button></flow-generate-icon-button>
</flow-prompt-box>
<flow-add-menu-side-nav>
  <flow-add-menu-asset-item><span class="asset-title">A</span></flow-add-menu-asset-item>
  <flow-add-menu-asset-item><span class="asset-title">B</span></flow-add-menu-asset-item>
</flow-add-menu-side-nav>
<button class="detail-add-to-prompt-btn">Add to prompt</button>
<input class="search-input"><button aria-label="Clear search input">Clear search</button>
<flow-grid-tile-container><button aria-label="More options">More</button></flow-grid-tile-container>
<flow-grid-tile-container><button aria-label="More options">More</button></flow-grid-tile-container>
<div class="cdk-overlay-pane" hidden><button role="menuitem">Rename</button></div>
<div class="footer-left"><input class="editable-text-input editing" hidden></div>
<script>
window.records = []; window.renamed = []; let selected; let tileIndex;
document.querySelectorAll('flow-add-menu-asset-item').forEach(el => el.onclick = () => selected = el.innerText);
document.querySelector('.detail-add-to-prompt-btn').onclick = () => {
  const chip = document.createElement('span'); chip.className = 'chip-container';
  chip.setAttribute('aria-label', 'Ingredient'); chip.innerText = selected; chips.appendChild(chip);
};
document.querySelector('flow-generate-icon-button button').onclick = event => {
  records.push({trusted: event.isTrusted, prompt: editor.innerText,
    characters: Array.from(chips.children).map(el => el.innerText)});
  editor.innerText = '';
};
document.querySelectorAll('flow-grid-tile-container button').forEach((el, index) => el.onclick = () => {
  tileIndex = index; document.querySelector('.cdk-overlay-pane').hidden = false;
});
document.querySelector('.cdk-overlay-pane button').onclick = () => {
  document.querySelector('.cdk-overlay-pane').hidden = true;
  document.querySelector('.editing').hidden = false;
};
document.querySelector('.editing').onkeydown = event => {
  if (event.key === 'Enter') renamed.push({index: tileIndex, name: event.target.value});
};
document.querySelector('[aria-label="Clear search input"]').onclick = () => document.querySelector('.search-input').value = '';
</script>'''


class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.browser = await self.pw.chromium.launch(
            executable_path=os.environ.get('FLOW_TEST_CHROME', '/usr/bin/google-chrome'),
            headless=True, args=[f'--remote-debugging-port={self.port}'])
        self.context = await self.browser.new_context()
        self.page = await self.context.new_page()
        await self.page.route('https://flow.google.com/**', lambda route: route.fulfill(body=FIXTURE, content_type='text/html'))
        await self.page.goto('https://flow.google.com/project/offline-fixture')
        self.temp = tempfile.TemporaryDirectory()

    async def asyncTearDown(self):
        await self.browser.close()  # Only this test-owned Chrome.
        await self.pw.stop()
        self.temp.cleanup()

    async def cli(self, command, scenes, *, track_results=False):
        path = Path(self.temp.name) / 'input.json'
        path.write_text(json.dumps(scenes), encoding='utf-8')
        return await asyncio.create_subprocess_exec(
            sys.executable, str(automation.ROOT / 'automation.py'), command,
            '--input', str(path), '--cdp-url', f'http://127.0.0.1:{self.port}',
            '--project-url', self.page.url,
            *(['--no-download', '--results-dir', self.temp.name] if track_results else ['--submit-only']),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

    async def result(self, process):
        stdout, stderr = await asyncio.wait_for(process.communicate(), 45)
        return process.returncode, stdout.decode(), stderr.decode()

    @unittest.skipIf(os.name == 'nt', 'Windows subprocess.send_signal không hỗ trợ POSIX SIGINT')
    async def test_ctrl_c_during_login_keeps_browser(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(automation.ROOT / 'automation'), 'login',
            '--project-url', self.page.url, '--cdp-url', f'http://127.0.0.1:{self.port}',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            while True:
                line = await asyncio.wait_for(process.stdout.readline(), 10)
                self.assertTrue(line)
                if b'[LOGIN]' in line:
                    break
            await asyncio.sleep(0.1)
            process.send_signal(signal.SIGINT)
            try:
                await asyncio.wait_for(process.wait(), 3)
            except asyncio.TimeoutError:
                self.fail('Ctrl+C khi chờ đăng nhập phải thoát mà không cần nhấn Enter')
            self.assertEqual(process.returncode, 130)
            self.assertTrue(self.browser.is_connected())
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    async def test_login_uses_no_scene_file_and_keeps_browser(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(automation.ROOT / 'automation'), 'login',
            '--input', '/nonexistent/scenes.json', '--project-url', self.page.url,
            '--cdp-url', f'http://127.0.0.1:{self.port}',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(process.communicate(b'\n'), 15)
        self.assertEqual(process.returncode, 0, stdout.decode() + stderr.decode())
        self.assertIn('[LOGIN] Đã mở project', stdout.decode())
        self.assertEqual(await self.page.evaluate('records'), [])
        self.assertTrue(self.browser.is_connected())

    async def test_generate_per_scene_characters_trusted_click_and_disconnect(self):
        process = await self.cli('generate', [
            {'id': 'SC01', 'character': ' A; B ', 'prompt': 'First'},
            {'id': 'SC02', 'character': '', 'prompt': 'Second'},
            {'id': 'SC03', 'character': 'B', 'prompt': 'Third'},
        ])
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 0, stdout + stderr)
        self.assertIn('COMPLETED 3/3', stdout)
        self.assertEqual(await self.page.evaluate('records'), [
            {'trusted': True, 'prompt': '\u00a0First', 'characters': ['A', 'B']},
            {'trusted': True, 'prompt': 'Second', 'characters': []},
            {'trusted': True, 'prompt': '\u00a0Third', 'characters': ['B']},
        ])

    async def test_batch_names_by_request_with_identical_prompts_and_reversed_results(self):
        # The second request finishes first; DOM order is also reversed within a batch.
        async def generate(route):
            request = route.request
            from urllib.parse import parse_qs
            body = json.loads(parse_qs(request.post_data)['f.req'][0])
            call = json.loads(body[0][0][1])
            number = call[0]
            await asyncio.sleep(8 if number == 1 else 0.1)
            ids = ['11111111-1111-4111-8111-111111111111',
                   '22222222-2222-4222-8222-222222222222'] if number == 1 else [
                   '33333333-3333-4333-8333-333333333333',
                   '44444444-4444-4444-8444-444444444444']
            payload = [[[media_id, None, 'entity-' + media_id] for media_id in ids], []]
            wire = json.dumps([['wrb.fr', 'ogiZ0b', json.dumps(payload), None]])
            await route.fulfill(body=")]}'\n\n" + str(len(wire)) + '\n' + wire,
                                content_type='application/json')

        await self.page.route('**/data/batchexecute*', generate)
        await self.page.evaluate('''() => {
          let n = 0;
          document.querySelector('flow-generate-icon-button button').onclick = async () => {
            const prompt = editor.innerText; editor.innerText = '';
            const call = [++n, [0, 1].map(() => {
              const row = []; row[7] = []; row[7][5] = 'offline-fixture';
              row[8] = [[[prompt]]]; return row;
            })];
            const response = await fetch('/_/AiSandboxAngularFrontend/data/batchexecute', {
              method: 'POST', body: new URLSearchParams({
                'f.req': JSON.stringify([[['ogiZ0b', JSON.stringify(call), null, 'generic']]])
              })
            });
            const wire = await response.text();
            const rows = JSON.parse(JSON.parse(wire.split('\\n').pop())[0][2])[0];
            for (const row of rows.reverse()) {
              const tile = document.createElement('flow-grid-tile-container');
              tile.setAttribute('aria-label', 'Original');
              tile.innerHTML = `<img data-media-id="${row[0]}"><button aria-label="More options">More</button>`;
              tile.querySelector('button').onclick = () => {
                document.querySelector('.cdk-overlay-pane').hidden = false;
                document.querySelector('.editing').onkeydown = event => {
                  if (event.key === 'Enter') {
                    tile.setAttribute('aria-label', event.target.value);
                    renamed.push({mediaId: row[0], name: event.target.value});
                    event.target.hidden = true;
                  }
                };
              };
              document.body.prepend(tile);
            }
          };
        }''')
        process = await self.cli('generate', [
            {'id': 'SC01', 'prompt': 'same'}, {'id': 'SC02', 'prompt': 'same'}], track_results=True)
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 0, stdout + stderr)
        actual = {row['mediaId']: row['name'] for row in await self.page.evaluate('renamed')}
        self.assertEqual(actual, {
            '11111111-1111-4111-8111-111111111111': 'SC01_1',
            '22222222-2222-4222-8222-222222222222': 'SC01_2',
            '33333333-3333-4333-8333-333333333333': 'SC02_1',
            '44444444-4444-4444-8444-444444444444': 'SC02_2',
        })
        self.assertTrue(self.browser.is_connected())
        self.assertEqual(await self.page.title(), '')
        self.assertIsNone(await self.page.evaluate('window.__flowRunner'))  # Isolated world.

    async def test_short_command_reads_sample_and_config_beside_script(self):
        directory = Path(self.temp.name)
        for filename in ('automation', 'automation.py', 'bridge.js', 'workflow.js'):
            shutil.copyfile(automation.ROOT / filename, directory / filename)
        (directory / 'sample.json').write_text(json.dumps([{'id': 'SC99', 'prompt': 'Needle'}]))
        (directory / 'config.json').write_text(json.dumps({'project_url': self.page.url}))
        # The only extra flag selects the test-owned CDP port; no input or URL flags.
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(directory / 'automation'), 'rename',
            '--cdp-url', f'http://127.0.0.1:{self.port}', cwd=automation.ROOT,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 0, stdout + stderr)
        self.assertEqual(await self.page.evaluate('renamed'), [
            {'index': 0, 'name': 'SC99'}, {'index': 1, 'name': 'SC99_1'}])
        self.assertTrue(self.browser.is_connected())

    async def test_rename_finds_media_in_virtual_scroll_viewport(self):
        from flow_results import rename_card
        media_id = '11111111-1111-4111-8111-111111111111'
        await self.page.evaluate('''id => {
          const viewport = document.createElement('cdk-virtual-scroll-viewport');
          viewport.className = 'tiles-container';
          viewport.style.cssText = 'display:block;height:100px;overflow:auto';
          viewport.innerHTML = '<div style="height:1000px"></div>';
          viewport.onscroll = () => {
            if (viewport.scrollTop < 100 || viewport.querySelector('flow-grid-tile-container')) return;
            const tile = document.createElement('flow-grid-tile-container');
            tile.setAttribute('aria-label', 'Before');
            tile.style.display = 'block';
            tile.innerHTML = `<img data-media-id="${id}"><button aria-label="More options">More</button>`;
            tile.querySelector('button').onclick = () => {
              document.querySelector('.cdk-overlay-pane').hidden = false;
              document.querySelector('.editing').onkeydown = e => {
                if (e.key === 'Enter') tile.setAttribute('aria-label', e.target.value);
              };
            };
            viewport.prepend(tile);
          };
          document.body.prepend(viewport);
        }''', media_id)
        await rename_card(self.page, media_id, 'SC99', timeout=1500)
        tile = self.page.locator('flow-grid-tile-container').filter(
            has=self.page.locator(f'[data-media-id="{media_id}"]'))
        self.assertEqual(await tile.get_attribute('aria-label'), 'SC99')

    async def test_rename_suffixes_and_skip_empty_prompt(self):
        process = await self.cli('rename', [{'id': 'SC42', 'prompt': 'Needle'}, {'prompt': ''}])
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 0, stdout + stderr)
        self.assertEqual(await self.page.evaluate('renamed'), [
            {'index': 0, 'name': 'SC42'}, {'index': 1, 'name': 'SC42_1'}])
        self.assertEqual(await self.page.locator('.search-input').input_value(), '')
        self.assertTrue(self.browser.is_connected())

    async def test_missing_asset_fails_before_click(self):
        process = await self.cli('generate', [{'character': 'Missing', 'prompt': 'X'}])
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 1, stdout + stderr)
        self.assertIn('Không tìm thấy nhân vật', stderr)
        self.assertEqual(await self.page.evaluate('records'), [])
        self.assertTrue(self.browser.is_connected())

    async def test_background_does_not_use_content_fallback_selector(self):
        await self.page.locator('flow-generate-icon-button').evaluate("el => el.remove()")
        await self.page.evaluate("""() => {
            const button = document.createElement('button');
            button.setAttribute('aria-label', 'Run'); button.innerText = 'Run';
            document.body.appendChild(button);
        }""")
        process = await self.cli('generate', [{'prompt': 'First'}])
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 1, stdout + stderr)
        self.assertIn('Không tìm thấy nút Tạo ảnh đang bật', stderr)
        self.assertEqual(await self.page.evaluate('records'), [])

    async def test_unaccepted_prompt_reports_error(self):
        await self.page.locator('flow-generate-icon-button button').evaluate(
            "el => el.onclick = () => {}")
        process = await self.cli('generate', [{'prompt': 'First'}])
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 1, stdout + stderr)
        self.assertIn('prompt vẫn còn trong ô nhập', stderr)
        self.assertNotIn('COMPLETED', stdout)

    @unittest.skipIf(os.name == 'nt', 'Windows subprocess.send_signal không hỗ trợ POSIX SIGINT')
    async def test_sigint_stops_at_original_checkpoint_and_keeps_chrome(self):
        process = await self.cli('generate', [{'prompt': 'First'}, {'prompt': 'Second'}])
        output = []
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), 15)
            self.assertTrue(line, b''.join(output).decode())
            output.append(line)
            if 'Chờ 4s' in line.decode():
                break
        process.send_signal(signal.SIGINT)
        code, stdout, stderr = await self.result(process)
        self.assertEqual(code, 130, b''.join(output).decode() + stdout + stderr)
        self.assertIn('STOPPED', stdout)
        self.assertEqual(len(await self.page.evaluate('records')), 1)
        self.assertTrue(self.browser.is_connected())

    async def test_ambiguous_tabs_require_explicit_selection(self):
        page2 = await self.browser.contexts[0].new_page()
        await page2.route('https://flow.google.com/**', lambda route: route.fulfill(body=FIXTURE))
        await page2.goto('https://flow.google.com/project/other-fixture')
        self.assertEqual(await automation.select_page(self.browser, self.page.url), self.page)
        with self.assertRaises(ValueError):
            await automation.select_page(self.browser, 'https://flow.google.com/project/absent')



class AutoLaunchBrowserTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_auto_launch_keeps_profile_and_chrome_after_disconnect(self):
        from playwright.async_api import async_playwright
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            args = automation.parser().parse_args([
                'login', '--project-url', 'https://flow.google.com/project/offline-launch',
                '--cdp-url', f'http://127.0.0.1:{port}', '--profile-dir', directory,
                '--chrome-path', os.environ.get('FLOW_TEST_CHROME', '/usr/bin/google-chrome')])
            real_popen = automation.subprocess.Popen
            processes = []
            def headless_chrome(command, **kwargs):
                # Test only: run actual startup command headlessly, on a blank page.
                command = command[:-1] + ['--headless=new', '--no-sandbox', 'about:blank']
                process = real_popen(command, **kwargs)
                processes.append(process)
                return process
            playwright = await async_playwright().start()
            try:
                with patch('automation.subprocess.Popen', side_effect=headless_chrome):
                    browser = await automation.connect_browser(playwright, args)
                self.assertTrue((Path(directory) / 'Default').is_dir())
                context = browser.contexts[0]
                await context.add_cookies([{'name': 'fixture_session', 'value': 'dummy',
                    'domain': 'flow.google.com', 'path': '/', 'expires': 2000000000}])
                await playwright.stop()
                self.assertIsNone(processes[0].poll())
                playwright = await async_playwright().start()
                browser = await playwright.chromium.connect_over_cdp(args.cdp_url)
                self.assertIn('fixture_session', [c['name'] for c in await browser.contexts[0].cookies()])
                # Graceful test-owned shutdown flushes the persistent profile.
                session = await browser.new_browser_cdp_session()
                await session.send('Browser.close')
                await asyncio.to_thread(processes[0].wait, 10)
                with patch('automation.subprocess.Popen', side_effect=headless_chrome):
                    browser = await automation.connect_browser(playwright, args)
                self.assertIn('fixture_session', [c['name'] for c in await browser.contexts[0].cookies()])
            finally:
                if 'browser' in locals() and browser.is_connected():
                    try:
                        session = await browser.new_browser_cdp_session()
                        await session.send('Browser.close')  # Only this test-owned Chrome.
                    except Exception:
                        pass
                for process in processes:
                    if process.poll() is None:
                        try:
                            await asyncio.to_thread(process.wait, 5)
                        except automation.subprocess.TimeoutExpired:
                            process.terminate()  # Only the headless Chrome this test created.
                            await asyncio.to_thread(process.wait, 10)
                await playwright.stop()
                await asyncio.sleep(.5)  # Let Chrome's child processes release profile locks.


if __name__ == '__main__':
    unittest.main()
