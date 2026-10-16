// Injetada na página nos testes de interface: imita o window.Olho do app Android (MainActivity.java)
// usando o servidor de teste por trás. "Cifrar" aqui é só base64 com prefixo, para o teste poder conferir.
(() => {
  const ips = ['192.168.77.10', '192.168.77.20', '192.168.77.30', '192.168.77.41'];
  const PORTAS = { portaHttp: 18080, portaRtsp: 18554 };
  const post = (corpo) => fetch('/api/consultar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corpo, ...PORTAS }) }).then((r) => r.json());
  const resp = (fn, id, o) => setTimeout(() => window[fn](id, JSON.stringify(o)), 0);
  const parados = new Set();
  window.__arquivos = [];
  window.__partes = {};
  window.__compartilhados = [];
  window.Olho = {
    consultar(id, json) {
      const b = JSON.parse(json);
      if (b.senhaCifrada) b.senha = atob(b.senhaCifrada.slice(2));
      post(b).then((r) => resp('__olho', id, r));
    },
    varrer(id, json) {
      const b = JSON.parse(json);
      const a = Number(b.inicio.split('.')[3]);
      const z = Number(b.fim.split('.')[3]);
      (async () => {
        let achados = 0;
        for (let n = a; n <= z; n++) {
          if (parados.has(id)) break;
          const ip = '192.168.77.' + n;
          if (ips.includes(ip)) {
            const r = await post({ ...b, ip });
            achados++;
            resp('__olhoEvento', id, { achou: { ip, situacao: r.situacao === 'senha' ? 'senha' : 'online', modelo: r.modelo || '',
              tipo: r.tipo || 'Intelbras', nome: r.nome || '', gravador: !!r.gravador, mac: r.mac,
              canais: r.canais ? r.canais.length : 1, token: r.token } });
          }
          resp('__olhoEvento', id, { feitos: n - a + 1, total: z - a + 1 });
          await new Promise((ok) => setTimeout(ok, 5));
        }
        resp('__olho', id, { fim: true, total: z - a + 1, achados, parado: parados.has(id) });
      })();
    },
    parar(id) { parados.add(id); },
    cifrar: (s) => 'c:' + btoa(s),
    decifrar: (s) => atob(s.slice(2)),
    meuIp: () => '192.168.77.5',
    compartilhar: (nome, conteudo) => { window.__arquivos.push({ nome, conteudo }); },
    gravarParte: (nome, base64, primeiro) => {
      if (primeiro) window.__partes[nome] = [];
      window.__partes[nome].push(base64);
      return true;
    },
    compartilharArquivo: (nome, tipo) => { window.__compartilhados.push({ nome, tipo }); },
  };
})();
