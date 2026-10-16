package br.com.olho;

import org.json.JSONObject;

// Acesso de teste às funções do Intelbras.java (que são do pacote br.com.olho).
public final class IntelbrasPonte {
    private IntelbrasPonte() {}

    private static Intelbras.Cam cam(String ip, String senha) {
        Intelbras.Cam c = new Intelbras.Cam();
        c.ip = ip;
        c.usuario = "admin";
        c.senha = senha;
        c.portaHttp = 18080;
        c.portaRtsp = 18554;
        return c;
    }

    public static boolean ipInterno(String ip) { return Intelbras.ipInterno(ip); }

    public static JSONObject consultar(String ip, String senha) throws Exception { return Intelbras.consultar(cam(ip, senha)); }

    public static JSONObject identificar(String ip, String senha) throws Exception { return Intelbras.identificar(cam(ip, senha)); }

    public static JSONObject imagem(String ip, String senha, int canal) throws Exception {
        Intelbras.Resposta r = Intelbras.imagem(cam(ip, senha), canal);
        return new JSONObject().put("status", r.status).put("tipo", r.tipo).put("tamanho", r.corpo.length)
                .put("jpeg", r.corpo.length > 2 && (r.corpo[0] & 0xff) == 0xff && (r.corpo[1] & 0xff) == 0xd8);
    }
}
