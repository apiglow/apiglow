#!/usr/bin/env python3
# What a screen reader actually says while a keyboard walks apiglow.
# **Informative: it gates nothing**, and it is the one report in this tree that
# cannot be a Playwright spec — axe judges the DOM, the keyboard sweep judges
# the walk, and neither hears anything. Orca does: it is driven here for real,
# on real Gecko, and its own speech log is the transcript
# (docs/architecture.md §12).
#
# Python, alone in a tree of .mjs, because the platform accessibility API on
# Linux is AT-SPI and its bindings are GObject-introspection ones — Node has no
# way to register for a focus event or to synthesize a key through the
# accessibility registry.
#
# Nothing is spoken out loud: speech-dispatcher is pointed at a `printf` in a
# throwaway config, so the machine stays silent and the transcript still comes
# out of Orca, which logs what it is about to say before saying it.
#
# Requires: Linux, `orca`, `Xvfb`, and the Firefox the e2e toolchain already
# downloaded (the distribution one is usually a confined snap, invisible to the
# accessibility bus). Serve the app first: `npm run preview:cdn`.
#
#   SR_URL=…    the page to walk (default: the CDN-preview demo)
#   SR_ONLY=…   run only the acts whose title contains this, while iterating
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

INNER = "APIGLOW_SR_INNER"
REPORT_FD = "APIGLOW_SR_REPORT_FD"
URL = os.environ.get("SR_URL", "http://localhost:4173/demo/cdn-install.html")


