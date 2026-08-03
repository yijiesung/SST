const CDN_BASE_URL = 'https://cdn.example.com/sst-assets'

function numbered(kind, count) {
  return Array.from({ length: count }, (_, index) => `${CDN_BASE_URL}/${kind}/${String(index + 1).padStart(4, '0')}`)
}

module.exports = {
  configured: !CDN_BASE_URL.includes('example.com'),
  gameImages: numbered('game', 163),
  neutralImages: numbered('neutral', 149)
}

