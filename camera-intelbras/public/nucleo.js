'use strict';
// Base do Olho Intelbras: atalhos de tela, conversa com o app Android (ou com o servidor) e navegação.
// Tudo que vem do aparelho entra como texto (textContent), nunca como HTML.

const $ = (id) => document.getElementById(id);
const NATIVO = window.Olho; // existe quando a página roda dentro do app Android

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos) if (f != null && f !== false) e.append(f);
  return e;
}

// ---------- conversa com o app Android ----------

let seq = 0;
const pendentes = new Map();
const ouvintes = new Map();

window.__olho = (id, json) => {
  const f = pendentes.get(id);
  pendentes.delete(id);
  ouvintes.delete(id);
  if (f) f(JSON.parse(json));
};
window.__olhoEvento = (id, json) => {
  const f = ouvintes.get(id);
  if (f) f(JSON.parse(json));
};

// Chama um método Java assíncrono. aoEvento recebe as mensagens intermediárias (scanner).
function nativo(metodo, corpo, aoEvento) {
  const id = ++seq;
  const promessa = new Promise((res) => {
    pendentes.set(id, res);
    if (aoEvento) ouvintes.set(id, aoEvento);
    NATIVO[metodo](id, JSON.stringify(corpo));
  });
  promessa.id = id;
  return promessa;
}

async function api(caminho, corpo) {
  if (NATIVO) {
    const metodo = { '/api/consultar': 'consultar', '/api/diagnostico': 'diagnosticar' }[caminho];
    if (!metodo) return { ok: true, status: 200, dados: {} };
    const d = await nativo(metodo, corpo);
    return { ok: !d.erro, status: d.erro ? 400 : 200, dados: d };
  }
  const r = await fetch(caminho, corpo === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/api/entrar') mostrar('entrar');
  return { ok: r.ok, status: r.status, dados };
}

// ---------- utilidades ----------

function numeroIp(ip) {
  return String(ip).split('.').reduce((n, p) => n * 256 + Number(p), 0);
}
const porIp = (a, b) => numeroIp(a.ip) - numeroIp(b.ip);

function urlImagem(token, canal) {
  return `/api/imagem/${token}/${canal}?t=${Date.now()}`;
}

// Reduz a foto antes de guardar (foto de celular tem 4 MB; aqui fica com ~200 KB).
async function reduzirImagem(blob, max = 1280, qualidade = 0.8) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res) => c.toBlob(res, 'image/jpeg', qualidade));
}

async function baixarImagem(token, canal = 1) {
  const r = await fetch(urlImagem(token, canal));
  if (!r.ok) throw new Error(await r.text());
  return reduzirImagem(await r.blob(), 960, 0.75);
}

const urlsBlob = new Map();
function urlDeBlob(chave, blob) {
  if (urlsBlob.has(chave)) URL.revokeObjectURL(urlsBlob.get(chave));
  const u = URL.createObjectURL(blob);
  urlsBlob.set(chave, u);
  return u;
}

