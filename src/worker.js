importScripts('../lib/clipper.js')
const NonZero = ClipperLib.PolyFillType.pftNonZero

const { ptSubject, ptClip } = ClipperLib.PolyType
const { ctUnion, ctDifference } = ClipperLib.ClipType

const area = (p, s) => {
  const a = ClipperLib.Clipper.Area(s)
  return (p === null || p[1] < a) ? [s, a] : p
}

const computeNFP = ({ key, A, B }) => {
  const F = B.map((b) => ({ X: -b.X, Y: -b.Y }))
  const nfp = ClipperLib.Clipper.MinkowskiSum(A, F, true).reduce(area, null)[0]
  return { key, nfp }
}

const combineNFP = ({ NFPs, IFP }) => {
  const union = new ClipperLib.Clipper(), combined = new ClipperLib.Paths()
  NFPs.forEach((p) => union.AddPath(p, ptSubject, true))
  if (!union.Execute(ctUnion, combined, NonZero, NonZero)) return

  if (!IFP) return combined

  const diff = new ClipperLib.Clipper(),result = new ClipperLib.Paths()
  diff.AddPaths(combined, ptClip, true)
  diff.AddPath(IFP, ptSubject, true)
  if(!diff.Execute(ctDifference, result, NonZero, NonZero)) return

  return result
}

self.onmessage = ({ data }) => {
  if (!data) return self.postMessage(null)
  if (data.key) return self.postMessage(computeNFP(data))
  if (data.NFPs) return self.postMessage(combineNFP(data))
  self.postMessage(null)
}
