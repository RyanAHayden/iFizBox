#!/usr/bin/env python3
"""The format of a release's notes (docs/release.md, "Release notes"), checked by tools/publish.sh before its version
commit:

  python3 tools/publish_notes.py FILE     prints each problem with its line, exit 1; nothing and exit 0 when good

One list of "- " bullets and nothing else (blank lines are fine): 1-6 of them, each one sentence of at most 100
characters, no links or download text, one "Smaller fixes" bullet at most, no bullet said twice."""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
from brand import NAME  # noqa: E402

MAX_BULLETS = 6
MAX_CHARS = 100
REPEAT = 0.8  # of the shorter bullet's words are in the other one: the same thing said twice
STOP = {"a", "an", "the", "now"}

LINK = re.compile(r"[a-z][a-z0-9+.-]*://|\bwww\.|\bmailto:|\]\(|\]\[|<a\b", re.I)
DOWNLOAD = re.compile(r"\w\.(?:ipa|deb)\b|\bdownload\s+(?:(?:it|the|this)\s+)?(?:latest\s+|new\s+)?"
                      r"(?:%s\b|\.?ipa\b|\.?deb\b|release\b|from\s+github\b)" % re.escape(NAME), re.I)
ABBREVIATION = re.compile(r"\b(e\.g|i\.e|vs|etc)\.", re.I)
SENTENCE_BREAK = re.compile(r"[.!?][\"'”’)]*\s+\S")


def words(text):
    return {w for w in re.findall(r"\w+", re.sub(r"['’]", "", text.lower())) if w not in STOP}


def repeats(a, b):
    if a == b:
        return True
    short = min(len(a), len(b))
    return short >= 4 and len(a & b) / short >= REPEAT


def problems(text):
    """What is wrong with the notes, as (line number, message); [] when nothing is."""
    out, bullets = [], []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip():
            continue
        if not re.match(r"- \S", line):
            out.append((n, 'not a "- " bullet: the notes are one list, no summary, headings or wrapped lines'))
            continue
        body = line[2:].strip()
        if len(body) > MAX_CHARS:
            out.append((n, "%d characters, at most %d: shorten it" % (len(body), MAX_CHARS)))
        if not re.search(r"[.!?][\"'”’)]*$", body):
            out.append((n, "not a whole sentence: end it with a full stop"))
        if SENTENCE_BREAK.search(ABBREVIATION.sub(r"\1", body)):
            out.append((n, "more than one sentence: one short sentence a bullet"))
        if LINK.search(body):
            out.append((n, "has a link: no links in the notes"))
        if DOWNLOAD.search(body):
            out.append((n, "has download text: the notes only say what changed"))
        smaller = re.match(r"smaller fixes\b", body, re.I) is not None
        for m, other, other_smaller in bullets:
            if smaller and other_smaller:
                out.append((n, "a second Smaller fixes bullet: merge it with line %d" % m))
            elif repeats(words(body), words(other)):
                out.append((n, "repeats line %d: merge them" % m))
        bullets.append((n, body, smaller))
        if len(bullets) > MAX_BULLETS:
            out.append((n, "bullet %d, at most %d: merge or leave out" % (len(bullets), MAX_BULLETS)))
    if not bullets and not out:
        out.append((1, "no bullets: write 1 to %d" % MAX_BULLETS))
    return out


def main(args):
    if len(args) != 1:
        print("usage: publish_notes.py FILE", file=sys.stderr)
        return 2
    with open(args[0], encoding="utf-8") as f:
        text = f.read()
    lines = text.splitlines()
    found = problems(text)
    for n, what in found:
        line = lines[n - 1] if n <= len(lines) else ""
        print("%s line %d: %s\n  %s" % (os.path.basename(args[0]), n, what, line), file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
