# CENTRAL DE CONTROLES

Aplicativo web para criar quadros, controles independentes e formulários próprios, com lançamentos que somam, subtraem e calculam valores automaticamente.

## Iniciar no Windows — sem terminal

1. Instale Python 3.10+ e Git, se ainda não estiverem instalados.
2. Clone o repositório privado: `git clone https://github.com/layon-lima/meus-controles.git`.
3. Abra a pasta clonada e dê dois cliques em **INICIAR.vbs**.
4. O **painel web** abre em http://127.0.0.1:18764.
5. Clique em **Abrir aplicativo** para acessar http://127.0.0.1:18765.

Não há mais painel Tkinter; `controller/server.py` é apenas o backend do painel web. Não há dependências Python de terceiros.

## Atualizar tudo

O botão **Atualizar tudo** do painel web:
1. Confere se o Git está na branch `main` e conectado ao repositório correto.
2. Busca alterações do GitHub.
3. Cria e verifica um backup SQLite em `backups/`.
4. Atualiza os arquivos com `git pull --ff-only origin main`, sem sobrescrever alterações locais.
5. Reinicia o aplicativo web e, havendo atualização, carrega também a versão nova do painel.

O projeto não modifica o CONTAS 3 nem a Central do PDF. Porta do painel: **18764**. Porta do aplicativo: **18765**.

## Funcionalidades atuais

- Quadros e controles criados/ajustados num assistente visual.
- Formulário próprio para cada controle, tipos que somam, subtraem ou só informam.
- Regras encadeadas de soma, subtração, multiplicação e porcentagem.
- Controle de Fretes inicial com Data, Motorista, Peso carregado, Valor por kg e Comissão (%).
- Cálculos: valor do frete = peso × valor/kg; comissão = frete × percentual ÷ 100; resultado = frete − comissão.
- Histórico de lançamentos, edição, pesquisa, categorias, resumos, CSV e duplicação de controles.

## Dados e integridade

- Banco: `data/controles.db`, não no navegador.
- Backups: `backups/`. Ambas as pastas estão fora do Git.
- Alterar fórmulas não recalcula valores antigos; estes preservam seus resultados, salvo edição do próprio lançamento.
- O acesso é local (127.0.0.1), ainda sem autenticação remota/multiusuário.
- Exclusões são definitivas; mantenha backups.

## Testes

`python -m unittest discover -s tests -v`

Arquitetura: `app.py` (aplicação/API/SQLite), `static/` (interface principal), `controller/server.py` (backend do painel), `controller/static/index.html` (painel web).
