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


## Etapa operacional unificada — gateway sem iframe (novembro/2026)

Implementação em homologação: as rotas /central/modules/controles/,
recebimentos/, transportadoras/, contas/, funcionarios/, documentos/ e
relatorios/ passam pela própria Central, sob **uma origem HTTPS e uma
barra de navegação comum**, usando os motores web que já operam na VPS.

O gateway não abre o domínio antigo e não usa iframe. Ele reescreve os
caminhos de assets/API para os prefixos internos e preserva os formulários,
endpoints, downloads, pagamentos e métodos HTTP das aplicações originais.
A nova folha de estilo normaliza cartões, fontes, menus e botões. A
reescrita completa de cada tela em componentes nativos do design system
ainda é uma fase posterior: não declarar paridade visual total prematuramente.

### Segurança

A API operacional e o painel financeiro exigem uma **sessão assinada
HttpOnly, SameSite=Strict, Secure**, com expiração de 90 dias. A ativação
gera uma URL de pareamento cujo segredo está no fragmento # (não enviado
em GET), que deve ser aberta uma vez no navegador autorizado.
Não há formulário para colar chave no aplicativo. Solicitações de escrita
exigem Origin exato e passam pelas regras de autenticação/validação
dos motores originais.

O modo legado CENTRAL_PUBLIC_READ=1 não concede mais leitura financeira.
Novos segredos de sessão são gerados na VPS, mantidos exclusivamente em
.env.production (chmod 600) e preservados nas atualizações seguintes.

### Atualização da VPS existente

No terminal Ubuntu da VPS, como root:

    curl -fsSL 'https://raw.githubusercontent.com/layon-lima/meus-controles/feature/central-administrativa-v1/central_admin/deploy/ATUALIZAR_VPS.sh' -o /root/ATUALIZAR_CENTRAL_VPS.sh && bash /root/ATUALIZAR_CENTRAL_VPS.sh

O script verifica o contêiner web original do Contas, o Meus Controles,
o banco do Contas, as redes privadas, a sessão e as páginas operacionais.
Reinicia **somente o contêiner da Central** e tenta restaurar sua versão
anterior em caso de erro. Não redireciona, desativa nem atualiza aplicativos
originais. Não altera DNS, Caddy, R2, PDFs ou bancos.

Depois da publicação, no terminal da VPS:

    cat /root/CENTRAL_NH_PRIMEIRO_ACESSO.txt

Abra a URL privada mostrada uma única vez no seu navegador. Depois
acesse normalmente /central/, sem repetir o vínculo enquanto a sessão
estiver válida. Não compartilhe o link de pareamento, pois autoriza
acesso financeiro.

### Limites e regra de aposentadoria

- Os motores antigos ainda são dependências operacionais da Central; ela
  **não** funciona quando um desses serviços estiver fora do ar.
- A integração de fornecedores/obrigações e a unificação profunda do UI
  ainda estão pendentes. Esta é uma entrega operacional intermediária.
- **É proibido desativar, redirecionar ou remover Meus Controles e CONTAS 4
  sem autorização explícita do usuário, mesmo após concluir os testes.**


## Menu Iniciar Liquid Glass (correção da navegação)

A implementação anterior tentava abrir uma segunda cópia do painel inicial em
tela cheia dentro da página atual. Esse comportamento foi **retirado**.

Agora, cada tela operacional exibe somente um botão flutuante no canto inferior.
Ele abre um **menu Iniciar independente**, com largura máxima de 600 px,
grade de oito aplicativos e busca instantânea. Não há iframe, DOMParser,
cópia de HTML, API financeira nem nova página dentro do módulo.

- O menu nasce do canto do ícone com animação curta de escala e deslizamento.
- O fundo e o formulário em edição permanecem visíveis e intocados.
- Clique fora, Esc ou segundo clique no botão fecham o menu.
- Clicar no módulo em uso apenas fecha; não recarrega o formulário.
- Clicar em outro módulo navega para sua rota interna própria.
- O cabeçalho do popup mostra **apenas expandir e fechar (X)**, sem marca.
- O rodapé com "Abrir painel completo" e "Central de gestão" foi removido.
- O ícone flutuante fica no **canto inferior direito**, e o popup abre acima,
  ancorado ao mesmo lado.
