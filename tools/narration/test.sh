#!/bin/bash
#
# Gera um tom de 2s, aplica o padrão da ferramenta e confere a duração.

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

for cmd in ffmpeg ffprobe; do
    command -v "$cmd" >/dev/null 2>&1 || fail "$cmd não encontrado"
done

ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=440:duration=2" \
    -c:a pcm_s16le \
    "$TMP_DIR/tone.wav"

stdout="$("$SCRIPT_DIR/narration.sh" "$TMP_DIR/tone.wav")"
line_count="$(printf '%s\n' "$stdout" | sed '/^$/d' | wc -l | tr -d ' ')"
[ "$line_count" -eq 1 ] || fail "stdout deveria ter uma linha, veio: $stdout"

case "$stdout" in
    OUTPUT=*) ;;
    *) fail "stdout sem OUTPUT=: $stdout" ;;
esac

output_path="${stdout#OUTPUT=}"
[ -f "$output_path" ] || fail "saída não existe: $output_path"
[ -f "$TMP_DIR/tone.wav" ] || fail "o arquivo original sumiu"

duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$output_path")"
awk -v duration="$duration" 'BEGIN { exit !(duration > 1.45 && duration < 1.85) }' \
    || fail "duração fora do esperado para 1.25x: $duration"

"$SCRIPT_DIR/narration.sh" --help >/dev/null

set +e
"$SCRIPT_DIR/narration.sh" "$TMP_DIR/tone.wav" --speed 3 >/dev/null 2>&1
speed_code=$?
"$SCRIPT_DIR/narration.sh" "$TMP_DIR/tone.wav" --volume 8 >/dev/null 2>&1
volume_code=$?
set -e

[ "$speed_code" -eq 1 ] || fail "velocidade inválida deveria sair 1, saiu $speed_code"
[ "$volume_code" -eq 1 ] || fail "volume inválido deveria sair 1, saiu $volume_code"

echo "ok ${output_path} (${duration}s)"
