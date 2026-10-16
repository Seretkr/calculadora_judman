'use strict';
// Tela do Olho Intelbras. Tudo que vem do aparelho entra como texto (textContent), nunca como HTML.

const $ = (id) => document.getElementById(id);
const RECENTES = 'olho-recentes'; // só IP e usuário; senha nunca é guardada
const NATIVO = window.Olho; // existe quando a página roda dentro do app Android

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) e.append(f);
  return e;
}

// No app Android não há servidor: a consulta vai direto para o código Java do celular.
let seq = 0;
const pendentes = new Map();
window.__olho = (id, json) => {
  const f = pendentes.get(id);
  pendentes.delete(id);
  if (f) f(JSON.parse(json));
};

function apiNativa(caminho, corpo) {
  if (caminho !== '/api/consultar') return Promise.resolve({ ok: true, status: 200, dados: {} });
  return new Promise((res) => {
    const id = ++seq;
    pendentes.set(id, (d) => res({ ok: !d.erro, status: d.erro ? 400 : 200, dados: d }));
    NATIVO.consultar(id, JSON.stringify(corpo));
  });
}

async function api(caminho, corpo) {
  if (NATIVO) return apiNativa(caminho, corpo);
  const r = await fetch(caminho, corpo === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/api/entrar') mostrar('entrar');
  return { ok: r.ok, status: r.status, dados };
}

function mostrar(tela) {
  $('tela-entrar').hidden = tela !== 'entrar';
  $('tela-app').hidden = tela !== 'app';
  $('sair').hidden = tela !== 'app' || !!NATIVO;
  if (tela === 'entrar') $('senha-app').focus();
}

// ---------- entrar / sair ----------

$('form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('erro-entrar').textContent = '';
  const r = await api('/api/entrar', { senha: $('senha-app').value });
  if (!r.ok) { $('erro-entrar').textContent = r.dados.erro || 'Não foi possível entrar.'; return; }
  $('senha-app').value = '';
  mostrar('app');
  $('ip').focus();
});

$('sair').addEventListener('click', async () => {
  await api('/api/sair', {});
  $('resultado').replaceChildren();
  $('senha').value = '';
  mostrar('entrar');
});

// ---------- IPs recentes ----------

function lerRecentes() {
  try { return JSON.parse(localStorage.getItem(RECENTES)) || []; } catch { return []; }
}

function guardarRecente(ip, usuario) {
  const lista = [{ ip, usuario }, ...lerRecentes().filter((x) => x.ip !== ip)].slice(0, 8);
  try { localStorage.setItem(RECENTES, JSON.stringify(lista)); } catch { /* navegador sem armazenamento */ }
  desenharRecentes();
}

function desenharRecentes() {
  $('recentes').replaceChildren(...lerRecentes().map((x) => el('button', {
    type: 'button',
    onclick: () => { $('ip').value = x.ip; $('usuario').value = x.usuario || 'admin'; $('senha').focus(); },
  }, x.ip)));
}

// Aceita colar coisas como "http://192.168.1.108/" ou "rtsp://admin@192.168.1.108:554/..."
$('ip').addEventListener('paste', () => setTimeout(() => {
  const m = $('ip').value.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  if (m) $('ip').value = m[1];
}, 0));

// ---------- teste ----------

let consulta = null;

$('form-teste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ip = $('ip').value.trim();
  const botao = $('testar');
  botao.disabled = true;
  botao.textContent = 'Testando…';
  $('resultado').replaceChildren(el('p', { class: 'carregando' }, `Procurando ${ip} na rede…`));
  try {
    const r = await api('/api/consultar', {
      ip, usuario: $('usuario').value.trim(), senha: $('senha').value,
      portaHttp: $('porta-http').value, portaRtsp: $('porta-rtsp').value,
    });
    if (!r.ok) {
      $('resultado').replaceChildren(el('div', { class: 'cartao' }, el('p', { class: 'erro' }, r.dados.erro || 'Falha no teste.')));
      return;
    }
    guardarRecente(ip, $('usuario').value.trim());
    desenharResultado(r.dados);
  } catch {
    $('resultado').replaceChildren(el('div', { class: 'cartao' }, el('p', { class: 'erro' }, NATIVO ? 'Falha no teste.' : 'Sem contato com o servidor do app.')));
  } finally {
    botao.disabled = false;
    botao.textContent = 'Testar conexão';
  }
});

