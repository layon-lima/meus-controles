import sys, sqlite3
from pathlib import Path
from PySide6.QtCore import Qt, QDate
from PySide6.QtWidgets import *

ROOT=Path(__file__).resolve().parent
DATA=ROOT/"dados"; DATA.mkdir(exist_ok=True)
DB=DATA/"controles.db"

SEED=[
("01/11/2024","PAG. 1ª PARCELA",13000),("01/01/2025","PAG. 2ª PARCELA",13000),("02/01/2025","PAG. 3ª PARCELA",13000),
("01/02/2025","PARCELA 4 - CAMINHONETA",30000),("01/03/2025","50% DO FATURAMENTO SAFRA",56315.79),
("01/04/2025","PARCELA NA SAFRA 25",13157.89),("01/05/2025","PARCELA NA SAFRA 25",13157.89),("02/04/2025","IPVA / LANÇAMENTO",3363.90),
("03/04/2025","LOCALIZADOR / RASTREADOR",892.96),("02/05/2025","BATERIA",700),("03/05/2025","ELETRICISTA - CAIXA BATERIA",1380),
("04/05/2025","ELETRICISTA - SENSOR VELOCIDADE",1240),("01/06/2025","DEPÓSITO PRO PAULO",2500),("02/06/2025","DEPÓSITO JONAS",7180),
("01/08/2025","DEPÓSITO JONAS",13000),("02/08/2025","DEP. GUINCHO R$ 540",1070.82),("01/09/2025","DEPÓSITO JONAS",5000),
("02/09/2025","DEPÓSITO ZANETTI PRO JONAS",10000),("01/10/2025","DEPÓSITO ZANETTI PRO JONAS",10000.75),
("01/11/2025","DEPÓSITO ZANETTI PRO JONAS",10000),("01/01/2026","PARCELA IPVA 540",581.79),("02/01/2026","BOLETO PARABRISA 540 PAULO",1100),
("03/01/2026","IPVA 540",572.25),("01/02/2026","4 PNEUS COM RODA",8000),("02/02/2026","FRETE NIVELADORA",5000),
("03/02/2026","2 PNEUS PRO MARCO",3000),("04/02/2026","1 IPVA 540",572.25),("01/03/2026","SEGURO 540",1400),("01/04/2026","DESCONTO DO SAFRA",50000)]
def money(v): return f"R$ {v:,.2f}".replace(",","X").replace(".",",").replace("X",".")
def category(s):
 s=s.lower()
 if "ipva" in s or "seguro" in s:return "Documentação"
 if any(x in s for x in ["pneu","bateria","eletricista","parabrisa"]):return "Manutenção"
 if "guincho" in s or "frete" in s:return "Transporte"
 if "depósito" in s:return "Pagamento"
 if "safra" in s:return "Abatimento Safra"
 return "Parcela / Abatimento"
def db():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row
 c.executescript("""CREATE TABLE IF NOT EXISTS boards(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS controls(id INTEGER PRIMARY KEY,board_id INTEGER NOT NULL,name TEXT NOT NULL,person TEXT,unit TEXT NOT NULL DEFAULT 'R$',initial REAL NOT NULL DEFAULT 0,FOREIGN KEY(board_id) REFERENCES boards(id));
 CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY,control_id INTEGER NOT NULL,date TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,category TEXT,value REAL NOT NULL,notes TEXT DEFAULT '',FOREIGN KEY(control_id) REFERENCES controls(id));""")
 if not c.execute("SELECT 1 FROM boards").fetchone():
  c.execute("INSERT INTO boards(name) VALUES(?)",("Transportes",)); bid=c.execute("SELECT last_insert_rowid()").fetchone()[0]
  c.execute("INSERT INTO controls(board_id,name,person,initial) VALUES(?,?,?,?)",(bid,"PAGAMENTO DA VAN","Ademir",650000)); cid=c.execute("SELECT last_insert_rowid()").fetchone()[0]
  for d,desc,val in SEED:
   q=QDate.fromString(d,"dd/MM/yyyy").toString("yyyy-MM-dd")
   c.execute("INSERT INTO entries(control_id,date,description,kind,category,value) VALUES(?,?,?,?,?,?)",(cid,q,desc,"Entrada",category(desc),val))
 c.commit();return c

