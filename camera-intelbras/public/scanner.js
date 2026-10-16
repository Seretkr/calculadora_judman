'use strict';
// Aba "Scanner": varre uma faixa de IP (como o IP Utility da Intelbras) e lista o que respondeu.

const scanner = { id: null, achados: new Map(), vista: 'lista', cadastrados: new Set(), credenciais: null };

soIp($('sc-inicio'));
soIp($('sc-fim'));

// Sugere a faixa da rede do celular (ex.: 192.168.1.1 até 192.168.1.254)
document.addEventListener('aba', (e) => {
  if (e.detail !== 'scanner' || $('sc-inicio').value || !NATIVO) return;
  const ip = NATIVO.meuIp();
  const m = ip && ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (m) { $('sc-inicio').value = m[1] + '.1'; $('sc-fim').value = m[1] + '.254'; }
});

$('form-scanner').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (scanner.id) { NATIVO.parar(scanner.id); return; }

  scanner.credenciais = { usuario: $('sc-usuario').value.trim() || 'admin', senha: $('sc-senha').value,
    portaHttp: $('sc-porta-http').value };
  scanner.achados.clear();
  scanner.cadastrados = new Set((await banco.listar()).map((d) => d.ip));
  $('sc-lista').replaceChildren();
  $('sc-barra').hidden = true;
  $('sc-progresso').hidden = false;
  $('sc-progresso').firstElementChild.style.width = '0%';
  $('sc-status').textContent = 'Procurando…';
  $('sc-botao').textContent = 'Parar';

  const p = nativo('varrer', { inicio: $('sc-inicio').value.trim(), fim: $('sc-fim').value.trim(), ...scanner.credenciais }, (ev) => {
    if (ev.achou) {
      scanner.achados.set(ev.achou.ip, ev.achou);
      agendarDesenho();
    }
    if (ev.total) {
      $('sc-progresso').firstElementChild.style.width = Math.round((ev.feitos / ev.total) * 100) + '%';
      $('sc-status').textContent = `${ev.feitos} de ${ev.total} IPs · ${scanner.achados.size} encontrado(s)`;
    }
  });
  scanner.id = p.id;
  const fim = await p;
  scanner.id = null;
  $('sc-botao').textContent = 'Escanear';
  $('sc-progresso').hidden = true;
  if (fim.erro) { $('sc-status').textContent = fim.erro; return; }
  const senha = [...scanner.achados.values()].filter((a) => a.situacao === 'senha').length;
  $('sc-status').textContent = `${fim.parado ? 'Parado' : 'Pronto'}: ${fim.achados} aparelho(s) em ${fim.total} IPs.`
    + (senha ? ` ${senha} recusaram a senha.` : '');
  desenharScanner();
});

let desenhoPendente = false;
function agendarDesenho() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  setTimeout(() => { desenhoPendente = false; desenharScanner(); }, 300);
}

for (const b of document.querySelectorAll('#sc-barra [data-vista]')) {
  b.addEventListener('click', () => {
    scanner.vista = b.dataset.vista;
    for (const x of document.querySelectorAll('#sc-barra [data-vista]')) x.classList.toggle('ativo', x === b);
    desenharScanner();
  });
}
$('sc-atualizar').addEventListener('click', () => recarregarImagens($('sc-lista')));

function verAchado(a) {
  if (!a.gravador) return abrirVisor({ token: a.token, canal: 1, titulo: `${a.ip} · ${a.nome || a.modelo}` });
  const itens = [];
  for (let c = 1; c <= (a.canais || 1); c++) itens.push({ token: a.token, canal: c, titulo: `CH ${c}`, sub: a.ip });
  abrirMosaico(`${a.nome || a.modelo} · ${a.ip}`, itens);
}

function cadastrarAchado(a) {
  abrirCadastro(null, { ip: a.ip, ...scanner.credenciais, consulta: a }, () => {
    scanner.cadastrados.add(a.ip);
    desenharScanner();
  });
}

function desenharScanner() {
  const lista = [...scanner.achados.values()].sort(porIp);
  $('sc-barra').hidden = !lista.length;
  if (!lista.length) { $('sc-lista').replaceChildren(); return; }

  if (scanner.vista === 'mosaico') {
    const comImagem = lista.filter((a) => a.token);
    $('sc-lista').replaceChildren(comImagem.length
      ? el('div', { class: 'grade' }, ...comImagem.map((a) => quadro({
        token: a.token, canal: 1, titulo: a.ip,
        sub: a.gravador ? `Gravador · ${a.canais} canais` : (a.nome || a.modelo),
        aoTocar: () => verAchado(a),
      })))
      : el('p', { class: 'fraco' }, 'Nenhum aparelho aceitou o usuário e a senha, então não há imagens.'));
    return;
  }

  $('sc-lista').replaceChildren(...lista.map((a) => {
    const cadastrado = scanner.cadastrados.has(a.ip);
    return el('div', { class: 'cartao item' },
      el('div', { class: 'cab' },
        el('div', {}, el('h2', {}, a.ip), el('p', { class: 'fraco pequeno' }, [a.tipo, a.modelo, a.nome].filter(Boolean).join(' · '))),
        selo(a.situacao)),
      a.mac ? el('p', { class: 'fraco pequeno' }, 'MAC ' + a.mac) : null,
      el('div', { class: 'botoes' },
        a.token ? el('button', { type: 'button', onclick: () => verAchado(a) }, a.gravador ? `Ver ${a.canais} câmeras` : 'Ver imagem') : null,
        cadastrado
          ? el('span', { class: 'fraco pequeno' }, '✓ Já cadastrado')
          : el('button', { type: 'button', class: 'principal pequeno', onclick: () => cadastrarAchado(a) }, 'Cadastrar')));
  }));
}

// ---------- mosaico (tela cheia de imagens em ordem de IP) ----------

function abrirMosaico(titulo, itens) {
  $('mosaico-titulo').textContent = `${itens.length} imagem(ns)`;
  $('mosaico-grade').replaceChildren(...itens.map((i) => quadro(i)));
  abrirTela('tela-mosaico', titulo, () => $('mosaico-grade').replaceChildren());
}
$('mosaico-atualizar').addEventListener('click', () => recarregarImagens($('mosaico-grade')));
