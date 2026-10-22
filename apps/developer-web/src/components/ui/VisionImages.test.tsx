import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { extractVisionImagePaths, visionImageLabel } from './visionImagePaths'

const resolveImageUrl = vi.fn((path: string) => `http://127.0.0.1:4176/__unilab_backend${path}`)
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: { core: { humanInteractions: { resolveImageUrl } } } }),
}))

const { VisionImages } = await import('./VisionImages')

describe('extractVisionImagePaths', () => {
  it('finds plate and scrape images in results and error text, without duplicates', () => {
    const source = [
      {
        image_url: '/api/vision/plate/a0c16a4a74f9/calibration.png',
        original_url: '/api/vision/plate/a0c16a4a74f9/original.jpg',
        valid: true,
      },
      [
        {
          message:
            'VISION_PLATE_NOT_FOUND: 未识别到板。本次识别图：/api/vision/plate/a0c16a4a74f9/calibration.png',
        },
      ],
      { preview_url: '/api/vision/image/candidates/c1/preview.png' },
    ]
    expect(extractVisionImagePaths(source)).toEqual([
      '/api/vision/plate/a0c16a4a74f9/calibration.png',
      '/api/vision/plate/a0c16a4a74f9/original.jpg',
      '/api/vision/image/candidates/c1/preview.png',
    ])
  })

  it('finds camera images served by the OS device file route, including encoded names', () => {
    const source = {
      image_url: '/api/v1/devices/imaging/files/photos/serial-test/before.jpg',
      preview_url: '/api/v1/devices/imaging/files/images/candidates/c1/preview.png',
      plate: '本次识别图：/api/v1/devices/vision/files/plate/a0c16a4a74f9/calibration.png',
      tank: '/api/v1/devices/liquid_vision/files/tanks/tank-1/20261022-101500.jpg',
      chinese: '/api/v1/devices/imaging/files/photos/%E6%A0%B7%E5%93%81/after.jpg',
    }
    expect(extractVisionImagePaths(source)).toEqual([
      '/api/v1/devices/imaging/files/photos/serial-test/before.jpg',
      '/api/v1/devices/imaging/files/images/candidates/c1/preview.png',
      '/api/v1/devices/vision/files/plate/a0c16a4a74f9/calibration.png',
      '/api/v1/devices/liquid_vision/files/tanks/tank-1/20261022-101500.jpg',
      '/api/v1/devices/imaging/files/photos/%E6%A0%B7%E5%93%81/after.jpg',
    ])
    expect(visionImageLabel('/api/v1/devices/vision/files/plate/x/overlay.png')).toBe('识别叠加')
  })

  it('ignores other paths, traversal and non-image files', () => {
    expect(
      extractVisionImagePaths({
        a: '/api/v1/workflow-tasks/x',
        b: '/api/vision/plate/../../etc/passwd.png',
        c: '/api/vision/plate/abc/result.json',
        d: '/Users/zyb/state/vision-bridge/vision_tune/abc/original.jpg',
        e: '/api/v1/devices/imaging/files/photos/../../secret.jpg',
        f: '/api/v1/devices/imaging/files/photos/serial-test/before.jpg.meta.json',
        g: '/api/v1/devices/imaging/status',
      }),
    ).toEqual([])
  })

  it('labels known captures in Chinese', () => {
    expect(visionImageLabel('/api/vision/plate/x/calibration.png')).toBe('识别标注')
    expect(visionImageLabel('/api/vision/plate/x/original.jpg')).toBe('原图')
    expect(visionImageLabel('/api/vision/image/a/preview.png')).toBe('preview.png')
  })
})

describe('VisionImages', () => {
  it('resolves device file route images against the backend address', () => {
    render(<VisionImages source={{ image_url: '/api/v1/devices/imaging/files/photos/s/after.jpg' }} />)
    expect(screen.getByAltText('after.jpg')).toHaveAttribute(
      'src',
      'http://127.0.0.1:4176/__unilab_backend/api/v1/devices/imaging/files/photos/s/after.jpg',
    )
  })

  it('renders resolved thumbnails with captions', () => {
    render(
      <VisionImages
        source="本次识别图：/api/vision/plate/a0c16a4a74f9/calibration.png"
        title="本次拍照"
      />,
    )
    expect(screen.getByRole('region', { name: '本次拍照' })).toBeInTheDocument()
    expect(screen.getByAltText('识别标注')).toHaveAttribute(
      'src',
      'http://127.0.0.1:4176/__unilab_backend/api/vision/plate/a0c16a4a74f9/calibration.png',
    )
  })

  it('renders nothing when the job carries no images', () => {
    const { container } = render(<VisionImages source={{ dx_mm: 0.1 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
