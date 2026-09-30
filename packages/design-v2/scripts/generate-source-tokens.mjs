import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/tokens')
const cssName = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const px = (value) => `${value}px`
const foundation = []
const theme = []
const pro = []
const proMobile = []

function add(list, prefix, path, value) {
  list.push(`  --bh-source-${prefix}-${cssName(path)}: ${value};`)
}

const spacingNames = [
  '0',
  'px',
  '0-5',
  '1',
  '1-5',
  '2',
  '2-5',
  '3',
  '3-5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
  '36',
  '40',
  '44',
  '48',
  '52',
  '56',
  '60',
  '64',
  '72',
  '80',
  '96',
]
const spacingValues = [
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96, 112, 128, 144,
  160, 176, 192, 208, 224, 240, 256, 288, 320, 384,
]
for (let i = 0; i < spacingNames.length; i++)
  add(foundation, 'foundation', `spacing/${spacingNames[i]}`, px(spacingValues[i]))

const scaleNames = [
  'w-0',
  'w-px',
  'w-0,5',
  'w-1',
  'w-1,5',
  'w-2',
  'w-2,5',
  'w-3',
  'w-3,5',
  'w-4',
  'w-5',
  'w-6',
  'w-7',
  'w-8',
  'w-9',
  'w-10',
  'w-11',
  'w-12',
  'w-14',
  'w-16',
  'w-20',
  'w-24',
  'w-28',
  'w-32',
  'w-36',
  'w-44',
  'w-48',
  'w-52',
  'w-56',
  'w-64',
  'w-72',
  'w-80',
  'w-96',
]
for (let i = 0; i < scaleNames.length; i++)
  add(foundation, 'foundation', `width/${scaleNames[i]}`, px(spacingValues[i]))

for (const [prefix, names] of [
  [
    'min-width',
    [
      'min-w-px',
      'min-w-3xs',
      'min-w-2xs',
      'min-w-xs',
      'min-w-sm',
      'min-w-md',
      'min-w-lg',
      'min-w-xl',
      'min-w-2xl',
      'min-w-3xl',
      'min-w-4xl',
      'min-w-5xl',
      'min-w-6xl',
      'min-w-7xl',
    ],
  ],
  [
    'max-width',
    [
      'max-w-none',
      'max-w-px',
      'max-w-3xs',
      'max-w-2xs',
      'max-w-xs',
      'max-w-sm',
      'max-w-md',
      'max-w-lg',
      'max-w-xl',
      'max-w-2xl',
      'max-w-3xl',
      'max-w-4xl',
      'max-w-5xl',
      'max-w-6xl',
      'max-w-7xl',
    ],
  ],
]) {
  for (const name of names) {
    const suffix = name.replace(`${prefix === 'min-width' ? 'min-w' : 'max-w'}-`, '')
    const value =
      suffix === 'px'
        ? px(1)
        : suffix === 'none'
          ? 'none'
          : `var(--bh-source-theme-container-${suffix})`
    add(foundation, 'foundation', `${prefix}/${name}`, value)
  }
}

for (const name of scaleNames.map((value) => value.replace('w-', 'h-')))
  add(
    foundation,
    'foundation',
    `height/${name}`,
    px(spacingValues[scaleNames.indexOf(name.replace('h-', 'w-'))]),
  )
for (const [name, value] of [
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280],
  ['2xl', 1536],
])
  add(foundation, 'foundation', `breakpoint/${name}`, `var(--bh-source-theme-breakpoint-${name})`)

for (const [name, value] of [
  ['rounded-none', 0],
  ['rounded-xs', 2],
  ['rounded-sm', 4],
  ['rounded-md', 8],
  ['rounded-lg', 12],
  ['rounded-xl', 16],
  ['rounded-2xl', 20],
  ['rounded-3xl', 24],
  ['rounded-4xl', 24],
  ['rounded-full', 9999],
])
  add(foundation, 'foundation', `border-radius/${name}`, px(value))
for (const [name, value] of [
  ['border-0', 0],
  ['border', 1],
  ['border-2', 2],
  ['border-3', 3],
  ['border-4', 4],
  ['border-5', 5],
  ['border-6', 6],
  ['border-7', 6],
  ['border-8', 8],
])
  add(foundation, 'foundation', `border-width/${name}`, px(value))
