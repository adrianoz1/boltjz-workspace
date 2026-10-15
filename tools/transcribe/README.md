# transcribe

Transcreve o roteiro falado de um Reel do Instagram ou de um vídeo do YouTube.

Baixa o áudio com `yt-dlp`, extrai com `ffmpeg` e envia para a Whisper API. O texto contínuo fica em `roteiro.txt`. Os timestamps ficam em `transcript.json`.

Vídeos longos do YouTube são divididos em partes de 10 minutos para caber no limite de 25 MB da API.

## Dependências

```bash
brew install yt-dlp ffmpeg jq
```

A chave da OpenAI vai em `OPENAI_API_KEY`, ou como segundo argumento.

## Uso

```bash
./transcribe_reel.sh "https://www.instagram.com/reel/CODIGO/"
./transcribe_youtube.sh "https://www.youtube.com/watch?v=VIDEO_ID"
```

Cada execução cria uma pasta ao lado dos scripts: `reel_transcription_YYYYMMDD_HHMMSS` ou `youtube_transcription_YYYYMMDD_HHMMSS`.

## Cookies e proxy

O Instagram exige sessão logada. O YouTube também, quando o download é bloqueado.

Se existir `cookies.txt` nesta pasta, os scripts usam esse arquivo. Sem ele, usam os cookies do Chrome. Outro navegador:

```bash
export YT_DLP_COOKIES_BROWSER=firefox
```

`proxies.txt` é opcional. Uma URL de proxy por linha. Linhas com `#` são ignoradas.
