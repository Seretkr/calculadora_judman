'use strict';
// Cadastro de dispositivos guardado no próprio celular (IndexedDB). Fotos ficam como Blob.
// A senha da câmera só entra aqui cifrada pela chave do Android (campo senhaCifrada).

const banco = (() => {
  let conexao = null;

  function abrir() {
    if (conexao) return conexao;
    conexao = new Promise((res, rej) => {
      const r = indexedDB.open('olho', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('dispositivos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return conexao;
  }

  async function operar(modo, fazer) {
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction('dispositivos', modo);
      const pedido = fazer(t.objectStore('dispositivos'));
      t.oncomplete = () => res(pedido && pedido.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('não foi possível salvar'));
    });
  }

  return {
    listar: async () => (await operar('readonly', (s) => s.getAll())).sort(porIp),
    obter: (id) => operar('readonly', (s) => s.get(id)),
    salvar: (d) => operar('readwrite', (s) => s.put(d)),
    apagar: (id) => operar('readwrite', (s) => s.delete(id)),
  };
})();

function novoId() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
}
