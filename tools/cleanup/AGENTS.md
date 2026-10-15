# cleanup

Leia isto antes de usar ou alterar a ferramenta.

## Quando usar

A narração já passou pelo `narration.sh` e ainda tem pausa ou frase recomeçada. Esta ferramenta corta os dois e deixa a última tomada.

Não use para acelerar, mudar volume ou transcrever um Reel. Silêncio não usa modelo. Repetição usa só o `whisper-1` por causa do timestamp de cada palavra.

## Comando

Rode a partir de `tools/cleanup`:

```bash
./cleanup.py <arquivo> [--silence-db -30] [--silence-min 0.35] [--pad 0.08] [--repeat-words 4] [--repeat-window 12] [--silence-only] [--repeats-only] [--words arquivo.json] [--out caminho.wav]
```

- `--silence-only` não envia áudio para fora.
- `--repeats-only` não mexe em pausa.
- `--words` troca a API por um JSON com `[{"word","start","end"}]`. Serve para testar e para reaproveitar uma transcrição.
- Sem `--words`, a repetição exige `OPENAI_API_KEY` e envia o áudio ao `whisper-1` com `language=pt`.

## Sucesso

Exit code `0` e exatamente estas linhas em stdout:

```text
OUTPUT=/caminho/absoluto/arquivo.clean.wav
CUTS=/caminho/absoluto/arquivo.cuts.json
```

O progresso vai para stderr. O wav é a renderização de `cuts`. Cada item tem `kind` (`silence` ou `repetition`), `start`, `end` e `action: remove`. Repetição também tem `text` (o que saiu) e `kept` (o que ficou).

## Não fazer

- Não sobrescrever o arquivo de entrada.
- Não commitar `*.clean.wav` nem `*.cuts.json`.
- Não mandar o áudio para outro modelo. O contrato estável é o JSON, não o nome do transcritor.
- Não usar um modelo de chat para decidir o corte.

## Exit codes

- `0` áudio e JSON gerados
- `1` uso inválido ou arquivo sem áudio
- `2` `ffmpeg`, `ffprobe` ou `curl` ausente
- `3` o ffmpeg ou a API falhou

## Como verificar

```bash
./test.sh
```

O teste gera um tom com um segundo de silêncio no meio e uma lista falsa de palavras com a mesma frase duas vezes. Não precisa de chave nem de narração real.
