/* Elétrica OS — ordens de serviço para eletricistas.
 * Tudo fica salvo no próprio celular (IndexedDB + localStorage). */
'use strict';

// ============================================================ utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const nativo = window.Android || null;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v) => {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const fmtNum = (n) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const digitos = (s) => String(s || '').replace(/\D/g, '');
const pad = (n, l = 2) => String(n).padStart(l, '0');
const dataHora = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const data = (ts) => dataHora(ts).slice(0, 10);
const hm = (min) => {
  min = Math.round(min || 0);
  return `${Math.floor(min / 60)}h${pad(min % 60)}`;
};
const numeroOS = (n) => '#' + pad(n, 4);
const telWhats = (t) => {
  let d = digitos(t);
  if (!d) return '';
  if (d.length <= 11) d = '55' + d.replace(/^0+/, '');
  return d;
};
const fmtTel = (t) => {
  const d = digitos(t).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || '';
};
const paraInputDT = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function abrirUrl(url) {
  if (nativo) nativo.openUrl(url);
  else window.open(url, '_blank');
}

function compartilhar(texto) {
  if (nativo) nativo.shareText(texto);
  else if (navigator.share) navigator.share({ text: texto }).catch(() => {});
  else copiar(texto);
}

function copiar(texto) {
  const ta = document.createElement('textarea');
  ta.value = texto;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('Copiado!'); } catch (e) { toast('Não foi possível copiar'); }
  ta.remove();
}

function whatsapp(tel, texto) {
  const n = telWhats(tel);
  if (!n) { compartilhar(texto); return; }
  abrirUrl(`https://wa.me/${n}?text=${encodeURIComponent(texto)}`);
}

// ============================================================ constantes
const STATUS = [
  { id: 'nova', nome: 'Nova', cor: '#2563eb' },
  { id: 'agendada', nome: 'Agendada', cor: '#7c3aed' },
  { id: 'orcamento', nome: 'Orçamento enviado', cor: '#d97706' },
  { id: 'aprovada', nome: 'Aprovada', cor: '#0d9488' },
  { id: 'andamento', nome: 'Em andamento', cor: '#0284c7' },
  { id: 'concluida', nome: 'Concluída', cor: '#16a34a' },
  { id: 'cancelada', nome: 'Cancelada', cor: '#64748b' },
];
const statusDe = (id) => STATUS.find((s) => s.id === id) || STATUS[0];
const ABERTAS = ['nova', 'agendada', 'orcamento', 'aprovada', 'andamento'];

const TIPOS = [
  'Tomadas e interruptores', 'Chuveiro / resistência', 'Quadro de distribuição / disjuntores',
  'Falta de energia / curto-circuito', 'Iluminação / luminárias', 'Ventilador de teto',
  'Instalação de equipamentos', 'Padrão de entrada / medidor', 'Aterramento / DPS',
  'Fiação nova / reforma', 'Laudo / inspeção', 'Outro',
];
const URGENCIA = { normal: 'Normal', urgente: 'Urgente', emergencia: 'Emergência' };

const CATALOGO_PADRAO = [
  'Disjuntor 10A;18', 'Disjuntor 16A;18', 'Disjuntor 20A;18', 'Disjuntor 32A;22', 'Disjuntor bipolar 40A;65',
  'DR 40A 30mA;160', 'DPS 275V;55', 'Cabo flexível 1,5mm (m);2,5', 'Cabo flexível 2,5mm (m);3,8',
  'Cabo flexível 4mm (m);6', 'Cabo flexível 6mm (m);9', 'Cabo flexível 10mm (m);15', 'Tomada 10A;15',
  'Tomada 20A;18', 'Interruptor simples;14', 'Interruptor paralelo;18', 'Caixa 4x2;3', 'Eletroduto corrugado (m);2',
  'Resistência de chuveiro;45', 'Lâmpada LED 9W;10', 'Plafon LED;45', 'Conector Wago;3', 'Fita isolante;8',
  'Quadro de distribuição 12 disj.;90', 'Haste de aterramento;45',
];

// ============================================================ configurações
const CFG_PADRAO = {
  nome: '', whats: '', documento: '', cidade: '',
  valorHora: 80, visitaMinima: 0, deslocamento: 0, validadeDias: 7,
  pix: '', garantia: 'Garantia de 90 dias para a mão de obra.',
  linkBase: 'https://seretkr.github.io/calculadora_judman/',
  catalogo: CATALOGO_PADRAO.join('\n'),
  seq: 0,
};
let cfg = carregarCfg();

function carregarCfg() {
  try { return Object.assign({}, CFG_PADRAO, JSON.parse(localStorage.getItem('eos_cfg') || '{}')); }
  catch (e) { return Object.assign({}, CFG_PADRAO); }
}
function salvarCfg() { localStorage.setItem('eos_cfg', JSON.stringify(cfg)); }
function proximoNumero() { cfg.seq = (cfg.seq || 0) + 1; salvarCfg(); return cfg.seq; }
function linkCliente() {
  let base = (cfg.linkBase || CFG_PADRAO.linkBase).trim();
  if (!/\/$|\.html$/.test(base)) base += '/';
  const q = new URLSearchParams({ w: telWhats(cfg.whats) });
  if (cfg.nome) q.set('n', cfg.nome);
  return `${base}?${q.toString()}`;
}

// ============================================================ banco de dados
let db;
function abrirDB() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('eletricaos', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('os', { keyPath: 'id' });
      const f = d.createObjectStore('fotos', { keyPath: 'id' });
      f.createIndex('osId', 'osId');
    };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => erro(r.error);
  });
}
function tx(store, modo, fn) {
  return new Promise((ok, erro) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    let res;
    const req = fn(s);
    if (req) req.onsuccess = () => { res = req.result; };
    t.oncomplete = () => ok(res);
    t.onerror = () => erro(t.error);
  });
}
const dbTodos = (store) => tx(store, 'readonly', (s) => s.getAll());
const dbPut = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
const dbDel = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
const fotosDa = (osId) => tx('fotos', 'readonly', (s) => s.index('osId').getAll(osId));

let ordens = [];
const acharOS = (id) => ordens.find((o) => o.id === id);

async function salvarOS(os) {
  os.atualizadoEm = Date.now();
  if (!acharOS(os.id)) ordens.push(os);
  await dbPut('os', os);
}

function novaOS(dados = {}) {
  const agora = Date.now();
  return Object.assign({
    id: uid(), numero: proximoNumero(), criadoEm: agora, atualizadoEm: agora,
    status: 'nova', origem: 'manual', origemId: null,
    cliente: { nome: '', telefone: '', endereco: '', bairro: '', cidade: cfg.cidade || '', referencia: '' },
    servico: { tipo: '', descricao: '', urgencia: 'normal', preferencia: '' },
    agendamento: null,
    horas: [], timer: null, materiais: [],
    deslocamento: num(cfg.deslocamento), desconto: 0,
    observacoes: '', diagnostico: '',
    pagamento: { pago: false, forma: '', em: null },
    fotosNoPdf: true,
    historico: [{ em: agora, texto: 'OS criada' }],
  }, dados);
}