const ROTULO = { online: 'Funcionando', atencao: 'Atenção', senha: 'Senha recusada', offline: 'Sem conexão' };

function desenharResultado(r) {
  consulta = r;
  const info = el('dl', { class: 'info' });
  const linha = (k, v) => { if (v) info.append(el('dt', {}, k), el('dd', {}, String(v))); };
  linha('Tipo', r.tipo);
  linha('Modelo', r.modelo);
  linha('Nome', r.nome);
  linha('Nº de série', r.serie);
  if (r.rtsp && r.rtsp.ok) linha('Vídeo', `${r.rtsp.codec} · ${r.rtsp.ms} ms`);
  if (r.rtsp && r.rtsp.ok) linha('Link RTSP', r.rtsp.url);
  linha('Testado em', new Date(r.quando).toLocaleString('pt-BR'));

  const portas = el('ul', { class: 'portas' }, ...r.portas.map((p) => el('li', {},
    el('span', {}, el('span', { class: 'ponto' + (p.ok ? ' ok' : '') }), `${p.nome} · ${p.porta}`),
    el('span', { class: 'fraco' }, p.ok ? `${p.ms} ms` : p.erro))));

  const cartao = el('div', { class: 'cartao' },
    el('div', { class: 'cab' }, el('h2', {}, r.ip), el('span', { class: 'selo s-' + r.situacao }, ROTULO[r.situacao] || r.situacao)),
    el('p', {}, r.diagnostico),
    info.children.length ? info : null,
    portas,
    r.avisos && r.avisos.length ? el('ul', { class: 'avisos' }, ...r.avisos.map((a) => el('li', {}, a))) : null);

  const partes = [cartao];
  if (r.canais && r.token) {
    const grade = el('div', { class: 'grade' + (r.gravador ? '' : ' unica') }, ...r.canais.map((c) => quadroCanal(r, c)));
    partes.push(el('div', { class: 'barra-canais' },
      el('h2', {}, r.gravador ? `Canais (${r.canais.length})` : 'Imagem'),
      el('button', { type: 'button', onclick: () => grade.querySelectorAll('img').forEach(recarregar) }, 'Atualizar imagens')));
    partes.push(grade);
  }
  $('resultado').replaceChildren(...partes);
}

function urlImagem(r, canal) {
  return `/api/imagem/${r.token}/${canal}?t=${Date.now()}`;
}

function recarregar(img) {
  img.hidden = false;
  img.src = urlImagem(consulta, img.dataset.canal);
}

function quadroCanal(r, c) {
  const aviso = el('span', {}, c.semVideo ? 'Sem vídeo' : 'Carregando…');
  const img = el('img', { alt: c.nome, loading: 'lazy', 'data-canal': String(c.canal) });
  img.addEventListener('load', () => { aviso.textContent = ''; });
  img.addEventListener('error', () => { img.hidden = true; aviso.textContent = c.semVideo ? 'Sem vídeo' : 'Sem imagem'; });
  img.src = urlImagem(r, c.canal);
  return el('button', { type: 'button', class: 'canal', onclick: () => abrirVisor(c) },
    el('div', { class: 'quadro' }, aviso, img),
    el('div', { class: 'legenda' }, el('b', {}, c.nome || `Canal ${c.canal}`), el('span', { class: 'fraco' }, `CH ${c.canal}`)));
}

// ---------- visor em tela cheia ----------

let canalAberto = null;

function abrirVisor(c) {
  canalAberto = c;
  $('visor-titulo').textContent = `CH ${c.canal} · ${c.nome || ''}`;
  $('visor-img').src = urlImagem(consulta, c.canal);
  $('visor').showModal();
}
$('visor-atualizar').addEventListener('click', () => { if (canalAberto) $('visor-img').src = urlImagem(consulta, canalAberto.canal); });
$('visor-fechar').addEventListener('click', () => $('visor').close());

// ---------- início ----------

desenharRecentes();
api('/api/sessao').then((r) => mostrar(r.ok ? 'app' : 'entrar')).catch(() => mostrar('entrar'));
