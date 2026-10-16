package br.com.olho;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Conversa com câmeras e gravadores Intelbras (API web igual à da Dahua) direto do celular.
// Mesma lógica do servidor.js da versão para computador.
final class Intelbras {
    static final int TEMPO = 5000;
    private static final SecureRandom ALEATORIO = new SecureRandom();
    private static final ExecutorService PORTAS = Executors.newCachedThreadPool();
    private static final Map<String, Semaphore> FILAS = new ConcurrentHashMap<>();
    private static final SSLSocketFactory TLS_DO_APARELHO = tlsDoAparelho();

    // Gravadores e câmeras usam certificado autoassinado: não há como validar. Só usado para IP de rede interna.
    private static SSLSocketFactory tlsDoAparelho() {
        try {
            TrustManager[] aceita = {new X509TrustManager() {
                @Override public void checkClientTrusted(X509Certificate[] c, String t) { }
                @Override public void checkServerTrusted(X509Certificate[] c, String t) { }
                @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, aceita, ALEATORIO);
            return ctx.getSocketFactory();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static final class Cam {
        String ip;
        String usuario;
        String senha;
        int portaHttp;
        int portaRtsp;
        volatile String desafio;
        volatile String desafioRtsp;
        volatile boolean https; // o aparelho redirecionou a página web para HTTPS
        volatile int portaHttps = 443;
    }

    static final class Resposta {
        int status;
        String erro;
        String www;
        String tipo;
        String local; // cabeçalho Location (redirecionamento)
        String servidor; // cabeçalho Server
        String redirecionado; // para onde o aparelho mandou (HTTP -> HTTPS)
        byte[] corpo = new byte[0];
        long ms;

        String texto() { return new String(corpo, StandardCharsets.UTF_8); }
    }

    private Intelbras() {}

    // Só rede interna: o app não pode virar ponte para a internet.
    static boolean ipInterno(String ip) {
        if (ip == null || !ip.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] p = ip.split("\\.");
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            n[i] = Integer.parseInt(p[i]);
            if (n[i] > 255) return false;
        }
        int a = n[0], b = n[1];
        return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
    }

    static String token() {
        byte[] b = new byte[24];
        ALEATORIO.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static String traduz(Exception e) {
        String m = String.valueOf(e.getMessage());
        if (e instanceof SocketTimeoutException) return "sem resposta";
        if (m.contains("ECONNREFUSED") || m.contains("refused")) return "porta fechada";
        if (m.contains("EHOSTUNREACH") || m.contains("No route")) return "aparelho não encontrado na rede";
        if (m.contains("ENETUNREACH")) return "rede inalcançável";
        if (m.contains("ECONNRESET") || m.contains("reset")) return "conexão derrubada pelo aparelho";
        if (m.contains("ETIMEDOUT") || m.contains("timed out")) return "sem resposta";
        return m;
    }

    // ---------- rede ----------

    private static JSONObject tcp(String ip, int porta, String nome) throws JSONException {
        return tcp(ip, porta, nome, TEMPO);
    }

    private static JSONObject tcp(String ip, int porta, String nome, int tempo) throws JSONException {
        long t0 = System.currentTimeMillis();
        JSONObject r = new JSONObject().put("porta", porta).put("nome", nome);
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, porta), tempo);
            r.put("ok", true);
        } catch (Exception e) {
            r.put("ok", false).put("erro", traduz(e));
        }
        return r.put("ms", System.currentTimeMillis() - t0);
    }

