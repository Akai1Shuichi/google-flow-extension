"""Map observed image RPCs to scenes without replaying private APIs.

Wire positions observed on 2026-10-19. Unknown schemas fail closed.
Request tokens, headers and signed image URLs are never persisted.
"""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

IMAGE_RPC = 'ogiZ0b'
UUID = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')


def generation_request(request, project_id, prompt):
    url = urlsplit(request.url)
    if (url.hostname != 'flow.google.com' or request.method != 'POST' or
            url.path != '/_/AiSandboxAngularFrontend/data/batchexecute'):
        return None
    try:
        batches = json.loads(parse_qs(request.post_data or '')['f.req'][0])
        calls = [c for batch in batches for c in batch if c[0] == IMAGE_RPC]
        if len(calls) != 1:
            return None
        rows = json.loads(calls[0][1])[1]
        if rows and all(row[7][5] == project_id and
                        row[8][0][0][0].strip() == prompt.strip() for row in rows):
            return len(rows)
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        pass
    return None


def generation_media_ids(text, expected):
    payloads = []
    for line in text.splitlines():
        try:
            envelope = json.loads(line)
        except ValueError:
            continue
        if not isinstance(envelope, list):
            continue
        for row in envelope:
            if isinstance(row, list) and len(row) > 2 and row[:2] == ['wrb.fr', IMAGE_RPC]:
                try:
                    payloads.append(json.loads(row[2]))
                except (ValueError, TypeError):
                    raise ValueError('Flow trả lỗi hoặc schema tạo ảnh đã thay đổi.') from None
    try:
        if len(payloads) != 1:
            raise ValueError()
        ids = [row[0] for row in payloads[0][0]]
        if (len(ids) != expected or len(set(ids)) != expected or
                not all(isinstance(v, str) and UUID.fullmatch(v) for v in ids)):
            raise ValueError()
        return ids
    except (ValueError, TypeError, IndexError):
        raise ValueError('Không lấy đủ media ID từ response; không tự đoán ảnh theo thứ tự.') from None


def scene_names(scenes):
    names = []
    for index, scene in enumerate(scenes):
        name = str(scene.get('id') or f'SC{index + 1}')
        if (not name.strip() or name != name.strip() or len(name) > 120 or
                re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name.endswith(('.', ' ')) or
                re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I)):
            raise ValueError(f'ID scene không dùng được làm tên file: {name!r}')
        names.append(name)
    if len({n.casefold() for n in names}) != len(names):
        raise ValueError('ID scene bị trùng; cần ID riêng để đặt tên ảnh chính xác.')
    return names


def media_tile(page, media_id):
    if not isinstance(media_id, str) or not UUID.fullmatch(media_id):
        raise ValueError('Media ID không hợp lệ.')
    return page.locator('flow-grid-tile-container').filter(
        has=page.locator(f'[data-media-id="{media_id}"]'))


async def find_media_tile(page, media_id, timeout):
    tile = media_tile(page, media_id)
    if await tile.count():
        return tile
    viewport = page.locator('cdk-virtual-scroll-viewport.tiles-container')
    if await viewport.count() != 1:
        await tile.wait_for(state='attached', timeout=timeout)
        return tile
    # Current Flow uses an external CDK scroll container. Older layouts and
    # the offline fixture scroll the viewport itself.
    external = page.locator('.page-container.cdk-virtual-scrollable')
    scroller = external if await external.count() == 1 else viewport
    await scroller.evaluate("e => e.scrollTo({top: 0, behavior: 'instant'})")
    deadline = asyncio.get_running_loop().time() + timeout / 1000
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(.1)  # Allow CDK to materialize rows after scrolling.
        if await tile.count():
            return tile
        await scroller.evaluate('''e => e.scrollTo({
          top: e.scrollTop + Math.max(100, e.clientHeight * .8), behavior: 'instant'
        })''')
    raise RuntimeError(f'Không tìm thấy card media ID {media_id} trong danh sách đang mở.')


