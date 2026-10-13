# CENTRAL DE CONTROLES

Aplicativo web para criar pastas, controles independentes e formulários próprios, com lançamentos que somam, subtraem e calculam valores automaticamente.

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

- pastas e controles criados/ajustados num assistente visual.
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

## Modelo pronto: Controle de Caminhão

Ao clicar **Novo controle**, o modelo padrão agora é **Controle de Caminhão**. Basta definir nome, pasta e comissão (13% de fábrica). Opcionalmente, informe motorista, comissão anterior a pagar e saldo inicial de caixa. As regras já vêm prontas — não é necessário montar fórmulas.

### Lançamentos

- **Frete Normal / Frete Morto**: data, descrição, peso em kg e valor por tonelada. O sistema calcula: total = peso (kg) / 1000 × preço (R$/t), comissão = total × porcentagem configurada.
- **Despesa**: data, descrição, valor e categoria (Manutenção, Abastecimento, Seguro do caminhão, Pedágio, Salário motorista, Outros gastos ou categoria nova digitada).
- **Vale / Acerto motorista**: data, descrição e valor. Diminui o caixa e a comissão a pagar, mas não vira despesa de resultado pela segunda vez.

### Demonstrativos separados

- **Fretes acumulados:** soma dos fretes.
- **Saídas do caixa:** despesas pagas + vales/acertos pagos.
- **Saldo do caixa:** saldo inicial + fretes − saídas do caixa.
- **Resultado do caminhão:** fretes − despesas operacionais − comissão gerada (a comissão é reconhecida como despesa no frete).
- **Comissão a pagar:** saldo inicial do motorista + comissão gerada − vales/acertos pagos.

A comissão padrão afeta somente novos fretes ou lançamentos editados; lançamentos passados preservam valores gravados. O modelo permite filtrar o resumo por mês, ver os totais por categoria, editar/excluir registros e exportar CSV. Não são criados lançamentos fictícios e a planilha de referência não é importada automaticamente.

### Isolamento e preservação

Os dados do caminhão ficam no mesmo SQLite local da Central, em tabelas próprias vinculadas ao ID do controle. Modelos antigos continuam funcionando, sem conversão automática. O painel web e o fluxo Git permanecem inalterados.


## Conferência e Fechamento — CONTROLE CHAVE ERRADA

Estas duas funções são habilitadas **somente** para o controle de caminhão
**CONTROLE CHAVE ERRADA**; a identificação fica vinculada ao registro do controle
mesmo que ele seja renomeado posteriormente.

### Conferência dos comprovantes
- Acesse a aba **Conferência**, selecione data inicial e final (inclusive).
- Clique em **Buscar lançamentos** e verifique fisicamente os comprovantes.
- Marque individualmente cada lançamento ou use **Marcar todos** após verificar
  os comprovantes, e então confirme.
- O período permanece registrado. As datas seguintes continuam pendentes.
- Lançamentos conferidos não podem ser criados, editados ou excluídos dentro
  daquele intervalo enquanto a conferência estiver ativa.
- **Reabrir** permite corrigir uma conferência ainda não incluída em fechamento.
  Conferências que fazem parte de um fechamento não podem ser reabertas.

### Fechamento de um capítulo
- Na aba **Fechamentos**, selecione o intervalo e clique em **Verificar período**.
- Todos os dias do intervalo devem estar cobertos por conferências completas
  e sem alterações, inclusive os dias sem lançamentos.
- O intervalo começa e termina nos limites das conferências; após o primeiro
  fechamento, o próximo começa obrigatoriamente no dia seguinte ao último.
- Confirme a operação para salvar um **arquivo imutável** do período com
  lançamentos, valores, resultado e saldo de comissão naquele encerramento.
- O arquivo pode ser consultado e exportado em CSV no histórico.
- No filtro **Capítulo atual**, os totais operacionais consideram somente os
  lançamentos após o último fechamento; **Todo o histórico** continua disponível.
