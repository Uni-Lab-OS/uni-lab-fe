export type LabModelFormat =
  | 'xacro'
  | 'urdf'
  | 'gltf'
  | 'stl'
  | 'fbx'
  | 'obj'

export function inferModelFormat(
  path: string | undefined,
  declaredFormat: string | undefined
): LabModelFormat {
  if (
    declaredFormat === 'xacro' ||
    declaredFormat === 'urdf' ||
    declaredFormat === 'stl' ||
    declaredFormat === 'fbx' ||
    declaredFormat === 'obj' ||
    declaredFormat === 'gltf'
  ) {
    return declaredFormat
  }
  const extension = path?.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase()
  if (extension === 'xacro') return 'xacro'
  if (extension === 'urdf') return 'urdf'
  if (extension === 'stl') return 'stl'
  if (extension === 'fbx') return 'fbx'
  if (extension === 'obj') return 'obj'
  if (extension === 'glb' || extension === 'gltf') return 'gltf'
  return 'gltf'
}
