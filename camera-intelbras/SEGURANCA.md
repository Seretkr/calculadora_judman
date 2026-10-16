# Segurança do Olho Intelbras

Análise feita em 16/10/2026 sobre o app Android (`android/`), a tela (`public/`) e a versão servidor + navegador (`servidor.js`).
Nenhuma correção foi aplicada ainda: este documento só registra o que foi encontrado.

Cada vulnerabilidade que dá para testar tem um teste marcado como **TODO** em `testes/seguranca.test.js` ou `testes/intelbras-java.test.js`. O teste roda, aparece no relatório como pendente e passa a ficar verde quando a correção entrar.

## Resumo

| ID | Severidade | Onde | Problema |
|---|---|---|---|
| VULN-01 | Alta | APK | O APK publicado é de **depuração** (`debuggable`) |
| VULN-02 | Alta | Android e servidor | A senha da câmera vai **em texto puro** para quem pedir autenticação Basic |
| VULN-03 | Alta | Scanner (Android) | O scanner manda usuário e senha para **qualquer IP com porta web**, mesmo que não seja Intelbras |
| VULN-04 | Média | Android | A página consegue **decifrar todas as senhas** (`Olho.decifrar`) |
| VULN-10 | Média | Servidor | Certificado HTTPS autoassinado, aceito "no clique" |
| VULN-11 | Média | Distribuição | APK com assinatura nova a cada versão, baixado de link público |
| VULN-05 | Baixa | Servidor e Android | Aceita 169.254.x (metadados de nuvem) |
| VULN-06 | Baixa | Servidor | Não confere o cabeçalho Host (DNS rebinding) |
| VULN-07 | Baixa | Servidor e Android | Usuário com quebra de linha entra cru nos pedidos HTTP/RTSP |
| VULN-08 | Baixa | Android | Fotos e backups temporários ficam no cache do app |
| VULN-09 | Baixa | Backup | A senha do backup aceita só 6 caracteres |
| VULN-12 | Baixa | Android | Cadastros e fotos no IndexedDB sem cifra própria |
| VULN-13 | Baixa | Android | "Testar todos" com senha errada salva pode bloquear o usuário na câmera |
| VULN-14 | Baixa | Servidor | Listas em memória sem limite (tentativas, consultas) |

## Detalhes

### VULN-01: APK de depuração (Alta)

O GitHub compila com `assembleDebug`, e esse APK sai com `android:debuggable="true"`. Com o celular desbloqueado, a depuração USB ligada e um cabo, qualquer pessoa consegue:

- abrir o app no `chrome://inspect`, porque a WebView de apps de depuração fica inspecionável;
- chamar `Olho.decifrar(...)` e ler **todas as senhas** das câmeras;
- copiar os dados do app (`run-as`): cadastros e fotos.

**Correção:** compilar em modo release (`assembleRelease`), com uma chave de assinatura fixa guardada em segredo do GitHub. Isso também resolve a VULN-11.

### VULN-02: senha em texto puro via Basic (Alta)

Quando o aparelho responde `WWW-Authenticate: Basic`, o app manda `usuário:senha` só em base64, que qualquer um decodifica. Câmeras Intelbras usam Digest. Então só pede Basic quem não é câmera, ou alguém no meio do caminho (ARP spoofing na rede).

Teste: o aparelho impostor `127.0.0.50` recebeu `Basic YWRtaW46c2VuaGExMjM=` (= `admin:senha123`).

**Correção:** aceitar só Digest. Se algum dia for preciso aceitar Basic, deixar isso como opção explícita por dispositivo.

### VULN-03: scanner espalha a senha pela rede (Alta)

O scanner testa a porta web e já tenta entrar com usuário e senha. Só depois decide se o aparelho é Intelbras (porta 37777). Resultado: impressora, roteador, TV ou um aparelho malicioso na faixa recebe a senha de admin.

- Se pedir Basic, recebe a senha em texto puro (VULN-02).
- Se pedir Digest, recebe um hash MD5 que dá para quebrar offline.

**Correção:** só mandar credencial para quem tem a porta 37777 aberta **e** responde Digest com `realm="Login"` (o padrão Intelbras/Dahua). Os outros entram na lista sem receber a senha.

### VULN-04: página consegue decifrar as senhas (Média)

O backup precisa da senha pura, então o Java oferece `Olho.decifrar()` para o JavaScript. Hoje não há XSS conhecido: tudo vira texto, o CSP só permite scripts do próprio app e há teste para isso. Mas se um XSS aparecer no futuro, ele leva todas as senhas.

**Correção:** fazer o backup inteiro no Java (cifrar com a senha do backup lá dentro) e tirar o `decifrar` da ponte.

### VULN-10: certificado autoassinado no servidor (Média)

Na versão servidor, o celular avisa "certificado não confiável" e a pessoa toca em Continuar. Quem estiver no meio da rede pode apresentar outro certificado, e o aviso será igual. Com isso captura a senha do app e as senhas das câmeras digitadas.

**Correção:** mostrar a impressão digital (SHA-256) do certificado no console, para conferir no navegador na primeira vez. Ou usar o app Android, que não tem esse problema.

### VULN-11: assinatura e distribuição do APK (Média)

Cada compilação gera uma chave nova, então o Android não consegue confirmar que a versão nova veio do mesmo autor. Isso acostuma a desinstalar e instalar de um link. O APK fica público em Releases, e quem tiver acesso de escrita ao repositório (ou à conta do GitHub) publica uma versão que a pessoa vai instalar sem desconfiar.

**Correção:** chave fixa em segredo do GitHub (VULN-01), autenticação em dois fatores na conta e, opcionalmente, publicar o SHA-256 do APK junto do release.