async def rename_card(page, media_id, name, timeout=30000):
    tile = await find_media_tile(page, media_id, timeout)
    await tile.wait_for(state='visible', timeout=timeout)
    await tile.hover(timeout=timeout)
    await tile.get_by_role('button', name='More options', exact=True).click(timeout=timeout)
    await page.get_by_role('menuitem', name='Rename', exact=True).click(timeout=timeout)
    editor = page.locator('input.editable-text-input.editing:visible, .footer-left input:visible')
    await editor.fill(name, timeout=timeout)
    await editor.press('Enter')
    await page.wait_for_function('''({id, name}) => {
      const tile = Array.from(document.querySelectorAll('flow-grid-tile-container'))
        .find(e => e.querySelector(`[data-media-id="${id}"]`));
      return tile && (tile.getAttribute('aria-label') === name ||
        tile.querySelector('.footer-title')?.textContent.trim() === name);
    }''', arg={'id': media_id, 'name': name}, timeout=timeout)


async def download_card(page, media_id, name, directory, timeout=30000):
    tile = await find_media_tile(page, media_id, timeout)
    await tile.hover(timeout=timeout)
    await tile.get_by_role('button', name='More options', exact=True).click(timeout=timeout)
    await page.get_by_role('menuitem', name='Download', exact=True).hover(timeout=timeout)
    async with page.expect_download(timeout=timeout) as event:
        await page.get_by_role('menuitem', name=re.compile(r'Original', re.I)).click(timeout=timeout)
    download = await event.value
    suffix = Path(download.suggested_filename).suffix.lower()
    if suffix not in ('.png', '.jpg', '.jpeg', '.webp'):
        raise ValueError(f'Định dạng tải ảnh không được hỗ trợ: {suffix!r}')
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (name + suffix)
    with path.open('xb'):
        pass
    try:
        await download.save_as(path)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return str(path.resolve())


