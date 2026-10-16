'use strict';
// Leitor de .zip mínimo para os testes: lê o diretório central e confere o CRC de cada arquivo.
const zlib = require('zlib');

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}

function lerZip(buf) {
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('não é zip');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório central inválido');
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamanho = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const coment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + n).toString('utf8');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('cabeçalho local inválido: ' + nome);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(inicio, inicio + tamanho);
    if (metodo !== 0) throw new Error('compressão inesperada');
    if (crc32(dados) !== crc) throw new Error('CRC errado em ' + nome);
    arquivos[nome] = { dados, utf8: !!(flags & 0x0800) };
    p += 46 + n + extra + coment;
  }
  return arquivos;
}

module.exports = { lerZip };
