# Central Administrativa Novo Horizonte — primeira implementação

A Central passa a ter uma interface própria para consultar o Meus Controles e o
Controle de Contas (CONTAS 4), mas ainda não substitui suas telas de operação.
Esta etapa é intencionalmente somente leitura: sem alterar pagamentos,
recebimentos, PDFs, XML, R2, arquivos do Windows ou integração GFARM.

## Funcionalidades entregues

- Painel integrado responsivo, com cartões de contas, valor pendente e NF-e.
- Lista inicial de contas em aberto, incluindo identificação de vencidas.
- Lista inicial de NF-e recebidas, deduplicada quando há múltiplos produtos.
- Sugestões de vínculo entre conta e NF-e, por chave de 44 dígitos ou por
  número da nota junto de fornecedor equivalente; sempre exige conferência.
- Autenticação obrigatória por bearer token; nenhuma rota de escrita.
- Fonte fora do ar é mostrada como indisponível, nunca como saldo zero.
- Não expõe caminhos de documentos, códigos de pagamento nem PDFs no navegador.

## Requisitos e teste local

Python 3.12 ou superior e psycopg 3 para acesso PostgreSQL:

    python -m pip install "psycopg[binary]>=3.2,<4"
    python -m unittest tests.test_central_admin -v

Configurar em ambiente privado (NUNCA gravar senhas no GitHub):

    CENTRAL_TOKEN=<chave aleatoria de 32 ou mais caracteres>
    CENTRAL_CONTAS_DB=/CAMINHO/REAL/controle_contas.db
    CENTRAL_CONTROLES_DSN=postgresql://USUARIO_SOMENTE_LEITURA:SEGREDO@SERVIDOR_PRIVADO:5432/meus_controles

Iniciar:

    python -m central_admin.server

Abrir na própria máquina: http://127.0.0.1:18771

O caminho do SQLite deve apontar para o banco real em uso pelo CONTAS 4.
Conferir previamente a localização e o estado da migração: o repositório
também contém uma API preparatória com PostgreSQL, que não é necessariamente
o banco principal em produção.

Usar credencial PostgreSQL criada exclusivamente para SELECT nas tabelas
purchase_items e purchase_receipts. O servidor também inicia a transação
PostgreSQL em modo somente leitura. A montagem do SQLite deve ser read-only.

## Segurança para VPS

Por padrão o serviço aceita conexão somente em 127.0.0.1. Não disponibilizar
a porta 18771 publicamente. Em Docker, permitir bind interno em 0.0.0.0 somente
com CENTRAL_ALLOW_CONTAINER_BIND=1, publicando a porta do container apenas
em 127.0.0.1 do host e usando proxy HTTPS autenticado para acesso externo.
O token não é incluído no HTML nem persistido no navegador.

Não executar mudanças no Caddy/DNS antes de autenticar o acesso.
Os aplicativos Meus Controles, Contas, GFARM e Pluviômetros devem continuar
operando independentemente durante a homologação.

## Próximas etapas

1. Validar backups e o inventário real de bancos, volumes e documentos.
2. Criar cadastro mestre de fornecedores com IDs compartilhados e relações
   auditáveis entre contas, pedidos e notas.
3. Criar confirmação humana de vínculos, sem dupla contabilização.
4. Implementar integração de lançamentos e parcelas com idempotência.
5. Incorporar as telas originais (incluindo OCR, holerites, fretes, R2,
   comprovantes e XML) à navegação única sem regressões.
6. Homologar as operações e apenas depois direcionar os domínios ao novo app.

Este projeto é um início funcional da unificação, não a migração completa.