    private static String md5(String s) {
        try {
            byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder h = new StringBuilder();
            for (byte b : d) h.append(String.format("%02x", b));
            return h.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // Monta o cabeçalho Authorization (Digest ou Basic) a partir do desafio do aparelho.
    static String autorizacao(String desafio, Cam c, String metodo, String uri) {
        if (desafio.trim().toLowerCase(Locale.ROOT).startsWith("basic")) {
            return "Basic " + android.util.Base64.encodeToString(
                    (c.usuario + ":" + c.senha).getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
        }
        Map<String, String> p = new LinkedHashMap<>();
        Matcher m = Pattern.compile("(\\w+)=(?:\"([^\"]*)\"|([^\\s,]*))").matcher(desafio);
        while (m.find()) p.put(m.group(1).toLowerCase(Locale.ROOT), m.group(2) != null ? m.group(2) : m.group(3));
        String realm = p.getOrDefault("realm", "");
        String nonce = p.getOrDefault("nonce", "");
        String ha1 = md5(c.usuario + ":" + realm + ":" + c.senha);
        String ha2 = md5(metodo + ":" + uri);
        boolean qop = false;
        for (String q : p.getOrDefault("qop", "").split(",")) if (q.trim().equals("auth")) qop = true;
        String nc = "00000001";
        String cnonce = token().substring(0, 16);
        String resp = qop ? md5(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2) : md5(ha1 + ":" + nonce + ":" + ha2);
        StringBuilder h = new StringBuilder("Digest username=\"" + c.usuario + "\", realm=\"" + realm + "\", nonce=\"" + nonce
                + "\", uri=\"" + uri + "\", response=\"" + resp + "\"");
        if (p.containsKey("opaque")) h.append(", opaque=\"").append(p.get("opaque")).append('"');
        if (qop) h.append(", qop=auth, nc=").append(nc).append(", cnonce=\"").append(cnonce).append('"');
        return h.toString();
    }

    private static byte[] ler(InputStream in, int limite) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) {
            out.write(b, 0, n);
            if (out.size() > limite) throw new IOException("resposta grande demais");
        }
        return out.toByteArray();
    }

    private static Resposta pedidoHttp(Cam c, String caminho, String auth) {
        Resposta r = new Resposta();
        long t0 = System.currentTimeMillis();
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(c.https ? "https" : "http", c.ip, c.https ? c.portaHttps : c.portaHttp, caminho)
                    .openConnection(Proxy.NO_PROXY);
            if (con instanceof HttpsURLConnection) {
                // Certificado do gravador é sempre autoassinado. Só chega aqui para IP de rede interna.
                ((HttpsURLConnection) con).setSSLSocketFactory(TLS_DO_APARELHO);
                ((HttpsURLConnection) con).setHostnameVerifier((h, sessao) -> h.equals(c.ip));
            }
            con.setConnectTimeout(TEMPO);
            con.setReadTimeout(TEMPO * 2);
            con.setUseCaches(false);
            con.setInstanceFollowRedirects(false);
            if (auth != null) con.setRequestProperty("Authorization", auth);
            r.status = con.getResponseCode();
            r.www = con.getHeaderField("WWW-Authenticate");
            r.tipo = con.getContentType();
            r.local = con.getHeaderField("Location");
            r.servidor = con.getHeaderField("Server");
            r.corpo = ler(r.status >= 400 ? con.getErrorStream() : con.getInputStream(), 8 * 1024 * 1024);
        } catch (Exception e) {
            r.status = 0;
            r.erro = traduz(e);
        } finally {
            if (con != null) con.disconnect();
        }
        r.ms = System.currentTimeMillis() - t0;
        return r;
    }

    // GET com autenticação. Guarda o desafio para não errar a senha duas vezes (a Intelbras bloqueia após 5 erros).
    static Resposta get(Cam c, String caminho) {
        Resposta r = getSemRedirecionar(c, caminho);
        // Firmware novo costuma mandar a página web para HTTPS (301/302). Segue só se for o mesmo aparelho.
        if (!c.https && r.status >= 301 && r.status <= 308 && r.local != null) {
            try {
                URL destino = new URL(new URL("http", c.ip, c.portaHttp, caminho), r.local);
                if ("https".equals(destino.getProtocol()) && c.ip.equals(destino.getHost())) {
                    c.https = true;
                    c.portaHttps = destino.getPort() > 0 ? destino.getPort() : 443;
                    c.desafio = null;
                    r = getSemRedirecionar(c, caminho);
                    r.redirecionado = destino.toString();
                }
            } catch (Exception ignorado) {
                // Location inválido: fica com a resposta original
            }
        }
        return r;
    }

    private static Resposta getSemRedirecionar(Cam c, String caminho) {
        String d = c.desafio;
        Resposta r = pedidoHttp(c, caminho, d != null ? autorizacao(d, c, "GET", caminho) : null);
        if (r.status == 401 && r.www != null) {
            c.desafio = r.www;
            r = pedidoHttp(c, caminho, autorizacao(r.www, c, "GET", caminho));
        }
        return r;
    }

    // Gravador antigo trava se pedir 16 imagens de uma vez: no máximo 2 por aparelho.
    static Resposta imagem(Cam c, int canal) {
        Semaphore s = FILAS.computeIfAbsent(c.ip, k -> new Semaphore(2));
        s.acquireUninterruptibly();
        try {
            return get(c, "/cgi-bin/snapshot.cgi?channel=" + canal);
        } finally {
            s.release();
        }
    }

