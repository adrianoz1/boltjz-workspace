#!/usr/bin/env python3
"""Corta silêncios e repetições de uma narração.

Silêncio é local, via ffmpeg. Repetição usa os timestamps por palavra do
whisper-1 e fica com a última tomada. O áudio final é só a renderização
do JSON de cortes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["LC_ALL"] = "C"

WHISPER_MAX_BYTES = 24 * 1024 * 1024
CHUNK_SECONDS = 600


def die(code: int, message: str) -> None:
    print(f"Erro: {message}", file=sys.stderr)
    raise SystemExit(code)


def usage() -> str:
    return """Detecta e corta silêncio de uma narração. O padrão não procura repetição.

Uso:
  cleanup.py <arquivo> [opções]

Opções:
  --silence-db N      Limiar em dB. Padrão: -30
  --silence-min N     Pausa mínima em segundos. Padrão: 0.35
  --pad N             Folga, em segundos, que cada corte deixa nas bordas. Padrão: 0.08
  --repeat-words N    Palavras mínimas de uma repetição. Padrão: 4
  --repeat-window N   Janela, em segundos, para a frase reaparecer. Padrão: 12
  --silence-only      Só corta silêncio, sem chamar a API
  --repeats-only      Só corta repetição
  --words ARQUIVO     Usa esta lista de palavras em vez do whisper-1
  --apply-cuts ARQUIVO  Renderiza este JSON, sem detectar de novo
  --out CAMINHO       Arquivo wav de saída
  -h, --help          Mostra este contrato

A última tomada de uma frase repetida permanece. O original não é sobrescrito.
Sucesso imprime duas linhas em stdout:
  OUTPUT=/caminho/absoluto/arquivo.clean.wav
  CUTS=/caminho/absoluto/arquivo.cuts.json