- **A comissão do motorista não é zerada**: vales e comissões continuam sendo
  calculados sobre todos os lançamentos.
- Dados de períodos fechados não podem ser corrigidos pelo fluxo normal.
  Ajustes devem ser efetuados como novos registros em períodos posteriores,
  sem apagar o histórico arquivado.

Todos os dados permanecem no SQLite local, com tabelas novas; não são enviados
ao GitHub. As tabelas são criadas automaticamente ao abrir o programa atualizado.


## Modelo pronto: Controle de Dívidas

**Novo controle → Controle de Dívidas.** Informe o nome, o pasta de destino
e o valor inicial que ainda deve. Não é necessário configurar campos,
categorias ou fórmulas.

Dentro do controle aparecem três totais compactos: **Dívida inicial**,
**Total pago** e **Saldo restante**, além do histórico de pagamentos.

Cada pagamento exige **data, descrição e valor**; observações são opcionais.
Pode editar ou excluir um pagamento, e o saldo é recalculado a partir da
dívida inicial. Não permite lançar pagamentos que excedam o saldo. É
possível ajustar o valor inicial sem apagar pagamentos, desde que não
fique abaixo do que já foi pago. Exportação em CSV disponível.

Os dados são salvos localmente em tabelas próprias do SQLite.
Controles de caminhão e modelos antigos permanecem inalterados.
A planilha de exemplo não é importada automaticamente.

## Ícone e atalho automático no Windows

O ícone oficial da Central de Controles está em
`assets/CENTRAL_DE_CONTROLES.ico`, incluindo tamanhos de 16, 32, 48 e 64 px.
Ele também é o favicon do aplicativo e do painel web.

Na primeira atualização que inclui esses arquivos, o próprio aplicativo
reaberto pelo botão **Atualizar tudo** executa uma instalação silenciosa,
sem privilégios administrativos:

- cria ou atualiza o atalho **Central de Controles** na área de trabalho
  do usuário conectado (inclusive quando a área de trabalho está no OneDrive);
- associa o ícone e o iniciador `INICIAR_APP.vbs` ao atalho;
- abre diretamente a aplicação em `http://127.0.0.1:18765/`, iniciando os
  serviços locais quando necessário e sem janela de terminal.

`INICIAR.vbs` permanece inalterado e continua abrindo o painel web.
Para recriar um atalho excluído, abra o aplicativo normalmente ou execute
`INSTALAR_ATALHO.vbs` na pasta do projeto. Nenhum dado SQLite é modificado
por essas operações.

Em caso de bloqueio das permissões de execução de scripts do Windows,
o programa continua funcionando normalmente; o instalador de atalho
registra erro no log do servidor, sem impedir a inicialização do aplicativo.


## Importação local de pagamentos para Controles de Dívidas

Na tela de um Controle de Dívidas, clique em **Importar pagamentos** e
selecione um arquivo JSON UTF-8 com este formato:

```json
{
  "format": "central-controles-divida-v1",
  "control": "NOME EXATO DO CONTROLE",
  "payments": [
    {"date": "2025-01", "description": "Pagamento de exemplo", "amount": "125.00"}
  ]
}
```

O arquivo é lido e enviado **somente ao servidor local**. Dados pessoais e
financeiros do usuário não ficam no código do repositório GitHub.

A prévia mostra a quantidade, total, pagamentos já existentes, registros
novos e saldo projetado. A importação usa transação SQLite e registra o
hash do arquivo, impedindo repetir a mesma importação em outra atualização.
Pagamentos já existentes com o mesmo mês, descrição e valor são
preservados, sem duplicação. O saldo inicial nunca é modificado.

Quando o documento informa apenas mês e ano, armazena-se `AAAA-MM`,
exibido como `MM/AAAA` (não é inventado um dia). Pagamentos normais com
dia continuam usando `AAAA-MM-DD`. É possível editar ambos depois.
O arquivo só pode ser importado no controle com nome correspondente e
modelo `divida`; um arquivo destinado a outro controle é recusado.


