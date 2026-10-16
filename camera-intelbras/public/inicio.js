'use strict';
// Início: no app Android entra direto; na versão com servidor pede a senha do app.

desenharRecentes();
if (NATIVO) {
  mostrar('app');
  abrirAba('testar');
} else {
  api('/api/sessao').then((r) => mostrar(r.ok ? 'app' : 'entrar')).catch(() => mostrar('entrar'));
}
