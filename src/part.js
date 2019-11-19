import { Path, grahamScan } from './geometry.js'

const RIGHT_ANGLES = { a: 0, b: 90, c: 180, d: 270 }
const RIGHT_TRANSFORMS = {
  a: [ 1, 0, 0, 1, 0, 0],
  b: [ 0,-1, 1, 0, 0, 0],
  c: [-1, 0, 0,-1, 0, 0],
  d: [ 0, 1,-1, 0, 0, 0],
}

const quarter = (angle) => angle % (Math.PI / 2)

class Part {

  constructor (id, path, area) {
    this.id = id
    this.area = area
    this.path = new Path(...path)

    // rotating calipers for oriented bounding boxes
    const angles = [0, ...this.path.angles]
    if (this.path.length > 3) {
      angles.push(...(new Path(...grahamScan(Array.from(this.path)))).angles)
    }

    this.rotations = [...new Set(angles.map(quarter))].map((angle) => ({
      angle, path: this.path.rotate(angle)
    })).sort((a, b) => a.path.bounds.area - b.path.bounds.area)
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

    const { X, Y } = path[0]
    this.origin = { X: -X, Y: -Y }
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
