'use strict';
// Backup dos dispositivos (com fotos e senhas) num arquivo .olho cifrado com a senha que a pessoa escolher.
// Necessário porque reinstalar o app apaga os dados, e a chave do Android que protege as senhas não sai do aparelho.

const ITERACOES = 310000;
const b64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function chaveBackup(senha, sal) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: ITERACOES, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const blobParaB64 = async (b) => (b ? { tipo: b.type, dados: b64(await b.arrayBuffer()) } : null);
const b64ParaBlob = (o) => (o ? new Blob([deB64(o.dados)], { type: o.tipo || 'image/jpeg' }) : null);

$('form-exportar').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('bk-status').textContent = 'Gerando backup…';
  try {
    const itens = [];
    for (const d of await banco.listar()) {
      const { senhaCifrada, fotoCadastro, fotoInstalacao, ...resto } = d;
      itens.push({ ...resto, senha: senhaCifrada ? NATIVO.decifrar(senhaCifrada) : '',
        fotoCadastro: await blobParaB64(fotoCadastro), fotoInstalacao: await blobParaB64(fotoInstalacao) });
    }
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chave = await chaveBackup($('bk-senha').value, sal);
    const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave,
      new TextEncoder().encode(JSON.stringify({ versao: 1, criado: new Date().toISOString(), dispositivos: itens })));
    const arquivo = JSON.stringify({ olho: 1, kdf: 'PBKDF2-SHA256', iteracoes: ITERACOES, sal: b64(sal), iv: b64(iv), dados: b64(cifrado) });
    const nome = `olho-backup-${new Date().toISOString().slice(0, 10)}.olho`;
    NATIVO.compartilhar(nome, arquivo);
    $('bk-senha').value = '';
    $('bk-status').textContent = `Backup com ${itens.length} dispositivo(s) pronto. Escolha onde guardar.`;
  } catch (erro) {
    $('bk-status').textContent = 'Falha no backup: ' + (erro.message || erro);
  }
});

$('form-importar').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('bk-status').textContent = 'Restaurando…';
  try {
    const f = JSON.parse(await $('bk-arquivo').files[0].text());
    if (f.olho !== 1) throw new Error('arquivo não é um backup do Olho Intelbras');
    const chave = await chaveBackup($('bk-senha-2').value, deB64(f.sal));
    let conteudo;
    try {
      conteudo = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(f.iv) }, chave, deB64(f.dados))));
    } catch {
      throw new Error('senha do backup incorreta');
    }
    const existentes = new Map((await banco.listar()).map((d) => [d.ip, d]));
    let n = 0;
    for (const item of conteudo.dispositivos) {
      const { senha, fotoCadastro, fotoInstalacao, ...resto } = item;
      const atual = existentes.get(item.ip);
      await banco.salvar({ ...resto, id: atual ? atual.id : item.id || novoId(),
        senhaCifrada: senha ? NATIVO.cifrar(senha) : '',
        fotoCadastro: b64ParaBlob(fotoCadastro), fotoInstalacao: b64ParaBlob(fotoInstalacao) });
      n++;
    }
    $('bk-senha-2').value = '';
    $('bk-arquivo').value = '';
    $('bk-status').textContent = `${n} dispositivo(s) restaurado(s).`;
  } catch (erro) {
    $('bk-status').textContent = 'Falha ao restaurar: ' + (erro.message || erro);
  }
});
