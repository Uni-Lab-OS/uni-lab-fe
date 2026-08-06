import {
  Color,
  LoaderUtils,
  LoadingManager,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  type Material
} from 'three'
import jsYaml from 'js-yaml'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import URDFLoader from 'urdf-loader'
import { XacroLoader } from 'xacro-parser'

import type { LabDeviceNode } from './schema'

export interface LabModelRuntime {
  resolveUrl?: (
    model: LabDeviceNode['model'],
    node: LabDeviceNode
  ) => string | Promise<string>
  fetchOptions?: () => RequestInit
}

let runtime: LabModelRuntime = {}

export function configureLabModelRuntime(next: LabModelRuntime): void {
  runtime = { ...runtime, ...next }
}

async function resolveUrl(node: LabDeviceNode): Promise<string> {
  return runtime.resolveUrl
    ? runtime.resolveUrl(node.model, node)
    : node.model.path
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, runtime.fetchOptions?.())
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} loading ${url}`)
  }
  return response.arrayBuffer()
}

function markModel(object: Object3D, nodeId: string): void {
  object.traverse((child) => {
    child.userData = {
      ...child.userData,
      nodeId
    }
  })
}

function applyModelColor(object: Object3D, color: string | undefined): void {
  if (!color) return
  const tint = new Color(color)
  object.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const tintedMaterials = materials.map((material) => {
      const clone = material.clone()
      if ('color' in clone && clone.color instanceof Color) {
        clone.color.copy(tint)
      }
      return clone
    })
    mesh.material = Array.isArray(mesh.material)
      ? tintedMaterials
      : tintedMaterials[0]
  })
}

function fixFileUrls(node: Element | Document): void {
  if (node.nodeType === 1 && (node as Element).tagName === 'mesh') {
    const element = node as Element
    const filename = element.getAttribute('filename')
    if (filename?.startsWith('file://')) {
      element.setAttribute('filename', filename.slice('file://'.length))
    }
  }

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) fixFileUrls(child as Element)
  }
}

async function parseUrdf(
  document: Document,
  workingPath: string,
  nodeId: string
): Promise<Object3D> {
  fixFileUrls(document)
  const loader = new URDFLoader()
  loader.workingPath = workingPath
  const pendingMeshes = setupUrdfMeshLoader(loader)
  const robot = loader.parse(document)
  await Promise.all(pendingMeshes)
  markModel(robot, nodeId)
  robot.updateMatrixWorld(true)
  return robot
}

function setupUrdfMeshLoader(loader: URDFLoader): Promise<void>[] {
  const pendingMeshes: Promise<void>[] = []
  loader.loadMeshCb = (
    url: string,
    manager: LoadingManager,
    done: (mesh: Object3D, error?: Error) => void
  ) => {
    const resolvedUrl = recoverAbsoluteUrl(url)
    if (/\.stl(?:$|\?)/i.test(resolvedUrl)) {
      const pending = fetchBuffer(resolvedUrl)
        .then((buffer) => {
          done(
            new Mesh(
              new STLLoader().parse(buffer),
              new MeshPhongMaterial({ color: 0xd1d5db })
            )
          )
        })
        .catch((cause: unknown) => {
          done(
            new Object3D(),
            cause instanceof Error ? cause : new Error(String(cause))
          )
        })
      pendingMeshes.push(pending)
      return
    }
    const pending = new Promise<void>((resolve) => {
      loader.defaultMeshLoader(
        resolvedUrl,
        manager,
        (mesh, error) => {
          done(mesh, error)
          resolve()
        }
      )
    })
    pendingMeshes.push(pending)
  }
  return pendingMeshes
}

function recoverAbsoluteUrl(url: string): string {
  const firstSchemeLength = url.startsWith('https://')
    ? 'https://'.length
    : url.startsWith('http://')
      ? 'http://'.length
      : 0
  const nestedHttps = url.indexOf('https://', firstSchemeLength)
  const nestedHttp = url.indexOf('http://', firstSchemeLength)
  const nested = [nestedHttps, nestedHttp]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  if (nested != null) return url.slice(nested)
  if (firstSchemeLength > 0) return url
  const httpsIndex = url.indexOf('https://')
  if (httpsIndex >= 0) return url.slice(httpsIndex)
  const httpIndex = url.indexOf('http://')
  return httpIndex >= 0 ? url.slice(httpIndex) : url
}

export function buildDeviceXacro(
  modelPath: string,
  deviceName: string,
  declaredMacro?: string,
  declaredMeshPath?: string
): string {
  const macroName =
    declaredMacro || modelPath.split('/').slice(-2)[0] || 'device'
  const meshPath =
    declaredMeshPath ||
    (modelPath.includes('/devices/')
      ? modelPath.split('/devices/')[0]
      : modelPath.split('/resources/')[0])

  return `<?xml version="1.0" ?>
