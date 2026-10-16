import br.com.olho.IntelbrasPonte;
import org.json.JSONObject;

// Roda o Intelbras.java do app contra os aparelhos falsos e imprime um JSON com os resultados.
// Quem confere os resultados é testes/intelbras-java.test.js.
public class TesteIntelbras {
    public static void main(String[] a) throws Exception {
        JSONObject r = new JSONObject();
        String[] ips = {"10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254",
                "172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "127.0.0.1", "0.0.0.0", "256.1.1.1", "192.168.1", "abc", ""};
        JSONObject internos = new JSONObject();
        for (String ip : ips) internos.put(ip, IntelbrasPonte.ipInterno(ip));
        r.put("ipInterno", internos);
        r.put("gravador", IntelbrasPonte.consultar("127.0.0.10", "senha123"));
        r.put("camera", IntelbrasPonte.consultar("127.0.0.20", "senha123"));
        r.put("senhaErrada", IntelbrasPonte.consultar("127.0.0.30", "errada"));
        r.put("offline", IntelbrasPonte.consultar("127.0.0.99", "x"));
        r.put("idGravador", IntelbrasPonte.identificar("127.0.0.10", "senha123"));
        r.put("idCamera", IntelbrasPonte.identificar("127.0.0.41", "senha123"));
        r.put("idSenhaErrada", IntelbrasPonte.identificar("127.0.0.30", "errada"));
        r.put("idNada", String.valueOf(IntelbrasPonte.identificar("127.0.0.99", "x")));
        r.put("diagSenhaErrada", IntelbrasPonte.diagnostico("127.0.0.30", "errada-diag"));
        r.put("idImpostor", String.valueOf(IntelbrasPonte.identificar("127.0.0.50", "senha123")));
        r.put("imagem", IntelbrasPonte.imagem("127.0.0.20", "senha123", 1));
        r.put("dvrAntigo", IntelbrasPonte.consultar("127.0.0.60", "senha123"));
        r.put("nvrHttps", IntelbrasPonte.consultar("127.0.0.70", "senha123"));
        r.put("idDvrAntigo", IntelbrasPonte.identificar("127.0.0.60", "senha123"));
        r.put("idNvrHttps", IntelbrasPonte.identificar("127.0.0.70", "senha123"));
        r.put("imagemNvrHttps", IntelbrasPonte.imagem("127.0.0.70", "senha123", 3));
        r.put("diagCamera", IntelbrasPonte.diagnostico("127.0.0.20", "senha123"));
        r.put("diagNvrHttps", IntelbrasPonte.diagnostico("127.0.0.70", "senha123"));
        System.out.println(r.toString());
        System.exit(0); // o Intelbras.java mantém threads de espera abertas
    }
}
