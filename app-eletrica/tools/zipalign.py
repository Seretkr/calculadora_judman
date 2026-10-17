"""zipalign mínimo: alinha em 4 bytes os arquivos não comprimidos do APK
(o Android 11+ exige isso para o resources.arsc)."""
import sys
import zipfile


def main(src, dst, align=4):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            novo = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            novo.compress_type = info.compress_type
            novo.external_attr = info.external_attr
            novo.extra = b""
            if info.compress_type == zipfile.ZIP_STORED:
                inicio = zout.fp.tell() + 30 + len(info.filename.encode("utf-8"))
                novo.extra = b"\0" * ((align - inicio % align) % align)
            zout.writestr(novo, data)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
