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


## Preparação de container na VPS (ainda não executada)

Os arquivos em central_admin/deploy/Dockerfile e compose.yml permitem subir
um serviço separado em uma porta exclusiva de loopback da VPS (18771).
Não recriam o banco do Meus Controles nem o volume de Contas e não alteram o
proxy Caddy. O caminho de leitura do SQLite é
/opt/apps/contas-runtime/data/controle_contas.db, sujeito a confirmação
na máquina de produção. Se o diretório não existir, o Compose falha sem
criar uma pasta vazia.

O serviço participa somente da rede privada PostgreSQL do Meus Controles.
Antes de iniciar, criar um usuário de banco exclusivo com permissões apenas
de leitura nas tabelas purchase_items e purchase_receipts e inserir as
credenciais geradas em central_admin/deploy/.env.production (chmod 600).
O arquivo .env.example contém propositalmente uma chave inválida: o servidor
não deve iniciar enquanto a chave real não for criada.

A configuração pode ser validada com:

    docker compose -f central_admin/deploy/compose.yml config --quiet

Não executar docker compose up em produção antes de inventariar as fontes,
validar permissões, confirmar o banco principal do CONTAS 4 e executar os
testes de homologação com dados fictícios. A porta 18771 não deve ser
publicada diretamente na internet.


## Atualização da interface (19/11/2026)

A tela inicial agora usa **oito cards de módulos, sem menu lateral**.
Contas, recebimentos e sugestões de vínculos consultam os bancos automaticamente;
os outros cards abrem as funções já existentes dos aplicativos originais, sem
migrações nem recriação das rotinas de OCR, holerites, PDF, XML ou GFARM.

Não há mais campo para colar uma chave no navegador. Para atualizar
uma Central já instalada na VPS, como root:

    curl -fsSL "https://raw.githubusercontent.com/layon-lima/meus-controles/feature/central-administrativa-v1/central_admin/deploy/ATUALIZAR_VPS.sh" -o /root/ATUALIZAR_CENTRAL_VPS.sh && bash /root/ATUALIZAR_CENTRAL_VPS.sh

O atualizador confere os bancos, preserva .env.production e o Caddy,
reconstrói **somente** o container da Central e verifica a API.
Se falhar, tenta restaurar o código anterior.

**AVISO DE PRIVACIDADE IMPORTANTE**: a opção CENTRAL_PUBLIC_READ=1
retira a autenticação da API de consulta. Enquanto a rota /central/
estiver publicada sem proteção no Caddy/Cloudflare Access, **qualquer pessoa
com o link pode consultar os valores, nomes de fornecedores e informações
que esse painel disponibiliza**. Não usar essa configuração em produção
para dados financeiros sensíveis sem restringir o acesso externo por
Cloudflare Access ou autenticação equivalente.

O modo sem chave não autoriza cadastrar, pagar, editar, remover documentos
nem alterar notas: a API continua estritamente somente leitura.

Este avanço não conclui a unificação operacional. A incorporação das telas
de manutenção e os vínculos financeiros persistentes ainda exigem
implementação e homologação.
