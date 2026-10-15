# boltjz

Leia isto antes de chamar uma ferramenta do Bolt.

## Quando usar

Use `boltjz` para acelerar narração, cortar pausa e repetição, ou transcrever YouTube e Reel. Não chame os scripts direto, a menos que esteja depurando um deles.

## Comandos

```bash
boltjz help
boltjz upgrade
boltjz narration <arquivo> [opções de narration.sh]
boltjz cleanup <arquivo> [opções de cleanup.py]
boltjz youtube <url>
boltjz reel <url>
```

O que vem depois do arquivo ou da URL é repassado. O stdout e o exit code são os da ferramenta.

Antes de interpretar o resultado, leia o `AGENTS.md` do comando:

- `narration` imprime `OUTPUT=`
- `cleanup` imprime `OUTPUT=` e `CUTS=`
- `youtube` e `reel` gravam `roteiro.txt` e `transcript.json` numa pasta datada

## Upgrade

`boltjz upgrade` compara o `VERSION` local com o do `main`. Se o remoto for mais novo e não houver alteração local, faz `git pull --ff-only`. Não rode upgrade no meio de uma edição.

## Não fazer

- Não reimplementar o áudio nem a transcrição neste comando.
- Não fazer pull se `git status` mostrar alteração.
