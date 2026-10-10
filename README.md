# CENTRAL DE CONTROLES

Aplicativo web local para criar quadros e controles independentes, com formularios proprios, tipos de lancamento e calculos automaticos.

## Instalar e iniciar (Windows)
1. Instale Python 3.10+ e Git.
2. Clone: `git clone https://github.com/layon-lima/meus-controles.git`
3. Entre na pasta clonada.
4. Execute **INICIAR.vbs** para abrir sem janela de terminal; se nao abrir, use **INICIAR.bat** para ver os erros.
5. O painel inicia o app em http://127.0.0.1:8765.

Nao e preciso instalar bibliotecas Python.

## Versao inicial
- Quadros e controles criados, editados e excluidos visualmente.
- Cada controle tem seu proprio formulario de lancamentos.
- Tipos que somam, subtraem ou apenas informam.
- Regras sem formulas digitadas: multiplicacao, percentual, soma e subtracao.
- Controle de Fretes criado automaticamente no primeiro inicio com Data, Motorista, Peso carregado, Valor por kg e Comissao (%).
- Valor do frete = peso x valor por kg; comissao = valor do frete x percentual / 100; resultado = frete - comissao.
- Lancamentos editaveis, categorias, resumos por categoria e tipo, pesquisa, duplicar controles, CSV.
- Painel Windows para iniciar/parar, atualizar pelo Git e fazer backup.

## Protecao dos dados
O banco fica em `data/controles.db` e os backups em `backups/`. As duas pastas ficam fora do Git.
O painel realiza backup antes de `git pull --ff-only origin main`.
Nao apague a pasta data quando atualizar o codigo.
Mudancas nas regras afetam lancamentos futuros ou editados; dados historicos preservam os valores armazenados.
O servidor atende somente neste computador (127.0.0.1), sem acesso multiusuario.

## Testar
`python -m unittest discover -s tests -v`

Arquivos: app.py (API e SQLite), static/ (frontend), painel.py (iniciador), AGENTS.md (regras).
