import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import urlencode

from flow_results import BatchResults, generation_media_ids, generation_request, scene_names

MEDIA_A = '11111111-1111-4111-8111-111111111111'
MEDIA_B = '22222222-2222-4222-8222-222222222222'


def wire(ids):
    payload = [[[v, None, 'entity-id'] for v in ids], []]
    return ")]}'\n\n123\n" + json.dumps([['wrb.fr', 'ogiZ0b', json.dumps(payload), None]])


def request(prompt='same', project='project', rpc='ogiZ0b'):
    row = [None] * 9
    row[7] = [None] * 6
    row[7][5] = project
    row[8] = [[[prompt]]]
    return Mock(url='https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute',
                method='POST', post_data=urlencode({'f.req': json.dumps([
                    [[rpc, json.dumps([None, [row, row]]), None, 'generic']]])}))


class WireTests(unittest.TestCase):
    def test_requires_exact_project_prompt_and_generation_rpc(self):
        self.assertEqual(generation_request(request(), 'project', 'same'), 2)
        self.assertIsNone(generation_request(request(project='other'), 'project', 'same'))
        self.assertIsNone(generation_request(request(prompt='different'), 'project', 'same'))
        self.assertIsNone(generation_request(request(rpc='WuwhI'), 'project', 'same'))
        self.assertIsNone(generation_request(Mock(url='https://example.com/', method='POST'), 'project', 'same'))

    def test_reads_only_media_ids_not_entity_ids(self):
        self.assertEqual(generation_media_ids(wire([MEDIA_B, MEDIA_A]), 2), [MEDIA_B, MEDIA_A])

    def test_rejects_partial_duplicate_error_and_unknown_response(self):
        for text in (wire([MEDIA_A]), wire([MEDIA_A, MEDIA_A]), wire(['wrong', MEDIA_A]),
                     ")]}'\n[[\"er\",\"ogiZ0b\",500]]", 'bad json'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                generation_media_ids(text, 2)

    def test_rejects_duplicate_and_unsafe_ids_before_generation(self):
        for scenes in ([{'id': 'SC1'}, {'id': 'sc1'}], [{'id': '../escape'}],
                       [{'id': 'CON'}], [{'id': 'ends.'}]):
            with self.subTest(scenes=scenes), self.assertRaises(ValueError):
                scene_names(scenes)
        self.assertEqual(scene_names([{'id': 'SC01'}, {}]), ['SC01', 'SC2'])


class ResultsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.page = Mock(url='https://flow.google.com/project/project')
        self.page.keyboard.press = AsyncMock()
        self.results = BatchResults(self.page, [{'id': 'SC1', 'prompt': 'same'}], self.temp.name, timeout=.4)

    async def asyncTearDown(self):
        await self.results.close()
        self.temp.cleanup()

    async def test_stop_interrupts_pending_result_wait(self):
        self.results.records = [{'scene_index': 0, 'scene_id': 'SC1', 'status': 'submitted', 'outputs': []}]
        self.results.futures[0] = asyncio.get_running_loop().create_future()
        await asyncio.wait_for(self.results.finish(lambda: True), timeout=.1)

    async def test_stop_between_outputs_does_not_mark_scene_completed(self):
        self.results.records = [{'scene_index': 0, 'scene_id': 'SC1', 'status': 'ready', 'outputs': [
            {'media_id': MEDIA_A, 'name': 'SC1_1', 'status': 'ready'},
            {'media_id': MEDIA_B, 'name': 'SC1_2', 'status': 'ready'}]}]
        stopped = False
        async def rename(*args):
            nonlocal stopped
            stopped = True
        with patch('flow_results.rename_card', side_effect=rename):
            await self.results.finish(lambda: stopped)
        manifest = json.loads(self.results.path.read_text(encoding='utf-8'))
        self.assertEqual(manifest['scenes'][0]['status'], 'stopped')
        self.assertEqual(manifest['scenes'][0]['outputs'][1]['status'], 'ready')

    async def test_network_failure_is_persisted_and_reported(self):
        req = request()
        async def click():
            self.results._request(req)
            return {'ok': True}
        self.assertEqual(await self.results.click(0, click), {'ok': True})
        self.results._failed(req)
        with self.assertRaises(RuntimeError):
            await self.results.finish()
        manifest = json.loads(self.results.path.read_text(encoding='utf-8'))
        self.assertEqual(manifest['scenes'][0]['status'], 'error')
        self.assertNotIn('f.req', self.results.path.read_text(encoding='utf-8'))

    async def test_missing_request_stops_next_submission(self):
        self.results.timeout = .01
        result = await self.results.click(0, AsyncMock(return_value={'ok': True}))
        self.assertFalse(result['ok'])
        self.assertEqual(self.results.records[0]['status'], 'error')

    async def test_http_failure_cannot_become_a_successful_output(self):
        req = request()
        async def click():
            self.results._request(req)
            return {'ok': True}
        await self.results.click(0, click)
        response = Mock(status=403, text=AsyncMock(return_value=wire([MEDIA_A, MEDIA_B])))
        await self.results._read_response(response, self.results.records[0])
        with self.assertRaises(RuntimeError):
            await self.results.finish()
        self.assertEqual(self.results.records[0]['outputs'], [])

    async def test_late_response_cannot_enter_assignment_after_timeout(self):
        self.results.timeout = .01
        self.results.records = [
            {'scene_index': 0, 'scene_id': 'SC1', 'status': 'ready', 'outputs': [
                {'media_id': MEDIA_A, 'name': 'SC1', 'status': 'ready'}]},
            {'scene_index': 1, 'scene_id': 'SC2', 'status': 'submitted', 'expected': 1, 'outputs': []}]
        self.results.futures[1] = asyncio.get_running_loop().create_future()
        async def rename(*args):
            await self.results._read_response(Mock(status=200, text=AsyncMock(return_value=wire([MEDIA_A]))),
                                               self.results.records[1])
        with patch('flow_results.rename_card', side_effect=rename), self.assertRaises(RuntimeError):
            await self.results.finish()
        self.assertEqual(self.results.records[1]['status'], 'error')
        self.assertEqual(self.results.records[1]['outputs'], [])

    async def test_close_marks_every_unfinished_scene_stopped(self):
        self.results.records = [
            {'scene_index': 0, 'scene_id': 'SC1', 'status': 'submitted', 'outputs': []},
            {'scene_index': 1, 'scene_id': 'SC2', 'status': 'ready', 'outputs': []}]
        await self.results.close(stopped=True)
        manifest = json.loads(self.results.path.read_text(encoding='utf-8'))
        self.assertEqual([r['status'] for r in manifest['scenes']], ['stopped', 'stopped'])


if __name__ == '__main__':
    unittest.main()
