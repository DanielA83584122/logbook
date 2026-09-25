#!/bin/sh
# Build and install the Mac app that opens Logbook from Spotlight.
#
#   sh macos/build.sh [port]        (default port 8000)
#
# The app starts backend.app from this checkout's .venv on 127.0.0.1:<port>
# and shows it in a window. Run `python3 -m venv .venv`, install
# backend/requirements.lock.txt and `npm run build` first.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8000}"
DEST="${LOGBOOK_APP_DIR:-$HOME/Applications}"
BUILD="$(mktemp -d)/Logbook.app"

mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

ICONSET="$(mktemp -d)/Logbook.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ROOT/public/icons/icon-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  [ "$double" -le 1024 ] && sips -z "$double" "$double" "$ROOT/public/icons/icon-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/Contents/Resources/Logbook.icns"

cat > "$BUILD/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Logbook</string>
  <key>CFBundleDisplayName</key><string>Logbook</string>
  <key>CFBundleIdentifier</key><string>local.logbook</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Logbook</string>
  <key>CFBundleIconFile</key><string>Logbook</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LogbookRoot</key><string>$ROOT</string>
  <key>LogbookPort</key><integer>$PORT</integer>
</dict>
</plist>
PLIST
plutil -lint "$BUILD/Contents/Info.plist" >/dev/null

swiftc -O -o "$BUILD/Contents/MacOS/Logbook" "$ROOT/macos/Logbook.swift" -framework Cocoa -framework WebKit
codesign --force --deep --sign - "$BUILD" 2>/dev/null

mkdir -p "$DEST"
rm -rf "$DEST/Logbook.app"
cp -R "$BUILD" "$DEST/Logbook.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/Logbook.app"
echo "Installed $DEST/Logbook.app (root: $ROOT, port: $PORT)"
