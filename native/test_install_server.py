"""B29: the sideload install server (Sources/InstallServer.swift) and serveAndOpen (Sources/Sideload.swift) can't run
off the phone, so read the sources for the fix: an IPA counts as served only once every byte went out over all of
iOS's requests (ByteCoverage in sign/HTTP.swift, tested in Swift by native/test_sign.py), the route stays for the
grace after that, and the install log gets the bundle ID and what iOS fetched (relayed by signing.progress)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


def body(src, start, end="\n    }\n"):
    i = src.index(start)
    return src[i:src.index(end, i)]


class InstallServerSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = read("InstallServer.swift")
        cls.sideload = read("Sideload.swift")
        cls.myipas = read("MyIPAs.swift")

    def test_served_means_every_byte(self):
        answer = body(self.server, "private func answer(")
        # The old trigger: any request reaching the last byte called onServed, and the route went with it.
        self.assertNotIn("upperBound == size - 1", answer)
        self.assertNotIn("route.onServed", answer)
        sent = body(self.server, "private func sent(")
        self.assertIn("ByteCoverage", sent)
        self.assertIn("cov.covers(size: size)", sent)
        self.assertIn("fired.insert(path)", sent)
        self.assertIn("route.onServed?()", sent)

    def test_requests_and_bytes_logged(self):
        answer = body(self.server, "private func answer(")
        self.assertIn('route.log?("iOS: ', answer)
        self.assertIn("gone[req.path]?(", answer)  # a request after serving ended says it got a 404
        self.assertIn("\\(cov.count) of \\(size) bytes sent to iOS", body(self.server, "private func sent("))
        self.assertIn("cutShort?(left)", body(self.server, "private func stream("))

    def test_route_kept_for_the_grace(self):
        # B30: serveAndOpen checks the manifest first; the serving moved to serveChecked.
        serve = body(self.sideload, "private static func serveChecked(", "\n    }\n\n")
        end = serve[serve.index("let end = {"):serve.index("server.serve(")]
        # Served: removed only inside the grace's asyncAfter, not at once.
        self.assertNotRegex(end, r"job\?\.end\(\)\n\s*server\.remove\(ipaPath\)")
        self.assertIn("if !ok {", end)
        grace = end[end.index("asyncAfter(deadline: .now() + servedGrace)"):]
        self.assertIn("if ok { server.remove(ipaPath) }", grace)
        self.assertIn("hold.over()", grace)
        m = re.search(r"static let servedGrace: TimeInterval = (\d+)", self.sideload)
        self.assertTrue(m and int(m.group(1)) >= 60, "servedGrace")
        self.assertIn("log: serverLog", serve)
        self.assertIn('log?("Bundle ID: \\(app.bundleID)"', serve)

    def test_server_lines_reach_the_page(self):
        progress = body(self.sideload, "static func progress(")
        self.assertIn("InstallLog.attach(bid)", progress)
        self.assertIn('c.emitOnMain([["log": $0]])', progress)
        self.assertIn("InstallLog.detach(bid)", progress)
        self.assertIn("enum InstallLog", self.sideload)
        install = body(self.myipas, "static func install(")
        self.assertIn("serveAndOpen(out, server: servers.manifest, app: s.app, record: record, log: log,", install)

    def test_freeze_seen_and_listener_remade(self):
        """B89: iOS 27 froze iFizBox mid-serve and the listener's socket stayed suspended. A heartbeat sees the gap,
        the listener is re-created on the same port (the link names it), and the app's lifecycle goes to the log."""
        tick = body(self.server, "private func tick(")
        self.assertIn("InstallServer.freezeGap", tick)
        self.assertIn('revive("after the freeze")', tick)
        self.assertIn("where !fired.contains(path) { r.onFrozen?(f) }", tick)
        # notes never go through route.log: Sideload's serverLog takes any log line as iOS asking (InstallPrompt.heard)
        self.assertNotIn("route.log", tick)
        self.assertIn("r.note?(line)", body(self.server, "private func noteAll("))
        revive = body(self.server, "private func revive(")
        self.assertIn("old?.cancel()", revive)
        self.assertIn("NWEndpoint.Port(rawValue: port)", revive)
        self.assertIn('NWEndpoint.Host("127.0.0.1"), port: p)', revive)
        self.assertIn("tries: tries - 1", revive)
        beat = body(self.server, "private func startBeat(")
        for n in ("didEnterBackgroundNotification", "willEnterForegroundNotification",
                  "protectedDataWillBecomeUnavailableNotification"):
            self.assertIn(n, beat)
        self.assertIn("self.stopBeat()", body(self.server, "func stop("))
        self.assertIn("asked[req.path] = Date()", body(self.server, "private func answer("))

    def test_freeze_falls_back_to_the_server(self):
        """B89: after a freeze, an IPA iOS hasn't asked for again goes to the Signing Server's /sign/host and iOS gets
        that link; the server's status ends it, and the local 15-minute expiry doesn't while that copy is up."""
        serve = body(self.sideload, "private static func serveChecked(", "\n    }\n\n")
        self.assertIn("route.onFrozen = { f in", serve)
        self.assertIn("guard !server.asked(ipaPath, since: f.to)", serve)
        self.assertIn("hostAfterFreeze(output, remote: remote,", serve)
        self.assertIn("if !fallback.hosting { end(false) }", serve)
        self.assertIn("fallback.finish()", serve[serve.index("let end = {"):])
        host = body(self.sideload, "static func hostAfterFreeze(", "\n    }\n\n")
        self.assertIn("state.begin()", host)
        self.assertIn("copyItem(at: output, to: copy)", host)  # the local route keeps its file
        self.assertIn("InstallPrompt.rehost(bid, link: hosted)", host)  # B91: the next tap opens it
        self.assertIn("InstallPrompt.end(bid, link: hosted)", host)
        self.assertNotIn("CloseForUpdate", host)  # that closes iFizBox: only for its own update
        # B215: through HostUpload, which posts to /sign/host in parts
        self.assertIn("HostUpload(file, server: server, app: app)", body(self.sideload, "static func uploadHosted(", "\n    }\n\n"))
        self.assertIn('server + "/sign/host"', body(self.sideload, "final class HostUpload {", "\n}\n"))
        self.assertIn("InstallPrompt.heard(bid)", body(self.sideload, "private static func pollHosted(", "\n    }\n\n"))

    def test_freeze_after_the_prompt_closed_opens_no_prompt(self):
        """B91: iFizBox can't tell the user's Cancel from a frozen server, so a freeze after the prompt was shown and
        closed opens no new prompt: the hosted link waits for the user's tap (signing.reprompt), and InstallPrompt's
        own re-opens stop once a prompt was shown."""
        host = body(self.sideload, "static func hostAfterFreeze(", "\n    }\n\n")
        self.assertNotIn("InstallPrompt.open(", host)
        self.assertNotIn("UIApplication.shared.open(", host)
        # the only InstallPrompt.open in Sideload is serveChecked's first hand-off of the local link
        self.assertEqual(self.sideload.count("InstallPrompt.open("), 1)
        self.assertIn("InstallPrompt.open(iosLink, bundleID: bid",
                      body(self.sideload, "private static func serveChecked(", "\n    }\n\n"))
        # a dismissed prompt keeps its IPA served (and hosted) for the row's Try Again
        progress = body(self.sideload, "static func progress(")
        self.assertNotIn("SignJob.cancel(tag:", progress)

        prompt = read("InstallPrompt.swift")
        self.assertIn("static func mayOpenByItself(everShown: Bool) -> Bool { !everShown }", prompt)
        # a shown prompt marks the entry for good; nothing but the willResignActive observer sets it
        self.assertEqual(prompt.count("e.everShown = true"), 1)
        self.assertNotIn("everShown = false\n", prompt.replace("var everShown = false", ""))
        observer = prompt[prompt.index("willResignActiveNotification"):prompt.index("didBecomeActiveNotification")]
        self.assertIn("e.everShown = true", observer)
        attempt = body(prompt, "private static func attempt(")
        self.assertIn("guard user || mayOpenByItself(everShown: e.everShown) else {", attempt)
        self.assertLess(attempt.index("mayOpenByItself"), attempt.index("UIApplication.shared.open("))
        # the retries inside attempt carry who asked; the automatic ones say user: false
        self.assertIn("attempt(bid, e, n: n + 1, user: user, done: done)", attempt)
        self.assertIn("attempt(bid, e, n: n, user: user, done: done)", attempt)
        check = body(prompt, "private static func checkShown(")
        self.assertIn("mayOpenByItself(everShown: e.everShown)", check)
        self.assertIn("user: false", check)
        self.assertIn("user: false", body(prompt, "static func open("))
        self.assertIn("user: true", body(prompt, "static func reprompt("))
        # every call of attempt names who asked
        self.assertEqual(len(re.findall(r"attempt\(bid", prompt)), len(re.findall(r"attempt\(bid[^)]*user: ", prompt)))
        # rehost only swaps the link: it never opens one
        rehost = body(prompt, "static func rehost(")
        self.assertIn("e.link = link", rehost)
        self.assertNotIn("attempt(", rehost)
        self.assertNotIn("open(", rehost.replace("static func rehost(", ""))
        self.assertIn("e.links.contains(link)", body(prompt, "static func end("))
        self.assertNotIn("taken as Cancel", prompt)

    def test_idle_listener_never_reused(self):
        """B128: on iOS 27 the next queued app got ECONNREFUSED: start() reused a listener that still said .ready
        though iOS had shut its socket while iFizBox was suspended, and nothing watched it with no route served.
        start() goes by ListenerStart (sign/HTTP.swift, tested in Swift by native/test_sign.py): idle means a fresh
        listener, and every install, each item of a queue run included, comes through start()."""
        start = body(self.server, "func start(")
        self.assertNotIn("l.state == .ready { return done(.success(self.port)) }", start)
        self.assertIn("ListenerStart.decide(", start)
        self.assertIn("serving: !self.routes.isEmpty", start)
        fresh = start[start.index("case .fresh:"):start.index("do {")]
        self.assertIn("old?.cancel()", fresh)
        self.assertIn("self.listener = nil", fresh)
        self.assertIn("self.revive(", start[start.index("case .revive:"):start.index("case .fresh:")])
        self.assertIn("guard self.listener === l else { break }", start)  # a replaced listener sets no port
        self.assertIn("case .cancelled:", start)  # nor leaves its caller waiting
        decide = read("../sign/HTTP.swift")
        self.assertIn("guard has, serving else { return .fresh }", decide)
        serve = body(self.sideload, "static func serveAndOpen(", "\n    }\n\n")
        self.assertIn("let server = InstallServer.plain\n        server.start {", serve)
        for name in ("MyIPAs.swift", "SignAhead.swift"):
            self.assertIn("Sideload.serveAndOpen(", read(name))
        self.assertIn("serveAndOpen(output,", self.sideload)


if __name__ == "__main__":
    unittest.main()
