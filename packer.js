const doNothing = () => {}
const TOL = Math.pow(10, -9)
const Clipper = ClipperLib.Clipper
const NonZero = ClipperLib.PolyFillType.pftNonZero

const translate = (poly, v) => poly.map((p) => ({X: p.X + v.X, Y: p.Y + v.Y}))

const rotate = (poly, angle) => {
  const s = Math.sin(angle), c = Math.cos(angle)
  return poly.map((p) => ({ X: p.X * c - p.Y * s, Y: p.X * s + p.Y * c }))
}

const bounds = (points) => {
  const xs = points.map((p) => p.X), ys = points.map((p) => p.Y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return { width: maxX - minX, height: maxY - minY, minX, maxX, minY, maxY }
}

class Placement {
  constructor (id, path, ro, scale, angle) {
    this.id = id
    this.ro = ro
    this.scale = scale
    this.angle = angle || 0

    const {X, Y} = path[0]
    this.origin = {X: -X, Y: -Y}
    this.path = translate(path, this.origin)
    Object.assign(this, bounds(this.path))
  }

  get x () { return ((this.X + this.origin.X) / this.scale) || 0 }

  get y () { return ((this.Y + this.origin.Y) / this.scale) || 0 }

  get transform () {
    return `translate(${this.x} ${this.y}) rotate(${this.angle})`
  }

  put (p) { return Object.assign(this, p) }

  toString () { return `${this.id}|${this.ro}` }

  getIFP (bin) {
    const x1 = -this.minX, x2 = bin.X - this.maxX
    const y1 = -this.minY, y2 = bin.Y - this.maxY
    const p = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([X, Y]) => ({X, Y}))
    if (Clipper.Area(p) > 0) p.reverse()
    return p
  }
}

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

    this.parts = null
    this.NFPs = new Map()
    this.running = false
  }

  get bin () { return this.toClipper([{x: this.width, y: this.height}])[0] }

  get clipperTolerance () { return this.tolerance * this.clipperScale }

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
    return np[0]
  }

  async generateNFPs (pairs, onProgress) {
    const total = pairs.length
    const message = 'computing NFPs'
    onProgress({ message, total })

    const pk = (p) => [p[0].id, p[0].ro, p[1].id, p[1].ro].join('|')
    const counter = new Uint32Array(new SharedArrayBuffer(4))

    const chunks = Math.min(navigator.hardwareConcurrency, total)
    const csize = Math.ceil(total / chunks)
    const workers = [...Array(chunks).keys()].map((i) => new Worker('worker.js'))
    const worked = (await Promise.all(workers.map((w, i) => {
      const j = i + 1
      const pc = pairs.slice(i * csize, j === chunks ? undefined : j * csize)
      const ps = pc.length
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
    worked.forEach((p) => this.NFPs.set(pk(p.pair), p.nfp))

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
      const clean = Clipper.CleanPolygon(translate(nfp, p), cleanDist)
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

  load (polygons) {
    this.NFPs.clear()
    this.parts = polygons.map((poly, id) => {
      const simple = Clipper.SimplifyPolygon(this.toClipper(poly), NonZero)
      if(!simple || simple.length === 0) return

      const path = Clipper.CleanPolygon(simple.reduce((b, s) => {
        const a = Math.abs(Clipper.Area(s))
        return (b === null || a > b[0]) ? [a, s] : b
      }, null)[1], this.clipperTolerance)
      if (!path || path.length < 3) return
      if (Clipper.Area(path) > 0) path.reverse()
      return { id, path }
    }).filter((p) => p)
  }

  render (prefab) {
    if (!prefab) {
      const fz = () => ((Math.random() * 1 - this.fuzzmin) + this.fuzzmin)
      prefab = this.parts.map(({ id, path }) => ({
        id, a: Math.abs(Clipper.Area(path)) * fz()
      })).sort((a, b) => b.a - a.a)
    }
    return prefab.map((p) => {
      const part = this.parts.find((q) => p.id === q.id)
      const ro = p.ro || Math.floor(Math.random() * this.rotations)
      const rotated = rotate(part.path, ro * 2 * Math.PI / this.rotations)

      const angle = ro * 360 / this.rotations
      return new Placement(p.id, this.offset(rotated), ro, this.clipperScale, angle)
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
        // incorrect indentation for smaller diff
      const IFP = this.NFPs.get(`${pl}`)

      if (placed === null) {
        const pos = IFP.reduce((p, f) => (p === null || f.X < p.X) ? f : p, null)
        return [pl.put(pos)]
      }

      const combined = this.combineNFP(pl, placed, IFP)
      if (!combined) return placed

      const placedpts = placed.map((c) => translate(c.path, c)).flat()
      const pos = combined.reduce((o, f) => {
        const bd = bounds([...placedpts, ...translate(pl.path, f)])
        f.w = bd.width * 2 + bd.height
        return (o === null || f.w < o.w || f.X < o.X) ? f : o
      }, null)
      return [...placed, pl.put(pos)]
        // end of incorrect indentation
      }, null)
      bins.push(bin)
      const ids = bin.map((b) => b.id)
      remaining = remaining.filter((p) => !ids.includes(p.id))
    } while (remaining.length > 0)
    return { bins }
  }
}

export { Packer }
