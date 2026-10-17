# ⚡ Elétrica OS

App Android para eletricistas gerenciarem ordens de serviço (OS). O visual segue o design system **Kit de Cotação** (cabeçalho `brand`, seções em formato de pacote, itens numerados, valores em `eco`).

## Como funciona

1. **Configure** (⚙️): seu nome, WhatsApp, valor da hora, visita mínima, deslocamento, PIX e garantia.
2. **Envie seu link** para clientes (botão *📲 Enviar link*). O cliente abre o formulário
   (`docs/index.html`), escolhe o tipo de serviço, descreve o problema e envia — o pedido chega no
   **seu WhatsApp**.
3. Na mensagem recebida, toque no link **“Abrir no app Elétrica OS”** → a OS é criada no app.
   (Alternativa: copie a mensagem e use *📥 Importar pedido*.)
4. Cuide de cada OS como um chamado:
   - status (Nova → Agendada → Orçamento enviado → Aprovada → Em andamento → Concluída);
   - agendamento, ligar / WhatsApp / mapa do cliente, diagnóstico técnico;
   - **mão de obra** por cronômetro (iniciar/parar no local) ou lançamento manual, com valor por hora;
   - **materiais e equipamentos** com catálogo de preços (aprende com os preços que você usa);
   - **fotos do local** (câmera ou galeria) com legendas (antes/depois…);
   - deslocamento, desconto, observações, pagamento;
   - **orçamento pelo WhatsApp**, **orçamento e recibo em PDF** (com fotos);
   - histórico de tudo que aconteceu.
5. Painel inicial: OS abertas, agendadas hoje, a receber e recebido no mês.

Os dados ficam no celular. Use *Configurações → Backup* para exportar/restaurar (inclui fotos).

## Link do cliente (GitHub Pages)

O formulário do cliente está em `docs/`. Ative em **GitHub → Settings → Pages → Source: branch,
pasta `/docs`**. O link padrão do app é `https://seretkr.github.io/calculadora_judman/`
(pode ser trocado em Configurações se hospedar em outro lugar).

## Compilar

```bash
./build.sh   # gera dist/EletricaOS.apk
```

Não precisa de Android Studio: o script baixa `android.jar`, `aapt2`, `dx` e `apksig` e monta o APK.
O app é uma WebView (`www/`) com uma ponte nativa (`android/src`) para câmera, WhatsApp, impressão/PDF,
arquivos e links `eletricaos://`.

A chave de assinatura fica em `keystore/` para que novas versões instalem por cima da anterior.
