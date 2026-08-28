# Fetch / Extract backend

`@alpha/fetch-extract-server` превръща публичен search result в bounded `EvidenceDocument` за VAP. Това е security boundary, а не общ URL proxy.

## Endpoint

`POST /api/fetch-extract`

Приема само:

- `sourceId`;
- `url`;
- `fetchToken`;
- `maxChars`.

`fetchToken` е краткоживеещ HMAC capability, издаден от search backend-а за точната двойка `sourceId + URL`. Endpoint-ът отхвърля произволни URL-и, history/messages/memory и всички неизвестни полета.

## SSRF policy

Преди мрежова заявка:

1. допуска само HTTP/HTTPS;
2. забранява URL credentials и нестандартни портове;
3. блокира localhost/internal/metadata hostnames;
4. резолва всички A/AAAA адреси;
5. блокира private, loopback, link-local, carrier-grade, documentation, multicast и други special ranges;
6. връзката се прави към вече валидирания IP, без второ DNS lookup;
7. redirect-ите не се следват автоматично — всеки hop се валидира и резолва наново;
8. HTTPS → HTTP downgrade е забранен.

## Content limits

- default remote body cap: 2 MiB;
- default per-hop timeout: 8 s;
- default overall timeout: 12 s;
- default redirect limit: 3;
- поддържани MIME types: `text/html`, `application/xhtml+xml`, `text/plain`;
- `Accept-Encoding: identity`; compressed/encoded bodies се отхвърлят;
- basic extraction премахва script/style/template/noscript/svg content;
- extracted text се ограничава до `maxChars`;
- evidence се маркира `untrusted: true` и получава SHA-256 `contentHash`.

## Local development

Default endpoint: `http://127.0.0.1:5175/api/fetch-extract`.

`START.bat` генерира временен `ALPHA_SOURCE_TOKEN_SECRET` и го подава едновременно на search и fetch процесите. При hosted deployment secret-ът трябва да е случаен server-side secret с поне 24 символа.

Този слой не изпълнява JavaScript от remote pages и не изпраща cookies, Authorization или потребителска история към source сайтове.
