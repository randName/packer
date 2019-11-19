const lazyProp = (obj, name, value) => {
  Object.defineProperty(obj, name, { value })
  return value
}

// Convex Hull using Graham's scan
const grahamSort = (a, b) => a.g === b.g ? (a.X - b.X) : (a.g - b.g)
const lowest = (b, p) => (p.Y < b.Y || (p.Y === b.Y && p.X < b.X)) ? p : b
const turns = (a, b, c) => ((b.X - a.X) * (c.Y - a.Y)) <= ((b.Y - a.Y) * (c.X - a.X))

function getPivotAngle (pivot) {
  return (p) => ({ ...p, g: Math.atan2(p.Y - pivot.Y, p.X - pivot.X) })
}

function grahamScan (points) {
  const getAngle = getPivotAngle(points.reduce(lowest))
  const [start, ...rest] = points.map(getAngle).sort(grahamSort)
  const diff = rest.findIndex((p) => (p.X !== start.X) || (p.Y !== start.Y))
  return rest.slice(diff + 1).reduce((p, c) => {
    let s, i = 0
    do { s = p.slice(0, (i--) || undefined) } while (turns(...s.slice(-2), c))
    return [...s, c]
  }, [start, rest[diff]])
}

class Path extends Array {

  get bounds () {
    return lazyProp(this, 'bounds', new Bounds(...this))
  }

  get centroid () {
    const { X, Y } = this.reduce((c, p) => ({ X: c.X + p.X, Y: c.Y + p.Y }))
    return lazyProp(this, 'centroid', { X: X / this.length, Y: Y / this.length })
  }

  get angles () {
    return lazyProp(this, 'angles', Array.from(this, (p, i) => {
      const q = this[(i || this.length) - 1]
      return Math.atan2(p.Y - q.Y, p.X - q.X) + Math.PI
    }))
  }

  transform (a, b, c, d, x, y) {
    return this.map((p) => ({
      X: p.X * a + p.Y * b + x,
      Y: p.X * c + p.Y * d + y
    }))
  }

  translate (vector) {
    return this.transform(1, 0, 0, 1, vector.X, vector.Y)
  }

  rotate (angle) {
    const s = Math.sin(angle), c = Math.cos(angle)
    return this.transform(c, -s, s, c, 0, 0)
  }
}

class Bounds extends Path {

  constructor (...points) {
    const x = Array.from(points, (p) => p.X)
    const y = Array.from(points, (p) => p.Y)
    super(
      { X: Math.min(...x), Y: Math.min(...y) },
      { X: Math.max(...x), Y: Math.max(...y) },
    )
    lazyProp(this, 'min', this[0])
    lazyProp(this, 'max', this[1])
  }

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
