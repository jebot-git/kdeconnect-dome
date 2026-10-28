# Dome Connect

A native KDE Connect protocol service for de-xr, forked from GSConnect 74.
The service runs with GIO/GJS and TLS; interactive dialogs use FLTK. The default
build and installed runtime require neither Qt nor GTK.

The existing DomeD device controls retain a KDE-compatible D-Bus API. LAN
pairing, battery reporting and certificate-pinned SSHFS have been verified
with an existing paired phone without changing its pairing identity.

Build as the regular user in the de-xr workspace:

```sh
meson setup build --prefix=/usr/local
meson compile -C build
meson test -C build --print-errorlogs
DESTDIR="$PWD/stage" meson install -C build --no-rebuild
```

Use `python3 tools/package-domed.py BUILD_DIR` to build an installable RPM.
Only installation into system paths needs sudo. Do not compile as root.

See [README.DOMED](README.DOMED) for dependencies, migration, supported paths,
security behavior, test requirements and current limitations. This replacement
does not claim complete UI/API parity with the original KDE daemon. Bluetooth
transport is not implemented.

Original GNOME extension sources remain for reference and attribution; they
are not built or installed. The original documentation is preserved in
[README.upstream.md](README.upstream.md). Source licenses remain in LICENSES.
