'use strict';
// Testes da versão servidor + navegador (servidor.js) contra aparelhos falsos.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const falsos = require('./apoio/aparelhos-falsos');
const { iniciarServidor, cliente } = require('./apoio/servidor-teste');

let aparelhos, srv;
before(async () => { aparelhos = await falsos.iniciar(); srv = await iniciarServidor(); });
after(async () => { await srv.parar(); await aparelhos.parar(); });

describe('página e cabeçalhos', () => {
  test('serve a página com cabeçalhos de segurança', async () => {
    const r = await cliente(srv.url).pedir('/');
    assert.equal(r.status, 200);
    assert.match(r.corpo, /Olho Intelbras/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('serve os scripts da tela', async () => {
    for (const f of ['nucleo.js', 'app.js', 'scanner.js', 'dispositivos.js', 'banco.js', 'backup.js', 'inicio.js', 'estilo.css']) {
      assert.equal((await cliente(srv.url).pedir('/' + f)).status, 200, f);
    }
  });

  test('não entrega arquivos fora de public nem o config.json', async () => {
    const c = cliente(srv.url);
    for (const p of ['/servidor.js', '/../servidor.js', '/%2e%2e/servidor.js', '/config.json', '/..%2fconfig.json', '/certificado/chave.pem']) {
      const r = await c.pedir(p);
      assert.notEqual(r.status, 200, p);
      assert.doesNotMatch(r.corpo, /hash|PRIVATE KEY|require\(/, p);
    }
  });
});

describe('login do app', () => {
  test('API exige login', async () => {
    const c = cliente(srv.url);
    assert.equal((await c.pedir('/api/sessao')).status, 401);
    assert.equal((await c.consultar({ ip: '192.168.77.20', senha: 'senha123' })).status, 401);
  });

  test('senha errada é recusada e a certa cria cookie protegido', async () => {
    const c = cliente(srv.url);
    assert.equal((await c.entrar('errada')).status, 401);
    const r = await c.entrar();
    assert.equal(r.status, 200);
    const ck = r.headers.get('set-cookie');
    assert.match(ck, /HttpOnly/);
    assert.match(ck, /SameSite=Strict/);
    assert.equal((await c.pedir('/api/sessao')).status, 200);
  });

  test('sair invalida a sessão', async () => {
    const c = cliente(srv.url);
    await c.entrar();
    const antigo = c.cookie;
    await c.pedir('/api/sair', { metodo: 'POST', corpo: {} });
    const r = await fetch(srv.url + '/api/sessao', { headers: { Cookie: antigo } });
    assert.equal(r.status, 401);
  });

  test('pedido de outro site (Origin diferente) é recusado', async () => {
    const r = await cliente(srv.url).pedir('/api/entrar', { metodo: 'POST', corpo: { senha: 'x' }, headers: { Origin: 'https://site-mal.com' } });
    assert.equal(r.status, 403);
  });

  test('POST que não é JSON é recusado (evita formulário de outro site)', async () => {
    const r = await cliente(srv.url).pedir('/api/entrar', { metodo: 'POST', corpo: 'senha=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.status, 415);
  });

  test('bloqueia após 5 senhas erradas', async () => {
    const outro = await iniciarServidor();
    try {
      const c = cliente(outro.url);
      for (let i = 0; i < 5; i++) assert.equal((await c.entrar('errada' + i)).status, 401);
      const r = await c.entrar();
      assert.equal(r.status, 429, 'mesmo a senha certa fica bloqueada');
      assert.match(r.json.erro, /Muitas tentativas/);
    } finally {
      await outro.parar();
    }
  });
});

describe('consulta de aparelhos', () => {
  let c;
  before(async () => { c = cliente(srv.url); await c.entrar(); });

  test('recusa IP fora da rede interna', async () => {
    for (const ip of ['8.8.8.8', '127.0.0.1', '172.32.0.1', '192.169.0.1', '0.0.0.0', 'localhost', '192.168.1', '192.168.1.1.1', '::1']) {
      const r = await c.consultar({ ip });
      assert.equal(r.status, 400, ip);
    }
  });

  test('recusa porta inválida (0 ou vazio usam a porta padrão)', async () => {
    for (const portaHttp of [70000, 'abc', -1, 1.5]) {
      assert.equal((await c.consultar({ ip: '192.168.77.20', portaHttp })).status, 400, String(portaHttp));
    }
  });

  test('identifica gravador e lista os canais', async () => {
    const r = (await c.consultar({ ip: '192.168.77.10', senha: 'senha123' })).json;
    assert.equal(r.tipo, 'Gravador');
    assert.equal(r.modelo, 'MHDX 1104');
    assert.equal(r.canais.length, 4);
    assert.deepEqual(r.canais.map((x) => x.nome), ['Entrada', 'Caixa', 'Estoque', 'Fundos']);
    assert.equal(r.canais[2].semVideo, true);
    assert.equal(r.situacao, 'atencao');
    assert.match(r.token, /^[a-f0-9]{48}$/);
  });

  test('identifica câmera, vídeo RTSP e codec', async () => {
    const r = (await c.consultar({ ip: '192.168.77.20', senha: 'senha123' })).json;
    assert.equal(r.tipo, 'Câmera');
    assert.equal(r.situacao, 'online');
    assert.equal(r.rtsp.ok, true);
    assert.equal(r.rtsp.codec, 'H265');
    assert.doesNotMatch(r.rtsp.url, /senha123/, 'link RTSP não mostra a senha');
    assert.equal(r.canais.length, 1);
  });

  test('senha errada: avisa e tenta só uma vez (a Intelbras bloqueia após 5 erros)', async () => {
    aparelhos.zerar();
    const r = (await c.consultar({ ip: '192.168.77.30', senha: 'errada' })).json;
    assert.equal(r.situacao, 'senha');
    assert.equal(r.token, undefined);
    assert.equal(aparelhos.registro['127.0.0.30'].falhas, 1);
  });

  test('DVR antigo sem classe nem nomes de canal: gravador com 8 canais', async () => {
    const r = (await c.consultar({ ip: '192.168.77.60', senha: 'senha123' })).json;
    assert.equal(r.tipo, 'Gravador');
    assert.equal(r.canais.length, 8);
    assert.equal(r.canais[0].nome, 'Canal 1');
    const img = await c.pedir(`/api/imagem/${r.token}/8`);
    assert.equal(img.status, 200);
  });

  test('NVR que redireciona a página web para HTTPS: segue e reconhece', async () => {
    const r = (await c.consultar({ ip: '192.168.77.70', senha: 'senha123' })).json;
    assert.equal(r.tipo, 'Gravador');
    assert.equal(r.https, true);
    assert.equal(r.canais.length, 4);
    assert.equal(r.mac, '3C:EF:8C:00:00:70');
    const img = await c.pedir(`/api/imagem/${r.token}/2`);
    assert.equal(img.status, 200);
    assert.equal(img.bytes[0], 0xff);
  });

  test('diagnóstico: portas, respostas e nenhuma senha', async () => {
    const r = await c.pedir('/api/diagnostico', { metodo: 'POST', corpo: { ip: '192.168.77.60', senha: 'senha123', portaHttp: 18080, portaRtsp: 18554 } });
    assert.equal(r.status, 200);
    assert.ok(r.json.pedidos.find((p) => p.caminho.includes('getDeviceClass') && p.status === 400));
    assert.ok(r.json.pedidos.find((p) => p.caminho.includes('getCollect') && /result=8/.test(p.trecho)));
    assert.doesNotMatch(r.corpo, /senha123|response=|nonce=/);
  });

  test('diagnóstico com senha errada para na primeira recusa', async () => {
    aparelhos.zerar();
    const r = await c.pedir('/api/diagnostico', { metodo: 'POST', corpo: { ip: '192.168.77.30', senha: 'errada', portaHttp: 18080, portaRtsp: 18554 } });
    assert.match(r.json.parou, /Senha recusada/);
    assert.equal(aparelhos.registro['127.0.0.30'].falhas, 1);
  });

  test('IP sem aparelho aparece como offline', async () => {
    const r = (await c.consultar({ ip: '192.168.77.99', senha: 'x' })).json;
    assert.equal(r.situacao, 'offline');
  });

  test('a resposta não devolve a senha', async () => {
    const r = await c.consultar({ ip: '192.168.77.20', senha: 'senha123' });
    assert.doesNotMatch(r.corpo, /senha123/);
  });
});

describe('imagens', () => {
  let c, token;
  before(async () => {
    c = cliente(srv.url);
    await c.entrar();
    token = (await c.consultar({ ip: '192.168.77.10', senha: 'senha123' })).json.token;
  });

  test('entrega a imagem de cada canal', async () => {
    const r = await c.pedir(`/api/imagem/${token}/1`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.bytes[0], 0xff);
    assert.equal(r.bytes[1], 0xd8);
  });

  test('canal sem vídeo responde erro, não imagem', async () => {
    assert.equal((await c.pedir(`/api/imagem/${token}/3`)).status, 502);
  });

  test('sem login não vê imagem', async () => {
    assert.equal((await fetch(`${srv.url}/api/imagem/${token}/1`)).status, 401);
  });

  test('outra sessão não usa o token desta', async () => {
    const outro = cliente(srv.url);
    await outro.entrar();
    assert.equal((await outro.pedir(`/api/imagem/${token}/1`)).status, 410);
  });

  test('token em formato errado não é aceito', async () => {
    for (const t of ['abc', '../../etc', 'g'.repeat(48)]) assert.equal((await c.pedir(`/api/imagem/${t}/1`)).status, 404, t);
  });
});
