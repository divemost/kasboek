// Builds every app icon from the SVGs in assets/brand.
//   build/icon.ico            Windows (16–256 px)
//   build/icon.icns           macOS (16–1024 px, incl. @2x)
//   build/icons/NxN.png       Linux
//   build/icon.png            1024 px master (electron-builder fallback)
//   resources/icon.png        window icon at runtime
// Run: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const big = readFileSync('assets/brand/icon.svg')
const small = readFileSync('assets/brand/icon-small.svg')

const png = (size) =>
  sharp(size <= 48 ? small : big, { density: Math.max(72, (72 * size) / 1024) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...images.map((i) => i.data)])
}

function icns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const h = Buffer.alloc(8)
    h.write(type, 0, 'ascii')
    h.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([h, data])
  })
  const body = Buffer.concat(chunks)
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'ascii')
  h.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([h, body])
}

mkdirSync('build/icons', { recursive: true })
mkdirSync('resources', { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const out = Object.fromEntries(await Promise.all(sizes.map(async (s) => [s, await png(s)])))

writeFileSync('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: out[size] }))))
writeFileSync(
  'build/icon.icns',
  icns([
    { type: 'icp4', data: out[16] },
    { type: 'icp5', data: out[32] },
    { type: 'icp6', data: out[64] },
    { type: 'ic07', data: out[128] },
    { type: 'ic08', data: out[256] },
    { type: 'ic09', data: out[512] },
    { type: 'ic10', data: out[1024] },
    { type: 'ic11', data: out[32] },
    { type: 'ic12', data: out[64] },
    { type: 'ic13', data: out[256] },
    { type: 'ic14', data: out[512] }
  ])
)
for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(`build/icons/${s}x${s}.png`, out[s])
writeFileSync('build/icon.png', out[1024])
writeFileSync('resources/icon.png', out[512])
console.log('Icons written to build/ and resources/')