- O símbolo de expandir faz uma transição breve e navega para a página inicial
  verdadeira (/central/), sem incorporar uma segunda página no módulo.
- O menu tem atalhos de teclado, pesquisa de módulos, Liquid Glass,
  dimensões compactas em desktop e layout responsivo no celular.

Arquivos launcher.js e launcher.css foram **substituídos**, não houve
alteração nos motores, tabelas, R2 ou configurações dos aplicativos antigos.
O teste tests/test_central_launcher_ui.js verifica dimensões,
comportamento de abrir/fechar, pesquisa e preservação do módulo.

O mesmo atualizador deploy/ATUALIZAR_VPS.sh aplica a correção,
validando o menu compacto em vez da antiga sobreposição de tela cheia.


## Otimização de fluidez (20/11/2026)

Sem migrar os bancos nem modificar as APIs originais:

- **Gateway:** scripts/estilos dos módulos são reescritos uma vez, mantidos num
  cache LRU em memória por até 75 s, até 12 MB e 2 MB por item. Não inclui
  dados financeiros, API, PDFs, XML, Excel, uploads ou cookies de autenticação.
- **Rede:** HTML, JS e CSS são enviados com gzip quando o navegador suporta,
  reduzindo bytes transmitidos. Evita ETag inválido de arquivo reescrito.
- **Downloads:** PDF/Excel/ZIP binários acima de 1 MB são enviados em blocos de
  64 KB, sem carregar o arquivo inteiro na memória da Central.
- **Dashboard:** consultas cruzadas PostgreSQL + SQLite reutilizam um resumo
  válido por até 10 segundos, evitando várias consultas simultâneas.
  Após uma gravação bem-sucedida, o cache do resumo é invalidado. Se uma base
  falhar, o resultado indisponível **não fica em cache**.
- **Frontend:** busca em controles normaliza os nomes uma só vez; filtros e
  atualização da lista de documentos são agrupados em um quadro de animação.
- **Liquid Glass:** fundos, bordas e reflexos permanecem, mas centenas de cards
  e inputs não aplicam desfoque individual (custoso na GPU). O navegador
  deixa de pintar itens fora da área visível nas listas longas.
  O menu Iniciar continua com desfoque real.
- **Segurança/compatibilidade:** testes separados garantem cache apenas de
  recursos estáticos, restrição de sessão, PDF transmitido corretamente,
  ausência de duplicação de módulos, e nenhum dado alterado por essas rotinas.

O cache de assets do servidor é automaticamente limpo ao recriar o container
na atualização. O navegador revalida JS/CSS após no máximo 75 s no gateway
e 60 s nos assets da própria Central; após atualizar, Ctrl+F5 força
a versão nova imediatamente.

Aplicar usando o instalador existente deploy/ATUALIZAR_VPS.sh. Ele
reconstrói **somente** a Central com verificação dos bancos e rotas,
sem parar ou aposentar os aplicativos antigos.

Os ganhos reais de tempo e memória dependem do tamanho das bases e do
navegador; não declarar porcentagens de melhora sem medições na VPS.


## Expansão suave do Iniciar para a página inicial (novembro/2026)

Correção de fluidez: a versão anterior animava width, height, bottom e
right do popup, obrigando o navegador a recalcular a grade e o Liquid Glass
em cada quadro. Além disso, navegava com timer fixo de 220 ms.
Essa técnica foi removida.

- No Edge/Chrome moderno, a expansão é uma View Transition entre
  documentos reais da mesma origem, usando @view-transition com
  navigation:auto. O popup e a home compartilham o nome nh-central-expand.
  O navegador interpola as imagens na camada de composição.
- O clique navega imediatamente para /central/; o navegador coordena
  a troca de página sem timer arbitrário nem aplicativo embutido.
