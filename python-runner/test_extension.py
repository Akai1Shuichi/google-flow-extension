"""Load the real unpacked extension in isolated Chromium; all traffic is local."""
import asyncio
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import shutil
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path
import unittest

from test_automation import FIXTURE

ROOT = Path(__file__).resolve().parent.parent
IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
       '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=')


class ImageServer(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0].split('/')[-1] not in IDS:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Disposition', 'attachment; filename="original.png"')
        self.send_header('Content-Length', str(len(PNG)))
        self.end_headers()
        self.wfile.write(PNG)

    def log_message(self, *args):
        pass


class ExtensionBrowserTests(unittest.IsolatedAsyncioTestCase):
    async def test_sidepanel_batch_renames_without_downloading(self):
        from playwright.async_api import async_playwright
        openssl = shutil.which('openssl')
        if not openssl:
            self.skipTest('OpenSSL is required for the local HTTPS download fixture')
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            cert, key = directory / 'cert.pem', directory / 'key.pem'
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=flow-content.google'],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            server = ThreadingHTTPServer(('127.0.0.1', 0), ImageServer)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(cert, key)
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            download_dir = directory / 'downloads'
            profile = directory / 'profile'
            (profile / 'Default').mkdir(parents=True)
            (profile / 'Default' / 'Preferences').write_text(json.dumps({
                'download': {'default_directory': str(download_dir), 'prompt_for_download': False}}))
            try:
                async with async_playwright() as pw:
                    context = await pw.chromium.launch_persistent_context(str(profile), channel='chromium',
                        headless=True, args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}',
                            '--no-proxy-server', '--ignore-certificate-errors',
                            f'--host-resolver-rules=MAP flow-content.google 127.0.0.1:{server.server_port}'])
                    try:
                        worker = context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker')
                        extension_id = worker.url.split('/')[2]
                        page = context.pages[0]
                        await page.route('https://flow.google.com/**', lambda route: route.fulfill(body=FIXTURE, content_type='text/html'))
                        async def generate(route):
                            from urllib.parse import parse_qs
                            body = json.loads(parse_qs(route.request.post_data)['f.req'][0])
                            call = json.loads(body[0][0][1])
                            number = call[0]
                            await asyncio.sleep(8 if number == 1 else .1)
                            rows = []
                            for media_id in IDS[:2] if number == 1 else IDS[2:]:
                                row = [media_id, None, 'entity']; row.extend([None] * 4)
                                row[6] = [[None] * 14]
                                row[6][0][13] = f'https://flow-content.google/image/{media_id}?Signature=fixture'
                                rows.append(row)
                            wire = json.dumps([['wrb.fr', 'ogiZ0b', json.dumps([rows, []]), None]])
                            await route.fulfill(body=")]}'\n\n" + str(len(wire)) + '\n' + wire, content_type='application/json')
                        await page.route('**/data/batchexecute*', generate)
                        await page.goto('https://flow.google.com/project/offline-fixture')
                        session = await context.new_cdp_session(page)
                        await session.send('Browser.setDownloadBehavior', {'behavior': 'default'})
                        await page.evaluate('''() => {
                          let n = 0;
                          document.querySelector('flow-generate-icon-button button').onclick = async () => {
                            const prompt = editor.innerText; editor.innerText = '';
                            const call = [++n, [0, 1].map(() => {
                              const row = []; row[7] = []; row[7][5] = 'offline-fixture'; row[8] = [[[prompt]]]; return row;
                            })];
                            const response = await fetch('/_/AiSandboxAngularFrontend/data/batchexecute', {
                              method: 'POST', body: new URLSearchParams({'f.req': JSON.stringify([[['ogiZ0b', JSON.stringify(call)]]])})
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
                                  if (event.key === 'Enter') { tile.setAttribute('aria-label', event.target.value); event.target.hidden = true; }
                                };
                              };
                              document.body.prepend(tile);
                            }
                          };
                        }''')
                        panel = await context.new_page()
                        await panel.goto(f'chrome-extension://{extension_id}/sidepanel.html')
                        self.assertEqual(await panel.locator('#renameBtn').count(), 0)
                        await panel.wait_for_function('document.querySelector("#scenesJson").value.length > 0')
                        await panel.locator('#scenesJson').fill(json.dumps([
                            {'id': 'SC01', 'prompt': 'same'}, {'id': 'SC02', 'prompt': 'same'}]))
                        await panel.locator('#startBtn').click()
                        result = None
                        deadline = asyncio.get_running_loop().time() + 45
                        while asyncio.get_running_loop().time() < deadline:
                            result = await worker.evaluate("async () => (await chrome.storage.local.get('flowLastBatch')).flowLastBatch")
                            if result and all(s['status'] in ('completed','error','interrupted') for s in result['scenes']):
                                break
                            await asyncio.sleep(.2)
                        self.assertIsNotNone(result, await panel.locator('#jsonError').inner_text())
                        self.assertEqual([s['status'] for s in result['scenes']], ['completed', 'completed'], json.dumps(result))
                        outputs = [o for s in result['scenes'] for o in s['outputs']]
                        self.assertEqual([o['name'] for o in outputs], ['SC01_1','SC01_2','SC02_1','SC02_2'])
                        self.assertEqual([o['mediaId'] for o in outputs], IDS)
                        for output in outputs:
                            self.assertNotIn('path', output)
                            tile = page.locator('flow-grid-tile-container').filter(has=page.locator(f'[data-media-id="{output["mediaId"]}"]'))
                            self.assertEqual(await tile.get_attribute('aria-label'), output['name'])
                        self.assertFalse(download_dir.exists() and any(download_dir.iterdir()))
                        self.assertNotIn('Signature', json.dumps(result))
                    finally:
                        await context.close()  # Only the isolated test profile.
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
