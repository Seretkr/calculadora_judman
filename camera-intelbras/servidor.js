'use strict';
// Olho Intelbras: cola o IP e vê se é câmera (mostra a imagem) ou gravador (mostra os canais).
// Roda num computador da rede interna; o celular abre o endereço que aparece ao iniciar.
// Sem dependências: só Node 18+.

const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PORTA = Number(process.env.PORTA) || 8443;
const HOST = process.env.HOST || '0.0.0.0';
const PASTA = __dirname;
const PUB = path.join(PASTA, 'public');
const CONFIG = path.join(PASTA, 'config.json');
const CERT_DIR = path.join(PASTA, 'certificado');
const TEMPO = 5000; // espera máxima por resposta da câmera
const SESSAO_MS = 12 * 60 * 60 * 1000; // login do app vale 12 h
const CONSULTA_MS = 10 * 60 * 1000; // credencial da câmera fica 10 min na memória

// ---------- senha do app ----------

function hashSenha(senha, sal = crypto.randomBytes(16).toString('hex')) {
  return { sal, hash: crypto.scryptSync(senha, sal, 64).toString('hex') };
}

function novaSenha() {
  // Sem letras que confundem (0/O, 1/l/I)
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(10)) s += abc[b % abc.length];
  return s;
}

function carregarConfig() {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* primeira vez */ }
  const trocar = process.argv.includes('--trocar-senha');
  const definida = process.env.SENHA_APP;
  if (!cfg || trocar || definida) {
    const senha = definida || novaSenha();
    cfg = { ...hashSenha(senha) };
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    if (!definida) {
      console.log('\n  Senha do app (anote, ela não aparece de novo):  ' + senha);
      console.log('  Para gerar outra: node servidor.js --trocar-senha\n');
    }
  }
  return cfg;
}

const cfg = carregarConfig();

function senhaConfere(senha) {
  const h = crypto.scryptSync(String(senha), cfg.sal, 64);
  return crypto.timingSafeEqual(h, Buffer.from(cfg.hash, 'hex'));
}

// ---------- certificado HTTPS ----------

function certificado() {
  const key = path.join(CERT_DIR, 'chave.pem');
  const crt = path.join(CERT_DIR, 'certificado.pem');
  if (process.env.SEM_HTTPS) return null;
  if (!fs.existsSync(key) || !fs.existsSync(crt)) {
    try {
      fs.mkdirSync(CERT_DIR, { recursive: true });
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
        '-subj', '/CN=Olho Intelbras', '-keyout', key, '-out', crt], { stdio: 'ignore' });
      fs.chmodSync(key, 0o600);
    } catch {
      console.log('  Aviso: openssl não encontrado, o app vai rodar sem HTTPS (veja o LEIA-ME).');
      return null;
    }
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---------- sessões e bloqueio de tentativas ----------

const sessoes = new Map(); // token -> expira
const falhas = new Map(); // ip do celular -> { n, ate }
const consultas = new Map(); // token -> { cam, expira, sessao }

function limparVencidos() {
  const agora = Date.now();
  for (const [k, v] of sessoes) if (v < agora) sessoes.delete(k);
  for (const [k, v] of consultas) if (v.expira < agora) consultas.delete(k);
  for (const [k, v] of falhas) if (v.ate && v.ate < agora) falhas.delete(k);
}
setInterval(limparVencidos, 60 * 1000).unref();

function lerCookie(req, nome) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? m[1] : null;
}

function sessaoValida(req) {
  const t = lerCookie(req, 'sessao');
  const exp = t && sessoes.get(t);
  return exp && exp > Date.now() ? t : null;
}

// ---------- validação ----------

