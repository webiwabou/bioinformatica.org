import PERSONA_TEXT from "./persona.txt"
import SKILL_WORKFLOW from "./skill/nfcore-workflow.txt"
import SKILL_ENVIRONMENT from "./skill/nfcore-environment.txt"
import SKILL_SAMPLESHEET from "./skill/nfcore-samplesheet.txt"
import SKILL_RUN from "./skill/nfcore-run.txt"
import SKILL_FAILURE from "./skill/nfcore-failure.txt"
import SKILL_MANIFEST from "./skill/nfcore-manifest.txt"
import SKILL_LITERATURE from "./skill/literature-synthesis.txt"
import SKILL_CLAIM_TYPING from "./skill/claim-typing.txt"
import SKILL_CRITIQUE from "./skill/result-critique.txt"
import SKILL_AUTHORING from "./skill/nfcore-authoring.txt"
import SKILL_CONTRIBUTION from "./skill/nfcore-contribution.txt"
import SKILL_FORK from "./skill/nfcore-fork.txt"
import SKILL_HYPOTHESIS from "./skill/hypothesis-generation.txt"
import SKILL_CAMPAIGN from "./skill/discovery-campaign.txt"
import SKILL_TOOLING from "./skill/external-tool-acquisition.txt"
import SKILL_BULKDATA from "./skill/bulk-data-acquisition.txt"
import SKILL_STRUCTURAL from "./skill/structural-evidence.txt"

// The always-on identity block layered over the base coding-agent prompt.
// It reframes the agent as an nf-core bioinformatics co-scientist without rewriting
// the provider base prompts.
export const Persona: string = PERSONA_TEXT

export interface BuiltinSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

