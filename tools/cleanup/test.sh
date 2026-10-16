#!/bin/bash
#
# Confere corte de silêncio e de repetição sem chamar a API.

set -euo pipefail
export LC_ALL=C

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
    echo "Falha: $*" >&2
    exit 1
}

for cmd in ffmpeg ffprobe python3; do
    command -v "$cmd" >/dev/null 2>&1 || fail "$cmd não encontrado"
done

ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1" \
    -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=44100:duration=1" \
    -f lavfi -i "sine=frequency=660:sample_rate=44100:duration=1" \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1" \
    "$TMP_DIR/gap.wav"

silence_stdout="$("$SCRIPT_DIR/cleanup.py" "$TMP_DIR/gap.wav" --silence-only)"
silence_lines="$(printf '%s\n' "$silence_stdout" | sed '/^$/d' | wc -l | tr -d ' ')"
[ "$silence_lines" -eq 2 ] || fail "silêncio deveria imprimir 2 linhas: $silence_stdout"

silence_output="$(printf '%s\n' "$silence_stdout" | sed -n 's/^OUTPUT=//p')"
silence_cuts="$(printf '%s\n' "$silence_stdout" | sed -n 's/^CUTS=//p')"
[ -f "$silence_output" ] || fail "wav de silêncio não existe"
[ -f "$silence_cuts" ] || fail "json de silêncio não existe"
[ -f "$TMP_DIR/gap.wav" ] || fail "o arquivo original sumiu"

silence_duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$silence_output")"
awk -v duration="$silence_duration" 'BEGIN { exit !(duration > 1.9 && duration < 2.4) }' \
    || fail "duração depois do silêncio fora do esperado: $silence_duration"

python3 - "$silence_cuts" <<'PY' || fail "o json não registrou o silêncio do meio"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
cuts = [cut for cut in payload["cuts"] if cut["kind"] == "silence"]
assert cuts, payload
middle = [cut for cut in cuts if 0.9 <= cut["start"] <= 1.3 and 1.7 <= cut["end"] <= 2.2]
assert middle, cuts
assert all(cut["action"] == "remove" for cut in cuts)
PY

cat > "$TMP_DIR/words.json" <<'EOF'
[
  {"word": "eu", "start": 0.2, "end": 0.5},
  {"word": "vou", "start": 0.5, "end": 0.8},
  {"word": "falar", "start": 0.8, "end": 1.1},
  {"word": "sobre", "start": 1.1, "end": 1.4},
  {"word": "eu", "start": 3.0, "end": 3.3},
  {"word": "vou", "start": 3.3, "end": 3.6},
  {"word": "falar", "start": 3.6, "end": 3.9},
  {"word": "sobre", "start": 3.9, "end": 4.2}
]
EOF

ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=6" \
    -c:a pcm_s16le \
    "$TMP_DIR/retake.wav"

repeat_stdout="$("$SCRIPT_DIR/cleanup.py" "$TMP_DIR/retake.wav" --repeats-only --words "$TMP_DIR/words.json")"
repeat_output="$(printf '%s\n' "$repeat_stdout" | sed -n 's/^OUTPUT=//p')"
repeat_cuts="$(printf '%s\n' "$repeat_stdout" | sed -n 's/^CUTS=//p')"
[ -f "$repeat_output" ] || fail "wav de repetição não existe"

python3 - "$repeat_cuts" <<'PY' || fail "a primeira tomada não foi o corte mantido"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
cuts = [cut for cut in payload["cuts"] if cut["kind"] == "repetition"]
assert len(cuts) == 1, cuts
cut = cuts[0]
assert cut["text"] == "eu vou falar sobre", cut
assert cut["kept"] == "eu vou falar sobre", cut
assert cut["end"] < 2.0, cut
assert not any(item["start"] <= 3.2 <= item["end"] for item in cuts)
PY

ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=3" \
    -c:a pcm_s16le \
    "$TMP_DIR/apply.wav"

cat > "$TMP_DIR/apply.cuts.json" <<'EOF'
{"cuts":[{"kind":"silence","start":1.0,"end":2.0,"action":"remove"}]}
EOF

apply_stdout="$("$SCRIPT_DIR/cleanup.py" "$TMP_DIR/apply.wav" --apply-cuts "$TMP_DIR/apply.cuts.json")"
apply_output="$(printf '%s\n' "$apply_stdout" | sed -n 's/^OUTPUT=//p')"
[ -f "$apply_output" ] || fail "wav do apply-cuts não existe"
apply_duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$apply_output")"
awk -v duration="$apply_duration" 'BEGIN { exit !(duration > 1.8 && duration < 2.2) }' \
    || fail "apply-cuts não removeu o meio: $apply_duration"

"$SCRIPT_DIR/cleanup.py" --help >/dev/null

set +e
"$SCRIPT_DIR/cleanup.py" "$TMP_DIR/nao-existe.wav" --silence-only >/dev/null 2>&1
missing_code=$?
set -e
[ "$missing_code" -eq 1 ] || fail "arquivo ausente deveria sair 1, saiu $missing_code"

echo "ok silence=${silence_duration}s"
