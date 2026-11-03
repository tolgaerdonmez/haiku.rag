import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-macos.sh"
SERVICE = ROOT / "scripts" / "macos-service.sh"
RULE = "Cmd+Shift+F opens haiku.rag Search Documents in Raycast"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell scripts")
macos_only = pytest.mark.skipif(sys.platform != "darwin", reason="macOS installer")


def run(home: Path, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    """The installer under a throwaway HOME and agent label, without a terminal."""
    environment = {
        **os.environ,
        "HOME": str(home),
        "HAIKU_RAG_SERVICE_LABEL": "com.haiku-rag.service.pytest",
        "HAIKU_RAG_SERVICE_PORT": "18799",
        **env,
    }
    return subprocess.run(
        ["/bin/sh", str(INSTALLER), *args],
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=120,
        start_new_session=True,
    )


def app_dir(home: Path) -> Path:
    return home / "Library" / "Application Support" / "haiku.rag"


def fake_model_repo(root: Path) -> tuple[str, str]:
    """A Hugging Face layout served from file://, and its SHA256SUMS checksum."""
    files = root / "test" / "model" / "resolve" / "main"
    (files / "model.mlpackage" / "Data").mkdir(parents=True)
    (files / "model.mlpackage" / "Manifest.json").write_text("{}", encoding="utf-8")
    (files / "model.mlpackage" / "Data" / "weight.bin").write_bytes(b"\0" * 64)
    (files / "tokenizer.json").write_text("{}", encoding="utf-8")
    lines = [
        f"{hashlib.sha256((files / path).read_bytes()).hexdigest()}  {path}"
        for path in (
            "model.mlpackage/Data/weight.bin",
            "model.mlpackage/Manifest.json",
            "tokenizer.json",
        )
    ]
    sums = "\n".join(lines) + "\n"
    (files / "SHA256SUMS").write_text(sums, encoding="utf-8")
    return root.as_uri(), hashlib.sha256(sums.encode()).hexdigest()


@pytest.mark.parametrize("script", [INSTALLER, SERVICE])
def test_scripts_parse(script):
    subprocess.run(["/bin/sh", "-n", str(script)], check=True)


@macos_only
def test_help_lists_the_components(tmp_path):
    result = run(tmp_path, "--help")
    assert result.returncode == 0
    for option in (
        "--service",
        "--model",
        "--raycast",
        "--hotkey",
        "--folder",
        "--uninstall",
    ):
        assert option in result.stderr


@macos_only
def test_unknown_option_is_refused(tmp_path):
    assert run(tmp_path, "--frobnicate").returncode == 64


@macos_only
def test_dry_run_prints_the_plan_and_changes_nothing(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    result = run(home, "--dry-run", "--no-raycast", "--hotkey", "--folder", str(docs))
    assert result.returncode == 0, result.stderr
    assert "service: install" in result.stdout
    assert "raycast: skip" in result.stdout
    assert f"folder: {docs}" in result.stdout
    assert list(home.iterdir()) == []


@macos_only
def test_model_downloads_and_verifies_every_file(tmp_path):
    endpoint, sums = fake_model_repo(tmp_path / "hf")
    home = tmp_path / "home"
    home.mkdir()
    result = run(
        home,
        "--yes", "--no-service", "--no-raycast", "--no-hotkey",
        "--model-repo", "test/model", "--model-sha256", sums,
        HF_ENDPOINT=endpoint,
    )  # fmt: skip
    assert result.returncode == 0, result.stderr
    model = app_dir(home) / "models" / "jina-nano-coreml"
    assert (
        model / "model.mlpackage" / "Data" / "weight.bin"
    ).read_bytes() == b"\0" * 64
    assert (model / "tokenizer.json").exists()
    assert not (model / "SHA256SUMS").exists()


@macos_only
def test_a_tampered_model_file_is_refused(tmp_path):
    endpoint, sums = fake_model_repo(tmp_path / "hf")
    weight = tmp_path / "hf/test/model/resolve/main/model.mlpackage/Data/weight.bin"
    weight.write_bytes(b"\1" * 64)
    home = tmp_path / "home"
    home.mkdir()
    result = run(
        home,
        "--yes", "--no-service", "--no-raycast", "--no-hotkey",
        "--model-repo", "test/model", "--model-sha256", sums,
        HF_ENDPOINT=endpoint,
    )  # fmt: skip
    assert result.returncode != 0
    assert "checksum mismatch for model.mlpackage/Data/weight.bin" in result.stderr
    assert not (app_dir(home) / "models").exists()


@macos_only
def test_uninstall_keeps_the_index_and_indexed_files(tmp_path):
    home = tmp_path / "home"
    app = app_dir(home)
    indexed = tmp_path / "Documents" / "notes.md"
    indexed.parent.mkdir()
    indexed.write_text("mine", encoding="utf-8")
    for path in (
        "files.lancedb/data.lance",
        "ingester.db",
        "folders.yaml",
        "haiku.rag.yaml",
        "models/jina-nano-coreml/tokenizer.json",
        "service/bin/haiku-rag-service",
        "raycast/package.json",
    ):
        (app / path).parent.mkdir(parents=True, exist_ok=True)
        (app / path).write_text("x", encoding="utf-8")
    karabiner = home / ".config" / "karabiner" / "karabiner.json"
    karabiner.parent.mkdir(parents=True)
    rules = [{"description": RULE}, {"description": "another rule"}]
    profile = {"selected": True, "complex_modifications": {"rules": rules}}
    karabiner.write_text(json.dumps({"profiles": [profile]}), encoding="utf-8")

    result = run(home, "--uninstall", "--yes")

    assert result.returncode == 0, result.stderr
    assert sorted(p.name for p in app.iterdir()) == [
        "files.lancedb",
        "folders.yaml",
        "ingester.db",
    ]
    assert indexed.read_text(encoding="utf-8") == "mine"
    kept = json.loads(karabiner.read_text(encoding="utf-8"))
    assert kept["profiles"][0]["complex_modifications"]["rules"] == [
        {"description": "another rule"}
    ]


@macos_only
def test_uninstall_deletes_the_index_only_when_asked(tmp_path):
    home = tmp_path / "home"
    app = app_dir(home)
    (app / "files.lancedb").mkdir(parents=True)
    (app / "folders.yaml").write_text("folders: []\n", encoding="utf-8")

    result = run(home, "--uninstall", "--yes", "--delete-index")

    assert result.returncode == 0, result.stderr
    assert not app.exists()
