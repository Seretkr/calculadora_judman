# Olho Intelbras

Cole o IP de um aparelho Intelbras da rede e veja na hora:

- **Câmera:** modelo, nº de série, portas respondendo (com tempo em ms), se o vídeo RTSP sai (H.264/H.265) e **a imagem atual**.
- **Gravador (DVR/NVR/XVR):** modelo e **todos os canais com nome e imagem**, marcando os que estão **sem vídeo**.
- **Problema:** diz o que falhou (aparelho desligado, porta fechada, senha recusada etc.).

Funciona no celular. Toque numa imagem para abrir em tela cheia.

## Por que precisa de um computador

O navegador do celular não deixa um site falar direto com câmeras (RTSP, portas e autenticação Digest). Por isso um computador da mesma rede roda o servidor do app, e o celular só abre a página dele.

## Como usar

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

## Segurança

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
