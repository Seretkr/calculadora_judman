'use strict';
// Pré-carregado só nos testes (node -r): o servidor do app só aceita IPs de rede interna,
// então 192.168.77.x é desviado para os aparelhos falsos em 127.0.0.x.
const net = require('net');
const http = require('http');

const troca = (h) => (typeof h === 'string' && h.startsWith('192.168.77.') ? '127.0.0.' + h.split('.')[3] : h);

const conectar = net.connect;
net.connect = function (o, ...resto) {
  if (o && typeof o === 'object') o = { ...o, host: troca(o.host) };
  return conectar.call(this, o, ...resto);
};
for (const modulo of [http, require('https')]) {
  const pedir = modulo.request;
  modulo.request = function (o, ...resto) {
    // Mantém o Host original (192.168.77.x), como se o pedido tivesse ido mesmo para lá
    if (o && typeof o === 'object' && !(o instanceof URL) && troca(o.host) !== o.host) {
      o = { ...o, host: troca(o.host), headers: { Host: `${o.host}:${o.port}`, ...(o.headers || {}) } };
    }
    return pedir.call(this, o, ...resto);
  };
}
