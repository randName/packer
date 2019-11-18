class datGUIProgress {

  constructor (folder, defaultMax) {
    this.folder = folder
    this.defaultMax = defaultMax || 100

    this.object = {}
    this.message = null
    this.controller = null
  }

  get value () {
    return this.object[this.message] || 0
  }

  set value (v) {
    this.object[this.message] = v || 0
  }

  show () {
    this.folder.open()
  }

  hide () {
    this.folder.close()
  }

  remove () {
    if (!this.controller) return
    this.folder.remove(this.controller)
    delete this.object[this.message]
    this.controller = null
    this.message = null
  }

  update (state) {
    this.remove()
    this.message = state.message
    this.value = 0
    const total = state.total || this.defaultMax
    this.controller = this.folder.add(this.object, this.message, 0, total)
  }

  on (state) {
    if (state.message && state.message !== this.message) this.update(state)
    this.value = state.value || (this.value + 1) % this.default
    this.controller.updateDisplay()
  }
}

export { datGUIProgress }
