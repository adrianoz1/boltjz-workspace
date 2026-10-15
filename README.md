# boltjz

Monorepo das ferramentas usadas para produzir o conteúdo do canal Bolt. O uso inicial é pessoal.

O comando é o `boltjz`. Ele não processa o áudio sozinho: encaminha para a ferramenta certa e devolve a saída dela.

## Instalar

Na raiz deste repositório, com `~/.local/bin` no `PATH`:

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/tools/cli/boltjz" ~/.local/bin/boltjz
boltjz -v
```

A versão local fica no arquivo `VERSION`.

Dependências:

```bash
brew install ffmpeg yt-dlp jq
```

`OPENAI_API_KEY` entra na transcrição e no corte de repetições. Acelerar a narração e cortar silêncio não usam chave.

## Comandos

```bash
boltjz help
boltjz -v
boltjz upgrade
boltjz narration narracao.wav
boltjz cleanup narracao.pace.mp3
boltjz youtube "https://www.youtube.com/watch?v=VIDEO_ID"
boltjz reel "https://www.instagram.com/reel/CODIGO/"
```

Sem argumento, `boltjz` mostra o help. Opções depois do arquivo ou da URL seguem para a ferramenta. Exemplos: `boltjz narration narracao.wav --speed 1.1` e `boltjz cleanup narracao.pace.mp3 --silence-only`.

`boltjz upgrade` compara o `VERSION` local com o do `main`. Se a versão publicada for mais nova e não houver alteração local, atualiza o repositório com fast-forward.

## Narração de um vídeo

A ordem é arquivo bruto, acelerar, cortar.

```bash
boltjz narration narracao.wav
boltjz cleanup narracao.pace.mp3
```

`narration` acelera a 1.25x, dobra o volume e preserva o tom. A última linha é `OUTPUT=` com o caminho do mp3, ao lado do original (`narracao.pace.mp3`).

`cleanup` corta pausas e frases repetidas e fica com a última tomada. As últimas linhas são `OUTPUT=` (o wav) e `CUTS=` (o JSON dos cortes).

## Transcrição

YouTube e Reel são um fluxo à parte. Cada execução cria uma pasta datada com `roteiro.txt` e `transcript.json`.

```bash
boltjz youtube "https://www.youtube.com/watch?v=VIDEO_ID"
boltjz reel "https://www.instagram.com/reel/CODIGO/"
```

O Reel exige sessão logada no Instagram. O detalhe de cookies está em `tools/transcribe/README.md`.

## Onde está cada ferramenta

| Pasta | O que faz |
| --- | --- |
| `tools/cli/` | O comando `boltjz` |
| `tools/narration/` | Acelera e sobe o volume |
| `tools/cleanup/` | Corta silêncio e repetição |
| `tools/transcribe/` | Transcreve YouTube e Reel |
| `apps/` | Plataformas web, quando existirem |
| `packages/` | Código compartilhado, só quando duas ferramentas precisarem dele |

O contrato que um agente deve ler está no `AGENTS.md` de cada pasta.