- Sem suporte, uma superfície gráfica temporária anima apenas transform
  e opacity, não o layout ou os formulários antigos.
- A preferência de movimento reduzido é respeitada.
- launcher.css e app.css receberam estilos de entrada/saída e arquivos
  versionados para não reutilizar o estilo anterior do cache.
- O instalador recusa a CSS antiga que animava dimensões.
  Não há alteração em bancos, pagamentos, documentos ou motores originais.


## Ícone flutuante livre (20/11/2026)

O botão da Central em todos os módulos pode ser arrastado com o botão
esquerdo pressionado (inclusive toque no celular). Soltar após mover
não abre o menu. Um clique normal continua abrindo/fechando o menu
independente sem recarregar o módulo.

O clique com botão direito sobre o botão alterna os tamanhos,
sem diálogo, na ordem **58 → 70 → 82 → 94 → 58 px**.
A posição e o índice do tamanho ficam somente no localStorage
do navegador (nenhuma informação financeira, sem banco de dados).
No próximo módulo ou recarregamento, a mesma geometria é restaurada,
limitada às bordas da tela visível.

O popover calcula espaço acima e abaixo e abre no lado com maior
área disponível, centralizado horizontalmente perto do ícone e sem
sair dos limites da tela. Arrastar não recalcula o Liquid Glass: apenas
a propriedade CSS translate do botão é atualizada por requestAnimationFrame,
e a posição é consolidada no término do gesto.

Os aplicativos antigos continuam ativos; somente os arquivos
de interface do lançador da Central foram alterados.


## Correção estrutural do lançador — ícone e janela são a mesma superfície (20/11/2026)

A versão anterior montava dois elementos independentes: botão flutuante e
popup que surgia ao lado. Foi **substituída**, não escondida com CSS.

- Agora o componente raiz `#nh-start-menu` é **único**. Fechado, ele próprio
  é o ícone. Aberto, o mesmo elemento se expande para a janela de módulos.
- A transformação é FLIP, baseada em `transform` acelerado por compositor,
  com os cards aparecendo após a expansão. No fechamento, a animação retorna
  ao ícone. Não há segunda janela nem iframes.
- A janela tem tamanho **fixo de 600 × 455 px no desktop**, **360 × 510 px no
  celular**, independentemente de onde o usuário tenha movido o ícone.
  Em telas pequenas ou de baixa altura, o conjunto é proporcionalmente
  reduzido com `scale` para ficar totalmente visível.
- Não existe rolagem interna: a grade tem medidas fechadas para caber
  integralmente dentro da superfície. A janela também é reposicionada até
  estar dentro das quatro bordas da tela.
- Fechado: segurar o botão e arrastar reposiciona o ícone. Clique direito
  alterna 58 → 70 → 82 → 94 → 58 px, sem formulário.
- Aberto: **arrastar pela faixa superior** move a própria janela;
  os botões expandir e fechar continuam independentes. Ao recolher,
  o ícone acompanha o deslocamento.
- Posição do ícone e tamanho ficam apenas no localStorage do navegador.
  A navegação entre módulos não altera esses valores.
- Os testes automatizados cobrem cinco posições extremas/centrais,
  janela no modo mobile reduzido, drag nas duas formas, abertura,
  fechamento, ciclo de tamanhos e persistência.

Atualizar somente a Central com `deploy/ATUALIZAR_VPS.sh`. Os motores,
bancos e aplicativos legados permanecem ativos.


## Interface enxuta de Contas — importação por arrastar (20/11/2026)

A área de ações do módulo CONTAS mostra apenas **Pasta boletos** e
**+ Nova conta**. "ChatGPT conectado", "Acesso mobile", "Importar PDF"
e "Enviar várias contas" não são apresentados na Central. Os elementos
de compatibilidade com o CONTAS 4 permanecem carregados mas invisíveis,
para não quebrar os eventos do motor original.

**Entrada universal por drag & drop:** ao arrastar um ou mais PDFs para
a página Contas, a área de soltura os identifica. Ao soltar:

