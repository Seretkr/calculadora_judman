'use strict';
// Aba "Dispositivos": cadastro com imagem da câmera, foto da instalação, teste e mosaico de todos.

const tokens = new Map(); // id do dispositivo -> { token, quando } da última consulta (imagens ao vivo)
const TOKEN_MS = 25 * 60 * 1000;

const pedidoDe = (d) => ({ ip: d.ip, usuario: d.usuario, senhaCifrada: d.senhaCifrada || '', portaHttp: d.portaHttp, portaRtsp: d.portaRtsp });
const qtdCanais = (c) => (Array.isArray(c) ? c.length : Number(c) || 1);

// Testa um dispositivo cadastrado e guarda a situação e os dados novos.
async function testarDispositivo(d) {
  const r = await nativo('consultar', pedidoDe(d));
  if (r.erro) return r;
  d.ultimoTeste = { situacao: r.situacao, quando: r.quando };
  if (r.modelo) Object.assign(d, { modelo: r.modelo, tipo: r.tipo, gravador: !!r.gravador, serie: r.serie || d.serie, mac: r.mac || d.mac });
  if (r.canais) d.canais = qtdCanais(r.canais);
  if (r.token) tokens.set(d.id, { token: r.token, quando: Date.now() });
  await banco.salvar(d);
  return r;
}

// ---------- lista ----------

async function desenharLista() {
  const termo = $('busca').value.trim().toLowerCase();
  const todos = await banco.listar();
  const lista = todos.filter((d) => !termo || [d.nome, d.ip, d.local, d.modelo].join(' ').toLowerCase().includes(termo));
  if (!todos.length) {
    $('lista-dispositivos').replaceChildren(el('div', { class: 'cartao vazio' },
      el('p', {}, 'Nenhum dispositivo cadastrado ainda.'),
      el('p', { class: 'fraco pequeno' }, 'Toque em "+ Novo", ou use o Scanner para achar as câmeras da rede e cadastrar direto da lista.')));
    return;
  }
  $('lista-dispositivos').replaceChildren(...lista.map((d) => el('button', { type: 'button', class: 'cartao dispositivo', onclick: () => abrirDetalhe(d.id) },
    d.fotoCadastro ? el('img', { class: 'miniatura', src: urlDeBlob('cad-' + d.id, d.fotoCadastro), alt: '' })
      : el('div', { class: 'miniatura vazia' }, d.gravador ? 'DVR' : 'CAM'),
    el('div', { class: 'texto' },
      el('b', {}, d.nome),
      el('span', { class: 'fraco pequeno' }, [d.ip, d.local].filter(Boolean).join(' · ')),
      el('span', { class: 'fraco pequeno' }, [d.gravador ? `Gravador · ${d.canais || 1} canais` : 'Câmera', d.modelo].filter(Boolean).join(' · '))),
    selo(d.ultimoTeste && d.ultimoTeste.situacao))));
}

$('busca').addEventListener('input', desenharLista);
document.addEventListener('aba', (e) => { if (e.detail === 'dispositivos') desenharLista(); });
$('novo').addEventListener('click', () => abrirCadastro(null, {}));
$('backup').addEventListener('click', () => abrirTela('tela-backup', 'Backup e exportação'));