for (const [name, value] of [
  ['stroke-0', 0],
  ['stroke-1', 1],
  ['stroke-[1-33]', 1.33],
  ['stroke-[1-5]', 1.5],
  ['stroke-[1-67]', 1.67],
  ['stroke-2', 2],
  ['stroke-3', 3],
  ['stroke-4', 4],
  ['stroke-5', 5],
  ['stroke-6', 6],
  ['stroke-7', 7],
  ['stroke-8', 8],
])
  add(foundation, 'foundation', `stroke-width/${name}`, value)
for (let value = 0; value <= 100; value += 5)
  add(foundation, 'foundation', `opacity/opacity-${value}`, `${value}%`)
for (let value = 1; value <= 20; value++)
  add(foundation, 'foundation', `line-height/leading-${value}`, px(value * 4))

const palettes = {
  primary:
    'F8F9FF F2F3FF D9E1FF C2D4FF C7D2FF 93ADF3 7086CC 626AEA 3C49DD 2F37B7 5363A6 394580 272E59 181A3C',
  bluegray: 'F7FAFE F2F5F9 EBEEF3 383A3F 26282D 1D1F24',
  gray: 'FFFFFF F9FAFD F7FAFE F7F8FA F2F3F5 E5E6EC C9CDD5 86909C 4E5969 1D2129 E0E0E0 ACACAC 7D7D7D 383838 2F2F2F 2C2C2C 252525 232323 1E1E1E 121212',
  mintgreen: 'E3F9E9 C6F3D7 92DAB2 56C08D 4BC387 0AB268 28AE70 0B9A5B 008858 0E5A39 104227',
  lime: 'FCFFE6 F4FFB8 EAFF8F D3F261 BAE637 A0D911 7CB305 5B8C00 3F6600 254000',
  yellow: 'FEFFE6 FFFFB8 FFFB8F FFF566 FFEC3D FADB14 D4B106 AD8B00 876800 614700',
  gold: 'FFFBE6 FFF1B8 FFE58F F3C362 FFD666 E7A739 FFC53D FAAD14 DB8C14 D48806 AD6800 7D5213 593D13',
  volcano: 'FFF2E8 FFD8BF FFBB96 FF9C6E FF7A45 FA541C D4380D AD2102 871400 610B00',
  red: 'FFEEDED FFC7C7 FF9191 F39992 FF6C6C E76B67 FF4747 F5222D DB3F3F CC3939 A8071A 7D2A2A 592222',
  orange: 'FFF5E3 FFE8B2 FDD78A FFB04F FFA114 ED7A00 D46B08 AD4E00 873800 612500',
  green: 'F6FFED D9F7BE B7EB8F 95DE64 73D13D 52C41A 389E0D 237804 135200 092B00',
  cyan: 'E6FFFB B5F5EC 87E8DE 5CDBD3 36CFC9 13C2C2 08979C 006D75 00474F 002329',
  blue: 'E6F4FF BAE0FF 91CAFF 69B1FF 4096FF 1677FF 0958D9 003EB3 002C8C 001D66',
  geekblue: 'F0F5FF D6E4FF ADC6FF 85A5FF 597EF7 2F54EB 1D39C4 10239E 061178 030852',
  magenta: 'FFF0F6 FFD6E7 FFADD2 FF85C0 F759AB EB2F96 C41D7F 9E1068 780650 520339',
  purple: 'F9F0FF EFDBFF D3ADF7 B37FEB 9254DE 722ED1 531DAB 391085 22075E 120338',
}
for (const [palette, values] of Object.entries(palettes))
  values
    .split(' ')
    .forEach((value, index) =>
      add(
        foundation,
        'foundation',
        `Bohrium Primitive Color/${palette}/${palette}-${index}`,
        `#${value}`,
      ),
    )

