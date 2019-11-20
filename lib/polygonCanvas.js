class Canvas {

  constructor (id, size) {
    const canvas = document.createElement('canvas')
    canvas.setAttribute('id', id)
    canvas.setAttribute('width', size.width)
    canvas.setAttribute('height', size.height)

    const self = this
    canvas.addEventListener('click', function (e) {
      self.path.push([e.pageX - this.offsetLeft, e.pageY - this.offsetTop])
      self.redraw()
    }, false)

    this.path = []
    this.el = canvas
    this.context = canvas.getContext('2d')
  }

  reset () {
    this.path = []
    this.redraw()
  }

  resize ({ width, height }) {
    if (width) { this.context.width = width }
    if (height) { this.context.height = height }
  }

  end () {
    const xs = this.path.map((p) => p[0]), ys = this.path.map((p) => p[1])
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2
    const my = (Math.max(...ys) + Math.min(...ys)) / 2
    const path = this.path.map((p) => ({ x: p[0] - mx, y: p[1] - my }))
    this.reset()
    return path
  }

  redraw () {
    const ctx = this.context
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.strokeStyle = '#999'
    ctx.fillStyle = '#999'
    ctx.lineWidth = 1
    ctx.beginPath()
    this.path.forEach((p, i) => {
      if (i) {
        ctx.lineTo(...p)
      } else {
        ctx.fillRect(...p, 1, 1)
        ctx.moveTo(...p)
      }
    })
    ctx.closePath()
    ctx[this.path.length < 3 ? 'stroke' : 'fill']()
  }
}

export { Canvas }
