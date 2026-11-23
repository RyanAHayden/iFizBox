"""T44: the bridge contract. Every bridge method the page calls (web/app/, and native/bridge.js injected beside it)
has a Swift handler, an `on("<method>")` in the app's Swift sources. No IDL or codegen: both sides are read as text.

A call is a dotted name literal in a call's first argument, or its second after one plain argument, the shapes the
page uses: native.call("app.info"), call(native, "idevice.pair"), via("account.key.get", ...), and a message's
`method: "haptic.tap"`. It counts when the function is `call` (whatever the name), or when the name's first part is
one the Swift side answers (app., idevice., ...), so wrappers like via() are seen while storage keys
(getItem("ifizbox.x")) and files (fetch("build.json")) are not; a renamed namespace still fails through `call`. A template (`library.${method}`) is expanded from the wrapper calls listed in TEMPLATES; a
template in a call with no entry there fails, so a new one gets listed rather than slipping past."""
import os
import re
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# The Swift that build.sh compiles into the app (native/spike/ is a separate test app with its own bridge).
SWIFT_DIRS = ["native/Sources", "native/sign", "native/intents", "native/share", "native/sideload"]
HANDLER = re.compile(r'(?<![\w.])(?:\w+\.)?on\(\s*"([^"]+)"')
# on( with anything but a string literal: a handler this test can't name.
HANDLER_OTHER = re.compile(r'(?<![\w.])(?<!func )(?:\w+\.)?on\(\s*(?!["\s)])')

NAME = r"[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+"
# A call's function name and opening, past at most one plain first argument (native?.call?.( included).
ARG = r"(?:([\w$]+)\s*(?:\?\.)?\s*)?\(\s*(?:[\w$.?]+\s*,\s*)?"
CALL = re.compile(ARG + r'(["\'`])(' + NAME + r")\2|\bmethod\s*:\s*([\"'])(" + NAME + r")\4")
FILE = re.compile(r"\.(?:css|js|mjs|json|html|png|svg|jpg|plist|ipa|deb)$")
TEMPLATE = re.compile(ARG + r"`([a-z][A-Za-z0-9]*)\.\$\{")

# Template prefix -> (files, regex): the method names come from group 1 of every match in those files.
TEMPLATES = {
    # signing-client.js libraryCall(method, ...); core/myipas.js gets libraryCall as `call` (screens/myipas.js).
    "library": (["web/app/**"], re.compile(r'\blibraryCall\(\s*"(\w+)"')),
    "library ": (["web/app/core/myipas.js"], re.compile(r'\bcall\(\s*"(\w+)"')),
    # screens/sharedeb.js: const call = (native, method, ...) => native.call(`share.${method}`, ...)
    "share": (["web/app/screens/sharedeb.js"], re.compile(r'\bcall\(\s*native\s*,\s*"(\w+)"')),
}