## Modelo pronto: Recebimento de Produtos

Em **Novo controle → Recebimento de Produtos**, crie um controle dentro de um
pasta. O cadastro é feito em uma etapa, sem fórmulas.

Dentro dele, cadastre cada produto de um pedido com:
- Número do pedido;
- Fornecedor;
- Produto;
- Quantidade pedida e unidade (un, kg, t, L, sc, cx, pct, m, m², m³).

Um mesmo pedido pode conter diversos produtos, cada um com saldo separado.
Quando chegar uma entrega, clique em **Receber** no produto e informe a
**data da entrega**, **número da nota fiscal**, **quantidade recebida**
e observações opcionais. O saldo é automaticamente recalculado:

**Falta receber = quantidade pedida − soma das entregas daquele produto.**

Os registros mostram o status **Pendente**, **Parcial** ou **Recebido**.
Não é possível registrar quantidade zero, negativa ou superior ao restante.
O sistema também bloqueia repetição exata de nota, data e quantidade
para o mesmo produto; a mesma NF pode ser usada para diferentes produtos.
As entregas e os itens podem ser editados; excluir uma entrega repõe
sua quantidade no saldo. Não é possível excluir um item que ainda tem
entregas registradas, nem reduzir o pedido abaixo do já recebido.

Os dados ficam no SQLite local, em tabelas próprias. Não há soma
indiscriminada de unidades distintas (kg, sacos, toneladas etc.).
O cadastro dos outros modelos não sofre alterações.


## Importar pedidos para Controle de Recebimento

Abra o controle de recebimento e escolha **Importar pedidos** (o botão
direto aparece enquanto o controle está vazio). Após a primeira
importação, a ação continua em **Ajustes → Importar pedidos**.

O arquivo JSON fica no próprio computador, não é publicado no GitHub.
Formato:

```json
{
  "format": "central-controles-recebimento-v1",
  "control": "NOME EXATO DO CONTROLE",
  "items": [
    {
      "order_number": "00181030 / 00249394",
      "supplier": "",
      "product": "PRODUTO EXEMPLO",
      "unit": "KG",
      "ordered_qty": "1200.00"
    }
  ]
}
```

A prévia mostra todos os registros (até 60 linhas visíveis), a contagem
por unidade, as linhas já cadastradas e os fornecedores desconhecidos.
É obrigatório selecionar o controle correto. Cada produto importado
começa com zero de recebimento, sem notas fiscais inventadas. As
referências são preservadas integralmente no campo do pedido, mesmo
quando vieram dois números separados por barra.

A importação grava de forma atômica no SQLite local e impede a
repetição acidental da mesma confirmação. **Produtos podem aparecer
novamente em pedidos futuros**, mesmo com as mesmas referências,
quantidade e fornecedor. O sistema exibe um alerta se encontrar
coincidências com itens existentes, mas permite importar todas as
linhas como um **novo lote** mediante confirmação expressa.
Até o mesmo arquivo já importado pode ser utilizado para um pedido
realmente novo, marcando a confirmação de novo lote. Cada confirmação
tem identificador próprio: repetir a mesma requisição não duplica itens.
O fornecedor vazio é permitido tanto ao importar quanto ao
**Editar produto**. O aplicativo não elimina itens por coincidência.


## Voltar e Avançar entre páginas

O topo do aplicativo agora mostra setas **Voltar** e **Avançar**,
inclusive quando o menu lateral fica recolhido. Os botões usam o
mesmo histórico das setas do navegador.

A Visão geral fica na URL `/`, cada pasta em `/#/board/ID`
e cada controle em `/#/control/ID`. As URLs podem ser atualizadas
e reabertas sem perder a tela atual. A navegação não recria nem apaga
dados do SQLite. Quando não houver página anterior ou seguinte dentro
da sessão do aplicativo, a seta interna correspondente fica desativada.

