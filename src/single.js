import { BasePacker } from './base.js'
import { grahamScan, Path } from './geometry.js'

const DIS = ['a', 'b', 'c', 'd']

class SinglePacker extends BasePacker {

  constructor () {
    super()

    // single part good enough
    this.baselineThreshold = 0.2

    // ignore bundle if worse
    this.scoreThreshold = 0.5

    // torque multiplier for score
    this.torqueMultiplier = 0.5

    // number of bundles to try
    this.maxBundles = 8
  }

  get part () {
    return this.parts.get(0)
  }

  get maxScore () {
    return this.baseline * (1 + this.scoreThreshold)
  }

  clearCache () {
    this.NFPs.clear()
    this.bundles = []
    this.baseline = null
  }

  evaluateBundle (bin) {
    const rotations = new Map()
    const points = bin.map((b) => {
      const k = `${b.ro}|${'ac'.includes(b.di) ? 0 : 1}`
      rotations.set(k, (rotations.get(k) || 0) + 1)
      const r = b.part.getRotation(b)
      return r.path.transform(...r.transform).translate(b.position)
    })

    const hull = new Path(...grahamScan(points.flat()))
    const angles = hull.angles.map((a) => a % (Math.PI / 2))
    const oriented = [...new Set(angles)].reduce((m, a) => {
      const r = hull.rotate(a)
      r.a = a
      return (m === null || r.bounds.area < m.bounds.area) ? r : m
    }, null)

    const paths = points.map((p) => p.translate(hull.centroid.neg).rotate(oriented.a))

    const centered = oriented.translate(oriented.bounds.centroid.neg)
    const corner = Math.hypot(hull.bounds.width, hull.bounds.height)
    const torque = centered.centroid.norm / corner

    const count = bin.length
    const area = centered.bounds.area / this.areaScale
    const waste = Math.max(1 - count * this.part.area / area, 0)

    const variance = Array.from(rotations.values(), (i) => i / count)
      .sort((a, b) => b - a).reduce((s, p, i) => s + i * p, 0) / rotations.size

    bin.area = area
    bin.paths = paths
    bin.hull = centered
    bin.stats = { ratio: area / this.binArea, waste, variance, torque }
    return waste + variance + torque * this.torqueMultiplier
  }

  async findBundles (onProgress) {
    const length = Math.min(this.part.rotations.length, this.rotations)
    const id = 0, range = Array.from({ length }, (_, i) => i)
    const bundlePlacements = range.map((ro) => range.map((so) => DIS.map((di) => [
      [{ id, ro, di: 'a' }, { id, ro: so, di }],
      [{ id, ro, di: 'b' }, { id, ro: so, di }],
    ]))).flat(3).map((p) => this.render(p))

    await this.generateNFPs(bundlePlacements.flat(), onProgress)
    if (this.stopped) return

    const worker = this.getWorker()
    const combine = (IFP) => (NFPs) => new Promise((resolve, reject) => {
      worker.onerror = reject
      worker.onmessage = (e) => resolve(e.data)
      worker.postMessage({ NFPs, IFP })
    })

    const message = 'bundling', total = bundlePlacements.length
    onProgress({ message, total })

    const bundles = await bundlePlacements.reduce(async (pbs, bundle, value) => {
      const bds = await pbs
      if (this.stopped) return bds

      const bin = await bundle.reduce(async (promisedPlace, pl) => {
        const placed = await promisedPlace
        if (this.stopped) return placed

        const IFP = this.NFPs.get(`${pl}`)
        if (placed.length === 0) return [pl.put(IFP[0])]

        const combined = await this.combineNFP(pl, placed, combine(IFP))
        if (!combined) return placed

        const placedBounds = placed.map((c) => c.path.bounds.translate(c))
        const bound = (new Path(...placedBounds.flat())).bounds

        const pos = combined.reduce((o, f) => {
          f.bounds = bound.union(pl.path.bounds.translate(f))
          return (o === null || f.bounds.area < o.bounds.area) ? f : o
        }, null)
        return [...placed, pl.put(pos)]
      }, [])
      onProgress({ message, value })

      if (bin.length < bundle.length) return bds

      const score = this.evaluateBundle(bin)
      if (score > this.maxScore) return bds

      bin.score = score
      return [...bds, bin]
    }, [])

    onProgress({ message, remove: true })
    if (bundles.length === 0) return null

    // normalize scores and filter nearby
    const areas = bundles.map((b) => b.area)
    const mean = areas.reduce((s, a) => s + a, 0) / bundles.length
    const vari = areas.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / bundles.length
    const sd = Math.sqrt(vari) / 2, z = (b) => Math.round((b.area - mean) / sd)

    const normalized = bundles.map(z)
    return bundles.filter((b, i) => normalized.indexOf(z(b)) === i)
  }

  async pack (onProgress) {
    const single = this.render([{ id: 0, ro: 0, di: 'a' }])
    single[0].put({ X: 0, Y: 0 })
    this.baseline = this.evaluateBundle(single)
    console.log(single)

    let bundles = null
    if (this.baseline > this.baselineThreshold) {
      bundles = await this.findBundles(onProgress)
      if (this.stopped) return
    }

    if (bundles && bundles.length > 0) {
      bundles.sort((a, b) => a.score - b.score)
      bundles = bundles.slice(0, this.maxBundles)

      // preview bundles
      const showBundles = bundles.map((b) => {
        const sc = b.map((p) => p.place(this.clipperScale))
        sc.text = `score: ${b.score.toFixed(2)}`
        return sc
      })
      onProgress({ bins: showBundles })

      console.log(bundles)

      // add bundles
    } else {
      // use rectpacker
    }
  }
}

export { SinglePacker }
