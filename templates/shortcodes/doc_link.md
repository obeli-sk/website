{% set ancestor = page.ancestors[2] %}{% set parts = ancestor | split(pat="/") %}{% set actual_version = parts[1] %}[{{title}}](@/docs/{{actual_version}}/{{path}})
