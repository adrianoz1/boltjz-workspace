# boltjz

Monorepo das ferramentas usadas para produzir o conteúdo do canal Bolt. O uso inicial é pessoal.

## Ferramentas

| Pasta | O que faz | Comando |
| --- | --- | --- |
| `tools/transcribe/` | Transcreve o roteiro de um Reel ou de um vídeo do YouTube | `./transcribe_reel.sh`, `./transcribe_youtube.sh` |
| `tools/narration/` | Acelera a narração e sobe o volume. Padrão do Bolt: 1.25x e volume 2 | `./narration.sh narracao.wav` |
| `tools/cleanup/` | Corta pausas e frases repetidas. A última tomada fica | `./cleanup.py narracao.pace.mp3` |

A narração de um vídeo segue esta ordem: arquivo bruto, `narration`, `cleanup`. A transcrição de Reel e YouTube é um fluxo à parte.

Cada ferramenta imprime o resultado em stdout para um agente ler sem interpretar o log. `narration` termina com `OUTPUT=`. `cleanup` termina com `OUTPUT=` e `CUTS=`. O contrato de cada uma está no `AGENTS.md` da pasta.

## Onde colocar cada coisa

| Pasta | O que entra |
| --- | --- |
| `tools/` | Ferramentas locais. Cada uma na própria pasta |
| `apps/` | Plataformas web, quando existirem |
| `packages/` | Código compartilhado, só quando duas ferramentas precisarem dele |

As ferramentas atuais são scripts. Não têm `package.json`.

## Dependências

```bash
brew install ffmpeg yt-dlp jq
```

`OPENAI_API_KEY` entra na transcrição e no corte de repetições. Acelerar a narração e cortar silêncio não usam chave.
