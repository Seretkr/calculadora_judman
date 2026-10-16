'use strict';
// Exporta todos os cadastros para um .zip SEM SENHAS, para levar a outro app ou planilha:
//   dispositivos.csv   planilha (Excel/Google Planilhas), separada por ponto e vírgula
//   dispositivos.json  os mesmos dados para importação por sistema
//   fotos/             imagem da câmera e foto da instalação de cada dispositivo
//   LEIA-ME.txt        explicação dos campos
// Os campos exportados são listados um a um (lista branca): a senha nunca entra, nem cifrada.

const FORMATO_EXPORT = 'olho-intelbras-export';

function slug(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sem-nome';
}

// Célula de CSV: aspas quando precisa e ' na frente de =, +, -, @ para a planilha não executar fórmula.
function celula(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Só estes campos saem do aparelho.
function registroExportado(d, fotos) {
  return {
    id: d.id,
    nome: d.nome || '',
    local: d.local || '',
    ip: d.ip,
    usuario: d.usuario || '',
    portaHttp: Number(d.portaHttp) || 80,
    portaRtsp: Number(d.portaRtsp) || 554,
    tipo: d.gravador ? 'Gravador' : 'Câmera',
    gravador: !!d.gravador,
    modelo: d.modelo || '',
    serie: d.serie || '',
    mac: d.mac || '',
    canais: d.gravador ? Number(d.canais) || 1 : 1,
    observacoes: d.obs || '',
    ultimoTeste: d.ultimoTeste ? { situacao: d.ultimoTeste.situacao, quando: d.ultimoTeste.quando } : null,
    cadastradoEm: d.criado || '',
    atualizadoEm: d.atualizado || '',
    fotos,
  };
}

const COLUNAS = [
  ['nome', (r) => r.nome], ['local', (r) => r.local], ['ip', (r) => r.ip], ['usuario', (r) => r.usuario],
  ['porta_http', (r) => r.portaHttp], ['porta_rtsp', (r) => r.portaRtsp], ['tipo', (r) => r.tipo],
  ['modelo', (r) => r.modelo], ['serie', (r) => r.serie], ['mac', (r) => r.mac], ['canais', (r) => r.canais],
  ['observacoes', (r) => r.observacoes],
  ['ultimo_teste', (r) => (r.ultimoTeste ? ROTULO[r.ultimoTeste.situacao] || r.ultimoTeste.situacao : '')],
  ['testado_em', (r) => (r.ultimoTeste ? quando(r.ultimoTeste.quando) : '')],
  ['cadastrado_em', (r) => quando(r.cadastradoEm)],
  ['foto_camera', (r) => r.fotos.camera || ''], ['foto_instalacao', (r) => r.fotos.instalacao || ''],
];

const LEIA_ME = (n, data) => `Exportação do Olho Intelbras
Gerada em ${data} com ${n} dispositivo(s).

SEM SENHAS: este arquivo não traz a senha de nenhuma câmera ou gravador.
No app novo, cadastre a senha de cada um de novo.

Arquivos
  dispositivos.csv   Planilha (UTF-8, separada por ponto e vírgula). Abre no Excel e no Google Planilhas.
  dispositivos.json  Os mesmos dados, para importar por sistema (campo "formato": "${FORMATO_EXPORT}", "versao": 1).
  fotos/             Imagem da câmera (capturada no cadastro) e foto da instalação.
                     As colunas foto_camera e foto_instalacao dizem o arquivo de cada um.

Campos
  nome, local, ip, usuario       como foram cadastrados
  porta_http, porta_rtsp         portas usadas pelo app (padrão 80 e 554)
  tipo                           Câmera ou Gravador
  modelo, serie, mac             lidos do próprio aparelho
  canais                         quantidade de canais (gravador)
  observacoes                    texto livre do cadastro
  ultimo_teste, testado_em       resultado do último teste no app
  cadastrado_em                  data do cadastro
  Link RTSP de cada canal: rtsp://USUARIO:SENHA@IP:PORTA_RTSP/cam/realmonitor?channel=N&subtype=0
`;

async function montarExport() {
  const lista = await banco.listar();
  const arquivos = [];
  const registros = [];
  const usados = new Set();
  const nomeFoto = (d, tipo) => {
    let n = `fotos/${d.ip}_${slug(d.nome)}_${tipo}.jpg`;
    for (let i = 2; usados.has(n); i++) n = `fotos/${d.ip}_${slug(d.nome)}_${tipo}-${i}.jpg`;
    usados.add(n);
    return n;
  };
  for (const d of lista) {
    const fotos = { camera: null, instalacao: null };
    for (const [campo, tipo] of [['fotoCadastro', 'camera'], ['fotoInstalacao', 'instalacao']]) {
      if (d[campo]) {
        fotos[tipo] = nomeFoto(d, tipo);
        arquivos.push({ nome: fotos[tipo], dados: new Uint8Array(await d[campo].arrayBuffer()) });
      }
    }
    registros.push(registroExportado(d, fotos));
  }
  const agora = new Date();
  const csv = '﻿' + [COLUNAS.map((c) => c[0]).join(';'), ...registros.map((r) => COLUNAS.map((c) => celula(c[1](r))).join(';'))].join('\r\n') + '\r\n';
  const json = JSON.stringify({ formato: FORMATO_EXPORT, versao: 1, exportadoEm: agora.toISOString(), total: registros.length,
    senhas: false, dispositivos: registros }, null, 2);
  return {
    total: registros.length,
    fotos: arquivos.length,
    blob: zip.criar([
      { nome: 'LEIA-ME.txt', dados: LEIA_ME(registros.length, agora.toLocaleString('pt-BR')) },
      { nome: 'dispositivos.csv', dados: csv },
      { nome: 'dispositivos.json', dados: json },
      ...arquivos,
    ], agora),
  };
}

// Entrega o zip ao Android em pedaços (a ponte só passa texto) e abre o "compartilhar".
async function entregarArquivo(nome, blob, tipo) {
  const PEDACO = 768 * 1024;
  for (let i = 0, primeiro = true; i < blob.size || primeiro; i += PEDACO, primeiro = false) {
    const parte = new Uint8Array(await blob.slice(i, i + PEDACO).arrayBuffer());
    if (!NATIVO.gravarParte(nome, b64(parte), primeiro)) throw new Error('sem espaço no aparelho');
  }
  NATIVO.compartilharArquivo(nome, tipo);
}

$('form-zip').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = $('zip-botao');
  b.disabled = true;
  $('bk-status').textContent = 'Montando o arquivo…';
  try {
    const r = await montarExport();
    if (!r.total) throw new Error('nenhum dispositivo cadastrado');
    const nome = `olho-dispositivos-${new Date().toISOString().slice(0, 10)}.zip`;
    await entregarArquivo(nome, r.blob, 'application/zip');
    $('bk-status').textContent = `ZIP com ${r.total} dispositivo(s) e ${r.fotos} foto(s), sem senhas. Escolha onde guardar.`;
  } catch (erro) {
    $('bk-status').textContent = 'Falha na exportação: ' + (erro.message || erro);
  } finally {
    b.disabled = false;
  }
});
