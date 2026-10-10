# Painel web da Central de Controles

A interface do painel é uma página web, e não Tkinter.

- **INICIAR.vbs** abre http://127.0.0.1:18764 sem prompt de comando.
- O painel web é servido pelo backend local `controller/server.py`.
- O aplicativo abre em http://127.0.0.1:18765, com SQLite próprio.
- **Atualizar tudo** valida o repositório `layon-lima/meus-controles` na branch `main`, consulta o GitHub, salva backup, aplica somente alterações fast-forward, reinicia o aplicativo e recarrega o painel quando o código muda.
- Botões para iniciar, parar, reiniciar, abrir o app, fazer backup e ver logs.
- Painel e aplicativo usam identificadores exclusivos para impedir abertura da Central do PDF ou do Controle de Contas.
- As portas 18764 e 18765 ficam limitadas ao computador local.
- Não sobrescrever `data/` ou `backups/` em atualizações. A atualização para se houver modificações locais no código.
- O Git precisa estar instalado e autenticado para acessar o repositório privado.

Não há interface gráfica Python (Tkinter) neste projeto. O Python só é usado como servidor local.
