'use strict';
// Monta um arquivo .zip simples (sem compressão: as fotos JPEG já são comprimidas).
// Nomes em UTF-8, então "Portão.jpg" abre certo no Windows, Mac e Android.

const zip = (() => {
  const TABELA = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dataDos(d) {
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // arquivos: [{ nome, dados: Uint8Array | string }]. Devolve um Blob application/zip.
  function criar(arquivos, quando = new Date()) {
    const texto = new TextEncoder();
    const { hora, dia } = dataDos(quando);
    const partes = [];
    const central = [];
    let posicao = 0;

    for (const a of arquivos) {
      const nome = texto.encode(a.nome);
      const dados = typeof a.dados === 'string' ? texto.encode(a.dados) : a.dados;
      const crc = crc32(dados);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // assinatura do arquivo
      local.setUint16(4, 20, true); // versão necessária
      local.setUint16(6, 0x0800, true); // nome em UTF-8
      local.setUint16(8, 0, true); // sem compressão
      local.setUint16(10, hora, true);
      local.setUint16(12, dia, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, dados.length, true);
      local.setUint32(22, dados.length, true);
      local.setUint16(26, nome.length, true);
      local.setUint16(28, 0, true);
      partes.push(local.buffer, nome, dados);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); // assinatura do diretório central
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, hora, true);
      c.setUint16(14, dia, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, dados.length, true);
      c.setUint32(24, dados.length, true);
      c.setUint16(28, nome.length, true);
      c.setUint32(42, posicao, true);
      central.push(c.buffer, nome);
      posicao += 30 + nome.length + dados.length;
    }

    const tamanhoCentral = central.reduce((s, b) => s + b.byteLength, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); // fim do diretório central
    fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamanhoCentral, true);
    fim.setUint32(16, posicao, true);
    return new Blob([...partes, ...central, fim.buffer], { type: 'application/zip' });
  }

  return { criar, crc32 };
})();