- **Um PDF:** abre o importador normal, com OCR e conferência. Se for
  comprovante, mantém o fluxo de conferência de pagamento existente.
- **Dois ou mais PDFs:** monta automaticamente a fila em memória;
  somente o primeiro é lido, os seguintes aguardam a confirmação ou
  cancelamento do documento anterior. O painel de fila aparece só nesse
  caso, sem botão no cabeçalho.
- Arquivos que não são PDF, acima de 30 MB, ou arrastados enquanto a
  fila está ocupada são recusados com aviso, sem envio parcial.
- Há botões **Tentar de novo** e **Pular arquivo** apenas quando um
  arquivo apresenta erro.

A conexão SIWC com ChatGPT **não é desligada**: o backend mantém a
configuração e a renovação de token existentes. O botão de conexão
fica oculto na Central. Erros de importação são comunicados na página;
o SIWC atual é uma integração para análise de documentos e NÃO tem
endpoint de publicação automática de mensagens em conversas do ChatGPT.
Não afirmar que uma mensagem foi entregue ao chat sem serviço de
mensageria integrado e confirmação da entrega.

## Importar várias contas — uma de cada vez (20/11/2026)

No módulo **Contas a pagar** da Central, próximo a “Importar PDF”,
existe o novo botão **“Enviar várias contas”**.

1. Selecione até 100 documentos PDF na mesma janela do navegador.
   Os arquivos são colocados numa fila local da aba; ainda não são
   cadastrados, nem enviados ao servidor em paralelo.
2. O primeiro PDF é submetido ao mesmo OCR híbrido do CONTAS 4,
   com o nome original do arquivo e as rotinas de renovação de sessão.
   A fila mostra número do arquivo, nome, progresso e estado.
3. A tela de conferência original surge automaticamente, com todos os
   campos identificados e validações de fornecedor, valor, vencimento e
   holerites. **Só grava mediante clique em Salvar**.
   O cadastro preserva R2 e cópia/reconciliação no Windows.
4. Ao Salvar ou Cancelar e **fechar efetivamente** a janela, a fila
   aguarda brevemente e passa ao PDF seguinte. Uma validação malsucedida
   deixa o formulário aberto, sem avançar ou perder informações.
5. Erro de OCR para a fila naquele documento; há “Tentar de novo”
   e “Pular arquivo”. Também é possível parar após o documento atual.
6. Ao fim, um resumo informa confirmados, ignorados e erros.
   Nenhum documento pendente é enviado sem passar por sua vez.

Proteção: enquanto a fila está ativa, novas importações isoladas e
o arrastar-soltar de PDFs ficam bloqueados. A aba alerta antes de ser
fechada para evitar perda da lista pendente. Durante a conferência, o
formulário original fica acima do painel da fila para preservar os
botões Salvar/Cancelar (inclusive em celular).

**Arquitetura:** `static/contas_batch.js` apenas coordena as funções
existentes `postPDF`, `startDetectedHolerite` e os formulários originais.
Nenhum segundo motor de OCR, pagamento, funcionário ou armazenamento é
introduzido. O gateway repassa os cabeçalhos `X-Pdf-Name` e
`X-Ocr-Mode` para que a análise mantenha o nome original e o mesmo
modo de leitura. Os scripts são carregados somente na rota Contas,
não nos módulos independentes de Funcionários ou Documentos.

A fila é mantida somente em memória nesta aba. Para evitar duplicação,
nenhum PDF é salvo automaticamente; o usuário confirma cada conta.
A Central e os aplicativos originais continuam independentes.


## Conferência de Contas em tela cheia com PDF ao lado (21/11/2026)

A conferência de um PDF em Contas abre uma **única tela de trabalho**:
o formulário editável à esquerda (39% da largura no desktop) e o
visualizador do PDF à direita (61%), com toolbar nativa do Edge/Chrome
(zoom, páginas, pesquisa). O modal ocupa toda a área disponível,
sem abrir outra janela. Os botões originais de Salvar e Cancelar ficam
visíveis na barra inferior esquerda; somente o formulário tem rolagem
independente. Para telas estreitas, o formulário e o visualizador
ficam empilhados para manter os controles acessíveis.

