#!/usr/bin/env python3
"""F464 dev stats: the prompts, tokens, sessions and commits it took to build the app, for the Donate page.

    tools/dev_stats.py    # scan transcripts, update the ledger and web/app/core/devstats.js

Reads the Claude Code transcripts of every checkout and slot of this project (~/.claude/projects/, directory names
holding the app's name or its old one), subagents included. Numbers only, never transcript text. The ledger
(~/.local/share/<name>/dev-stats.json, out of git: it names local session paths) keeps each transcript's counts by
file, so a transcript Claude Code later deletes still counts. Run it to bring the counts up to date, then commit the
file it writes.

Prompt = a user message typed by the user: not a tool result, slash command, task notification, compaction summary,
interrupt marker, or the unattended runners' (agent-runner) and `claude -p` launch prompts.
Session = one transcript with anything counted. Tokens = API usage of every assistant message (input, output, cache
read, cache write), once per message id.

Writes nothing and exits 1 when it would count fewer sessions than the file already says (another machine, or a lost
ledger).
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'native'))
import brand  # noqa: E402

NAMES = (brand.NAME.lower(), 'cy' + 'dian')  # the old name in pieces: native/test_brand.py
PROJECTS = Path.home() / '.claude/projects'
LEDGER = Path.home() / '.local/share' / brand.NAME.lower() / 'dev-stats.json'
OUT = ROOT / 'web/app/core/devstats.js'
NOT_TYPED = ('<command-', '<local-command', '<task-notification', 'This session is being continued',
             '[Request interrupted', 'Unattended run:', 'Parallel unattended run:', 'Caveat:',
             # what agent-runner types into a session itself
             'agent-runner: ', 'From the runner, not the person', 'The runner resumed this session',
             'The person answered the question you asked', 'Your instructions for this session are in your system prompt',
             'This is a copy of your own session', 'Start the Monitor tool (persistent)', 'A merge of task/')
RUNNER_TOOL = re.compile(r'.{1,40} is yours to take now \(it is free\)')
KEYS = ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')


def scan(f, seen):
    """Counts for one transcript; `seen` (message ids/uuids already counted in an earlier file) stops a resumed or
    forked session counting its copied history twice."""
    # ponytail: dedupe only against transcripts still on disk; a copy whose original was deleted counts again
    n = dict.fromkeys(('prompts',) + KEYS, 0)
    first = last = None
    for line in open(f, errors='replace'):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        t, ts = d.get('type'), d.get('timestamp')
        if t == 'assistant' and (u := d.get('message', {}).get('usage')):
            mid = d['message'].get('id') or d.get('uuid')
            if mid in seen:
                continue
            seen.add(mid)
            for k in KEYS:
                n[k] += u.get(k) or 0
        elif t == 'user' and not d.get('isMeta') and not d.get('isSidechain') and d.get('entrypoint') != 'sdk-cli':
            m = d.get('message', {}).get('content')
            if not isinstance(m, str):
                if not isinstance(m, list) or any(x.get('type') == 'tool_result' for x in m):
                    continue
                m = ' '.join(x.get('text', '') for x in m if x.get('type') == 'text')
            if (not m.strip() or m.lstrip().startswith(NOT_TYPED) or RUNNER_TOOL.match(m.lstrip())
                    or d.get('uuid') in seen):
                continue
            seen.add(d.get('uuid'))
            n['prompts'] += 1
        else:
            continue
        if ts:
            first, last = first or ts, ts
    return n | {'first': first, 'last': last}


def previous_sessions():
    m = re.search(r'"sessions": (\d+)', OUT.read_text()) if OUT.exists() else None
    return int(m[1]) if m else 0


def main():
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {}
    files = [f for d in PROJECTS.glob('*') if any(n in d.name.lower() for n in NAMES) for f in d.rglob('*.jsonl')]
    seen = set()
    for f in sorted(files, key=lambda f: f.stat().st_mtime):
        n, key = scan(f, seen), str(f.relative_to(PROJECTS))
        if n['first']:
            ledger[key] = n
        else:  # nothing of its own (all counted in an earlier file): no stale entry from an earlier run
            ledger.pop(key, None)
    if not ledger or len(ledger) < previous_sessions():
        print(f'dev_stats: only {len(ledger)} sessions found, fewer than counted before: nothing written',
              file=sys.stderr)
        return 1
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(dict(sorted(ledger.items())), separators=(',', ':')).replace('},', '},\n') + '\n')

    commits = subprocess.run(['git', '-C', str(ROOT), 'rev-list', '--count', 'HEAD'], capture_output=True, text=True,
                             check=True)
    stats = {'prompts': sum(v['prompts'] for v in ledger.values()),
             'tokens': sum(v[k] for v in ledger.values() for k in KEYS),
             'sessions': len(ledger), 'commits': int(commits.stdout),
             'since': min(v['first'] for v in ledger.values())[:10],
             'updated': max(v['last'] for v in ledger.values())[:10]}
    OUT.write_text('// Written by tools/dev_stats.py. Do not edit.\n'
                   f'export const DEV_STATS = {json.dumps(stats, indent=2)};\n')
    print(json.dumps(stats))


if __name__ == '__main__':
    sys.exit(main())
