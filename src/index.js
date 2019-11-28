import { BasePacker } from './base.js'
import { SinglePacker } from './single.js'

class Packer extends BasePacker {

  constructor () {
    super()

    this.fuzzmin = 0.8
  }

  placementHeuristic (current, placed) {
    return current.bounds.width + current.bounds.height
  }

  createPrefab () {
    const z = (a) => a * ((Math.random() * 1 - this.fuzzmin) + this.fuzzmin)
    const prefab = Array.from(this.parts, ([id, p]) => ({ id, a: z(p.area) }))
    return prefab.sort((a, b) => b.a - a.a)
  }

  async pack (onProgress) {
    let placements, result, best = null
    while (!this.stopped) {
      placements = this.render()
      await this.generateNFPs(placements, onProgress)
      if (this.stopped) break
      result = await this.findPlacements(placements, onProgress)
      result.score = this.evaluate(result)
      onProgress(result)
      if (best === null || result.score < best.score) {
        best = result
      }
    }
    return best
  }
}

export {
  Packer,
  SinglePacker,
}
