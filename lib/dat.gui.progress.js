class datGUIProgress {

  constructor (folder, defaultMax) {
    this.folder = folder
    this.max = defaultMax || 100

    this.object = {}
    this.controllers = new Map()
  }

  clear () {
    this.hide()
    for (const m of this.controllers.keys()) this.remove(m)
  }

  show () {
    this.folder.open()
  }

  hide () {
    this.folder.close()
  }

  remove (message) {
    const controller = this.controllers.get(message)
    if (!controller) return
    this.folder.remove(controller)
    delete this.object[message]
    this.controllers.delete(message)
  }

  on (state) {
    const message = state.message
    if (!message) return
    if (state.remove) return this.remove(message)

    const c = this.controllers.get(message)
    if (c) return c.setValue(state.value || ((c.getValue() + 1) % this.max))

    const max = state.total || this.max
    this.object[message] = state.value || 0
    this.controllers.set(message, this.folder.add(this.object, message, 0, max))
  }
}

export { datGUIProgress }
