const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { createNativeManifest } = require('./compat')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'inherit'
  })
}

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
}

function main() {
  const arch = requireEnv('CHERRY_TARGET_ARCH')
  const metadata = {
    nodeVersion: requireEnv('CHERRY_NODE_VERSION'),
    electronVersion: requireEnv('CHERRY_ELECTRON_VERSION'),
    electronAbi: requireEnv('CHERRY_ELECTRON_ABI'),
    betterSqlite3Version: requireEnv('CHERRY_BETTER_SQLITE3_VERSION'),
    electronRebuildVersion: requireEnv('CHERRY_ELECTRON_REBUILD_VERSION'),
    buildFingerprint: requireEnv('CHERRY_BUILD_FINGERPRINT')
  }
  const baseImage = requireEnv('CHERRY_BASE_IMAGE')

  if (process.arch !== arch) {
    throw new Error(`Container architecture mismatch: expected ${arch}, running ${process.arch}`)
  }
  if (process.version.slice(1) !== metadata.nodeVersion) {
    throw new Error(`Container Node mismatch: expected ${metadata.nodeVersion}, running ${process.version}`)
  }

  const workDir = '/workspace'
  const installedRebuildVersion = require(
    path.join(workDir, 'node_modules', '@electron', 'rebuild', 'package.json')
  ).version
  const installedBetterSqlite3Version = require(
    path.join(workDir, 'node_modules', 'better-sqlite3', 'package.json')
  ).version
  if (installedRebuildVersion !== metadata.electronRebuildVersion) {
    throw new Error(
      `Staged @electron/rebuild mismatch: expected ${metadata.electronRebuildVersion}, found ${installedRebuildVersion}`
    )
  }
  if (installedBetterSqlite3Version !== metadata.betterSqlite3Version) {
    throw new Error(
      `Staged better-sqlite3 mismatch: expected ${metadata.betterSqlite3Version}, found ${installedBetterSqlite3Version}`
    )
  }

  const electronHeadersPath = `/opt/electron-headers/node-v${metadata.electronVersion}-headers.tar.gz`
  if (!fs.existsSync(electronHeadersPath)) {
    throw new Error(`Missing verified Electron headers: ${electronHeadersPath}`)
  }

  run(
    path.join(workDir, 'node_modules', '.bin', 'electron-rebuild'),
    [
      '--force',
      '--only',
      'better-sqlite3',
      '--build-from-source',
      '--version',
      metadata.electronVersion,
      '--arch',
      arch,
      '--module-dir',
      workDir
    ],
    {
      cwd: workDir,
      env: {
        CC: '/opt/rh/gcc-toolset-11/root/usr/bin/gcc',
        CXX: '/opt/rh/gcc-toolset-11/root/usr/bin/g++',
        PYTHON: '/usr/bin/python3.11',
        npm_package_config_node_gyp_tarball: electronHeadersPath
      }
    }
  )

  const addonPath = path.join(workDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  const objdumpOutput = commandOutput('objdump', ['-T', addonPath])
  const toolchain = {
    baseImage,
    electronHeadersSha256: commandOutput('sha256sum', [electronHeadersPath]).split(/\s+/)[0],
    glibcVersion: commandOutput('getconf', ['GNU_LIBC_VERSION']).replace(/^glibc\s+/, ''),
    gccVersion: commandOutput('/opt/rh/gcc-toolset-11/root/usr/bin/g++', ['-dumpfullversion']),
    pythonVersion: commandOutput('/usr/bin/python3.11', ['--version']).replace(/^Python\s+/, '')
  }
  const manifest = createNativeManifest({
    addonPath,
    metadata,
    arch,
    toolchain,
    versionSource: objdumpOutput
  })

  const outputDir = '/output'
  fs.mkdirSync(outputDir, { recursive: true })
  fs.copyFileSync(addonPath, path.join(outputDir, 'better_sqlite3.node'))
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  process.stdout.write(
    `Built better-sqlite3 ${metadata.betterSqlite3Version} for Electron ${metadata.electronVersion} ` +
      `(ABI ${metadata.electronAbi}, ${arch}); requirements: ${JSON.stringify(manifest.requirements)}\n`
  )
}

main()
