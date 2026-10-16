'use strict';
// Aparelhos Intelbras falsos para os testes: gravador, câmeras e um "impostor".
// Cada um escuta num IP de loopback diferente (127.0.0.x), com as mesmas portas.
// Os testes que passam pelo servidor usam 192.168.77.x, redirecionado para cá por redirecionar.js.

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTAS = { http: 18080, https: 18443, rtsp: 18554, servico: 37777 };
const TLS = {
  key: fs.readFileSync(path.join(__dirname, 'certificado-teste', 'chave.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certificado-teste', 'certificado.pem')),
};
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const IMAGENS = [1, 2, 3, 4, 5].map((i) => fs.readFileSync(path.join(__dirname, 'imagens', `img${i}.jpg`)));

const APARELHOS = [
  { ip: '127.0.0.10', senha: 'senha123', modelo: 'MHDX 1104', classe: 'DVR', nome: 'Gravador Loja', mac: '3C:EF:8C:00:00:10',
    canais: ['Entrada', 'Caixa', 'Estoque', 'Fundos'], perda: [2], rtsp: false, desloc: 0 },
  { ip: '127.0.0.20', senha: 'senha123', modelo: 'VIP 1230 B', classe: 'IPC', nome: 'Portao', mac: '3C:EF:8C:00:00:20',
    canais: ['Portão'], perda: [], rtsp: true, desloc: 4 },
  { ip: '127.0.0.30', senha: 'outra', modelo: 'VIP 3230 D', classe: 'IPC', nome: 'Doca', mac: '3C:EF:8C:00:00:30',
    canais: ['Doca'], perda: [], rtsp: true, desloc: 2 },
  { ip: '127.0.0.41', senha: 'senha123', modelo: 'VIP 1130 B', classe: 'IPC', nome: 'Recepcao', mac: '3C:EF:8C:00:00:41',
    canais: ['Recepção'], perda: [], rtsp: true, desloc: 1 },
  // Gravador de firmware antigo: não informa a classe nem o nome dos canais, só quantas entradas tem
  { ip: '127.0.0.60', senha: 'senha123', modelo: 'VD 3108', nome: 'DVR Deposito', semClasse: true, semTitulos: true, entradas: 8, mac: '3C:EF:8C:00:00:60',
    canais: Array.from({ length: 8 }, (_, i) => `CAM ${i + 1}`), perda: [], rtsp: false, desloc: 0 },
  // NVR de firmware novo: a página web em HTTP manda para HTTPS
  { ip: '127.0.0.70', senha: 'senha123', modelo: 'NVD 1404', classe: 'NVR', nome: 'NVR Escritorio', soHttps: true, mac: '3C:EF:8C:00:00:70',
    canais: ['Corredor', 'Garagem', 'Portaria', 'Quintal'], perda: [], rtsp: false, desloc: 1 },
  // Não é Intelbras: só uma página que pede usuário/senha em Basic (ex.: roteador ou aparelho malicioso)
  { ip: '127.0.0.50', impostor: true },
];

function lerDigest(h) {
  const p = {};
  String(h).replace(/(\w+)=(?:"([^"]*)"|([^\s,]*))/g, (_, k, a, b) => { p[k] = a ?? b; });
  return p;
}

