# Olho Intelbras

Cole o IP de um aparelho Intelbras da rede e veja na hora:

- **Câmera:** modelo, nº de série, portas respondendo (com tempo em ms), se o vídeo RTSP sai (H.264/H.265) e **a imagem atual**.
- **Gravador (DVR/NVR/XVR):** modelo e **todos os canais com nome e imagem**, marcando os que estão **sem vídeo**.
- **Problema:** diz o que falhou (aparelho desligado, porta fechada, senha recusada etc.).

Funciona no celular. Toque numa imagem para abrir em tela cheia.

No app Android há também:

- **Scanner:** varre uma faixa de IP (até 1.024 de uma vez) com usuário e senha, como o IP Utility da Intelbras. Lista câmeras e gravadores com modelo, nome, MAC e situação (funcionando ou senha recusada). Em cada um dá para **ver a imagem** e **cadastrar**. No **Mosaico**, aparece a imagem de todos em sequência de IP.
- **Dispositivos:** cadastro com nome, local, IP, usuário, senha e observações. Guarda a **imagem da câmera capturada na hora do cadastro** e a **foto da instalação** tirada com a câmera do celular. Tem busca, "Testar todos" e "Mosaico" com a imagem ao vivo de todos (gravadores mostram todos os canais).
- **Backup:** gera um arquivo `.olho` com dispositivos, fotos e senhas, cifrado com a senha que você escolher (AES-256-GCM, PBKDF2 com 310 mil rodadas). Guarde no Drive ou no WhatsApp. Use antes de desinstalar o app: os dados somem junto.

- **Exportar ZIP (sem senhas):** em Dispositivos → Backup / Exportar. Gera `olho-dispositivos-AAAA-MM-DD.zip` para levar os cadastros a outro app:
  - `dispositivos.csv`: planilha (UTF-8, separada por `;`) que abre no Excel e no Google Planilhas;
  - `dispositivos.json`: os mesmos dados para importação por sistema (`"formato": "olho-intelbras-export"`, `"senhas": false`);
  - `fotos/`: imagem da câmera e foto da instalação de cada dispositivo (`IP_nome_camera.jpg`, `IP_nome_instalacao.jpg`); as colunas `foto_camera` e `foto_instalacao` dizem qual é de quem;
  - `LEIA-ME.txt`: explica cada campo.

  A senha nunca entra, nem cifrada: os campos exportados são listados um a um. Textos que começam com `=`, `+`, `-` ou `@` ganham um `'` na frente para a planilha não executar como fórmula.

No cadastro, a senha da câmera é cifrada com uma chave do **Android Keystore**, que não sai do aparelho. Fotos e cadastros ficam só no celular.

Há duas formas de usar:

| Forma | Precisa de computador? |
|---|---|
| **App Android** (recomendado) | Não. Instala no celular e fala direto com as câmeras pelo Wi-Fi. |
| Servidor + navegador | Sim: um computador da rede roda o servidor e o celular (Android ou iPhone) abre a página dele. |

## App Android

1. No celular, abra **https://github.com/Seretkr/calculadora_judman/releases/latest/download/olho-intelbras.apk**.
2. Abra o arquivo baixado. Se o Android pedir, permita **instalar apps desta fonte** (Chrome ou Arquivos).
3. Conecte o celular no **Wi-Fi da mesma rede** das câmeras e abra o **Olho Intelbras**.

Como o app fica no próprio celular, não tem senha de app nem porta aberta: nada fica exposto na rede. A senha da câmera só fica na memória por 10 minutos e nunca é gravada.

O APK é compilado pelo GitHub (Actions → "Olho Intelbras (Android)") a cada mudança na pasta `camera-intelbras`. Cada versão sai com uma chave de assinatura nova, então para atualizar é preciso **desinstalar a versão antiga antes**. Para atualizar sem desinstalar, crie uma chave fixa uma vez e salve em Settings → Secrets → Actions como `OLHO_KEYSTORE`:

```
keytool -genkeypair -keystore olho.keystore -alias androiddebugkey -storepass android -keypass android -keyalg RSA -validity 10000 -dname "CN=Olho"
base64 -w0 olho.keystore   # cole o resultado no segredo
```

O código do app fica em `android/`. A tela é a mesma da pasta `public/`.

