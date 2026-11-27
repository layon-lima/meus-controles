# CONTRATO DE PARIDADE FUNCIONAL — CENTRAL NOVO HORIZONTE

**Objetivo definitivo:** executar 100% das tarefas administrativas em uma única aplicação (frontend, autenticação, navegação, componentes e processos unificados), em uma única URL. Os aplicativos anteriores tornam-se apenas mecanismos de transição e **não** são atalhos permanentes.

**Proibido dar como concluído:** hub de links, iframes dos sites antigos, cards apenas informativos, duplicação de lançamentos, criação de um banco vazio ou recriação incompleta de formulários.

## Critério de aposentadoria
Os sites antigos serão redirecionados e os seus frontends aposentados **somente quando**:
- Todos os processos existentes puderem ser concluídos na Central, sem abrir outro domínio.
- Todos os lançamentos, documentos e históricos continuarem consultáveis; saldos e números reconciliados contra fontes originais.
- Os cadastros de fornecedores e documentos tiverem identidade compartilhada, sem exclusões/cópias destrutivas.
- XML/PDF, OCR, funcionários, holerites, exportações, vales, fretes, comissões, GFARM e R2/Windows estiverem testados ponta a ponta.
- Auditoria, idempotência, permissões e rollback funcionarem.
- O usuário aprovar visual e funcionalmente a nova Central após uso real.

## Inventário funcional obrigatório

| Domínio | Motor original | Funções que devem ser incorporadas ao frontend único | Estado na Central |
|---|---|---|---|
| Controles personalizados | meus-controles/app.py, control_types.py e static/ | pastas, modelos, fórmulas, cálculos, editar, duplicar, tipo, histórico, importação e exportação | **NÃO MIGRADO** |
| Recebimentos | receiving.py, receiving_import.py, receiving_xml.py, receiving_pdf.py, receiving_gfarm.py | pedidos, fornecedores, produtos, XML, PDFs, OCR/região, parcial, saldo, aprovação GFARM, Excel, agrupamento e conferência | **TELA NATIVA IMPLEMENTADA — HOMOLOGAÇÃO PENDENTE** |
| Transportadoras | truck.py, truck_workflow.py, vales.py | fretes, comissão, vales, fechamento, conferência, despesas, históricos e relatórios | **NÃO MIGRADO** |
| Contas a pagar | controle-de-contas/portable_app/server.py, app.js e index.html | cadastrar/editar, parcelas, vencer/pagar, enviar para pagamento, comprovantes, PDF, pesquisa, exportação, acesso desktop/mobile | **NÃO MIGRADO** |
| Funcionários / Holerites | controle-de-contas/portable_app/holerites.py | reconhecer pelo conteúdo do documento, cadastrar funcionário, PIX/chave e competência, vincular pagamentos | **NÃO MIGRADO** |
| Documentos | controle-de-contas/portable_app/pdf_*, ocr_*, r2_bridge.py, windows_reconcile.py | PDF, OCR, comprovantes, R2, Windows, reconciliação automática, leitura/mesclagem e trilha | **NÃO MIGRADO** |
| Vínculos compras × pagamentos | novo domínio compartilhado | fornecedor mestre, pedidos ↔ NF-e ↔ obrigações ↔ pagamentos, pagamentos parciais, auditoria e idempotência | **APENAS SUGESTÕES DE LEITURA** |
| Relatórios | reports_excel.py, pair_excel.py, excel_export.py | consultas e exportações operacionais/financeiras, CSV/XLSX | **NÃO MIGRADO** |

## Arquitetura-alvo
- **Uma SPA de produção**, um design system: cards iniciais sem menu lateral; navegação por páginas internas; campos, componentes, modais, tabelas, estados e atalhos com o mesmo padrão visual.
- **Uma API pública autenticada** por sessão/controle de acesso no servidor, nunca um token administrativo colado pelo usuário. Sem acesso anônimo a dados financeiros.
- **Motores preservados inicialmente** e executados por serviços internos ou bibliotecas por trás da nova API. A integração progressiva pode utilizar bancos distintos, desde que haja uma única fonte de verdade por entidade.
- **Sem iFrames ou atalhos para os sites antigos** no produto final; eles continuam em paralelo apenas durante a transição.
- **Um banco de vínculos** entre referências originais, com chaves imutáveis, detecção de duplicidade e logs de mudanças; depois consolidar apenas o que for justificado e seguro.
- **Agente Windows e R2** mantêm tratamento de documentos conforme as políticas vigentes; não inventar cópia permanente na VPS.
- **GFARM permanece isolado** e é acessado pela API autorizada de integração.

## Fases de implementação (cada uma só conclui com testes de paridade)

1. Inventário real, backups verificáveis, bases e rotas de produção e matriz de casos de uso.
2. Implementar shell SPA e biblioteca compartilhada de componentes; adicionar login/autorização invisível à interface quando possível, sem liberar dados financeiros anonimamente.
3. Migrar **completamente** Controles e Recebimentos para componentes da nova UI usando os motores existentes.
4. Migrar **completamente** Contas, pagamentos, comprovantes, documentos e funcionários, sem atalhos externos.
5. Unificar fornecedores, pedidos, NF-e e obrigações; habilitar vínculos confirmados e sincronização bidirecional sem duplicidade.
6. Migrar Transportadoras, conferências, relatórios e exportações pendentes; validar Windows/R2/GFARM.
7. Rodar testes de ponta a ponta, comparar saldos e históricos, fazer corte controlado com backups/rollback e redirecionar os domínios antigos.

## Estado atual real
A aplicação em /central/ é apenas um **protótipo de visualização**. Seu menu de cards e indicadores **não** satisfazem a entrega funcional e não autorizam aposentar os sistemas originais.

Na migração, funcionalidades só serão marcadas concluídas depois de entregar a mesma operação dentro da Central e aprovar testes com dados de homologação e dados de produção reconciliados.


## Início da migração real — Recebimentos (20/11/2026)

A rota /central/modules/recebimentos/ deixa de carregar static/index.html e static/app.js do Meus Controles. O servidor da Central entrega HTML próprio, CSS próprio e JavaScript próprio. Não há App.renderMain, iframe nem operações de DOM do aplicativo anterior nessa página.

No primeiro carregamento a tela já é Recebimentos; os dados são obtidos das APIs existentes e controles são filtrados por mode=recebimento. Não há flash de outra categoria. O frontend novo disponibiliza cadastro de pedidos, entregas parciais, NF-e com vários itens, PDF/OCR por região, XML, JSON, DANFE, GFARM por todos os itens da nota, importação, Excel e conferências.

A tela precisa ser homologada na VPS com casos reais, em especial NF-e fiscal, XML de várias linhas, PDF OCR, GFARM e histórico com dados fechados, antes de marcar paridade total. O backend antigo continua sendo fonte de verdade e não foi modificado.

Os demais módulos ainda usam o gateway legado e precisam passar pelo mesmo processo de reconstrução, não apenas estilização ou ocultação de telas iniciais.

**Regra incondicional:** Meus Controles e CONTAS 4 não podem ser aposentados, desativados ou redirecionados sem autorização explícita do usuário.
