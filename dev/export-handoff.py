"""Export current project sources and handoff notes without requiring Codex."""
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def export():
    destination = root.parent / "开发交接包"
    destination.mkdir(exist_ok=True)
    stamp = datetime.now().astimezone()
    target = destination / ("app-center-" + stamp.strftime("%Y%m%d-%H%M%S-%f") + ".zip")
    fd = tempfile.NamedTemporaryFile(dir=destination, suffix=".partial", delete=False)
    temporary = Path(fd.name)
    fd.close()
    try:
        paths = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode().split("\0")
        manifest = {"baseCommit": git("rev-parse", "HEAD").decode().strip(),
                    "createdAt": stamp.isoformat(), "sha256": {}, "deleted": []}
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            for name in sorted(set(paths) - {""}):
                source = root / name
                if source.is_symlink():
                    raise ValueError("请先核对符号链接 " + name)
                if not source.exists():
                    manifest["deleted"].append(name)
                    continue
                data = source.read_bytes()
                archive.writestr("app-center/" + name, data)
                manifest["sha256"][name] = sha256(data).hexdigest()
            archive.writestr("snapshot.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        with ZipFile(temporary) as archive:
            for name, expected in manifest["sha256"].items():
                if sha256(archive.read("app-center/" + name)).hexdigest() != expected:
                    raise ValueError(name)
        temporary.rename(target)
        print(target)
        print(f"{len(manifest['sha256'])} files verified")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    export()
