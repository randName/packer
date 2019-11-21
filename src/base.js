import { Part } from './part.js'
import { Path } from './geometry.js'

const doNothing = () => {}
const Clipper = ClipperLib.Clipper
const NonZero = ClipperLib.PolyFillType.pftNonZero
const getWorker = () => new Worker('src/worker.js')

class BasePacker {

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

    this.parts = new Map()
    this.NFPs = new Map()
    this.running = false
    this.stopped = false
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

  async generateNFPs (placements, onProgress) {
    const gen = new Map()
    placements.forEach((b, i) => {
      if (!this.NFPs.has(`${b}`)) { this.NFPs.set(`${b}`, b.getIFP(this.bin)) }
      placements.slice(0, i).forEach((a) => {
        const key = [a, b].join('|')
        if (this.NFPs.has(key) || gen.has(key)) return
        gen.set(key, { A: a.path, B: b.path })
      })
    })

    if (gen.size === 0) return 0

    const pairs = Array.from(gen, ([key, p]) => ({ key, ...p }))
    const total = pairs.length
    const message = 'computing NFPs'
    onProgress({ message, total })

    const chunks = Math.min(navigator.hardwareConcurrency, total)
    const csize = Math.ceil(total / chunks)

    const counter = new Uint32Array(new SharedArrayBuffer(4))
    const worked = (await Promise.all(Array.from({ length: chunks }, (_, i) => {
      const j = i + 1
      const pc = pairs.slice(i * csize, j === chunks ? undefined : j * csize)
      const ps = pc.length
      if (ps === 0) return Promise.resolve([])

      const w = getWorker()
      return new Promise((resolve, reject) => {
        let n = 0, results = []
        w.onerror = (e) => console.error(e)
        w.onmessage = (e) => {
          results.push(e.data)
          if (this.stopped || results.length === ps) {
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
    onProgress({ message, remove: true })
    return worked.length
  }

  async combineNFP (placement, placed, combine) {
    const cleanDist = 0.0001 * this.clipperScale

    const found = placed.map((p) => {
      const nfp = this.NFPs.get([p, placement].join('|'))
      if (!nfp) return false
      const clean = Clipper.CleanPolygon(nfp.translate(p), cleanDist)
      return clean
    }).filter((p) => (p && p.length > 2))
    if (found.length < 1) return

    const subtracted = await combine(found)
    const clean = Clipper.CleanPolygons(subtracted, cleanDist)
    if (!clean) return
    const fin = clean.filter((p) => (p.length > 2))
    return (fin.length > 0) ? fin[fin.length-1] : null
  }

  render (prefab) {
    return (prefab || this.createPrefab()).map((p) => {
      const part = this.parts.get(p.id)
      const rot = part.getRotation(p, this.rotations)
      const path = this.offset(rot.path).transform(...rot.transform)
      return part.render({ ...rot, part, path })
    })
  }

  // may be overriden by subclasses

  createPrefab () {
    return Array.from(this.parts, ([id, p]) => ({ id }))
  }

  createPart (part) {
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

    const scaled = Math.abs(area / this.areaScale)
    this.parts.set(part.id, new Part(part.id, path, scaled))
  }

  async findPlacements (placements, onProgress) {
    const worker = getWorker()
    const combine = (IFP) => (NFPs) => new Promise((resolve, reject) => {
      worker.onerror = reject
      worker.onmessage = (e) => resolve(e.data)
      worker.postMessage({ NFPs, IFP })
    })

    const corner = (a, b) => (a.X < b.X || ((a.X - b.X) < 1 && a.Y < b.Y))
    const bins = [], binPlacements = []
    let remaining = placements.slice()
    do {
      const message = `placing (bin ${bins.length + 1})`
      onProgress({ message, total: remaining.length })
      const bin = await remaining.reduce(async (promisedPlace, pl, value) => {
        const placed = await promisedPlace
        if (this.stopped) return placed
        onProgress({ message, value })
        const IFP = this.NFPs.get(`${pl}`)

        if (placed === null) {
          const pos = IFP.reduce((p, f) => (!p || corner(f, p)) ? f : p, null)
          return [pl.put(pos)]
        }

        const combined = await this.combineNFP(pl, placed, combine(IFP))
        if (!combined) return placed

        const placedBounds = placed.map((c) => c.path.bounds.translate(c))
        const bound = (new Path(...placedBounds.flat())).bounds
        const addBound = (f) => {
          f.bounds = bound.union(pl.path.bounds.translate(f))
          return f
        }

        const pos = combined.reduce((o, f) => {
          f.w = this.placementHeuristic(addBound(f), placed)
          return (o === null || f.w < o.w || f.X < o.X) ? f : o
        }, null)
        return [...placed, pl.put(pos)]
      }, null)

      bin.bounds = bin[bin.length - 1].bounds
      binPlacements.push(bin)

      bins.push(bin.map((p) => p.place(this.clipperScale)))
      remaining = remaining.filter((p) => !p.placed)
      onProgress({ message, remove: true })
    } while (!this.stopped && remaining.length > 0)

    worker.terminate()
    return { bins, placements, binPlacements }
  }

  async pack (onProgress) {
    const placements = this.render()
    await this.generateNFPs(placements, onProgress)
    if (this.stopped) return null
    return (await this.findPlacements(placements, onProgress))
  }

  evaluate ({ bins, placements, binPlacements }) {
    return bins.length
  }

  placementHeuristic (current, placed) {
    return current.bounds.width + current.bounds.height
  }

  // public API

  clearCache () {
    this.NFPs.clear()
  }

  load (parts) {
    this.clearCache()
    this.parts.clear()
    parts.forEach((p) => this.createPart(p))
  }

  async start (onProgress=doNothing) {
    if (this.running || !this.parts) return
    this.running = true
    const result = await this.pack(onProgress)
    this.running = false
    this.stopped = false
    return result
  }

  stop () {
    this.stopped = true
  }
}

export { BasePacker, Part }