    private static Map<String, String> chaves(String texto) {
        Map<String, String> o = new LinkedHashMap<>();
        for (String l : texto.split("\\r?\\n")) {
            int i = l.indexOf('=');
            if (i > 0) o.put(l.substring(0, i).trim(), l.substring(i + 1).trim());
        }
        return o;
    }

    private static String mac(Cam c) {
        Resposta r = get(c, "/cgi-bin/configManager.cgi?action=getConfig&name=Network");
        if (r.status != 200) return "";
        for (Map.Entry<String, String> e : chaves(r.texto()).entrySet()) {
            if (e.getKey().endsWith(".PhysicalAddress") && !e.getValue().isEmpty()) return e.getValue().toUpperCase(Locale.ROOT);
        }
        return "";
    }

    private static int numero(Map<String, String> m, String sufixo) {
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (e.getKey().endsWith(sufixo)) {
                try { return Integer.parseInt(e.getValue().trim()); } catch (NumberFormatException ignorado) { return 0; }
            }
        }
        return 0;
    }

    // Canais com nome (ChannelTitle). Se o aparelho não tiver essa configuração, conta as entradas de vídeo
    // locais (DVR) e as remotas (NVR/câmeras IP) e numera "Canal N".
    static List<JSONObject> lerCanais(Cam c, String nomePadrao) throws JSONException {
        List<JSONObject> canais = new ArrayList<>();
        Resposta titulos = get(c, "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle");
        if (titulos.status == 200) {
            Pattern pt = Pattern.compile("ChannelTitle\\[(\\d+)\\]\\.Name$");
            for (Map.Entry<String, String> e : chaves(titulos.texto()).entrySet()) {
                Matcher m = pt.matcher(e.getKey());
                if (m.find()) canais.add(new JSONObject().put("canal", Integer.parseInt(m.group(1)) + 1).put("nome", e.getValue()));
            }
        }
        if (canais.isEmpty()) {
            Resposta locais = get(c, "/cgi-bin/devVideoInput.cgi?action=getCollect");
            Resposta remotos = get(c, "/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxRemoteInputChannels");
            int n = (locais.status == 200 ? numero(chaves(locais.texto()), "result") : 0)
                    + (remotos.status == 200 ? numero(chaves(remotos.texto()), "MaxRemoteInputChannels") : 0);
            n = Math.min(Math.max(n, 1), 128);
            for (int i = 1; i <= n; i++) {
                canais.add(new JSONObject().put("canal", i).put("nome", n == 1 && !nomePadrao.isEmpty() ? nomePadrao : "Canal " + i));
            }
        }
        return canais;
    }

    // Gravador: mais de um canal, ou classe/modelo de gravador (DVR, NVR, XVR, MHDX, NVD, HDCVI, VD...).
    static boolean ehGravador(String classe, String modelo, int canais) {
        return canais > 1 || Pattern.compile("DVR|NVR|XVR|HCVR|MHDX|NVD|IVR|HDCVI|MVD|SVR|GRAVADOR|\\bVD\\b")
                .matcher(classe.toUpperCase(Locale.ROOT) + " " + modelo.toUpperCase(Locale.ROOT)).find();
    }

    private static String firmware(Cam c) {
        Resposta r = get(c, "/cgi-bin/magicBox.cgi?action=getSoftwareVersion");
        return r.status == 200 ? chaves(r.texto()).getOrDefault("version", "") : "";
    }

    // Versão rápida da consulta, usada pelo scanner. Devolve null se o IP não parece um aparelho Intelbras.
    static JSONObject identificar(Cam c) throws Exception {
        Future<JSONObject> fWeb = PORTAS.submit(() -> tcp(c.ip, c.portaHttp, "Web (HTTP)", 800));
        Future<JSONObject> fSrv = PORTAS.submit(() -> tcp(c.ip, 37777, "Serviço Intelbras", 800));
        boolean web = fWeb.get().getBoolean("ok"), srv = fSrv.get().getBoolean("ok");
        if (!web && !srv) return null;
        JSONObject r = new JSONObject().put("ip", c.ip).put("modelo", "").put("tipo", "Intelbras").put("nome", "");
        if (!web) return r.put("situacao", "semweb");
        Resposta tipo = get(c, "/cgi-bin/magicBox.cgi?action=getDeviceType");
        if (tipo.status == 401) return srv ? r.put("situacao", "senha") : null;
        if (tipo.status != 200) return srv ? r.put("situacao", "desconhecido") : null;
        Map<String, String> t = chaves(tipo.texto());
        Resposta classe = get(c, "/cgi-bin/magicBox.cgi?action=getDeviceClass");
        Resposta nomeAp = get(c, "/cgi-bin/magicBox.cgi?action=getMachineName");
        String cl = classe.status == 200 ? chaves(classe.texto()).getOrDefault("class", "") : "";
        String modelo = t.getOrDefault("type", "Intelbras");
        String nome = nomeAp.status == 200 ? chaves(nomeAp.texto()).getOrDefault("name", "") : "";
        int canais = lerCanais(c, nome).size();
        boolean gravador = ehGravador(cl, modelo, canais);
        r.put("modelo", modelo).put("gravador", gravador).put("tipo", gravador ? "Gravador" : "Câmera")
                .put("nome", nome).put("mac", mac(c)).put("canais", gravador ? canais : 1).put("firmware", firmware(c));
        return r.put("situacao", "online");
    }

    // ---------- RTSP ----------

    private static String[] pedidoRtsp(Cam c, String uri, String auth) {
        // devolve {status, desafio, sdp} ou {null, erro}
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(c.ip, c.portaRtsp), TEMPO);
            s.setSoTimeout(TEMPO);
            OutputStream out = s.getOutputStream();
            String req = "DESCRIBE " + uri + " RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: OlhoIntelbras\r\n"
                    + (auth != null ? "Authorization: " + auth + "\r\n" : "") + "\r\n";
            out.write(req.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            InputStream in = s.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) {
                buf.write(b, 0, n);
                if (buf.size() > 65536) return new String[]{null, "resposta inválida"};
                String t = buf.toString("ISO-8859-1");
                int fim = t.indexOf("\r\n\r\n");
                if (fim < 0) continue;
                String cab = t.substring(0, fim);
                Matcher tam = Pattern.compile("(?i)content-length:\\s*(\\d+)").matcher(cab);
                int len = tam.find() ? Integer.parseInt(tam.group(1)) : 0;
                String corpo = t.substring(fim + 4);
                if (corpo.length() < len) continue;
                Matcher st = Pattern.compile("^RTSP/1\\.0 (\\d+)").matcher(cab);
                Matcher w = Pattern.compile("(?i)www-authenticate:\\s*(.+)").matcher(cab);
                return new String[]{st.find() ? st.group(1) : "0", w.find() ? w.group(1).trim() : null, corpo};
            }
            return new String[]{null, "conexão encerrada pelo aparelho"};
        } catch (Exception e) {
            return new String[]{null, traduz(e)};
        }
    }

    private static JSONObject rtsp(Cam c) throws JSONException {
        String uri = "rtsp://" + c.ip + ":" + c.portaRtsp + "/cam/realmonitor?channel=1&subtype=0";
        long t0 = System.currentTimeMillis();
        String d = c.desafioRtsp;
        String[] r = pedidoRtsp(c, uri, d != null ? autorizacao(d, c, "DESCRIBE", uri) : null);
        if ("401".equals(r[0]) && r[1] != null) {
            c.desafioRtsp = r[1];
            r = pedidoRtsp(c, uri, autorizacao(r[1], c, "DESCRIBE", uri));
        }
        JSONObject o = new JSONObject().put("ms", System.currentTimeMillis() - t0);
        if (r[0] == null) return o.put("ok", false).put("erro", r[1]);
        if ("401".equals(r[0])) return o.put("ok", false).put("erro", "usuário ou senha recusados no RTSP");
        if (!"200".equals(r[0])) return o.put("ok", false).put("erro", "o aparelho respondeu " + r[0]);
        Matcher m = Pattern.compile("(?i)a=rtpmap:\\d+ (H\\.?26[45]|MJPEG|JPEG)").matcher(r[2]);
        String codec = m.find() ? m.group(1).toUpperCase(Locale.ROOT).replace(".", "") : "desconhecido";
        return o.put("ok", true).put("codec", codec).put("url", uri.replace("rtsp://", "rtsp://usuario:senha@"));
    }

    // ---------- consulta principal ----------

    static JSONObject consultar(Cam c) throws Exception {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject r = new JSONObject().put("ip", c.ip).put("quando", iso.format(new Date()));
        JSONArray avisos = new JSONArray();
        r.put("avisos", avisos);

        Future<JSONObject> fWeb = PORTAS.submit(() -> tcp(c.ip, c.portaHttp, "Web (HTTP)"));
        Future<JSONObject> fRtsp = PORTAS.submit(() -> tcp(c.ip, c.portaRtsp, "Vídeo (RTSP)"));
        Future<JSONObject> fSrv = PORTAS.submit(() -> tcp(c.ip, 37777, "Serviço Intelbras"));
        JSONObject web = fWeb.get(), rtspPorta = fRtsp.get(), srv = fSrv.get();
        r.put("portas", new JSONArray().put(web).put(rtspPorta).put(srv));

        if (!web.getBoolean("ok") && !rtspPorta.getBoolean("ok") && !srv.getBoolean("ok")) {
            r.put("situacao", "offline");
            r.put("diagnostico", "porta fechada".equals(web.optString("erro"))
                    ? "O IP responde, mas nenhuma porta de câmera está aberta. Pode não ser um aparelho Intelbras."
                    : "Nada respondeu nesse IP. Confira se o aparelho está ligado, o cabo/PoE e se o celular está no Wi-Fi da mesma rede.");
            return r;
        }
        if (!web.getBoolean("ok")) {
            return r.put("situacao", "atencao").put("diagnostico", "A porta web " + c.portaHttp + " não respondeu ("
                    + web.optString("erro") + "). Se o aparelho usa outra porta HTTP, informe em \"Portas\".");
        }

        Resposta tipo = get(c, "/cgi-bin/magicBox.cgi?action=getDeviceType");
        if (tipo.status == 401) {
            return r.put("situacao", "senha").put("diagnostico",
                    "O aparelho recusou o usuário ou a senha. Atenção: depois de 5 erros a Intelbras bloqueia o usuário por alguns minutos.");
        }
        if (tipo.status != 200) {
            return r.put("situacao", "atencao").put("diagnostico", tipo.erro != null
                    ? "A página web não respondeu (" + tipo.erro + ")."
                    : "A página web respondeu " + tipo.status + ", mas não reconheci a API Intelbras. Linhas como Mibo e iM usam outro sistema.");
        }

        Map<String, String> t = chaves(tipo.texto());
        Resposta classe = get(c, "/cgi-bin/magicBox.cgi?action=getDeviceClass");
        Resposta sistema = get(c, "/cgi-bin/magicBox.cgi?action=getSystemInfo");
        Resposta nomeAp = get(c, "/cgi-bin/magicBox.cgi?action=getMachineName");
        Map<String, String> cl = classe.status == 200 ? chaves(classe.texto()) : new LinkedHashMap<>();
        Map<String, String> si = sistema.status == 200 ? chaves(sistema.texto()) : new LinkedHashMap<>();
        Map<String, String> no = nomeAp.status == 200 ? chaves(nomeAp.texto()) : new LinkedHashMap<>();

        String modelo = t.containsKey("type") ? t.get("type") : si.getOrDefault("deviceType", "Intelbras");
        String classeTxt = (cl.containsKey("class") ? cl.get("class") : si.getOrDefault("deviceType", "")).toUpperCase(Locale.ROOT);
        String nome = no.getOrDefault("name", "");
        List<JSONObject> canais = lerCanais(c, nome.isEmpty() ? "Canal 1" : nome);
        boolean gravador = ehGravador(classeTxt, modelo, canais.size());
        if (!gravador) canais = canais.subList(0, 1);
        r.put("modelo", modelo).put("nome", nome).put("serie", si.getOrDefault("serialNumber", ""))
                .put("gravador", gravador).put("tipo", gravador ? "Gravador" : "Câmera").put("webMs", tipo.ms)
                .put("mac", mac(c)).put("firmware", firmware(c)).put("https", c.https);

        int semVideo = 0;
        if (gravador) {
            Resposta perda = get(c, "/cgi-bin/eventManager.cgi?action=getEventIndexes&code=VideoLoss");
            if (perda.status == 200) {
                Set<Integer> sem = new HashSet<>();
                for (String v : chaves(perda.texto()).values()) {
                    try { sem.add(Integer.parseInt(v) + 1); } catch (NumberFormatException ignorado) { /* linha estranha */ }
                }
                for (JSONObject ch : canais) {
                    boolean s = sem.contains(ch.getInt("canal"));
                    ch.put("semVideo", s);
                    if (s) semVideo++;
                }
            }
        }
        JSONArray lista = new JSONArray();
        for (JSONObject ch : canais) lista.put(ch);
        r.put("canais", lista);

        if (!gravador && rtspPorta.getBoolean("ok")) {
            JSONObject v = rtsp(c);
            r.put("rtsp", v);
            if (!v.getBoolean("ok")) avisos.put("Vídeo RTSP: " + v.optString("erro"));
        } else if (!rtspPorta.getBoolean("ok")) {
            avisos.put("Porta de vídeo " + c.portaRtsp + " " + rtspPorta.optString("erro") + ": NVR/VMS pode não conseguir puxar o vídeo.");
        }
        if (semVideo > 0) avisos.put(semVideo + " canal(is) sem vídeo.");

        r.put("situacao", avisos.length() > 0 ? "atencao" : "online");
        r.put("diagnostico", gravador
                ? "Gravador com " + canais.size() + " canal(is). Toque em uma imagem para ampliar."
                : "Câmera respondendo. Imagem capturada agora.");
        return r;
    }

    // ---------- diagnóstico: o que o aparelho responde, para descobrir por que não foi reconhecido ----------

    static final String[] SONDAS = {
        "/",
        "/cgi-bin/magicBox.cgi?action=getDeviceType",
        "/cgi-bin/magicBox.cgi?action=getDeviceClass",
        "/cgi-bin/magicBox.cgi?action=getSystemInfo",
        "/cgi-bin/magicBox.cgi?action=getSoftwareVersion",
        "/cgi-bin/magicBox.cgi?action=getMachineName",
        "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle",
        "/cgi-bin/devVideoInput.cgi?action=getCollect",
        "/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxRemoteInputChannels",
        "/cgi-bin/snapshot.cgi?channel=1",
        "/cgi-bin/snapshot.cgi?channel=2",
        "/onvif/device_service",
    };
    static final int[] PORTAS_DIAGNOSTICO = {80, 443, 554, 37777, 34567, 8000, 8080, 8899, 9000};

    private static String trecho(Resposta x) {
        if (x.tipo != null && x.tipo.startsWith("image")) return "[imagem " + x.corpo.length + " bytes]";
        String t = new String(x.corpo, 0, Math.min(x.corpo.length, 600), StandardCharsets.UTF_8);
        return t.replaceAll("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]", "").trim();
    }

    // Só o tipo e o realm do desafio (nunca a resposta com senha).
    private static String desafioResumido(String www) {
        if (www == null) return "";
        Matcher m = Pattern.compile("(?i)realm=\"([^\"]*)\"").matcher(www);
        return www.trim().split("\\s+")[0] + (m.find() ? " realm=\"" + m.group(1) + "\"" : "");
    }

    static JSONObject diagnostico(Cam c) throws Exception {
        JSONObject r = new JSONObject().put("ip", c.ip).put("quando", new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(new Date()))
                .put("usuario", c.usuario).put("portaHttp", c.portaHttp).put("portaRtsp", c.portaRtsp);
        List<Future<JSONObject>> fs = new ArrayList<>();
        Set<Integer> portas = new java.util.TreeSet<>();
        for (int p : PORTAS_DIAGNOSTICO) portas.add(p);
        portas.add(c.portaHttp);
        portas.add(c.portaRtsp);
        for (int p : portas) fs.add(PORTAS.submit(() -> tcp(c.ip, p, "", 1500)));
        JSONArray abertas = new JSONArray();
        for (Future<JSONObject> f : fs) {
            JSONObject x = f.get();
            x.remove("nome");
            abertas.put(x);
        }
        r.put("portas", abertas);

        JSONArray pedidos = new JSONArray();
        for (String sonda : SONDAS) {
            Resposta x = get(c, sonda);
            JSONObject o = new JSONObject().put("caminho", sonda).put("status", x.status).put("ms", x.ms);
            if (x.erro != null) o.put("erro", x.erro);
            if (x.tipo != null) o.put("tipo", x.tipo);
            if (x.servidor != null) o.put("servidor", x.servidor);
            if (x.redirecionado != null || x.local != null) o.put("redireciona", x.redirecionado != null ? x.redirecionado : x.local);
            if (x.www != null) o.put("desafio", desafioResumido(x.www));
            if (c.https) o.put("https", true);
            o.put("trecho", trecho(x));
            pedidos.put(o);
            if (x.status == 401 && c.desafio != null) {
                r.put("parou", "Senha recusada: parei aqui para não bloquear o usuário (a Intelbras bloqueia após 5 erros).");
                break;
            }
            if (x.status == 0 && "/".equals(sonda)) {
                r.put("parou", "A página web não respondeu.");
                break;
            }
        }
        return r.put("pedidos", pedidos);
    }
}
