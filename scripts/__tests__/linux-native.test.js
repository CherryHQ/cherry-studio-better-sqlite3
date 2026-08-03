const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { afterEach, describe, it } = require('node:test')

const { parseTargetArchs, readBaseImage } = require('../linux-native/build')
const {
  ARCH_TO_ELF_MACHINE,
  createNativeManifest,
  parseVersionRequirements,
  verifyNativeArtifact
} = require('../linux-native/compat')
const { getAssetNames, parseReleaseTag } = require('../prepare-release')

const metadata = {
  nodeVersion: '24.11.1',
  electronVersion: '41.8.0',
  electronAbi: '145',
  betterSqlite3Version: '12.11.1',
  electronRebuildVersion: '4.0.4',
  buildFingerprint: 'a'.repeat(64)
}
const toolchain = {
  baseImage: 'almalinux:8@sha256:test',
  electronHeadersSha256: 'test',
  glibcVersion: '2.28',
  gccVersion: '11.2.1',
  pythonVersion: '3.11.13'
}

let temporaryDirectories = []

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-better-sqlite3-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeFakeAddon(addonPath, arch, requirements = ['GLIBC_2.28', 'GLIBCXX_3.4.20', 'CXXABI_1.3.9']) {
  const header = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(header)
  header[4] = 2
  header[5] = 1
  header.writeUInt16LE(ARCH_TO_ELF_MACHINE[arch], 18)
  fs.writeFileSync(addonPath, Buffer.concat([header, Buffer.from(`\0${requirements.join('\0')}\0`)]))
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories = []
})

describe('compatibility manifest', () => {
  it('records the highest requirement for each ABI family', () => {
    assert.deepEqual(
      parseVersionRequirements('GLIBC_2.17 GLIBC_2.28 GLIBCXX_3.4.18 GLIBCXX_3.4.20 CXXABI_1.3.9'),
      { glibc: '2.28', glibcxx: '3.4.20', cxxabi: '1.3.9' }
    )
  })

  it('rejects an artifact requiring a newer GLIBC', () => {
    const directory = temporaryDirectory()
    const addonPath = path.join(directory, 'better_sqlite3.node')
    writeFakeAddon(addonPath, 'x64', ['GLIBC_2.29', 'GLIBCXX_3.4.20', 'CXXABI_1.3.9'])
    assert.throws(
      () => createNativeManifest({ addonPath, metadata, arch: 'x64', toolchain }),
      /GLIBC_2\.29/
    )
  })

  it('detects an architecture or checksum mismatch', () => {
    const directory = temporaryDirectory()
    const addonPath = path.join(directory, 'better_sqlite3.node')
    const manifestPath = path.join(directory, 'manifest.json')
    writeFakeAddon(addonPath, 'x64')
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(createNativeManifest({ addonPath, metadata, arch: 'x64', toolchain }))}\n`
    )

    assert.throws(
      () => verifyNativeArtifact({ addonPath, manifestPath, expected: { ...metadata, arch: 'arm64' } }),
      /manifest field arch/
    )
    fs.appendFileSync(addonPath, 'modified')
    assert.throws(
      () => verifyNativeArtifact({ addonPath, manifestPath, expected: { ...metadata, arch: 'x64' } }),
      /checksum mismatch/
    )
  })
})
describe('build inputs', () => {
  it('pins the AlmaLinux base image by digest', () => {
    assert.match(readBaseImage(), /^docker\.io\/library\/almalinux:8@sha256:[a-f0-9]{64}$/)
  })

  it('accepts only supported target architectures', () => {
    assert.deepEqual(parseTargetArchs(['x64', 'arm64', 'x64']), ['x64', 'arm64'])
    assert.throws(() => parseTargetArchs(['ia32']), /Unsupported Linux architecture/)
  })
})

describe('release naming', () => {
  it('accepts only a version-matched release tag', () => {
    assert.equal(parseReleaseTag('better-sqlite3-v12.11.1-electron-v41.8.0-r1', metadata), '1')
    assert.throws(
      () => parseReleaseTag('better-sqlite3-v12.11.1-electron-v42.0.0-r1', metadata),
      /Release tag must match/
    )
  })

  it('uses architecture-specific asset names', () => {
    assert.deepEqual(getAssetNames(metadata, 'arm64'), {
      addon: 'better_sqlite3-v12.11.1-electron-v41.8.0-linux-arm64.node',
      manifest: 'better_sqlite3-v12.11.1-electron-v41.8.0-linux-arm64.manifest.json'
    })
  })
})