function quando(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

const ROTULO = { online: 'Funcionando', atencao: 'Atenção', senha: 'Senha recusada', offline: 'Sem conexão',
  semweb: 'Sem página web', desconhecido: 'Não reconhecido' };

function selo(situacao) {
  return el('span', { class: 'selo s-' + (situacao || 'nenhum') }, ROTULO[situacao] || 'Não testado');
}

// Quadro de imagem de um canal: usado no resultado, no scanner e no mosaico.
function quadro({ token, canal = 1, titulo, sub, semVideo, aoTocar }) {
  const aviso = el('span', {}, semVideo ? 'Sem vídeo' : 'Carregando…');
  const img = el('img', { alt: titulo || '', loading: 'lazy' });
  img.dataset.token = token;
  img.dataset.canal = String(canal);
  img.addEventListener('load', () => { aviso.textContent = ''; });
  img.addEventListener('error', () => { img.hidden = true; aviso.textContent = semVideo ? 'Sem vídeo' : 'Sem imagem'; });
  img.src = urlImagem(token, canal);
  return el('button', {
    type: 'button', class: 'canal',
    onclick: aoTocar || (() => abrirVisor({ token, canal, titulo: `${titulo || ''}${sub ? ' · ' + sub : ''}` })),
  },
  el('div', { class: 'quadro' }, aviso, img),
  el('div', { class: 'legenda' }, el('b', {}, titulo || `Canal ${canal}`), el('span', { class: 'fraco' }, sub || `CH ${canal}`)));
}

function recarregarImagens(raiz) {
  raiz.querySelectorAll('img[data-token]').forEach((img) => {
    img.hidden = false;
    img.src = urlImagem(img.dataset.token, img.dataset.canal);
  });
}

// ---------- visor em tela cheia ----------

let noVisor = null;

function abrirVisor({ token, canal, titulo, url }) {
  noVisor = { token, canal };
  $('visor-titulo').textContent = titulo || '';
  $('visor-img').src = url || urlImagem(token, canal);
  $('visor-atualizar').hidden = !!url;
  $('visor').showModal();
}
$('visor-atualizar').addEventListener('click', () => {
  if (noVisor && noVisor.token) $('visor-img').src = urlImagem(noVisor.token, noVisor.canal);
});
$('visor-fechar').addEventListener('click', () => $('visor').close());

// ---------- navegação: abas embaixo, telas por cima ----------

const TITULOS = { testar: 'Olho Intelbras', scanner: 'Scanner', dispositivos: 'Meus dispositivos' };
let abaAtual = 'testar';
const pilha = []; // telas abertas por cima da aba: { id, titulo, aoFechar }

function mostrar(tela) {
  $('tela-entrar').hidden = tela !== 'entrar';
  $('tela-app').hidden = tela !== 'app';
  $('sair').hidden = tela !== 'app' || !!NATIVO;
  $('abas').hidden = tela !== 'app' || !NATIVO;
  document.body.classList.toggle('com-abas', tela === 'app' && !!NATIVO);
  if (tela === 'entrar') $('senha-app').focus();
}

function atualizarTopo() {
  const topo = pilha[pilha.length - 1];
  $('voltar-topo').hidden = !topo;
  $('marca').querySelector('img').hidden = !!topo;
  $('titulo-topo').textContent = topo ? topo.titulo : TITULOS[abaAtual];
}

function abrirAba(nome) {
  while (pilha.length) fecharTela();
  abaAtual = nome;
  for (const s of document.querySelectorAll('.aba')) s.hidden = s.id !== 'aba-' + nome;
  for (const b of document.querySelectorAll('#abas button')) b.classList.toggle('ativo', b.dataset.aba === nome);
  atualizarTopo();
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('aba', { detail: nome }));
}

function abrirTela(id, titulo, aoFechar) {
  const atual = pilha[pilha.length - 1];
  if (atual && atual.id === id) { atual.titulo = titulo; atualizarTopo(); return; }
  if (atual) $(atual.id).hidden = true; else $('aba-' + abaAtual).hidden = true;
  pilha.push({ id, titulo, aoFechar, rolagem: window.scrollY });
  $(id).hidden = false;
  atualizarTopo();
  window.scrollTo(0, 0);
}

function fecharTela() {
  const t = pilha.pop();
  if (!t) return;
  $(t.id).hidden = true;
  const prox = pilha[pilha.length - 1];
  $(prox ? prox.id : 'aba-' + abaAtual).hidden = false;
  atualizarTopo();
  window.scrollTo(0, t.rolagem || 0);
  if (t.aoFechar) t.aoFechar();
}

// Chamado pelo botão voltar do Android. Devolve true se tratou.
window.voltar = () => {
  if ($('visor').open) { $('visor').close(); return true; }
  if (pilha.length) { fecharTela(); return true; }
  if (abaAtual !== 'testar') { abrirAba('testar'); return true; }
  return false;
};

$('voltar-topo').addEventListener('click', fecharTela);
for (const b of document.querySelectorAll('#abas button')) b.addEventListener('click', () => abrirAba(b.dataset.aba));
