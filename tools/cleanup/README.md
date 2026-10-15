# cleanup

Corta pausas e frases repetidas de uma narração. O áudio de saída é a renderização de um JSON de cortes.

O silêncio fica na máquina, medido pelo ffmpeg. A repetição usa o `whisper-1` da OpenAI, porque é o modelo que devolve o tempo de cada palavra. A última tomada da frase permanece.

## Dependências

```bash
brew install ffmpeg
```

A chave da OpenAI vai em `OPENAI_API_KEY`. Sem repetição, ela não é usada.

## Uso

```bash
./cleanup.py narracao.pace.mp3
./cleanup.py narracao.pace.mp3 --silence-only
./cleanup.py narracao.pace.mp3 --repeats-only
```

A saída fica ao lado do arquivo: `narracao.clean.wav` e `narracao.cuts.json`. O bruto não é sobrescrito.

```text
OUTPUT=/caminho/absoluto/narracao.clean.wav
CUTS=/caminho/absoluto/narracao.cuts.json
```

Padrões: pausa abaixo de `-30` dB por pelo menos `0.35` s; repetição de pelo menos `4` palavras que reaparece em até `12` s. Cada corte deixa `0.08` s nas bordas.

## Verificação

```bash
./test.sh
```

O teste não chama a API.