class BatchResults:
    def __init__(self, page, scenes, results_dir, output_dir=None, timeout=180):
        self.page, self.scenes = page, scenes
        self.names = scene_names(scenes)
        self.project_id = urlsplit(page.url).path.split('/')[2]
        self.timeout = timeout
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8]
        self.path = Path(results_dir) / (stamp + '.json')
        self.output_dir = Path(output_dir) / stamp if output_dir is not None else None
        self.records, self.active, self.requests, self.futures, self.tasks = [], None, {}, {}, set()
        self.listeners = [('request', self._request), ('response', self._response),
                          ('requestfailed', self._failed)]
        for event, callback in self.listeners:
            page.on(event, callback)
        self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'project_id': self.project_id, 'scenes': self.records},
                                       ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(self.path)

    async def click(self, index, click):
        if not isinstance(index, int) or index != len(self.records) or index >= len(self.scenes):
            return {'ok': False, 'error': 'Scene index không hợp lệ; dừng để tránh gán nhầm ảnh.'}
        record = {'scene_index': index, 'scene_id': self.names[index], 'status': 'clicking', 'outputs': []}
        self.records.append(record)
        captured = asyncio.get_running_loop().create_future()
        self.active = (record, captured)
        self.save()
        try:
            result = await click()
            if not result.get('ok'):
                raise RuntimeError(result.get('error', 'Không bấm được Generate.'))
            await asyncio.wait_for(asyncio.shield(captured), min(self.timeout, 30))
            return result
        except Exception as exc:
            record.update(status='error', error=str(exc) or 'Không thấy request tạo ảnh sau khi bấm Generate.')
            self.save()
            return {'ok': False, 'error': record['error']}
        finally:
            self.active = None

    def _request(self, request):
        if self.active is None:
            return
        record, captured = self.active
        count = generation_request(request, self.project_id,
                                   self.scenes[record['scene_index']].get('prompt', ''))
        if count is None:
            return
        if captured.done():
            record.update(status='error', error='Có nhiều request tạo ảnh cho một lần bấm; dừng gán tên.')
            self.save()
            return
        self.requests[request] = record
        self.futures[record['scene_index']] = asyncio.get_running_loop().create_future()
        record.update(status='submitted', expected=count)
        captured.set_result(None)
        self.save()
        print(f"[MAP] {record['scene_id']} → request {count} ảnh", flush=True)

    def _response(self, response):
        record = self.requests.get(response.request)
        if record is not None:
            task = asyncio.create_task(self._read_response(response, record))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

    async def _read_response(self, response, record):
        try:
            if response.status != 200:
                raise ValueError(f'Flow trả HTTP {response.status} khi tạo ảnh.')
            ids = generation_media_ids(await response.text(), record['expected'])
            if record['status'] != 'submitted':
                return
            record['outputs'] = [
                {'media_id': media_id, 'name': record['scene_id'] if len(ids) == 1
                 else f"{record['scene_id']}_{index + 1}", 'status': 'ready'}
                for index, media_id in enumerate(ids)]
            record['status'] = 'ready'
        except Exception as exc:
            record.update(status='error', error=str(exc))
        finally:
            self.save()
            future = self.futures[record['scene_index']]
            if not future.done():
                future.set_result(None)

    def _failed(self, request):
        record = self.requests.get(request)
        if record is not None:
            record.update(status='error', error='Request tạo ảnh thất bại hoặc bị ngắt.')
            self.save()
            future = self.futures[record['scene_index']]
            if not future.done():
                future.set_result(None)

    async def finish(self, stopped=lambda: False):
        print(f'[RESULTS] Đang chờ ảnh và đặt tên. Ánh xạ: {self.path}', flush=True)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.timeout
        next_log = loop.time() + 10
        pending = {f for f in self.futures.values() if not f.done()}
        while pending and not stopped() and loop.time() < deadline:
            _, pending = await asyncio.wait(pending, timeout=min(.2, max(0, deadline - loop.time())),
                                            return_when=asyncio.FIRST_COMPLETED)
            if pending and loop.time() >= next_log:
                print(f'[RESULTS] Còn {len(pending)} lượt tạo đang chờ...', flush=True)
                next_log = loop.time() + 10
        # Freeze timed-out records before any UI await. A late response must not
        # enter assignments after the complete batch has been validated.
        for record in self.records:
            if record['status'] == 'submitted' and not stopped():
                record.update(status='error', error='Hết thời gian chờ ảnh; xem lại Flow và file ánh xạ.')
        self.save()
        # Validate all assignments before changing even the first card.
        outputs = [(r, o) for r in self.records for o in r['outputs']]
        names = [o['name'].casefold() for _, o in outputs]
        ids = [o['media_id'] for _, o in outputs]
        for record, output in outputs:
            if names.count(output['name'].casefold()) > 1 or ids.count(output['media_id']) > 1:
                record.update(status='error', error='Tên ảnh hoặc media ID trùng giữa các scene; không đổi tên.')
        errors, assigned = [], set()
        for record in self.records:
            if stopped():
                if record['status'] not in ('completed', 'error'):
                    record['status'] = 'stopped'
                self.save()
                break
            if record['status'] == 'submitted':
                record.update(status='error', error='Hết thời gian chờ ảnh; xem lại Flow và file ánh xạ.')
            if record['status'] == 'error':
                errors.append(f"{record['scene_id']}: {record['error']}")
                self.save()
                continue
            for output in record['outputs']:
                if stopped():
                    break
                try:
                    key = output['name'].casefold()
                    if key in assigned:
                        raise ValueError('Tên ảnh trùng với output của scene khác.')
                    assigned.add(key)
                    await rename_card(self.page, output['media_id'], output['name'])
                    output['status'] = 'renamed'
                    self.save()
                    if self.output_dir is not None and not stopped():
                        output['path'] = await download_card(
                            self.page, output['media_id'], output['name'], self.output_dir)
                        output['status'] = 'downloaded'
                    print(f"[IMAGE] {output['name']} ({output['media_id']}) {output['status']}", flush=True)
                except Exception as exc:
                    output.update(status='error', error=str(exc))
                    errors.append(f"{output['name']}: {exc}")
                    try:
                        await self.page.keyboard.press('Escape')
                    except Exception:
                        pass
                self.save()
            record['status'] = ('stopped' if stopped() else 'error' if
                                any(o['status'] == 'error' for o in record['outputs']) else 'completed')
            self.save()
        if errors:
            raise RuntimeError('\n'.join(errors))

    async def close(self, stopped=False):
        for event, callback in self.listeners:
            self.page.remove_listener(event, callback)
        for task in self.tasks:
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        for record in self.records:
            if record['status'] not in ('completed', 'error', 'stopped', 'interrupted'):
                record['status'] = 'stopped' if stopped else 'interrupted'
        self.save()
