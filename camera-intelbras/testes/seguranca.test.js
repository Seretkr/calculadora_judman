'use strict';
// Testes de segurança. Os marcados com "todo" são vulnerabilidades conhecidas e ainda NÃO corrigidas
// (veja SEGURANCA.md). Eles rodam e aparecem no relatório como TODO; quando a correção entrar,
// passam a ser verdes e o "todo" deve ser retirado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const falsos = require('./apoio/aparelhos-falsos');
const { iniciarServidor, cliente } = require('./apoio/servidor-teste');

const RAIZ = path.join(__dirname, '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const ATIVIDADE = ['android', 'app', 'src', 'main', 'java', 'br', 'com', 'olho', 'MainActivity.java'];
const FLUXO = path.join(RAIZ, '..', '.github', 'workflows', 'olho-android.yml');

let aparelhos, srv, c;
before(async () => {
  aparelhos = await falsos.iniciar();
  srv = await iniciarServidor();
  c = cliente(srv.url);
  await c.entrar();
});
after(async () => { await srv.parar(); await aparelhos.parar(); });

// ---------- proteções que já existem (devem ficar sempre verdes) ----------

test('tela não usa innerHTML com dados do aparelho (evita XSS)', () => {
  for (const f of fs.readdirSync(path.join(RAIZ, 'public')).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(ler('public', f), /\.innerHTML\s*=|insertAdjacentHTML|document\.write|eval\(|new Function\(/, f);
  }
});

test('nome de aparelho com HTML aparece como texto (CSP e textContent)', () => {
  assert.match(ler('public', 'nucleo.js'), /e\.append\(f\)/);
  assert.match(ler('servidor.js'), /default-src 'self'/);
  assert.match(ler(...ATIVIDADE), /default-src 'self'/);
});

test('app Android não navega para fora nem carrega outros sites', () => {
  const a = ler(...ATIVIDADE);
  assert.match(a, /shouldOverrideUrlLoading[\s\S]*!HOST\.equals/);
  assert.match(a, /return texto\(403, "bloqueado"\)/);
  assert.match(a, /setAllowFileAccess\(false\)/);
  assert.match(a, /MIXED_CONTENT_NEVER_ALLOW/);
});

test('app Android não permite backup automático dos dados do app', () => {
  assert.match(ler('android', 'app', 'src', 'main', 'AndroidManifest.xml'), /allowBackup="false"/);
});

test('cadastro nunca guarda a senha pura (só senhaCifrada)', () => {
  const d = ler('public', 'dispositivos.js');
  assert.match(d, /senhaCifrada = NATIVO\.cifrar\(senha\)/);
  assert.doesNotMatch(d, /senha: \$\('d-senha'\)\.value,\s*\n\s*fotoCadastro/);
});

test('backup usa cifra forte (PBKDF2 ≥ 300 mil rodadas + AES-GCM)', () => {
  const b = ler('public', 'backup.js');
  assert.ok(Number((b.match(/ITERACOES = (\d+)/) || [])[1]) >= 300000);
  assert.match(b, /AES-GCM/);
});

// ---------- vulnerabilidades conhecidas (TODO até corrigir) ----------

test('VULN-01: APK publicado não pode ser de depuração (debuggable)', { todo: 'APK sai de assembleDebug: com cabo USB dá para inspecionar o app e ler as senhas' }, () => {
  assert.doesNotMatch(fs.readFileSync(FLUXO, 'utf8'), /assembleDebug/);
});

test('VULN-02: senha da câmera nunca vai em texto puro (Basic) para um aparelho', { todo: 'quem responder pedindo Basic recebe usuário e senha legíveis' }, async () => {
  aparelhos.zerar();
  await c.consultar({ ip: '192.168.77.50', senha: 'senha123' });
  const recebidas = aparelhos.registro['127.0.0.50'].autorizacoes;
  assert.equal(recebidas.filter((h) => /^Basic /i.test(h)).length, 0, 'impostor recebeu: ' + recebidas.join(' | '));
});

test('VULN-04: a página não consegue decifrar as senhas guardadas', { todo: 'Olho.decifrar está exposto ao JavaScript (usado no backup)' }, () => {
  assert.doesNotMatch(ler(...ATIVIDADE), /@JavascriptInterface\s+public String decifrar/);
});

test('VULN-05: endereço de metadados de nuvem (169.254.x) é recusado', { todo: '169.254.169.254 é aceito; se o servidor rodar numa VM de nuvem, vira SSRF para os metadados' }, async () => {
  const r = await c.consultar({ ip: '169.254.169.254', senha: 'x' });
  assert.equal(r.status, 400);
});

test('VULN-06: servidor recusa Host desconhecido (DNS rebinding)', { todo: 'qualquer Host é aceito' }, async () => {
  const http = require('http');
  const status = await new Promise((ok) => {
    const u = new URL(srv.url);
    http.get({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'site-mal.com' } }, (r) => { r.resume(); ok(r.statusCode); });
  });
  assert.equal(status, 421);
});

test('VULN-07: usuário com quebra de linha é recusado (injeção de cabeçalho)', { todo: 'vira erro 500 no HTTP e é escrito cru no pedido RTSP' }, async () => {
  const r = await c.consultar({ ip: '192.168.77.20', usuario: 'admin\r\nX-Injetado: 1', senha: 'senha123' });
  assert.equal(r.status, 400);
});

test('VULN-08: fotos e backups temporários são apagados do cache', { todo: 'arquivos em cache/fotos ficam no aparelho depois de usados' }, () => {
  assert.match(ler(...ATIVIDADE), /\.delete\(\)/);
});

test('VULN-09: senha do backup exige tamanho mínimo razoável (≥ 10)', { todo: 'aceita 6 caracteres' }, () => {
  const m = ler('public', 'index.html').match(/id="bk-senha" type="password" minlength="(\d+)"/);
  assert.ok(m && Number(m[1]) >= 10);
});
