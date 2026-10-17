import com.android.apksig.ApkSigner;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/** Assina o APK (esquema v2) usando a biblioteca apksig. */
public class Sign {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) {
            System.err.println("uso: Sign <entrada.apk> <saida.apk> <keystore.p12> <senha> <alias>");
            System.exit(2);
        }
        char[] pass = args[3].toCharArray();
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(args[2])) {
            ks.load(in, pass);
        }
        PrivateKey key = (PrivateKey) ks.getKey(args[4], pass);
        X509Certificate cert = (X509Certificate) ks.getCertificate(args[4]);

        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder(
                "CERT", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(new File(args[0]))
                .setOutputApk(new File(args[1]))
                .setMinSdkVersion(24)
                .setV1SigningEnabled(false) // minSdk 24 já suporta v2
                .setV2SigningEnabled(true)
                .build()
                .sign();
        System.out.println("APK assinado: " + args[1]);
    }
}
