# VPS — CENTRAL DE CONTROLES (DOCKER + POSTGRESQL + CADDY EXISTENTE)

Este projeto tem duas execuções **separadas**:

- **PC Windows:** painel local na porta 18764, aplicativo 18765, SQLite em `data/controles.db`. Continua disponível para backup/migração.
- **VPS:** Docker Compose com API Python e PostgreSQL 16 **exclusivo**, volume persistente, sem portas Docker publicadas; Caddy já existente entrega HTTPS e senha.

**Não instalar Nginx, não parar/recriar o Caddy, GFARM, Pluviômetros ou Contas.**
A VPS `srv2076923` já usa um contêiner Caddy nas portas 80/443. A Central utiliza somente a rede Docker própria `meus-controles_interface_web`.

## 1. Copiar código do GitHub privado para a VPS (primeira instalação)

Acesse a VPS por SSH (Ubuntu) e execute:

```bash
mkdir -p /opt/apps
cd /opt/apps
git clone https://github.com/layon-lima/meus-controles.git
```

Se o Git pedir autenticação: use um método seguro de acesso ao repositório privado (idealmente **deploy key SSH somente leitura**; não escreva PAT/senha em URL ou script).

## 2. Instalar sem tocar em outros aplicativos

Defina o DNS do novo subdomínio no provedor: registro `A` `controles` apontando para o IP público da VPS. Exemplo: `controles.fazendanovohorizonte.com`.

No terminal da VPS:

```bash
cd /opt/apps/meus-controles
bash deploy/vps/INSTALAR.sh controles.fazendanovohorizonte.com
```

O instalador:
- cria `deploy/vps/.env.production` (senha do PostgreSQL aleatória, não exibida, chmod 600, fora do Git);
- inicia **somente** `meus-controles-db-1` e `meus-controles-app-1` com `restart: unless-stopped`;
- cria volume Docker `meus-controles_banco_pg`, banco compartilhado entre os usuários;
- não expõe nenhuma porta externa nem a 5432 do banco;
- conecta o contêiner `pluv-https-caddy-1` à rede da Central sem reiniciá-lo;
- cria backup PostgreSQL inicial e agenda backup diário às 02:40 em `/opt/apps/backups/meus-controles/`.

**A API ainda não estará acessível pela internet até configurar o Caddy (passo 3).** O banco inicial é novo; os dados do PC não são migrados automaticamente.

## 3. Acrescentar a rota ao Caddy EXISTENTE

Localize o Caddyfile real:

```bash
docker inspect pluv-https-caddy-1 --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

No arquivo Caddyfile usado por esse contêiner, **adicione** um novo bloco como em `deploy/vps/Caddyfile.example`. Preserve todos os blocos anteriores.

Gere um hash bcrypt da senha de acesso em modo interativo (não cole uma senha em comandos nem nesta conversa):

```bash
docker exec -it pluv-https-caddy-1 caddy hash-password
```

Substitua `SUBSTITUA_PELO_HASH_BCRYPT` no novo bloco. Para cada usuário da Central, cadastre outro usuário/hash no `basic_auth` se desejar. A aplicação compartilha o mesmo banco para todos; ainda não possui níveis próprios de permissão.

Valide **antes** de recarregar:

```bash
docker exec pluv-https-caddy-1 caddy validate --config /etc/caddy/Caddyfile
docker exec pluv-https-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

O Caddy obterá/renovará o certificado HTTPS quando o DNS apontar corretamente para a VPS. Se o Caddy for recriado, reconecte-o à rede com `docker network connect meus-controles_interface_web pluv-https-caddy-1`, ou inclua essa rede externa no Docker Compose do Caddy para manter a conexão nas recriações.

**Nunca retire a autenticação do Caddy**, pois o aplicativo não tem login remoto embutido.

## 4. Trazer todos os controles e dados que estão no PC

No painel **LOCAL** do Windows, faça um **backup** do banco e encontre o arquivo gerado em `backups/controles_....db`. Não copie um arquivo SQLite enquanto estiver sendo escrito; use o backup consistente.

Do PowerShell do PC, envie o arquivo escolhido (ajuste endereço e caminho):

```powershell
scp "C:\CAMINHO\backups\controles_YYYYMMDD_HHMMSS.db" root@IP_DA_VPS:/root/controles-do-pc.db
```

Na VPS:

```bash
cd /opt/apps/meus-controles
bash deploy/vps/MIGRAR_BANCO.sh /root/controles-do-pc.db
```

Digite `MIGRAR` quando solicitado. O processo cria antes um backup da base VPS, para a API, lê o SQLite, transfere as tabelas em transação PostgreSQL e reabre a aplicação. **Bloqueia migração se o banco na VPS já tiver dados reais**. Após sucesso, use a versão da VPS como fonte única, para não gerar dois históricos separados.

Remova a cópia temporária de `/root/controles-do-pc.db` quando confirmar a migração e os backups.

## 5. Atualizar e conferir

```bash
cd /opt/apps/meus-controles
bash deploy/vps/ATUALIZAR.sh
```

Este script faz backup, aplica somente fast-forward da `main`, atualiza apenas a API e verifica sua saúde. O volume PostgreSQL não é recriado.

Conferir contêineres:

```bash
docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml ps
systemctl status meus-controles-pg-backup.timer --no-pager
```

Backup manual:

```bash
bash deploy/vps/BACKUP_PG.sh
```

Logs da Central (sem consultar outros projetos):

```bash
docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml logs --tail=80 app db
```

### Atenção aos dados e à disponibilidade

- `docker compose down` **não** apaga o volume, mas **NUNCA execute** `docker compose down -v` ou `docker volume rm` sobre a Central.
- O backup diário fica em outro diretório da mesma VPS. Para recuperação após perda total da VPS, copie também os backups criptografados para um destino fora do servidor.
- Uma VPS pode sofrer falha ou manutenção: `restart: unless-stopped` recupera reinicializações normais, não garante disponibilidade absoluta 100% do tempo.
- Alterar código no GitHub não altera automaticamente a VPS: rode `ATUALIZAR.sh`. As senhas e os dados não entram no Git.
