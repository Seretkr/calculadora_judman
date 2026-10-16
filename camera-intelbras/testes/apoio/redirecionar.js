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
const pedir = http.request;
http.request = function (o, ...resto) {
  if (o && typeof o === 'object') o = { ...o, host: troca(o.host) };
  return pedir.call(this, o, ...resto);
};