# Strings stay, comments become spaces (newlines kept, so offsets still give line numbers).
TOKENS = re.compile(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/')


def strip_comments(src):
    return TOKENS.sub(lambda m: m.group(0) if m.group(0)[0] in "\"'`" else re.sub(r"[^\n]", " ", m.group(0)), src)


def tracked(*patterns):
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", *patterns],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    return sorted(p for p in out if os.path.exists(os.path.join(ROOT, p)))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def line_of(src, pos):
    return src.count("\n", 0, pos) + 1


def swift_files():
    return [p for p in tracked(*(d + "/**.swift" for d in SWIFT_DIRS)) if p.endswith(".swift")]


def swift_handlers(files=None):
    """{method: "file:line"} for every on("...") in the app's Swift, and the on( calls that aren't a literal."""
    found, odd = {}, []
    for p in files if files is not None else swift_files():
        src = strip_comments(read(p))
        for m in HANDLER.finditer(src):
            found.setdefault(m.group(1), f"{p}:{line_of(src, m.start())}")
        odd += [f"{p}:{line_of(src, m.start())}" for m in HANDLER_OTHER.finditer(src)]
    return found, odd


def js_files():
    return [p for p in tracked("web/app/**.js", "native/bridge.js")
            if p.endswith(".js") and not p.endswith(".test.js") and "/vendor/" not in p]


def js_calls(files=None, namespaces=None):
    """{method: ["file:line", ...]} for every bridge call the page makes, templates expanded, and the call-position
    templates TEMPLATES doesn't know. `namespaces`: the first parts the Swift handlers use (default: read them)."""
    calls, unknown, prefixes = {}, [], {k.strip() for k in TEMPLATES}
    if namespaces is None:
        namespaces = {n.split(".")[0] for n in swift_handlers()[0]}
    files = js_files() if files is None else files
    for p in files:
        src = strip_comments(read(p))
        for m in CALL.finditer(src):
            name = m.group(3) or m.group(5)
            if FILE.search(name):  # loadStyle("signing.css"): a file, not a call
                continue
            if m.group(5) or m.group(1) == "call" or name.split(".")[0] in namespaces:
                calls.setdefault(name, []).append(f"{p}:{line_of(src, m.start())}")
        for m in TEMPLATE.finditer(src):
            prefix = m.group(2)
            if (m.group(1) == "call" or prefix in namespaces) and prefix not in prefixes:
                unknown.append(f"{p}:{line_of(src, m.start())}: `{prefix}.${{...}}`")
    for key, (globs, rx) in TEMPLATES.items():
        prefix = key.strip()
        for p in tracked(*globs):
            if p not in files:
                continue
            src = strip_comments(read(p))
            for m in rx.finditer(src):
                calls.setdefault(f"{prefix}.{m.group(1)}", []).append(f"{p}:{line_of(src, m.start())} (template)")
    return calls, unknown


def missing(calls, handlers):
    return {name: where for name, where in sorted(calls.items()) if name not in handlers}


class BridgeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.handlers, cls.odd = swift_handlers()
        cls.calls, cls.unknown = js_calls(namespaces={n.split(".")[0] for n in cls.handlers})

    def test_every_js_call_has_a_swift_handler(self):
        gone = missing(self.calls, self.handlers)
        self.assertEqual(gone, {}, "bridge methods the page calls that no Swift on(...) answers:\n" +
                         "\n".join(f"  {n}  ({', '.join(w[:3])})" for n, w in gone.items()))

    def test_every_handler_is_called(self):
        # The other way round: a handler nothing calls is dead code with the shell's privileges (remove it, or call it).
        dead = {n: w for n, w in sorted(self.handlers.items()) if n not in self.calls}
        self.assertEqual(dead, {}, "Swift bridge handlers no page code calls")

    def test_templates_are_listed(self):
        self.assertEqual(self.unknown, [], "a bridge call built from a template: add its wrapper to TEMPLATES")

    def test_handlers_are_literals(self):
        self.assertEqual(self.odd, [], "on(...) with a name that isn't a string literal: this test can't check it")

    def test_scanners_see_both_sides(self):
        """Guards against a scanner that quietly finds nothing: known calls of each shape and handlers of each
        source directory are found."""
        for name in ["app.info", "helper.run", "idevice.pair", "route.kept", "share.debFetch", "library.pick"]:
            self.assertIn(name, self.handlers)
        calls = self.calls
        for name in ["app.info",            # native.call("...")
                     "idevice.pair",        # call(native, "...")
                     "account.key.get",     # via("...", ...)
                     "haptic.tap",          # postMessage({ method: "..." })
                     "library.pick",        # libraryCall("pick")
                     "library.unsign",      # core/myipas.js call("unsign")
                     "share.debSimulate"]:  # screens/sharedeb.js call(native, "debSimulate")
            self.assertIn(name, calls)
        self.assertNotIn("apt.cydia.top", calls)  # a piracy-list host, not a call

    def test_fails_when_a_handler_is_renamed(self):
        # The task's check: rename a handler in a copy of its Swift file and the contract breaks on that name.
        file = self.handlers["idevice.pair"].split(":")[0]
        src = read(file)
        self.assertIn('on("idevice.pair")', src)
        renamed = {n: w for n, w in self.handlers.items() if not w.startswith(file + ":")}
        for m in HANDLER.finditer(strip_comments(src.replace('on("idevice.pair")', 'on("idevice.pairNow")'))):
            renamed.setdefault(m.group(1), file)
        self.assertEqual(list(missing(self.calls, renamed)), ["idevice.pair"])


if __name__ == "__main__":
    unittest.main()
