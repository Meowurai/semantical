# Semantical

**Connect your data to its meaning.**

A browser-based workspace for data lineage and semantic modeling, built with TypeScript, Vite, SVG, and Lucide icons.

[Open Semantical](https://meowurai.github.io/semantical/)

## Explore

Open the menu and choose **Load demo** for a fictional Northstar wholesale model with bronze, silver, and gold tables, business entities, and a revenue metric. Loading the demo replaces the current models after confirmation and can be undone.

- **Lineage:** define tables, columns, keys, transformations, and upstream mappings. Select a column to trace its sources or downstream impact.
- **Semantics:** define entities, attributes, relationships, and metrics, then map them to physical tables and columns.
- **Checks:** find incomplete definitions, broken mappings, and incompatible types.
- Drag nodes, search, zoom, fit, or arrange the canvas. Right-click nodes for additional actions.
- Choose System, Light, or Dark in the menu.

## Save, transfer, and share

Changes save automatically in this browser. There is no backend, account system, or cloud synchronization. Clearing browser storage removes saved models.

**Export models** downloads a versioned JSON file containing both models, mappings, and positions. **Import models** validates that file and confirms replacement. Import and demo loading support Undo.

Shared URLs contain snapshots of both models. A read-only link opens an inspection view; an editable link opens an independent copy. Read-only mode is a UI restriction, not an access-control mechanism. Anyone with the link can inspect its model contents.

Local development and the hosted site have separate browser storage. Export locally and import on the hosted site to transfer your work.

## Model semantics

Value mappings feed calculations or copies. Dependency mappings describe columns used to join, filter, or otherwise select rows. Impact follows explicitly modeled references; transformation text is not parsed.

Entities may have multiple named physical representations with direct attribute-to-column bindings. Metrics reference entity attributes, aggregations, an optional time attribute, and dimensions. Definitions and filters are descriptive: Semantical does not execute queries or transformations. Cross-entity dimension joins and calculated metric composition are not supported yet.

The `?example=company` URL also loads the Northstar example into a separate local workspace. Its data is fictional.

## Development

Requires Node.js 22 and npm.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

Tests cover lineage traversal, validation, persistence, layout, routing, semantic mappings, history, and model-file round trips. Builds include TypeScript checks for unused code.

## Deployment

GitHub Actions tests and builds pull requests. Successful pushes to `main` deploy to GitHub Pages. The workflow builds with `/semantical/` as the asset base; local development uses `/`.

Only the compiled static app is deployed. Dependencies, generated build output, environment files, and local artifacts are excluded from the repository.
