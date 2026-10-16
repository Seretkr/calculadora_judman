package android.util;

// Substituto do android.util.Base64 para rodar o Intelbras.java fora do Android (só nos testes).
public final class Base64 {
    public static final int NO_WRAP = 2;

    private Base64() {}

    public static String encodeToString(byte[] b, int flags) {
        return java.util.Base64.getEncoder().encodeToString(b);
    }

    public static byte[] decode(String s, int flags) {
        return java.util.Base64.getDecoder().decode(s);
    }
}
