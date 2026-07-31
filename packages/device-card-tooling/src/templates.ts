import {
  createDeviceCardProjectFiles,
  createExampleAuthoringContext
} from '@unilab/device-card-authoring-kit'

export type StarterProfile = 'vue' | 'react' | 'lite'

export function starterFiles(
  profile: StarterProfile
): Record<string, string> {
  return createDeviceCardProjectFiles(
    createExampleAuthoringContext(),
    profile === 'vue'
      ? 'vue-web-component-v1'
      : profile === 'react'
        ? 'react-web-component-v1'
        : 'web-component-lite-v1'
  )
}