async function testarVarios(lista, aoAndar) {
  let feitos = 0;
  const fila = [...lista];
  const trabalhador = async () => {
    for (let d = fila.shift(); d; d = fila.shift()) {
      await testarDispositivo(d).catch(() => null);
      aoAndar(++feitos, lista.length);
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
}

$('testar-todos').addEventListener('click', async (e) => {
  const lista = await banco.listar();
  if (!lista.length) return;
  e.target.disabled = true;
  await testarVarios(lista, (f, t) => { $('disp-status').textContent = `Testando ${f} de ${t}…`; });
  const todos = await banco.listar();
  const ok = todos.filter((d) => d.ultimoTeste && d.ultimoTeste.situacao === 'online').length;
  $('disp-status').textContent = `${ok} de ${todos.length} funcionando · ${quando(new Date().toISOString())}`;
  e.target.disabled = false;
  desenharLista();
});

$('mosaico-todos').addEventListener('click', async (e) => {
  const lista = await banco.listar();
  if (!lista.length) return;
  const vencidos = lista.filter((d) => !tokens.has(d.id) || Date.now() - tokens.get(d.id).quando > TOKEN_MS);
  if (vencidos.length) {
    e.target.disabled = true;
    await testarVarios(vencidos, (f, t) => { $('disp-status').textContent = `Conectando ${f} de ${t}…`; });
    e.target.disabled = false;
    $('disp-status').textContent = '';
    desenharLista();
  }
  const itens = [];
  for (const d of lista) {
    const t = tokens.get(d.id);
    if (!t) continue;
    const canais = d.gravador ? d.canais || 1 : 1;
    for (let c = 1; c <= canais; c++) {
      itens.push({ token: t.token, canal: c, titulo: d.gravador ? `${d.nome} · CH ${c}` : d.nome, sub: d.ip });
    }
  }
  if (!itens.length) { $('disp-status').textContent = 'Nenhum dispositivo respondeu.'; return; }
  abrirMosaico('Todos os dispositivos', itens);
});

// ---------- detalhe ----------

async function abrirDetalhe(id) {
  const d = await banco.obter(id);
  if (!d) return;
  const area = el('div');
  const info = el('dl', { class: 'info' });
  const linha = (k, v) => { if (v) info.append(el('dt', {}, k), el('dd', {}, String(v))); };
  linha('Tipo', d.gravador ? `Gravador · ${d.canais || 1} canais` : 'Câmera');
  linha('Modelo', d.modelo);
  linha('IP', d.ip);
  linha('Local', d.local);
  linha('MAC', d.mac);
  linha('Nº de série', d.serie);
  linha('Usuário', d.usuario);
  linha('Cadastrado em', quando(d.criado));
  linha('Último teste', d.ultimoTeste && `${ROTULO[d.ultimoTeste.situacao] || ''} · ${quando(d.ultimoTeste.quando)}`);

  const foto = (blob, chave, rotulo) => el('figure', {},
    blob ? el('button', { type: 'button', class: 'foto', onclick: () => abrirVisor({ url: urlDeBlob(chave, blob), titulo: `${d.nome} · ${rotulo}` }) },
      el('img', { src: urlDeBlob(chave, blob), alt: rotulo }))
      : el('div', { class: 'foto-vazia' }, 'Sem foto'),
    el('figcaption', {}, rotulo));

  const testar = el('button', { type: 'button', class: 'principal', onclick: async () => {
    testar.disabled = true;
    testar.textContent = 'Testando…';
    area.replaceChildren(el('p', { class: 'carregando' }, `Conectando em ${d.ip}…`));
    const r = await testarDispositivo(d);
    if (r.erro) area.replaceChildren(el('p', { class: 'erro' }, r.erro));
    else desenharResultado(r, area, { titulo: d.nome, pedido: pedidoDe(d) });
    testar.disabled = false;
    testar.textContent = 'Testar agora';
  } }, 'Testar agora');

  $('tela-detalhe').replaceChildren(
    el('div', { class: 'cartao' },
      el('div', { class: 'cab' }, el('h2', {}, d.nome), selo(d.ultimoTeste && d.ultimoTeste.situacao)),
      el('div', { class: 'fotos' }, foto(d.fotoCadastro, 'cad-' + d.id, 'Imagem da câmera'), foto(d.fotoInstalacao, 'inst-' + d.id, 'Foto da instalação')),
      info,
      d.obs ? el('p', { class: 'obs' }, d.obs) : null,
      testar,
      el('div', { class: 'botoes espaco' },
        el('button', { type: 'button', onclick: () => abrirCadastro(d.id, {}, () => { fecharTela(); abrirDetalhe(d.id); }) }, 'Editar'),
        el('button', { type: 'button', class: 'perigo', onclick: async () => {
          if (!confirm(`Excluir "${d.nome}"? As fotos também serão apagadas.`)) return;
          await banco.apagar(d.id);
          tokens.delete(d.id);
          fecharTela();
          desenharLista();
        } }, 'Excluir'))),
    area);
  abrirTela('tela-detalhe', d.nome, desenharLista);
  testar.click(); // já mostra a imagem ao vivo
}

// ---------- cadastro / edição ----------

const form = { atual: null, consulta: null, fotoCadastro: null, fotoInstalacao: null, aoSalvar: null };

function mostrarFoto(id, blob, vazio) {
  $(id).replaceChildren(blob ? el('img', { src: urlDeBlob(id, blob), alt: '' }) : vazio);
  $(id).classList.toggle('foto-vazia', !blob);
  $(id).classList.toggle('foto', !!blob);
}

function aplicarConsulta(r) {
  form.consulta = r;
  const partes = [r.tipo, r.modelo, r.mac && 'MAC ' + r.mac, r.gravador && `${qtdCanais(r.canais)} canais`].filter(Boolean);
  $('d-info').textContent = partes.join(' · ');
  if (!$('d-nome').value && r.nome) $('d-nome').value = r.nome;
}

async function capturarDoToken(token) {
  try {
    form.fotoCadastro = await baixarImagem(token, 1);
    mostrarFoto('d-img-cam', form.fotoCadastro, 'Sem imagem');
    return true;
  } catch {
    mostrarFoto('d-img-cam', null, 'Câmera sem imagem');
    return false;
  }
}

function pedidoDoForm() {
  const senha = $('d-senha').value;
  return {
    ip: $('d-ip').value.trim(), usuario: $('d-usuario').value.trim() || 'admin',
    ...(senha || !form.atual ? { senha } : { senhaCifrada: form.atual.senhaCifrada || '' }),
    portaHttp: $('d-porta-http').value, portaRtsp: $('d-porta-rtsp').value,
  };
}

async function capturar() {
  const b = $('d-capturar');
  b.disabled = true;
  b.textContent = 'Conectando…';
  $('d-erro').textContent = '';
  const r = await nativo('consultar', pedidoDoForm());
  if (r.erro) $('d-erro').textContent = r.erro;
  else if (!r.token) $('d-erro').textContent = r.diagnostico;
  else { aplicarConsulta(r); await capturarDoToken(r.token); }
  b.disabled = false;
  b.textContent = 'Capturar agora';
  return !!r.token;
}
$('d-capturar').addEventListener('click', capturar);

for (const id of ['d-foto', 'd-galeria']) {
  $(id).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      form.fotoInstalacao = await reduzirImagem(f, 1600, 0.8);
      mostrarFoto('d-img-inst', form.fotoInstalacao, 'Sem foto');
    } catch {
      $('d-erro').textContent = 'Não consegui ler essa foto.';
    }
  });
}

