importScripts('lib/clipper.js')
const area = (p, s) => {
  const a = ClipperLib.Clipper.Area(s)
  return (p === null || p[1] < a) ? [s, a] : p
}
self.onmessage = (e) => {
  const pair = e.data
  if (!pair) {
    self.postMessage(null)
    return
  }
  const { A, B, key } = pair
  const bX = B[0].X, bY = B[0].Y
  const flipped = B.map((b) => ({ X: -b.X, Y: -b.Y }))
  const nfp = ClipperLib.Clipper.MinkowskiSum(A, flipped, true)
    .reduce(area, null)[0].map((c) => ({ X: c.X + bX, Y: c.Y + bY }))
  self.postMessage({ key, nfp })
}
