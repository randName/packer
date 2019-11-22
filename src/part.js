import { Path } from './geometry.js'

const RIGHT_ANGLES = { a: 0, b: 90, c: 180, d: 270 }
const RIGHT_TRANSFORMS = {
  a: [ 1, 0, 0, 1, 0, 0],
  b: [ 0,-1, 1, 0, 0, 0],
  c: [-1, 0, 0,-1, 0, 0],
  d: [ 0, 1,-1, 0, 0, 0],
}

const quarter = (angle) => angle % (Math.PI / 2)
const getPoint = (a, p) => p[p.angles.map(quarter).indexOf(a)]

class Part {

  constructor (id, path, origin, area) {
    this.id = id
    this.area = area
    this.origin = origin

    const original = new Path(...path)
    this.path = original.translate(original.centroid.neg)

    // rotating calipers for oriented bounding boxes
    const angles = [0, ...this.path.angles, ...this.path.hull.angles]

    this.rotations = [...new Set(angles.map(quarter))].map((angle) => {
      const p = getPoint(angle, this.path) || getPoint(angle, this.path.hull)
      if (angle === 0 || !p) return { angle, path: this.path }
      const r = this.path.translate(p.neg).rotate(angle)
      const path = r.translate(r.centroid.neg)
      return { angle, path }
    }).sort((a, b) => a.path.bounds.area - b.path.bounds.area)
  }

  randomRo (max) {
    // bias towards 0 by squaring uniform random
    const r = Math.random()
    return Math.floor(r * r * Math.min(this.rotations.length, max || 2))
  }

  getRotation (place, maxRo) {
    const ro = place.ro === undefined ? this.randomRo(maxRo) : place.ro
    const di = place.di || 'abcd'[Math.floor(Math.random() * 4)]
    const transform = RIGHT_TRANSFORMS[di]
    return { ...this.rotations[ro], ro, di, transform }
  }

  render (placement) {
    return new Placement(placement)
  }
}

class Placement {

  constructor ({ part, path, ro, di, angle }) {
    this.part = part
    this.ro = ro
    this.di = di
    this.angle = ((angle * 180 / Math.PI) + RIGHT_ANGLES[di]) || 0

    this.origin = path[0].neg
    this.path = path.translate(this.origin)

    this.X = null
    this.Y = null
    this.placed = false
  }

  get position () {
    return {
      X: this.origin.X + this.X || 0,
      Y: this.origin.Y + this.Y || 0,
    }
  }

  toString () {
    return `${this.part.id}|${this.ro}|${this.di}`
  }

  put (p) {
    this.placed = true
    return Object.assign(this, p)
  }

  place (scale) {
    return {
      id: this.part.id,
      angle: this.angle,
      x: this.position.X / scale,
      y: this.position.Y / scale,
    }
  }

  getIFP (bin) {
    const x1 = -this.path.bounds.min.X, x2 = bin.X - this.path.bounds.max.X
    const y1 = -this.path.bounds.min.Y, y2 = bin.Y - this.path.bounds.max.Y
    const p = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([X, Y]) => ({X, Y}))
    if (ClipperLib.Clipper.Area(p) > 0) p.reverse()
    return new Path(...p)
  }
}

export { Part, Placement }
