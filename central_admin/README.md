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
