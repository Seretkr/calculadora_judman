'use strict';
// Aba "Testar": cola o IP e mostra se é câmera (imagem) ou gravador (todos os canais).

const RECENTES = 'olho-recentes'; // só IP e usuário; senha nunca é guardada

// ---------- entrar / sair (só na versão com servidor) ----------

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
function soIp(campo) {
  campo.addEventListener('paste', () => setTimeout(() => {
    const m = campo.value.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (m) campo.value = m[1];
  }, 0));
}
soIp($('ip'));

// ---------- teste ----------

$('form-teste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pedido = {
    ip: $('ip').value.trim(), usuario: $('usuario').value.trim(), senha: $('senha').value,
    portaHttp: $('porta-http').value, portaRtsp: $('porta-rtsp').value,
  };
  const botao = $('testar');
  botao.disabled = true;
  botao.textContent = 'Testando…';
  $('resultado').replaceChildren(el('p', { class: 'carregando' }, `Procurando ${pedido.ip} na rede…`));
  try {
    const r = await api('/api/consultar', pedido);
    if (!r.ok) {
      $('resultado').replaceChildren(el('div', { class: 'cartao' }, el('p', { class: 'erro' }, r.dados.erro || 'Falha no teste.')));
      return;
    }
    guardarRecente(pedido.ip, pedido.usuario);
    desenharResultado(r.dados, $('resultado'), {
      cadastrar: NATIVO ? () => abrirCadastro(null, { ...pedido, consulta: r.dados }) : null,
    });
  } catch {
    $('resultado').replaceChildren(el('div', { class: 'cartao' },
      el('p', { class: 'erro' }, NATIVO ? 'Falha no teste.' : 'Sem contato com o servidor do app.')));
  } finally {
    botao.disabled = false;
    botao.textContent = 'Testar conexão';
  }
});

// Desenha o resultado de uma consulta. Usado na aba Testar e no detalhe do dispositivo.
function desenharResultado(r, destino, { cadastrar, titulo } = {}) {
  const info = el('dl', { class: 'info' });
  const linha = (k, v) => { if (v) info.append(el('dt', {}, k), el('dd', {}, String(v))); };
  linha('Tipo', r.tipo);
  linha('Modelo', r.modelo);
  linha('Nome', r.nome);
  linha('Nº de série', r.serie);
  linha('MAC', r.mac);
  if (r.rtsp && r.rtsp.ok) linha('Vídeo', `${r.rtsp.codec} · ${r.rtsp.ms} ms`);
  if (r.rtsp && r.rtsp.ok) linha('Link RTSP', r.rtsp.url);
  linha('Testado em', new Date(r.quando).toLocaleString('pt-BR'));

  const portas = el('ul', { class: 'portas' }, ...(r.portas || []).map((p) => el('li', {},
    el('span', {}, el('span', { class: 'ponto' + (p.ok ? ' ok' : '') }), `${p.nome} · ${p.porta}`),
    el('span', { class: 'fraco' }, p.ok ? `${p.ms} ms` : p.erro))));

  const cartao = el('div', { class: 'cartao' },
    el('div', { class: 'cab' }, el('h2', {}, titulo || r.ip), selo(r.situacao)),
    el('p', {}, r.diagnostico),
    info.children.length ? info : null,
    portas,
    r.avisos && r.avisos.length ? el('ul', { class: 'avisos' }, ...r.avisos.map((a) => el('li', {}, a))) : null,
    cadastrar && r.token ? el('button', { type: 'button', class: 'principal espaco', onclick: cadastrar }, 'Cadastrar este dispositivo') : null);

  const partes = [cartao];
  if (r.canais && r.token) {
    const grade = el('div', { class: 'grade' + (r.gravador ? '' : ' unica') }, ...r.canais.map((c) => quadro({
      token: r.token, canal: c.canal, titulo: c.nome || `Canal ${c.canal}`, sub: `CH ${c.canal}`, semVideo: c.semVideo,
    })));
    partes.push(el('div', { class: 'barra-canais' },
      el('h2', {}, r.gravador ? `Câmeras do gravador (${r.canais.length})` : 'Imagem'),
      el('button', { type: 'button', onclick: () => recarregarImagens(grade) }, 'Atualizar imagens')));
    partes.push(grade);
  }
  destino.replaceChildren(...partes);
}