def preflight():
    missing = [b for b in ("orca", "Xvfb", "xvfb-run", "dbus-run-session") if not shutil.which(b)]
    if sys.platform != "linux":
        missing.append(f"a Linux session (this is {sys.platform})")
    if missing:
        print(f"✖ missing: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)
    builds = sorted(pathlib.Path.home().glob(".cache/ms-playwright/firefox-*/firefox/firefox"))
    if not builds:
        print("✖ no Playwright Firefox — run `npx playwright install firefox`", file=sys.stderr)
        sys.exit(1)
    return str(builds[-1])


# The whole run needs an X display and a session bus of its own: a private bus
# keeps the desktop's own applications out of the accessibility tree, so the
# transcript holds nothing but this browser.
if os.environ.get(INNER) != "1":
    preflight()
    # Every daemon under xvfb-run inherits fd 1 — dbus alone writes thirty
    # lines there before the first key is pressed, and the X server signs off
    # with a fatal-looking IO error on teardown. So fd 1 becomes stderr for the
    # whole tree, and the real stdout rides down on a spare descriptor that
    # only the transcript writes to: `> transcript.md` catches the report and
    # nothing else.
    keep = os.dup(1)
    os.set_inheritable(keep, True)
    os.dup2(2, 1)
    os.environ[REPORT_FD] = str(keep)
    # Marked BEFORE the exec, which never returns: an unmarked child re-execs
    # itself, and one display per generation is a fork bomb with a screen.
    os.environ[INNER] = "1"
    os.execvpe(
        "xvfb-run",
        ["xvfb-run", "-a", "--server-args=-screen 0 1400x900x24", "dbus-run-session", "--",
         sys.executable, os.path.abspath(__file__), *sys.argv[1:]],
        os.environ,
    )

FF = preflight()
REPORT = os.fdopen(int(os.environ[REPORT_FD]), "w")

import gi  # noqa: E402

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, GLib  # noqa: E402

WORK = pathlib.Path(tempfile.mkdtemp(prefix="apiglow-sr-"))
LOG = WORK / "orca-debug.log"
TTS = WORK / "tts.log"
SPEECH = re.compile(r"^(\d\d):(\d\d):(\d\d\.\d+) - SPEECH OUTPUT: '(.*)' \{")
KEY = {"Tab": 0xFF09, "Enter": 0xFF0D, "Escape": 0xFF1B, "Left": 0xFF51, "Up": 0xFF52,
       "Right": 0xFF53, "Down": 0xFF54, "Home": 0xFF50, "End": 0xFF57, "Space": 0x0020}
CTRL = 1 << 2

ORCA_PREFS = {
    "general": {
        "enableSpeech": True,
        "enableBraille": False,
        "enableBrailleMonitor": False,
        "speechServerFactory": "speechdispatcherfactory",
        "startingProfile": ["Default", "default"],
        "firstStart": False,
        # Key echo would drown the transcript in "tabulation".
        "enableKeyEcho": False,
        "enableEchoByCharacter": False,
        "enableEchoByWord": False,
        "enableEchoBySentence": False,
        "speechVerbosityLevel": 1,
    },
    "profiles": {"default": {"profile": ["Default", "default"]}},
    "pronunciations": {},
    "keybindings": {},
}

FIREFOX_PREFS = {
    "browser.shell.checkDefaultBrowser": "false",
    "browser.startup.homepage_override.mstone": '"ignore"',
    "datareporting.policy.dataSubmissionEnabled": "false",
    "browser.aboutwelcome.enabled": "false",
    "toolkit.telemetry.reportingpolicy.firstRun": "false",
    "accessibility.force_disabled": "0",
    "browser.tabs.warnOnClose": "false",
}


def clock():
    lt = time.localtime()
    return lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec + (time.time() % 1)


class Reader:
    def __init__(self, url):
        self.marks = []
        self.focus = []
        Atspi.init()
        for prop in ("IsEnabled", "ScreenReaderEnabled"):
            subprocess.run(
                ["gdbus", "call", "--session", "--dest", "org.a11y.Bus", "--object-path",
                 "/org/a11y/bus", "--method", "org.freedesktop.DBus.Properties.Set",
                 "org.a11y.Status", prop, "<true>"],
                capture_output=True,
            )
        self._start_orca()
        self._listen()
        self._start_firefox(url)

    def _silent_tts(self):
        conf = WORK / "xdg" / "speech-dispatcher"
        (conf / "modules").mkdir(parents=True, exist_ok=True)
        (conf / "speechd.conf").write_text(
            'AddModule "silent" "sd_generic" "silent.conf"\n'
            'DefaultModule "silent"\nLanguageDefaultModule "en" "silent"\n'
            'DefaultVoiceType "MALE1"\nDefaultLanguage "en"\n'
            'AudioOutputMethod "alsa"\nAudioALSADevice "null"\n'
        )
        (conf / "modules" / "silent.conf").write_text(
            f'GenericExecuteSynth "printf \'%s\\n\' \\"$DATA\\" >> {TTS}"\n'
            'GenericCmdDependency "printf"\nGenericStripPunctChars ""\n'
            'GenericLanguage "en" "en" "utf-8"\nAddVoice "en" "MALE1" "en"\n'
            'DefaultVoice "MALE1"\n'
        )
        return conf.parent

    def _start_orca(self):
        prefs = WORK / "orca"
        prefs.mkdir(parents=True, exist_ok=True)
        (prefs / "user-settings.conf").write_text(json.dumps(ORCA_PREFS))
        xdg = self._silent_tts()
        # A speech-dispatcher daemon outlives its client and is reached through
        # a well-known socket: left running, Orca reconnects to whatever config
        # it was started with — the system one, on the machine's speakers.
        subprocess.run(["pkill", "-f", "speech-dispatcher"], capture_output=True)
        time.sleep(1)
        self.orca = subprocess.Popen(
            ["orca", "--replace", "--user-prefs", str(prefs), "--debug-file", str(LOG)],
            # C.utf8 rather than the desktop's locale: Orca ships translated,
            # and a French transcript would say nothing about an English UI.
            env=dict(os.environ, LANG="C.utf8", LANGUAGE="en", LC_ALL="C.utf8",
                     XDG_CONFIG_HOME=str(xdg), PULSE_SERVER="/dev/null",
                     SPEECHD_ADDRESS=f"unix_socket:{WORK / 'speechd.sock'}"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        time.sleep(6)

    def _start_firefox(self, url):
        profile = WORK / "ff"
        profile.mkdir()
        (profile / "user.js").write_text(
            "\n".join(f'user_pref("{k}", {v});' for k, v in FIREFOX_PREFS.items())
        )
        self.ff = subprocess.Popen(
            [FF, "--profile", str(profile), "--no-remote", "--new-instance", url],
            env=dict(os.environ, GNOME_ACCESSIBILITY="1", LANG="C.utf8", LC_ALL="C.utf8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def _listen(self):
        def on_focus(event):
            # The same event carries focus gained (detail1=1) and lost (0):
            # recording both makes "what has focus" alternate with what left it.
            if event.detail1 != 1:
                return
            try:
                self.focus.append((event.source.get_name(), event.source.get_role_name()))
            except Exception:
                pass

        self.listener = Atspi.EventListener.new(on_focus)
        self.listener.register("object:state-changed:focused")
        threading.Thread(target=GLib.MainLoop().run, daemon=True).start()

    def close(self):
        for p in (self.ff, self.orca):
            p.terminate()
        time.sleep(2)
        for p in (self.ff, self.orca):
            if p.poll() is None:
                p.kill()
        subprocess.run(["pkill", "-f", "speech-dispatcher"], capture_output=True)

    # -- observing ---------------------------------------------------------
    def ready(self, needle, timeout=60):
        deadline = time.time() + timeout
        while time.time() < deadline:
            desktop = Atspi.get_desktop(0)
            for i in range(desktop.get_child_count()):
                try:
                    app = desktop.get_child_at_index(i)
                    if "firefox" in (app.get_name() or "").lower() and self._find(app, needle, 0):
                        return True
                except Exception:
                    pass
            time.sleep(1)
        return False

    def _find(self, node, needle, depth):
        if depth > 12:
            return None
        try:
            if needle.lower() in (node.get_name() or "").lower():
                return node
            for i in range(node.get_child_count()):
                hit = self._find(node.get_child_at_index(i), needle, depth + 1)
                if hit:
                    return hit
        except Exception:
            pass
        return None

    def focused(self):
        return self.focus[-1] if self.focus else (None, None)

    def mark(self, label):
        """Opens the window the next action's speech is filed under.

        Marked before the action, never after: what a press makes the reader
        hear arrives while the press is settling, and a mark placed afterwards
        files every line one step early.
        """
        self.marks.append((clock(), label))

    # -- driving -----------------------------------------------------------
    def press(self, key, settle=1.2, mods=0):
        if mods:
            Atspi.generate_keyboard_event(mods, None, Atspi.KeySynthType.LOCKMODIFIERS)
        Atspi.generate_keyboard_event(KEY[key], None, Atspi.KeySynthType.SYM)
        if mods:
            Atspi.generate_keyboard_event(mods, None, Atspi.KeySynthType.UNLOCKMODIFIERS)
        time.sleep(settle)

    def chord(self, ch, settle=1.5):
        Atspi.generate_keyboard_event(CTRL, None, Atspi.KeySynthType.LOCKMODIFIERS)
        Atspi.generate_keyboard_event(ord(ch), None, Atspi.KeySynthType.SYM)
        Atspi.generate_keyboard_event(CTRL, None, Atspi.KeySynthType.UNLOCKMODIFIERS)
        time.sleep(settle)

    def write(self, s, settle=1.2):
        Atspi.generate_keyboard_event(0, s, Atspi.KeySynthType.STRING)
        time.sleep(settle)

    def open(self, url):
        self.chord("l", settle=1.0)
        self.write(url, settle=0.5)
        self.press("Enter", settle=6.0)

    def tab_to(self, pattern, limit=80):
        """Tab until the focused accessible answers to `pattern`.

        Counting presses would be shorter and wrong: the stop list is the
        document's, it changes with the schema, and a walk that miscounts by one
        presses Enter on a neighbour. The settle is what makes the reading true
        — a focus event that lands after the check has the walk overshoot.
        """
        rx = re.compile(pattern, re.I)
        for _ in range(limit):
            self.press("Tab", settle=0.7)
            name, _role = self.focused()
            if name and rx.search(name):
                return True
        # A miss must be readable in the report, not just in the return value no
        # caller checks: every press after it lands somewhere else, and a walk
        # that typed into the wrong field still produces a transcript that looks
        # like a walk. This is the line that says otherwise.
        self.mark(f"✖ never reached {pattern!r} in {limit} stops — what follows walks blind")
        return False

    # -- reporting ---------------------------------------------------------
    def transcript(self):
        """Every line Orca spoke, filed under the step it followed.

        Attribution is by timestamp rather than by draining a buffer after each
        press: an announcement that arrives late — the whole point of a live
        region — must land in the report, not in the gap between two reads.
        """
        said = []
        for line in LOG.read_text("utf-8", "replace").splitlines():
            m = SPEECH.match(line.strip())
            if m:
                at = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                said.append((at, m.group(4)))
        out = []
        for i, (at, label) in enumerate(self.marks):
            end = self.marks[i + 1][0] if i + 1 < len(self.marks) else float("inf")
            out.append((label, [(t - at, txt) for t, txt in said if at <= t < end]))
        return out


def scenarios(r):
    """The journey a reader takes, act by act. Each starts from a fresh load."""

    def landing():
        r.mark("Tab — first stop of the document")
        r.press("Tab", settle=2.5)
        r.mark("Enter on the skip link")
        r.press("Enter", settle=2.5)
        r.mark("Tab — first stop inside main")
        r.press("Tab", settle=2.5)

    def operation():
        r.mark("Tab through the shell to an operation in the nav")
        r.tab_to(r"Finds Pets by status")
        r.mark("Enter — the route changes")
        r.press("Enter", settle=4.0)

    def send():
        r.tab_to(r"Finds Pets by status")
        r.press("Enter", settle=4.0)
        r.mark("Tab across the doc to Send")
        r.tab_to(r"^Send$", limit=90)
        r.mark("Enter on Send, then 12 s of doing nothing")
        r.press("Enter", settle=12.0)
        r.mark(f"…and focus is on {r.focused()[0]!r}")
        r.tab_to(r"^Pretty$|^Raw$", limit=40)
        r.mark("Right arrow inside the response tablist")
        r.press("Right", settle=2.0)
        r.mark("Right arrow again")
        r.press("Right", settle=2.0)

    def webhook():
        r.mark("Tab to a webhook in the nav")
        r.tab_to(r"Pet status changed", limit=90)
        r.mark("Enter — the simulator opens")
        r.press("Enter", settle=4.0)
        r.mark("Tab to the receiver URL")
        r.tab_to(r"Receiver URL", limit=60)
        # The demo API has no receiver endpoint and answers 404. That is a real
        # round trip, which is the whole of what this act listens for: the Send
        # here has no Cancel to lend the keyboard to.
        r.mark("type a receiver the demo API will refuse")
        r.write("http://localhost:4173/demo-api/v3/hooks/in", settle=1.0)
        r.mark("Tab to Send event")
        r.tab_to(r"^Send event$", limit=20)
        r.mark("Enter on Send event, then 10 s of doing nothing")
        r.press("Enter", settle=10.0)
        r.mark(f"…and focus is on {r.focused()[0]!r}")

    def history():
        r.mark("Tab to History")
        r.tab_to(r"^History$", limit=40)
        r.mark("Enter — the dialog opens")
        r.press("Enter", settle=3.0)
        r.mark("Tab inside the dialog")
        r.press("Tab", settle=2.5)
        r.mark("Escape")
        r.press("Escape", settle=2.5)
        r.mark(f"…and focus is on {r.focused()[0]!r}")

    def environment():
        r.mark("Tab to the environment menu")
        r.tab_to(r"^Environment$", limit=40)
        r.mark("Enter — the menu opens")
        r.press("Enter", settle=2.5)
        r.mark("Down through the entries")
        r.press("Down", settle=2.5)
        r.mark("Escape")
        r.press("Escape", settle=2.5)
        r.mark(f"…and focus is on {r.focused()[0]!r}")

    def palette():
        r.mark("Ctrl+K — the search palette opens")
        r.chord("k", settle=3.0)
        r.mark("type 'pet'")
        r.write("pet", settle=3.0)
        r.mark("Down through the results")
        r.press("Down", settle=2.5)
        r.mark("Escape")
        r.press("Escape", settle=2.5)
        r.mark(f"…and focus is on {r.focused()[0]!r}")

    def scenario_run():
        r.mark("Tab to a scenario")
        r.tab_to(r"Order a pet", limit=60)
        r.mark("Enter — the scenario opens")
        r.press("Enter", settle=4.0)
        r.mark("Tab to Run all")
        r.tab_to(r"^Run\b", limit=80)
        r.mark("Enter on Run, then 20 s of doing nothing")
        r.press("Enter", settle=20.0)
        r.mark(f"…and focus is on {r.focused()[0]!r}")

    return [
        ("Landing and skip link", landing),
        ("Opening an operation", operation),
        ("Sending, and hearing the answer", send),
        ("Delivering a webhook event", webhook),
        ("History dialog", history),
        ("Environment menu", environment),
        ("Search palette", palette),
        ("Running a scenario", scenario_run),
    ]


def main():
    r = Reader(URL)
    try:
        if not r.ready("Petstore", timeout=90):
            print(f"✖ {URL} never reached the accessibility tree — is the server up?",
                  file=sys.stderr)
            return 1
        time.sleep(8)
        only = os.environ.get("SR_ONLY", "").lower()
        for title, act in scenarios(r):
            if only and only not in title.lower():
                continue
            r.mark(f"### {title}")
            # Every act starts from a cold load, so a stop count is a stop
            # count: a journey that keeps its state drifts a little further
            # from the reader's actual position at every step.
            r.mark("load the page")
            r.open(URL)
            act()
        def say(line):
            print(line, file=REPORT)

        say(f"# apiglow — what Orca says\n\n<{URL}>, Firefox + Orca, keyboard only.\n")
        for label, lines in r.transcript():
            if label.startswith("### "):
                say(f"\n## {label[4:]}\n")
                continue
            say(f"- **{label}**")
            for dt, txt in lines:
                say(f"    - `+{dt:.1f}s` {txt}")
            if not lines:
                say("    - _(silence)_")
        REPORT.flush()
        return 0
    finally:
        r.close()


sys.exit(main())
