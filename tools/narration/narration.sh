#!/bin/bash
#
# Acelera uma narração e sobe o volume, preservando o tom.
#
# Padrão do Bolt: 1.25x e o dobro da amplitude.
#
# Uso:
#   ./narration.sh <arquivo> [--speed 1.25] [--volume 2] [--format mp3|wav|m4a] [--out caminho] [--no-limit]
#
# Sucesso: exit 0 e uma linha stdout
#   OUTPUT=/caminho/absoluto/arquivo.pace.mp3
#
# Exit codes: 0 ok, 1 uso inválido, 2 dependência ausente, 3 ffmpeg falhou.

set -euo pipefail
export LC_ALL=C

readonly SCRIPT_NAME="$(basename "$0")"

SPEED="1.25"
VOLUME="2"
FORMAT="mp3"
OUT=""
NO_LIMIT=0
INPUT=""

die() {
    local code="$1"
    shift
    echo "Erro: $*" >&2
    exit "$code"
}

usage() {
    cat <<EOF
Acelera uma narração e sobe o volume, sem deixar a voz aguda.

Uso:
  $SCRIPT_NAME <arquivo> [opções]

Opções:
  --speed N     Velocidade de 0.5 a 2. Padrão: 1.25
  --volume N    Multiplicador de amplitude, maior que 0 e até 4. Padrão: 2
  --format FMT  mp3, wav ou m4a. Padrão: mp3
  --out CAMINHO Arquivo de saída. Padrão: ao lado do original, com sufixo .pace
  --no-limit    Não limita picos depois do ganho
  -h, --help    Mostra este contrato

O arquivo original não é sobrescrito.
Sucesso imprime uma única linha em stdout:
  OUTPUT=/caminho/absoluto/arquivo.pace.mp3

Exit codes: 0 ok, 1 uso inválido, 2 dependência ausente, 3 ffmpeg falhou.
EOF
}

is_number() {
    awk -v value="$1" 'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]+)?$/) }'
}

in_range() {
    awk -v value="$1" -v min="$2" -v max="$3" 'BEGIN { exit !(value >= min && value <= max) }'
}

abs_path() {
    local target="$1"
    local dir
    dir="$(cd "$(dirname "$target")" && pwd)"
    printf '%s/%s' "$dir" "$(basename "$target")"
}

require_value() {
    local flag="$1"
    if [ $# -lt 2 ] || [ -z "${2:-}" ] || [[ "$2" == --* ]]; then
        die 1 "A flag $flag precisa de um valor"
    fi
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --speed)
            require_value "$1" "${2:-}"
            SPEED="$2"
            shift 2
            ;;
        --volume)
            require_value "$1" "${2:-}"
            VOLUME="$2"
            shift 2
            ;;
        --format)
            require_value "$1" "${2:-}"
            FORMAT="$2"
            shift 2
            ;;
        --out)
            require_value "$1" "${2:-}"
            OUT="$2"
            shift 2
            ;;
        --no-limit)
            NO_LIMIT=1
            shift
            ;;
        --)
            shift
            break
            ;;
        -*)
            die 1 "Flag desconhecida: $1"
            ;;
        *)
            if [ -n "$INPUT" ]; then
                die 1 "Informe um único arquivo de áudio"
            fi
            INPUT="$1"
            shift
            ;;
    esac
done

if [ $# -gt 0 ]; then
    if [ -n "$INPUT" ]; then
        die 1 "Informe um único arquivo de áudio"
    fi
    INPUT="$1"
    if [ $# -gt 1 ]; then
        die 1 "Informe um único arquivo de áudio"
    fi
fi

if [ -z "$INPUT" ]; then
    usage >&2
    die 1 "Arquivo de áudio não informado"
fi

if ! is_number "$SPEED" || ! in_range "$SPEED" 0.5 2; then
    die 1 "Velocidade inválida: $SPEED. Use um número de 0.5 a 2"
fi

if ! is_number "$VOLUME" || ! in_range "$VOLUME" 0.01 4; then
    die 1 "Volume inválido: $VOLUME. Use um multiplicador maior que 0 e até 4"
fi

case "$FORMAT" in
    mp3|wav|m4a) ;;
    *) die 1 "Formato inválido: $FORMAT. Use mp3, wav ou m4a" ;;
esac

for cmd in ffmpeg ffprobe; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        die 2 "$cmd não encontrado. Instale com: brew install ffmpeg"
    fi
done

if [ ! -f "$INPUT" ]; then
    die 1 "Arquivo não encontrado: $INPUT"
fi

if ! ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$INPUT" | grep -q audio; then
    die 1 "O arquivo não tem faixa de áudio: $INPUT"
fi

if [ -n "$OUT" ]; then
    mkdir -p "$(dirname "$OUT")"
    OUTPUT_PATH="$OUT"
else
    stem="$(basename "$INPUT")"
    stem="${stem%.*}"
    OUTPUT_PATH="$(dirname "$INPUT")/${stem}.pace.${FORMAT}"
fi

input_abs="$(abs_path "$INPUT")"
output_abs="$(abs_path "$OUTPUT_PATH")"
if [ "$input_abs" = "$output_abs" ]; then
    die 1 "A saída não pode ser o arquivo original"
fi

filter="atempo=${SPEED},volume=${VOLUME}"
if [ "$NO_LIMIT" -eq 0 ]; then
    filter="${filter},alimiter=limit=0.95:level=0:asc=0"
fi

codec_args=()
case "$FORMAT" in
    mp3)
        codec_args=(-c:a libmp3lame -q:a 2)
        ;;
    wav)
        codec_args=(-c:a pcm_s16le)
        ;;
    m4a)
        codec_args=(-c:a aac -b:a 192k)
        ;;
esac

echo "Processando ${input_abs} a ${SPEED}x com volume ${VOLUME}" >&2

if ! ffmpeg -y -hide_banner -loglevel error \
    -i "$INPUT" \
    -filter:a "$filter" \
    -vn \
    "${codec_args[@]}" \
    "$output_abs"; then
    die 3 "ffmpeg não conseguiu processar o áudio"
fi

echo "OUTPUT=${output_abs}"