// Só endereços de rede interna: o app não pode virar ponte para a internet.
function ipInterno(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function porta(v, padrao) {
  const n = Number(v || padrao);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

// ---------- rede ----------

function traduzErro(e) {
  return ({
    ECONNREFUSED: 'porta fechada',
    EHOSTUNREACH: 'aparelho não encontrado na rede',
    ENETUNREACH: 'rede inalcançável',
    ETIMEDOUT: 'sem resposta',
    ECONNRESET: 'conexão derrubada pelo aparelho',
  })[e.code] || e.message;
}

function tcp(host, port, tempo = TEMPO) {
  return new Promise((res) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    let feito = false;
    const fim = (ok, erro) => {
      if (feito) return;
      feito = true;
      s.destroy();
      res({ porta: port, ok, ms: Date.now() - t0, erro });
    };
    s.setTimeout(tempo, () => fim(false, 'sem resposta'));
    s.once('connect', () => fim(true));
    s.once('error', (e) => fim(false, traduzErro(e)));
  });
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// Monta o cabeçalho Authorization (Digest ou Basic) a partir do desafio da câmera.
function autorizacao(desafio, cam, metodo, uri) {
  if (/^basic/i.test(desafio)) {
    return 'Basic ' + Buffer.from(`${cam.usuario}:${cam.senha}`).toString('base64');
  }
  const p = {};
  desafio.replace(/(\w+)=(?:"([^"]*)"|([^\s,]*))/g, (_, k, v1, v2) => { p[k.toLowerCase()] = v1 ?? v2; });
  const ha1 = md5(`${cam.usuario}:${p.realm}:${cam.senha}`);
  const ha2 = md5(`${metodo}:${uri}`);
  const qop = (p.qop || '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : null;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const resp = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${cam.usuario}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

function pedidoHttp(cam, caminho, auth) {
  return new Promise((res) => {
    const t0 = Date.now();
    const req = http.request({
      host: cam.ip, port: cam.portaHttp, path: caminho, method: 'GET',
      headers: auth ? { Authorization: auth } : {},
      timeout: TEMPO * 2,
    }, (r) => {
      const partes = [];
      let tam = 0;
      r.on('data', (c) => {
        tam += c.length;
        if (tam > 8 * 1024 * 1024) return req.destroy(new Error('resposta grande demais'));
        partes.push(c);
      });
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, corpo: Buffer.concat(partes), ms: Date.now() - t0 }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('sem resposta'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => res({ status: 0, erro: traduzErro(e), ms: Date.now() - t0 }));
    req.end();
  });
}

// GET com autenticação. Guarda o desafio para não errar a senha duas vezes (a Intelbras bloqueia o usuário após 5 erros).
async function getCam(cam, caminho) {
  let r = await pedidoHttp(cam, caminho, cam.desafio ? autorizacao(cam.desafio, cam, 'GET', caminho) : null);
  if (r.status === 401 && r.headers['www-authenticate']) {
    cam.desafio = r.headers['www-authenticate'];
    r = await pedidoHttp(cam, caminho, autorizacao(cam.desafio, cam, 'GET', caminho));
  }
  return r;
}

// Fila por aparelho: gravador antigo trava se pedir 16 imagens de uma vez.
const filas = new Map();
function naFila(ip, tarefa) {
  const f = filas.get(ip) || { ativos: 0, espera: [] };
  filas.set(ip, f);
  return new Promise((res, rej) => {
    const rodar = () => {
      f.ativos++;
      tarefa().then(res, rej).finally(() => {
        f.ativos--;
        const prox = f.espera.shift();
        if (prox) prox(); else if (!f.ativos) filas.delete(ip);
      });
    };
    if (f.ativos < 2) rodar(); else f.espera.push(rodar);
  });
}

// Lê respostas no formato "chave=valor" da API Intelbras/Dahua.
function chaves(texto) {
  const o = {};
  for (const l of texto.split(/\r?\n/)) {
    const i = l.indexOf('=');
    if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return o;
}

// Pergunta o fluxo de vídeo via RTSP (DESCRIBE) para confirmar que a câmera entrega vídeo.
function rtspDescribe(cam, canal) {
  const uri = `rtsp://${cam.ip}:${cam.portaRtsp}/cam/realmonitor?channel=${canal}&subtype=0`;
  const pedido = (auth) => new Promise((res) => {
    const s = net.connect({ host: cam.ip, port: cam.portaRtsp });
    let buf = '';
    let feito = false;
    const fim = (v) => { if (!feito) { feito = true; s.destroy(); res(v); } };
    s.setTimeout(TEMPO, () => fim({ erro: 'sem resposta' }));
    s.once('error', (e) => fim({ erro: traduzErro(e) }));
    s.once('connect', () => {
      s.write(`DESCRIBE ${uri} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: OlhoIntelbras\r\n` +
        (auth ? `Authorization: ${auth}\r\n` : '') + '\r\n');
    });
    s.on('data', (c) => {
      buf += c.toString('latin1');
      if (buf.length > 65536) return fim({ erro: 'resposta inválida' });
      const fimCab = buf.indexOf('\r\n\r\n');
      if (fimCab < 0) return;
      const cab = buf.slice(0, fimCab);
      const status = Number((cab.match(/^RTSP\/1\.0 (\d+)/) || [])[1]);
      const tam = Number((cab.match(/content-length:\s*(\d+)/i) || [])[1] || 0);
      const corpo = buf.slice(fimCab + 4);
      if (corpo.length < tam) return;
      fim({ status, desafio: (cab.match(/www-authenticate:\s*(.+)/i) || [])[1], sdp: corpo });
    });
  });
  return (async () => {
    const t0 = Date.now();
    let r = await pedido(cam.desafioRtsp ? autorizacao(cam.desafioRtsp, cam, 'DESCRIBE', uri) : null);
    if (r.status === 401 && r.desafio) {
      cam.desafioRtsp = r.desafio.trim();
      r = await pedido(autorizacao(cam.desafioRtsp, cam, 'DESCRIBE', uri));
    }
    const ms = Date.now() - t0;
    if (r.erro) return { ok: false, erro: r.erro, ms };
    if (r.status === 401) return { ok: false, erro: 'usuário ou senha recusados no RTSP', ms };
    if (r.status !== 200) return { ok: false, erro: `o aparelho respondeu ${r.status}`, ms };
    const codec = (r.sdp.match(/a=rtpmap:\d+ (H26[45]|H\.26[45]|MJPEG|JPEG)/i) || [])[1] || 'desconhecido';
    return { ok: true, codec: codec.toUpperCase().replace('.', ''), ms, url: uri.replace(/^rtsp:\/\//, `rtsp://usuario:senha@`) };
  })();
}

// ---------- consulta principal ----------

async function consultar(cam) {
  const resultado = { ip: cam.ip, quando: new Date().toISOString(), portas: [], avisos: [] };

  resultado.portas = await Promise.all([
    tcp(cam.ip, cam.portaHttp).then((r) => ({ ...r, nome: 'Web (HTTP)' })),
    tcp(cam.ip, cam.portaRtsp).then((r) => ({ ...r, nome: 'Vídeo (RTSP)' })),
    tcp(cam.ip, 37777).then((r) => ({ ...r, nome: 'Serviço Intelbras' })),
  ]);
  const [web, rtsp, servico] = resultado.portas;

  if (!web.ok && !rtsp.ok && !servico.ok) {
    resultado.situacao = 'offline';
    resultado.diagnostico = web.erro === 'porta fechada'
      ? 'O IP responde, mas nenhuma porta de câmera está aberta. Pode não ser um aparelho Intelbras.'
      : 'Nada respondeu nesse IP. Confira se o aparelho está ligado, o cabo/PoE e se o celular/PC está na mesma rede.';
    return resultado;
  }
  if (!web.ok) {
    resultado.situacao = 'atencao';
    resultado.diagnostico = `A porta web ${cam.portaHttp} não respondeu (${web.erro}). Se o aparelho usa outra porta HTTP, informe em "Portas".`;
    return resultado;
  }

  const tipo = await getCam(cam, '/cgi-bin/magicBox.cgi?action=getDeviceType');
  if (tipo.status === 401) {
    resultado.situacao = 'senha';
    resultado.diagnostico = 'O aparelho recusou o usuário ou a senha. Atenção: depois de 5 erros a Intelbras bloqueia o usuário por alguns minutos.';
    return resultado;
  }
  if (tipo.status !== 200) {
    resultado.situacao = 'atencao';
    resultado.diagnostico = tipo.erro
      ? `A página web não respondeu (${tipo.erro}).`
      : `A página web respondeu ${tipo.status}, mas não reconheci a API Intelbras. Linhas como Mibo e iM usam outro sistema.`;
    return resultado;
  }

  const [classe, sistema, nomeAp] = await Promise.all([
    getCam(cam, '/cgi-bin/magicBox.cgi?action=getDeviceClass'),
    getCam(cam, '/cgi-bin/magicBox.cgi?action=getSystemInfo'),
    getCam(cam, '/cgi-bin/magicBox.cgi?action=getMachineName'),
  ]);
  const t = chaves(tipo.corpo.toString());
  const c = classe.status === 200 ? chaves(classe.corpo.toString()) : {};
  const s = sistema.status === 200 ? chaves(sistema.corpo.toString()) : {};
  const n = nomeAp.status === 200 ? chaves(nomeAp.corpo.toString()) : {};
  const classeTxt = (c.class || s.deviceType || '').toUpperCase();
  resultado.modelo = t.type || s.deviceType || 'Intelbras';
  resultado.nome = n.name || '';
  resultado.serie = s.serialNumber || '';
  resultado.gravador = /DVR|NVR|XVR|HCVR|MHDX|NVD|IVR/.test(classeTxt + ' ' + resultado.modelo.toUpperCase());
  resultado.tipo = resultado.gravador ? 'Gravador' : 'Câmera';
  resultado.webMs = tipo.ms;

  // Canais: o nome de cada canal vem da configuração ChannelTitle.
  const titulos = await getCam(cam, '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle');
  const canais = [];
  if (titulos.status === 200) {
    for (const [k, v] of Object.entries(chaves(titulos.corpo.toString()))) {
      const m = k.match(/ChannelTitle\[(\d+)\]\.Name$/);
      if (m) canais[Number(m[1])] = { canal: Number(m[1]) + 1, nome: v };
    }
  }
  let lista = canais.filter(Boolean);
  if (!lista.length) lista = [{ canal: 1, nome: resultado.nome || 'Canal 1' }];
  if (!resultado.gravador) lista = lista.slice(0, 1);

  // Canais com perda de vídeo (câmera desconectada do gravador).
  if (resultado.gravador) {
    const perda = await getCam(cam, '/cgi-bin/eventManager.cgi?action=getEventIndexes&code=VideoLoss');
    if (perda.status === 200) {
      const sem = new Set(Object.values(chaves(perda.corpo.toString())).map((v) => Number(v) + 1));
      for (const ch of lista) ch.semVideo = sem.has(ch.canal);
    }
  }
  resultado.canais = lista;

  if (!resultado.gravador && rtsp.ok) {
    resultado.rtsp = await rtspDescribe(cam, 1);
    if (!resultado.rtsp.ok) resultado.avisos.push('Vídeo RTSP: ' + resultado.rtsp.erro);
  } else if (!rtsp.ok) {
    resultado.avisos.push(`Porta de vídeo ${cam.portaRtsp} ${rtsp.erro}: NVR/VMS pode não conseguir puxar o vídeo.`);
  }

  const semVideo = lista.filter((x) => x.semVideo).length;
  if (semVideo) resultado.avisos.push(`${semVideo} canal(is) sem vídeo.`);
  resultado.situacao = resultado.avisos.length ? 'atencao' : 'online';
  resultado.diagnostico = resultado.gravador
    ? `${resultado.tipo} com ${lista.length} canal(is). Toque em uma imagem para ampliar.`
    : 'Câmera respondendo. Imagem capturada agora.';
  return resultado;
}

async function imagem(cam, canal) {
  return naFila(cam.ip, () => getCam(cam, `/cgi-bin/snapshot.cgi?channel=${canal}`));
}

// ---------- servidor web ----------

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function enviar(res, status, corpo, tipo = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...SEGURANCA, 'Content-Type': tipo, ...extra });
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
}

function lerJson(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) { rej(new Error('grande')); req.destroy(); } });
    req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { rej(new Error('json')); } });
    req.on('error', rej);
  });
}

