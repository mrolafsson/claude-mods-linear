#!/bin/sh
# Regenerates docs/images/*.png from the demo workspace, so no real issue or
# project can end up in the README.
#
# Starts Claude Code with this mod in a hidden tmux window, opens `/linear
# demo`, walks through the screens with key presses and captures each one;
# scripts/crop-pane.py cuts the pane out of the capture, and freeze turns it
# into a PNG, as herdr-linear's are made. `/linear` runs in the mod: no
# message reaches the model.
#
# Needs: tmux, freeze (brew install charmbracelet/tap/freeze), rsvg-convert
# with the JetBrains Mono font, python3; and Claude Code, signed in.
set -eu
cd "$(dirname "$0")/.."
here=$PWD

for tool in tmux freeze rsvg-convert python3 claude; do
	command -v "$tool" >/dev/null 2>&1 || { echo "screenshots need $tool" >&2; exit 1; }
done
if command -v fc-list >/dev/null 2>&1 && ! fc-list | grep -qi "JetBrains Mono"; then
	echo "screenshots need the JetBrains Mono font" >&2
	exit 1
fi
if command -v sips >/dev/null 2>&1; then
	shrink() { sips --resampleWidth 1800 "$1" >/dev/null; }
elif command -v magick >/dev/null 2>&1; then
	shrink() { magick "$1" -resize 1800x "$1"; }
else
	shrink() { :; }
fi

session=linear-screenshots
screens=$(mktemp -d)
trap 'tmux kill-session -t "$session" 2>/dev/null || true; rm -rf "$screens"' EXIT

# Wide, so the pane docked beside the conversation gets room.
tmux kill-session -t "$session" 2>/dev/null || true
tmux new-session -d -s "$session" -x 200 -y 44 -c "$here" "claude --plugin-dir '$here'"
sleep 10

keys() { tmux send-keys -t "$session" "$@"; sleep 1.5; }
snap() { sleep "${2:-3}"; tmux capture-pane -t "$session" -e -p >"$screens/$1.ansi"; }

# Typed as text, then Enter, so no keystroke is taken for a binding.
tmux send-keys -t "$session" -l "/linear demo"
sleep 1.5
keys Enter
snap issues 5
tmux send-keys -t "$session" -l "sea"
snap filter
keys BSpace BSpace BSpace
keys Down
keys Down
keys Enter
snap issue 4
keys c
snap status
# Out of the picker and the issue, then the pane closed and opened again,
# so the cursor is in the filter, where ↑ switches to Projects.
keys Escape
keys Escape
keys Escape
tmux send-keys -t "$session" -l "/linear demo"
sleep 1.5
keys Enter
sleep 3
keys Up
snap projects
keys Down
keys Enter
snap project 4

mkdir -p docs/images
for name in issues filter issue status projects project; do
	python3 scripts/crop-pane.py <"$screens/$name.ansi" >"$screens/$name.pane"
	freeze --language ansi --window \
		--font.family "JetBrains Mono" --font.size 14 --line-height 1.3 \
		--padding 20,24 --margin 0 --border.radius 10 \
		--background "#1e1e2e" --output "docs/images/$name.png" <"$screens/$name.pane" >/dev/null
	shrink "docs/images/$name.png"
	echo "docs/images/$name.png"
done