<robot xmlns:xacro="http://ros.org/wiki/xacro" name="${deviceName}">
  <link name="world"></link>
  <xacro:include filename="${modelPath}" />
  <xacro:${macroName}
    parent_link="world"
    station_name=""
    device_name="${deviceName}_"
    mesh_path="${meshPath}"
  />
</robot>`
}

function parseXacro(
  input: string,
  workingPath: string,
  nodeId: string,
  yamlCache: ReadonlyMap<string, unknown>
): Promise<Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new XacroLoader()
    ;(loader as unknown as { fetchOptions?: RequestInit }).fetchOptions =
      runtime.fetchOptions?.()
    patchXacroLoadYaml(loader, yamlCache)
    loader.parse(
      input,
      (document: Document) => {
        void parseUrdf(document, workingPath, nodeId).then(
          resolve,
          reject
        )
      },
      (cause: unknown) => {
        reject(
          new Error(
            `XACRO parse failed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`
          )
        )
      }
    )
  })
}

async function loadXacro(
  url: string,
  node: LabDeviceNode
): Promise<Object3D> {
  const meshPath = resolveModelDirectory(url, node.model.meshDir)
  const yamlCache = await preloadXacroYaml(url, meshPath)
  if (shouldInstantiateXacro(url, node.model.macro)) {
    return parseXacro(
      buildDeviceXacro(
        url,
        node.rosDeviceName || node.displayName || 'device',
        node.model.macro,
        meshPath
      ),
      LoaderUtils.extractUrlBase(url),
      node.id,
      yamlCache
    )
  }

  return new Promise((resolve, reject) => {
    const loader = new XacroLoader()
    ;(loader as unknown as { fetchOptions?: RequestInit }).fetchOptions =
      runtime.fetchOptions?.()
    patchXacroLoadYaml(loader, yamlCache)
    loader.load(
      url,
      (document: Document) => {
        void parseUrdf(
          document,
          LoaderUtils.extractUrlBase(url),
          node.id
        ).then(
          resolve,
          reject
        )
      },
      (cause: unknown) => {
        reject(
          new Error(
            `XACRO load failed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`
          )
        )
      }
    )
  })
}

export function shouldInstantiateXacro(
  modelPath: string,
  declaredMacro?: string
): boolean {
  return Boolean(declaredMacro) || modelPath.includes('/devices/')
}

export function resolveModelDirectory(
  resolvedModelUrl: string,
  declaredMeshDir?: string
): string {
  if (declaredMeshDir) {
    try {
      return new URL(declaredMeshDir, resolvedModelUrl)
        .toString()
        .replace(/\/$/, '')
    } catch {
      return declaredMeshDir.replace(/\/$/, '')
    }
  }
  return resolvedModelUrl.includes('/devices/')
    ? resolvedModelUrl.split('/devices/')[0]
    : resolvedModelUrl.split('/resources/')[0]
}

const DEGREE_TAG = /!degrees\s+([-\d.]+)/g

async function preloadXacroYaml(
  xacroUrl: string,
  meshPath: string
): Promise<Map<string, unknown>> {
  const cache = new Map<string, unknown>()
  try {
    const response = await fetch(xacroUrl, runtime.fetchOptions?.())
    if (!response.ok) return cache
    const source = await response.text()
    const pattern =
      /xacro\.load_yaml\(\s*mesh_path\s*\+\s*['"]([^'"]+)['"]\s*\)/g
    for (const match of source.matchAll(pattern)) {
      const yamlUrl = `${meshPath}${match[1]}`
      const yamlResponse = await fetch(yamlUrl, runtime.fetchOptions?.())
      if (!yamlResponse.ok) continue
      const yaml = (await yamlResponse.text()).replace(
        DEGREE_TAG,
        (_value, degrees: string) =>
          String(Number(degrees) * Math.PI / 180)
      )
      cache.set(yamlUrl, jsYaml.load(yaml))
    }
  } catch {
    // YAML 只用于少数可动设备；入口加载器会报告真正的模型错误。
  }
  return cache
}

function patchXacroLoadYaml(
  loader: XacroLoader,
  yamlCache: ReadonlyMap<string, unknown>
): void {
  if (yamlCache.size === 0) return
  const expressionParser = (
    loader as unknown as {
      expressionParser?: {
        evaluate?: (
          expression: string,
          variables: Record<string, unknown>
        ) => unknown
      }
    }
  ).expressionParser
  if (!expressionParser?.evaluate) return
  const evaluate = expressionParser.evaluate.bind(expressionParser)
  expressionParser.evaluate = (
    expression: string,
    variables: Record<string, unknown>
  ) =>
    evaluate(expression, {
      ...variables,
      xacro: {
        load_yaml: (path: string) => yamlCache.get(path) ?? {}
      }
    })
}

async function loadUrdf(url: string, nodeId: string): Promise<Object3D> {
  const response = await fetch(url, runtime.fetchOptions?.())
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} loading ${url}`)
  }
  const document = new DOMParser().parseFromString(
    await response.text(),
    'text/xml'
  )
  return parseUrdf(document, LoaderUtils.extractUrlBase(url), nodeId)
}

