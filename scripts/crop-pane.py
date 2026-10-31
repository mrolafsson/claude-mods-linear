#!/usr/bin/env python3
"""Cuts Claude Code's docked pane out of a captured terminal screen.

Reads a tmux capture (with its colours, `capture-pane -e`) on stdin and
writes the part right of the dock's border (│), from the first line the
pane draws to its last, keeping each line's colours. Blank lines at the
top and bottom of the pane are dropped.
"""
import re
import sys

ESC = re.compile(r"\x1b\[[0-9;:?]*[A-Za-z]")
# Hyperlinks (OSC 8) and other OSC sequences: dropped, their text kept.
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def cells(line):
    """The line as (text, escapes before it) per character, escapes kept."""
    out, pending, i = [], "", 0
    while i < len(line):
        m = ESC.match(line, i)
        if m:
            pending += m.group(0)
            i = m.end()
            continue
        out.append((line[i], pending))
        pending = ""
        i += 1
    return out, pending


lines = OSC.sub("", sys.stdin.read()).split("\n")
parsed = [cells(l) for l in lines]
# The dock's border: the column where most lines have a │.
counts = {}
for cs, _ in parsed:
    for x, (ch, _) in enumerate(cs):
        if ch == "│":
            counts[x] = counts.get(x, 0) + 1
border = max(counts, key=counts.get)
rows = []
for cs, tail in parsed:
    if len(cs) <= border or cs[border][0] != "│":
        continue
    # The colours in force at the border, so the cut line starts in them.
    state = "".join(esc for _, esc in cs[: border + 1])
    text = "".join(esc + ch for ch, esc in cs[border + 1 :])
    rows.append((state + text + tail + "\x1b[0m", "".join(ch for ch, _ in cs[border + 1 :]).strip()))
while rows and not rows[0][1]:
    rows.pop(0)
while rows and not rows[-1][1]:
    rows.pop()
# The pane's own background, the one most of its text sits on, is dropped so
# a picture's background shows through, as in a terminal; other backgrounds
# (a pill, a highlight) stay.
BG = re.compile(r"\x1b\[([0-9;:]*)m")


def backgrounds(sgr):
    parts, i, found = sgr.split(";") if sgr else [], 0, []
    while i < len(parts):
        if parts[i] == "48" and i + 1 < len(parts):
            n = 5 if parts[i + 1] == "2" else 3
            found.append(";".join(parts[i : i + n]))
            i += n
        else:
            i += 1
    return found


counts = {}
for r, _ in rows:
    for m in BG.finditer(r):
        for b in backgrounds(m.group(1)):
            counts[b] = counts.get(b, 0) + 1
pane_bg = max(counts, key=counts.get) if counts else None


class Style:
    """The colours and weight in force, read from SGR codes, written out whole:
    reverse video becomes plain colours, which freeze draws, and the pane's
    background becomes none."""

    def __init__(self):
        self.fg, self.bg, self.bold, self.dim, self.italic, self.under, self.inverse = None, None, False, False, False, False, False

    def apply(self, sgr):
        parts = sgr.split(";") if sgr else ["0"]
        i = 0
        while i < len(parts):
            p = parts[i] or "0"
            if p in ("38", "48") and i + 1 < len(parts):
                n = 5 if parts[i + 1] == "2" else 3
                value = ";".join(parts[i + 1 : i + n])
                if p == "38":
                    self.fg = value
                else:
                    self.bg = None if f"48;{value}" == pane_bg else value
                i += n
                continue
            n = int(p) if p.isdigit() else -1
            if n == 0:
                self.__init__()
            elif n == 1:
                self.bold = True
            elif n == 2:
                self.dim = True
            elif n == 3:
                self.italic = True
            elif n == 4:
                self.under = True
            elif n == 7:
                self.inverse = True
            elif n == 22:
                self.bold = self.dim = False
            elif n == 23:
                self.italic = False
            elif n == 24:
                self.under = False
            elif n == 27:
                self.inverse = False
            elif 30 <= n <= 37 or 90 <= n <= 97:
                self.fg = f"5;{n - 30 if n < 90 else n - 82}"
            elif n == 39:
                self.fg = None
            elif 40 <= n <= 47 or 100 <= n <= 107:
                self.bg = f"5;{n - 40 if n < 100 else n - 92}"
            elif n == 49:
                self.bg = None
            i += 1

    def code(self):
        fg, bg = self.fg, self.bg
        if self.inverse:
            # The picture's background, and its default text colour.
            fg, bg = (bg or "2;30;30;46"), (fg or "2;205;214;244")
        out = ["0"]
        out += ["1"] if self.bold else []
        out += ["2"] if self.dim else []
        out += ["3"] if self.italic else []
        out += ["4"] if self.under else []
        out += [f"38;{fg}"] if fg else []
        out += [f"48;{bg}"] if bg else []
        return "\x1b[" + ";".join(out) + "m"


def restyle(line):
    style = Style()
    return BG.sub(lambda m: (style.apply(m.group(1)), style.code())[1], line)


# The pane's close mark (✕) on its first line belongs to Claude Code.
out = [restyle(r).replace("✕", " ") for r, _ in rows]
sys.stdout.write("\n".join(out) + "\n")