iPhone não permite instalar app fora da App Store. No iPhone, use a forma servidor + navegador.

## Servidor + navegador

O navegador do celular não deixa um site falar direto com câmeras (RTSP, portas e autenticação Digest). Por isso, nesta forma, um computador da mesma rede roda o servidor do app e o celular só abre a página dele.

### Como usar

1. Instale o [Node.js](https://nodejs.org) 18 ou mais novo no computador que fica na rede das câmeras.
2. Nesta pasta, rode `node servidor.js` (no Windows, também dá para dar dois cliques em `iniciar.bat`).
3. Na primeira vez aparece a **senha do app**. Anote: ela não aparece de novo.
4. No celular, no mesmo Wi-Fi, abra o endereço que apareceu (ex.: `https://192.168.1.50:8443`).
5. O aviso de "certificado não confiável" é esperado (o certificado é do próprio computador): toque em **Avançado → Continuar**.
6. Para ter um atalho na tela inicial: menu do navegador → **Adicionar à tela inicial**.

| Ajuste | Como |
|---|---|
| Gerar outra senha do app | `node servidor.js --trocar-senha` |
| Escolher a senha | `SENHA_APP=minhasenha node servidor.js` |
| Outra porta | `PORTA=9000 node servidor.js` |
| Sem HTTPS (não recomendado) | `SEM_HTTPS=1 node servidor.js` |

### Segurança

- O app pede **senha** para entrar. Depois de **5 erros**, aquele aparelho fica bloqueado por 15 minutos. O login vale 12 horas.
- A senha do app é guardada só como hash (scrypt) em `config.json`.
- **HTTPS** automático com certificado próprio, gerado com `openssl` na primeira vez (no Windows ele vem com o Git). Sem `openssl`, o app avisa e roda em HTTP.
- A **senha da câmera não é gravada** em lugar nenhum: fica só na memória do servidor por 10 minutos, para buscar as imagens, e nunca vai na URL. O celular lembra só os IPs recentes e o usuário.
- O app só aceita **IPs de rede interna** (10.x, 172.16–31.x, 192.168.x, 169.254.x) e não serve de ponte para a internet.
- Pedidos vindos de outros sites são recusados. A página tem política de segurança (CSP) e não pode ser embutida em outros sites.
- Cada consulta tenta a senha da câmera **uma vez só**. A Intelbras bloqueia o usuário depois de 5 senhas erradas, então confira antes de testar de novo.
- Não exponha a porta do app na internet (nada de redirecionar porta no roteador).

## Compatibilidade

Usa a API web dos aparelhos Intelbras de linha profissional (VIP, MHDX, NVD, iMHDX), a mesma da Dahua:

| O que | Caminho |
|---|---|
| Tipo e modelo | `/cgi-bin/magicBox.cgi?action=getDeviceType` e `getDeviceClass` |
| Nomes dos canais | `/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle` |
| Canais sem vídeo | `/cgi-bin/eventManager.cgi?action=getEventIndexes&code=VideoLoss` |
| Imagem | `/cgi-bin/snapshot.cgi?channel=N` |
| Vídeo | `rtsp://IP:554/cam/realmonitor?channel=1&subtype=0` |

As linhas de nuvem (Mibo, iM) usam outro sistema e aparecem como "não reconheci a API Intelbras".

## Problemas comuns

| Situação | O que fazer |
|---|---|
| "Nada respondeu nesse IP" | Aparelho desligado, cabo/PoE, ou computador em outra rede/VLAN. |
| "Senha recusada" | Confira usuário e senha. Depois de 5 erros, espere o desbloqueio da Intelbras. |
| Canal "Sem imagem" | Canal sem câmera, câmera desligada ou snapshot desativado no aparelho. |
| Celular não abre o endereço | Celular em outra rede (ex.: Wi-Fi de visitante) ou firewall do Windows bloqueando a porta 8443. |

## Testes e segurança

`npm test` roda 59 testes: servidor, código Java do app, tela no tamanho de celular (inclui backup e exportação ZIP) e segurança. Os testes usam aparelhos falsos, então não precisam de câmera de verdade. No GitHub, o APK só é compilado se os testes passarem.

As vulnerabilidades encontradas e as correções propostas estão em [SEGURANCA.md](SEGURANCA.md).