- A prévia de um PDF arrastado cria uma URL temporária **diretamente do
  File que o motor OCR já recebeu**. Não duplica upload nem escreve outra
  cópia no R2; o objeto é liberado quando a revisão fecha.
- O próximo PDF de uma fila substitui o documento exibido, após a
  conclusão do anterior.
- Em edição de conta com PDF já cadastrado, a versão existente é obtida
  pelo endpoint autenticado de Contas, com token local e verificação
  de sessão. Nunca monta URLs remotas públicas.
- O layout só é ativado se o diálogo exibir `#accountForm` e houver
  PDF conhecido. Cadastros sem PDF e outras confirmações do CONTAS 4
  mantêm o comportamento atual.
- Todo o motor de OCR, holerites, salvamento, R2, cópia Windows,
  importação em lote e validações do backend permanece inalterado.
- A política CSP do gateway **apenas em Contas** acrescenta
  `frame-src 'self' blob:` para o visualizador do arquivo local.
  `frame-ancestors 'none'` e `object-src 'none'` continuam ativos.
- A tela de conferência oculta temporariamente o lançador flutuante,
  evitando que ele cubra o PDF. Ele volta ao fechar.
- Os arquivos são `static/contas_pdf_review.js` e
  `static/contas_pdf_review.css`, servidos somente pela Central.

Os arquivos originais e o banco não são migrados nem alterados.
A atualização `deploy/ATUALIZAR_VPS.sh` verifica a inclusão dos
assets e a política CSP real antes de concluir.


## Filtro de duplicidade ANTES da fila de contas (21/11/2026)

Quando o usuário arrasta **vários PDFs** ao módulo Contas:

1. Antes de inserir os documentos na fila de conferência, a Central
   consulta somente para leitura `/api/windows/pdf-manifest` do CONTAS 4.
   O manifesto contém SHA-256 dos PDFs guardados localmente ou no R2,
   **incluindo documentos de contas já pagas**.
2. Cada PDF arrastado é identificado pelo seu **conteúdo real (SHA-256)**
   no navegador. Arquivos idênticos aos já cadastrados ou repetidos
   dentro do próprio lote são retirados **antes de formar a fila**,
   independentemente de terem nomes diferentes.
3. A lista `/api/accounts` fornece os identificadores de pagamento
   existentes. Cada PDF ainda não descartado segue para OCR, **um por vez**.
   Se o resultado contiver uma linha digitável bancária idêntica de
   44/46/47/48 dígitos, o documento é retirado sem mostrar o formulário.
   Para PIX EMV dinâmico, também devem coincidir valor e vencimento,
   igual à regra de duplicidade do motor original.
4. A prévia de OCR descartada tem seu ticket cancelado, sem gravar conta
   ou PDF no R2. O lote continua automaticamente para o próximo.
5. Após uma confirmação, a Central atualiza a lista de contas antes de
   conferir o próximo documento, para também identificar cobranças
   recém-cadastradas.
6. O resumo apresenta **Duplicados excluídos**, separados de erros e
   de arquivos cancelados manualmente. Se todos os PDFs forem repetidos,
   não abre nenhuma conferência nem forma fila.

**Proteção contra falsos positivos:** não descartar somente por mesmo
fornecedor, valor e vencimento. PDF de bytes diferentes e sem identificador
forte permanece disponível para conferência. Falha na consulta ao
inventário R2/banco ou ausência de WebCrypto aborta a formação da fila,
com aviso claro para o usuário tentar novamente.

Nenhum endpoint de gravação é criado e nenhuma regra de duplicidade do
CONTAS 4 foi substituída; sua confirmação continua a executar a
verificação de duplicidade do banco antes de qualquer cadastro.


## Integração Vales de funcionários ↔ Holerites (21/11/2026)

