#!/usr/bin/env bash
# Compila o APK do Elétrica OS sem Android Studio/Gradle.
# Requisitos: java (JDK 17+), python3 com Pillow, curl, zip, unzip.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="${TOOLS:-$HOME/.cache/eletricaos-tools}"
BUILD="$HERE/build"
OUT="$HERE/dist/EletricaOS.apk"
KEYSTORE="$HERE/keystore/eletricaos.p12"
KEYPASS="${KEYPASS:-eletricaos}"
ALIAS="eletricaos"

mkdir -p "$TOOLS"
fetch() { [ -s "$TOOLS/$1" ] || curl -sSfL -o "$TOOLS/$1" "$2"; }

echo "==> Ferramentas"
fetch android.jar https://raw.githubusercontent.com/Sable/android-platforms/master/android-35/android.jar
fetch dx.jar https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar
fetch apksig.jar https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
if [ ! -x "$TOOLS/aapt2" ]; then
  fetch aaptjs3.tgz https://registry.npmjs.org/aaptjs3/-/aaptjs3-2.0.2.tgz
  tar xzf "$TOOLS/aaptjs3.tgz" -C "$TOOLS" package/bin/x64/linux/aapt2
  mv "$TOOLS/package/bin/x64/linux/aapt2" "$TOOLS/aapt2" && chmod +x "$TOOLS/aapt2"
fi

rm -rf "$BUILD" && mkdir -p "$BUILD"/{res,classes,assets,signer} "$(dirname "$OUT")"

echo "==> Recursos"
cp -r "$HERE/android/res/." "$BUILD/res/"
python3 "$HERE/tools/make_icons.py" "$BUILD/res"
"$TOOLS/aapt2" compile --dir "$BUILD/res" -o "$BUILD/res.zip"
cp -r "$HERE/www" "$BUILD/assets/www"
"$TOOLS/aapt2" link -o "$BUILD/base.apk" -I "$TOOLS/android.jar" \
  --manifest "$HERE/android/AndroidManifest.xml" -A "$BUILD/assets" "$BUILD/res.zip"

echo "==> Java -> dex"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$TOOLS/android.jar" -d "$BUILD/classes" \
  $(find "$HERE/android/src" -name '*.java')
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$BUILD/classes.dex" "$BUILD/classes"
(cd "$BUILD" && zip -q -j base.apk classes.dex)
python3 "$HERE/tools/zipalign.py" "$BUILD/base.apk" "$BUILD/aligned.apk"

echo "==> Assinatura"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -storepass "$KEYPASS" \
    -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Eletrica OS, O=Judman, C=BR"
fi
javac -nowarn -cp "$TOOLS/apksig.jar" -d "$BUILD/signer" "$HERE/tools/Sign.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED \
  -cp "$TOOLS/apksig.jar:$BUILD/signer" Sign "$BUILD/aligned.apk" "$OUT" "$KEYSTORE" "$KEYPASS" "$ALIAS"

ls -lh "$OUT"
