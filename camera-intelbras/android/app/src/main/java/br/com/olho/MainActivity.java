package br.com.olho;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Tela do app: a mesma página da versão para computador, servida de dentro do APK.
// Não abre nenhuma porta no celular; a página só fala com o código Java abaixo.
public class MainActivity extends Activity {
    private static final String HOST = "olho.local";
    private static final long CONSULTA_MS = 30 * 60 * 1000; // credencial da câmera fica 30 min na memória
    private static final int MAX_IPS = 1024;
    private static final int PEDIDO_FOTO = 7;
    private static final String CHAVE = "olho-senhas";
    private static final Pattern ARQUIVO = Pattern.compile("^/([\\w-]+\\.(html|js|css|svg|webmanifest|png))$");
    private static final Pattern IMAGEM = Pattern.compile("^/api/imagem/([a-f0-9]{48})/(\\d{1,3})$");
    private static final String CSP = "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    private static final class Consulta {
        final Intelbras.Cam cam;
        final long expira;
        Consulta(Intelbras.Cam cam) { this.cam = cam; this.expira = System.currentTimeMillis() + CONSULTA_MS; }
    }

    private final Map<String, Consulta> consultas = new ConcurrentHashMap<>();
    private final Map<Integer, AtomicBoolean> varreduras = new ConcurrentHashMap<>();
    private final ExecutorService exec = Executors.newCachedThreadPool();
    private WebView web;
    private ValueCallback<Uri[]> retornoFoto;
    private Uri fotoCamera;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Ponte(), "Olho");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost()); // não navega para fora do app
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return responder(req.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> retorno, FileChooserParams p) {
                return escolherFoto(retorno, p);
            }
        });
        if (salvo != null) web.restoreState(salvo); else web.loadUrl("https://" + HOST + "/");
    }

    @Override
    protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        web.saveState(estado);
    }

    @Override
    protected void onDestroy() {
        consultas.clear();
        for (AtomicBoolean p : varreduras.values()) p.set(true);
        exec.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // Botão voltar: a página fecha a tela aberta; se não houver nada aberto, sai do app.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.voltar ? window.voltar() : false", (r) -> {
            if (!"true".equals(r)) MainActivity.super.onBackPressed();
        });
    }

    // ---------- foto da instalação ----------

    private boolean escolherFoto(ValueCallback<Uri[]> retorno, WebChromeClient.FileChooserParams p) {
        if (retornoFoto != null) retornoFoto.onReceiveValue(null);
        retornoFoto = retorno;
        fotoCamera = null;
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        try {
            File pasta = new File(getCacheDir(), "fotos");
            if (!pasta.isDirectory() && !pasta.mkdirs()) throw new IOException("sem pasta");
            File f = File.createTempFile("instalacao", ".jpg", pasta);
            fotoCamera = FileProvider.getUriForFile(this, getPackageName() + ".arquivos", f);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, fotoCamera);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            camera = null;
        }
        boolean imagem = false;
        for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image")) imagem = true;
        if (!imagem) camera = null; // arquivo de backup: só o seletor de arquivos
        Intent galeria = new Intent(Intent.ACTION_GET_CONTENT).setType(imagem ? "image/*" : "*/*").addCategory(Intent.CATEGORY_OPENABLE);
        Intent abrir;
        if (p.isCaptureEnabled() && camera != null) {
            abrir = camera;
        } else {
            abrir = Intent.createChooser(galeria, imagem ? "Foto da instalação" : "Arquivo de backup");
            if (camera != null) abrir.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(abrir, PEDIDO_FOTO);
            return true;
        } catch (ActivityNotFoundException e) {
            retornoFoto = null;
            return false;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int pedido, int resultado, Intent dados) {
        if (pedido != PEDIDO_FOTO || retornoFoto == null) {
            super.onActivityResult(pedido, resultado, dados);
            return;
        }
        Uri[] r = null;
        if (resultado == RESULT_OK) {
            if (dados != null && dados.getData() != null) r = new Uri[]{dados.getData()};
            else if (fotoCamera != null) r = new Uri[]{fotoCamera};
        }
        retornoFoto.onReceiveValue(r);
        retornoFoto = null;
    }

    // ---------- arquivos da página e imagens das câmeras ----------

    private WebResourceResponse resposta(int status, String tipo, byte[] corpo) {
        Map<String, String> h = new HashMap<>();
        h.put("Content-Security-Policy", CSP);
        h.put("X-Content-Type-Options", "nosniff");
        h.put("Cache-Control", "no-store");
        String motivo = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 410 ? "Gone" : "Error";
        return new WebResourceResponse(tipo, "utf-8", status, motivo, h, new ByteArrayInputStream(corpo));
    }

    private WebResourceResponse texto(int status, String t) {
        return resposta(status, "text/plain", t.getBytes(StandardCharsets.UTF_8));
    }

    private WebResourceResponse responder(Uri u) {
        if (!HOST.equals(u.getHost()) || !"https".equals(u.getScheme())) return texto(403, "bloqueado");
        String caminho = u.getPath() == null || u.getPath().equals("/") ? "/index.html" : u.getPath();

        Matcher a = ARQUIVO.matcher(caminho);
        if (a.find()) {
            try (InputStream in = getAssets().open(a.group(1))) {
                ByteArrayOutputStream d = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) > 0) d.write(b, 0, n);
                return resposta(200, tipo(a.group(2)), d.toByteArray());
            } catch (IOException e) {
                return texto(404, "não encontrado");
            }
        }

        Matcher m = IMAGEM.matcher(caminho);
        if (m.find()) {
            limparVencidas();
            Consulta c = consultas.get(m.group(1));
            if (c == null) return texto(410, "consulta expirada");
            Intelbras.Resposta r = Intelbras.imagem(c.cam, Integer.parseInt(m.group(2)));
            if (r.status == 200 && r.tipo != null && r.tipo.contains("image") && r.corpo.length > 0) {
                return resposta(200, "image/jpeg", r.corpo);
            }
            return texto(502, r.status == 401 ? "senha recusada" : "sem imagem");
        }
        return texto(404, "não encontrado");
    }

    private static String tipo(String ext) {
        switch (ext) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "svg": return "image/svg+xml";
            case "webmanifest": return "application/manifest+json";
            default: return "image/png";
        }
    }

    private void limparVencidas() {
        long agora = System.currentTimeMillis();
        for (Iterator<Consulta> it = consultas.values().iterator(); it.hasNext(); ) {
            if (it.next().expira < agora) it.remove();
        }
    }

    private String registrar(Intelbras.Cam cam) {
        String t = Intelbras.token();
        consultas.put(t, new Consulta(cam));
        return t;
    }

    // ---------- senhas cifradas com chave do Android Keystore (não sai do aparelho) ----------

    private static SecretKey chave() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(CHAVE)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(CHAVE, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return kg.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(CHAVE, null)).getSecretKey();
    }

    private static String cifrar(String texto) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, chave());
        byte[] ct = c.doFinal(texto.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String decifrar(String cifrado) throws Exception {
        String[] p = cifrado.split(":");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, chave(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    // ---------- auxiliares ----------

    private static final long MAX_ARQUIVO = 512L * 1024 * 1024;

    // Arquivo em cache/fotos com nome seguro (só letras, números, ponto, hífen e sublinhado).
    private File arquivoTemporario(String nome) {
        String seguro = nome == null ? "" : nome.replaceAll("[^\\w.-]", "_");
        if (seguro.isEmpty() || seguro.startsWith(".")) return null;
        File pasta = new File(getCacheDir(), "fotos");
        if (!pasta.isDirectory() && !pasta.mkdirs()) return null;
        return new File(pasta, seguro);
    }

    private static int porta(String v, int padrao) {
        try {
            int n = v == null || v.trim().isEmpty() ? padrao : Integer.parseInt(v.trim());
            return n > 0 && n < 65536 ? n : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static long numero(String ip) {
        long n = 0;
        for (String p : ip.split("\\.")) n = n * 256 + Long.parseLong(p);
        return n;
    }

    private static String ip(long n) {
        return ((n >> 24) & 255) + "." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255);
    }

    private static String limitar(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    // Lê usuário/senha/portas do pedido da página. A senha pode vir pura ou cifrada (dispositivo cadastrado).
    private static Intelbras.Cam lerCam(JSONObject b, String ip) throws Exception {
        Intelbras.Cam cam = new Intelbras.Cam();
        cam.ip = ip;
        cam.usuario = limitar(b.optString("usuario", "admin").trim(), 64);
        if (cam.usuario.isEmpty()) cam.usuario = "admin";
        String cifrada = b.optString("senhaCifrada", "");
        cam.senha = limitar(cifrada.isEmpty() ? b.optString("senha", "") : decifrar(cifrada), 128);
        cam.portaHttp = porta(b.optString("portaHttp"), 80);
        cam.portaRtsp = porta(b.optString("portaRtsp"), 554);
        return cam;
    }

    private void js(String funcao, int id, JSONObject r) {
        final String codigo = "window." + funcao + "(" + id + "," + JSONObject.quote(r.toString()) + ")";
        web.post(() -> web.evaluateJavascript(codigo, null));
    }

    private static JSONObject erro(String msg) {
        JSONObject r = new JSONObject();
        try { r.put("erro", msg); } catch (Exception ignorado) { /* sem saída */ }
        return r;
    }

    // ---------- ponte com a página (app.js) ----------

    private final class Ponte {
        // window.Olho.consultar(id, json): teste completo. A resposta volta por window.__olho(id, json).
        @JavascriptInterface
        public void consultar(final int id, final String json) {
            exec.execute(() -> {
                JSONObject r;
                try {
                    JSONObject b = new JSONObject(json);
                    String ip = b.optString("ip", "").trim();
                    if (!Intelbras.ipInterno(ip)) {
                        r = erro("Use um IP da rede interna (ex.: 192.168.1.108).");
                    } else {
                        Intelbras.Cam cam = lerCam(b, ip);
                        if (cam.portaHttp < 0 || cam.portaRtsp < 0) {
                            r = erro("Porta inválida.");
                        } else {
                            r = Intelbras.consultar(cam);
                            if (r.has("canais")) r.put("token", registrar(cam));
                        }
                    }
                } catch (Exception e) {
                    r = erro("Falha no teste: " + e.getMessage());
                }
                js("__olho", id, r);
            });
        }

        // Scanner: cada aparelho achado chega por window.__olhoEvento(id, json); o fim por window.__olho(id, json).
        @JavascriptInterface
        public void varrer(final int id, final String json) {
            final AtomicBoolean parar = new AtomicBoolean();
            varreduras.put(id, parar);
            exec.execute(() -> {
                try {
                    JSONObject b = new JSONObject(json);
                    String ini = b.optString("inicio", "").trim(), fim = b.optString("fim", "").trim();
                    if (!Intelbras.ipInterno(ini) || !Intelbras.ipInterno(fim)) {
                        js("__olho", id, erro("Use IPs da rede interna (ex.: 192.168.1.1 até 192.168.1.254)."));
                        return;
                    }
                    final long a = numero(ini), z = numero(fim);
                    if (z < a) { js("__olho", id, erro("O IP final precisa ser maior que o inicial.")); return; }
                    if (z - a + 1 > MAX_IPS) { js("__olho", id, erro("Faixa grande demais: no máximo " + MAX_IPS + " IPs por vez.")); return; }
                    final Intelbras.Cam modelo = lerCam(b, ini);
                    if (modelo.portaHttp < 0) { js("__olho", id, erro("Porta inválida.")); return; }
                    final int total = (int) (z - a + 1);
                    final AtomicInteger feitos = new AtomicInteger(), achados = new AtomicInteger();
                    ExecutorService pool = Executors.newFixedThreadPool(32);
                    for (long n = a; n <= z; n++) {
                        final String alvo = ip(n);
                        pool.execute(() -> {
                            try {
                                if (parar.get() || !Intelbras.ipInterno(alvo)) return;
                                Intelbras.Cam cam = new Intelbras.Cam();
                                cam.ip = alvo;
                                cam.usuario = modelo.usuario;
                                cam.senha = modelo.senha;
                                cam.portaHttp = modelo.portaHttp;
                                cam.portaRtsp = modelo.portaRtsp;
                                JSONObject r = Intelbras.identificar(cam);
                                if (r != null && !parar.get()) {
                                    if ("online".equals(r.optString("situacao"))) r.put("token", registrar(cam));
                                    achados.incrementAndGet();
                                    js("__olhoEvento", id, new JSONObject().put("achou", r));
                                }
                            } catch (Exception ignorado) {
                                // IP com problema não interrompe a varredura
                            } finally {
                                int f = feitos.incrementAndGet();
                                if (f % 8 == 0 || f == total) {
                                    try { js("__olhoEvento", id, new JSONObject().put("feitos", f).put("total", total)); } catch (Exception ignorado) { /* sem saída */ }
                                }
                            }
                        });
                    }
                    pool.shutdown();
                    pool.awaitTermination(15, TimeUnit.MINUTES);
                    js("__olho", id, new JSONObject().put("fim", true).put("total", total)
                            .put("achados", achados.get()).put("parado", parar.get()));
                } catch (Exception e) {
                    js("__olho", id, erro("Falha na varredura: " + e.getMessage()));
                } finally {
                    varreduras.remove(id);
                }
            });
        }

        @JavascriptInterface
        public void parar(int id) {
            AtomicBoolean p = varreduras.get(id);
            if (p != null) p.set(true);
        }

        // Cifra a senha da câmera antes de ir para o cadastro (a página nunca guarda a senha pura).
        @JavascriptInterface
        public String cifrar(String senha) {
            try {
                return MainActivity.cifrar(limitar(senha, 128));
            } catch (Exception e) {
                return "";
            }
        }

        // Só para o backup: a página cifra de novo com a senha do backup antes de sair do app.
        @JavascriptInterface
        public String decifrar(String cifrada) {
            try {
                return MainActivity.decifrar(cifrada);
            } catch (Exception e) {
                return "";
            }
        }

        // Entrega o arquivo de backup para o Android (Drive, WhatsApp, Arquivos...).
        @JavascriptInterface
        public void compartilhar(String nome, String conteudo) {
            try {
                File pasta = new File(getCacheDir(), "fotos");
                if (!pasta.isDirectory() && !pasta.mkdirs()) return;
                File f = new File(pasta, nome.replaceAll("[^\\w.-]", "_"));
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
                    out.write(conteudo.getBytes(StandardCharsets.UTF_8));
                }
                Uri u = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".arquivos", f);
                Intent envio = new Intent(Intent.ACTION_SEND).setType("application/octet-stream")
                        .putExtra(Intent.EXTRA_STREAM, u).putExtra(Intent.EXTRA_SUBJECT, nome)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(envio, "Guardar backup")));
            } catch (Exception ignorado) {
                // sem app para receber o arquivo
            }
        }

        // Exportação em ZIP: a página manda o arquivo em pedaços (base64) e depois pede para compartilhar.
        @JavascriptInterface
        public boolean gravarParte(String nome, String base64, boolean primeiro) {
            try {
                File f = arquivoTemporario(nome);
                if (f == null) return false;
                byte[] dados = Base64.decode(base64, Base64.NO_WRAP);
                if (!primeiro && f.length() + dados.length > MAX_ARQUIVO) return false;
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(f, !primeiro)) {
                    out.write(dados);
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void compartilharArquivo(String nome, String tipo) {
            try {
                File f = arquivoTemporario(nome);
                if (f == null || !f.isFile()) return;
                Uri u = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".arquivos", f);
                Intent envio = new Intent(Intent.ACTION_SEND).setType("application/zip".equals(tipo) ? tipo : "application/octet-stream")
                        .putExtra(Intent.EXTRA_STREAM, u).putExtra(Intent.EXTRA_SUBJECT, f.getName())
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(envio, "Salvar exportação")));
            } catch (Exception ignorado) {
                // sem app para receber o arquivo
            }
        }

        // IP do celular no Wi-Fi, para sugerir a faixa do scanner.
        @JavascriptInterface
        public String meuIp() {
            try {
                String achado = "";
                for (NetworkInterface i : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!i.isUp() || i.isLoopback()) continue;
                    for (InetAddress e : Collections.list(i.getInetAddresses())) {
                        String s = e.getHostAddress();
                        if (e instanceof Inet4Address && s != null && Intelbras.ipInterno(s)) {
                            if (i.getName().startsWith("wlan")) return s;
                            if (achado.isEmpty()) achado = s;
                        }
                    }
                }
                return achado;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
