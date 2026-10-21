# VPS — CENTRAL DE CONTROLES (DOCKER + POSTGRESQL + CADDY EXISTENTE)

Este projeto tem duas execuções **separadas**:

- **PC Windows:** painel local na porta 18764, aplicativo 18765, SQLite em `data/controles.db`. Continua disponível para backup/migração.
- **VPS:** Docker Compose com API Python e PostgreSQL 16 **exclusivo**, volume persistente, sem portas Docker publicadas; Caddy já existente entrega HTTPS e senha.

**Não instalar Nginx, não parar/recriar o Caddy, GFARM, Pluviômetros ou Contas.**
A VPS `srv2076923` já usa um contêiner Caddy nas portas 80/443. A Central utiliza somente a rede Docker própria `meus-controles_interface_web`.

## 1. Copiar código do GitHub para a VPS (primeira instalação)

Acesse a VPS por SSH (Ubuntu) e execute:

```bash
mkdir -p /opt/apps
cd /opt/apps
git clone https://github.com/layon-lima/meus-controles.git
```

O repositório é público; não coloque credenciais ou dados do banco no GitHub.

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
- cria backup PostgreSQL inicial e agenda backup diário às 02:40 em `/opt/apps/backups/meus-controles/`;
- ativa `meus-controles-watchdog.timer` para recuperar a API quando ficar unhealthy.

**A API ainda não estará acessível pela internet até configurar o Caddy (passo 3).** O banco inicial é novo; os dados do PC não são migrados automaticamente.

## 3. Publicar no Caddy EXISTENTE, com senha e HTTPS

Depois de criar no DNS o registro A `controles.fazendanovohorizonte.com`, execute **na VPS**,
com terminal interativo:

```bash
cd /opt/apps/meus-controles
git pull --ff-only origin main
python3 deploy/vps/CONFIGURAR_CADDY.py
```

O instalador confere a montagem do Caddyfile do contêiner `pluv-https-caddy-1`, exige
a rede privada da Central, valida o arquivo atual, pede usuário e senha sem eco,
gera hash bcrypt pelo próprio Caddy (sem colocar senha em argumento de comando),
salva backup em `/root/caddy-config-backups/`, acrescenta somente o novo site,
valida e recarrega o Caddy sem parar os serviços existentes. Em caso de falha,
restaura o arquivo e tenta recarregar a configuração anterior.

O arquivo original que é preservado é
`/opt/apps/pluviometros/source/deploy/Caddyfile` (montado como `/etc/caddy/Caddyfile`).
Como esse arquivo pertence ao projeto de Pluviômetros, a nova rota também precisa
ser mantida na configuração de origem do Caddy para não desaparecer numa reinstalação
daquele projeto. **Não rode duas vezes nem substitua o Caddyfile inteiro.**

Depois de o DNS propagar e o Caddy obter o certificado TLS, abra
`https://controles.fazendanovohorizonte.com`. O navegador pedirá o usuário e a senha.
A Central só pode ser publicada com essa autenticação ativa.

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

## Instalar como PWA (Windows, Android e iPhone)

Depois que o domínio estiver publicado pelo Caddy com HTTPS e senha, abra `https://controles.fazendanovohorizonte.com`.

- Windows (Chrome/Edge): menu do navegador > Instalar Meus Controles.
- Android (Chrome): menu > Instalar aplicativo / Adicionar à tela inicial.
- iPhone (Safari): Compartilhar > Adicionar à Tela de Início.

O PWA usa o PostgreSQL da VPS como fonte única. O service worker armazena somente o shell HTML/CSS/JS e ícones; NUNCA respostas `/api/` ou movimentações. Offline, não envia lançamentos. Ao reconectar, atualiza os dados sem reenviar ações automaticamente.

## Diagnóstico de estabilidade

```bash
cd /opt/apps/meus-controles
docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml ps
systemctl status meus-controles-watchdog.timer --no-pager
journalctl -u meus-controles-watchdog.service -n 30 --no-pager
```

A rota `/api/ready` verifica de verdade o banco PostgreSQL, além do processo da API. O watchdog só reinicia o contêiner da Central quando o banco está saudável e a API não está, protegendo os demais aplicativos. A VPS continua sujeita a falhas de rede, hardware e manutenção. Para recuperação de perda total da VPS, mantenha backups fora do servidor e configure redundância quando necessário.
