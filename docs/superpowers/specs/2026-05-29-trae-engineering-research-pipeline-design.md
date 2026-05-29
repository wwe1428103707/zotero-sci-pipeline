# Trae-oriented engineering research pipeline design

## Purpose

This design adapts the repository from a medical literature automation workflow into a Trae-friendly engineering research and paper production pipeline. The work keeps the four-stage orchestration model, audit files, staged artifacts, and Zotero-compatible writeback path. It removes hardcoded medical assumptions, replaces Codex-specific guidance with Trae-oriented workflow entry points, and adds a paper asset flow that can produce Markdown, DOCX, PDF, and LaTeX outputs for general SCI engineering papers and CNKI-style academic papers.

The design follows a minimal-intrusion approach. The repository keeps its current script entry points and directory layout where possible. New behavior is introduced through profile-driven configuration, adapter interfaces, and output profiles instead of a rewrite.

## Goals

* Keep the stage gate model and preserve failure boundaries between Stage1, Stage2, Stage3, and Stage4.
* Preserve existing JSON audit artifacts and the `research_os` artifact layout.
* Replace medical-only defaults with an engineering-oriented default profile while keeping a legacy medical profile path available.
* Support `RSS + Crossref + CNKI import` as the default source combination.
* Add a paper asset flow that can export `paper.md`, `references.bib`, `paper.docx`, `paper.pdf`, and `paper.tex`.
* Add Trae-oriented entry points, configuration, and agent guidance without breaking script compatibility.
* Apply a single paper data model to both SCI generic engineering output and CNKI generic academic output.

## Non-goals

* Do not implement direct CNKI web scraping.
* Do not automate PDF download or attachment management.
* Do not attempt journal-specific submission templates in the first pass.
* Do not replace Zotero in the first pass.
* Do not rewrite the repository into a pure writing application.

## Current baseline

The current repository has a stable core:

* The top-level orchestrator in `tools/run_zotero_literature_filter.mjs` runs Stage1, Zotero MCP readiness, Stage2 writeback, Stage3 translation, and Stage4 exports with strict gate handling.
* `tools/run_research_os_pipeline.mjs` builds the Stage1 artifact set: source fetch, merge, dedup, triage, feedback learning audit, and export inputs.
* Runtime paths are centralized in `tools/lib/runtime_config.mjs`.
* Stage payload shaping is already separated in focused helpers such as `tools/lib/pipeline_stage_support.mjs`, `tools/lib/literature_config.mjs`, and `tools/lib/triage_policy.mjs`.

This baseline is suitable for an interface-first adaptation. The main issue is not orchestration. The main issue is that domain logic, source assumptions, naming, and output scope are too tightly tied to medicine and Codex.

## Target product shape

After the adaptation, the repository remains a staged research pipeline with two downstream tracks:

* Research material track: discover, normalize, deduplicate, rank, sync, and audit references.
* Paper asset track: enrich selected references, collect writing constraints, build structured paper assets, and export multiple output formats.

The repository should read as a general engineering research workspace that can still support literature discovery and document production in one place.

## Architecture changes

### 1. Keep the four-stage shell

The repository keeps the current stage shell and gate semantics:

* Stage1: ingest, normalize, deduplicate, rank, and prepare assets
* Stage2: sync with bibliography backend
* Stage3: metadata enrichment and translation backfill
* Stage4: report and paper asset export

The existing entry point files remain valid. Additional neutral aliases may be introduced later, but no existing automation should lose its target.

### 2. Add profile-driven domain behavior

Domain behavior moves behind a research profile. The default profile becomes `engineering_general`. A compatibility profile such as `medical_legacy` keeps the current path available.

A profile controls:

* label names for the A/B/C/D triage ladder
* domain-specific keyword groups
* hard exclusion hints
* paper metadata defaults
* output preferences
* source defaults

The profile is not a replacement for `screening_standards.md`. The profile supplies defaults. `screening_standards.md` remains the user-facing place where human guidance and preference learning accumulate.

### 3. Add source adapters

Source collection changes from fixed logic to adapter-backed collection.

The first-pass adapters are:

* `rss`
* `crossref`
* `cnki_import`

Each adapter returns a normalized item list plus adapter-level audit fields. The Stage1 pipeline continues to own merge, dedup, ranking, and artifact writing. Adapters should not bypass the pipeline and write final artifacts themselves.

### 4. Add bibliography backend abstraction

Zotero remains the only real backend in the first pass, but the code should stop treating Zotero as a universal assumption. Stage2 should target a bibliography backend interface. The default backend remains `zotero_mcp`.

This keeps the current value of the repository while avoiding deeper spread of Zotero-only naming.

### 5. Expand Stage3 from title translation to metadata enrichment

Stage3 becomes a metadata enrichment layer that can include:

* title translation
* abstract cleaning
* keyword normalization
* alternate language fields
* citation key generation
* BibTeX field preparation

Translation remains optional and failure-tolerant.

### 6. Expand Stage4 from workbook export to asset export

Stage4 continues to generate review workbooks, but it also becomes the home for structured paper assets:

* review workbook outputs
* `references.bib`
* `paper.md`
* `paper.docx`
* `paper.pdf`
* `paper.tex`

The stage should report each artifact separately, with status, method, path, and any failure or degradation reason.

## Configuration design

### New profile file

Add `config/research_profile.json` as the top-level profile selector and default behavior file.

It should define:

* `profile_id`
* `domain`
* `default_sources`
* `triage_labels`
* `paper_type`
* `language_mode`
* `citation_style`
* `output_profiles`
* `bibliography_backend`

### Existing config files remain, but their role narrows

