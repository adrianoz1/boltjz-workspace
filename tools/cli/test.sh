#!/bin/bash
#
# Confere o help e um comando desconhecido, sem API e sem pull.

set -euo pipefail
export LC_ALL=C

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BOLTJZ="$SCRIPT_DIR/boltjz"

fail() {
    echo "Falha: $*" >&2
    exit 1
}

help_text="$("$BOLTJZ" help)"
for word in narration cleanup youtube reel upgrade; do
    printf '%s\n' "$help_text" | grep -q "$word" || fail "help sem $word"
done

empty_text="$("$BOLTJZ")"
printf '%s\n' "$empty_text" | grep -q "boltjz narration" || fail "sem argumento deveria mostrar o help"

set +e
"$BOLTJZ" nope >/dev/null 2>&1
unknown_code=$?
set -e
[ "$unknown_code" -eq 1 ] || fail "comando desconhecido deveria sair 1, saiu $unknown_code"

echo "ok"
