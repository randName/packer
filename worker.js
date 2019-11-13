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
  const [A, B] = pair, B0 = B.path[0]
  const F = B.path.map((b) => ({X: -b.X, Y: -b.Y}))
  const nfp = ClipperLib.Clipper.MinkowskiSum(A.path, F, true)
    .reduce(area, null)[0].map((c) => ({X: c.X + B0.X, Y: c.Y + B0.Y}))
  self.postMessage({ pair, nfp })
}