function registrar(os, texto) {
  os.historico = os.historico || [];
  os.historico.push({ em: Date.now(), texto });
}

// ============================================================ cálculos
function calcular(os) {
  const minutos = os.horas.reduce((s, h) => s + (h.minutos || 0), 0);
  let maoObra = os.horas.reduce((s, h) => s + (h.minutos || 0) / 60 * num(h.valorHora), 0);
  let minimoAplicado = false;
  const minimo = num(cfg.visitaMinima);
  if (minimo > 0 && os.horas.length && maoObra < minimo) { maoObra = minimo; minimoAplicado = true; }
  const materiais = os.materiais.reduce((s, m) => s + (m.doCliente ? 0 : num(m.qtd) * num(m.valor)), 0);
  const desloc = num(os.deslocamento);
  const desc = num(os.desconto);
  const total = Math.max(0, maoObra + materiais + desloc - desc);
  return { minutos, maoObra, minimoAplicado, materiais, desloc, desc, total };
}

// ============================================================ pedidos via link
function codificar(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodificar(str) {
  let b = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
function extrairPedido(texto) {
  const m = String(texto || '').match(/[?&#]d=([A-Za-z0-9_-]{10,})/);
  if (!m) return null;
  try {
    const p = decodificar(m[1]);
    return p && p.c ? p : null;
  } catch (e) { return null; }
}

async function importarPedido(texto) {
  const p = extrairPedido(texto);
  if (!p) { toast('Não encontrei um pedido válido nesse texto'); return false; }
  const existente = p.id && ordens.find((o) => o.origemId === p.id);
  if (existente) { toast('Esse pedido já foi importado'); ir(`#/os/${existente.id}`); return true; }
  const c = p.c || {}, s = p.s || {};
  const os = novaOS({
    origem: 'link', origemId: p.id || null,
    cliente: { nome: c.n || '', telefone: c.t || '', endereco: c.e || '', bairro: c.b || '', cidade: c.ci || '', referencia: c.r || '' },
    servico: { tipo: s.tp || '', descricao: s.d || '', urgencia: s.u || 'normal', preferencia: s.p || '' },
    historico: [{ em: p.t || Date.now(), texto: 'Pedido aberto pelo cliente via link' }, { em: Date.now(), texto: 'Importado no app' }],
  });
  await salvarOS(os);
  toast(`OS ${numeroOS(os.numero)} criada!`);
  ir(`#/os/${os.id}`);
  return true;
}

window.onDeepLink = (url) => { if (url) importarPedido(url); };

// ============================================================ navegação
function ir(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.goBack = () => {
  if (!$('#modal').classList.contains('hidden')) { fecharModal(); return true; }
  const h = location.hash;
  const m = h.match(/^#\/(os|editar|doc)\/([^/]+)/);
  if (m && m[1] !== 'os') { ir(`#/os/${m[2]}`); return true; }
  if (h && h !== '#/' && h !== '#') { ir('#/'); return true; }
  return false;
};
window.addEventListener('hashchange', render);

let timerInterval = null;
function render() {
  clearInterval(timerInterval);
  fecharModal();
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/os\/([^/]+)/))) return telaOS(m[1]);
  if ((m = h.match(/^#\/editar\/([^/]+)/))) return telaEditar(m[1]);
  if ((m = h.match(/^#\/doc\/([^/]+)\/(\w+)/))) return telaDoc(m[1], m[2]);
  if (h.startsWith('#/nova')) return telaEditar(null);
  if (h.startsWith('#/config')) return telaConfig();
  if (h.startsWith('#/importar')) return telaImportar();
  return telaInicio();
}

function topo(titulo, voltar, extra = '') {
  return `<header class="topo">
    ${voltar ? `<button class="icone" data-a="voltar" aria-label="Voltar">←</button>` : ''}
    <h1>${titulo}</h1>${extra}
  </header>`;
}

// ============================================================ tela inicial
let filtro = 'abertas';
let busca = '';

function telaInicio() {
  const agora = new Date();
  const hojeStr = agora.toDateString();
  const abertas = ordens.filter((o) => ABERTAS.includes(o.status));
  const hoje = ordens.filter((o) => o.agendamento && new Date(o.agendamento).toDateString() === hojeStr && o.status !== 'cancelada');
  const aReceber = ordens.filter((o) => o.status === 'concluida' && !o.pagamento.pago).reduce((s, o) => s + calcular(o).total, 0);
  const recebidoMes = ordens.filter((o) => o.pagamento.pago && o.pagamento.em
    && new Date(o.pagamento.em).getMonth() === agora.getMonth() && new Date(o.pagamento.em).getFullYear() === agora.getFullYear())
    .reduce((s, o) => s + calcular(o).total, 0);

  let lista = ordens.slice();
  if (filtro === 'abertas') lista = abertas.slice();
  else if (filtro === 'hoje') lista = hoje.slice();
  else if (filtro !== 'todas') lista = lista.filter((o) => o.status === filtro);
  if (busca) {
    const b = busca.toLowerCase();
    lista = lista.filter((o) => [o.cliente.nome, o.cliente.telefone, o.cliente.endereco, o.cliente.bairro, o.servico.tipo, o.servico.descricao, numeroOS(o.numero)]
      .join(' ').toLowerCase().includes(b));
  }
  const peso = { emergencia: 0, urgente: 1, normal: 2 };
  lista.sort((a, b) => {
    if (filtro === 'abertas') {
      const pa = peso[a.servico.urgencia] ?? 2, pb = peso[b.servico.urgencia] ?? 2;
      if (a.status === 'nova' && b.status === 'nova' && pa !== pb) return pa - pb;
    }
    return b.criadoEm - a.criadoEm;
  });

  const filtros = [['abertas', `Abertas (${abertas.length})`], ['hoje', `Hoje (${hoje.length})`], ['todas', 'Todas'],
    ...STATUS.map((s) => [s.id, s.nome])];

  app.innerHTML = `
    ${topo('<span class="raio">⚡</span> Elétrica OS', false, `
      <button class="icone" data-a="importar" aria-label="Importar pedido">📥</button>
      <button class="icone" data-a="config" aria-label="Configurações">⚙️</button>`)}
    <main class="conteudo">
      <section class="painel">
        <div class="kpi"><small>OS abertas</small><b>${abertas.length}</b></div>
        <div class="kpi"><small>Agendadas hoje</small><b>${hoje.length}</b></div>
        <div class="kpi destaque"><small>A receber</small><b>${brl(aReceber)}</b></div>
        <div class="kpi"><small>Recebido no mês</small><b>${brl(recebidoMes)}</b></div>
      </section>

      ${!cfg.whats ? `<div class="dica"><b>Comece por aqui:</b> abra as ⚙️ Configurações, coloque seu nome e WhatsApp e
        defina o valor da sua hora. Depois é só enviar o seu link para os clientes abrirem chamados.</div>` : ''}

      <div class="botoes" style="margin-bottom:12px">
        <button class="btn whats" data-a="enviar-link">📲 Enviar link</button>
        <button class="btn claro" data-a="importar">📥 Importar pedido</button>
      </div>

      <input type="search" id="busca" placeholder="Buscar cliente, endereço, nº…" value="${esc(busca)}" style="margin-bottom:10px">
      <div class="chips">${filtros.map(([id, nome]) => `<button class="chip ${filtro === id ? 'ativo' : ''}" data-a="filtro" data-v="${id}">${nome}</button>`).join('')}</div>

      ${lista.length ? lista.map(itemOS).join('') : `<div class="card vazio" style="text-align:center">
        ${ordens.length ? 'Nenhuma OS neste filtro.' : 'Nenhuma ordem de serviço ainda.<br>Toque em <b>+</b> para criar ou envie seu link para clientes.'}</div>`}
    </main>
    <button class="fab" data-a="nova" aria-label="Nova OS">+</button>`;

  const inp = $('#busca');
  inp.addEventListener('input', () => {
    busca = inp.value;
    const pos = inp.selectionStart;
    telaInicio();
    const n = $('#busca'); n.focus(); n.setSelectionRange(pos, pos);
  });
}

function itemOS(o) {
  const st = statusDe(o.status);
  const t = calcular(o);
  const urg = o.servico.urgencia && o.servico.urgencia !== 'normal'
    ? `<span class="badge tag-urg">${URGENCIA[o.servico.urgencia]}</span>` : '';
  const timer = o.timer ? '<span class="badge tag-timer">⏱ em atendimento</span>' : '';
  const pago = o.pagamento.pago ? '<span class="badge" style="--cor:#16a34a">Pago</span>' : '';
  return `<a class="os-item" href="#/os/${o.id}" style="--cor:${st.cor}">
    <div class="l1"><span class="nome">${esc(o.cliente.nome || 'Sem nome')}</span><span class="num">${numeroOS(o.numero)}</span></div>
    <div class="l2">${esc(o.servico.tipo || 'Serviço não informado')}${o.cliente.bairro ? ' · ' + esc(o.cliente.bairro) : ''}</div>
    <div class="l2">${o.agendamento ? '📅 ' + dataHora(o.agendamento) : 'Aberta em ' + data(o.criadoEm)}</div>
    <div class="l3"><span><span class="badge" style="--cor:${st.cor}">${st.nome}</span> ${urg} ${timer} ${pago}</span>
      <span class="total">${t.total ? brl(t.total) : ''}</span></div>
  </a>`;
}

// ============================================================ detalhe da OS
async function telaOS(id) {
  const os = acharOS(id);
  if (!os) { ir('#/'); return; }
  const fotos = await fotosDa(id);
  fotos.sort((a, b) => a.em - b.em);
  const st = statusDe(os.status);
  const c = os.cliente, s = os.servico;
  const endereco = [c.endereco, c.bairro, c.cidade].filter(Boolean).join(', ');

  app.innerHTML = `
    ${topo(`OS ${numeroOS(os.numero)}`, true, `<button class="icone" data-a="menu-os" aria-label="Mais opções">⋮</button>`)}
    <main class="conteudo">
      <div class="card">
        <h2>Status</h2>
        <div class="chips wrap">${STATUS.map((x) => `<button class="chip status ${x.id === os.status ? 'ativo' : ''}" style="--cor:${x.cor}" data-a="status" data-v="${x.id}">${x.nome}</button>`).join('')}</div>
        <label class="campo"><span>📅 Visita / execução agendada</span>
          <input type="datetime-local" data-f="agendamento" value="${paraInputDT(os.agendamento)}"></label>
      </div>

      <div class="card">
        <h2>Cliente <button class="link acao" data-a="editar">Editar</button></h2>
        <div class="info-linha"><span class="ico">👤</span><span class="txt"><b>${esc(c.nome || 'Sem nome')}</b></span></div>
        ${c.telefone ? `<div class="info-linha"><span class="ico">📞</span><span class="txt">${esc(fmtTel(c.telefone))}</span></div>` : ''}
        ${endereco ? `<div class="info-linha"><span class="ico">📍</span><span class="txt">${esc(endereco)}${c.referencia ? `<br><small>Ref.: ${esc(c.referencia)}</small>` : ''}</span></div>` : ''}
        <div class="botoes" style="margin-top:8px; grid-template-columns: repeat(3,1fr)">
          <button class="btn claro peq" data-a="ligar" ${c.telefone ? '' : 'disabled'}>📞 Ligar</button>
          <button class="btn whats peq" data-a="whats" ${c.telefone ? '' : 'disabled'}>💬 WhatsApp</button>
          <button class="btn claro peq" data-a="mapa" ${endereco ? '' : 'disabled'}>🗺️ Mapa</button>
        </div>
      </div>

      <div class="card">
        <h2>Serviço solicitado</h2>
        <div class="info-linha"><span class="ico">🔧</span><span class="txt"><b>${esc(s.tipo || 'Não informado')}</b>
          ${s.urgencia && s.urgencia !== 'normal' ? ` <span class="badge tag-urg">${URGENCIA[s.urgencia]}</span>` : ''}</span></div>
        ${s.descricao ? `<div class="info-linha"><span class="ico">📝</span><span class="txt">${esc(s.descricao).replace(/\n/g, '<br>')}</span></div>` : ''}
        ${s.preferencia ? `<div class="info-linha"><span class="ico">🕒</span><span class="txt">Preferência: ${esc(s.preferencia)}</span></div>` : ''}
        <label class="campo" style="margin-top:8px"><span>Diagnóstico técnico (o que você encontrou)</span>
          <textarea data-f="diagnostico" placeholder="Ex.: disjuntor subdimensionado, fiação aquecida no circuito do chuveiro…">${esc(os.diagnostico)}</textarea></label>
      </div>

      <div class="card">
        <h2>⏱ Mão de obra</h2>
        <div class="timer">
          <div><small>${os.timer ? 'Atendimento em andamento desde ' + dataHora(os.timer.inicio).slice(11) : 'Cronômetro do atendimento'}</small>
            <span class="tempo ${os.timer ? 'rodando' : ''}" id="tempo">${os.timer ? cronometro(os.timer.inicio) : '00:00:00'}</span></div>
          <button class="btn ${os.timer ? 'perigo' : 'amarelo'}" data-a="timer">${os.timer ? '■ Parar' : '▶ Iniciar'}</button>
        </div>
        ${os.horas.length ? `<ul class="itens">${os.horas.map((h) => `<li>
          <div class="desc">${esc(h.descricao || 'Mão de obra')}<small>${data(h.data)} · ${hm(h.minutos)} × ${brl(h.valorHora)}/h</small></div>
          <span class="valor">${brl(h.minutos / 60 * num(h.valorHora))}</span>
          <button class="x" data-a="del-hora" data-v="${h.id}" aria-label="Remover">✕</button></li>`).join('')}</ul>`
          : '<div class="vazio">Nenhuma hora lançada. Use o cronômetro ou lance manualmente.</div>'}
        <details>
          <summary class="link">+ Lançar horas manualmente</summary>
          <div style="margin-top:10px">
            <label class="campo"><span>Descrição</span><input type="text" id="h-desc" placeholder="Ex.: Troca do quadro"></label>
            <div class="linha">
              <label class="campo"><span>Horas</span><input type="text" inputmode="numeric" id="h-h" placeholder="0"></label>
              <label class="campo"><span>Minutos</span><input type="text" inputmode="numeric" id="h-m" placeholder="0"></label>
              <label class="campo"><span>R$/hora</span><input type="text" inputmode="decimal" id="h-v" value="${fmtNum(cfg.valorHora)}"></label>
            </div>
            <button class="btn bloco" data-a="add-hora">Adicionar horas</button>
          </div>
        </details>
      </div>

      <div class="card">
        <h2>🧰 Materiais e equipamentos</h2>
        ${os.materiais.length ? `<ul class="itens">${os.materiais.map((m) => `<li>
          <div class="desc">${esc(m.nome)}<small>${fmtNum(m.qtd)} × ${brl(m.valor)}${m.doCliente ? ' · fornecido pelo cliente' : ''}</small></div>
          <span class="valor">${m.doCliente ? '—' : brl(num(m.qtd) * num(m.valor))}</span>
          <button class="x" data-a="del-mat" data-v="${m.id}" aria-label="Remover">✕</button></li>`).join('')}</ul>`
          : '<div class="vazio">Nenhum material lançado.</div>'}
        <label class="campo"><span>Item</span><input type="text" id="m-nome" list="catalogo" placeholder="Ex.: Disjuntor 20A"></label>
        <datalist id="catalogo">${catalogo().map((i) => `<option value="${esc(i.nome)}">${i.valor ? brl(i.valor) : ''}</option>`).join('')}</datalist>
        <div class="linha">
          <label class="campo estreito"><span>Qtd</span><input type="text" inputmode="decimal" id="m-qtd" value="1"></label>
          <label class="campo"><span>Valor unitário (R$)</span><input type="text" inputmode="decimal" id="m-valor" placeholder="0,00"></label>
        </div>
        <label class="check"><input type="checkbox" id="m-cliente"> Fornecido pelo cliente (não soma no total)</label>
        <button class="btn bloco" data-a="add-mat">Adicionar item</button>
      </div>

      <div class="card">
        <h2>📷 Fotos do local (${fotos.length})</h2>
        ${fotos.length ? `<div class="fotos">${fotos.map((f) => `<button data-a="ver-foto" data-v="${f.id}">
          <img src="${f.data}" alt="">${f.legenda ? `<span class="leg">${esc(f.legenda)}</span>` : ''}</button>`).join('')}</div>`
          : '<div class="vazio">Registre o antes, o durante e o depois do serviço.</div>'}
        <div class="botoes">
          <button class="btn amarelo" data-a="foto-camera">📷 Tirar foto</button>
          <button class="btn claro" data-a="foto-galeria">🖼️ Galeria</button>
        </div>
        <input type="file" accept="image/*" capture="environment" id="in-camera" class="oculto">
        <input type="file" accept="image/*" multiple id="in-galeria" class="oculto">
        <label class="check"><input type="checkbox" data-f="fotosNoPdf" ${os.fotosNoPdf ? 'checked' : ''}> Incluir fotos no orçamento em PDF</label>
      </div>

      <div class="card">
        <h2>💰 Valores</h2>
        <div class="linha">
          <label class="campo"><span>Deslocamento (R$)</span><input type="text" inputmode="decimal" data-f="deslocamento" value="${fmtNum(os.deslocamento)}"></label>
          <label class="campo"><span>Desconto (R$)</span><input type="text" inputmode="decimal" data-f="desconto" value="${fmtNum(os.desconto)}"></label>
        </div>
        <label class="campo"><span>Observações no orçamento</span>
          <textarea data-f="observacoes" placeholder="Condições, prazo de execução, o que não está incluso…">${esc(os.observacoes)}</textarea></label>
        <div class="resumo" id="resumo">${resumoHTML(os)}</div>
      </div>

      <div class="card">
        <h2>💳 Pagamento</h2>
        <label class="check"><input type="checkbox" data-f="pagamento.pago" ${os.pagamento.pago ? 'checked' : ''}> Serviço pago
          ${os.pagamento.pago && os.pagamento.em ? `<small style="color:var(--suave)">em ${data(os.pagamento.em)}</small>` : ''}</label>
        <label class="campo"><span>Forma de pagamento</span>
          <select data-f="pagamento.forma">${['', 'PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Boleto']
            .map((f) => `<option ${os.pagamento.forma === f ? 'selected' : ''} value="${f}">${f || 'Selecione…'}</option>`).join('')}</select></label>
      </div>

      <div class="card">
        <h2>Enviar ao cliente</h2>
        <div class="botoes um">
          <button class="btn whats" data-a="enviar-orc">💬 Enviar orçamento pelo WhatsApp</button>
        </div>
        <div class="botoes" style="margin-top:8px">
          <button class="btn" data-a="doc-orc">📄 Orçamento PDF</button>
          <button class="btn verde" data-a="doc-rec">🧾 Recibo PDF</button>
        </div>
      </div>

      <div class="card">
        <h2>Histórico</h2>
        <ul class="hist">${os.historico.slice().reverse().map((h) => `<li>${esc(h.texto)}<small>${dataHora(h.em)}</small></li>`).join('')}</ul>
      </div>
    </main>`;

  app.dataset.os = id;
  clearInterval(timerInterval);
  if (os.timer) {
    timerInterval = setInterval(() => {
      const el = $('#tempo');
      if (el && os.timer) el.textContent = cronometro(os.timer.inicio);
    }, 1000);
  }
  $('#in-camera').addEventListener('change', (e) => adicionarFotos(os, e.target.files));
  $('#in-galeria').addEventListener('change', (e) => adicionarFotos(os, e.target.files));
}

function cronometro(inicio) {
  const s = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function resumoHTML(os) {
  const t = calcular(os);
  return `
    <div class="ln"><span>Mão de obra (${hm(t.minutos)})</span><b>${brl(t.maoObra)}</b></div>
    ${t.minimoAplicado ? `<div class="obs">Aplicado valor mínimo de visita (${brl(cfg.visitaMinima)})</div>` : ''}
    <div class="ln"><span>Materiais</span><b>${brl(t.materiais)}</b></div>
    <div class="ln"><span>Deslocamento</span><b>${brl(t.desloc)}</b></div>
    ${t.desc ? `<div class="ln"><span>Desconto</span><b>− ${brl(t.desc)}</b></div>` : ''}
    <div class="ln total"><span>Total</span><span>${brl(t.total)}</span></div>`;
}

function catalogo() {
  const mapa = new Map();
  String(cfg.catalogo || '').split('\n').forEach((l) => {
    const [nome, valor] = l.split(';');
    if (nome && nome.trim()) mapa.set(nome.trim().toLowerCase(), { nome: nome.trim(), valor: num(valor) });
  });
  // itens usados nas OS ficam com o último preço praticado
  ordens.slice().sort((a, b) => a.atualizadoEm - b.atualizadoEm).forEach((o) => o.materiais.forEach((m) => {
    if (!m.doCliente && num(m.valor)) mapa.set(m.nome.toLowerCase(), { nome: m.nome, valor: num(m.valor) });
  }));
  return Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function comprimirImagem(arquivo, max = 1600, qualidade = 0.72) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = erro;
      i.src = url;
    });
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', qualidade);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function adicionarFotos(os, arquivos) {
  if (!arquivos || !arquivos.length) return;
  toast('Salvando foto…');
  let n = 0;
  for (const f of Array.from(arquivos)) {
    try {
      const dataUrl = await comprimirImagem(f);
      await dbPut('fotos', { id: uid(), osId: os.id, data: dataUrl, legenda: '', em: Date.now() });
      n++;
    } catch (e) { /* imagem ilegível: ignora */ }
  }
  if (n) {
    registrar(os, `${n} foto(s) adicionada(s)`);
    await salvarOS(os);
    toast(`${n} foto(s) salva(s)`);
  } else toast('Não consegui ler a imagem');
  telaOS(os.id);
}

async function verFoto(os, fotoId) {
  const fotos = await fotosDa(os.id);
  const f = fotos.find((x) => x.id === fotoId);
  if (!f) return;
  abrirModal(`
    <img class="grande" src="${f.data}" alt="">
    <label class="campo"><span>Legenda</span><input type="text" id="f-leg" value="${esc(f.legenda)}" placeholder="Ex.: Quadro antes da troca"></label>
    <div class="chips wrap">${['Antes', 'Durante', 'Depois', 'Problema encontrado', 'Quadro', 'Medidor'].map((l) => `<button class="chip" data-leg="${l}">${l}</button>`).join('')}</div>
    <div class="botoes">
      <button class="btn perigo" id="f-del">🗑 Excluir</button>
      <button class="btn" id="f-ok">Salvar</button>
    </div>`);
  $$('[data-leg]').forEach((b) => b.addEventListener('click', () => { $('#f-leg').value = b.dataset.leg; }));
  $('#f-ok').addEventListener('click', async () => {
    f.legenda = $('#f-leg').value.trim();
    await dbPut('fotos', f);
    fecharModal();
    telaOS(os.id);
  });
  $('#f-del').addEventListener('click', async () => {
    if (!confirm('Excluir esta foto?')) return;
    await dbDel('fotos', f.id);
    registrar(os, 'Foto excluída');
    await salvarOS(os);
    fecharModal();
    telaOS(os.id);
  });
}

function textoOrcamento(os) {
  const t = calcular(os);
  const c = os.cliente;
  const L = [];
  L.push(`⚡ *ORÇAMENTO ${numeroOS(os.numero)}*`);
  if (cfg.nome) L.push(`*${cfg.nome}*`);
  L.push('');
  L.push(`Cliente: ${c.nome}`);
  const end = [c.endereco, c.bairro].filter(Boolean).join(', ');
  if (end) L.push(`Local: ${end}`);
  if (os.servico.tipo) L.push(`Serviço: ${os.servico.tipo}`);
  if (os.diagnostico) { L.push(''); L.push(`🔎 *Diagnóstico:* ${os.diagnostico}`); }
  L.push('');
  L.push(`🔧 *Mão de obra* (${hm(t.minutos)}): ${brl(t.maoObra)}`);
  os.horas.forEach((h) => L.push(`  • ${h.descricao || 'Serviço'} — ${hm(h.minutos)}`));
  const mats = os.materiais.filter((m) => !m.doCliente);
  if (mats.length) {
    L.push('');
    L.push(`🧰 *Materiais:* ${brl(t.materiais)}`);
    mats.forEach((m) => L.push(`  • ${fmtNum(m.qtd)}x ${m.nome} — ${brl(num(m.qtd) * num(m.valor))}`));
  }
  const doCli = os.materiais.filter((m) => m.doCliente);
  if (doCli.length) L.push(`  (Fornecido pelo cliente: ${doCli.map((m) => m.nome).join(', ')})`);
  if (t.desloc) L.push(`🚗 Deslocamento: ${brl(t.desloc)}`);
  if (t.desc) L.push(`🏷️ Desconto: − ${brl(t.desc)}`);
  L.push('');
  L.push(`💰 *TOTAL: ${brl(t.total)}*`);
  if (os.observacoes) { L.push(''); L.push(`📝 ${os.observacoes}`); }
  L.push('');
  L.push(`Orçamento válido por ${cfg.validadeDias || 7} dias.`);
  if (cfg.garantia) L.push(cfg.garantia);
  if (cfg.pix) L.push(`PIX: ${cfg.pix}`);
  L.push('');
  L.push('Posso confirmar o serviço? 👍');
  return L.join('\n');
}

function menuOS(os) {
  abrirModal(`
    <h3>OS ${numeroOS(os.numero)}</h3>
    <div class="botoes um">
      <button class="btn claro" data-m="editar">✏️ Editar cliente e serviço</button>
      <button class="btn claro" data-m="duplicar">📋 Duplicar OS (mesmo cliente)</button>
      <button class="btn claro" data-m="copiar">📄 Copiar texto do orçamento</button>
      <button class="btn perigo" data-m="excluir">🗑 Excluir OS</button>
      <button class="btn" data-m="fechar">Fechar</button>
    </div>`);
  $$('[data-m]').forEach((b) => b.addEventListener('click', async () => {
    const m = b.dataset.m;
    fecharModal();
    if (m === 'editar') ir(`#/editar/${os.id}`);
    if (m === 'copiar') copiar(textoOrcamento(os));
    if (m === 'duplicar') {
      const nova = novaOS({ cliente: Object.assign({}, os.cliente), servico: Object.assign({}, os.servico, { descricao: '' }) });
      await salvarOS(nova);
      toast(`OS ${numeroOS(nova.numero)} criada`);
      ir(`#/os/${nova.id}`);
    }
    if (m === 'excluir') {
      if (!confirm(`Excluir a OS ${numeroOS(os.numero)} e todas as fotos? Não dá para desfazer.`)) return;
      for (const f of await fotosDa(os.id)) await dbDel('fotos', f.id);
      await dbDel('os', os.id);
      ordens = ordens.filter((o) => o.id !== os.id);
      toast('OS excluída');
      ir('#/');
    }
  }));
}

// ============================================================ nova / editar
function telaEditar(id) {
  const os = id ? acharOS(id) : null;
  if (id && !os) { ir('#/'); return; }
  const c = os ? os.cliente : { cidade: cfg.cidade || '' };
  const s = os ? os.servico : { urgencia: 'normal' };
  app.innerHTML = `
    ${topo(os ? `Editar ${numeroOS(os.numero)}` : 'Nova OS', true)}
    <main class="conteudo">
      <form id="form-os">
        <div class="card">
          <h2>Cliente</h2>
          <label class="campo"><span>Nome *</span><input type="text" name="nome" required value="${esc(c.nome)}" autocomplete="off"></label>
          <label class="campo"><span>Telefone / WhatsApp</span><input type="tel" name="telefone" value="${esc(c.telefone)}" placeholder="(11) 99999-9999"></label>
          <label class="campo"><span>Endereço</span><input type="text" name="endereco" value="${esc(c.endereco)}" placeholder="Rua, número, complemento"></label>
          <div class="linha">
            <label class="campo"><span>Bairro</span><input type="text" name="bairro" value="${esc(c.bairro)}"></label>
            <label class="campo"><span>Cidade</span><input type="text" name="cidade" value="${esc(c.cidade)}"></label>
          </div>
          <label class="campo"><span>Ponto de referência</span><input type="text" name="referencia" value="${esc(c.referencia)}"></label>
        </div>
        <div class="card">
          <h2>Serviço</h2>
          <label class="campo"><span>Tipo de serviço</span>
            <select name="tipo"><option value="">Selecione…</option>${TIPOS.map((t) => `<option ${s.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
            ${s.tipo && !TIPOS.includes(s.tipo) ? `<option selected>${esc(s.tipo)}</option>` : ''}</select></label>
          <label class="campo"><span>Descrição do problema</span><textarea name="descricao">${esc(s.descricao)}</textarea></label>
          <label class="campo"><span>Urgência</span>
            <select name="urgencia">${Object.entries(URGENCIA).map(([k, v]) => `<option value="${k}" ${s.urgencia === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="campo"><span>Melhor dia / horário</span><input type="text" name="preferencia" value="${esc(s.preferencia)}" placeholder="Ex.: sábado de manhã"></label>
        </div>
        <button class="btn amarelo bloco" type="submit">${os ? 'Salvar alterações' : 'Criar OS'}</button>
      </form>
    </main>`;

  $('#form-os').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const alvo = os || novaOS();
    Object.assign(alvo.cliente, { nome: f.nome.trim(), telefone: f.telefone.trim(), endereco: f.endereco.trim(), bairro: f.bairro.trim(), cidade: f.cidade.trim(), referencia: f.referencia.trim() });
    Object.assign(alvo.servico, { tipo: f.tipo, descricao: f.descricao.trim(), urgencia: f.urgencia, preferencia: f.preferencia.trim() });
    if (os) registrar(alvo, 'Dados do cliente/serviço editados');
    await salvarOS(alvo);
    toast(os ? 'Salvo' : `OS ${numeroOS(alvo.numero)} criada`);
    ir(`#/os/${alvo.id}`);
  });
}

// ============================================================ documento PDF
async function telaDoc(id, tipo) {
  const os = acharOS(id);
  if (!os) { ir('#/'); return; }
  const recibo = tipo === 'recibo';
  const t = calcular(os);
  const c = os.cliente;
  const fotos = (!recibo && os.fotosNoPdf) ? (await fotosDa(id)).sort((a, b) => a.em - b.em) : [];
  const titulo = `${recibo ? 'Recibo' : 'Orçamento'} ${numeroOS(os.numero)}`;
  const validade = new Date(Date.now() + (num(cfg.validadeDias) || 7) * 864e5);

  app.innerHTML = `
    <div class="doc-barra">
      <button class="btn claro" data-a="voltar">← Voltar</button>
      <button class="btn amarelo" data-a="imprimir" data-v="${esc(titulo)}">🖨️ Salvar PDF / Imprimir</button>
    </div>
    <article class="doc">
      <div class="cab">
        <div>
          <div class="marca"><span class="raio">⚡</span> ${esc(cfg.nome || 'Serviços Elétricos')}</div>
          ${cfg.documento ? `<div>CPF/CNPJ: ${esc(cfg.documento)}</div>` : ''}
          ${cfg.whats ? `<div>WhatsApp: ${esc(fmtTel(cfg.whats))}</div>` : ''}
          ${cfg.cidade ? `<div>${esc(cfg.cidade)}</div>` : ''}
        </div>
        <div class="tit"><b>${recibo ? 'RECIBO' : 'ORÇAMENTO'}</b>
          Nº ${numeroOS(os.numero).slice(1)}<br>Emitido em ${data(Date.now())}
          ${recibo ? '' : `<br>Válido até ${data(validade)}`}</div>
      </div>

      <h4>Cliente</h4>
      <div><b>${esc(c.nome)}</b>${c.telefone ? ' · ' + esc(fmtTel(c.telefone)) : ''}</div>
      <div>${esc([c.endereco, c.bairro, c.cidade].filter(Boolean).join(', '))}</div>

      <h4>Serviço</h4>
      <div><b>${esc(os.servico.tipo || '')}</b></div>
      ${os.servico.descricao ? `<div>${esc(os.servico.descricao).replace(/\n/g, '<br>')}</div>` : ''}
      ${os.diagnostico ? `<div style="margin-top:6px"><b>Diagnóstico:</b> ${esc(os.diagnostico).replace(/\n/g, '<br>')}</div>` : ''}

      ${os.horas.length ? `<h4>Mão de obra</h4>
      <table><tr><th>Descrição</th><th class="n">Tempo</th><th class="n">R$/h</th><th class="n">Subtotal</th></tr>
        ${os.horas.map((h) => `<tr><td>${esc(h.descricao || 'Mão de obra')}<br><small>${data(h.data)}</small></td><td class="n">${hm(h.minutos)}</td>
          <td class="n">${brl(h.valorHora)}</td><td class="n">${brl(h.minutos / 60 * num(h.valorHora))}</td></tr>`).join('')}
        ${t.minimoAplicado ? `<tr><td colspan="3">Valor mínimo de visita aplicado</td><td class="n">${brl(t.maoObra)}</td></tr>` : ''}
      </table>` : ''}

      ${os.materiais.length ? `<h4>Materiais e equipamentos</h4>
      <table><tr><th>Item</th><th class="n">Qtd</th><th class="n">Unit.</th><th class="n">Subtotal</th></tr>
        ${os.materiais.map((m) => `<tr><td>${esc(m.nome)}${m.doCliente ? ' <small>(fornecido pelo cliente)</small>' : ''}</td>
          <td class="n">${fmtNum(m.qtd)}</td><td class="n">${m.doCliente ? '—' : brl(m.valor)}</td>
          <td class="n">${m.doCliente ? '—' : brl(num(m.qtd) * num(m.valor))}</td></tr>`).join('')}
      </table>` : ''}

      <div class="totais">
        <div><span>Mão de obra</span><span>${brl(t.maoObra)}</span></div>
        <div><span>Materiais</span><span>${brl(t.materiais)}</span></div>
        ${t.desloc ? `<div><span>Deslocamento</span><span>${brl(t.desloc)}</span></div>` : ''}
        ${t.desc ? `<div><span>Desconto</span><span>− ${brl(t.desc)}</span></div>` : ''}
        <div class="g"><span>TOTAL</span><span>${brl(t.total)}</span></div>
      </div>

      ${recibo ? `<h4>Declaração</h4>
        <div>Recebi de <b>${esc(c.nome)}</b> a importância de <b>${brl(t.total)}</b> referente aos serviços elétricos descritos acima
        ${os.pagamento.forma ? `, pagos via <b>${esc(os.pagamento.forma)}</b>` : ''}${os.pagamento.em ? ` em ${data(os.pagamento.em)}` : ''}.</div>` : ''}

      ${os.observacoes ? `<h4>Observações</h4><div>${esc(os.observacoes).replace(/\n/g, '<br>')}</div>` : ''}
      ${(cfg.garantia || cfg.pix) ? `<h4>Condições</h4>
        ${cfg.garantia ? `<div>${esc(cfg.garantia)}</div>` : ''}
        ${cfg.pix && !recibo ? `<div>Pagamento via PIX: <b>${esc(cfg.pix)}</b></div>` : ''}` : ''}

      ${fotos.length ? `<h4>Registro fotográfico</h4>
        <div class="fotos-doc">${fotos.map((f) => `<figure><img src="${f.data}" alt=""><figcaption>${esc(f.legenda)}</figcaption></figure>`).join('')}</div>` : ''}

      <div class="assin">
        <div>${esc(cfg.nome || 'Responsável técnico')}</div>
        <div>${recibo ? 'Cliente' : 'De acordo — ' + esc(c.nome)}</div>
      </div>
      <div class="rodape">Documento gerado pelo app Elétrica OS · ${dataHora(Date.now())}</div>
    </article>`;
}

// ============================================================ configurações
function telaConfig() {
  app.innerHTML = `
    ${topo('Configurações', true)}
    <main class="conteudo">
      <form id="form-cfg">
        <div class="card">
          <h2>Seus dados</h2>
          <label class="campo"><span>Nome / empresa</span><input type="text" name="nome" value="${esc(cfg.nome)}" placeholder="Ex.: João Eletricista"></label>
          <label class="campo"><span>Seu WhatsApp (recebe os pedidos)</span><input type="tel" name="whats" value="${esc(cfg.whats)}" placeholder="(11) 99999-9999"></label>
          <div class="linha">
            <label class="campo"><span>CPF / CNPJ</span><input type="text" name="documento" value="${esc(cfg.documento)}"></label>
            <label class="campo"><span>Cidade</span><input type="text" name="cidade" value="${esc(cfg.cidade)}"></label>
          </div>
          <label class="campo"><span>Chave PIX</span><input type="text" name="pix" value="${esc(cfg.pix)}"></label>
        </div>
        <div class="card">
          <h2>Preços</h2>
          <div class="linha">
            <label class="campo"><span>Valor da hora (R$)</span><input type="text" inputmode="decimal" name="valorHora" value="${fmtNum(cfg.valorHora)}"></label>
            <label class="campo"><span>Visita mínima (R$)</span><input type="text" inputmode="decimal" name="visitaMinima" value="${fmtNum(cfg.visitaMinima)}"></label>
          </div>
          <div class="linha">
            <label class="campo"><span>Deslocamento padrão (R$)</span><input type="text" inputmode="decimal" name="deslocamento" value="${fmtNum(cfg.deslocamento)}"></label>
            <label class="campo"><span>Validade orçamento (dias)</span><input type="text" inputmode="numeric" name="validadeDias" value="${esc(cfg.validadeDias)}"></label>
          </div>
          <label class="campo"><span>Garantia / condições (vai no orçamento)</span><textarea name="garantia">${esc(cfg.garantia)}</textarea></label>
          <label class="campo"><span>Catálogo de materiais (um por linha: nome;preço)</span><textarea name="catalogo" style="min-height:160px">${esc(cfg.catalogo)}</textarea></label>
        </div>
        <div class="card">
          <h2>Link para clientes</h2>
          <label class="campo"><span>Endereço do formulário</span><input type="text" name="linkBase" value="${esc(cfg.linkBase)}"></label>
          <div class="mono" id="link-prev">${esc(linkCliente())}</div>
          <p class="vazio">O cliente abre o link, preenche o pedido e ele chega no seu WhatsApp. Toque no link da mensagem para criar a OS aqui no app.</p>
        </div>
        <button class="btn amarelo bloco" type="submit">Salvar configurações</button>
      </form>

      <div class="card" style="margin-top:12px">
        <h2>Backup</h2>
        <p class="vazio">Os dados ficam só neste celular. Faça backup de vez em quando (inclui fotos).</p>
        <div class="botoes">
          <button class="btn claro" data-a="backup">💾 Exportar</button>
          <button class="btn claro" data-a="restaurar">📂 Restaurar</button>
        </div>
        <input type="file" id="in-backup" accept="application/json,.json" class="oculto">
      </div>
    </main>`;

  $('#form-cfg').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    ['valorHora', 'visitaMinima', 'deslocamento', 'validadeDias'].forEach((k) => { f[k] = num(f[k]); });
    Object.assign(cfg, f);
    salvarCfg();
    toast('Configurações salvas');
    ir('#/');
  });
  $('#in-backup').addEventListener('change', (e) => restaurar(e.target.files[0]));
}

async function exportarBackup() {
  toast('Gerando backup…');
  const dados = { app: 'eletricaos', versao: 1, em: Date.now(), cfg, os: await dbTodos('os'), fotos: await dbTodos('fotos') };
  const json = JSON.stringify(dados);
  const d = new Date();
  const nome = `eletricaos-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  if (nativo) {
    const onde = nativo.saveFile(nome, 'application/json', json);
    toast(onde ? `Backup salvo em ${onde}` : 'Erro ao salvar backup');
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = nome;
    a.click();
  }
}

async function restaurar(arquivo) {
  if (!arquivo) return;
  try {
    const dados = JSON.parse(await arquivo.text());
    if (dados.app !== 'eletricaos') throw new Error('arquivo inválido');
    if (!confirm(`Restaurar ${dados.os.length} OS e ${dados.fotos.length} fotos? OS com o mesmo código serão substituídas.`)) return;
    for (const o of dados.os) await dbPut('os', o);
    for (const f of dados.fotos) await dbPut('fotos', f);
    cfg = Object.assign({}, CFG_PADRAO, dados.cfg, { seq: Math.max(cfg.seq || 0, (dados.cfg && dados.cfg.seq) || 0) });
    salvarCfg();
    ordens = await dbTodos('os');
    toast('Backup restaurado!');
    ir('#/');
  } catch (e) {
    toast('Não foi possível ler o backup');
  }
}

// ============================================================ importar
function telaImportar() {
  app.innerHTML = `
    ${topo('Importar pedido', true)}
    <main class="conteudo">
      <div class="dica">Quando o cliente preenche o seu link, chega uma mensagem no seu WhatsApp com um link
        <b>“Abrir no app”</b>. Toque nele e a OS é criada sozinha.<br><br>
        Se preferir, copie a mensagem inteira do WhatsApp e cole aqui embaixo.</div>
      <div class="card">
        <label class="campo"><span>Mensagem do cliente</span><textarea id="txt-imp" style="min-height:160px" placeholder="Cole aqui a mensagem recebida"></textarea></label>
        <button class="btn amarelo bloco" data-a="fazer-import">📥 Criar OS a partir da mensagem</button>
      </div>
      <div class="card">
        <h2>Seu link para clientes</h2>
        <div class="mono">${esc(linkCliente())}</div>
        <div class="botoes" style="margin-top:10px">
          <button class="btn whats" data-a="enviar-link">📲 Enviar</button>
          <button class="btn claro" data-a="copiar-link">📋 Copiar</button>
        </div>
      </div>
    </main>`;
}

// ============================================================ modal
function abrirModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="caixa">${html}</div>`;
  m.classList.remove('hidden');
}
function fecharModal() {
  const m = $('#modal');
  m.classList.add('hidden');
  m.innerHTML = '';
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });

// ============================================================ ações
function definirCampo(obj, caminho, valor) {
  const partes = caminho.split('.');
  const ult = partes.pop();
  partes.reduce((o, p) => o[p], obj)[ult] = valor;
}

app.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const os = acharOS(app.dataset.os);
  if (!os) return;
  const campo = el.dataset.f;
  let valor;
  if (el.type === 'checkbox') valor = el.checked;
  else if (campo === 'agendamento') valor = el.value ? new Date(el.value).getTime() : null;
  else if (campo === 'deslocamento' || campo === 'desconto') valor = num(el.value);
  else valor = el.value;
  definirCampo(os, campo, valor);

  if (campo === 'agendamento' && valor) {
    registrar(os, `Agendado para ${dataHora(valor)}`);
    if (os.status === 'nova') os.status = 'agendada';
  }
  if (campo === 'pagamento.pago') {
    os.pagamento.em = valor ? Date.now() : null;
    registrar(os, valor ? 'Pagamento recebido' : 'Pagamento desmarcado');
  }
  await salvarOS(os);
  if (campo === 'agendamento' || campo === 'pagamento.pago') telaOS(os.id);
  else { const r = $('#resumo'); if (r) r.innerHTML = resumoHTML(os); }
});

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  const v = el.dataset.v;
  const os = acharOS(app.dataset.os);

  switch (a) {
    case 'voltar': window.goBack(); break;
    case 'config': ir('#/config'); break;
    case 'nova': ir('#/nova'); break;
    case 'importar': ir('#/importar'); break;
    case 'filtro': filtro = v; telaInicio(); break;
    case 'enviar-link':
      if (!cfg.whats) { toast('Cadastre seu WhatsApp nas configurações'); ir('#/config'); break; }
      compartilhar(`Olá! 👋 Para solicitar um serviço elétrico${cfg.nome ? ' com ' + cfg.nome : ''}, é só preencher este formulário rapidinho:\n\n${linkCliente()}`);
      break;
    case 'copiar-link': copiar(linkCliente()); break;
    case 'fazer-import': importarPedido($('#txt-imp').value); break;
    case 'backup': exportarBackup(); break;
    case 'restaurar': $('#in-backup').click(); break;
    case 'imprimir':
      if (nativo) nativo.print(v); else window.print();
      break;
  }
  if (!os || !location.hash.startsWith('#/os/')) return;

  switch (a) {
    case 'menu-os': menuOS(os); break;
    case 'editar': ir(`#/editar/${os.id}`); break;
    case 'ligar': abrirUrl(`tel:${digitos(os.cliente.telefone)}`); break;
    case 'whats': whatsapp(os.cliente.telefone, `Olá ${os.cliente.nome.split(' ')[0]}, aqui é ${cfg.nome || 'o eletricista'} sobre a OS ${numeroOS(os.numero)}.`); break;
    case 'mapa': abrirUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([os.cliente.endereco, os.cliente.bairro, os.cliente.cidade].filter(Boolean).join(', '))}`); break;
    case 'status':
      if (os.status === v) break;
      registrar(os, `Status: ${statusDe(os.status).nome} → ${statusDe(v).nome}`);
      os.status = v;
      await salvarOS(os);
      telaOS(os.id);
      break;
    case 'timer':
      if (os.timer) {
        const minutos = Math.max(1, Math.round((Date.now() - os.timer.inicio) / 60000));
        os.horas.push({ id: uid(), data: os.timer.inicio, descricao: 'Atendimento', minutos, valorHora: num(cfg.valorHora) });
        registrar(os, `Atendimento finalizado (${hm(minutos)})`);
        os.timer = null;
        toast(`${hm(minutos)} lançadas na mão de obra`);
      } else {
        os.timer = { inicio: Date.now() };
        registrar(os, 'Atendimento iniciado');
        if (['nova', 'agendada', 'aprovada'].includes(os.status)) os.status = 'andamento';
      }
      await salvarOS(os);
      telaOS(os.id);
      break;
    case 'add-hora': {
      const minutos = Math.round(num($('#h-h').value) * 60 + num($('#h-m').value));
      if (!minutos) { toast('Informe as horas ou minutos'); break; }
      os.horas.push({ id: uid(), data: Date.now(), descricao: $('#h-desc').value.trim(), minutos, valorHora: num($('#h-v').value) || num(cfg.valorHora) });
      registrar(os, `Lançadas ${hm(minutos)} de mão de obra`);
      await salvarOS(os);
      telaOS(os.id);
      break;
    }
    case 'del-hora':
      if (!confirm('Remover este lançamento de horas?')) break;
      os.horas = os.horas.filter((h) => h.id !== v);
      await salvarOS(os);
      telaOS(os.id);
      break;
    case 'add-mat': {
      const nome = $('#m-nome').value.trim();
      if (!nome) { toast('Informe o item'); break; }
      os.materiais.push({ id: uid(), nome, qtd: num($('#m-qtd').value) || 1, valor: num($('#m-valor').value), doCliente: $('#m-cliente').checked });
      await salvarOS(os);
      telaOS(os.id);
      break;
    }
    case 'del-mat':
      os.materiais = os.materiais.filter((m) => m.id !== v);
      await salvarOS(os);
      telaOS(os.id);
      break;
    case 'foto-camera': $('#in-camera').click(); break;
    case 'foto-galeria': $('#in-galeria').click(); break;
    case 'ver-foto': verFoto(os, v); break;
    case 'enviar-orc':
      whatsapp(os.cliente.telefone, textoOrcamento(os));
      if (['nova', 'agendada'].includes(os.status)) os.status = 'orcamento';
      registrar(os, 'Orçamento enviado pelo WhatsApp');
      await salvarOS(os);
      telaOS(os.id);
      break;
    case 'doc-orc': ir(`#/doc/${os.id}/orcamento`); break;
    case 'doc-rec': ir(`#/doc/${os.id}/recibo`); break;
  }
});

// preenche o preço ao escolher um item do catálogo
app.addEventListener('input', (e) => {
  if (e.target.id !== 'm-nome') return;
  const item = catalogo().find((i) => i.nome.toLowerCase() === e.target.value.trim().toLowerCase());
  if (item && item.valor) $('#m-valor').value = fmtNum(item.valor);
});

// ============================================================ início
(async function iniciar() {
  try {
    await abrirDB();
    ordens = await dbTodos('os');
  } catch (e) {
    app.innerHTML = `<div class="conteudo"><div class="card">Erro ao abrir o banco de dados: ${esc(e && e.message)}</div></div>`;
    return;
  }
  render();
  const pendente = nativo && nativo.getPendingLink && nativo.getPendingLink();
  if (pendente) importarPedido(pendente);
})();
