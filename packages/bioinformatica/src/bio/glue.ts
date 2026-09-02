export * as Glue from "./glue"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer } from "effect"
import path from "path"
import MAP_SEQRES_ATOM from "./glue/map-seqres-atom.py.txt"
import CUT_FRAGMENTS from "./glue/cut-fragments.py.txt"
import PROPAGATE from "./glue/propagate-representatives.py.txt"

// The coordinate bookkeeping between a sequence-level call and a 3D fragment.
//
// This is glue, not science: it calls Biopython's implementations and does the
// bookkeeping around them. It ships as tested scripts rather than being improvised at
// runtime because all three of its failure modes are SILENT — each produces a plausible
// file with quietly wrong contents, and none of them raises.
//
// Written as `.py.txt` because Bun's text loader is what inlines them into the binary;
// a bare `.py` import yields the file path instead of its contents.

export interface Script {
  readonly name: string
  readonly content: string
  /** What this exists to prevent. */
  readonly guards: string
}

export const SCRIPTS: readonly Script[] = [
  {
    name: "map-seqres-atom.py",
    content: MAP_SEQRES_ATOM,
    guards:
      "SEQRES positions vs residues that actually have coordinates. Reads the author-chain SEQRES from _entity_poly.pdbx_strand_id, NOT SeqIO's cif-seqres, which reports the label asym id: in 12E8 the SEQRES chains are A/B/C/D while the coordinates are L/H/M/P.",
  },
  {
    name: "cut-fragments.py",
    content: CUT_FRAGMENTS,
    guards:
      "Cutting a residue range into its own PDB. Never Bio.PDB.Dice.extract, which drops every HETATM (so MSE vanishes) and ignores insertion codes. Verified on 1VJE 301:401: this writes 2 residues and 19 MSE atoms, Dice.extract writes an empty file and raises nothing.",
  },
  {
    name: "propagate-representatives.py",
    content: PROPAGATE,
    guards:
      "Copying a representative's unit coordinates onto its cluster members. Refuses to propagate across a length difference, because CD-HIT normalises identity by the SHORTER sequence and so clusters a perfect substring at 100% with numbering offset from the representative's.",
  },
]

export interface Interface {
  /** Materialise the scripts into a directory and return their paths. */
  readonly write: (directory: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/BioGlue") {}
export const use = serviceUse(Service)

export function describe(): string {
  return SCRIPTS.map((s) => `- ${s.name}\n    ${s.guards}`).join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const write = Effect.fn("BioGlue.write")(function* (directory: string) {
      const out: string[] = []
      for (const script of SCRIPTS) {
        const target = path.join(directory, script.name)
        yield* fs.writeWithDirs(target, script.content, 0o755).pipe(Effect.orDie)
        out.push(target)
      }
      return out
    })
    return Service.of({ write })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