A Central reconhece o funcionário do holerite, associa seu ID do CONTAS
ao ID do cadastro de Vales, consulta as parcelas do mês e calcula:

    LÍQUIDO ORIGINAL DO PDF − PARCELAS DE VALE = VALOR A PAGAR

Exemplo: R$ 3.000,00 − R$ 450,00 = R$ 2.550,00.

### Uso

No formulário de holerite, a seção Vales do funcionário mostra o
líquido original, o controle de vínculo, as parcelas da competência e
o valor final. Nomes iguais são sugeridos, mas o usuário precisa
confirmar o vínculo. Para nomes diferentes, selecione manualmente o
funcionário correto no cadastro de Vales. O vínculo fica associado aos
IDs permanentes, não ao nome.

Desmarcar uma parcela recalcula o líquido. Parcelas atrasadas ficam
visíveis, mas não são cobradas automaticamente. Se o total exceder o
líquido do holerite, selecione menos parcelas: pagamento negativo
não é permitido. O documento PDF não sofre alterações.

### Gravação e baixa

- Salvar o holerite grava a conta pelo mecanismo original do CONTAS 4,
  incluindo OCR, R2, Windows, Pix e regras de duplicidade. A Central
  guarda a reserva das parcelas num arquivo SQLite privado.
- Só depois que o pagamento consta na tabela original de pagamentos
  do CONTAS a Central registra a baixa no motor original dos Vales.
- Antes de registrar a baixa, procura o marcador único
  CENTRAL-NH/HOLERITE:conta_id:parcela_id nos pagamentos do Vale.
  Uma falha de rede depois da primeira gravação não cria outro desconto.
- Pagamentos confirmados diretamente no Contas original podem ser
  reconciliados ao abrir a Central. Pendências de erro permanecem
  identificáveis e não causam outro pagamento ao funcionário.
- Alterar valor, competência, funcionário ou excluir holerite com vales
  reservados é bloqueado até revisão da conciliação.

### Segurança e isolamento

O registro da integração fica em
/opt/apps/central-novo-horizonte/data/vales_holerites.db, num volume
gravável privativo da Central. Os bancos dos apps originais são
consultados via SQL somente-leitura; as baixas dos Vales acontecem
exclusivamente pelas APIs originais do motor na rede Docker privada.

A sessão da Central é exigida em toda consulta ou escrita. Escritas
exigem a origem HTTPS correta. O valor e as parcelas selecionadas são
recalculados pelo servidor no momento de salvar.

Os testes automatizados incluem vínculos, competência, valores em
centavos, reserva sem baixa antecipada, bloqueio de duplicidade,
idempotência e reconciliação após erro de rede. A implantação não
desliga os aplicativos antigos e exige homologação com PDFs reais.


## Módulo nativo de Funcionários — painel consolidado (21/11/2026)

O card Funcionários na Home consulta indicadores reais da competência atual:
pessoas com pagamentos em aberto, holerites pendentes, total a pagar e
vales ainda a descontar. A atualização é paralela ao resumo da Home.

A rota /central/modules/funcionarios/ serve página própria da Central:
static/funcionarios.html, funcionarios.css e funcionarios.js.
Não carrega o aplicativo antigo, iframe nem recorta telas. Para manter
a fluidez, cada detalhe só é construído quando o usuário expande o card.

GET /central/api/funcionarios/painel?competencia=AAAA-MM consulta em modo
somente leitura o banco CONTAS (funcionários, Pix, holerites, contas e
pagamentos), o motor de Vales (parcelas e baixas) e o journal privado
da Central (vínculos e reservas).

- Resumo por competência: funcionários a receber, holerites abertos e
  pagos, vales previstos não reservados, total efetivo a pagar.
- Por pessoa: Pix oculto por padrão com opção Mostrar/Copiar, holerites
  atuais e históricos, outras contas vinculadas, parcelas da competência
  e descontos reservados, baixados e com erro de conciliação.
- Vales sem vínculo aparecem separadamente e só são associados ao
  funcionário do CONTAS depois de confirmação manual.
