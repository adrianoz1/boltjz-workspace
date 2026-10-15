# boltjz

Monorepo das ferramentas e plataformas usadas para produzir o conteúdo do canal Bolt.

O uso inicial é pessoal. Um projeto pode continuar interno ou virar produto para outras pessoas.

## Onde colocar cada coisa

| Pasta | O que entra | Exemplo |
| --- | --- | --- |
| `apps/` | Plataformas web, com interface | editor, dashboard, site |
| `tools/` | Ferramentas locais e scripts de produção | `transcribe/` |
| `packages/` | Código compartilhado entre apps e tools | tipos, cliente de API, utilitários |

Cada projeto fica na própria pasta, com o próprio `package.json`. Só extraia código para `packages/` quando dois projetos realmente precisarem dele.

## Começar um projeto

```bash
pnpm create <template> apps/nome-da-plataforma
pnpm create <template> tools/nome-da-ferramenta
```

O workspace já inclui `apps/*`, `tools/*` e `packages/*`.
