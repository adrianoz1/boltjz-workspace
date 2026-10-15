# narration

Acelera uma narração bruta e sobe o volume, preservando o tom. O áudio não sai da máquina.

O padrão é o do Bolt: `1.25x` e volume `2` (o dobro da amplitude, o aumento de 100%).

## Dependência

```bash
brew install ffmpeg
```

## Uso

```bash
./narration.sh narracao.wav
./narration.sh narracao.wav --speed 1.1 --volume 1.5 --format wav
./narration.sh narracao.wav --out ./edit/narracao.mp3
```

A saída padrão fica ao lado do original: `narracao.pace.mp3`. O bruto não é sobrescrito.

Sucesso imprime uma linha:

```text
OUTPUT=/caminho/absoluto/narracao.pace.mp3
```

`--speed` vai de `0.5` a `2`. `--volume` é um multiplicador maior que `0` e até `4`. `--format` aceita `mp3`, `wav` ou `m4a`.

Um limiter segura picos depois do ganho. `--no-limit` desliga isso.

## Verificação

```bash
./test.sh
```
