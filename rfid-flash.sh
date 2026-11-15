#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  RFID-Shift-Mate 2 — build, flash and watch the reader
#
#    sh rfid-flash.sh                    build, upload, then open the monitor
#    sh rfid-flash.sh --key <64 hex>     store the portal API key first
#    sh rfid-flash.sh --build            build only; no board needed
#    sh rfid-flash.sh --monitor          just watch the serial output
#    sh rfid-flash.sh --erase            wipe the flash, then upload
#    sh rfid-flash.sh --port /dev/ttyUSB1   skip auto-detection
#
#  The toolchain runs in the pio-build container, so nothing has to be
#  installed on this machine and the build cannot drift. The serial port is
#  handed in with --device.
#
#  It runs the container as root deliberately: .pio/ was created that way by
#  the first build, and switching now would fail on its own root-owned files.
# ═══════════════════════════════════════════════════════════════════════════
set -e

FW=/home/ahmed/AIML-Migration-Package-20261109-170756/RFID-ShiftMate-2/firmware
IMAGE=pio-build:1
CACHE=pio-cache
BAUD=115200

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m%s\033[0m\n' "$1"; }
warn()  { printf '  \033[33m%s\033[0m\n' "$1"; }
die()   { printf '  \033[31m%s\033[0m\n' "$1" >&2; exit 1; }

PORT=""
MODE=flash
NEWKEY=""

while [ $# -gt 0 ]; do
    case "$1" in
        --key)     NEWKEY="$2"; shift 2 ;;
        --port)    PORT="$2";   shift 2 ;;
        --build)   MODE=build;   shift ;;
        --monitor) MODE=monitor; shift ;;
        --erase)   MODE=erase;   shift ;;
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)         die "Unknown option: $1  (try --help)" ;;
    esac
done

[ -d "$FW" ] || die "Firmware not found at $FW"
docker image inspect "$IMAGE" >/dev/null 2>&1 \
    || die "The $IMAGE toolchain image is missing. Rebuild it from Dockerfile.pio."

# ── the API key ────────────────────────────────────────────────────────────
# A reader with no key authenticates against nothing and the portal answers
# 401 to every request. The firmware says so on screen, but catching it here
# saves a flash cycle and a confusing first boot.
KEYLINE=$(grep -n '#define PORTAL_API_KEY' "$FW/include/config.h" || true)
CURKEY=$(printf '%s' "$KEYLINE" | sed -n 's/.*"\(.*\)".*/\1/p')

if [ -n "$NEWKEY" ]; then
    # 64 hex characters: crypto.randomBytes(32).toString('hex') on the server.
    if ! printf '%s' "$NEWKEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then
        die "That does not look like a reader API key. Expected 64 hex characters, got ${#NEWKEY}."
    fi
    cp "$FW/include/config.h" "$FW/include/config.h.bak-$(date +%Y%m%d-%H%M%S)"
    # Written with python rather than sed: the key goes inside a C string and
    # a stray & or / in a sed replacement would corrupt it silently.
    NEWKEY="$NEWKEY" python3 - "$FW/include/config.h" <<'PY'
import os, re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s2, n = re.subn(r'(#define\s+PORTAL_API_KEY\s+)"[^"]*"',
                lambda m: m.group(1) + '"' + os.environ['NEWKEY'] + '"', s, count=1)
if n != 1:
    sys.exit('could not find PORTAL_API_KEY in config.h')
open(p, 'w', encoding='utf-8', newline='').write(s2)
PY
    ok "API key stored in config.h (previous copy kept as config.h.bak-*)"
    CURKEY="$NEWKEY"
fi

# Only the modes that actually put firmware on a board need the key.
# Building without one is legitimate — it is how you check the code compiles
# before the reader exists in the portal — and `--monitor` only reads.
if { [ "$MODE" = "flash" ] || [ "$MODE" = "erase" ]; } && [ -z "$CURKEY" ]; then
    bold "PORTAL_API_KEY is empty"
    cat <<'EOF'
  The reader cannot authenticate without it and the portal will answer 401
  to everything. Get one first:

    1. Open the portal, Administration -> RFID Readers
    2. Add a reader with the ID  RFID-SM2-001
    3. Copy the key it shows you (it is shown once)
    4. Re-run:  sh rfid-flash.sh --key <that key>

  Or build without flashing:  sh rfid-flash.sh --build