const tailwind = {
  base: { transparent: 'FFFFFF', black: '000000' },
  blue: { 600: '2563EB', 500: '3B82F6' },
  sky: { 400: '38BDF8', 900: '0C4A6E', 600: '0284C7', 50: 'F0F9FF' },
  green: { 500: '22C55E', 600: '16A34A', 700: '15803D' },
  zinc: { 900: '18181B', 950: '09090B' },
  yellow: { 500: 'EAB308', 600: 'CA8A04' },
  orange: { 600: 'EA580C', 500: 'F97316', 50: 'FFF7ED' },
  red: { 500: 'EF4444' },
  purple: { 700: '7E22CE', 500: 'A855F7', 600: '9333EA' },
  neutral: { 950: '0A0A0A', 50: 'FAFAFA', 500: '737373' },
  indigo: { 600: '4F46E5', 50: 'EEF2FF' },
  pink: { 600: 'DB2777', 500: 'EC4899', 50: 'FDF2F8' },
  cyan: { 500: '06B6D4' },
  violet: { 500: '8B5CF6' },
  amber: { 600: 'D97706', 50: 'FFFBEB' },
  lime: { 300: 'BEF264' },
  slate: { 950: '020617' },
}
for (const [palette, values] of Object.entries(tailwind))
  for (const [name, value] of Object.entries(values))
    add(foundation, 'foundation', `compatibility/tailwind/${palette}/${name}`, `#${value}`)

add(theme, 'theme', 'font/font-sans', '"PingFang SC"')
for (const [name, value] of [
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280],
  ['2xl', 1536],
])
  add(theme, 'theme', `breakpoint/${name}`, px(value))
for (const [name, value] of [
  ['3xs', 256],
  ['2xs', 288],
  ['xs', 320],
  ['sm', 384],
  ['md', 448],
  ['lg', 512],
  ['xl', 576],
  ['2xl', 672],
  ['3xl', 768],
  ['4xl', 896],
  ['5xl', 1024],
  ['6xl', 1152],
  ['7xl', 1280],
])
  add(theme, 'theme', `container/${name}`, px(value))
const text = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28, 24],
  '2xl': [null, 32],
  '3xl': [30, 36],
  '4xl': [36, 40],
  '5xl': [48, 48],
  '6xl': [60, 60],
  '7xl': [72, 72],
  '8xl': [96, 96],
  '9xl': [128, 128],
  10: [10],
  12: [12],
  13: [13],
  14: [14],
  16: [16],
  18: [18],
  20: [20],
  24: [24],
  26: [26],
  28: [28],
}
for (const [name, values] of Object.entries(text)) {
  if (values[0] !== null) add(theme, 'theme', `text/${name}/font-size`, px(values[0]))
  if (values[2]) add(theme, 'theme', `text/${name}/font-size-2`, px(values[2]))
  if (values[1]) add(theme, 'theme', `text/${name}/line-height`, px(values[1]))
}
for (const [name, value] of [
  ['thin', 100],
  ['extralight', 200],
  ['light', 300],
  ['normal', 400],
  ['medium', 500],
  ['semibold', 600],
  ['bold', 700],
  ['extrabold', 800],
  ['black', 900],
])
  add(theme, 'theme', `font-weight/${name}`, value)
for (const [name, value] of [
  ['xs', 2],
  ['sm', 4],
  ['md', 8],
  ['lg', 12],
  ['xl', 16],
  ['2xl', 20],
  ['3xl', 24],
  ['4xl', 24],
])
  add(theme, 'theme', `radius/${name}`, px(value))
const shadows = {
  xs: [0, 2, 4, 0, '5363A6'],
  'sm-1': [0, 4, 6, -1, '5363A6'],
  'sm-2': [0, 1, 2, -1, '5363A6'],
  'md-1': [0, 4, 6, -1, '5363A6'],
  'md-2': [0, 2, 4, -2, '5363A6'],
  'lg-1': [0, 10, 16, -3, '5363A6'],
  'lg-2': [0, 4, 6, -4, '5363A6'],
  focus: [null, null, null, null, '5363A6'],
  invalid: [null, null, null, null, 'FF4747'],
  utility: [null, null, null, null, '121212'],
}
for (const [name, values] of Object.entries(shadows)) {
  if (values[0] !== null) {
    add(theme, 'theme', `shadow/${name}/offset-x`, px(values[0]))
    add(theme, 'theme', `shadow/${name}/offset-y`, px(values[1]))
    add(theme, 'theme', `shadow/${name}/blur-radius`, px(values[2]))
    add(theme, 'theme', `shadow/${name}/spread-radius`, px(values[3]))
  }
  add(theme, 'theme', `shadow/${name}/color`, `#${values[4]}`)
}
for (const value of [16, 20, 22, 24, 26, 28, 32, 34, 36, 38, 40, 42, 44])
  add(theme, 'theme', `line-height/${value}`, px(value))