class Main(QMainWindow):
 def __init__(self):
  super().__init__();self.c=db();self.cid=None;self.setWindowTitle("Meus Controles");self.resize(1450,850)
  self.setStyleSheet("""QMainWindow{background:#e9eef4} QWidget{font-family:'Segoe UI';font-size:13px;color:#172033} QPushButton{background:#e1e8f0;border:1px solid #b8c5d3;border-radius:7px;padding:7px 11px;font-weight:600} QPushButton:hover{background:#d5dfeb} QPushButton#primary{background:#1d63d7;color:white;border:0} QLineEdit,QComboBox,QDateEdit,QDoubleSpinBox{background:white;border:1px solid #b8c5d3;border-radius:6px;padding:6px} QTableWidget{background:white;border:1px solid #aebdcc;gridline-color:#d4dce5;alternate-background-color:#f2f5f8} QHeaderView::section{background:#d9e3ed;border:0;border-right:1px solid #b8c5d3;border-bottom:1px solid #aab8c7;padding:7px;font-weight:700}""")
  self.stack=QStackedWidget();self.setCentralWidget(self.stack);self.home=QWidget();self.detail=QWidget();self.stack.addWidget(self.home);self.stack.addWidget(self.detail);self.build_home();self.build_detail();self.refresh_home()
 def build_home(self):
  root=QVBoxLayout(self.home);top=QHBoxLayout();title=QLabel("<b style='font-size:20px'>Meus Controles</b>");self.search=QLineEdit();self.search.setPlaceholderText("Pesquisar quadros e controles...");self.search.setMaximumWidth(420);self.search.textChanged.connect(self.refresh_home);nb=QPushButton("+ Novo quadro");nb.setObjectName("primary");nb.clicked.connect(self.new_board);top.addWidget(title);top.addWidget(self.search);top.addStretch();top.addWidget(nb);root.addLayout(top)
  self.scroll=QScrollArea();self.scroll.setWidgetResizable(True);self.scroll.setFrameShape(QFrame.NoFrame);self.boardHost=QWidget();self.boardLay=QVBoxLayout(self.boardHost);self.boardLay.setAlignment(Qt.AlignTop);self.scroll.setWidget(self.boardHost);root.addWidget(self.scroll)
 def build_detail(self):
  root=QVBoxLayout(self.detail);top=QHBoxLayout();back=QPushButton("← Quadros");back.clicked.connect(lambda:self.stack.setCurrentWidget(self.home));self.dt=QLabel();self.dt.setStyleSheet("font-size:18px;font-weight:800");add=QPushButton("+ Lançamento");add.setObjectName("primary");add.clicked.connect(self.add_entry);top.addWidget(back);top.addWidget(self.dt);top.addStretch();top.addWidget(add);root.addLayout(top)
  filters=QHBoxLayout();self.q=QLineEdit();self.q.setPlaceholderText("Pesquisar lançamentos...");self.q.textChanged.connect(self.refresh_detail);self.cat=QComboBox();self.cat.currentTextChanged.connect(self.refresh_detail);filters.addWidget(self.q);filters.addWidget(self.cat);filters.addStretch();root.addLayout(filters)
  self.summary=QLabel();self.summary.setStyleSheet("background:#f8fafc;border:1px solid #b8c5d3;border-radius:8px;padding:12px;font-size:14px;font-weight:700");root.addWidget(self.summary)
  self.table=QTableWidget(0,8);self.table.setHorizontalHeaderLabels(["Data","Descrição","Tipo","Categoria","Valor","Impacto","Saldo","Obs"]);self.table.setAlternatingRowColors(True);self.table.setSelectionBehavior(QAbstractItemView.SelectRows);self.table.horizontalHeader().setSectionResizeMode(1,QHeaderView.Stretch);self.table.horizontalHeader().setSectionResizeMode(7,QHeaderView.Stretch);self.table.doubleClicked.connect(self.edit_entry);root.addWidget(self.table)
  foot=QHBoxLayout();ed=QPushButton("Editar selecionado");de=QPushButton("Excluir selecionado");ed.clicked.connect(self.edit_entry);de.clicked.connect(self.delete_entry);foot.addStretch();foot.addWidget(ed);foot.addWidget(de);root.addLayout(foot)
 def clear_layout(self,l):
  while l.count():
   i=l.takeAt(0);w=i.widget()
   if w:w.deleteLater()
   elif i.layout():self.clear_layout(i.layout())
 def refresh_home(self):
  self.clear_layout(self.boardLay);q=self.search.text().lower().strip()
  for b in self.c.execute("SELECT * FROM boards ORDER BY id"):
   controls=self.c.execute("SELECT * FROM controls WHERE board_id=? ORDER BY id",(b["id"],)).fetchall()
   visible=[x for x in controls if not q or q in (b["name"]+" "+x["name"]+" "+(x["person"] or "")).lower()]
   if q and not visible:continue
   box=QGroupBox(b["name"]);vl=QVBoxLayout(box);head=QHBoxLayout();head.addStretch();edit=QPushButton("Editar quadro");edit.clicked.connect(lambda _,i=b["id"]:self.edit_board(i));head.addWidget(edit);vl.addLayout(head)
   grid=QGridLayout();row=col=0
   for x in visible:
    paid=sum(r[0] for r in self.c.execute("SELECT value FROM entries WHERE control_id=? AND kind='Entrada'",(x["id"],)));added=sum(r[0] for r in self.c.execute("SELECT value FROM entries WHERE control_id=? AND kind='Saída'",(x["id"],)));bal=x["initial"]-paid+added
    bt=QPushButton(f"{x['name']}\n{x['person'] or ''}\n\n{money(bal)}\nSaldo atual");bt.setMinimumHeight(120);bt.setStyleSheet("text-align:left;padding:12px;background:#fbfcfe;border-left:4px solid #2161cc");bt.clicked.connect(lambda _,i=x["id"]:self.open_control(i));grid.addWidget(bt,row,col);col+=1
    if col==3:col=0;row+=1
   vl.addLayout(grid);ad=QPushButton("+ Adicionar controle neste quadro");ad.clicked.connect(lambda _,i=b["id"]:self.new_control(i));vl.addWidget(ad);self.boardLay.addWidget(box)
 def text_dialog(self,title,label,value=""):
  v,ok=QInputDialog.getText(self,title,label,text=value);return v.strip() if ok else None
 def new_board(self):
  n=self.text_dialog("Novo quadro","Nome do quadro:"); 
  if n:self.c.execute("INSERT INTO boards(name) VALUES(?)",(n,));self.c.commit();self.refresh_home()
 def edit_board(self,i):
  old=self.c.execute("SELECT name FROM boards WHERE id=?",(i,)).fetchone()[0];n=self.text_dialog("Editar quadro","Nome:",old)
  if n:self.c.execute("UPDATE boards SET name=? WHERE id=?",(n,i));self.c.commit();self.refresh_home()
 def new_control(self,bid):
  n=self.text_dialog("Novo controle","Nome:"); 
  if not n:return
  p=self.text_dialog("Novo controle","Pessoa / empresa / responsável:","") or ""
  v,ok=QInputDialog.getDouble(self,"Novo controle","Saldo inicial:",0,0,999999999,2)
  if ok:self.c.execute("INSERT INTO controls(board_id,name,person,initial) VALUES(?,?,?,?)",(bid,n,p,v));self.c.commit();self.refresh_home()
 def open_control(self,cid):self.cid=cid;self.stack.setCurrentWidget(self.detail);self.refresh_detail()
 def refresh_detail(self):
  if not self.cid:return
  c=self.c.execute("SELECT * FROM controls WHERE id=?",(self.cid,)).fetchone();self.dt.setText(c["name"])
  cats=["Todas"]+[r[0] for r in self.c.execute("SELECT DISTINCT category FROM entries WHERE control_id=? ORDER BY category",(self.cid,))]
  old=self.cat.currentText();self.cat.blockSignals(True);self.cat.clear();self.cat.addItems(cats);self.cat.setCurrentText(old if old in cats else "Todas");self.cat.blockSignals(False)
  rows=self.c.execute("SELECT * FROM entries WHERE control_id=? ORDER BY date,id",(self.cid,)).fetchall();q=self.q.text().lower();cat=self.cat.currentText();f=[r for r in rows if (not q or q in (r["description"]+" "+r["category"]+" "+r["notes"]).lower()) and (cat in ("","Todas") or r["category"]==cat)]
  paid=sum(r["value"] for r in rows if r["kind"]=="Entrada");added=sum(r["value"] for r in rows if r["kind"]=="Saída");balance=c["initial"]-paid+added
  self.summary.setText(f"Saldo inicial: {money(c['initial'])}     |     Recebido: {money(paid)}     |     Acréscimos: {money(added)}     |     SALDO ATUAL: {money(balance)}     |     {len(rows)} lançamentos")
  running=c["initial"];balances={}
  for r in rows:running += -r["value"] if r["kind"]=="Entrada" else r["value"];balances[r["id"]]=running
  self.table.setRowCount(len(f))
  for i,r in enumerate(f):
   vals=[QDate.fromString(r["date"],"yyyy-MM-dd").toString("dd/MM/yyyy"),r["description"],r["kind"],r["category"],money(r["value"]),("- " if r["kind"]=="Entrada" else "+ ")+money(r["value"]),money(balances[r["id"]]),r["notes"]]
   for j,v in enumerate(vals):it=QTableWidgetItem(str(v));it.setData(Qt.UserRole,r["id"]);self.table.setItem(i,j,it)
 def entry_form(self,r=None):
  d=QDialog(self);d.setWindowTitle("Lançamento");lay=QFormLayout(d);date=QDateEdit(calendarPopup=True);date.setDate(QDate.fromString(r["date"],"yyyy-MM-dd") if r else QDate.currentDate());desc=QLineEdit(r["description"] if r else "");kind=QComboBox();kind.addItems(["Entrada","Saída"]);kind.setCurrentText(r["kind"] if r else "Entrada");cat=QLineEdit(r["category"] if r else "Pagamento");val=QDoubleSpinBox();val.setMaximum(999999999);val.setDecimals(2);val.setValue(r["value"] if r else 0);obs=QLineEdit(r["notes"] if r else "");[lay.addRow(a,b) for a,b in [("Data",date),("Descrição",desc),("Tipo",kind),("Categoria",cat),("Valor",val),("Obs",obs)]];bb=QDialogButtonBox(QDialogButtonBox.Save|QDialogButtonBox.Cancel);bb.accepted.connect(d.accept);bb.rejected.connect(d.reject);lay.addRow(bb)
  if d.exec()!=QDialog.Accepted:return None
  return(date.date().toString("yyyy-MM-dd"),desc.text().strip(),kind.currentText(),cat.text().strip(),val.value(),obs.text().strip())
 def add_entry(self):
  x=self.entry_form()
  if x:self.c.execute("INSERT INTO entries(control_id,date,description,kind,category,value,notes) VALUES(?,?,?,?,?,?,?)",(self.cid,*x));self.c.commit();self.refresh_detail();self.refresh_home()
 def selected_id(self):
  r=self.table.currentRow();return self.table.item(r,0).data(Qt.UserRole) if r>=0 and self.table.item(r,0) else None
 def edit_entry(self,*_):
  i=self.selected_id()
  if not i:return
  r=self.c.execute("SELECT * FROM entries WHERE id=?",(i,)).fetchone();x=self.entry_form(r)
  if x and QMessageBox.question(self,"Confirmar","Salvar alterações?")==QMessageBox.Yes:self.c.execute("UPDATE entries SET date=?,description=?,kind=?,category=?,value=?,notes=? WHERE id=?",(*x,i));self.c.commit();self.refresh_detail();self.refresh_home()
 def delete_entry(self):
  i=self.selected_id()
  if i and QMessageBox.question(self,"Confirmar exclusão","Excluir este lançamento?")==QMessageBox.Yes:self.c.execute("DELETE FROM entries WHERE id=?",(i,));self.c.commit();self.refresh_detail();self.refresh_home()
if __name__=="__main__":
 app=QApplication(sys.argv);w=Main();w.show();sys.exit(app.exec())