- Outras contas de fornecedor com nome igual são somente SUGESTÕES;
  não entram no total até o usuário confirmar a associação.
- Uma busca de outras contas por nome/número, inclusive fornecedores
  diferentes do funcionário, está disponível na própria ficha.
  GET /central/api/funcionarios/buscar-contas?q=... e
  POST /central/api/funcionarios/vincular-conta gravam exclusivamente
  IDs no journal independente da Central, nunca nos bancos originais.

REGRA FINANCEIRA: o total a pagar soma holerites pendentes da competência
(já com os descontos efetivamente reservados no líquido) e contas
confirmadas que ainda não foram pagas. Vales ainda previstos e NÃO
reservados são mostrados separadamente, evitando dedução dupla.
Contas sugeridas por nome não alteram a dívida confirmada.

Esta página é de consulta, auditoria e vínculo. Ela não emite pagamentos,
não cria documentos e não altera os valores originais dos holerites.
Os links Abrir no Contas conduzem ao fluxo de pagamentos existente.

O atualizador da VPS testa que Funcionários é nativo, os assets estão
disponíveis, os dois bancos respondem, e o acesso requer sessão.
Os testes test_central_funcionarios.py e test_central_funcionarios_ui.js
cobrem saldos, vínculo, segurança, filtros e renderização sob demanda.


## Vales visíveis DENTRO da aba Holerites do CONTAS (21/11/2026)

O frontend original CONTAS 4 monta a aba Holerites por meio da rotina
renderPayroll() e antes não mostrava parcelas de vale, mesmo que a Central
já tivesse registros e vínculos. A Central passa a carregar, **somente
no módulo Contas**, os assets /central/holerites_vales.js e
/central/holerites_vales.css, sem alterar o app original.

- Cada card da lista Holerites ganha um resumo inline: **Vales a
  descontar**, **já reservados em holerites**, **total em aberto**,
  e **parcelas atrasadas**, quando houver.
- "Ver vales, descontos e outras contas" expande os detalhes na MESMA
  tela: parcelas, competência, valor, saldo disponível, descontos
  reservados ou baixados e contas relacionadas ao funcionário.
- Holerites com desconto mostram abaixo do líquido atual a referência
  do **líquido original do PDF** e o total de vales já reservado.
- Se houver parcela disponível e o holerite em aberto ainda não tiver
  desconto aplicado, aparece **Conferir desconto**, que abre o fluxo
  original de ações da conta para revisar o lançamento. O sistema
  não desconta automaticamente um holerite já cadastrado.
- Se um funcionário ainda não estiver vinculado ao cadastro de Vales,
  a própria lista mostra o cadastro sugerido (inclusive com o total de
  vales) ou permite escolher outro cadastro, com **confirmação
  explícita**. A associação é registrada no journal da Central.
- A tela NÃO cria lançamentos, NÃO marca pagamentos, NÃO grava
  descontos na origem e NÃO modifica valores em HTML. Os totais
  são derivados da API autenticada de Funcionários, com a regra de
  que vales reservados já foram abatidos do valor do holerite.
- A busca de Holerites, botões de Pix, edição, histórico e Ações do
  CONTAS 4 permanecem funcionando. O código observa somente a troca
  dos cards pelo próprio aplicativo, sem observar os elementos que
  ele adiciona e sem duplicar renderizações. Resumo de dados cacheado
  por 12 segundos, atualizado após confirmar vínculo.
- Se a fonte de Vales estiver indisponível, a tela exibe um erro
  explícito e mantém o Contas em funcionamento; não exibe
  falsamente valor zero nem tenta descontar algo desconhecido.

Arquivo de regressão: tests/test_central_holerites_vales_ui.js.
O instalador exige os assets e sua injeção no HTML efetivamente
servido do módulo Contas antes de concluir a atualização. A alteração
**não é aplicada ao site original** do CONTAS 4 nem substitui seu
backend; só funciona quando Holerites é acessado pela Central.