* `config/workflow_rules.json` remains the scoring and rule container, but it stops carrying medical-only semantics by default.
* `config/pubmed_pmc_search.json` should transition into a broader source config. The first pass may keep the file for backward compatibility while introducing a neutral registry file such as `config/source_registry.json`.
* `config/rss_sources.json` remains valid.
* `screening_standards.md` remains valid and should be extended, not replaced.

### Screening standards structure

`screening_standards.md` should be interpreted as a cross-stage preference file with these sections:

* `研究主题与边界`
* `优先关注`
* `相对降权`
* `严格排除`
* `论文写作要求`
* `格式偏好与投稿约束`

The first four sections still influence ranking. The last two sections influence paper asset generation and export defaults.

### Environment variables

Environment variables should be grouped by concern:

* runtime and scheduling
* bibliography backend
* model-backed enrichment
* export toolchain
* Trae integration

The first pass should avoid deleting current variables. It should add neutral aliases and map both names to the same runtime config.

## Data model changes

### Normalized research item

The source adapters should map records into a shared normalized research item with fields such as:

* `title`
* `abstract`
* `authors`
* `journal_or_venue`
* `year`
* `language`
* `doi`
* `url`
* `external_ids`
* `source_channel`
* `source_platform`
* `keywords`
* `citation_meta`

`external_ids` replaces logic that assumes only `pmid` or `pmcid`.

### Triage semantics

The A/B/C/D ladder remains, but the default engineering labels become:

* A: `A核心相关`
* B: `B主题相关`
* C: `C背景相关`
* D: `D低相关`

The repository keeps A/B/C/D because the rest of the pipeline and export logic already depend on a four-band structure.

### Paper asset model

A paper asset model should sit between research material selection and final rendering. It needs enough structure to support both SCI and CNKI generic output:

* title block
* bilingual abstracts
* keywords
* section tree
* figures and tables
* equations and symbols
* bibliography records
* appendices
* acknowledgements

Markdown stays the authoring-friendly representation, but the system should treat the Markdown as a projection of structured paper data rather than the only source of truth.

## Output profile design

Two generic output profiles are in scope for the first pass:

* `sci_generic_engineering`
* `cnki_generic_academic`

They share the same paper data model and differ in rendering rules:

* title page and metadata block
* bilingual abstract placement
* keyword formatting
* heading numbering
* figure and table caption placement
* reference style
* margin, spacing, and font defaults
* appendix and acknowledgement layout

The first pass should target general compliance baselines rather than institution-specific CNKI thesis variants or publisher-specific SCI templates.

## Trae adaptation

Trae adaptation covers three layers.

### Command layer

The repository should define Trae-friendly entry phrases and script aliases for common actions:

* run research pipeline
* import CNKI results
* sync bibliography backend
* generate paper draft
* export SCI format
* export CNKI format

Existing script entry points stay valid.

### Workspace layer

The workspace should expose stable locations for:

* profiles
* prompts
* exports
* paper assets
* imported source files

This reduces hidden coupling between agent instructions and the repository layout.

### Agent instruction layer

`AGENTS.md` should be rewritten so that:

* medical-only constraints are moved behind the legacy profile
* Codex-only phrasing is removed
* Trae-oriented execution rules and source boundaries are explicit
* engineering paper output expectations are first-class behavior

## Failure handling and degradation

The repository should preserve its current failure discipline:

* source failure must not fabricate success for unrelated sources
* backend sync failure must not claim Stage2 success
* translation failure must keep English fields available
* DOCX, PDF, and LaTeX failures must be tracked independently
* format profile gaps must report incomplete status instead of pretending to be submission-ready

Suggested output states:

* `draft_ready`
* `format_incomplete`
* `submission_ready`

## Verification plan

Verification should be split into three layers.

### Compatibility regression

Check that:

* the existing orchestrator still runs
* the `research_os` artifact tree is still produced
* JSON audit files retain key fields
* the Zotero path still works when the backend is available

### Feature validation

Check that:

* `rss` adapter works
* `crossref` adapter works
* `cnki_import` can read local imports
* the engineering profile produces ranked items
* paper assets can be produced in all planned formats

### Format validation

Check that:

* SCI generic output includes the expected abstract, section, citation, and caption structure
* CNKI generic output includes the expected metadata, abstract, keyword, reference, and appendix structure
* Markdown, DOCX, PDF, and LaTeX outputs remain consistent with the same paper asset model

## Implementation order

1. Extract interfaces without changing default behavior.
2. Add the engineering profile and keep a legacy medical profile.
3. Introduce `crossref` and `cnki_import`.
4. Expand Stage3 into metadata enrichment.
5. Expand Stage4 into paper asset export.
6. Add Trae-facing commands and instruction updates.
7. Run compatibility regression and format validation.

## Acceptance criteria

The work is complete when these conditions hold:

* The four-stage pipeline still runs with gate semantics intact.
* The default project behavior is engineering-oriented, not medical-only.
* `RSS + Crossref + CNKI import` are supported as the default source set.
* Trae users have clear, stable project entry points.
* The repository can produce both research review assets and paper assets.
* `Markdown`, `DOCX`, `PDF`, and `LaTeX` outputs are available from the same paper asset flow.
* SCI generic engineering and CNKI generic academic profiles both work at a baseline formatting level.
* Audit and degradation states remain explicit.

## Risks and guardrails

The main risk is silent scope expansion. This repository already does several jobs: ingestion, ranking, Zotero sync, translation, and export. The adaptation should not merge all of that into a single large script or a single large config file.

The safest path is to keep these boundaries:

* adapters collect data
* Stage1 normalizes and ranks data
* Stage2 syncs references
* Stage3 enriches metadata
* Stage4 renders outputs

Each stage should continue to emit auditable artifacts even when a downstream stage fails.
