# narration

Leia isto antes de usar ou alterar a ferramenta.

## Quando usar

A narração bruta de um vídeo do Bolt precisa entrar no edit mais rápida e mais alta. O padrão já é esse: `1.25x` e volume `2`.

Não use para cortar, transcrever ou mudar o tom de propósito. A velocidade preserva o tom.

## Comando

Rode a partir de `tools/narration`:

```bash
./narration.sh <arquivo> [--speed 1.25] [--volume 2] [--format mp3] [--out caminho] [--no-limit]
```

- `--speed` de `0.5` a `2`. Fora disso o script recusa.
- `--volume` é multiplicador de amplitude, maior que `0` e até `4`. `2` dobra o volume.
- `--format` é `mp3`, `wav` ou `m4a`.
- `--out` escolhe o arquivo de saída. Sem ele, a saída é `<nome>.pace.<formato>` ao lado do original.
- `--no-limit` remove o limiter de pico. O padrão liga `alimiter` para o ganho não clipar.

## Sucesso

Exit code `0` e uma única linha em stdout:

```text
OUTPUT=/caminho/absoluto/arquivo.pace.mp3
```

O progresso vai para stderr. Leia o caminho só dessa linha.

## Não fazer

- Não sobrescrever o arquivo bruto. Se a saída for o mesmo caminho, o script sai com código `1`.
- Não commitar `*.pace.mp3`, `*.pace.wav` ou `*.pace.m4a`.
- Não pedir chave de API e não enviar o áudio para um serviço externo.

## Exit codes

- `0` áudio gerado
- `1` uso inválido ou arquivo sem áudio
- `2` `ffmpeg` ou `ffprobe` ausente
- `3` o ffmpeg falhou

## Como verificar

```bash
./test.sh
```

O teste gera um tom de 2 segundos, roda o padrão e confere duração perto de 1.6 segundos. Não precisa de uma narração real.
