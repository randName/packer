const lazyProp = (obj, name, value) => {
  Object.defineProperty(obj, name, { value })
  return value
}

// Convex Hull using Graham's scan
const grahamSort = (a, b) => a.g === b.g ? (a.X - b.X) : (a.g - b.g)
const lowest = (b, p) => (p.Y < b.Y || (p.Y === b.Y && p.X < b.X)) ? p : b
const turns = (a, b, c) => ((b.X - a.X) * (c.Y - a.Y)) < ((b.Y - a.Y) * (c.X - a.X))

function getPivotAngle (pivot) {
  return (p) => ({ ...p, g: Math.atan2(p.Y - pivot.Y, p.X - pivot.X) })
}

function grahamScan (points) {
  if (points.length <= 3) return points
  const getAngle = getPivotAngle(points.reduce(lowest))
  const [start, ...rest] = points.map(getAngle).sort(grahamSort)
  const diff = rest.findIndex((p) => (p.X !== start.X) || (p.Y !== start.Y))
  return rest.slice(diff + 1).reduce((p, c) => {
    let s = p, i = 0
    while (turns(...s.slice(-2), c)) { s = p.slice(0, --i) }
    return [...s, c]
  }, [start, rest[diff]])
}

class Vec {

  constructor (X, Y) {
    if (X && Y === undefined) {
      if (X.length === 2) {
        Y = X[1]
        X = X[0]
      } else {
        Y = X.Y
        X = X.X
      }
    }
    this.X = Math.floor(X) || 0
    this.Y = Math.floor(Y) || 0
  }

  static get X () { return (p) => p.X }

  static get Y () { return (p) => p.Y }

  get neg () {
    return lazyProp(this, 'neg', new Vec(-this.X, -this.Y))
  }

  get norm () {
    return lazyProp(this, 'norm', Math.hypot(this.X, this.Y))
  }

  get angle () {
    return lazyProp(this, 'angle', Math.atan2(this.Y, this.X))
  }

  equals (v) {
    return this.X === v.X && this.Y === v.Y
  }

  near (v, threshold = 1) {
    return this.distanceTo(v) < threshold
  }

  add (v) {
    return new Vec(this.X + v.X, this.Y + v.Y)
  }

  sub (v) {
    return new Vec(this.X - v.X, this.Y - v.Y)
  }

  scale (s) {
    return new Vec(this.X * s, this.Y * s)
  }

  transform (a, b, c, d, x, y) {
    const { X, Y } = this
    return new Vec(X * a + Y * b + x, X * c + Y * d + y)
  }

  distanceTo (v) {
    return this.sub(v).norm
  }

  angleTo (v, offset = Math.PI) {
    return v.sub(this).angle + offset
  }
}

class Path extends Array {

  constructor (...points) {
    super(...points.map((p) => new Vec(p)))
  }

  get bounds () {
    return lazyProp(this, 'bounds', new Bounds(...this))
  }

  get centroid () {
    const sum = this.reduce((c, p) => c.add(p), new Vec())
    return lazyProp(this, 'centroid', sum.scale(1 / this.length))
  }

  get hull () {
    return lazyProp(this, 'hull', new Path(...grahamScan(Array.from(this))))
  }

  get angles () {
    const ag = (p, i) => p.angleTo(this[(i || this.length) - 1])
    return lazyProp(this, 'angles', Array.from(this, ag))
  }

  transform (a, b, c, d, x, y) {
    return this.map((p) => p.transform(a, b, c, d, x, y))
  }

  translate (vector) {
    return this.map((p) => p.add(vector))
  }

  rotate (angle) {
    const s = Math.sin(angle), c = Math.cos(angle)
    return this.transform(c, -s, s, c, 0, 0)
  }
}

class Bounds extends Path {

  constructor (...points) {
    const x = Array.from(points, Vec.X)
    const y = Array.from(points, Vec.Y)
    super([Math.min(...x), Math.min(...y)], [Math.max(...x), Math.max(...y)])
    lazyProp(this, 'min', this[0])
    lazyProp(this, 'max', this[1])
  }

  get hull () { return this }

  get angles () { return [] }

  get bounds () { return this }

  get width () {
    return lazyProp(this, 'width', this.max.X - this.min.X)
  }

  get height () {
    return lazyProp(this, 'height', this.max.Y - this.min.Y)
  }

  get area () {
    return lazyProp(this, 'area', this.width * this.height)
  }

  union (other) {
    return new Bounds(...this, ...other)
  }
}

export { grahamScan, Path, Bounds }
