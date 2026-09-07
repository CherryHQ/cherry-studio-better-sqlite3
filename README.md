# Cherry Studio better-sqlite3

Reproducible Linux `better-sqlite3` prebuilds for
[Cherry Studio](https://github.com/CherryHQ/cherry-studio).

The official `better-sqlite3` npm package remains the source dependency. This repository only builds the native
addon for Cherry Studio's pinned Electron ABI and publishes the verified output as GitHub Release assets. It is not
an npm package.

## Compatibility contract

Release artifacts are built for Linux x64 and ARM64 in a digest-pinned AlmaLinux 8 container. A release is rejected
unless each addon:

- is a 64-bit ELF file for the requested architecture;
- targets the configured Electron and `better-sqlite3` versions;
- requires no newer than GLIBC 2.28, GLIBCXX 3.4.25, and CXXABI 1.3.11;
- matches the SHA-256 checksum recorded in its manifest.

## Local build

Requirements:

- Node.js 24.11.1;
- Docker;
- binfmt/QEMU when building an architecture different from the Docker host.

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run prepare:release -- better-sqlite3-v12.11.1-electron-v44.2.0-r1
```

Generated native addons are written under `scripts/linux-native/prebuilt/`. Prepared release assets are written to
`dist/`. Both directories are intentionally ignored by Git.

## Release process

1. Update the pinned versions in `package.json` and `.node-version`.
2. Build and test both architectures locally when possible.
3. Push a signed tag named `better-sqlite3-v<version>-electron-v<version>-r<revision>`.
4. The release workflow rebuilds both architectures, validates them, creates checksums and manifests, attests the
   artifacts, and publishes a GitHub Release.
5. Pin the new tag, filenames, and SHA-256 values in Cherry Studio's `scripts/linux-native/release.json`.

Do not consume a floating release such as `latest` from application builds.

## Licensing

The build tooling is licensed under AGPL-3.0-only. `better-sqlite3` is MIT licensed; its license is retained in
[`licenses/better-sqlite3-LICENSE`](licenses/better-sqlite3-LICENSE). SQLite itself is in the public domain.