A repetição envia o áudio para a API da OpenAI (whisper-1, language=pt).
Exit codes: 0 ok, 1 uso inválido, 2 dependência ausente, 3 ffmpeg ou API falhou.
"""


def require_commands(names: list[str]) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        die(2, f"{', '.join(missing)} não encontrado. Instale com: brew install ffmpeg")


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, check=False, text=True, capture_output=True)
    except OSError as exc:
        die(3, str(exc))


def probe_duration(path: Path) -> float:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ]
    )
    if result.returncode != 0 or not result.stdout.strip():
        die(3, "ffprobe não leu a duração do áudio")
    return float(result.stdout.strip())


def has_audio(path: Path) -> bool:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(path),
        ]
    )
    return result.returncode == 0 and "audio" in result.stdout


def abs_path(path: Path) -> Path:
    return path.expanduser().resolve()


def round_time(value: float) -> float:
    return round(value, 3)


def inset(start: float, end: float, pad: float) -> tuple[float, float] | None:
    kept_start = start + pad
    kept_end = end - pad
    if kept_end - kept_start >= 0.05:
        return kept_start, kept_end
    if end - start >= 0.05:
        return start, end
    return None


def remove_cut(kind: str, start: float, end: float, text: str = "", kept: str = "") -> dict:
    cut = {
        "kind": kind,
        "start": round_time(start),
        "end": round_time(end),
        "action": "remove",
    }
    if kind == "repetition":
        cut["text"] = text
        cut["kept"] = kept
    return cut


def silence_cuts(path: Path, db: float, minimum: float, pad: float, duration: float) -> list[dict]:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise={db}dB:d={minimum}",
            "-f",
            "null",
            "-",
        ]
    )
    if result.returncode != 0:
        die(3, "ffmpeg não conseguiu detectar silêncio")

    cuts = []
    pending = None
    for line in result.stderr.splitlines():
        if "silence_start:" in line:
            pending = float(line.split("silence_start:", 1)[1].split()[0])
        elif "silence_end:" in line and pending is not None:
            end = float(line.split("silence_end:", 1)[1].split()[0])
            span = inset(pending, end, pad)
            pending = None
            if span is None:
                continue
            cuts.append(remove_cut("silence", span[0], span[1]))
    if pending is not None:
        span = inset(pending, duration, pad)
        if span is not None:
            cuts.append(remove_cut("silence", span[0], span[1]))
    return cuts


def normalize(word: str) -> str:
    cleaned = word.strip().lower()
    return re.sub(r"^[^\w]+|[^\w]+$", "", cleaned, flags=re.UNICODE)


def load_words(path: Path) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        die(1, f"Não li a lista de palavras: {exc}")
    if isinstance(payload, dict):
        payload = payload.get("words", [])
    if not isinstance(payload, list):
        die(1, "A lista de palavras precisa ser um array JSON")
    words = []
    for item in payload:
        if not isinstance(item, dict) or "word" not in item:
            continue
        words.append(
            {
                "word": str(item["word"]).strip(),
                "start": float(item.get("start", 0)),
                "end": float(item.get("end", 0)),
            }
        )
    words.sort(key=lambda item: item["start"])
    return words


def phrase_text(tokens: list[dict]) -> str:
    return " ".join(token["word"] for token in tokens if token["word"])


def find_repetitions(words: list[dict], min_words: int, window: float, pad: float) -> list[dict]:
    tokens = []
    for word in words:
        token = normalize(word["word"])
        if not token:
            continue
        tokens.append({**word, "norm": token})

    removed = [False] * len(tokens)
    cuts = []
    limit = len(tokens)

    index = 0
    while index < limit:
        if removed[index]:
            index += 1
            continue
        matched = None
        longest = min(12, limit - index)
        for length in range(longest, min_words - 1, -1):
            if any(removed[index + offset] for offset in range(length)):
                continue
            phrase = tuple(tokens[index + offset]["norm"] for offset in range(length))
            first_end = tokens[index + length - 1]["end"]
            for later in range(index + length, limit - length + 1):
                if tokens[later]["start"] - tokens[index]["start"] > window:
                    break
                if tokens[later]["start"] < first_end - 0.05:
                    continue
                if any(removed[later + offset] for offset in range(length)):
                    continue
                candidate = tuple(tokens[later + offset]["norm"] for offset in range(length))
                if candidate == phrase:
                    matched = (length, later)
                    break
            if matched:
                break
        if not matched:
            index += 1
            continue
        length, later = matched
        span = inset(tokens[index]["start"], tokens[index + length - 1]["end"], pad)
        earlier = tokens[index : index + length]
        kept = tokens[later : later + length]
        for offset in range(length):
            removed[index + offset] = True
        if span is not None:
            cuts.append(remove_cut("repetition", span[0], span[1], phrase_text(earlier), phrase_text(kept)))
        index += length

    index = 0
    while index < limit - 1:
        if removed[index] or tokens[index]["norm"] != tokens[index + 1]["norm"]:
            index += 1
            continue
        last = index
        while last + 1 < limit and tokens[last + 1]["norm"] == tokens[index]["norm"] and not removed[last + 1]:
            last += 1
        if last == index:
            index += 1
            continue
        span = inset(tokens[index]["start"], tokens[last - 1]["end"], pad)
        repeated = tokens[index:last]
        for cursor in range(index, last):
            removed[cursor] = True
        if span is not None:
            cuts.append(
                remove_cut(
                    "repetition",
                    span[0],
                    span[1],
                    phrase_text(repeated[:-1]),
                    repeated[-1]["word"],
                )
            )
        index = last + 1
    return cuts


def request_words(path: Path, api_key: str, offset: float) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="cleanup-whisper-") as directory:
        destination = Path(directory) / "transcript.json"
        result = run(
            [
                "curl",
                "-sS",
                "-f",
                "https://api.openai.com/v1/audio/transcriptions",
                "-H",
                f"Authorization: Bearer {api_key}",
                "-F",
                f"file=@{path}",
                "-F",
                "model=whisper-1",
                "-F",
                "response_format=verbose_json",
                "-F",
                "timestamp_granularities[]=word",
                "-F",
                "language=pt",
                "-o",
                str(destination),
            ]
        )
        if result.returncode != 0 or not destination.exists():
            die(3, "A API do whisper-1 não transcreveu o áudio")
        try:
            payload = json.loads(destination.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            die(3, "A API devolveu uma transcrição inválida")
    words = []
    for item in payload.get("words") or []:
        if "word" not in item:
            continue
        words.append(
            {
                "word": str(item["word"]).strip(),
                "start": float(item.get("start", 0)) + offset,
                "end": float(item.get("end", 0)) + offset,
            }
        )
    return words


def transcribe(path: Path, api_key: str) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="cleanup-audio-") as directory:
        work = Path(directory)
        source = path
        if source.stat().st_size > WHISPER_MAX_BYTES:
            compact = work / "compact.mp3"
            result = run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(source),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-b:a",
                    "64k",
                    str(compact),
                ]
            )
            if result.returncode != 0:
                die(3, "ffmpeg não conseguiu compactar o áudio para a API")
            source = compact
        if source.stat().st_size <= WHISPER_MAX_BYTES:
            return request_words(source, api_key, 0)

        pattern = str(work / "part_%03d.mp3")
        result = run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-f",
                "segment",
                "-segment_time",
                str(CHUNK_SECONDS),
                "-reset_timestamps",
                "1",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                "64k",
                pattern,
            ]
        )
        if result.returncode != 0:
            die(3, "ffmpeg não conseguiu dividir o áudio")
        words = []
        offset = 0.0
        for part in sorted(work.glob("part_*.mp3")):
            print(f"Transcrevendo {part.name}", file=sys.stderr)
            words.extend(request_words(part, api_key, offset))
            offset += probe_duration(part)
        return words


def keep_ranges(duration: float, cuts: list[dict]) -> list[tuple[float, float]]:
    removes = sorted((cut["start"], cut["end"]) for cut in cuts if cut["end"] > cut["start"])
    merged: list[list[float]] = []
    for start, end in removes:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)

    keeps = []
    cursor = 0.0
    for start, end in merged:
        if start - cursor > 0.01:
            keeps.append((cursor, start))
        cursor = max(cursor, end)
    if duration - cursor > 0.01:
        keeps.append((cursor, duration))
    return keeps


def render(source: Path, destination: Path, keeps: list[tuple[float, float]]) -> None:
    if not keeps:
        die(1, "Os cortes removeriam o áudio inteiro")
    filters = []
    labels = []
    for index, (start, end) in enumerate(keeps):
        filters.append(f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{index}]")
        labels.append(f"[a{index}]")
    filters.append(f"{''.join(labels)}concat=n={len(keeps)}:v=0:a=1[out]")
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[out]",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
    )
    if result.returncode != 0 or not destination.exists():
        detail = result.stderr.strip().splitlines()
        message = detail[-1] if detail else "ffmpeg não renderizou o áudio"
        die(3, message)


def apply_edited_cuts(source: Path, cuts_file: Path, explicit_out: str | None) -> None:
    try:
        payload = json.loads(cuts_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        die(1, f"Não li os cortes: {exc}")
    raw = payload.get("cuts") if isinstance(payload, dict) else payload
    if not isinstance(raw, list):
        die(1, "O JSON precisa ter uma lista cuts")

    cuts = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("action", "remove") != "remove":
            continue
        start = float(item["start"])
        end = float(item["end"])
        if end <= start:
            continue
        kind = item.get("kind", "silence")
        if kind not in ("silence", "repetition"):
            kind = "silence"
        cuts.append(remove_cut(kind, start, end, str(item.get("text", "")), str(item.get("kept", ""))))
    cuts.sort(key=lambda cut: (cut["start"], cut["end"]))

    wav_path, _default_cuts = output_paths(source, explicit_out)
    if wav_path == source or cuts_file.resolve() == source:
        die(1, "A saída não pode ser o arquivo original")
    keeps = keep_ranges(probe_duration(source), cuts)
    print(f"Renderizando {len(keeps)} trechos a partir dos cortes editados", file=sys.stderr)
    render(source, wav_path, keeps)
    updated = {"input": str(source), "output": str(wav_path), "cuts": cuts}
    cuts_file.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OUTPUT={wav_path}")
    print(f"CUTS={cuts_file.resolve()}")


def output_paths(source: Path, explicit: str | None) -> tuple[Path, Path]:
    if explicit:
        wav = abs_path(Path(explicit))
        if wav.name.endswith(".clean.wav"):
            cuts = wav.with_name(wav.name[: -len(".clean.wav")] + ".cuts.json")
        else:
            cuts = wav.with_suffix(".cuts.json")
        return wav, cuts
    return source.with_name(f"{source.stem}.clean.wav"), source.with_name(f"{source.stem}.cuts.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cleanup.py", add_help=False)
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--silence-db", type=float, default=-30)
    parser.add_argument("--silence-min", type=float, default=0.35)
    parser.add_argument("--pad", type=float, default=0.08)
    parser.add_argument("--repeat-words", type=int, default=4)
    parser.add_argument("--repeat-window", type=float, default=12)
    parser.add_argument("--silence-only", action="store_true")
    parser.add_argument("--repeats-only", action="store_true")
    parser.add_argument("--words")
    parser.add_argument("--apply-cuts")
    parser.add_argument("--out")
    parser.add_argument("-h", "--help", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.help:
        print(usage(), end="")
        raise SystemExit(0)
    if not args.audio:
        print(usage(), file=sys.stderr, end="")
        die(1, "Arquivo de áudio não informado")
    if args.silence_min <= 0 or args.pad < 0 or args.repeat_words < 1 or args.repeat_window <= 0:
        die(1, "Os limites de silêncio e repetição precisam ser positivos")

    source = abs_path(Path(args.audio))
    if not source.is_file():
        die(1, f"Arquivo não encontrado: {source}")

    if args.apply_cuts:
        require_commands(["ffmpeg", "ffprobe"])
        if not has_audio(source):
            die(1, f"O arquivo não tem faixa de áudio: {source}")
        apply_edited_cuts(source, abs_path(Path(args.apply_cuts)), args.out)
        return

    do_repeats = args.repeats_only and not args.silence_only
    do_silence = not do_repeats
    commands = ["ffmpeg", "ffprobe"]
    if do_repeats and not args.words:
        commands.append("curl")
    require_commands(commands)
    if not has_audio(source):
        die(1, f"O arquivo não tem faixa de áudio: {source}")

    wav_path, cuts_path = output_paths(source, args.out)
    if wav_path == source or cuts_path == source:
        die(1, "A saída não pode ser o arquivo original")

    duration = probe_duration(source)
    cuts: list[dict] = []
    if do_silence:
        print(f"Procurando silêncio em {source}", file=sys.stderr)
        cuts.extend(silence_cuts(source, args.silence_db, args.silence_min, args.pad, duration))
    if do_repeats:
        if args.words:
            words = load_words(abs_path(Path(args.words)))
        else:
            api_key = os.environ.get("OPENAI_API_KEY", "")
            if not api_key:
                die(1, "OPENAI_API_KEY não encontrada")
            print("Transcrevendo com whisper-1", file=sys.stderr)
            words = transcribe(source, api_key)
        print(f"Procurando repetições em {len(words)} palavras", file=sys.stderr)
        cuts.extend(find_repetitions(words, args.repeat_words, args.repeat_window, args.pad))

    cuts.sort(key=lambda cut: (cut["start"], cut["end"]))
    keeps = keep_ranges(duration, cuts)
    print(f"Renderizando {len(keeps)} trechos", file=sys.stderr)
    render(source, wav_path, keeps)

    payload = {"input": str(source), "output": str(wav_path), "cuts": cuts}
    cuts_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OUTPUT={wav_path}")
    print(f"CUTS={cuts_path}")


if __name__ == "__main__":
    main()