function aparelho(d, registro) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const reg = { autorizacoes: [], falhas: 0, pedidos: 0 };
  registro[d.ip] = reg;
  const confere = (h, metodo) => {
    if (!h || !h.startsWith('Digest')) return false;
    const p = lerDigest(h);
    const ha1 = md5(`${p.username}:Login:${d.senha}`);
    const ha2 = md5(`${metodo}:${p.uri}`);
    return p.username === 'admin' && p.response === md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
  };
  const servidores = [];

  const atender = (req, res) => {
    reg.pedidos++;
    const auth = req.headers.authorization;
    if (auth) reg.autorizacoes.push(auth);
    if (d.impostor) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Roteador"' });
      return res.end();
    }
    if (!confere(auth, 'GET')) {
      if (auth) reg.falhas++;
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="Login", qop="auth", nonce="${nonce}", opaque="xyz"` });
      return res.end();
    }
    const u = req.url;
    const txt = (t) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(t); };
    if (u.includes('getDeviceType')) return txt(`type=${d.modelo}\r\n`);
    if (u.includes('getDeviceClass')) {
      if (d.semClasse) { res.writeHead(400); return res.end('Error\r\nBad Request!\r\n'); }
      return txt(`class=${d.classe}\r\n`);
    }
    if (u.includes('getSoftwareVersion')) return txt('version=4.001.0000000.6.R,build:2024-05-10\r\n');
    if (u.includes('devVideoInput.cgi?action=getCollect')) return txt(`result=${d.entradas || d.canais.length}\r\n`);
    if (u.includes('MaxRemoteInputChannels')) { res.writeHead(400); return res.end('Error\r\n'); }
    if (u.includes('getSystemInfo')) return txt(`deviceType=${d.modelo}\r\nserialNumber=SN${d.ip.split('.')[3]}\r\n`);
    if (u.includes('getMachineName')) return txt(`name=${d.nome}\r\n`);
    if (u.includes('name=Network')) return txt(`table.Network.eth0.IPAddress=${d.ip}\r\ntable.Network.eth0.PhysicalAddress=${d.mac.toLowerCase()}\r\n`);
    if (u.includes('ChannelTitle') && d.semTitulos) { res.writeHead(400); return res.end('Error\r\nBad Request!\r\n'); }
    if (u.includes('ChannelTitle')) return txt(d.canais.map((n, i) => `table.ChannelTitle[${i}].Name=${n}`).join('\r\n'));
    if (u.includes('VideoLoss')) {
      if (!d.perda.length) { res.writeHead(400); return res.end('Error'); }
      return txt(d.perda.map((c, i) => `channels[${i}]=${c}`).join('\r\n'));
    }
    if (u.includes('snapshot.cgi')) {
      const ch = Number(new URL(u, 'http://x').searchParams.get('channel'));
      if (d.perda.includes(ch - 1) || ch > d.canais.length) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(IMAGENS[(ch - 1 + d.desloc) % IMAGENS.length]);
    }
    res.writeHead(404);
    res.end();
  };

  if (d.soHttps) {
    servidores.push(http.createServer((req, res) => {
      reg.pedidos++;
      res.writeHead(301, { Location: `https://${String(req.headers.host).split(':')[0]}:${PORTAS.https}${req.url}` });
      res.end();
    }).listen(PORTAS.http, d.ip));
    servidores.push(https.createServer(TLS, atender).listen(PORTAS.https, d.ip));
  } else {
    servidores.push(http.createServer(atender).listen(PORTAS.http, d.ip));
  }

  if (d.rtsp) {
    servidores.push(net.createServer((s) => s.on('data', (c) => {
      const t = c.toString();
      const a = (t.match(/Authorization: (.+)\r\n/) || [])[1];
      const sdp = 'v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H265/90000\r\n';
      if (!confere(a, 'DESCRIBE')) {
        if (a) reg.falhas++;
        s.end(`RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Digest realm="Login", qop="auth", nonce="${nonce}"\r\n\r\n`);
      } else {
        s.end(`RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: ${sdp.length}\r\n\r\n${sdp}`);
      }
    })).listen(PORTAS.rtsp, d.ip));
  }
  if (!d.impostor) servidores.push(net.createServer((s) => s.end()).listen(PORTAS.servico, d.ip));
  return servidores;
}

// Liga todos os aparelhos. Devolve { registro, parar } — registro guarda o que cada um recebeu.
async function iniciar() {
  const registro = {};
  const servidores = APARELHOS.flatMap((d) => aparelho(d, registro));
  await Promise.all(servidores.map((s) => (s.listening ? null : new Promise((ok, erro) => { s.once('listening', ok); s.once('error', erro); }))));
  return {
    registro,
    zerar: () => { for (const r of Object.values(registro)) Object.assign(r, { autorizacoes: [], falhas: 0, pedidos: 0 }); },
    parar: () => Promise.all(servidores.map((s) => new Promise((ok) => s.close(ok)))),
  };
}

module.exports = { iniciar, APARELHOS, PORTAS };

// node aparelhos-falsos.js  -> deixa os aparelhos ligados (útil para testar à mão)
if (require.main === module) iniciar().then(() => console.log('Aparelhos falsos ligados em 127.0.0.10/20/30/41/50/60/70'));
