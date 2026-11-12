#!/bin/sh
# Regenerates build/icon.icns from build/icon.svg. Requires rsvg-convert (librsvg) and macOS iconutil.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
set=$work/icon.iconset
mkdir "$set"
for size in 16 32 128 256 512; do
  rsvg-convert -w $size -h $size "$root/build/icon.svg" -o "$set/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) "$root/build/icon.svg" -o "$set/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$set" -o "$root/build/icon.icns"
