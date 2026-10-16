'use strict';
// Testes da tela (a mesma do app Android) num navegador com tamanho de celular.
// A ponte falsa (apoio/ponte-falsa.js) faz o papel do código Java. Precisa do Playwright.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const falsos = require('./apoio/aparelhos-falsos');
const { iniciarServidor, SENHA } = require('./apoio/servidor-teste');
const { lerZip } = require('./apoio/ler-zip');

function carregarPlaywright() {
  for (const m of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch { /* tenta o próximo */ }
  }
  return null;
}
const pw = carregarPlaywright();
const FOTO = path.join(__dirname, 'apoio', 'imagens', 'instalacao.jpg');

let aparelhos, srv, navegador, p;
const erros = [];

before(async () => {
  if (!pw) return;
  aparelhos = await falsos.iniciar();
  srv = await iniciarServidor();
  navegador = await pw.chromium.launch();
  const ctx = await navegador.newContext({ ...pw.devices['Pixel 7'] });
  await ctx.request.post(srv.url + '/api/entrar', { data: { senha: SENHA } });
  await ctx.addInitScript({ path: path.join(__dirname, 'apoio', 'ponte-falsa.js') });
  p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(srv.url + '/');
});
after(async () => {
  if (navegador) await navegador.close();
  if (srv) await srv.parar();
  if (aparelhos) await aparelhos.parar();
});

const t = (nome, fn) => test(nome, (ctx) => (pw ? fn() : ctx.skip('Playwright não instalado')));
const lista = () => p.evaluate(async () => banco.listar());

