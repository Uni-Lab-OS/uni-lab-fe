const { readdir } = require('node:fs/promises')
const path = require('node:path')

const VOLUMES_DIRECTORY = '/Volumes'

/**
 * Minimal drivelist-compatible provider for Theia's drive-root picker.
 * macOS roots are discoverable through / and /Volumes without loading a
 * native addon into Electron or one of its Node-mode child processes.
 */
async function list(options = {}) {
  const roots = options.roots ?? await queryDarwinDriveRoots(options)
  return uniqueDarwinMountRoots(roots)
    .map(root => ({ mountpoints: [{ path: root }] }))
}

async function queryDarwinDriveRoots(options = {}) {
  const readDirectory = options.readDirectory ?? readdir
  const volumesDirectory = options.volumesDirectory ?? VOLUMES_DIRECTORY
  try {
    const entries = await readDirectory(volumesDirectory, {
      withFileTypes: true
    })
    return uniqueDarwinMountRoots([
      '/',
      ...entries
        .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
        .map(entry => path.join(volumesDirectory, entry.name))
    ])
  } catch {
    return ['/']
  }
}

function uniqueDarwinMountRoots(values) {
  return [...new Set(
    values
      .map(value => String(value).trim())
      .filter(value => value.startsWith('/'))
      .map(value => path.resolve(value))
  )]
}

module.exports = {
  VOLUMES_DIRECTORY,
  list,
  queryDarwinDriveRoots,
  uniqueDarwinMountRoots
}
