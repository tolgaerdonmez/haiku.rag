"""How the service starts and stops: on a socket launchd holds, and on its
own once idle."""

import asyncio
import os
import socket

import httpx
import pytest

from haiku.rag.config import APIConfig
from haiku.rag.ingester.app import LISTEN_FD_VARIABLE, IngesterApp
from haiku.rag.ingester.queue.repository import JobRepo
from tests.ingester.conftest import _mock_client, _wait_until
from tests.ingester.test_run_batch import _config


async def test_the_api_serves_an_inherited_socket(tmp_path, use_client, monkeypatch):
    use_client(_mock_client())
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    monkeypatch.setenv(LISTEN_FD_VARIABLE, str(os.dup(listener.fileno())))
    listener.close()
    config = _config(tmp_path)
    # Bound elsewhere than the socket: the inherited one wins.
    config.ingester.api = APIConfig(enabled=True, host="127.0.0.1", port=1)
    config.ingester.workers.shutdown_grace_s = 0.2
    app = IngesterApp(config=config)

    task = asyncio.create_task(app.serve())
    try:
        async with httpx.AsyncClient() as client:
            for _ in range(100):
                try:
                    response = await client.get(f"http://127.0.0.1:{port}/health")
                    break
                except httpx.ConnectError:
                    await asyncio.sleep(0.05)
        assert response.status_code == 200
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)


@pytest.mark.parametrize("api", [False, True])
async def test_an_idle_service_exits(tmp_path, use_client, monkeypatch, api):
    use_client(_mock_client())
    config = _config(tmp_path, shutdown_grace_s=0.2)
    config.ingester.api = APIConfig(enabled=api, host="127.0.0.1", port=0)
    config.ingester.service.idle_exit_s = 0.2
    counts = iter([{"queued": 1}])

    async def counts_by_status(self):  # noqa: ARG001
        return next(counts, {})

    monkeypatch.setattr(JobRepo, "counts_by_status", counts_by_status)
    app = IngesterApp(config=config)

    await asyncio.wait_for(app.serve(api=api), timeout=10)


async def test_a_busy_service_stays_up(tmp_path, use_client, monkeypatch):
    use_client(_mock_client())
    config = _config(tmp_path, shutdown_grace_s=0.2)
    config.ingester.service.idle_exit_s = 0.1

    async def counts_by_status(self):  # noqa: ARG001
        return {"claimed": 1}

    monkeypatch.setattr(JobRepo, "counts_by_status", counts_by_status)
    app = IngesterApp(config=config)
    task = asyncio.create_task(app.serve(api=False))
    try:
        await _wait_until(
            lambda: app._pool is not None and app._pool.live_workers > 0,
            serving=task,
        )
        await asyncio.sleep(0.3)
        assert not task.done()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5.0)
