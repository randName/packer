class Generator {
  constructor () {
    this.count = 20
    this.shape = 'rect'
    this.scaleMin = 100
    this.scaleRange = 50

    this.shapes = ['tri', 'rect']
  }

  get range () { return [...Array(this.count).keys()] }

  get randScale () { return (Math.random() * this.scaleRange) + this.scaleMin }

  randPoint (scale) {
    return {
      x: Math.random() * scale,
      y: Math.random() * scale,
    }
  }

  generate () {
    const shape = this[this.shape].bind(this)
    return this.range.map(() => shape(this.randScale))
  }

  tri (scale) {
    return [0,0,0].map(() => this.randPoint(scale))
  }

  rect (scale) {
    const {x, y} = this.randPoint(scale)
    return [[x, y], [0, y], [0, 0], [x, 0]].map(([x, y]) => ({x, y}))
  }
}

export { Generator }