EOF
    exit 1
fi

# ── find the board ─────────────────────────────────────────────────────────
# Always exits 0, including when it finds nothing. Under `set -e` a function
# that ends on a failed test takes the whole script down, which turned "no
# board plugged in" into a silent exit instead of the help below.
find_port() {
    if [ -e /dev/esp32 ]; then readlink -f /dev/esp32; return 0; fi
    for d in /dev/serial/by-id/*; do
        if [ -e "$d" ]; then readlink -f "$d"; return 0; fi
    done
    for d in /dev/ttyUSB* /dev/ttyACM*; do
        if [ -e "$d" ]; then printf '%s' "$d"; return 0; fi
    done
    return 0
}

if [ "$MODE" != "build" ]; then
    [ -n "$PORT" ] || PORT=$(find_port)
    if [ -z "$PORT" ]; then
        bold "No board found"
        cat <<'EOF'
  Nothing is plugged in, or the cable is charge-only. Check, in this order:

    * a DATA USB cable, not a charging one — this is the usual culprit
    * the board's power LED is lit
    * dmesg | tail   should show  cp210x converter now attached to ttyUSB0

  Then run this again.
EOF
        exit 1
    fi
    [ -e "$PORT" ] || die "$PORT does not exist."
    ok "Board on $PORT"
    if [ -e /dev/esp32 ]; then
        ok "udev rule matched (/dev/esp32 -> $PORT)"
    else
        warn "No /dev/esp32 symlink — unrecognised USB-serial chip, but $PORT works."
    fi
fi

run() {
    # --privileged is NOT used: only the one serial device is handed in.
    if [ -n "$PORT" ]; then
        docker run --rm $TTY --device "$PORT:$PORT" \
            -v "$FW":/project -v "$CACHE":/root/.platformio -w /project "$IMAGE" "$@"
    else
        docker run --rm $TTY \
            -v "$FW":/project -v "$CACHE":/root/.platformio -w /project "$IMAGE" "$@"
    fi
}
TTY=""
[ -t 0 ] && TTY="-it"

case "$MODE" in
  build)
    bold "Building"
    TTY="" run pio run
    ok "Built. Nothing was uploaded."
    ;;

  monitor)
    bold "Serial monitor on $PORT at $BAUD — Ctrl-C to stop"
    run pio device monitor --port "$PORT" --baud "$BAUD"
    ;;

  erase)
    bold "Erasing the flash on $PORT"
    warn "This wipes the whole chip. The firmware is re-uploaded straight after."
    TTY="" run pio run --target erase --upload-port "$PORT"
    bold "Uploading"
    TTY="" run pio run --target upload --upload-port "$PORT"
    ok "Erased and re-flashed."
    ;;

  flash)
    bold "Building"
    TTY="" run pio run

    bold "Uploading to $PORT"
    cat <<'EOF'
  If it stalls on "Connecting....", hold the BOOT button on the board and
  tap EN, then let go of BOOT. Most boards auto-reset and never need this.
EOF
    if ! TTY="" run pio run --target upload --upload-port "$PORT"; then
        bold "Upload failed"
        cat <<'EOF'
  The three causes, in the order they actually happen:

    1. A charge-only USB cable. Swap it before anything else.
    2. The board needs the BOOT button held — see above.
    3. The display's DC line on GPIO 2 holding the pin high at reset.
       Unplug DC, flash, plug it back in. The wiring guide covers this.
EOF
        exit 1
    fi
    ok "Uploaded."

    bold "Serial monitor — Ctrl-C to stop"
    cat <<'EOF'
  Expect, in order: Display ready / Buttons ready / RTC / card reader /
  Ethernet with an IP / then the portal. CLOCK IN should be highlighted
  green on the screen.
EOF
    run pio device monitor --port "$PORT" --baud "$BAUD"
    ;;
esac
