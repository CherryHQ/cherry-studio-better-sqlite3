const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  getNativeArtifactPaths,
  readProjectBuildMetadata,
  verifyNativeArtifact
} = require('./linux-native/compat')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const ARCHS = Object.freeze(['x64', 'arm64'])

function expectedReleaseTag(metadata, revision) {
  return `better-sqlite3-v${metadata.betterSqlite3Version}-electron-v${metadata.electronVersion}-r${revision}`
}

function parseReleaseTag(tag, metadata) {
  const prefix = `better-sqlite3-v${metadata.betterSqlite3Version}-electron-v${metadata.electronVersion}-r`
  if (!tag.startsWith(prefix) || !/^\d+$/.test(tag.slice(prefix.length))) {
    throw new Error(`Release tag must match ${prefix}<revision>; received ${tag}`)
  }
  return tag.slice(prefix.length)
}

function getAssetNames(metadata, arch) {
  const stem = `better_sqlite3-v${metadata.betterSqlite3Version}-electron-v${metadata.electronVersion}-linux-${arch}`
  return {
    addon: `${stem}.node`,
    manifest: `${stem}.manifest.json`
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function prepareRelease(projectRoot, tag) {
  const metadata = readProjectBuildMetadata(projectRoot)
  parseReleaseTag(tag, metadata)

  const distDir = path.join(projectRoot, 'dist')
  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(distDir, { recursive: true })

  const checksums = []
  for (const arch of ARCHS) {
    const artifactPaths = getNativeArtifactPaths(projectRoot, arch)
    verifyNativeArtifact({
      ...artifactPaths,
      expected: { ...metadata, arch }
    })

    const names = getAssetNames(metadata, arch)
    const addonDestination = path.join(distDir, names.addon)
    const manifestDestination = path.join(distDir, names.manifest)
    fs.copyFileSync(artifactPaths.addonPath, addonDestination)
    fs.copyFileSync(artifactPaths.manifestPath, manifestDestination)
    checksums.push(`${sha256(addonDestination)}  ${names.addon}`)
    checksums.push(`${sha256(manifestDestination)}  ${names.manifest}`)
  }

  const licenseName = 'better-sqlite3-LICENSE'
  const licenseDestination = path.join(distDir, licenseName)
  fs.copyFileSync(path.join(projectRoot, 'licenses', licenseName), licenseDestination)
  checksums.push(`${sha256(licenseDestination)}  ${licenseName}`)
  fs.writeFileSync(path.join(distDir, 'SHA256SUMS'), `${checksums.sort().join('\n')}\n`)

  return { distDir, metadata }
}

function main() {
  const tag = process.argv[2]
  if (!tag) throw new Error('Provide the release tag as the first argument')
  const { distDir, metadata } = prepareRelease(PROJECT_ROOT, tag)
  process.stdout.write(
    `Prepared ${tag} for better-sqlite3 ${metadata.betterSqlite3Version}, ` +
      `Electron ${metadata.electronVersion} (ABI ${metadata.electronAbi}) at ${distDir}\n`
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  expectedReleaseTag,
  getAssetNames,
  parseReleaseTag,
  prepareRelease
}
