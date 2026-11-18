# ZIVO — regras de trabalho

## Gantt do projeto (obrigatório)
- Plano até à Play Store: https://claude.ai/artifact/MGKCPUcy4UJk2DsxWH9QGi (artefacto slug `a41a24c5-a1d5-4e5d-8b71-957bc682b5eb`).
- Fonte: `docs/zivo-gantt.html` neste repositório. Editar este ficheiro e republicar no mesmo artefacto (publish_files com slug, modo patch, `as: index.html`).
- Sempre que uma tarefa termina: atualizar o estado no Gantt (TASKS `st`, lista FEITO, % do projeto, data "Atualizado a"), republicar e avisar o Maurício: "Atualizei o Gantt".
- No fim de cada tarefa, dizer também a percentagem estimada do projeto.

## Conversa
- Responder em português. O Maurício testa na rua com o modo diagnóstico e envia ficheiros .json.
- Commits no main fazem deploy automático na Vercel (ridershield.vercel.app).
- Testes: `npm run test:nav`. Tipos: `npx tsc --noEmit -p .`.
