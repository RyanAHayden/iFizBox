"""F464: tools/dev_stats.py counts typed prompts, tokens and sessions from transcripts, keeps deleted ones in its
ledger, and never writes lower counts over higher ones. Runs on made-up transcripts."""
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dev_stats  # noqa: E402


def user(text, uuid, **more):
    return {"type": "user", "uuid": uuid, "timestamp": "2026-11-17T10:00:00Z", "message": {"content": text}, **more}


def reply(mid, day="18"):
    return {"type": "assistant", "uuid": mid, "timestamp": f"2026-11-{day}T10:00:00Z",
            "message": {"id": mid, "usage": {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 3,
                                             "cache_creation_input_tokens": 4}}}


class DevStats(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        saved = {k: getattr(dev_stats, k) for k in ("PROJECTS", "LEDGER", "OUT")}
        self.addCleanup(lambda: [setattr(dev_stats, k, v) for k, v in saved.items()])
        dev_stats.PROJECTS = self.tmp / "projects"
        dev_stats.LEDGER = self.tmp / "ledger.json"
        dev_stats.OUT = self.tmp / "devstats.js"

    def transcript(self, name, *lines):
        f = dev_stats.PROJECTS / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("".join(json.dumps(x) + "\n" for x in lines))
        return f

    def run_it(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = dev_stats.main()
        if not dev_stats.OUT.exists():
            return code, None
        return code, json.loads(re.search(r"DEV_STATS = (\{.*\});", dev_stats.OUT.read_text(), re.S)[1])

    def test_counts(self):
        name = dev_stats.NAMES[0]
        self.transcript(f"-home-x-repos-{name}/a.jsonl",
                        user("fix it", "u1"), reply("m1"), reply("m1"),  # one message, two lines
                        user("Unattended run: do the task", "u2"),
                        user("iPhone 7 is yours to take now (it is free): go", "u3"),
                        user([{"type": "tool_result", "content": "ok"}], "u4"),
                        user("from claude -p", "u5", entrypoint="sdk-cli"))
        # the old name's folders count too; a resumed session's copied history doesn't count twice
        self.transcript(f"-home-x-repos-{dev_stats.NAMES[1].title()}/b.jsonl",
                        user("fix it", "u1"), reply("m1"), reply("m2", "20"))
        self.transcript("-home-x-repos-other/c.jsonl", user("not ours", "u9"), reply("m9"))
        code, stats = self.run_it()
        self.assertFalse(code)
        self.assertEqual({k: stats[k] for k in ("prompts", "tokens", "sessions", "since", "updated")},
                         {"prompts": 1, "tokens": 20, "sessions": 2, "since": "2026-11-17", "updated": "2026-11-20"})
        self.assertGreater(stats["commits"], 0)

    def test_ledger_keeps_a_deleted_transcript(self):
        name = dev_stats.NAMES[0]
        a = self.transcript(f"{name}/a.jsonl", user("one", "u1"))
        self.run_it()
        a.unlink()
        self.transcript(f"{name}/b.jsonl", user("two", "u2"))
        _, stats = self.run_it()
        self.assertEqual((stats["prompts"], stats["sessions"]), (2, 2))

    def test_never_counts_down(self):
        dev_stats.OUT.write_text('export const DEV_STATS = {\n  "sessions": 5\n};\n')
        self.transcript(f"{dev_stats.NAMES[0]}/a.jsonl", user("one", "u1"))
        code, stats = self.run_it()
        self.assertEqual((code, stats), (1, {"sessions": 5}))
        self.assertFalse(dev_stats.LEDGER.exists())


if __name__ == "__main__":
    unittest.main()