// Built-in nf-core skills that ship with Bioinformatica. These are scaffold-level guidance
// (the workflow map and the environment policy), deepened over time with executable
// procedures and tools. Registered before disk discovery so a user's on-disk
// skill with the same name can override them.
export const BuiltinSkills: readonly BuiltinSkill[] = [
  {
    name: "discovery-campaign",
    description:
      "Designing a multi-stage campaign when no pipeline fits: snapshotting a corpus, subtracting the known set, keeping a control arm for any prioritising heuristic, requiring two genuinely independent evidence levels, and collapse-compute-propagate at scale. Also the coordinate-space rule, the turn budget, and front-loading decisions. Load whenever a pipeline search returns NO_SUITABLE_PIPELINE, or the scientist states an outcome to discover rather than a pipeline to run.",
    content: SKILL_CAMPAIGN,
  },
  {
    name: "external-tool-acquisition",
    description:
      "Acquiring, pinning and running a command-line tool that has no nf-core module: container digest or versioned conda env, checking a package exists before building it, capturing versions, and the shell facts that otherwise waste a stage (conda activate, closed stdin, merged streams, detaching a long job). Also the brief to produce when a tool cannot be obtained at all. Load before installing or running any tool Bioinformática.org has no dedicated tool for.",
    content: SKILL_TOOLING,
  },
  {
    name: "bulk-data-acquisition",
    description:
      "Pulling a whole corpus from a public database rather than a single record: asserting completeness so a truncated download cannot masquerade as a negative result, typed failures, rate limits, real pagination, snapshot plus manifest, a disk budget, and deciding what belongs in the corpus and which free-text fields must be requested. Load when a stage needs more than a handful of records.",
    content: SKILL_BULKDATA,
  },
  {
    name: "structural-evidence",
    description:
      "Confirming a sequence-level finding in experimental 3D structure: whether the two levels are really independent, building a null and positive controls instead of counting hits above a threshold, verifying an identity collapse before propagating coordinates, mapping sequence numbering onto observed residues, and the silent corruptions when cutting fragments or comparing at scale. Load for structural validation, fragment cutting, or any claim that two regions are structurally the same.",
    content: SKILL_STRUCTURAL,
  },
  {
    name: "nfcore-workflow",
    description:
      "The end-to-end workflow for running any nf-core pipeline: pipeline selection, environment preparation, samplesheet construction, test-profile then real-data execution, and failure recovery. Load this when a scientist wants to run, choose, or troubleshoot an nf-core pipeline analysis.",
    content: SKILL_WORKFLOW,
  },
  {
    name: "nfcore-environment",
    description:
      "How Bioinformática.org inspects and repairs the local environment for nf-core runs: Nextflow version, Docker/conda backend, CPU/RAM/GPU resources, resource-margin adaptation, and the self-install vs. show-the-sudo-command policy. Load this when diagnosing environment, version, or resource problems.",
    content: SKILL_ENVIRONMENT,
  },
  {
    name: "nfcore-samplesheet",
    description:
      "How Bioinformática.org builds an nf-core samplesheet from a folder of data: reading the pipeline's own schema_input.json for the real columns, inspecting files by name/header only, mapping files to samples, asking when grouping or read pairing is ambiguous, validating, and writing the CSV. Load this when creating or fixing a samplesheet.",
    content: SKILL_SAMPLESHEET,
  },
  {
    name: "nfcore-run",
    description:
      "How Bioinformática.org runs an nf-core pipeline: building the exact nextflow run command, running the test profile first through the shell tool with approval, then the real data. Load this when executing, testing, or launching a pipeline run.",
    content: SKILL_RUN,
  },
  {
    name: "nfcore-failure",
    description:
      "How Bioinformática.org recovers when a Nextflow run fails: diagnose the real cause from the logs, explain it, offer a specific fix with approval, suggest -resume rather than restarting, and stop honestly when the cause is beyond its reach. Load this when a run fails, errors out, or crashes.",
    content: SKILL_FAILURE,
  },
  {
    name: "nfcore-manifest",
    description:
      "How Bioinformática.org builds a reproducibility manifest after a run: referencing nf-core's pipeline_info/ and nf-prov (BCO/RO-Crate) provenance without reinventing it, plus the human-approval and session-summary layer Bioinformática.org adds on top. Load this when a real run finishes or when the scientist asks about reproducibility or provenance.",
    content: SKILL_MANIFEST,
  },
  {
    name: "literature-synthesis",
    description:
      "How Bioinformática.org sources claims from the biomedical literature and databases: searching PubMed (pubmed_search/pubmed_fetch) as the primary path, citing every source, using general web search only for gaps, and distinguishing cited vs computed vs model-inferred claims. Load this whenever a statement needs a literature or database source.",
    content: SKILL_LITERATURE,
  },
  {
    name: "claim-typing",
    description:
      "How Bioinformática.org tags every statement in a saved report as [computed], [cited], or [model-inferred] so a reader knows what backs it, keeps those tags out of ordinary conversation, and asks where to save each report. Load this when writing, interpreting, or saving a report or written analysis with report_save.",
    content: SKILL_CLAIM_TYPING,
  },
  {
    name: "result-critique",
    description:
      "How Bioinformática.org runs its adaptive critique pass after each result: calling nfcore_critique for the rigor concerns shaped to the analysis type (multiple testing, batch/confounders, replication/power, assumptions), flagging without blocking, and soft-blocking only when an analysis is invalid as configured. Load this when interpreting, summarizing, or judging the validity of any analysis result.",
    content: SKILL_CRITIQUE,
  },
  {
    name: "nfcore-authoring",
    description:
      "How Bioinformática.org helps author new nf-core modules, subworkflows, and pipelines: orchestrating the official nf-core scaffolders (nf-core modules/subworkflows/pipelines create), filling in the scientist's content, and verifying with nf-test and nf-core lint — never hand-writing boilerplate and never reimplementing the underlying science. Load this when creating, adapting, testing, or preparing to contribute an nf-core module, subworkflow, or pipeline.",
    content: SKILL_AUTHORING,
  },
  {
    name: "nfcore-contribution",
    description:
      "How Bioinformática.org helps a scientist contribute a module or pipeline back to nf-core, or publish their own: making it conformant via nfcore_lint (zero failures) and nf-test, then the fork/branch/PR flow and conventions, and publishing via the nf-core pipelines create template — never free-form pipeline code, and never claiming a PR was opened unless it was. Load this when preparing a contribution, a pull request, or publishing a pipeline.",
    content: SKILL_CONTRIBUTION,
  },
  {
    name: "nfcore-fork",
    description:
      "How Bioinformática.org forks a pipeline for local code changes: cloning it into a visible pipelines/<name>-fork/ folder pinned to one upstream release, recording provenance in .bioinformatica/ via nfcore_fork, keeping it conformant with nfcore_lint, and tracking exactly how it diverged from upstream with nfcore_fork_status. Load this when a scientist needs to modify a pipeline's code rather than just its parameters.",
    content: SKILL_FORK,
  },
  {
    name: "hypothesis-generation",
    description:
      "The opt-in speculative brainstorm mode: proposing candidate hypotheses or next experiments, each grounded and claim-typed (cited/computed/model-inferred) with a concrete nf-core test, then ranking them with nfcore_hypothesis_rank and critiquing the top ones by reusing nfcore_critique. Never findings, never the default mode. Load this ONLY when the scientist explicitly asks to brainstorm, generate hypotheses, or consider next experiments.",
    content: SKILL_HYPOTHESIS,
  },
]

export * as NfcorePersona from "./persona"
