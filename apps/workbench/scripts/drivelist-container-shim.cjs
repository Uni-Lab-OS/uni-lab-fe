'use strict'

/**
 * Minimal drivelist-compatible provider for the container file picker.
 * The Workbench exposes one mounted Linux filesystem and does not need a
 * native block-device inventory inside the image.
 */
async function list() {
  return [{ mountpoints: [{ path: '/' }] }]
}

module.exports = { list }