describe('app Android (tela)', () => {
  t('abre direto na aba Testar, com as 3 abas', async () => {
    assert.equal(await p.isVisible('#abas'), true);
    assert.equal(await p.isVisible('#tela-entrar'), false);
    assert.equal(await p.locator('#abas button').count(), 3);
  });

  t('gravador: mostra a imagem de todas as câmeras', async () => {
    await p.fill('#ip', '192.168.77.10');
    await p.fill('#senha', 'senha123');
    await p.click('#testar');
    await p.waitForSelector('text=Câmeras do gravador (4)');
    await p.waitForFunction(() => document.querySelectorAll('#resultado img[data-token]').length === 4
      && [...document.querySelectorAll('#resultado img[data-token]')].filter((i) => i.complete).length === 4);
    const carregadas = await p.$$eval('#resultado img[data-token]', (imgs) => imgs.filter((i) => i.naturalWidth > 0).length);
    assert.equal(carregadas, 3, 'CH3 está sem vídeo');
    assert.equal(await p.isVisible('text=Sem vídeo'), true);
  });

  t('cadastra o gravador com imagem da câmera e foto da instalação', async () => {
    await p.click('text=Cadastrar este dispositivo');
    await p.waitForSelector('#d-img-cam img');
    await p.fill('#d-nome', 'DVR <b>Loja</b>');
    await p.fill('#d-local', 'Rack');
    await p.setInputFiles('#d-foto', FOTO);
    await p.waitForSelector('#d-img-inst img');
    await p.click('#d-salvar');
    await p.waitForSelector('#tela-detalhe:not([hidden]) .grade img');
    const [d] = await lista();
    assert.equal(d.nome, 'DVR <b>Loja</b>');
    assert.equal(d.gravador, true);
    assert.equal(d.canais, 4);
    assert.equal(d.senhaCifrada, 'c:' + Buffer.from('senha123').toString('base64'));
    assert.equal(d.senha, undefined, 'senha pura não é guardada');
    assert.equal(await p.evaluate(async () => (await banco.listar())[0].fotoCadastro.type), 'image/jpeg');
    assert.equal(await p.evaluate(async () => (await banco.listar())[0].fotoInstalacao.type), 'image/jpeg');
    assert.equal(await p.textContent('#tela-detalhe .cartao h2'), 'DVR <b>Loja</b>', 'HTML do nome aparece como texto, não vira tag');
  });

  t('não deixa cadastrar o mesmo IP duas vezes', async () => {
    await p.evaluate(() => abrirCadastro(null, { ip: '192.168.77.10' }));
    await p.fill('#d-nome', 'Repetido');
    await p.click('#d-salvar');
    await p.waitForSelector('text=Esse IP já está cadastrado');
    await p.evaluate(() => window.voltar());
  });

  t('scanner sugere a faixa da rede e acha os aparelhos', async () => {
    await p.click('#abas [data-aba=scanner]');
    assert.equal(await p.inputValue('#sc-inicio'), '192.168.77.1');
    assert.equal(await p.inputValue('#sc-fim'), '192.168.77.254');
    await p.fill('#sc-fim', '192.168.77.60');
    await p.fill('#sc-senha', 'senha123');
    await p.click('#sc-botao');
    await p.waitForFunction(() => /^Pronto/.test(document.querySelector('#sc-status').textContent), null, { timeout: 30000 });
    assert.match(await p.textContent('#sc-status'), /4 aparelho\(s\) em 60 IPs\. 1 recusaram a senha/);
    const ips = await p.$$eval('#sc-lista .item h2', (h) => h.map((x) => x.textContent));
    assert.deepEqual(ips, ['192.168.77.10', '192.168.77.20', '192.168.77.30', '192.168.77.41'], 'em ordem de IP');
    assert.equal(await p.locator('.item:has-text("192.168.77.10") >> text=Já cadastrado').count(), 1);
  });

  t('scanner: mosaico mostra a imagem de todos que aceitaram a senha', async () => {
    await p.click('#sc-barra [data-vista=mosaico]');
    assert.equal(await p.locator('#sc-lista .canal').count(), 3);
    await p.click('#sc-barra [data-vista=lista]');
  });

  t('scanner: gravador abre as câmeras dele', async () => {
    await p.click('.item:has-text("192.168.77.10") >> text=Ver 4 câmeras');
    await p.waitForSelector('#tela-mosaico:not([hidden])');
    assert.equal(await p.locator('#mosaico-grade .canal').count(), 4);
    await p.evaluate(() => window.voltar());
  });

  t('scanner: cadastra direto da lista', async () => {
    for (const ip of ['192.168.77.20', '192.168.77.41']) {
      await p.locator('.item', { hasText: ip }).locator('text=Cadastrar').click();
      await p.waitForSelector('#d-img-cam img');
      await p.click('#d-salvar');
      await p.waitForSelector(`.item:has-text("${ip}") >> text=Já cadastrado`);
    }
    assert.equal((await lista()).length, 3);
  });

  t('dispositivos: lista em ordem de IP, busca e mosaico de todos', async () => {
    await p.click('#abas [data-aba=dispositivos]');
    await p.waitForSelector('.dispositivo >> nth=2');
    await p.fill('#busca', 'recep');
    await p.waitForFunction(() => document.querySelectorAll('.dispositivo').length === 1);
    await p.fill('#busca', '');
    await p.waitForFunction(() => document.querySelectorAll('.dispositivo').length === 3);
    await p.click('#mosaico-todos');
    await p.waitForSelector('#tela-mosaico:not([hidden]) img');
    assert.equal(await p.locator('#mosaico-grade .canal').count(), 6, '4 do gravador + 2 câmeras');
    await p.evaluate(() => window.voltar());
  });

  t('botão voltar do Android fecha telas e volta para Testar', async () => {
    await p.click('.dispositivo >> nth=0');
    await p.waitForSelector('#tela-detalhe:not([hidden])');
    assert.equal(await p.evaluate(() => window.voltar()), true);
    assert.equal(await p.evaluate(() => window.voltar()), true);
    assert.equal(await p.isVisible('#aba-testar'), true);
    assert.equal(await p.evaluate(() => window.voltar()), false, 'na aba Testar, voltar sai do app');
  });

  t('backup: gera arquivo cifrado, recusa senha errada e restaura tudo', async () => {
    await p.click('#abas [data-aba=dispositivos]');
    await p.click('#backup');
    await p.fill('#bk-senha', 'senha-do-backup');
    await p.click('#form-exportar button');
    await p.waitForFunction(() => window.__arquivos.some((a) => a.nome.endsWith('.olho')));
    const arq = await p.evaluate(() => window.__arquivos.find((a) => a.nome.endsWith('.olho')));
    assert.doesNotMatch(arq.conteudo, /senha123|Recepcao|Loja/, 'nada legível no backup');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'olho-bk-')), arq.nome);
    fs.writeFileSync(tmp, arq.conteudo);
    await p.evaluate(async () => { for (const d of await banco.listar()) await banco.apagar(d.id); });
    await p.setInputFiles('#bk-arquivo', tmp);
    await p.fill('#bk-senha-2', 'errada');
    await p.click('#form-importar button');
    await p.waitForSelector('text=senha do backup incorreta');
    await p.fill('#bk-senha-2', 'senha-do-backup');
    await p.click('#form-importar button');
    await p.waitForSelector('text=3 dispositivo(s) restaurado(s)');
    const d = (await lista()).find((x) => x.ip === '192.168.77.10');
    assert.equal(d.nome, 'DVR <b>Loja</b>');
    assert.equal(d.senhaCifrada, 'c:' + Buffer.from('senha123').toString('base64'));
    assert.equal(await p.evaluate(async () => (await banco.listar()).filter((x) => x.fotoCadastro instanceof Blob).length), 3);
    await p.evaluate(() => window.voltar());
  });

  t('exportar ZIP: todos os cadastros e fotos, sem senhas', async () => {
    // observação com cara de fórmula e nome com ; e aspas, para conferir a planilha
    await p.evaluate(async () => {
      const d = (await banco.listar()).find((x) => x.ip === '192.168.77.20');
      d.obs = '=HYPERLINK("http://mal")';
      d.nome = 'Portão; "frente"';
      await banco.salvar(d);
    });
    await p.click('#abas [data-aba=dispositivos]');
    await p.click('#backup');
    await p.click('#zip-botao');
    await p.waitForFunction(() => window.__compartilhados.some((a) => a.nome.endsWith('.zip')));
    const { nome, tipo, partes } = await p.evaluate(() => {
      const a = window.__compartilhados.find((x) => x.nome.endsWith('.zip'));
      return { ...a, partes: window.__partes[a.nome] };
    });
    assert.match(nome, /^olho-dispositivos-\d{4}-\d{2}-\d{2}\.zip$/);
    assert.equal(tipo, 'application/zip');
    const buf = Buffer.concat(partes.map((x) => Buffer.from(x, 'base64')));
    fs.writeFileSync(path.join(os.tmpdir(), 'olho-export-teste.zip'), buf);
    const arquivos = lerZip(buf);
    const nomes = Object.keys(arquivos).sort();
    assert.deepEqual(nomes.filter((n) => !n.startsWith('fotos/')), ['LEIA-ME.txt', 'dispositivos.csv', 'dispositivos.json']);
    assert.equal(nomes.filter((n) => n.startsWith('fotos/')).length, 4, '3 imagens de câmera + 1 foto de instalação');
    for (const n of nomes.filter((x) => x.startsWith('fotos/'))) {
      assert.equal(arquivos[n].dados[0], 0xff, n);
      assert.equal(arquivos[n].dados[1], 0xd8, n);
      assert.equal(arquivos[n].utf8, true);
    }

    const json = JSON.parse(arquivos['dispositivos.json'].dados.toString('utf8'));
    assert.equal(json.formato, 'olho-intelbras-export');
    assert.equal(json.senhas, false);
    assert.equal(json.total, 3);
    assert.deepEqual(json.dispositivos.map((d) => d.ip), ['192.168.77.10', '192.168.77.20', '192.168.77.41']);
    const dvr = json.dispositivos[0];
    assert.equal(dvr.tipo, 'Gravador');
    assert.equal(dvr.canais, 4);
    assert.equal(dvr.local, 'Rack');
    assert.ok(arquivos[dvr.fotos.camera], 'foto da câmera referenciada existe');
    assert.ok(arquivos[dvr.fotos.instalacao], 'foto da instalação referenciada existe');
    for (const d of json.dispositivos) {
      assert.equal(d.senha, undefined);
      assert.equal(d.senhaCifrada, undefined);
    }

    // nenhuma senha em lugar nenhum do zip (nem pura, nem cifrada)
    const cifrada = 'c:' + Buffer.from('senha123').toString('base64');
    for (const [n, a] of Object.entries(arquivos)) {
      const texto = a.dados.toString('latin1');
      assert.ok(!texto.includes('senha123') && !texto.includes(cifrada) && !/senhaCifrada/.test(texto), 'senha vazou em ' + n);
    }

    const csv = arquivos['dispositivos.csv'].dados.toString('utf8');
    assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM para o Excel abrir acentos certo');
    const linhas = csv.slice(1).trim().split('\r\n');
    assert.equal(linhas.length, 4);
    assert.match(linhas[0], /^nome;local;ip;usuario;porta_http;porta_rtsp;tipo;modelo;serie;mac;canais;observacoes;/);
    assert.ok(linhas[2].startsWith('"Portão; ""frente"""'), 'nome com ; e aspas fica entre aspas: ' + linhas[2]);
    assert.ok(linhas[2].includes(`;"'=HYPERLINK(""http://mal"")";`), 'fórmula neutralizada com apóstrofo: ' + linhas[2]);
    assert.match(arquivos['LEIA-ME.txt'].dados.toString('utf8'), /SEM SENHAS/);
  });

  t('nenhum erro de JavaScript na página', () => { assert.deepEqual(erros, []); });
});
