"""B329: the upgrades daemon's apt runs (main.m, which only builds for the phone) read no Translation files, as the
helper's do (native/helper/test_helper.py test_no_translations_for_any_apt_run). A repo that answered its
Translation URL with a web page left a file in apt's lists that apt can't parse, and every apt command failed;
the daemon's apt-get update without the option would fetch that page again. Checked in main.m's source."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


class NoTranslations(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "main.m"), encoding="utf-8") as f:
            self.src = f.read()

    def test_define(self):
        self.assertIn('#define NO_TRANSLATIONS "Acquire::Languages=none"', self.src)

    def test_every_apt_argv_has_it(self):
        # each argv that names apt-get or apt-mark, up to the statement that ends its list (NULL) or the function
        runs = [m.start() for m in re.finditer(r'"/usr/bin/apt-(?:get|mark)"', self.src)]
        self.assertGreaterEqual(len(runs), 3, "main.m's apt runs: showhold, update, the simulate/install builder")
        for at in runs:
            end = self.src.find("NULL", at)
            self.assertNotEqual(end, -1)
            with self.subTest(line=self.src.count("\n", 0, at) + 1):
                self.assertIn('"-o", NO_TRANSLATIONS', self.src[at:end].replace('argv[k++] = "-o"; argv[k++] = NO_TRANSLATIONS',
                                                                                '"-o", NO_TRANSLATIONS'))


if __name__ == "__main__":
    unittest.main()
