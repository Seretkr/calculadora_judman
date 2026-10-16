'use strict';
// Testes do código Java do app Android (Intelbras.java), rodando no Java do computador
// contra os mesmos aparelhos falsos. Precisa de javac e da biblioteca org.json (baixada sozinha).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const falsos = require('./apoio/aparelhos-falsos');

const JAVA = path.join(__dirname, 'apoio', 'java');
const FONTE = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'br', 'com', 'olho', 'Intelbras.java');
const JAR = process.env.OLHO_JSON_JAR || path.join(__dirname, '.cache', 'json-20240303.jar');
const URL_JAR = 'https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar';

function temJava() {
  try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

let aparelhos, r, motivo;

before(async () => {
  if (!temJava()) { motivo = 'javac não instalado'; return; }
  if (!fs.existsSync(JAR)) {
    try {
      const resp = await fetch(URL_JAR);
      if (!resp.ok) throw new Error(String(resp.status));
      fs.mkdirSync(path.dirname(JAR), { recursive: true });
      fs.writeFileSync(JAR, Buffer.from(await resp.arrayBuffer()));
    } catch (e) { motivo = 'não consegui baixar org.json: ' + e.message; return; }
  }
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'olho-java-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', saida, '-cp', JAR,
    path.join(JAVA, 'android', 'util', 'Base64.java'), FONTE,
    path.join(JAVA, 'br', 'com', 'olho', 'IntelbrasPonte.java'), path.join(JAVA, 'TesteIntelbras.java')], { stdio: 'pipe' });
  aparelhos = await falsos.iniciar();
  const texto = await new Promise((ok, erro) => {
    require('child_process').execFile('java', ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', `${saida}${path.delimiter}${JAR}`, 'TesteIntelbras'], { timeout: 60000 },
      (e, out, err) => (e ? erro(new Error(err || e.message)) : ok(out)));
  });
  r = JSON.parse(texto.trim().split('\n').pop());
  fs.rmSync(saida, { recursive: true, force: true });
});
after(async () => { if (aparelhos) await aparelhos.parar(); });

const t = (nome, fn) => test(nome, (ctx) => { if (motivo) return ctx.skip(motivo); return fn(); });

t('aceita só IPs de rede interna', () => {
  const sim = ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254'];
  for (const [ip, v] of Object.entries(r.ipInterno)) assert.equal(v, sim.includes(ip), ip || '(vazio)');
});

t('gravador: tipo, canais com nome, canal sem vídeo e MAC', () => {
  assert.equal(r.gravador.tipo, 'Gravador');
  assert.equal(r.gravador.canais.length, 4);
  assert.equal(r.gravador.canais[1].nome, 'Caixa');
  assert.equal(r.gravador.canais[2].semVideo, true);
  assert.equal(r.gravador.mac, '3C:EF:8C:00:00:10');
});

t('câmera: online, RTSP H265 e link sem senha', () => {
  assert.equal(r.camera.tipo, 'Câmera');
  assert.equal(r.camera.situacao, 'online');
  assert.equal(r.camera.rtsp.codec, 'H265');
  assert.doesNotMatch(r.camera.rtsp.url, /senha123/);
});

t('senha errada é detectada', () => { assert.equal(r.senhaErrada.situacao, 'senha'); });

t('IP sem aparelho fica offline', () => { assert.equal(r.offline.situacao, 'offline'); });

t('scanner identifica gravador com número de canais', () => {
  assert.equal(r.idGravador.situacao, 'online');
  assert.equal(r.idGravador.gravador, true);
  assert.equal(r.idGravador.canais, 4);
});

t('scanner identifica câmera', () => {
  assert.equal(r.idCamera.tipo, 'Câmera');
  assert.equal(r.idCamera.modelo, 'VIP 1130 B');
});

t('scanner marca senha recusada', () => { assert.equal(r.idSenhaErrada.situacao, 'senha'); });

t('scanner ignora IP vazio e aparelho que não é Intelbras', () => {
  assert.equal(r.idNada, 'null');
  assert.equal(r.idImpostor, 'null');
});

t('baixa imagem JPEG do canal', () => {
  assert.equal(r.imagem.status, 200);
  assert.equal(r.imagem.jpeg, true);
});

test('VULN-03: scanner não manda a senha para aparelho que não é Intelbras', { todo: 'o scanner manda usuário e senha (até em Basic) para qualquer IP com porta web' }, (ctx) => {
  if (motivo) return ctx.skip(motivo);
  const recebidas = aparelhos.registro['127.0.0.50'].autorizacoes;
  assert.equal(recebidas.length, 0, 'impostor recebeu: ' + recebidas.join(' | '));
});

module.exports = { resultado: () => r, registro: () => aparelhos && aparelhos.registro };