add(theme, 'theme', 'letter-spacing/normal', '0px')
add(theme, 'theme', 'paragraph-spacing/none', '0px')
add(theme, 'theme', 'paragraph-indent/none', '0px')

const proModes = {
  desktop: {
    'container-padding-x': ['spacing/6', '24px'],
    'section-padding-y': ['spacing/24', '96px'],
    'section-title-gap-sm': ['spacing/4', '16px'],
    'section-title-gap-md': ['spacing/5', '20px'],
    'section-title-gap-lg': ['spacing/5', '20px'],
    'section-title-gap-xl': ['spacing/6', '24px'],
    'component-padding-sm': ['spacing/2', '8px'],
    'component-padding-md': ['spacing/4', '16px'],
    'component-padding-lg': ['spacing/6', '24px'],
  },
  mobile: {
    'container-padding-x': ['spacing/4', '16px'],
    'section-padding-y': ['spacing/16', '64px'],
    'section-title-gap-sm': ['spacing/4', '16px'],
    'section-title-gap-md': ['spacing/4', '16px'],
    'section-title-gap-lg': ['spacing/4', '16px'],
    'section-title-gap-xl': ['spacing/5', '20px'],
    'component-padding-sm': ['spacing/2', '8px'],
    'component-padding-md': ['spacing/4', '16px'],
    'component-padding-lg': ['spacing/6', '24px'],
  },
}
for (const [name, [source, value]] of Object.entries(proModes.desktop))
  pro.push(`  --bh-source-pro-responsive-${cssName(name)}: ${value};`)
for (const [name, [source, value]] of Object.entries(proModes.mobile))
  proMobile.push(`  --bh-source-pro-responsive-${cssName(name)}: ${value};`)
const heading = {
  xl: ['60px', '60px', '-1.5px', '48px', '48px'],
  lg: ['48px', '48px', '-1.2px', '36px', '40px'],
  md: ['36px', '40px', '-0.9px', '30px', '36px'],
  sm: ['24px', '32px', '-0.6px', '20px', '28px'],
}
for (const [
  name,
  [desktopSize, desktopLine, desktopLetter, mobileSize, mobileLine],
] of Object.entries(heading)) {
  add(pro, 'pro-responsive', `heading-${name}/font-family`, '"PingFang SC"')
  add(pro, 'pro-responsive', `heading-${name}/font-size`, desktopSize)
  add(pro, 'pro-responsive', `heading-${name}/line-height`, desktopLine)
  add(pro, 'pro-responsive', `heading-${name}/font-weight`, 600)
  add(pro, 'pro-responsive', `heading-${name}/letter-spacing`, desktopLetter)
  add(proMobile, 'pro-responsive', `heading-${name}/font-family`, '"PingFang SC"')
  add(proMobile, 'pro-responsive', `heading-${name}/font-size`, mobileSize)
  add(proMobile, 'pro-responsive', `heading-${name}/line-height`, mobileLine)
  add(proMobile, 'pro-responsive', `heading-${name}/font-weight`, 600)
  add(
    proMobile,
    'pro-responsive',
    `heading-${name}/letter-spacing`,
    name === 'xl' ? '-1.2px' : name === 'lg' ? '-0.9px' : name === 'md' ? '-0.75px' : '-0.5px',
  )
}

if (foundation.length !== 420 || theme.length !== 126 || pro.length !== 29)
  throw new Error(
    `design source token count mismatch: foundation=${foundation.length}, theme=${theme.length}, pro=${pro.length}`,
  )

const header = (collection, count) =>
  `/* Generated from design source Variables — ${collection} (${count}) */\n:root {\n`
await mkdir(outDir, { recursive: true })
await writeFile(
  resolve(outDir, 'source.foundation.css'),
  `${header('1. Foundation', foundation.length)}${foundation.join('\n')}\n}\n`,
  'utf8',
)
await writeFile(
  resolve(outDir, 'source.theme.css'),
  `${header('2. Theme', theme.length)}${theme.join('\n')}\n}\n`,
  'utf8',
)
await writeFile(
  resolve(outDir, 'source.responsive.css'),
  `${header('4. Pro / Responsive', pro.length)}${pro.join('\n')}\n}\n\n:root[data-responsive-mode='mobile'] {\n${proMobile.join('\n')}\n}\n`,
  'utf8',
)