async function loadGltf(url: string, nodeId: string): Promise<Object3D> {
  const loader = new GLTFLoader(new LoadingManager())
  const draco = new DRACOLoader()
  loader.setDRACOLoader(draco)

  try {
    const result = await loader.loadAsync(url)
    markModel(result.scene, nodeId)
    return result.scene
  } finally {
    draco.dispose()
  }
}

async function loadStl(url: string, nodeId: string): Promise<Object3D> {
  const geometry = new STLLoader().parse(await fetchBuffer(url))
  const material = new MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.15,
    roughness: 0.72
  })
  const mesh = new Mesh(geometry, material)
  markModel(mesh, nodeId)
  return mesh
}

async function loadFbx(url: string, nodeId: string): Promise<Object3D> {
  const object = new FBXLoader().parse(await fetchBuffer(url), url)
  markModel(object, nodeId)
  return object
}

async function loadObj(url: string, nodeId: string): Promise<Object3D> {
  const text = new TextDecoder().decode(await fetchBuffer(url))
  const object = new OBJLoader().parse(text)
  markModel(object, nodeId)
  return object
}

export async function loadLabDeviceModel(
  node: LabDeviceNode
): Promise<Object3D> {
  const url = await resolveUrl(node)
  if (!url) throw new Error('No model URL was provided')

  let object: Object3D
  switch (node.model.format) {
    case 'xacro':
      object = await loadXacro(url, node)
      break
    case 'urdf':
      object = await loadUrdf(url, node.id)
      break
    case 'gltf':
      object = await loadGltf(url, node.id)
      break
    case 'stl':
      object = await loadStl(url, node.id)
      break
    case 'fbx':
      object = await loadFbx(url, node.id)
      break
    case 'obj':
      object = await loadObj(url, node.id)
      break
  }
  applyModelColor(object, node.model.color)
  return object
}

export function disposeLabModel(object: Object3D): void {
  object.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    materials.forEach((material: Material) => material.dispose())
  })
}
