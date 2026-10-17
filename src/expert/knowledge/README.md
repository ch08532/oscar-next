# Future local knowledge boundary

`ExpertKnowledgeProvider.search(query, options)` supplies citation-ready
`KnowledgeResult` objects (`id`, `title`, `source`, `excerpt`). The orchestrator
receives a provider without importing a document store or embedding engine.
The default `NoKnowledgeProvider` returns an empty array. Nothing is downloaded,
indexed or cited as a reference document in this version.

A future implementation can read curated local OSCAR/vendor documentation or
licensed references and perform local retrieval/embeddings. It must preserve
provenance and licensing, bound excerpts/results, support cancellation, and
keep retrieved text untrusted. Introduce distinct knowledge citations and UI
resolution alongside data-evidence references before enabling a real provider;
the current accepted review schema only cites OSCAR tool evidence. A nonempty
provider alone does not implement validated knowledge citations. Do not treat
model training knowledge as a retrieved source.