// pre: { ip, usuario, senha, portaHttp, portaRtsp, consulta } vindo do teste ou do scanner
async function abrirCadastro(id, pre = {}, aoSalvar) {
  const d = id ? await banco.obter(id) : null;
  Object.assign(form, { atual: d, consulta: null, fotoCadastro: d ? d.fotoCadastro : null,
    fotoInstalacao: d ? d.fotoInstalacao : null, aoSalvar });
  $('d-nome').value = d ? d.nome : '';
  $('d-local').value = d ? d.local || '' : '';
  $('d-ip').value = d ? d.ip : pre.ip || '';
  $('d-usuario').value = d ? d.usuario : pre.usuario || 'admin';
  $('d-senha').value = d ? '' : pre.senha || '';
  $('d-senha-dica').hidden = !d;
  $('d-porta-http').value = d ? d.portaHttp : pre.portaHttp || 80;
  $('d-porta-rtsp').value = d ? d.portaRtsp : pre.portaRtsp || 554;
  $('d-obs').value = d ? d.obs || '' : '';
  $('d-info').textContent = d ? [d.gravador ? 'Gravador' : 'Câmera', d.modelo, d.mac && 'MAC ' + d.mac].filter(Boolean).join(' · ') : '';
  $('d-erro').textContent = '';
  mostrarFoto('d-img-cam', form.fotoCadastro, 'Sem imagem');
  mostrarFoto('d-img-inst', form.fotoInstalacao, 'Sem foto');
  abrirTela('tela-form', d ? 'Editar dispositivo' : 'Novo dispositivo');
  if (pre.consulta) {
    aplicarConsulta(pre.consulta);
    if (pre.consulta.token) capturarDoToken(pre.consulta.token); // imagem da câmera na hora do cadastro
  }
}

$('form-disp').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('d-erro').textContent = '';
  const ip = $('d-ip').value.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { $('d-erro').textContent = 'IP inválido.'; return; }
  const repetido = (await banco.listar()).find((x) => x.ip === ip && (!form.atual || x.id !== form.atual.id));
  if (repetido) { $('d-erro').textContent = `Esse IP já está cadastrado como "${repetido.nome}".`; return; }

  const b = $('d-salvar');
  b.disabled = true;
  b.textContent = 'Salvando…';
  try {
    if (!form.fotoCadastro && !form.consulta) await capturar(); // tenta pegar imagem e modelo antes de salvar

    const senha = $('d-senha').value;
    let senhaCifrada = form.atual ? form.atual.senhaCifrada || '' : '';
    if (senha) {
      senhaCifrada = NATIVO.cifrar(senha);
      if (!senhaCifrada) throw new Error('Não consegui proteger a senha neste aparelho.');
    }
    const c = form.consulta || {};
    const agora = new Date().toISOString();
    const d = {
      ...(form.atual || { id: novoId(), criado: agora }),
      nome: $('d-nome').value.trim(), local: $('d-local').value.trim(), ip,
      usuario: $('d-usuario').value.trim() || 'admin', senhaCifrada,
      portaHttp: $('d-porta-http').value || '80', portaRtsp: $('d-porta-rtsp').value || '554',
      obs: $('d-obs').value.trim(),
      fotoCadastro: form.fotoCadastro, fotoInstalacao: form.fotoInstalacao, atualizado: agora,
    };
    if (c.modelo) Object.assign(d, { modelo: c.modelo, tipo: c.tipo, gravador: !!c.gravador, mac: c.mac || d.mac || '', serie: c.serie || d.serie || '', canais: qtdCanais(c.canais) });
    if (c.situacao) d.ultimoTeste = { situacao: c.situacao, quando: c.quando || agora };
    if (c.token) tokens.set(d.id, { token: c.token, quando: Date.now() });
    await banco.salvar(d);
    $('d-senha').value = '';
    fecharTela();
    if (form.aoSalvar) form.aoSalvar(d);
    else if (!form.atual) { abrirAba('dispositivos'); abrirDetalhe(d.id); }
  } catch (erro) {
    $('d-erro').textContent = erro.message || 'Não foi possível salvar.';
  } finally {
    b.disabled = false;
    b.textContent = 'Salvar';
  }
});
