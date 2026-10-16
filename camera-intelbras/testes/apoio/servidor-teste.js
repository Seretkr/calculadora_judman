'use strict';
// Sobe uma cópia do servidor.js numa pasta temporária (para não mexer no config.json de verdade)
// e oferece um cliente HTTP simples com cookie.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const RAIZ = path.join(__dirname, '..', '..');
const SENHA = 'senha-do-app-teste';

function portaLivre() {
  return new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

async function iniciarServidor(env = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'olho-teste-'));
  fs.copyFileSync(path.join(RAIZ, 'servidor.js'), path.join(pasta, 'servidor.js'));
  fs.cpSync(path.join(RAIZ, 'public'), path.join(pasta, 'public'), { recursive: true });
  const porta = await portaLivre();
  const filho = spawn(process.execPath, ['-r', path.join(__dirname, 'redirecionar.js'), 'servidor.js'], {
    cwd: pasta,
    env: { ...process.env, PORTA: String(porta), HOST: '127.0.0.1', SENHA_APP: SENHA, SEM_HTTPS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  filho.stdout.on('data', (c) => { saida += c; });
  filho.stderr.on('data', (c) => { saida += c; });
  await new Promise((ok, erro) => {
    const t = setTimeout(() => erro(new Error('servidor não subiu: ' + saida)), 10000);
    filho.stdout.on('data', () => { if (saida.includes('rodando')) { clearTimeout(t); ok(); } });
    filho.once('exit', (c) => { clearTimeout(t); erro(new Error(`servidor saiu (${c}): ${saida}`)); });
  });
  return {
    url: `http://127.0.0.1:${porta}`,
    pasta,
    saida: () => saida,
    parar: () => new Promise((ok) => {
      filho.once('exit', () => { fs.rmSync(pasta, { recursive: true, force: true }); ok(); });
      filho.kill();
    }),
  };
}

// Cliente com cookie de sessão. pedir() devolve { status, headers, corpo (texto), json, bytes }.
function cliente(base) {
  let cookie = '';
  const pedir = async (caminho, { metodo = 'GET', corpo, headers = {} } = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      redirect: 'manual',
    });
    const novo = r.headers.get('set-cookie');
    if (novo) cookie = novo.split(';')[0];
    const bytes = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(bytes.toString()); } catch { /* não é json */ }
    return { status: r.status, headers: r.headers, corpo: bytes.toString(), json, bytes };
  };
  return {
    pedir,
    entrar: (senha = SENHA) => pedir('/api/entrar', { metodo: 'POST', corpo: { senha } }),
    consultar: (dados) => pedir('/api/consultar', { metodo: 'POST', corpo: { portaHttp: 18080, portaRtsp: 18554, usuario: 'admin', ...dados } }),
    get cookie() { return cookie; },
  };
}

module.exports = { iniciarServidor, cliente, SENHA };
