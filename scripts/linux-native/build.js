const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { getNativeArtifactPaths, readProjectBuildMetadata, verifyNativeArtifact } = require('./compat')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DOCKER_ARCH = {
  x64: 'amd64',
  arm64: 'arm64'
}

function run(command, args, options = {}) {
  const attempts = options.attempts ?? 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit'
    })
    if (!result.error && result.status === 0) return
    if (attempt < attempts) {
      process.stderr.write(`${command} failed (attempt ${attempt}/${attempts}); retrying\n`)
      continue
    }
    if (result.error) {
      throw new Error(`Failed to run ${command}: ${result.error.message}`)
    }
    throw new Error(`${command} exited with status ${result.status}`)
  }
}

function parseTargetArchs(args) {
  if (args.length === 0) {
    throw new Error('Specify at least one Linux architecture: x64 or arm64')
  }

  const archs = [...new Set(args)]
  for (const arch of archs) {
    if (!DOCKER_ARCH[arch]) {
      throw new Error(`Unsupported Linux architecture: ${arch}`)
    }
  }
  return archs
}

function readBaseImage() {
  const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8')
  const match = dockerfile.match(/^ARG BASE_IMAGE=(.+)$/m)
  if (!match) throw new Error('Dockerfile must declare a pinned BASE_IMAGE')
  if (!match[1].includes('@sha256:')) throw new Error('Linux native BASE_IMAGE must be pinned by digest')
  return match[1]
}

function getImageTag(metadata, arch) {
  const hash = crypto.createHash('sha256')
  for (const file of ['Dockerfile', 'compat.js', 'container-build.js']) {
    hash.update(fs.readFileSync(path.join(__dirname, file)))
  }
  hash.update(
    JSON.stringify({
      nodeVersion: metadata.nodeVersion,
      electronVersion: metadata.electronVersion
    })
  )
  return `cherry-studio-linux-native:${arch}-${hash.digest('hex').slice(0, 16)}`
}

function hasDockerImage(imageTag) {
  return spawnSync('docker', ['image', 'inspect', imageTag], { stdio: 'ignore' }).status === 0
}

function prepareBuildWorkspace(projectRoot, arch, metadata) {
  const workspaceDir = path.join(projectRoot, 'node_modules', '.cache', 'cherry-studio', 'linux-native-workspace', arch)
  fs.rmSync(workspaceDir, { recursive: true, force: true })
  fs.mkdirSync(workspaceDir, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'cherry-linux-native-builder',
        private: true,
        dependencies: {
          '@electron/rebuild': metadata.electronRebuildVersion,
          'better-sqlite3': metadata.betterSqlite3Version
        }
      },
      null,
      2
    )}\n`
  )
  try {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
      cwd: workspaceDir,
      env: {
        npm_config_update_notifier: 'false'
      }
    })
    return workspaceDir
  } catch (error) {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
    throw error
  }
}

function buildArch(projectRoot, arch, metadata, baseImage) {
  const dockerPlatform = `linux/${DOCKER_ARCH[arch]}`
  const imageTag = getImageTag(metadata, arch)
  const artifactPaths = getNativeArtifactPaths(projectRoot, arch)
  const workspaceDir = prepareBuildWorkspace(projectRoot, arch, metadata)

  fs.rmSync(artifactPaths.outputDir, { recursive: true, force: true })
  fs.mkdirSync(artifactPaths.outputDir, { recursive: true })

  try {
    if (hasDockerImage(imageTag)) {
      process.stdout.write(`Reusing cached Linux native builder image ${imageTag}\n`)
    } else {
      run(
        'docker',
        [
          'build',
          '--platform',
          dockerPlatform,
          '--build-arg',
          `NODE_VERSION=${metadata.nodeVersion}`,
          '--build-arg',
          `ELECTRON_VERSION=${metadata.electronVersion}`,
          '--tag',
          imageTag,
          __dirname
        ],
        { cwd: projectRoot, attempts: 3 }
      )
    }

    const dockerArgs = [
      'run',
      '--rm',
      '--platform',
      dockerPlatform,
      '--mount',
      `type=bind,src=${workspaceDir},dst=/workspace`,
      '--mount',
      `type=bind,src=${artifactPaths.outputDir},dst=/output`,
      '--env',
      `CHERRY_BASE_IMAGE=${baseImage}`,
      '--env',
      `CHERRY_TARGET_ARCH=${arch}`,
      '--env',
      `CHERRY_NODE_VERSION=${metadata.nodeVersion}`,
      '--env',
      `CHERRY_ELECTRON_VERSION=${metadata.electronVersion}`,
      '--env',
      `CHERRY_ELECTRON_ABI=${metadata.electronAbi}`,
      '--env',
      `CHERRY_BETTER_SQLITE3_VERSION=${metadata.betterSqlite3Version}`,
      '--env',
      `CHERRY_ELECTRON_REBUILD_VERSION=${metadata.electronRebuildVersion}`,
      '--env',
      `CHERRY_BUILD_FINGERPRINT=${metadata.buildFingerprint}`,
      '--env',
      'HOME=/tmp/cherry-linux-native-home'
    ]
    if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
      dockerArgs.push('--user', `${process.getuid()}:${process.getgid()}`)
    }
    dockerArgs.push(imageTag)
    run('docker', dockerArgs, { cwd: projectRoot })

    const verified = verifyNativeArtifact({
      ...artifactPaths,
      expected: { ...metadata, arch }
    })
    process.stdout.write(
      `Verified Linux ${arch} better-sqlite3: ${verified.inspection.sha256}, ` +
        `${JSON.stringify(verified.inspection.requirements)}\n`
    )
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
}

function main() {
  const archs = parseTargetArchs(process.argv.slice(2))
  if (archs.length === 0) return

  run('docker', ['version', '--format', '{{.Server.Version}}'])
  const metadata = readProjectBuildMetadata(PROJECT_ROOT)
  const baseImage = readBaseImage()

  for (const arch of archs) {
    buildArch(PROJECT_ROOT, arch, metadata, baseImage)
  }
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
  buildArch,
  getImageTag,
  hasDockerImage,
  parseTargetArchs,
  prepareBuildWorkspace,
  readBaseImage
}
