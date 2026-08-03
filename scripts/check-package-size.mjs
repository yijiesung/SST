import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('miniprogram')
const subpackages = ['packages/sst', 'packages/attention', 'packages/data']
const LIMIT = 1.5 * 1024 * 1024

function bytes(dir, ignored = []) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/')
    if (ignored.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) continue
    if (entry.isDirectory()) total += bytes(absolute, ignored)
    else total += fs.statSync(absolute).size
  }
  return total
}

const mainBytes = bytes(root, subpackages)
console.log(`main package: ${(mainBytes / 1024).toFixed(1)} KiB`)
if (mainBytes > LIMIT) {
  console.error('Main package exceeds 1.5 MiB')
  process.exitCode = 1
}
for (const packageRoot of subpackages) {
  const size = bytes(path.join(root, packageRoot))
  console.log(`${packageRoot}: ${(size / 1024).toFixed(1)} KiB`)
}

const mediaFiles = []
function scanMedia(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) scanMedia(absolute)
    else if (/\.(png|jpe?g|gif|webp|mp3|wav|aac|m4a)$/i.test(entry.name)) mediaFiles.push(path.relative(root, absolute))
  }
}
scanMedia(root)
if (mediaFiles.length) {
  console.error(`Non-icon media found in package: ${mediaFiles.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('media policy: PASS (no task images or audio in package)')
}