### VULN-05: 169.254.x aceito (Baixa)

Faz sentido para câmera sem DHCP (IP automático). Mas, se o servidor rodar numa VM de nuvem, `169.254.169.254` é o serviço de metadados, e o app vira uma ponte para ler credenciais da nuvem. No app Android não há esse risco.

**Correção:** recusar `169.254.169.254` e `169.254.170.2`, ou aceitar 169.254.x só no app Android.

### VULN-06: DNS rebinding (Baixa)

O servidor aceita qualquer `Host`. Um site malicioso aberto num navegador da mesma rede pode apontar o próprio domínio para o IP do servidor e tentar senhas do app pelo navegador da vítima. O bloqueio de 5 tentativas a cada 15 minutos limita o estrago.

**Correção:** responder 421 quando o `Host` não for um IP do próprio computador ou `localhost`.

### VULN-07: quebra de linha no usuário (Baixa)

No HTTP, o Node recusa, e o resultado é um erro 500 em vez de uma mensagem clara. No RTSP, o texto é escrito cru, então dá para injetar cabeçalhos no pedido para a câmera. O dado vem da própria pessoa, então o impacto é pequeno.

**Correção:** recusar usuário e senha com caracteres de controle (`\r`, `\n`, `\0`) antes de tudo.

### VULN-08: arquivos esquecidos no cache (Baixa)

A foto tirada pela câmera do celular e o arquivo de backup ficam em `cache/fotos` depois de usados. A pasta é privada do app, mas a foto da instalação fica ali sem necessidade.

**Correção:** apagar o arquivo depois de lido ou compartilhado, e limpar a pasta ao abrir o app.

### VULN-09: senha do backup curta (Baixa)

Com 6 caracteres, um backup vazado pode ser quebrado por força bruta, mesmo com PBKDF2 de 310 mil rodadas.

**Correção:** mínimo de 10 caracteres e aviso de senha fraca.

### VULN-12: dados guardados sem cifra própria (Baixa)

Nomes, IPs, MACs e fotos ficam no IndexedDB do app. Estão protegidos pela pasta privada do app e pela criptografia do próprio Android, mas não têm cifra própria. As senhas estão cifradas no Keystore.

### VULN-13: bloqueio por tentativas repetidas (Baixa)

Se a senha de uma câmera mudar, cada "Testar todos" ou "Mosaico" gasta uma tentativa. Depois de 5, a câmera bloqueia o usuário `admin` por alguns minutos, e isso atrapalha também o NVR e o VMS.

**Correção:** depois de "senha recusada", não testar de novo aquele dispositivo até a senha ser editada.

### VULN-14: memória sem limite no servidor (Baixa)

As listas de tentativas por IP e de consultas crescem sem limite. Só usuários logados criam consultas, então o risco é baixo.

## O que já está protegido (e tem teste)

- A tela não usa `innerHTML`. Nome de câmera com HTML aparece como texto.
- CSP restrito (`default-src 'self'`), página não pode ser embutida em outro site (`frame-ancestors 'none'`, `X-Frame-Options`).
- App Android não navega para outros sites, bloqueia tudo que não é `olho.local` e não acessa arquivos do aparelho.
- `allowBackup="false"`: os dados do app não vão para o backup do Google.
- Senhas das câmeras cifradas com AES-GCM no **Android Keystore**. O cadastro nunca guarda a senha pura.
- Backup cifrado com PBKDF2-SHA256 (310 mil rodadas) e AES-256-GCM.
- Só IPs de rede interna. Loopback, IPs públicos e endereços malformados são recusados.
- Servidor: senha do app com scrypt, bloqueio após 5 erros, cookie `HttpOnly` + `SameSite=Strict`, pedido de outro site recusado (Origin e JSON obrigatório), sem acesso a arquivos fora de `public`, token de imagem preso à sessão.
- Uma tentativa de senha por consulta, para não estourar o limite de 5 erros da Intelbras.

## Risco aceito: HTTPS dos aparelhos sem validar certificado

Quando um gravador redireciona a página web para HTTPS, o app segue e **não valida o certificado**. Os aparelhos usam certificado autoassinado, e não há como validar. Isso só acontece para IP de rede interna e para o mesmo IP que redirecionou. Com isso, a proteção fica igual à do HTTP comum (Digest), nem melhor nem pior.

## Limitação que não depende do app

A conversa com câmeras Intelbras é em HTTP com Digest MD5, e o RTSP não é cifrado: é assim que os aparelhos funcionam. Na mesma rede, dá para ver as imagens e tentar quebrar o hash. Recomendação: câmeras numa VLAN separada, sem acesso da rede de visitantes.

## Testes

```
cd camera-intelbras
npm test
```

| Arquivo | O que testa |
|---|---|
| `testes/servidor.test.js` | Versão servidor: login, bloqueio, cabeçalhos, IPs aceitos, gravador, câmera, imagens, sessões |
| `testes/intelbras-java.test.js` | O `Intelbras.java` do app rodando no Java do computador: consulta, scanner, imagem |
| `testes/interface.test.js` | A tela em tamanho de celular: testar, cadastrar com fotos, scanner, mosaico, voltar, backup |
| `testes/seguranca.test.js` | Proteções existentes e vulnerabilidades conhecidas (TODO) |

Os testes sobem aparelhos falsos (`testes/apoio/aparelhos-falsos.js`) em `127.0.0.10/20/30/41/50`: um gravador de 4 canais, câmeras, uma com senha diferente e um impostor que pede Basic. No GitHub, o APK só é compilado se os testes passarem.
