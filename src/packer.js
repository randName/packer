import { Part } from './part.js'
import { Path } from './geometry.js'

const doNothing = () => {}
const Clipper = ClipperLib.Clipper
const NonZero = ClipperLib.PolyFillType.pftNonZero

class Packer {

  constructor () {
    // bin dimensions
    this.width = 500
    this.height = 350

    // space between parts
    this.spacing = 5.5

    // maximum number of rotations to consider
    this.rotations = 4

    // minimum fuzz multiplier for polygon area
    this.fuzzmin = 0.8

    // max error allowed when rasterizing curves
    this.tolerance = 0.3

    // scale for Clipper
    this.clipperScale = 10000

    this.counts = new Map()
    this.parts = new Map()
    this.NFPs = new Map()
    this.running = false
  }

  get bin () {
    return this.toClipper([{x: this.width, y: this.height}])[0]
  }

  get areaScale () {
    return this.clipperScale * this.clipperScale
  }

  get clipperTolerance () {
    return this.tolerance * this.clipperScale
  }

  clearCache () {
    this.NFPs.clear()
  }

  toClipper (polygon) {
    const cS = this.clipperScale
    return polygon.map((p) => ({X: p.x * cS, Y: p.y * cS}))
  }

  offset (path) {
    if (this.spacing < 0.001) return path
    const np = new ClipperLib.Paths()
    const co = new ClipperLib.ClipperOffset(2, this.clipperTolerance)
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
    co.Execute(np, 0.5 * this.spacing * this.clipperScale)
    return new Path(...np[0])
  }

  async generateNFPs (pairs, onProgress) {
    const total = pairs.length
    const message = 'computing NFPs'
    onProgress({ message, total })

    pairs = pairs.map((p) => ({ A: p[0].path, B: p[1].path, key: p.join('|') }))

    const chunks = Math.min(navigator.hardwareConcurrency, total)
    const csize = Math.ceil(total / chunks)

    const counter = new Uint32Array(new SharedArrayBuffer(4))
    const worked = (await Promise.all(Array.from({ length: chunks }, (_, i) => {
      const j = i + 1
      const pc = pairs.slice(i * csize, j === chunks ? undefined : j * csize)
      const ps = pc.length

      const w = new Worker('worker.js')
      return new Promise((resolve, reject) => {
        let n = 0, results = []
        w.onerror = (e) => console.error(e)
        w.onmessage = (e) => {
          results.push(e.data)
          if (results.length === ps) {
            w.terminate()
            resolve(results)
          }
          onProgress({ message, value: Atomics.add(counter, 0, 1) })
          w.postMessage(pc[++n])
        }
        w.postMessage(pc[n])
      })
    }))).flat().filter((p) => p && p.nfp)

    worked.forEach((p) => this.NFPs.set(p.key, new Path(...p.nfp)))
    return worked.length
  }

  combineNFP (placement, placed, IFP) {
    const { ctUnion, ctDifference } = ClipperLib.ClipType
    const cleanDist = 0.0001 * this.clipperScale

    const diff = new Clipper(), union = new Clipper()
    const combined = new ClipperLib.Paths()
    const subtracted = new ClipperLib.Paths()
    const found = placed.map((p) => {
      const nfp = this.NFPs.get([p, placement].join('|'))
      if (!nfp) return false
      const clean = Clipper.CleanPolygon(nfp.translate(p), cleanDist)
      if(clean.length > 2) {
        union.AddPath(clean, ClipperLib.PolyType.ptSubject, true)
      }
      return true
    })
    if (found.every((i) => !i)) return
    if (!union.Execute(ctUnion, combined, NonZero, NonZero)) return

    diff.AddPath(IFP, ClipperLib.PolyType.ptSubject, true)
    diff.AddPaths(combined, ClipperLib.PolyType.ptClip, true)
    if(!diff.Execute(ctDifference, subtracted, NonZero, NonZero)) return

    const clean = Clipper.CleanPolygons(subtracted, cleanDist)
    if (!clean) return
    const fin = clean.filter((p) => (p.length > 2))
    return (fin.length > 0) ? fin[fin.length-1] : null
  }

  load (parts) {
    this.clearCache()
    this.parts.clear()
    this.counts.clear()
    parts.forEach((part) => {
      const poly = this.toClipper(part.polygon)
      const simple = Clipper.SimplifyPolygon(poly, NonZero)
      if(!simple || simple.length === 0) return

      const path = Clipper.CleanPolygon(simple.reduce((b, s) => {
        const a = Math.abs(Clipper.Area(s))
        return (b === null || a > b[0]) ? [a, s] : b
      }, null)[1], this.clipperTolerance)
      if (!path || path.length < 3) return

      const area = Clipper.Area(path)
      if (area > 0) path.reverse()

      this.counts.set(part.id, part.count || 1)
      const scaled = Math.abs(area / this.areaScale)
      this.parts.set(part.id, new Part(part.id, path, scaled))
    })
  }

  render (prefab) {
    if (!prefab) {
      const z = (a) => a * ((Math.random() * 1 - this.fuzzmin) + this.fuzzmin)
      prefab = Array.from(this.counts, ([id, length]) => {
        const area = this.parts.get(id).area
        return Array.from({ length }, () => ({ id, a: z(area) }))
      }).flat()
      prefab.sort((a, b) => b.a - a.a)
    }
    return prefab.map((p) => {
      const part = this.parts.get(p.id)
      const rot = part.getRotation(p, this.rotations)
      const path = this.offset(rot.path).transform(...rot.transform)
      return part.render({ ...rot, part, path })
    })
  }

  async start (onProgress=doNothing) {
    if (this.running || !this.parts) return
    this.running = true
    const result = await this.pack(this.render(), onProgress)
    this.running = false
    return result
  }

  async pack (placements, onProgress) {
    const pairs = placements.map((b, i) => {
      if (!this.NFPs.has(`${b}`)) { this.NFPs.set(`${b}`, b.getIFP(this.bin)) }
      return placements.slice(0, i).map((a) => [a, b])
    }).flat().filter((p) => !this.NFPs.has(p.join('|')))

    if (pairs.length) {
      await this.generateNFPs(pairs, onProgress)
    }

    const bins = []
    let remaining = placements.slice()
    do {
      const message = `placing (bin ${bins.length + 1})`
      onProgress({ message, total: remaining.length })
      const bin = remaining.reduce((placed, pl, value) => {
        onProgress({ message, value })
        const IFP = this.NFPs.get(`${pl}`)

        if (placed === null) {
          const pos = IFP.reduce((p, f) => (p === null || f.X < p.X) ? f : p, null)
          return [pl.put(pos)]
        }

        const combined = this.combineNFP(pl, placed, IFP)
        if (!combined) return placed

        const placedBounds = placed.map((c) => c.path.bounds.translate(c))
        const bound = (new Path(...placedBounds.flat())).bounds

        const pos = combined.reduce((o, f) => {
          const bd = bound.union(pl.path.bounds.translate(f))
          f.w = bd.width * 2 + bd.height
          return (o === null || f.w < o.w || f.X < o.X) ? f : o
        }, null)
        return [...placed, pl.put(pos)]
      }, null)

      bins.push(bin.map((p) => p.place(this.clipperScale)))
      remaining = remaining.filter((p) => !p.placed)
    } while (remaining.length > 0)
    return { bins }
  }
}

export { Packer }
