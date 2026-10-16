package br.com.olho;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Tela do app: a mesma página da versão para computador, servida de dentro do APK.
// Não abre nenhuma porta no celular; a página só fala com o código Java abaixo.
public class MainActivity extends Activity {
    private static final String HOST = "olho.local";
    private static final long CONSULTA_MS = 10 * 60 * 1000; // credencial da câmera fica 10 min na memória
    private static final Pattern ARQUIVO = Pattern.compile("^/([\\w-]+\\.(html|js|css|svg|webmanifest|png))$");
    private static final Pattern IMAGEM = Pattern.compile("^/api/imagem/([a-f0-9]{48})/(\\d{1,3})$");
    private static final String CSP = "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    private static final class Consulta {
        final Intelbras.Cam cam;
        final long expira;
        Consulta(Intelbras.Cam cam) { this.cam = cam; this.expira = System.currentTimeMillis() + CONSULTA_MS; }
    }

    private final Map<String, Consulta> consultas = new ConcurrentHashMap<>();
    private final ExecutorService exec = Executors.newCachedThreadPool();
    private WebView web;

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
        exec.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

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

    private static int porta(String v, int padrao) {
        try {
            int n = v == null || v.trim().isEmpty() ? padrao : Integer.parseInt(v.trim());
            return n > 0 && n < 65536 ? n : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    // Chamado pelo app.js: window.Olho.consultar(id, json). A resposta volta por window.__olho(id, json).
    private final class Ponte {
        @JavascriptInterface
        public void consultar(final int id, final String json) {
            exec.execute(() -> {
                JSONObject r;
                try {
                    JSONObject b = new JSONObject(json);
                    Intelbras.Cam cam = new Intelbras.Cam();
                    cam.ip = b.optString("ip", "").trim();
                    cam.usuario = limitar(b.optString("usuario", "admin"), 64);
                    cam.senha = limitar(b.optString("senha", ""), 128);
                    cam.portaHttp = porta(b.optString("portaHttp"), 80);
                    cam.portaRtsp = porta(b.optString("portaRtsp"), 554);
                    if (cam.usuario.isEmpty()) cam.usuario = "admin";
                    if (!Intelbras.ipInterno(cam.ip)) {
                        r = new JSONObject().put("erro", "Use um IP da rede interna (ex.: 192.168.1.108).");
                    } else if (cam.portaHttp < 0 || cam.portaRtsp < 0) {
                        r = new JSONObject().put("erro", "Porta inválida.");
                    } else {
                        r = Intelbras.consultar(cam);
                        if (r.has("canais")) {
                            String t = Intelbras.token();
                            consultas.put(t, new Consulta(cam));
                            r.put("token", t);
                        }
                    }
                } catch (Exception e) {
                    r = new JSONObject();
                    try { r.put("erro", "Falha no teste: " + e.getMessage()); } catch (Exception ignorado) { /* sem saída */ }
                }
                final String js = "window.__olho(" + id + "," + JSONObject.quote(r.toString()) + ")";
                web.post(() -> web.evaluateJavascript(js, null));
            });
        }

        private String limitar(String s, int max) {
            return s.length() > max ? s.substring(0, max) : s;
        }
    }
}