function arquivo(res, nome) {
  const p = path.join(PUB, nome);
  if (!p.startsWith(PUB + path.sep)) return enviar(res, 404, 'não encontrado', 'text/plain');
  fs.readFile(p, (e, d) => (e ? enviar(res, 404, 'não encontrado', 'text/plain') : enviar(res, 200, d, TIPOS[path.extname(p)] || 'application/octet-stream')));
}

let seguro = false;

async function rotas(req, res) {
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  const ipCliente = req.socket.remoteAddress;

  // Pedidos que mudam algo só podem vir da própria página (bloqueia sites de fora).
  if (req.method !== 'GET') {
    const origem = req.headers.origin;
    if (origem && new URL(origem).host !== req.headers.host) return enviar(res, 403, { erro: 'origem não permitida' });
    if (!/application\/json/.test(req.headers['content-type'] || '')) return enviar(res, 415, { erro: 'formato inválido' });
  }

  if (req.method === 'GET' && (rota === '/' || rota === '/index.html')) return arquivo(res, 'index.html');
  if (req.method === 'GET' && /^\/[\w-]+\.(js|css|svg|webmanifest|png)$/.test(rota)) return arquivo(res, rota.slice(1));

  if (req.method === 'POST' && rota === '/api/entrar') {
    const f = falhas.get(ipCliente) || { n: 0 };
    if (f.ate && f.ate > Date.now()) {
      return enviar(res, 429, { erro: `Muitas tentativas. Tente de novo em ${Math.ceil((f.ate - Date.now()) / 60000)} min.` });
    }
    const corpo = await lerJson(req).catch(() => ({}));
    if (!senhaConfere(corpo.senha || '')) {
      f.n++;
      if (f.n >= 5) { f.ate = Date.now() + 15 * 60 * 1000; f.n = 0; }
      falhas.set(ipCliente, f);
      return enviar(res, 401, { erro: 'Senha incorreta.' });
    }
    falhas.delete(ipCliente);
    const token = crypto.randomBytes(32).toString('hex');
    sessoes.set(token, Date.now() + SESSAO_MS);
    const cookie = `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}` + (seguro ? '; Secure' : '');
    return enviar(res, 200, { ok: true }, undefined, { 'Set-Cookie': cookie });
  }

  if (rota.startsWith('/api/')) {
    const sessao = sessaoValida(req);
    if (!sessao) return enviar(res, 401, { erro: 'entre com a senha do app' });

    if (req.method === 'GET' && rota === '/api/sessao') return enviar(res, 200, { ok: true });

    if (req.method === 'POST' && rota === '/api/sair') {
      sessoes.delete(sessao);
      for (const [k, v] of consultas) if (v.sessao === sessao) consultas.delete(k);
      return enviar(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'sessao=; Path=/; Max-Age=0' });
    }

    if (req.method === 'POST' && rota === '/api/consultar') {
      const b = await lerJson(req).catch(() => null);
      if (!b) return enviar(res, 400, { erro: 'pedido inválido' });
      const ip = String(b.ip || '').trim();
      if (!ipInterno(ip)) return enviar(res, 400, { erro: 'Use um IP da rede interna (ex.: 192.168.1.108).' });
      const cam = {
        ip,
        portaHttp: porta(b.portaHttp, 80),
        portaRtsp: porta(b.portaRtsp, 554),
        usuario: String(b.usuario || 'admin').slice(0, 64),
        senha: String(b.senha || '').slice(0, 128),
      };
      if (!cam.portaHttp || !cam.portaRtsp) return enviar(res, 400, { erro: 'Porta inválida.' });
      const r = await consultar(cam);
      if (r.canais) {
        const token = crypto.randomBytes(24).toString('hex');
        consultas.set(token, { cam, sessao, expira: Date.now() + CONSULTA_MS });
        r.token = token;
      }
      return enviar(res, 200, r);
    }

    const mImg = rota.match(/^\/api\/imagem\/([a-f0-9]{48})\/(\d{1,3})$/);
    if (req.method === 'GET' && mImg) {
      const c = consultas.get(mImg[1]);
      if (!c || c.sessao !== sessao || c.expira < Date.now()) return enviar(res, 410, 'consulta expirada', 'text/plain');
      const r = await imagem(c.cam, Number(mImg[2]));
      const tipo = r.headers && r.headers['content-type'] || '';
      if (r.status === 200 && /image/.test(tipo) && r.corpo.length) return enviar(res, 200, r.corpo, 'image/jpeg');
      return enviar(res, 502, r.status === 401 ? 'senha recusada' : 'sem imagem', 'text/plain');
    }
  }

  enviar(res, 404, { erro: 'não encontrado' });
}

function tratar(req, res) {
  rotas(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) enviar(res, 500, { erro: 'erro interno' });
  });
}

const tls = certificado();
seguro = !!tls;
const servidor = tls ? https.createServer(tls, tratar) : http.createServer(tratar);
servidor.listen(PORTA, HOST, () => {
  const proto = tls ? 'https' : 'http';
  console.log('  Olho Intelbras rodando. Abra no celular (mesmo Wi-Fi):');
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log(`    ${proto}://${i.address}:${PORTA}`);
  }
  if (tls) console.log('  O celular vai avisar que o certificado não é confiável: é esperado, toque em "Avançado" e "Continuar".');
  console.log('');
});