Cada mudança real de tela registra uma nova entrada no histórico.
Voltar/avançar não cria entradas duplicadas, e abrir outra tela depois
de voltar descarta corretamente o avanço antigo. Um controle excluído
encontrado no histórico volta para Visão geral em vez de quebrar a tela.


## Trava de nota fiscal duplicada por pedido

No modelo **Recebimento de Produtos**, o **número da nota fiscal é único
dentro do mesmo pedido**, independentemente do produto, data ou quantidade.
Isso vale ao adicionar ou editar um recebimento e ao alterar o número do
pedido de um produto que já tem notas fiscais lançadas. A mesma nota pode
ser registrada em outro pedido, até dentro do mesmo controle.

A comparação ignora maiúsculas/minúsculas, espaços extras e, para
números puramente numéricos, zeros à esquerda (por exemplo, 2284 e
002284 são tratados como a mesma nota). O aplicativo mostra um aviso
explicando que a nota já foi registrada, deixa o formulário aberto e não
desconta outra vez a quantidade do saldo.

Notas antigas permanecem intactas. Não se cria índice UNIQUE que
poderia falhar ao abrir bases de dados com registros históricos já
existentes. A verificação ocorre em transação de escrita no servidor
local antes de gravar qualquer entrega.


## Modelo pronto: Acerto A × B

**Novo controle → Acerto A × B**. Preencha o nome do controle,
a pessoa A e a pessoa B, sem configurar campos e fórmulas.

Cada lançamento exige **data**, **quem deve para quem**, **valor positivo**,
**descrição** e observações opcionais. Exemplo:
- Fulano deve R$ 100 a Sicrano;
- Sicrano deve R$ 200 a Fulano;
- Saldo líquido: **Sicrano deve R$ 100 a Fulano**.

A tela mostra saldo líquido, totais em cada sentido e histórico com
edição e exclusão dos registros abertos. Cálculos usam centavos exatos.

### Fechamentos

Em **Fechamentos**, informe o período e clique em **Verificar acerto**.
A prévia mostra devedor, credor, valor, saldo anterior e movimento.
**Confirmar fechamento** arquiva os lançamentos do intervalo sem
apagá-los. Tornam-se somente leitura e podem ser consultados ou
exportados em CSV. O próximo período recebe o **saldo líquido restante**,
evitando contagem dupla.

Fechamentos seguem sequência cronológica sem saltar lançamentos.
O sistema exige nova prévia se os dados mudarem e bloqueia mudanças
em períodos fechados. Tudo fica no SQLite local do usuário,
sem modificar outros controles da Central.


## Pastas e movimentação de controles

O nome exibido na interface é **Pasta** (antes chamado Quadro). Os dados
já cadastrados permanecem os mesmos; não se altera nem renomeia a
estrutura interna SQLite nem os endpoints existentes `/api/boards`.

Para mover um controle, abra sua pasta e use o **lápis do cartão →
Mover para pasta**. A função também aparece no cabeçalho quando um
controle está aberto. Selecione outra pasta e confirme. O aplicativo
atualiza **apenas** o identificador da pasta do controle, mantendo:
número/ID do controle, modelo, configurações, lançamentos, histórico,
notas fiscais, saldos, comprovantes e fechamentos.

A movimentação funciona inclusive com controles de Caminhão, Dívidas,
Recebimentos e Acerto A × B. Para evitar exclusões em cascata, a
exclusão de uma pasta que contenha controles é recusada; mova os
controles primeiro. É possível mover um controle de volta depois.

## Tipografia e legibilidade

Arial/Helvetica segue como fonte padrão. Os textos do aplicativo agora
utilizam entrelinha segura, espaçamento normal entre caracteres e
quebras de linha em títulos, indicadores e cartões. Cabeçalhos,
formulários, botões, tabelas e módulos especializados recebem o mesmo
ajuste, respeitando os SVGs e sem reduzir a fonte para fazê-la caber.
